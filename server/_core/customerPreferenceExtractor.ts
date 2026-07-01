/**
 * customerPreferenceExtractor — after Jeff replies to a customer (or an
 * inbound email is processed), read recent conversations and extract
 * structured preferences + key facts into customerProfiles.
 *
 * Uses Opus for extraction quality (100 customers/month ≈ $20).
 * Accumulative: merges new observations into existing notes, never overwrites.
 */
import { invokeLLM } from "./llm";
import { getDb } from "../db";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "customerPreferenceExtractor" });

// Match the proven customer-facing ops model. NOTE: this was previously a
// non-existent id ("claude-opus-4-2025-04-16") passed via a `_model` field that
// invokeLLM ignores — so the extractor silently ran DEFAULT_MODEL (Sonnet) with
// the anti-fabrication system prompt never sent. Fixed to a valid id + real
// `model`/system-message wiring below.
const OPUS = "claude-opus-4-6";

export interface ExtractedPreferences {
  food?: { dietary?: string; dislikes?: string[]; favorites?: string[] };
  accommodation?: { roomType?: string; floor?: string; view?: string };
  pace?: string;
  interests?: string[];
  avoidances?: string[];
  pastDestinations?: { destination: string; year?: number; rating?: string }[];
  wishlist?: string[];
}

export interface ExtractionResult {
  aiNotes: string;
  keyFacts: string;
  preferences: ExtractedPreferences;
}

const EXTRACT_SYSTEM = `【重要】所有輸出必須使用繁體中文。不管對話原文是什麼語言,你的 aiNotes、keyFacts、preferences 值全部用繁體中文寫。

【絕對鐵律 — 不可編造,違反就是嚴重錯誤】
- 每一條 keyFacts、每一句 aiNotes、每個 preferences 的值,都必須能在對話原文裡找到客人或 Jeff「真的講過的字句」。寫之前先自問:這件事對話裡有沒有出現?沒有就不准寫。
- 嚴禁推測或補上對話中「沒有逐字講出來」的:出發日期/月份/年份、預算金額、人數、天數、航班、城市。客人沒明講就是不知道,不准用「合理推估」填空。
- 只有客人逐字講過的日期/數字才能寫。例:客人說「七月中旬家庭聚會」→ 可寫「七月中旬要開家庭聚會討論」;但這只是聚會,不是出發日期,絕不可推導出「11 月出發」這種沒講過的時間。
- 該有但客人沒提到的關鍵資訊(例如出發日期未定、預算未明說),就寫「未提及」或「未定」,或乾脆省略。寧可少寫,不可亂寫。

你是 PACK&GO 旅行社的客戶分析師,幫 Jeff(老闆)從對話中提取客人的偏好和重要事實。

你會拿到:
1. 這位客人最近的對話紀錄
2. 客人目前已知的偏好和筆記(可能是空的)

你的工作:
- 從對話中提取客人在意的事、偏好、特殊需求、家庭狀況、預算感覺
- 弦外之音只能寫進 aiNotes 當「軟性觀察/語氣判斷」,而且要標明是推測(用「似乎」「可能」)。例如「預算彈性大」可寫成「似乎願意為好一點的住宿加價」。弦外之音絕不可變成 keyFacts 或 preferences 裡的具體日期、金額、人數,那些只能寫客人明講過的。
- 新資訊要跟舊的合併,不要覆蓋已有的觀察
- 如果對話沒有新的偏好資訊,就回傳現有的不要硬編

輸出格式(JSON):
{
  "aiNotes": "累積式觀察筆記,一段文字。包含:客人個性、溝通風格、在意的點、特殊狀況。新觀察接在舊的後面,用句號分隔。",
  "keyFacts": "重要事實,每行一條。格式:- 事實\\n- 事實。例如:- 吃素\\n- 有兩個小孩(5歲、8歲)\\n- 怕高",
  "preferences": {
    "food": { "dietary": "素食/清真/無", "dislikes": ["辣"], "favorites": ["海鮮"] },
    "accommodation": { "roomType": "雙人/家庭", "floor": "高樓層", "view": "海景" },
    "pace": "慢步調/標準/緊湊",
    "interests": ["博物館", "自然景觀"],
    "avoidances": ["購物團", "紅眼班機"],
    "pastDestinations": [{ "destination": "日本", "year": 2024, "rating": "很喜歡" }],
    "wishlist": ["極光", "非洲safari"]
  }
}

注意:
- 一律用繁體中文輸出,即使對話是英文的也要翻成繁中
- 回到上面的【絕對鐵律】:keyFacts 或 aiNotes 裡只要某項客人沒明講,就省略或寫「未提及」,不要編
- preferences 裡沒提到的欄位就不要放(省略,不要放空字串或空陣列)
- aiNotes 最多 2000 字
- keyFacts 最多 20 條
- 輸出前自我檢查一遍:每個日期、月份、數字、金額,能不能對應到對話原句?對不上的一律刪掉或改成「未提及」`;

