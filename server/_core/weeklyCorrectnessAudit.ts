/**
 * weeklyCorrectnessAudit — customer-cockpit Phase6 D1「每週正確性稽核」
 * (dispatch-phase6.md 塊 D / roadmap-100.md Phase6 第4條).
 *
 * WHY: the customer card's cached aiSummary (customerProfiles.aiSummary) has
 * two DETERMINISTIC fields — actions（做了什麼）/ delivered（給了什麼）— computed
 * by customerFacts.ts's deriveActions/deriveDelivered from authoritative DB
 * rows (customOrders.quoteSentAt/depositPaidAt/…, aiQuotes.status,
 * invoices.status, customerInteractions.direction, customerDocuments). Because
 * the cache is written once (on refresh) and read many times, it can go STALE:
 * a customer pays a deposit, the order flips depositPaidAt, but the cached
 * card still says "目前還沒有交付任何文件給客人" until something happens to
 * re-trigger a refresh. This is exactly the ORD-2026-0003 case class the
 * roadmap references. This audit is the weekly backstop: recompute the two
 * deterministic fields fresh from gatherCustomerFacts and diff them
 * byte-for-byte against what the cache currently shows.
 *
 * wants / nextStep are NOT diffed here — they are LLM judgment calls (Haiku
 * picks the wording), not values genuinely re-derivable from facts alone, so
 * "recompute and diff" doesn't make sense for them (dispatch-phase6.md 塊 D
 * explicit ruling). Only actions/delivered — the two fields that ARE pure
 * functions of DB facts — are comparable this way.
 *
 * 材料性差異(dispatch-phase6.md 用語)全部由 deriveActions/deriveDelivered 的
 * 輸出文字承載:交付清單不符 = delivered 文字不同(報價/確認書/發票/email 附件
 * 任一筆對不上);金額/收款狀態不符 = delivered 或 actions 提到的訂單標籤
 * (單號、金額欄位)算出來的動詞不同(「收了訂金」有沒有出現);球在誰不符 =
 * actions 裡「回了 N 封信」的次數/日期跟目前的 outboundCount/outboundLastAt
 * 對不上(球在誰的方向由 gatherCustomerFacts 的 in/outbound 計數決定，這正是
 * deriveActions 唯一會用到的方向信號)。所以只比對 actions/delivered 兩個字串
 * 就完整涵蓋這三類材料性差異，不需要另外設計「球在誰」/「金額」獨立欄位。
 *
 * LLM usage: ZERO. This entire module is string comparison + SQL selects.
 * Never calls invokeLLM / runAgent / any agent entry point.
 *
 * Never emails the customer, never writes anything customer-facing — the ONLY
 * write this module performs is a single agentMessages insert (Jeff's internal
 * inbox) when a MATERIAL difference is found across the customer sample.
 * Zero differences → log at info level, post NOTHING (supervisor ruling,
 * dispatch-phase6.md 監工已代答的裁示 #2).
 *
 * Test/owner accounts (isTestOrOwnerAccount, testAccounts.ts) are EXCLUDED
 * from the audit sample — their aiSummary is often intentionally stale/fake
 * (0909 is the D2 canary's own target) and must never be reported as a real
 * data-integrity finding.
 */
import { createChildLogger } from "./logger";
import { isTestOrOwnerAccount } from "./testAccounts";
import {
  gatherCustomerFacts,
  deriveActions,
  deriveDelivered,
  EMPTY_FACTS,
  type CustomerFacts,
  type FactsScope,
} from "./customerFacts";
import type { AiSummary } from "./customerAiSummary";
import {
  gatherMessagesFailedWeeklyDelta,
  gatherQueueFailedCounts,
  gatherLlmCircuitStats,
  formatObservabilitySection,
} from "./observabilityCounters";

