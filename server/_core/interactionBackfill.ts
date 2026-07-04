/**
 * interactionBackfill — customer-cockpit Phase6 B4「存量回填」.
 *
 * One-time admin endpoint, same dry_run/confirm two-stage shape as
 * caseFileImport.ts's importCaseFile. Runs B1's DETERMINISTIC-ONLY rules
 * (① thread inheritance, ② exactly-one-in-progress-order) over EXISTING
 * customerInteractions rows that currently have customOrderId IS NULL.
 *
 * Explicitly NO LLM call anywhere in this file (dispatch-phase6.md 塊B B4:
 * "不跑 LLM,只做確定性歸屬") — this is a one-time batch job touching
 * potentially thousands of historical rows; rule ③ (LLM disambiguation)
 * is reserved for the live inbound-mail path (gmailPipeline.ts) where
 * per-message LLM cost is bounded by real mail volume. Reuses the exact
 * same decideInteractionOrderAssignment pure function as B1/threadFiling.ts
 * so the ①+② logic can never drift between the live path and this backfill
 * (see that module's header for why it was extracted).
 *
 * 鐵律:不確定 = NULL,絕不猜 — enforced by only ever calling
 * decideInteractionOrderAssignment WITHOUT an llmPick, so any profile with
 * more than one in-progress order and no thread-inheritance hit always
 * resolves to NULL here, never a guess.
 *
 * Test/owner accounts (isTestOrOwnerAccount, testAccounts.ts) are EXCLUDED
 * from this backfill by default: 0909 (profileId 2760017) is a synthetic
 * E2E test customer, and Jeff's own personal card (2730002) is not a real
 * customer relationship — backfilling either would mix synthetic history
 * into what's meant to be a real-customer data migration. See
 * excludeTestAccounts option below for how a caller can opt out of the
 * default (kept default-true; B4's named acceptance case for 0909 is
 * "excluded or at least noted" — this implementation excludes).
 */
import { and, eq, isNull, isNotNull, inArray, asc } from "drizzle-orm";
import { createChildLogger } from "./logger";
import { isTestOrOwnerAccount } from "./testAccounts";
import { decideInteractionOrderAssignment } from "./interactionOrderAssignment";
import type { OrderCandidate } from "./interactionOrderAssignment";

const log = createChildLogger({ module: "interactionBackfill" });

// ────────────────────────────────────────────────────────────────────────
// Pure planning function — no DB, no LLM. Given the raw rows for ONE
// profile, decide every row's customOrderId assignment.
// ────────────────────────────────────────────────────────────────────────

export interface BackfillInteractionRow {
  id: number;
  gmailThreadId: string | null;
  /** Used only to order rows within a thread so inheritance flows from an
   *  earlier-assigned message to a later NULL one, never the reverse. */
  createdAt: Date;
}

export interface BackfillRowDecision {
  interactionId: number;
  customOrderId: number | null;
  reason: ReturnType<typeof decideInteractionOrderAssignment>["reason"];
}

export interface ProfileBackfillInput {
  profileId: number;
  /** All customerInteractions rows for this profile with customOrderId IS NULL. */
  nullRows: BackfillInteractionRow[];
  /**
   * gmailThreadId → customOrderId for rows that ALREADY carry a customOrderId
   * (i.e. rule ①'s "prior interaction on the same thread already assigned").
   * Caller supplies this pre-computed so this function stays pure/sync.
   */
  threadOrderMap: Map<string, number>;
  /** Customer's in-progress orders (caller has already excluded completed/cancelled). */
  candidates: OrderCandidate[];
}

export interface BackfillPlanStats {
  totalNullRows: number;
  assignedCount: number;
  staysNullCount: number;
  byReason: Record<string, number>;
}

export interface ProfileBackfillPlan {
  profileId: number;
  decisions: BackfillRowDecision[];
  assignedCount: number;
  staysNullCount: number;
}

/**
 * Build the per-row assignment plan for one profile's NULL rows. Pure,
 * synchronous, no LLM. Rows are processed in createdAt order so that a row
 * within THIS SAME backfill batch that gets assigned via rule ② can also
 * seed thread-inheritance for a later row on the same thread (e.g. two old
 * emails on one thread, both NULL today, both belong to the customer's one
 * in-progress order — the first resolves via ②, the second then inherits
 * via ① from the first instead of needing its own ② check, which is the
 * same outcome either way but keeps the threadOrderMap accurate as we go).
 */
