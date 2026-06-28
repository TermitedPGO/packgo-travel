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

const OPUS = "claude-opus-4-2025-04-16";

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

const EXTRACT_SYSTEM = `你是 PACK&GO 旅行社的客戶分析師,幫 Jeff(老闆)從對話中提取客人的偏好和重要事實。

你會拿到:
1. 這位客人最近的對話紀錄
2. 客人目前已知的偏好和筆記(可能是空的)

你的工作:
- 從對話中提取客人在意的事、偏好、特殊需求、家庭狀況、預算感覺
- 注意弦外之音,不要只抓字面意思。例如「預算彈性大」可能暗示想住好一點;「小朋友比較小」暗示行程節奏不能太趕
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
- 不要編造客人沒說過的事
- preferences 裡沒提到的欄位就不要放(省略,不要放空字串或空陣列)
- aiNotes 最多 2000 字
- keyFacts 最多 20 條`;

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
    "請提取/更新這位客人的偏好。輸出 JSON。",
  ].join("\n");

  try {
    const result = await invokeLLM({
      messages: [{ role: "user", content: userPrompt }],
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
      _system: EXTRACT_SYSTEM,
      _model: OPUS,
    } as any);

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

/**
 * Convenience: gather recent messages for a profile from inquiryMessages +
 * customerInteractions, then run extraction. Fire-and-forget safe.
 */
export async function extractAfterReply(profileId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const { customerInteractions, inquiryMessages, inquiries, customerProfiles } =
    await import("../../drizzle/schema");
  const { eq, desc, and } = await import("drizzle-orm");

  const [profile] = await db
    .select({ userId: customerProfiles.userId, email: customerProfiles.email })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, profileId))
    .limit(1);
  if (!profile) return;

  const messages: { role: "customer" | "admin"; content: string; at?: Date }[] = [];

  const interactions = await db
    .select({
      direction: customerInteractions.direction,
      content: customerInteractions.content,
      createdAt: customerInteractions.createdAt,
    })
    .from(customerInteractions)
    .where(eq(customerInteractions.customerProfileId, profileId))
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
  if (unique.length === 0) return;

  await extractCustomerPreferences({ profileId, recentMessages: unique });
}