/**
 * gatherCustomerFacts NEVER throws — any internal error (bad row, transient
 * DB blip, schema drift) is swallowed inside customerFacts.ts and degrades to
 * EMPTY_FACTS (customerFacts.ts's own try/catch). That means the try/catch
 * wrapped around gatherCustomerFacts in runWeeklyCorrectnessAudit below can
 * never actually observe a thrown error from a facts-gathering fault — so
 * without this check, a customer whose fact-gathering silently degraded would
 * get diffed against EMPTY_FACTS as if that were their real, current state.
 * For any customer with a non-empty cached summary, EMPTY_FACTS is never the
 * genuine truth (it would mean "this customer has never had a single order,
 * quote, invoice, doc, or interaction" — contradicted by the very existence
 * of a real cached summary), so a live-facts result matching EMPTY_FACTS is
 * itself the signal that gathering degraded, not that the customer went
 * silent. Detected here so the executor can skip diffing (which would just be
 * false-positive noise) and count it separately instead (dispatch-phase6.md
 * adversarial review finding — see runWeeklyCorrectnessAudit for how this is
 * surfaced).
 *
 * Exported for tests. Deliberately a plain field-by-field compare (not
 * JSON.stringify) so it stays correct if CustomerFacts ever gains a field
 * whose EMPTY_FACTS default isn't trivially comparable by string equality.
 */
export function isEmptyFacts(facts: CustomerFacts): boolean {
  return (
    facts.orders.length === 0 &&
    facts.quotes.length === 0 &&
    facts.invoices.length === 0 &&
    facts.deliveredDocs.length === 0 &&
    facts.outboundCount === 0 &&
    facts.outboundLastAt === null &&
    facts.inboundCount === 0 &&
    facts.inboundLastAt === null &&
    facts.confirmedBookingCount === 0
  );
}

const log = createChildLogger({ module: "weeklyCorrectnessAudit" });

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Active" mirrors runCustomerSummaryScan's window: customers with any
 *  interaction in the last N days. A customer with no recent activity has no
 *  reason for their cached summary to have drifted, so auditing them weekly
 *  would just be noise. */
const DEFAULT_ACTIVE_DAYS = 30;
/** Cap the sample so one run can't balloon (one-person-agency scale; mirrors
 *  the 300-row cap in runCustomerSummaryScan). */
const DEFAULT_SAMPLE_LIMIT = 300;
/** Cap how many mismatching customers are listed in the single digest body. */
const DIGEST_CAP = 20;

// ── pure diff logic ─────────────────────────────────────────────────────────

export type MismatchField = "actions" | "delivered";

export interface FieldMismatch {
  field: MismatchField;
  cached: string;
  recomputed: string;
}

export interface CustomerAuditInput {
  profileId: number;
  email: string | null;
  /** The cached summary currently shown on the card (null = never computed —
   *  not a mismatch, just nothing to compare yet). */
  cachedSummary: AiSummary | null;
  /** Freshly gathered facts for this same customer, right now. */
  facts: CustomerFacts;
}

export interface CustomerAuditResult {
  profileId: number;
  email: string | null;
  mismatches: FieldMismatch[];
  /** true when live facts came back as EMPTY_FACTS while a real (non-empty
   *  intent) cached summary exists — this means gatherCustomerFacts itself
   *  degraded for this customer (its own internal try/catch swallowed an
   *  error), NOT that the diff logic found a genuine mismatch. Excluded from
   *  ordinary mismatch counting/digest text; surfaced as its own signal by
   *  aggregateAuditResults so it can't masquerade as "refresh the card and
   *  it'll fix itself" (dispatch-phase6.md adversarial review finding). */
  factsGatheringDegraded: boolean;
}

/**
 * Pure: recompute actions/delivered from live facts and diff them against the
 * cached summary's corresponding fields. A null cachedSummary (never computed
 * yet) is not a mismatch — there is nothing stale to report, the lazy-on-open
 * path will fill it the first time Jeff opens the card.
 *
 * If live facts come back as EMPTY_FACTS while a cached summary already
 * exists, this is flagged as factsGatheringDegraded and NOT diffed —
 * gatherCustomerFacts degrading into its own empty-fallback is not the same
 * thing as "this customer's real facts are genuinely empty" (a customer with
 * a cached summary, by definition, has already had at least one gathering
 * pass succeed in the past). Diffing against EMPTY_FACTS here would just
 * manufacture a false-positive "everything is stale" mismatch. Exported for
 * tests.
 */
