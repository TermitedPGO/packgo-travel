/**
 * customerAiSummary (批3 M3) — the real AI summary that replaces the rule-based
 * deriveAiSummary for the customer card. Produces four business-level fields:
 *   wants / actions / delivered / nextStep
 * from this customer's real data (對話 + 訂單 + 詢問 + 報價 + 文件內文), with the
 * shared Jeff-tone + red-line system prompt.
 *
 * Jeff 拍板 (proposal §五.1 + Stage 2): 背景算 + 快取 + 重算鈕. The cache lives on
 * customerProfiles.aiSummary (+ aiSummaryAt). The card reads the cache (秒開); a
 * stale/missing cache lazily recomputes on open; the refresh button forces it;
 * a cron warms recently-active customers.
 *
 * 紅線 (encoded in SUMMARY_SYSTEM + by storing only the 4 fields):
 *   - only 搬運 the provided facts, never invent prices/dates (admin_ai_boundary)
 *   - supplier cost / 同業價 never appear (internal numbers)
 *   - 訂金 ≠ 營收 judged from DB fields, not by the model
 *   - no PII (passport/DOB) in the output — the cache stores only business text
 *   - Jeff tone: 口語、不破折號、不打勾
 *
 * The model is Haiku (fast + cheap) — this is a 搬運 task, not deep reasoning.
 */
import { invokeLLM } from "./llm";
import { getDb } from "../db";
import { createChildLogger } from "./logger";
import {
  buildCustomerChatContext,
  buildGuestChatContext,
} from "./customerChatContext";
import {
  gatherCustomerFacts,
  deriveActions,
  deriveDelivered,
  formatFactsLedger,
  todayLA,
} from "./customerFacts";

const log = createChildLogger({ module: "customerAiSummary" });

export interface AiSummary {
  wants: string;
  actions: string;
  delivered: string;
  nextStep: string;
}

export type SummaryScope = { userId: number } | { profileId: number };

/** How long a cached summary stays "fresh" absent any new activity. */
export const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;

const HAIKU = "claude-haiku-4-5";

// 「做了什麼 / 給了什麼」改由 customerFacts 從系統時間戳算出(搬運不生成),不再
// 經 LLM。這裡只請 Haiku 出兩個「判斷」欄位:wants(客人想要什麼)和 nextStep
// (下一步)。事實清單會一起餵進去墊底,所以 nextStep 不會叫你做已經做完的事
// (Jenny 的「待交付」就是 LLM 沒讀時間戳腦補出來的)。
const SUMMARY_SYSTEM = `你是 Jeff 的 PACK&GO(美國旅行社)後台助理,只服務 Jeff 本人(admin 內部)。
你會拿到這位客人的真實資料,以及一份「系統事實」清單(已寄報價、已收款、已出確認書等真實記錄)。
你的工作只有兩件:判斷客人現在想要什麼(wants),以及下一步該做什麼(nextStep)。

鐵則:
1. 只根據提供的資料判斷,不杜撰價格、日期、行程。資料沒有就說「目前看不出來」,絕不腦補。
2. nextStep 必須跟「系統事實」一致:事實說報價已寄,就不要再叫 Jeff 寄報價;
   該催款就催款,該等客人回就說等回覆。給一句可執行的下一步。
3. 口語、自然、簡短,像跟同事講話。不要用破折號,不要用打勾符號,不要官方腔。
4. 供應商成本、同業價、護照號、生日這類內部/個資絕對不要出現。
5. 訂金不等於營收(出發前的訂金是代管),談錢照資料寫,不要自己改規則。`;

const SUMMARY_SCHEMA = {
  name: "customer_summary",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      wants: { type: "string", description: "客人現在想要什麼,一兩句" },
      nextStep: {
        type: "string",
        description: "下一步該做什麼,一句可執行,且要跟系統事實一致",
      },
    },
    required: ["wants", "nextStep"],
  },
  strict: true,
};

