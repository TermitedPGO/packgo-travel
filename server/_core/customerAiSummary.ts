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

const SUMMARY_SYSTEM = `你是 Jeff 的 PACK&GO(美國旅行社)後台助理,只服務 Jeff 本人(admin 內部)。
你的工作:看完下面這位客人的真實資料,濃縮成四句話的摘要,給 Jeff 一眼看懂這位客人的狀態。

鐵則:
1. 只搬運下面提供的事實,不杜撰價格、日期、行程。資料沒有就說「目前沒有」,絕不腦補。
2. 口語、自然、簡短,像跟同事講話。不要用破折號,不要用打勾符號,不要官方腔。
3. 供應商成本、同業價是內部數字,不要寫進摘要(這摘要日後可能給客人看到)。
4. 護照號、生日這類個資絕對不要出現在摘要裡。
5. 訂金不等於營收(出發前的訂金是代管),談錢就照資料寫,不要自己改規則。

四個欄位各一兩句:
- wants:這位客人現在想要什麼(從對話、開著的詢問、進行中的單推斷)
- actions:我們為他做了什麼(已回信、已報價、已訂…)
- delivered:已經交付給他什麼(寄出的報價/行程/確認書)
- nextStep:下一步該做什麼,一句可執行的(例:補寄 12 月台灣團含早鳥價)`;

const SUMMARY_SCHEMA = {
  name: "customer_summary",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      wants: { type: "string", description: "客人現在想要什麼,一兩句" },
      actions: { type: "string", description: "我們做了什麼,一兩句" },
      delivered: { type: "string", description: "已交付什麼,一兩句" },
      nextStep: { type: "string", description: "下一步該做什麼,一句可執行" },
    },
    required: ["wants", "actions", "delivered", "nextStep"],
  },
  strict: true,
};

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

/** Run the LLM over this customer's context. Throws if context is unavailable. */
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

  const result = await invokeLLM({
    model: HAIKU,
    maxTokens: 1024,
    outputSchema: SUMMARY_SCHEMA,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM },
      {
        role: "user",
        content: `下面是這位客人的真實資料,請據此產出四欄摘要。\n\n${context}`,
      },
    ],
  });

  return parseSummaryResult(result.choices[0]?.message?.content);
}

/** Resolve a scope to the customerProfiles.id to store the cache on, creating a
 *  minimal profile for a registered user that doesn't have one yet. */
async function ensureProfileId(scope: SummaryScope): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const { customerProfiles, users } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  if ("profileId" in scope) return scope.profileId;

  const existing = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, scope.userId))
    .limit(1);
  if (existing[0]) return existing[0].id;

  // No profile yet — create a minimal one keyed to the user (the profile
  // extractor would create one eventually anyway). email is best-effort.
  const u = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, scope.userId))
    .limit(1);
  const res = await db
    .insert(customerProfiles)
    .values({ userId: scope.userId, email: u[0]?.email ?? null } as any);
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
