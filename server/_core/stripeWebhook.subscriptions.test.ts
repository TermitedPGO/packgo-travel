/**
 * Phase 2 Module 4 — subscription lifecycle handler tests.
 *
 * Exercises `handleSubscriptionUpserted`, `handleSubscriptionDeleted`, and
 * `handleTrialWillEnd` (the AB-390 trial reminder) against an in-memory
 * mock of `getDb()` that emulates Drizzle's `transaction`, `update`,
 * `insert`, `select` patterns.
 *
 * Cases:
 *   1. customer.subscription.created (paid, no trial) → users.tier flips
 *   2. customer.subscription.created (trial start) → trial row + flag both written atomically
 *   3. customer.subscription.updated (trial → active) → trial row marked converted
 *   4. customer.subscription.* mid-tx DB failure → rolls back atomically
 *   5. customer.subscription.deleted → tier reverts
 *   6. trial_will_end happy path → reminderSentAt set BEFORE email send (flag-first)
 *   7. trial_will_end email fails → flag stays + URGENT notifyOwner alert + NO re-throw
 *      Plus: trial_will_end already-reminded user → idempotent no-op (no email)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";
import { makeSubscription } from "./stripeMocks";

// ─────────────────────────────────────────────────────────────────────
// In-memory store
// ─────────────────────────────────────────────────────────────────────

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  tier: "free" | "plus" | "concierge";
  tierExpiresAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plusTrialUsedAt: Date | null;
  conciergeTrialUsedAt: Date | null;
}

interface MembershipTrialRow {
  id: number;
  userId: number;
  tier: "plus" | "concierge";
  endsAt: Date;
  reminderSentAt: Date | null;
  converted: boolean;
  convertedAt: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  startedAt: Date;
  createdAt: Date;
}

const store = {
  users: [] as UserRow[],
  membershipTrials: [] as MembershipTrialRow[],
  nextUserId: 1,
  nextTrialId: 1,
  /** Flip true to make the next tx-internal trial INSERT throw — used in case 4. */
  injectTrialInsertFailure: false,
};

// ─────────────────────────────────────────────────────────────────────
// drizzle-orm mock — captures field+value as opaque tokens
// ─────────────────────────────────────────────────────────────────────

type EqToken = { __op: "eq"; field: string; value: unknown };
type AndToken = { __op: "and"; tokens: EqToken[] };
type FilterToken = EqToken | AndToken;

function matches(row: Record<string, unknown>, token: FilterToken): boolean {
  if (token.__op === "eq") {
    return row[token.field] === token.value;
  }
  return token.tokens.every((t) => matches(row, t));
}

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((fieldRef: unknown, value: unknown): EqToken => {
    const field = typeof fieldRef === "string" ? fieldRef : (fieldRef as { __field?: string })?.__field ?? "unknown";
    return { __op: "eq", field, value };
  }),
  and: vi.fn((...tokens: EqToken[]): AndToken => ({ __op: "and", tokens })),
  ne: vi.fn((fieldRef: unknown, value: unknown) => ({ __op: "eq", field: typeof fieldRef === "string" ? fieldRef : (fieldRef as { __field?: string })?.__field ?? "unknown", value, __ne: true })),
}));

// ─────────────────────────────────────────────────────────────────────
// drizzle/schema mock — return field stubs the helper passes to eq()
// ─────────────────────────────────────────────────────────────────────

function field(name: string) {
  return { __field: name };
}

vi.mock("../../drizzle/schema", () => ({
  users: {
    id: field("id"),
    email: field("email"),
    name: field("name"),
    tier: field("tier"),
    tierExpiresAt: field("tierExpiresAt"),
    stripeCustomerId: field("stripeCustomerId"),
    stripeSubscriptionId: field("stripeSubscriptionId"),
    plusTrialUsedAt: field("plusTrialUsedAt"),
    conciergeTrialUsedAt: field("conciergeTrialUsedAt"),
  },
  membershipTrials: {
    id: field("id"),
    userId: field("userId"),
    tier: field("tier"),
    endsAt: field("endsAt"),
    reminderSentAt: field("reminderSentAt"),
    converted: field("converted"),
    convertedAt: field("convertedAt"),
    canceledAt: field("canceledAt"),
    cancelReason: field("cancelReason"),
    stripeSubscriptionId: field("stripeSubscriptionId"),
    stripePriceId: field("stripePriceId"),
    startedAt: field("startedAt"),
    createdAt: field("createdAt"),
  },
  // Other tables imported elsewhere — stubs.
  stripeWebhookEvents: {
    id: field("id"),
    eventId: field("eventId"),
    eventType: field("eventType"),
    status: field("status"),
  },
}));