export function diffCustomerSummary(input: CustomerAuditInput): CustomerAuditResult {
  const mismatches: FieldMismatch[] = [];
  let factsGatheringDegraded = false;
  if (input.cachedSummary) {
    if (isEmptyFacts(input.facts)) {
      factsGatheringDegraded = true;
    } else {
      const recomputedActions = deriveActions(input.facts);
      const recomputedDelivered = deriveDelivered(input.facts);
      if (recomputedActions !== input.cachedSummary.actions) {
        mismatches.push({
          field: "actions",
          cached: input.cachedSummary.actions,
          recomputed: recomputedActions,
        });
      }
      if (recomputedDelivered !== input.cachedSummary.delivered) {
        mismatches.push({
          field: "delivered",
          cached: input.cachedSummary.delivered,
          recomputed: recomputedDelivered,
        });
      }
    }
  }
  return { profileId: input.profileId, email: input.email, mismatches, factsGatheringDegraded };
}

const FIELD_LABEL: Record<MismatchField, string> = {
  actions: "做了什麼",
  delivered: "給了什麼",
};

/** Pure: format the single digest body posted to agentMessages when >=1
 *  customer has >=1 mismatch and/or >=1 customer's facts-gathering degraded.
 *  The two are kept in visibly SEPARATE sections — a degraded-gathering
 *  customer is never folded into the "卡片跟系統事實對不上,重新整理就會更新"
 *  mismatch text, because refreshing does NOT fix a gatherCustomerFacts fault
 *  (dispatch-phase6.md adversarial review finding: folding them together
 *  would misdirect Jeff into thinking a refresh click fixes a systemic bug).
 *
 *  `observabilitySection` (Wave1 Block C, optional/backward-compatible): when
 *  provided AND non-empty, it is appended as one more `---`-separated section
 *  AFTER the mismatches/degraded sections — even when those two are both
 *  empty (no mismatches, no degraded rows), in which case the observability
 *  section is returned alone with no leading separator/blank line
 *  (parts.join(...) on an empty array is "", and naively concatenating a
 *  leading "\n\n---\n\n" onto that would leave a stray separator with
 *  nothing above it). Omitting the argument, OR passing an empty string,
 *  both preserve the exact pre-Wave1-Block-C output byte for byte — every
 *  existing caller/test that doesn't pass it is unaffected, and a
 *  hypothetical future caller that ends up with an empty section (e.g. a
 *  formatObservabilitySection regression) degrades to the same clean output
 *  instead of leaving a dangling "---" separator with nothing after it
 *  (T6 adversarial-review finding — see the falsy check below, not strict
 *  `=== undefined`). Exported for tests. */
export function formatAuditDigest(results: CustomerAuditResult[], observabilitySection?: string): string {
  const withMismatches = results.filter((r) => r.mismatches.length > 0);
  const degraded = results.filter((r) => r.factsGatheringDegraded);

  const shown = withMismatches.slice(0, DIGEST_CAP);
  const lines = shown.flatMap((r) =>
    r.mismatches.map(
      (m) =>
        `${r.email ?? `profile #${r.profileId}`} · ${FIELD_LABEL[m.field]}:卡片顯示「${m.cached || "(空)"}」,系統事實其實是「${m.recomputed || "(空)"}」`,
    ),
  );
  const extra = withMismatches.length - shown.length;

  const parts: string[] = [];
  if (withMismatches.length > 0) {
    parts.push(
      `每週正確性稽核抓到 ${withMismatches.length} 位客人的卡片跟系統事實對不上,卡片顯示的可能是舊資料。點開對應客人重新整理摘要就會更新。\n\n${lines.join("\n")}` +
        (extra > 0 ? `\n…還有 ${extra} 位未列出` : ""),
    );
  }
  if (degraded.length > 0) {
    const degradedShown = degraded.slice(0, DIGEST_CAP);
    const degradedLines = degradedShown.map(
      (r) => `${r.email ?? `profile #${r.profileId}`}`,
    );
    const degradedExtra = degraded.length - degradedShown.length;
    parts.push(
      `另外 ${degraded.length} 位客人本次稽核抓不到任何系統事實(gatherCustomerFacts 疑似出錯,不是卡片真的過期)——這不是「重新整理就會更新」,是資料抓取本身可能壞了,建議直接查系統/DB,不是點開客人卡片:\n\n${degradedLines.join("\n")}` +
        (degradedExtra > 0 ? `\n…還有 ${degradedExtra} 位未列出` : ""),
    );
  }
  const base = parts.join("\n\n---\n\n");
  // Falsy check (not strict `=== undefined`): an explicitly-passed empty
  // string carries no content to append, so it must degrade the same way an
  // omitted argument does — otherwise a non-empty base would end up with a
  // dangling "\n\n---\n\n" separator followed by nothing.
  if (!observabilitySection) return base;
  // base === "" happens when neither section had content (parts=[]) — attach
  // the observability section directly with no leading separator, rather
  // than short-circuiting past it or leaving a stray "---" above nothing.
  return base ? `${base}\n\n---\n\n${observabilitySection}` : observabilitySection;
}