export async function extractCustomerPreferences(opts: {
  profileId: number;
  recentMessages: { role: "customer" | "admin"; content: string; at?: Date }[];
}): Promise<ExtractionResult | null> {
  const { profileId, recentMessages } = opts;
  if (recentMessages.length === 0) return null;

  const db = await getDb();
  if (!db) return null;

  const { customerProfiles } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [profile] = await db
    .select({
      aiNotes: customerProfiles.aiNotes,
      keyFacts: customerProfiles.keyFacts,
      preferences: customerProfiles.preferences,
    })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, profileId))
    .limit(1);

  if (!profile) {
    log.warn({ profileId }, "profile not found, skipping extraction");
    return null;
  }

  const existingContext = [
    profile.aiNotes ? `【現有 AI 筆記】\n${profile.aiNotes}` : "",
    profile.keyFacts ? `【現有重要事實】\n${profile.keyFacts}` : "",
    profile.preferences
      ? `【現有偏好】\n${JSON.stringify(profile.preferences, null, 2)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const conversationText = recentMessages
    .map((m) => {
      const label = m.role === "customer" ? "客人" : "Jeff";
      const ts = m.at ? ` (${m.at.toISOString().slice(0, 10)})` : "";
      return `${label}${ts}: ${m.content}`;
    })
    .join("\n\n");

  const userPrompt = [
    existingContext || "（目前沒有已知偏好資料）",
    "",
    "【最近對話】",
    conversationText,
    "",
    "請提取/更新這位客人的偏好。輸出 JSON。全部用繁體中文。",
  ].join("\n");

  try {
    const result = await invokeLLM({
      model: OPUS,
      // EXTRACT_SYSTEM carries the anti-fabrication 鐵律. It MUST go as a
      // role:"system" message — invokeLLM only collects system text from system
      // messages (a top-level `_system`/`system` field is ignored).
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 2000,
      outputSchema: {
        name: "customer_preferences",
        schema: {
          type: "object",
          properties: {
            aiNotes: { type: "string" },
            keyFacts: { type: "string" },
            preferences: { type: "object" },
          },
          required: ["aiNotes", "keyFacts", "preferences"],
        },
      },
    });

    const text =
      result.choices?.[0]?.message?.content ??
      result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ??
      "";
    if (!text) {
      log.warn({ profileId }, "empty LLM response");
      return null;
    }

    const parsed: ExtractionResult = typeof text === "string" ? JSON.parse(text) : text;

    await db
      .update(customerProfiles)
      .set({
        aiNotes: (parsed.aiNotes || "").slice(0, 5000) || null,
        keyFacts: (parsed.keyFacts || "").slice(0, 5000) || null,
        preferences: parsed.preferences ?? null,
        updatedAt: new Date(),
      })
      .where(eq(customerProfiles.id, profileId));

    log.info(
      {
        profileId,
        notesLen: parsed.aiNotes?.length ?? 0,
        factsLen: parsed.keyFacts?.length ?? 0,
      },
      "preferences extracted and saved",
    );

    return parsed;
  } catch (err) {
    log.error({ err, profileId }, "preference extraction failed");
    return null;
  }
}

/** In-flight dedup with COALESCING (cost control + no lost update): a burst of
 *  inbound emails for the same customer fires several fire-and-forget
 *  extractAfterReply calls. We run at most one at a time, but if a trigger
 *  arrives mid-run we remember it and re-run exactly once after — so the final
 *  snapshot always includes the latest message (a plain "skip" could drop the
 *  last message's preference update if it landed after the snapshot read). */
const extractInflight = new Set<number>();
const extractPending = new Set<number>();

/**
 * Convenience: gather recent messages for a profile from inquiryMessages +
 * customerInteractions, then run extraction. Fire-and-forget safe. Deduped +
 * coalesced per profileId so overlapping inbound triggers don't double-bill
 * Opus yet never drop the newest message. Returns true if preferences were
 * written (used by the back-fill to count real successes, not attempts).
 */
export async function extractAfterReply(profileId: number): Promise<boolean> {
  if (extractInflight.has(profileId)) {
    extractPending.add(profileId); // re-run once after the current pass finishes
    return false;
  }
  extractInflight.add(profileId);
  try {
    return await runExtraction(profileId);
  } finally {
    extractInflight.delete(profileId);
    if (extractPending.delete(profileId)) {
      // A trigger arrived during this run → run once more so the snapshot picks
      // it up. Fire-and-forget (best effort); never throw to this caller.
      void extractAfterReply(profileId).catch(() => {});
    }
  }
}

async function runExtraction(profileId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const { customerInteractions, inquiryMessages, inquiries, customerProfiles } =
    await import("../../drizzle/schema");
  const { eq, desc, and, sql } = await import("drizzle-orm");

  const [profile] = await db
    .select({ userId: customerProfiles.userId, email: customerProfiles.email })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, profileId))
    .limit(1);
  if (!profile) return false;

  const messages: { role: "customer" | "admin"; content: string; at?: Date }[] = [];

  const interactions = await db
    .select({
      direction: customerInteractions.direction,
      content: customerInteractions.content,
      createdAt: customerInteractions.createdAt,
    })
    .from(customerInteractions)
    .where(
      and(
        eq(customerInteractions.customerProfileId, profileId),
        // Don't learn a customer's "preferences" from spam — mirror the same
        // filter buildGuestChatContext uses for 近期來信. NULL-safe: outbound
        // replies have no classification (→ excluded only when真是未 rescued spam).
        sql`NOT (COALESCE(${customerInteractions.classification}, '') = 'spam' AND COALESCE(${customerInteractions.spamVerdict}, '') != 'rescued')`,
      ),
    )
    .orderBy(desc(customerInteractions.createdAt))
    .limit(20);

  for (const i of interactions) {
    messages.push({
      role: i.direction === "inbound" ? "customer" : "admin",
      content: (i.content ?? "").slice(0, 3000),
      at: i.createdAt ?? undefined,
    });
  }

  if (profile.email) {
    const inqs = await db
      .select({ id: inquiries.id })
      .from(inquiries)
      .where(eq(inquiries.customerEmail, profile.email))
      .limit(5);

    if (inqs.length > 0) {
      const inqIds = inqs.map((i) => i.id);
      const { inArray } = await import("drizzle-orm");
      const msgs = await db
        .select({
          senderType: inquiryMessages.senderType,
          message: inquiryMessages.message,
          createdAt: inquiryMessages.createdAt,
        })
        .from(inquiryMessages)
        .where(inArray(inquiryMessages.inquiryId, inqIds))
        .orderBy(desc(inquiryMessages.createdAt))
        .limit(20);

      for (const m of msgs) {
        messages.push({
          role: m.senderType === "customer" ? "customer" : "admin",
          content: (m.message ?? "").slice(0, 3000),
          at: m.createdAt ?? undefined,
        });
      }
    }
  }

  messages.sort((a, b) => {
    const ta = a.at?.getTime() ?? 0;
    const tb = b.at?.getTime() ?? 0;
    return ta - tb;
  });

  const unique = messages.slice(-20);
  if (unique.length === 0) return false;

  const result = await extractCustomerPreferences({
    profileId,
    recentMessages: unique,
  });
  return result !== null; // true only when preferences were actually written
}

/**
 * customer-memory M2 — back-fill preferences for customers who have history but
 * were never extracted (predate the extractor, or never triggered it). Bounded
 * + deduped so the nightly run's LLM cost is capped. Going forward every inbound
 * email keeps memory fresh; this catches the long tail. Returns counts.
 */
export async function backfillMissingPreferences(
  limit = 25,
): Promise<{ scanned: number; extracted: number }> {
  const db = await getDb();
  if (!db) return { scanned: 0, extracted: 0 };

  const { customerProfiles, customerInteractions } = await import(
    "../../drizzle/schema"
  );
  const { and, isNull, isNotNull, inArray, desc } = await import("drizzle-orm");

  // Profiles with at least one interaction but no preferences yet. Order by most
  // recent activity so genuinely-active customers get memory first and a handful
  // of "never extractable" zombies (extraction keeps failing → stays NULL) can't
  // permanently hog the nightly budget and starve newcomers.
  const rows = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(
      and(
        isNull(customerProfiles.preferences),
        inArray(
          customerProfiles.id,
          db
            .select({ pid: customerInteractions.customerProfileId })
            .from(customerInteractions)
            .where(isNotNull(customerInteractions.customerProfileId)),
        ),
      ),
    )
    .orderBy(desc(customerProfiles.lastInteractionAt))
    .limit(limit);

  let extracted = 0; // real successes (preferences written), not attempts
  for (const r of rows) {
    try {
      if (await extractAfterReply(r.id)) extracted++;
    } catch (err) {
      log.warn({ err, profileId: r.id }, "backfill extraction failed (non-fatal)");
    }
  }
  if (rows.length > 0 && extracted === 0) {
    // Scanned customers but wrote nothing → extraction may be systematically
    // failing (e.g. truncation / model errors). Surface it instead of a rosy log.
    log.warn(
      { scanned: rows.length },
      "back-fill scanned customers but wrote 0 — extraction may be systematically failing",
    );
  }
  log.info({ scanned: rows.length, extracted }, "preference back-fill done");
  return { scanned: rows.length, extracted };
}

/**
 * customer-projects — per-project (訂製/包團) 客人理解. On-the-fly, NO storage:
 * gather the conversation FILED to THIS project (customerInteractions.customOrderId)
 * and run the SAME anti-fabrication extraction, but for this ONE trip. Reuses
 * EXTRACT_SYSTEM (the 不可編造 鐵律) + the whole-customer schema, so the per-trip
 * understanding obeys the same「客人沒明講就不准寫」rule.
 *
 * Cost guard: returns null WITHOUT spending an LLM call when the project has no
 * filed conversation yet (an empty / just-created project can never bill Opus).
 * The caller (a tRPC query, quote-category only) caches the result client-side —
 * Jeff 憲法「一人後台要簡單」: no per-order table, no cron, just compute-on-open
 * for the travel-planning 訂製/包團 單 where trip-level understanding actually pays.
 */
export async function extractProjectUnderstanding(
  customOrderId: number,
): Promise<ExtractionResult | null> {
  const db = await getDb();
  if (!db) return null;

  const { customerInteractions } = await import("../../drizzle/schema");
  const { eq, and, desc, sql } = await import("drizzle-orm");

  const interactions = await db
    .select({
      direction: customerInteractions.direction,
      content: customerInteractions.content,
      createdAt: customerInteractions.createdAt,
    })
    .from(customerInteractions)
    .where(
      and(
        eq(customerInteractions.customOrderId, customOrderId),
        // Same spam guard as runExtraction — never learn from unrescued spam.
        sql`NOT (COALESCE(${customerInteractions.classification}, '') = 'spam' AND COALESCE(${customerInteractions.spamVerdict}, '') != 'rescued')`,
      ),
    )
    .orderBy(desc(customerInteractions.createdAt))
    .limit(20);

  const messages = interactions
    .map((i) => ({
      role: (i.direction === "inbound" ? "customer" : "admin") as "customer" | "admin",
      content: (i.content ?? "").slice(0, 3000),
      at: (i.createdAt ?? undefined) as Date | undefined,
    }))
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

  // Empty / unfiled project → nothing to understand, and crucially NO LLM spend.
  if (messages.length === 0) return null;

  const conversationText = messages
    .map((m) => {
      const label = m.role === "customer" ? "客人" : "Jeff";
      const ts = m.at ? ` (${m.at.toISOString().slice(0, 10)})` : "";
      return `${label}${ts}: ${m.content}`;
    })
    .join("\n\n");

  const userPrompt = [
    "（這是單一專案/行程的對話。請只針對「這一趟旅程」提取理解,不要混入客人其他訂單的事)",
    "",
    "【這個專案的對話】",
    conversationText,
    "",
    "請提取客人對這一趟旅程的偏好、在意的點與重點。輸出 JSON。全部用繁體中文。",
  ].join("\n");

  try {
    const result = await invokeLLM({
      model: OPUS,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 2000,
      outputSchema: {
        name: "customer_preferences",
        schema: {
          type: "object",
          properties: {
            aiNotes: { type: "string" },
            keyFacts: { type: "string" },
            preferences: { type: "object" },
          },
          required: ["aiNotes", "keyFacts", "preferences"],
        },
      },
    });

    const text =
      result.choices?.[0]?.message?.content ??
      result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ??
      "";
    if (!text) return null;

    const parsed: ExtractionResult = typeof text === "string" ? JSON.parse(text) : text;
    return {
      aiNotes: (parsed.aiNotes || "").slice(0, 5000),
      keyFacts: (parsed.keyFacts || "").slice(0, 5000),
      preferences: parsed.preferences ?? {},
    };
  } catch (err) {
    log.error({ err, customOrderId }, "project understanding extraction failed");
    return null;
  }
}