export function buildProfileBackfillPlan(input: ProfileBackfillInput): ProfileBackfillPlan {
  const threadOrderMap = new Map(input.threadOrderMap);
  const sortedRows = [...input.nullRows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const decisions: BackfillRowDecision[] = [];
  let assignedCount = 0;
  let staysNullCount = 0;

  for (const row of sortedRows) {
    const priorThreadOrderId =
      row.gmailThreadId != null ? threadOrderMap.get(row.gmailThreadId) ?? null : null;

    // No llmPick, ever — deterministic-only per B4's spec (rule ③ is
    // reserved for the live gmailPipeline.ts path).
    const decision = decideInteractionOrderAssignment({
      priorThreadOrderId,
      candidates: input.candidates,
    });

    decisions.push({
      interactionId: row.id,
      customOrderId: decision.customOrderId,
      reason: decision.reason,
    });

    if (decision.customOrderId != null) {
      assignedCount++;
      if (row.gmailThreadId) threadOrderMap.set(row.gmailThreadId, decision.customOrderId);
    } else {
      staysNullCount++;
    }
  }

  return { profileId: input.profileId, decisions, assignedCount, staysNullCount };
}

/** Aggregate a set of per-profile plans into the dry_run summary statistics. */
export function summarizeBackfillPlans(plans: ProfileBackfillPlan[]): BackfillPlanStats {
  const byReason: Record<string, number> = {};
  let totalNullRows = 0;
  let assignedCount = 0;
  let staysNullCount = 0;

  for (const plan of plans) {
    for (const d of plan.decisions) {
      totalNullRows++;
      byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
      if (d.customOrderId != null) assignedCount++;
      else staysNullCount++;
    }
  }

  return { totalNullRows, assignedCount, staysNullCount, byReason };
}

// ────────────────────────────────────────────────────────────────────────
// runInteractionBackfill — the only function that touches the DB.
// dry_run: reads everything, writes nothing, returns stats.
// confirm: reads, plans, then UPDATEs each assigned row's customOrderId.
// ────────────────────────────────────────────────────────────────────────

export interface RunBackfillOptions {
  /** Default true — see module header. Pass false only for a deliberate,
   *  explicitly-requested run that intentionally includes test/owner cards. */
  excludeTestAccounts?: boolean;
}

export interface RunBackfillResult {
  status: "ok" | "error";
  mode: "dry_run" | "confirm";
  stats?: BackfillPlanStats;
  profilesConsidered?: number;
  profilesExcludedAsTest?: number;
  updatedCount?: number;
  error?: string;
}

export async function runInteractionBackfill(
  mode: "dry_run" | "confirm",
  options: RunBackfillOptions = {},
): Promise<RunBackfillResult> {
  const excludeTestAccounts = options.excludeTestAccounts ?? true;

  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { status: "error", mode, error: "no DB connection" };

    const { customerInteractions } = await import("../../drizzle/schema");
    const { listCustomOrdersByProfile } = await import("../db/customOrder");

    // 1. All NULL-customOrderId rows, across all profiles.
    const nullRowsRaw = await db
      .select({
        id: customerInteractions.id,
        customerProfileId: customerInteractions.customerProfileId,
        gmailThreadId: customerInteractions.gmailThreadId,
        createdAt: customerInteractions.createdAt,
      })
      .from(customerInteractions)
      .where(isNull(customerInteractions.customOrderId));

    if (nullRowsRaw.length === 0) {
      return {
        status: "ok",
        mode,
        stats: { totalNullRows: 0, assignedCount: 0, staysNullCount: 0, byReason: {} },
        profilesConsidered: 0,
        profilesExcludedAsTest: 0,
        ...(mode === "confirm" ? { updatedCount: 0 } : {}),
      };
    }

    // 2. Group by profile.
    const byProfile = new Map<number, BackfillInteractionRow[]>();
    for (const r of nullRowsRaw) {
      const list = byProfile.get(r.customerProfileId) ?? [];
      list.push({ id: r.id, gmailThreadId: r.gmailThreadId, createdAt: r.createdAt });
      byProfile.set(r.customerProfileId, list);
    }

    let profilesExcludedAsTest = 0;
    const profileIds = [...byProfile.keys()];
    const activeProfileIds: number[] = [];
    for (const pid of profileIds) {
      if (excludeTestAccounts && isTestOrOwnerAccount(undefined, pid)) {
        profilesExcludedAsTest++;
        continue;
      }
      activeProfileIds.push(pid);
    }

    if (activeProfileIds.length === 0) {
      return {
        status: "ok",
        mode,
        stats: { totalNullRows: 0, assignedCount: 0, staysNullCount: 0, byReason: {} },
        profilesConsidered: 0,
        profilesExcludedAsTest,
        ...(mode === "confirm" ? { updatedCount: 0 } : {}),
      };
    }

    // 3. For each active profile: already-assigned sibling threads (rule ①
    // input) + in-progress order candidates (rule ② input).
    // ORDER BY id ASC so the `if (!m.has(...))` first-wins guard below is
    // deterministic (earliest-assigned order wins) instead of depending on
    // unspecified MySQL row order — matters when a thread's sibling rows carry
    // conflicting customOrderId values. Matches gmailPipeline.ts's tiebreak.
    const alreadyAssignedRows = await db
      .select({
        customerProfileId: customerInteractions.customerProfileId,
        gmailThreadId: customerInteractions.gmailThreadId,
        customOrderId: customerInteractions.customOrderId,
      })
      .from(customerInteractions)
      .where(
        and(
          inArray(customerInteractions.customerProfileId, activeProfileIds),
          isNotNull(customerInteractions.customOrderId),
        ),
      )
      .orderBy(asc(customerInteractions.id));

    const threadOrderMapByProfile = new Map<number, Map<string, number>>();
    for (const r of alreadyAssignedRows) {
      if (r.customOrderId == null || !r.gmailThreadId) continue;
      const m = threadOrderMapByProfile.get(r.customerProfileId) ?? new Map<string, number>();
      if (!m.has(r.gmailThreadId)) m.set(r.gmailThreadId, r.customOrderId);
      threadOrderMapByProfile.set(r.customerProfileId, m);
    }

    const plans: ProfileBackfillPlan[] = [];
    for (const profileId of activeProfileIds) {
      const nullRows = byProfile.get(profileId) ?? [];
      const inProgress = await listCustomOrdersByProfile(profileId, { excludeTerminal: true });
      const candidates: OrderCandidate[] = inProgress.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        category: o.category,
        destination: o.destination,
      }));
      plans.push(
        buildProfileBackfillPlan({
          profileId,
          nullRows,
          threadOrderMap: threadOrderMapByProfile.get(profileId) ?? new Map(),
          candidates,
        }),
      );
    }

    const stats = summarizeBackfillPlans(plans);

    if (mode === "dry_run") {
      return {
        status: "ok",
        mode,
        stats,
        profilesConsidered: activeProfileIds.length,
        profilesExcludedAsTest,
      };
    }

    // confirm — write every assigned row. NULL-staying rows need no write
    // (they're already NULL).
    let updatedCount = 0;
    for (const plan of plans) {
      for (const d of plan.decisions) {
        if (d.customOrderId == null) continue;
        try {
          await db
            .update(customerInteractions)
            .set({ customOrderId: d.customOrderId })
            .where(
              and(
                eq(customerInteractions.id, d.interactionId),
                isNull(customerInteractions.customOrderId),
              ),
            );
          updatedCount++;
        } catch (err) {
          log.warn(
            { err: err instanceof Error ? err.message : String(err), interactionId: d.interactionId },
            "[interactionBackfill] one row failed to update (continuing)",
          );
        }
      }
    }

    return {
      status: "ok",
      mode,
      stats,
      profilesConsidered: activeProfileIds.length,
      profilesExcludedAsTest,
      updatedCount,
    };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[interactionBackfill] run failed",
    );
    return { status: "error", mode, error: err instanceof Error ? err.message : String(err) };
  }
}