/** Pure: priority scales with how many customers have a diff (dispatch:
 *  「priority 按差異數」). A handful is a normal nudge; a wide-spread drift
 *  (many customers) is worth a high-priority look, since it likely signals a
 *  systemic bug (a refresh hook stopped firing) rather than one-off staleness. */
export function priorityForMismatchCount(mismatchingCustomerCount: number): "normal" | "high" {
  return mismatchingCustomerCount >= 5 ? "high" : "normal";
}

export interface AuditAggregateResult {
  /** Customers actually compared (cachedSummary was present). */
  compared: number;
  /** Customers with >=1 field mismatch. */
  mismatching: number;
  /** Customers whose facts-gathering itself degraded to EMPTY_FACTS despite
   *  having a real cached summary — a distinct signal from `mismatching`,
   *  see diffCustomerSummary/formatAuditDigest for why these are never
   *  folded together. */
  degraded: number;
  /** Set when a card should be posted (mismatching > 0 or degraded > 0).
   *  Undefined otherwise. */
  card?: { title: string; body: string; priority: "normal" | "high" };
}

/** Pure: turn per-customer diff results into the single card decision (or no
 *  card). Exported for tests — this is the "aggregation across multiple
 *  customers" logic the dispatch calls out explicitly.
 *
 * A non-zero `degraded` count posts a card even when `mismatching` is 0 —
 * silent facts-gathering degradation is itself worth a look, it must never
 * be invisible just because it produced no (comparable) mismatches. Priority
 * escalates to "high" if EITHER count crosses its own threshold — a systemic
 * gatherCustomerFacts fault (many customers degraded) is exactly the kind of
 * "future schema drift" scenario the adversarial review flagged as worth a
 * high-priority look, same reasoning priorityForMismatchCount already applies
 * to ordinary mismatches.
 *
 * `observabilitySection` (Wave1 Block C, optional/backward-compatible): the
 * ONLY effect this has on the "post a card or not" decision. Omitted, OR
 * provided as an empty string (falsy check, not strict `=== undefined` — same
 * reasoning as formatAuditDigest's own falsy check, so an empty section can
 * never manufacture an empty-bodied "一切正常" card), → behavior is
 * byte-for-byte unchanged, including the zero-mismatch-zero-degraded →
 * no-card case. Provided non-empty AND mismatching===0 && degraded===0 → a
 * card is still produced (fixed "一切正常"
 * title, fixed "normal" priority — deliberately NOT run through
 * priorityForMismatchCount, and NOT influenced by any "⚠ " markers inside
 * observabilitySection's own text: a queue backlog or LLM circuit trip is
 * worth a look, but it is not itself a correctness-audit finding, so it must
 * never silently escalate this card's priority) so the three observability
 * lines actually reach Jeff instead of being computed and discarded. When
 * mismatching/degraded ARE non-zero, the existing priority algorithm below is
 * untouched — observabilitySection only ever adds a trailing section to
 * card.body via formatAuditDigest. */