// ─────────────────────────────────────────────────────────────────────
// mocked db / getDb — supports both raw + transaction handles
// ─────────────────────────────────────────────────────────────────────

interface MockHandle {
  insert: (table: { __table: string }) => {
    values: (row: Record<string, unknown>) => Promise<[{ insertId: number; affectedRows: number }]>;
  };
  select: (fields?: Record<string, { __field: string }>) => {
    from: (table: { __table: string }) => {
      where: (token: FilterToken) => {
        limit: (n: number) => Promise<Record<string, unknown>[]>;
      };
    };
  };
  update: (table: { __table: string }) => {
    set: (patch: Record<string, unknown>) => {
      where: (token: FilterToken) => Promise<[{ affectedRows: number }]>;
    };
  };
  transaction: <T>(cb: (tx: MockHandle) => Promise<T>) => Promise<T>;
}

function tableNameFor(table: unknown): "users" | "membershipTrials" {
  // The mocked schema returns the same field-stub object for the table token, but
  // since we don't have a real handle we detect by the schema reference identity.
  // Simpler: the helper passes the imported schema reference, but the only two
  // tables this test exercises are `users` and `membershipTrials`. We resolve
  // via a tag set at access time below.
  const tag = (table as { __table?: string })?.__table;
  if (tag === "users") return "users";
  if (tag === "membershipTrials") return "membershipTrials";
  throw new Error(`unknown table reference in mock: ${JSON.stringify(table)}`);
}

function buildHandle(snapshot: { users: UserRow[]; membershipTrials: MembershipTrialRow[] }, isTx = false): MockHandle {
  const u = snapshot.users;
  const t = snapshot.membershipTrials;

  return {
    insert(table) {
      const name = tableNameFor(table);
      return {
        async values(row) {
          if (name === "membershipTrials") {
            if (store.injectTrialInsertFailure) {
              store.injectTrialInsertFailure = false;
              throw new Error("simulated DB failure inside tx");
            }
            const inserted: MembershipTrialRow = {
              id: store.nextTrialId++,
              userId: row.userId as number,
              tier: row.tier as "plus" | "concierge",
              endsAt: row.endsAt as Date,
              reminderSentAt: (row.reminderSentAt as Date | null) ?? null,
              converted: (row.converted as boolean) ?? false,
              convertedAt: (row.convertedAt as Date | null) ?? null,
              canceledAt: (row.canceledAt as Date | null) ?? null,
              cancelReason: (row.cancelReason as string | null) ?? null,
              stripeSubscriptionId: (row.stripeSubscriptionId as string | null) ?? null,
              stripePriceId: (row.stripePriceId as string | null) ?? null,
              startedAt: new Date(),
              createdAt: new Date(),
            };
            t.push(inserted);
            return [{ insertId: inserted.id, affectedRows: 1 }];
          }
          throw new Error(`insert into ${name} not implemented in mock`);
        },
      };
    },
    select(_fields) {
      return {
        from(table) {
          const name = tableNameFor(table);
          return {
            where(token) {
              return {
                async limit(_n: number) {
                  const rows = name === "users" ? u : t;
                  const out = rows.filter((r) =>
                    matches(r as unknown as Record<string, unknown>, token)
                  );
                  return out.slice(0, _n);
                },
              };
            },
          };
        },
      };
    },
    update(table) {
      const name = tableNameFor(table);
      return {
        set(patch) {
          return {
            async where(token) {
              const rows = name === "users" ? u : t;
              let affected = 0;
              for (const r of rows) {
                if (matches(r as unknown as Record<string, unknown>, token)) {
                  Object.assign(r, patch);
                  affected += 1;
                }
              }
              return [{ affectedRows: affected }];
            },
          };
        },
      };
    },
    async transaction<T>(cb: (tx: MockHandle) => Promise<T>): Promise<T> {
      if (isTx) throw new Error("nested transactions not supported in mock");
      // Snapshot rows so we can roll back on throw.
      const usersBackup = u.map((r) => ({ ...r }));
      const trialsBackup = t.map((r) => ({ ...r }));
      const usersOriginalLen = u.length;
      const trialsOriginalLen = t.length;
      try {
        const result = await cb(buildHandle(snapshot, true));
        return result;
      } catch (err) {
        // Roll back to pre-tx snapshot
        u.length = 0;
        u.push(...usersBackup);
        t.length = 0;
        t.push(...trialsBackup);
        // Best-effort restoration: when the failure happened AFTER an INSERT, the
        // pushed row is dropped by the splice above; when it happened during a SET,
        // the patched fields were already reverted via the deep copy.
        if (u.length !== usersOriginalLen || t.length !== trialsOriginalLen) {
          throw new Error("rollback bookkeeping error");
        }
        throw err;
      }
    },
  };
}