/** Pure user-prompt builder — exported for tests. Leads with today's date in
 *  the business timezone so year-less dates (「12/19」) are grounded to the
 *  nearest FUTURE year, never a hallucinated past one (2026-07-02 real case:
 *  a 2026 mail about 12/19 was summarized as 2024/12/19). */
export function buildSummaryUserPrompt(
  ledger: string,
  context: string,
  today: string = todayLA(),
): string {
  return `今天日期(美西):${today}。客人沒寫年份的日期,一律按今天日期推最近的未來年份,不要編成過去的年份。\n\n下面是這位客人的真實資料。請只判斷 wants 與 nextStep 兩欄,nextStep 必須跟「系統事實」一致。\n\n${ledger}\n\n${context}`;
}

/** Parse + sanitize the LLM's structured output into an AiSummary. */
export function parseSummaryResult(rawContent: unknown): AiSummary {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(typeof rawContent === "string" ? rawContent : "{}");
  } catch {
    obj = {};
  }
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    wants: s(obj.wants),
    actions: s(obj.actions),
    delivered: s(obj.delivered),
    nextStep: s(obj.nextStep),
  };
}

/**
 * Build the summary. The two FACTUAL fields (actions / delivered) are computed
 * deterministically from system facts — never narrated by the LLM, so they
 * cannot lie (Jenny's「待交付」bug). Only wants + nextStep come from Haiku, and
 * the same facts ledger is fed in so nextStep stays consistent with reality.
 * Throws if the conversation context is unavailable (db down / customer gone).
 */
export async function generateCustomerAiSummary(
  scope: SummaryScope,
): Promise<AiSummary> {
  const context =
    "userId" in scope
      ? await buildCustomerChatContext(scope.userId)
      : await buildGuestChatContext(scope.profileId);
  if (!context) {
    throw new Error("customerAiSummary: no context (db down or customer gone)");
  }

  // Deterministic half — computed from authoritative rows, not the model.
  const facts = await gatherCustomerFacts(scope);
  const actions = deriveActions(facts);
  const delivered = deriveDelivered(facts);
  const ledger = formatFactsLedger(facts);

  const result = await invokeLLM({
    model: HAIKU,
    maxTokens: 512,
    outputSchema: SUMMARY_SCHEMA,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM },
      {
        role: "user",
        content: buildSummaryUserPrompt(ledger, context),
      },
    ],
  });

  const llm = parseSummaryResult(result.choices[0]?.message?.content);
  return { wants: llm.wants, actions, delivered, nextStep: llm.nextStep };
}

/**
 * Resolve a scope to the customerProfiles.id to store the cache on, creating a
 * minimal profile for a registered user that doesn't have one yet.
 *
 * Audit fix (2026-06-30, same bug class as the Emerald Young duplicate): before
 * inserting a brand-new row, check whether a GUEST profile (userId IS NULL)
 * already exists under this user's email — most customers contact us before
 * registering. Claim it (UPDATE userId) instead of inserting a duplicate,
 * mirroring server/_core/emailCustomerMatch.ts linkProfileToUserByEmail's
 * claim pattern.
 */