export function aggregateAuditResults(
  results: CustomerAuditResult[],
  observabilitySection?: string,
): AuditAggregateResult {
  const compared = results.length;
  const withMismatches = results.filter((r) => r.mismatches.length > 0);
  const mismatching = withMismatches.length;
  const degraded = results.filter((r) => r.factsGatheringDegraded).length;

  if (mismatching === 0 && degraded === 0) {
    if (!observabilitySection) return { compared, mismatching: 0, degraded: 0 };
    return {
      compared,
      mismatching: 0,
      degraded: 0,
      card: {
        title: "每週正確性稽核:一切正常",
        body: formatAuditDigest(results, observabilitySection),
        priority: "normal",
      },
    };
  }

  const titleParts: string[] = [];
  if (mismatching > 0) titleParts.push(`${mismatching} 位客人的卡片跟系統事實對不上`);
  if (degraded > 0) titleParts.push(`${degraded} 位客人資料抓取疑似出錯`);

  return {
    compared,
    mismatching,
    degraded,
    card: {
      title: `每週正確性稽核:${titleParts.join("、")}`,
      body: formatAuditDigest(results, observabilitySection),
      priority:
        priorityForMismatchCount(mismatching) === "high" || priorityForMismatchCount(degraded) === "high"
          ? "high"
          : "normal",
    },
  };
}

// ── IO ──────────────────────────────────────────────────────────────────────

export type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

export interface AuditCandidateRow {
  id: number;
  email: string | null;
  userId: number | null;
  aiSummary: AiSummary | null;
}

/**
 * Read-only: active customers (recent interaction within activeDays), minus
 * test/owner accounts. Exported so the executor's DB-touching selection step
 * is separated from the pure diff/aggregate logic above.
 */
async function selectActiveAuditCandidates(
  db: Db,
  activeDays: number,
  limit: number,
): Promise<AuditCandidateRow[]> {
  const { customerProfiles } = await import("../../drizzle/schema");
  const { gte, desc } = await import("drizzle-orm");
  const since = new Date(Date.now() - activeDays * DAY_MS);

  const rows = (await db
    .select({
      id: customerProfiles.id,
      email: customerProfiles.email,
      userId: customerProfiles.userId,
      aiSummary: customerProfiles.aiSummary,
    })
    .from(customerProfiles)
    .where(gte(customerProfiles.lastInteractionAt, since))
    .orderBy(desc(customerProfiles.lastInteractionAt))
    .limit(limit)) as Array<{
    id: number;
    email: string | null;
    userId: number | null;
    aiSummary: unknown;
  }>;

  // A6 排除 helper — 測試/業主帳號絕不進稽核樣本(0909 是 D2 canary 自己的
  // 靶,拿它的資料當「真客人資料跟事實對不上」的稽核發現是誤報)。
  return rows
    .filter((r) => !isTestOrOwnerAccount(r.email ?? undefined, r.id))
    .map((r) => ({
      id: r.id,
      email: r.email,
      userId: r.userId,
      aiSummary: (r.aiSummary as AiSummary | null) ?? null,
    }));
}

export interface WeeklyCorrectnessAuditResult {
  compared: number;
  mismatching: number;
  /** Customers whose facts-gathering degraded to EMPTY_FACTS despite having a
   *  real cached summary — see CustomerAuditResult.factsGatheringDegraded. */
  degraded: number;
  posted: boolean;
}

/**
 * Weekly executor: for every active, non-test customer, recompute
 * actions/delivered from live facts and diff against the cached aiSummary.
 * Zero mismatches → log info, post nothing. Any mismatches → ONE agentMessages
 * card aggregating all of them (never one card per customer — dispatch:
 * 彙總成一張卡). One customer's facts-gathering failure never aborts the scan.
 *
 * LLM usage: zero — gatherCustomerFacts/deriveActions/deriveDelivered are all
 * pure DB reads + string derivation, no invokeLLM anywhere in this path.
 */
/** Redis heartbeat key: last time the weekly correctness audit RAN to
 *  completion (success), regardless of whether it found any diff. Lets the
 *  supervisor tell「跑了、沒事」(key advanced this week) apart from「根本沒跑」
 *  (key stale / missing) — a zero-diff run otherwise leaves no trace at all. */
export const WEEKLY_AUDIT_HEARTBEAT_KEY = "lastWeeklyAuditAt";

/** Fire-forget heartbeat write. A Redis blip must never fail the audit itself
 *  (the audit's real output is the card / clean log), so a failed write only
 *  warns. Value = ISO timestamp (human-readable when the supervisor inspects). */
async function recordAuditHeartbeat(now: Date): Promise<void> {
  try {
    const { redis } = await import("../redis");
    await redis.set(WEEKLY_AUDIT_HEARTBEAT_KEY, now.toISOString());
    log.info({ at: now.toISOString() }, "[weeklyCorrectnessAudit] heartbeat recorded");
  } catch (err) {
    log.warn(
      { err: (err as Error).message },
      "[weeklyCorrectnessAudit] heartbeat write failed (non-fatal)",
    );
  }
}