// We need the schema mock to give the tables an __table tag — patch via
// vi.mock above is hoisted before this file, so we mutate after import time.
import * as schema from "../../drizzle/schema";
(schema.users as unknown as { __table: string }).__table = "users";
(schema.membershipTrials as unknown as { __table: string }).__table = "membershipTrials";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => buildHandle(store, false)),
}));

// ─────────────────────────────────────────────────────────────────────
// External-effect mocks
// ─────────────────────────────────────────────────────────────────────

const sendTrialEndingReminderMock = vi.fn();
vi.mock("../email", () => ({
  sendTrialEndingReminder: (...args: unknown[]) => sendTrialEndingReminderMock(...args),
  // Other email exports the handler MIGHT pull — return no-op stubs.
  sendPaymentSuccessEmail: vi.fn(),
  sendSupplierNotificationEmail: vi.fn(),
}));

const notifyOwnerMock = vi.fn(async () => true);
vi.mock("./notification", () => ({
  notifyOwner: (...args: unknown[]) => notifyOwnerMock(...args),
}));

const notifyAgentMessageMock = vi.fn(async () => undefined);
vi.mock("./agentNotify", () => ({
  notifyAgentMessage: (...args: unknown[]) => notifyAgentMessageMock(...args),
}));

// tierFromPriceId — returns "plus" for the canned test priceId.
const tierFromPriceIdMock = vi.fn((priceId: string) => {
  if (priceId === "price_plus_yearly") return "plus";
  if (priceId === "price_concierge_yearly") return "concierge";
  return null;
});
vi.mock("./membershipPricing", () => ({
  tierFromPriceId: (priceId: string) => tierFromPriceIdMock(priceId),
}));

// Stub Stripe so importing stripeWebhook.ts doesn't try to construct one.
vi.mock("stripe", () => ({
  default: class FakeStripe {
    constructor() {}
    webhooks = { constructEvent: vi.fn() };
    subscriptions = { retrieve: vi.fn() };
  },
}));

vi.mock("./env", () => ({
  ENV: {
    stripeSecretKey: "sk_test_dummy",
    stripeWebhookSecret: "whsec_dummy",
    baseUrl: "https://packgoplay.test",
    stripePricePlusYearlyId: "price_plus_yearly",
    stripePricePlusMonthlyId: "price_plus_monthly",
    stripePriceConciergeYearlyId: "price_concierge_yearly",
    stripePriceConciergeMonthlyId: "price_concierge_monthly",
  },
}));

// Import AFTER mocks are registered.
import { __test__ } from "./stripeWebhook";
const { handleSubscriptionUpserted, handleSubscriptionDeleted, handleTrialWillEnd } = __test__;

// ─────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────

function seedUser(over: Partial<UserRow> = {}): UserRow {
  const u: UserRow = {
    id: store.nextUserId++,
    email: `user${store.nextUserId}@test.com`,
    name: `Test User ${store.nextUserId}`,
    tier: "free",
    tierExpiresAt: null,
    stripeCustomerId: `cus_test_${store.nextUserId}`,
    stripeSubscriptionId: null,
    plusTrialUsedAt: null,
    conciergeTrialUsedAt: null,
    ...over,
  };
  store.users.push(u);
  return u;
}

function seedTrial(over: Partial<MembershipTrialRow> & Pick<MembershipTrialRow, "userId" | "stripeSubscriptionId">): MembershipTrialRow {
  const row: MembershipTrialRow = {
    id: store.nextTrialId++,
    userId: over.userId,
    tier: over.tier ?? "plus",
    endsAt: over.endsAt ?? new Date(Date.now() + 10 * 86400_000),
    reminderSentAt: over.reminderSentAt ?? null,
    converted: over.converted ?? false,
    convertedAt: over.convertedAt ?? null,
    canceledAt: null,
    cancelReason: null,
    stripeSubscriptionId: over.stripeSubscriptionId,
    stripePriceId: over.stripePriceId ?? "price_plus_yearly",
    startedAt: new Date(),
    createdAt: new Date(),
  };
  store.membershipTrials.push(row);
  return row;
}