export async function ensureProfileId(scope: SummaryScope): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const { customerProfiles, users } = await import("../../drizzle/schema");
  const { eq, and, isNull } = await import("drizzle-orm");

  if ("profileId" in scope) return scope.profileId;

  const existing = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, scope.userId))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const u = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, scope.userId))
    .limit(1);
  const email = u[0]?.email ?? null;

  if (email) {
    // oldest first — if more than one guest profile already shares this email
    // (the exact corrupted state this audit-fix family targets), claim the
    // ORIGINAL one (real history), never a non-deterministic row. Mirrors the
    // same ordering in server/agents/autonomous/opsTools.ts create_customer.
    const guestRow = await db
      .select({ id: customerProfiles.id })
      .from(customerProfiles)
      .where(
        and(
          eq(customerProfiles.email, email),
          isNull(customerProfiles.userId),
          // 0109:被併走的卡絕不認領 — 它的歷史已搬去別人(同案)的卡上,
          // 綁 userId 上去會把會員帳號黏在一張隱藏空卡(或更糟,之後
          // restoreCustomer 會復活分裂狀態)。寧可往下走新開一張乾淨卡。
          isNull(customerProfiles.mergedIntoProfileId),
        ),
      )
      .orderBy(customerProfiles.createdAt)
      .limit(1);
    if (guestRow[0]) {
      await db
        .update(customerProfiles)
        .set({ userId: scope.userId })
        .where(eq(customerProfiles.id, guestRow[0].id));
      return guestRow[0].id;
    }
  }

  // No profile anywhere for this email — create a minimal one keyed to the user.
  const res = await db
    .insert(customerProfiles)
    .values({ userId: scope.userId, email } as any);
  // mysql2: insertId on the result
  const insertId = (res as any)?.[0]?.insertId ?? (res as any)?.insertId;
  return insertId ? Number(insertId) : null;
}

/** Generate + persist the summary to the profile cache. Returns the summary. */
export async function refreshAndStoreSummary(
  scope: SummaryScope,
): Promise<AiSummary> {
  const summary = await generateCustomerAiSummary(scope);
  try {
    const db = await getDb();
    const profileId = await ensureProfileId(scope);
    if (db && profileId) {
      const { customerProfiles } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db
        .update(customerProfiles)
        .set({ aiSummary: summary as any, aiSummaryAt: new Date() })
        .where(eq(customerProfiles.id, profileId));
    }
  } catch (err) {
    // Persisting is best-effort — a write failure still returns the summary so
    // the card shows it this turn (just not cached).
    log.warn({ err: (err as Error).message }, "[customerAiSummary] cache write failed");
  }
  return summary;
}

/**
 * Resolve a profileId to its canonical summary scope. Event-driven refreshes
 * enqueue a profileId (from an order / interaction / email), but a REGISTERED
 * customer's profile (userId set) must recompute with {userId} so it gets the
 * real bookings + membership context — not the guest builder, which would render
 * 「尚未註冊」for an actual member. An email-only guest stays {profileId}.
 * Degrades to {profileId} when the DB is down (safe default).
 */
export async function resolveSummaryScope(
  profileId: number,
): Promise<SummaryScope> {
  const db = await getDb();
  if (!db) return { profileId };
  const { customerProfiles } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const row = (
    await db
      .select({ userId: customerProfiles.userId })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, profileId))
      .limit(1)
  )[0];
  return row?.userId ? { userId: row.userId } : { profileId };
}

/** Event-driven single-customer refresh: resolve the right scope first, then
 *  recompute + cache. Used by the worker when an order/interaction enqueues a
 *  profileId. */
export async function refreshSummaryForProfile(
  profileId: number,
): Promise<AiSummary> {
  return refreshAndStoreSummary(await resolveSummaryScope(profileId));
}

export interface CachedSummary {
  summary: AiSummary | null;
  generatedAt: Date | null;
  stale: boolean;
}

/** Pure staleness rule — exported for tests. */
export function isSummaryStale(
  generatedAt: Date | null,
  lastInteractionAt: Date | null,
  now: number,
): boolean {
  if (!generatedAt) return true;
  const at = generatedAt.getTime();
  if (now - at > SUMMARY_TTL_MS) return true;
  if (lastInteractionAt && lastInteractionAt.getTime() > at) return true;
  return false;
}

// ── cron warm-up (批3 m3, Jeff Q1「兩者都要」) ──────────────────────────────
// A nightly scan recomputes the summary for ACTIVE customers whose cache is
// stale (newer activity than the summary, or never computed). The lazy-on-open
// path (M5) covers everyone else Jeff actually opens. Only stale rows are
// recomputed, so the cron never re-reads PDFs for unchanged customers → bounded.

