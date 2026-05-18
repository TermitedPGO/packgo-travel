/**
 * Unit tests for stripeWebhookIdempotency.ts.
 *
 * Phase 2 module 1 of 2026-05 refactor. The helper is exercised against an
 * in-memory mock of `getDb()` that emulates the relevant Drizzle MySQL ops
 * (insert / select / update / delete) plus UNIQUE-key collision behavior on
 * the `eventId` column.
 *
 * Cases covered:
 *   1. Fresh claim → alreadyProcessed: false + rowId
 *   2. Duplicate claim → alreadyProcessed: true with existingStatus="processing"
 *   3. After markSucceeded → re-claim sees existingStatus="succeeded"
 *   4. markFailed truncates error >1024 chars; re-claim sees existingStatus="failed"
 *   5. Concurrent claim race: Promise.all([claim, claim]) → exactly one wins
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// In-memory store + mock getDb()
// ─────────────────────────────────────────────────────────────────────

interface StoredRow {
  id: number;
  eventId: string;
  eventType: string;
  status: "processing" | "succeeded" | "failed";
  errorMessage: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

const store = {
  rows: [] as StoredRow[],
  nextId: 1,
};

class MysqlDupEntryError extends Error {
  code = "ER_DUP_ENTRY";
  errno = 1062;
  constructor(message: string) {
    super(message);
    this.name = "MysqlDupEntryError";
  }
}

/**
 * Minimal Drizzle-ish chain. The helper uses:
 *   db.insert(stripeWebhookEvents).values({...})       → returns [{insertId}]
 *   db.select({status}).from(...).where(eq(...)).limit(1)
 *   db.update(...).set({...}).where(eq(...))
 *   db.delete(stripeWebhookEvents)
 *
 * `eq()` from drizzle-orm returns an opaque token; we mock it to capture
 * the field+value pair so the mock chain can filter `store.rows`.
 */
type EqToken = { __eq: true; field: string; value: unknown };

function buildMockDb() {
  return {
    insert(_table: unknown) {
      return {
        async values(row: {
          eventId: string;
          eventType: string;
          status: "processing" | "succeeded" | "failed";
        }) {
          if (store.rows.some((r) => r.eventId === row.eventId)) {
            throw new MysqlDupEntryError(
              `Duplicate entry '${row.eventId}' for key 'uniq_stripeWebhookEvents_eventId'`
            );
          }
          const inserted: StoredRow = {
            id: store.nextId++,
            eventId: row.eventId,
            eventType: row.eventType,
            status: row.status,
            errorMessage: null,
            receivedAt: new Date(),
            processedAt: null,
          };
          store.rows.push(inserted);
          return [{ insertId: inserted.id, affectedRows: 1 }] as any;
        },
      };
    },
    select(_fields?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(token: EqToken) {
              const matches = store.rows.filter(
                (r) => (r as any)[token.field] === token.value
              );
              return {
                async limit(_n: number) {
                  return matches.slice(0, _n).map((r) => ({ status: r.status }));
                },
              };
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(updates: Partial<StoredRow>) {
          return {
            async where(token: EqToken) {
              let affected = 0;
              for (const r of store.rows) {
                if ((r as any)[token.field] === token.value) {
                  Object.assign(r, updates);
                  affected += 1;
                }
              }
              return [{ affectedRows: affected }] as any;
            },
          };
        },
      };
    },
    async delete(_table: unknown) {
      store.rows = [];
      store.nextId = 1;
      return [{ affectedRows: 0 }] as any;
    },
  };
}

vi.mock("../db", () => ({
  getDb: vi.fn(async () => buildMockDb()),
}));

vi.mock("../../drizzle/schema", () => ({
  stripeWebhookEvents: {
    id: "id",
    eventId: "eventId",
    eventType: "eventType",
    status: "status",
    errorMessage: "errorMessage",
    receivedAt: "receivedAt",
    processedAt: "processedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(
    (field: string, value: unknown): EqToken => ({ __eq: true, field, value })
  ),
}));

// Import AFTER mocks are registered.
import {
  claimStripeEvent,
  markStripeEventSucceeded,
  markStripeEventFailed,
  _clearStripeWebhookEvents_forTests,
} from "./stripeWebhookIdempotency";

describe("stripeWebhookIdempotency", () => {
  beforeEach(async () => {
    await _clearStripeWebhookEvents_forTests();
  });

  it("claims a fresh event and returns a rowId", async () => {
    const result = await claimStripeEvent({
      id: "evt_fresh_1",
      type: "checkout.session.completed",
    });
    expect(result.alreadyProcessed).toBe(false);
    if (!result.alreadyProcessed) {
      expect(typeof result.rowId).toBe("number");
      expect(result.rowId).toBeGreaterThan(0);
    }
  });

  it("returns alreadyProcessed=true with existingStatus='processing' on duplicate", async () => {
    const first = await claimStripeEvent({
      id: "evt_dup_2",
      type: "payment_intent.succeeded",
    });
    expect(first.alreadyProcessed).toBe(false);

    const second = await claimStripeEvent({
      id: "evt_dup_2",
      type: "payment_intent.succeeded",
    });
    expect(second.alreadyProcessed).toBe(true);
    if (second.alreadyProcessed) {
      expect(second.existingStatus).toBe("processing");
    }
  });

  it("re-claim after markStripeEventSucceeded sees existingStatus='succeeded'", async () => {
    const first = await claimStripeEvent({
      id: "evt_succ_3",
      type: "charge.refunded",
    });
    expect(first.alreadyProcessed).toBe(false);
    if (first.alreadyProcessed) return;

    await markStripeEventSucceeded(first.rowId);

    const second = await claimStripeEvent({
      id: "evt_succ_3",
      type: "charge.refunded",
    });
    expect(second.alreadyProcessed).toBe(true);
    if (second.alreadyProcessed) {
      expect(second.existingStatus).toBe("succeeded");
    }
  });

  it("markStripeEventFailed truncates errorMessage to 1024 chars and surfaces status='failed' on re-claim", async () => {
    const claim = await claimStripeEvent({
      id: "evt_fail_4",
      type: "customer.subscription.trial_will_end",
    });
    expect(claim.alreadyProcessed).toBe(false);
    if (claim.alreadyProcessed) return;

    const longErr = new Error("x".repeat(2000));
    await markStripeEventFailed(claim.rowId, longErr);

    // Inspect store directly to verify truncation.
    const row = store.rows.find((r) => r.eventId === "evt_fail_4");
    expect(row).toBeDefined();
    expect(row!.errorMessage).toHaveLength(1024);
    expect(row!.status).toBe("failed");

    const re = await claimStripeEvent({
      id: "evt_fail_4",
      type: "customer.subscription.trial_will_end",
    });
    expect(re.alreadyProcessed).toBe(true);
    if (re.alreadyProcessed) {
      expect(re.existingStatus).toBe("failed");
    }
  });

  it("Promise.all of two concurrent claims: exactly one wins, other sees alreadyProcessed=true", async () => {
    const event = {
      id: "evt_race_5",
      type: "customer.subscription.updated" as const,
    };
    const [a, b] = await Promise.all([
      claimStripeEvent(event),
      claimStripeEvent(event),
    ]);

    const winners = [a, b].filter((r) => r.alreadyProcessed === false);
    const losers = [a, b].filter((r) => r.alreadyProcessed === true);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    if (losers[0].alreadyProcessed) {
      expect(losers[0].existingStatus).toBe("processing");
    }
  });
});