beforeEach(() => {
  store.users = [];
  store.membershipTrials = [];
  store.nextUserId = 1;
  store.nextTrialId = 1;
  store.injectTrialInsertFailure = false;
  sendTrialEndingReminderMock.mockReset();
  notifyOwnerMock.mockReset();
  notifyOwnerMock.mockImplementation(async () => true);
  notifyAgentMessageMock.mockReset();
  notifyAgentMessageMock.mockImplementation(async () => undefined);
  tierFromPriceIdMock.mockClear();
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("handleSubscriptionUpserted", () => {
  it("Case 1 — created (paid, no trial): users.tier flips to plus, NO trial row", async () => {
    const user = seedUser({ email: "case1@test.com" });
    const sub = makeSubscription({
      id: "sub_case1",
      customerId: user.stripeCustomerId!,
      status: "active",
      priceId: "price_plus_yearly",
      trialEnd: null,
      metadata: { userId: String(user.id) },
    });

    await handleSubscriptionUpserted(sub);

    const after = store.users.find((u) => u.id === user.id)!;
    expect(after.tier).toBe("plus");
    expect(after.tierExpiresAt).toBeInstanceOf(Date);
    expect(after.stripeSubscriptionId).toBe("sub_case1");
    expect(after.plusTrialUsedAt).toBeNull();
    expect(store.membershipTrials).toHaveLength(0);
  });

  it("Case 2 — created (trial start): atomic users.flag + membershipTrials INSERT", async () => {
    const user = seedUser({ email: "case2@test.com" });
    const trialEnd = Math.floor(Date.now() / 1000) + 10 * 86400;
    const sub = makeSubscription({
      id: "sub_case2",
      customerId: user.stripeCustomerId!,
      status: "trialing",
      priceId: "price_plus_yearly",
      trialEnd,
      metadata: { userId: String(user.id) },
    });

    await handleSubscriptionUpserted(sub);

    const after = store.users.find((u) => u.id === user.id)!;
    expect(after.tier).toBe("plus");
    expect(after.plusTrialUsedAt).toBeInstanceOf(Date);
    expect(store.membershipTrials).toHaveLength(1);
    const trial = store.membershipTrials[0];
    expect(trial.userId).toBe(user.id);
    expect(trial.tier).toBe("plus");
    expect(trial.stripeSubscriptionId).toBe("sub_case2");
    expect(trial.converted).toBe(false);
  });

  it("Case 3 — updated (trial → active conversion): trial row marked converted", async () => {
    const user = seedUser({
      email: "case3@test.com",
      tier: "plus",
      plusTrialUsedAt: new Date(),
    });
    seedTrial({
      userId: user.id,
      stripeSubscriptionId: "sub_case3",
      tier: "plus",
      converted: false,
    });
    const sub = makeSubscription({
      id: "sub_case3",
      customerId: user.stripeCustomerId!,
      status: "active",
      priceId: "price_plus_yearly",
      trialEnd: null,
      metadata: { userId: String(user.id) },
    });

    await handleSubscriptionUpserted(sub);

    const after = store.users.find((u) => u.id === user.id)!;
    expect(after.tier).toBe("plus");
    const trial = store.membershipTrials.find((tr) => tr.stripeSubscriptionId === "sub_case3")!;
    expect(trial.converted).toBe(true);
    expect(trial.convertedAt).toBeInstanceOf(Date);
  });

  it("Case 4 — mid-tx DB failure rolls back atomically (trial-start path)", async () => {
    const user = seedUser({ email: "case4@test.com" });
    const trialEnd = Math.floor(Date.now() / 1000) + 10 * 86400;
    const sub = makeSubscription({
      id: "sub_case4",
      customerId: user.stripeCustomerId!,
      status: "trialing",
      priceId: "price_plus_yearly",
      trialEnd,
      metadata: { userId: String(user.id) },
    });

    // Make the trial INSERT throw mid-tx.
    store.injectTrialInsertFailure = true;

    await expect(handleSubscriptionUpserted(sub)).rejects.toThrow(/simulated DB failure/);

    const after = store.users.find((u) => u.id === user.id)!;
    // Rolled back: users.tier still "free", flag still null, no trial row.
    expect(after.tier).toBe("free");
    expect(after.plusTrialUsedAt).toBeNull();
    expect(store.membershipTrials).toHaveLength(0);
  });
});

describe("handleSubscriptionDeleted", () => {
  it("Case 5 — deleted: users.tier reverts to free, idempotent", async () => {
    const user = seedUser({
      email: "case5@test.com",
      tier: "plus",
      tierExpiresAt: new Date(),
      stripeSubscriptionId: "sub_case5",
    });
    const sub = makeSubscription({
      id: "sub_case5",
      customerId: user.stripeCustomerId!,
      status: "canceled",
      priceId: "price_plus_yearly",
    });

    await handleSubscriptionDeleted(sub);

    let after = store.users.find((u) => u.id === user.id)!;
    expect(after.tier).toBe("free");
    expect(after.tierExpiresAt).toBeNull();
    expect(after.stripeSubscriptionId).toBeNull();

    // Idempotent: second call should not blow up; already-null fields stay null.
    await handleSubscriptionDeleted(sub);
    after = store.users.find((u) => u.id === user.id)!;
    expect(after.tier).toBe("free");
  });
});

describe("handleTrialWillEnd (AB-390, flag-first)", () => {
  it("Case 6 — happy path: reminderSentAt set BEFORE email send (flag-first)", async () => {
    const user = seedUser({ email: "case6@test.com", name: "Case Six" });
    const trial = seedTrial({
      userId: user.id,
      stripeSubscriptionId: "sub_case6",
      tier: "plus",
      reminderSentAt: null,
    });

    // Capture flag state at the moment the email is sent.
    let flagAtEmailTime: Date | null = "uninitialized" as unknown as Date | null;
    sendTrialEndingReminderMock.mockImplementation(async () => {
      const row = store.membershipTrials.find((tr) => tr.id === trial.id)!;
      flagAtEmailTime = row.reminderSentAt;
    });

    const sub = makeSubscription({
      id: "sub_case6",
      customerId: user.stripeCustomerId!,
      status: "trialing",
      priceId: "price_plus_yearly",
      unitAmount: 2900,
      currency: "usd",
      interval: "month",
    });

    await handleTrialWillEnd(sub);

    // FLAG WAS SET BEFORE email send (this is the D1 invariant).
    expect(flagAtEmailTime).toBeInstanceOf(Date);
    expect(sendTrialEndingReminderMock).toHaveBeenCalledTimes(1);
    const args = sendTrialEndingReminderMock.mock.calls[0][0];
    expect(args.to).toBe("case6@test.com");
    expect(args.customerName).toBe("Case Six");
    expect(args.tierLabel).toBe("Plus");
    expect(args.chargeAmount).toBe("USD $29.00");
    expect(args.cancelUrl).toBe("https://packgoplay.test/membership?manage=1");

    expect(notifyOwnerMock).toHaveBeenCalled();
    expect(notifyAgentMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: "books", messageType: "observation" })
    );

    const after = store.membershipTrials.find((tr) => tr.id === trial.id)!;
    expect(after.reminderSentAt).toBeInstanceOf(Date);
  });

  it("Case 7a — email failure: flag stays set + URGENT notifyOwner + handler returns success (no throw)", async () => {
    const user = seedUser({ email: "case7@test.com" });
    const trial = seedTrial({
      userId: user.id,
      stripeSubscriptionId: "sub_case7",
      tier: "plus",
      reminderSentAt: null,
    });

    sendTrialEndingReminderMock.mockRejectedValueOnce(new Error("SMTP down"));

    const sub = makeSubscription({
      id: "sub_case7",
      customerId: user.stripeCustomerId!,
      status: "trialing",
      priceId: "price_plus_yearly",
    });

    // Must NOT throw — letting Stripe replay would not re-fire the email anyway.
    await expect(handleTrialWillEnd(sub)).resolves.toBeUndefined();

    // The flag was committed BEFORE the failed email — must still be set.
    const after = store.membershipTrials.find((tr) => tr.id === trial.id)!;
    expect(after.reminderSentAt).toBeInstanceOf(Date);

    // URGENT failure-alert notifyOwner fired with a recognizable subject.
    const urgentCall = notifyOwnerMock.mock.calls.find((c) => {
      const arg = c[0] as { title?: string };
      return arg?.title?.includes("[URGENT]") && arg?.title?.includes("AB-390");
    });
    expect(urgentCall).toBeDefined();
  });

  it("Case 7b — already-reminded user: idempotent no-op (no second email)", async () => {
    const user = seedUser({ email: "case7b@test.com" });
    const priorReminderAt = new Date(Date.now() - 86400_000);
    seedTrial({
      userId: user.id,
      stripeSubscriptionId: "sub_case7b",
      tier: "plus",
      reminderSentAt: priorReminderAt,
    });

    const sub = makeSubscription({
      id: "sub_case7b",
      customerId: user.stripeCustomerId!,
      status: "trialing",
      priceId: "price_plus_yearly",
    });

    await handleTrialWillEnd(sub);

    // No email was sent — handler short-circuited on the prior flag.
    expect(sendTrialEndingReminderMock).not.toHaveBeenCalled();
    // The original reminderSentAt is preserved (not stomped).
    const after = store.membershipTrials[0];
    expect(after.reminderSentAt?.getTime()).toBe(priorReminderAt.getTime());
  });
});