export interface ScanRow {
  id: number;
  userId: number | null;
  lastInteractionAt: Date | null;
  aiSummaryAt: Date | null;
}

export interface SummaryScanResult {
  scanned: number;
  refreshed: number;
  errors: number;
}

/** Pure — pick the stale rows to recompute (capped), resolved to scopes. A row
 *  with a userId is a registered customer (use the registered context builder);
 *  otherwise it's an email guest. Exported for tests. */
export function pickStaleProfiles(
  rows: ScanRow[],
  now: number,
  maxRefresh: number,
): SummaryScope[] {
  return rows
    .filter((r) => isSummaryStale(r.aiSummaryAt, r.lastInteractionAt, now))
    .slice(0, maxRefresh)
    .map((r) => (r.userId ? { userId: r.userId } : { profileId: r.id }));
}

/** Recompute summaries for active + stale customers. Single-flight, gently
 *  paced; one failure never aborts the batch. */
export async function runCustomerSummaryScan(opts?: {
  activeDays?: number;
  maxRefresh?: number;
}): Promise<SummaryScanResult> {
  const activeDays = opts?.activeDays ?? 30;
  const maxRefresh = opts?.maxRefresh ?? 50;
  const db = await getDb();
  if (!db) return { scanned: 0, refreshed: 0, errors: 0 };

  const { customerProfiles } = await import("../../drizzle/schema");
  const { gte, desc } = await import("drizzle-orm");
  const since = new Date(Date.now() - activeDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: customerProfiles.id,
      userId: customerProfiles.userId,
      lastInteractionAt: customerProfiles.lastInteractionAt,
      aiSummaryAt: customerProfiles.aiSummaryAt,
    })
    .from(customerProfiles)
    .where(gte(customerProfiles.lastInteractionAt, since))
    .orderBy(desc(customerProfiles.lastInteractionAt))
    .limit(300);

  const scopes = pickStaleProfiles(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      lastInteractionAt: r.lastInteractionAt ? new Date(r.lastInteractionAt) : null,
      aiSummaryAt: r.aiSummaryAt ? new Date(r.aiSummaryAt) : null,
    })),
    Date.now(),
    maxRefresh,
  );

  let refreshed = 0;
  let errors = 0;
  for (const scope of scopes) {
    try {
      await refreshAndStoreSummary(scope);
      refreshed++;
      await new Promise((res) => setTimeout(res, 300)); // gentle LLM pacing
    } catch (err) {
      errors++;
      log.warn(
        { scope, err: (err as Error).message },
        "[customerSummaryScan] one customer failed — continuing",
      );
    }
  }
  return { scanned: rows.length, refreshed, errors };
}

/** Read the cached summary for a scope (no compute). */
export async function readCachedSummary(
  scope: SummaryScope,
): Promise<CachedSummary> {
  const empty: CachedSummary = { summary: null, generatedAt: null, stale: true };
  const db = await getDb();
  if (!db) return empty;
  const { customerProfiles } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const where =
    "profileId" in scope
      ? eq(customerProfiles.id, scope.profileId)
      : eq(customerProfiles.userId, scope.userId);
  const row = (
    await db
      .select({
        aiSummary: customerProfiles.aiSummary,
        aiSummaryAt: customerProfiles.aiSummaryAt,
        lastInteractionAt: customerProfiles.lastInteractionAt,
      })
      .from(customerProfiles)
      .where(where)
      .limit(1)
  )[0];
  if (!row) return empty;

  const generatedAt = row.aiSummaryAt ? new Date(row.aiSummaryAt) : null;
  const summary = (row.aiSummary as AiSummary | null) ?? null;
  return {
    summary,
    generatedAt,
    stale: isSummaryStale(
      generatedAt,
      row.lastInteractionAt ? new Date(row.lastInteractionAt) : null,
      Date.now(),
    ),
  };
}