export async function runWeeklyCorrectnessAudit(
  db: Db,
  opts?: { activeDays?: number; sampleLimit?: number; now?: Date },
): Promise<WeeklyCorrectnessAuditResult> {
  const activeDays = opts?.activeDays ?? DEFAULT_ACTIVE_DAYS;
  const sampleLimit = opts?.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  const now = opts?.now ?? new Date();

  const candidates = await selectActiveAuditCandidates(db, activeDays, sampleLimit);

  const results: CustomerAuditResult[] = [];
  for (const c of candidates) {
    try {
      // Same scope rule as resolveSummaryScope (customerAiSummary.ts): a
      // REGISTERED customer's cache was generated with {userId} (real
      // bookings/membership context), so it must be recomputed the same way —
      // auditing with {profileId} for a registered customer would silently
      // zero out confirmedBookingCount (that block requires userId != null)
      // and manufacture a false-positive mismatch on every registered card.
      const scope: FactsScope = c.userId != null ? { userId: c.userId } : { profileId: c.id };
      const facts = await gatherCustomerFacts(scope);
      results.push(
        diffCustomerSummary({
          profileId: c.id,
          email: c.email,
          cachedSummary: c.aiSummary,
          facts,
        }),
      );
    } catch (err) {
      log.warn(
        { profileId: c.id, err: (err as Error).message },
        "[weeklyCorrectnessAudit] one customer failed — continuing",
      );
    }
  }

  // Wave1 Block C — three independent, never-throwing observability
  // collectors, folded into a fixed three-line digest section that rides
  // along with the weekly card. Run in parallel (no ordering dependency
  // between them); each degrades to its own "couldn't read" state on
  // failure rather than throwing, so one bad collector never blocks the
  // other two or the audit itself.
  const [messagesFailedDelta, queueFailedCounts, llmCircuitStats] = await Promise.all([
    gatherMessagesFailedWeeklyDelta(db, now),
    gatherQueueFailedCounts(),
    gatherLlmCircuitStats(now),
  ]);
  const observabilitySection = formatObservabilitySection({
    messagesFailedDelta,
    queueFailedCounts,
    llmCircuitStats,
  });

  const aggregate = aggregateAuditResults(results, observabilitySection);
  // 心跳:跑完就記(不論有沒有差異),監工才能區分「跑了、沒事」與「根本沒跑」。
  await recordAuditHeartbeat(now);
  if (!aggregate.card) {
    // Defensive fallback only — formatObservabilitySection always returns a
    // non-empty string (its three formatXLine helpers never return ""), so
    // aggregateAuditResults is passed a defined observabilitySection on
    // every call here and should therefore ALWAYS produce a card now (the
    // "zero differences → post nothing" behavior is retired: Wave1 Block C
    // deliberately wants a card every Monday so the observability lines
    // actually reach Jeff). This branch is kept as a safety net in case a
    // future change to the collectors above somehow yields an unusable
    // section — better to log+return cleanly than crash on an unexpected
    // `undefined` card downstream.
    log.info(
      { compared: aggregate.compared, mismatching: 0, degraded: 0 },
      "[weeklyCorrectnessAudit] zero differences and no observability section — no card posted (should not normally happen post-Wave1-Block-C)",
    );
    return { compared: aggregate.compared, mismatching: 0, degraded: 0, posted: false };
  }

  const { agentMessages } = await import("../../drizzle/schema");
  await db.insert(agentMessages).values({
    agentName: "correctness-audit",
    senderRole: "agent",
    messageType: "proposal",
    title: aggregate.card.title,
    body: aggregate.card.body,
    priority: aggregate.card.priority,
  });
  log.info(
    { compared: aggregate.compared, mismatching: aggregate.mismatching, degraded: aggregate.degraded },
    "[weeklyCorrectnessAudit] mismatches and/or degraded facts-gathering found — one card posted",
  );
  return {
    compared: aggregate.compared,
    mismatching: aggregate.mismatching,
    degraded: aggregate.degraded,
    posted: true,
  };
}
