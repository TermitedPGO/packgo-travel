/**
 * Round 81 / 2026-05-17 — OpsAgent
 *
 * Natural-language ops queries about Jeff's tour groups + customers.
 * Jeff types in #ops channel of ChatsTab → this agent answers.
 *
 * Examples:
 *   "李太太那團幾號出發?"          → finds bookings by name → groups info
 *   "6 月日本團還有位嗎?"          → tourDepartures filter by month + destination
 *   "王董生日什麼時候?"             → customerProfiles.birthDate lookup
 *   "8/22 沖繩慢遊團 leader 誰?"   → tourDepartures internalNotes + tourLeader
 *
 * Strategy (v0, single-turn):
 *   1. Extract hints from question (regex + keyword): date, name, destination, days
 *   2. Run parallel DB queries based on hints
 *   3. Pass results + question to Haiku 4.5 → natural-language answer
 *
 * Avoids a true multi-turn agent loop to keep latency < 5s and cost < $0.005/query.
 * Trade-off: less flexible than agent-with-tools but predictable + fast.
 *
 * Output also gets posted to agentMessages as senderRole='agent', so the answer
 * shows up in #ops channel and Jeff can ask follow-ups.
 */
import { invokeLLM } from "../../_core/llm";

const SYSTEM_PROMPT = `你是 PACK&GO 旅行社的 OpsAgent — 旅團運營查詢助理。

【你的角色】
Jeff 在他的私人 admin 後台 #ops channel 問你問題,你看到他能看到的所有資料(tour 行程、tourDepartures 團期、bookings 客戶訂位、customerProfiles 客戶 CRM),你用自然中文(或 Jeff 用英文就用英文)回答。

【核心原則】
1. 簡潔 — 1-3 段話就好,不要寫小論文。Jeff 是一人公司、時間寶貴。
2. 數字精確 — 出發日、客戶數、剩餘座位、金額一定精確,不可估算。
3. 結構化 — 如果結果是清單(多個團、多個客戶),用 markdown table 或項目列表。
4. 主動建議 — 答完問題後,如果偵測到「應該關注但 Jeff 沒問」的事(例如有團 < 30 天還沒指派領隊),提一句。

【可用資料】
- supplierProducts: catalog 候選(Lion / UV 供應商)
- tours: PACK&GO 已包裝的行程
- tourDepartures: 每個團期(包含 internalCode, groupName, tourLeader, opsStatus, internalNotes — Jeff 的私人運營筆記)
- bookings: 客戶訂位
- customerProfiles: 客戶 CRM(preferences, keyFacts, jeffPersonalNote — Jeff 的私人觀察)
- customerInteractions: 客戶溝通 log

【絕對不可】
- 編造未在 context 中的事實
- 把資料給其他客戶(隔離 by customerProfile)
- 洩漏其他客戶的 PII

【回應格式】
直接給答案。不需要 "好的我來幫您查" 這種廢話開頭。Jeff 一目了然最重要。`;

/**
 * Extract hints from the question — used to narrow DB queries before
 * passing context to LLM. Keep this regex-light so it works for both
 * 中文 and English questions.
 */
function extractHints(question: string): {
  customerNameHints: string[];
  destinationHints: string[];
  dateHint: { year?: number; month?: number; day?: number } | null;
  daysHint: number | null;
} {
  const result = {
    customerNameHints: [] as string[],
    destinationHints: [] as string[],
    dateHint: null as { year?: number; month?: number; day?: number } | null,
    daysHint: null as number | null,
  };

  // Customer name — look for 「李太太/王董/陳先生」 patterns
  const cnNamePattern = /([王李張陳劉黃楊周吳趙朱孫郭何林徐高羅鄭梁謝唐韓馮于董蕭程曹袁鄧曾彭蔣余蔡][一-龥]{0,3}(?:先生|太太|董|姐|哥|女士|小姐))/g;
  let m: RegExpExecArray | null;
  while ((m = cnNamePattern.exec(question)) !== null) {
    result.customerNameHints.push(m[1]);
  }

  // Destination — common Japan/Korea/etc city/region names
  const destinations = [
    "日本", "沖繩", "北海道", "東京", "大阪", "京都", "九州", "四國", "關西",
    "韓國", "首爾", "釜山", "濟州",
    "美國", "美西", "美東", "紐約", "洛杉磯", "舊金山", "夏威夷",
    "歐洲", "英國", "法國", "義大利", "瑞士",
    "泰國", "越南", "印尼", "新加坡", "馬來西亞",
    "台灣", "台北", "花蓮", "台中", "高雄",
    "中國", "香港", "澳門",
    "澳洲", "紐西蘭",
  ];
  for (const d of destinations) {
    if (question.includes(d)) result.destinationHints.push(d);
  }

  // Date — match "6 月", "8/22", "2026/06/15", "明天", "下週"
  const mmddPattern = /(\d{1,2})[\/\-月](\d{1,2})/;
  const mmddMatch = question.match(mmddPattern);
  if (mmddMatch) {
    result.dateHint = {
      month: parseInt(mmddMatch[1], 10),
      day: parseInt(mmddMatch[2], 10),
    };
  } else {
    const monthOnlyPattern = /(\d{1,2})\s*月/;
    const monthMatch = question.match(monthOnlyPattern);
    if (monthMatch) {
      result.dateHint = { month: parseInt(monthMatch[1], 10) };
    }
  }

  // Days — "5 日", "7 天", "5-day"
  const daysPattern = /(\d+)\s*(?:日|天|-day|day)/i;
  const daysMatch = question.match(daysPattern);
  if (daysMatch) result.daysHint = parseInt(daysMatch[1], 10);

  return result;
}

/**
 * Run DB queries based on extracted hints. All queries are concurrent.
 * Result objects are limited in size to keep the LLM context small.
 */
async function fetchOpsContext(hints: ReturnType<typeof extractHints>) {
  const { getDb } = await import("../../db");
  const { tourDepartures, tours, bookings, customerProfiles } = await import("../../../drizzle/schema");
  const { eq, and, or, gte, lte, sql, desc, like } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { groups: [], customers: [], summary: "DB unavailable" };

  const queries: Promise<any>[] = [];
  const labels: string[] = [];

  // (1) Date-narrowed tourDepartures
  if (hints.dateHint) {
    const { month, day } = hints.dateHint;
    const year = hints.dateHint.year ?? new Date().getFullYear();
    let startDate: Date, endDate: Date;
    if (day) {
      // exact day ± 3 days
      startDate = new Date(year, month! - 1, day - 3);
      endDate = new Date(year, month! - 1, day + 3);
    } else {
      // whole month
      startDate = new Date(year, month! - 1, 1);
      endDate = new Date(year, month!, 0);
    }
    queries.push(
      db
        .select({
          id: tourDepartures.id,
          tourId: tourDepartures.tourId,
          departureDate: tourDepartures.departureDate,
          returnDate: tourDepartures.returnDate,
          adultPrice: tourDepartures.adultPrice,
          totalSlots: tourDepartures.totalSlots,
          bookedSlots: tourDepartures.bookedSlots,
          status: tourDepartures.status,
          opsStatus: tourDepartures.opsStatus,
          groupName: tourDepartures.groupName,
          internalCode: tourDepartures.internalCode,
          tourLeader: tourDepartures.tourLeader,
          internalNotes: tourDepartures.internalNotes,
          tourTitle: tours.title,
          destinationCity: tours.destinationCity,
          destinationCountry: tours.destinationCountry,
        })
        .from(tourDepartures)
        .leftJoin(tours, eq(tourDepartures.tourId, tours.id))
        .where(
          and(
            gte(tourDepartures.departureDate, startDate),
            lte(tourDepartures.departureDate, endDate)
          )
        )
        .orderBy(tourDepartures.departureDate)
        .limit(20)
    );
    labels.push("groupsByDate");
  }

  // (2) Destination-narrowed tourDepartures (joined to tours)
  if (hints.destinationHints.length > 0) {
    const destFilters = hints.destinationHints.map((d) =>
      or(
        like(tours.destinationCountry, `%${d}%`),
        like(tours.destinationCity, `%${d}%`),
        like(tours.title, `%${d}%`)
      )
    );
    queries.push(
      db
        .select({
          id: tourDepartures.id,
          tourId: tourDepartures.tourId,
          departureDate: tourDepartures.departureDate,
          returnDate: tourDepartures.returnDate,
          adultPrice: tourDepartures.adultPrice,
          totalSlots: tourDepartures.totalSlots,
          bookedSlots: tourDepartures.bookedSlots,
          status: tourDepartures.status,
          opsStatus: tourDepartures.opsStatus,
          groupName: tourDepartures.groupName,
          internalCode: tourDepartures.internalCode,
          tourLeader: tourDepartures.tourLeader,
          tourTitle: tours.title,
          destinationCity: tours.destinationCity,
          destinationCountry: tours.destinationCountry,
        })
        .from(tourDepartures)
        .leftJoin(tours, eq(tourDepartures.tourId, tours.id))
        .where(
          and(
            or(...destFilters),
            gte(tourDepartures.departureDate, new Date()) // future only
          )
        )
        .orderBy(tourDepartures.departureDate)
        .limit(15)
    );
    labels.push("groupsByDestination");
  }

  // (3) Customer name — search both bookings.customerName + customerProfiles
  if (hints.customerNameHints.length > 0) {
    const nameFilters = hints.customerNameHints.map((n) =>
      like(bookings.customerName, `%${n}%`)
    );
    queries.push(
      db
        .select({
          id: bookings.id,
          customerName: bookings.customerName,
          customerEmail: bookings.customerEmail,
          customerPhone: bookings.customerPhone,
          tourId: bookings.tourId,
          departureId: bookings.departureId,
          totalPrice: bookings.totalPrice,
          paymentStatus: bookings.paymentStatus,
          bookingStatus: bookings.bookingStatus,
          numberOfAdults: bookings.numberOfAdults,
          numberOfChildrenWithBed: bookings.numberOfChildrenWithBed,
          numberOfChildrenNoBed: bookings.numberOfChildrenNoBed,
          tourTitle: tours.title,
          departureDate: tourDepartures.departureDate,
          groupName: tourDepartures.groupName,
          internalCode: tourDepartures.internalCode,
        })
        .from(bookings)
        .leftJoin(tours, eq(bookings.tourId, tours.id))
        .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
        .where(or(...nameFilters))
        .orderBy(desc(bookings.createdAt))
        .limit(10)
    );
    labels.push("customersByName");
  }

  // (4) Days-range filter (e.g. "5 日團")
  if (hints.daysHint && !hints.dateHint && !hints.destinationHints.length) {
    queries.push(
      db
        .select({
          id: tourDepartures.id,
          departureDate: tourDepartures.departureDate,
          totalSlots: tourDepartures.totalSlots,
          bookedSlots: tourDepartures.bookedSlots,
          opsStatus: tourDepartures.opsStatus,
          groupName: tourDepartures.groupName,
          tourTitle: tours.title,
          destinationCountry: tours.destinationCountry,
        })
        .from(tourDepartures)
        .leftJoin(tours, eq(tourDepartures.tourId, tours.id))
        .where(
          and(
            eq(tours.days, hints.daysHint),
            gte(tourDepartures.departureDate, new Date())
          )
        )
        .orderBy(tourDepartures.departureDate)
        .limit(15)
      );
    labels.push("groupsByDays");
  }

  const results = await Promise.all(queries);
  const ctx: Record<string, unknown> = {};
  results.forEach((r, i) => {
    ctx[labels[i]] = r;
  });
  return ctx;
}

// Export hints + ctx helpers so opsAgentStream can reuse them without
// duplicating regex/SQL.
export { extractHints, fetchOpsContext };

/**
 * Round 81 Phase 2 (2026-05-17) — Action proposal schema.
 * OpsAgent can suggest 1-3 follow-up actions Jeff might want to take.
 * UI renders them as chips below the answer. Each chip is a *proposal*
 * that requires Jeff's explicit click to execute (no auto-execute).
 *
 * The 'args' shape must match what executeOpsAction accepts for that
 * actionType, so the UI can pass it through verbatim on confirm.
 */
export interface OpsActionProposal {
  actionType:
    | "sendCustomerEmail"
    | "addTourGroupNote"
    | "assignTourLeader"
    | "updateInternalNote"
    | "markBookingPaid"
    | "scheduleReminder"
    | "cancelBooking"
    | "triggerRefund";
  label: string; // 1-line description shown on the chip (Chinese)
  description: string; // 2-3 sentence detail shown in confirmation modal
  args: Record<string, unknown>;
  // Sensitivity — affects confirmation UI:
  //   'safe'      = idempotent / undoable (e.g. add note)        → confirm dialog optional
  //   'normal'    = creates external effect (email)               → confirmation required
  //   'sensitive' = money / customer-facing changes               → typed confirmation
  sensitivity: "safe" | "normal" | "sensitive";
}

export interface OpsAgentTurn {
  role: "user" | "agent";
  content: string;
}

/**
 * Main entry — takes a natural-language question + optional conversation
 * history, returns the agent's answer + suggested actions.
 *
 * Multi-turn memory: caller (askOps tRPC) passes the last N #ops messages
 * so the agent has context. Without memory the agent treats every question
 * as standalone and Jeff has to re-specify customer/date each time —
 * frustrating for follow-up questions ("那團還剩幾位?").
 */
export async function runOpsAgent(
  question: string,
  history: OpsAgentTurn[] = []
): Promise<{
  answer: string;
  suggestedActions: OpsActionProposal[];
  contextUsed: Record<string, unknown>;
  hints: ReturnType<typeof extractHints>;
}> {
  // Combine hints from current question + recent user turns so follow-ups
  // inherit context ("那團還剩幾位" picks up the team Jeff just asked about).
  const combinedText =
    history
      .filter((t) => t.role === "user")
      .slice(-3)
      .map((t) => t.content)
      .join(" ") +
    " " +
    question;
  const hints = extractHints(combinedText);
  const ctx = await fetchOpsContext(hints);

  // Truncate context if huge — keep agent latency < 5s
  const ctxStr = JSON.stringify(ctx, null, 2);
  const truncated = ctxStr.length > 12000 ? ctxStr.slice(0, 12000) + "\n…(truncated)" : ctxStr;

  // Build messages array — history then current question
  const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT + "\n\n" + ACTION_PROPOSAL_GUIDE }];

  // Multi-turn memory: last 5 exchanges (user+agent pairs = up to 10 messages)
  // Anthropic API needs alternating user/assistant — fold consecutive same-role
  // turns into one message.
  let lastRole: string | null = null;
  for (const turn of history.slice(-10)) {
    const role = turn.role === "agent" ? "assistant" : "user";
    if (role === lastRole) {
      messages[messages.length - 1].content += "\n\n" + turn.content;
    } else {
      messages.push({ role, content: turn.content });
      lastRole = role;
    }
  }

  // Current question + DB context
  const userMessage =
    `【Jeff 的問題】\n${question}\n\n` +
    `【系統從你的問題 + 對話歷史抽出的線索】\n` +
    `客戶名: ${hints.customerNameHints.join(", ") || "(無)"}\n` +
    `目的地: ${hints.destinationHints.join(", ") || "(無)"}\n` +
    `日期: ${hints.dateHint ? JSON.stringify(hints.dateHint) : "(無)"}\n` +
    `天數: ${hints.daysHint ?? "(無)"}\n\n` +
    `【DB 查詢結果】\n${truncated}\n\n` +
    `請依此回答。回應格式必須是 JSON:\n` +
    `{\n` +
    `  "answer": "...自然語言回答(markdown ok, 1-3 段)...",\n` +
    `  "suggestedActions": [ ...0-3 個動作建議, 看 ACTION_PROPOSAL_GUIDE... ]\n` +
    `}`;

  if (lastRole === "user") {
    messages[messages.length - 1].content += "\n\n" + userMessage;
  } else {
    messages.push({ role: "user", content: userMessage });
  }

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 1500,
    temperature: 0.3,
    messages: messages.slice(1), // exclude system from messages array
    system: messages[0].content,
  } as any);

  const rawText =
    (response?.content?.[0] as any)?.text ||
    response?.choices?.[0]?.message?.content ||
    "(no response)";

  // Parse JSON response — fallback to plain text if LLM didn't comply
  let answer = "";
  let suggestedActions: OpsActionProposal[] = [];
  try {
    const txt = typeof rawText === "string" ? rawText : String(rawText);
    // Strip markdown code fences if present
    const cleaned = txt.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    answer = parsed.answer ?? cleaned;
    suggestedActions = Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [];
  } catch {
    // LLM didn't return JSON — treat whole response as plain answer
    answer = typeof rawText === "string" ? rawText : String(rawText);
  }

  return {
    answer,
    suggestedActions,
    contextUsed: ctx,
    hints,
  };
}

const ACTION_PROPOSAL_GUIDE = `
【建議動作 (suggestedActions) 規則】

每次回答後,評估 Jeff 接下來「最可能想做的 1-3 個動作」。**不一定要建議**,沒明顯動作就回空陣列。

每個動作 schema:
{
  "actionType": "sendCustomerEmail" | "addTourGroupNote" | "assignTourLeader" | "updateInternalNote" | "markBookingPaid" | "scheduleReminder",
  "label": "1 行中文描述(< 30 字)",
  "description": "2-3 句細節, 讓 Jeff 在 confirmation modal 看清楚要做什麼",
  "args": { ...動作參數... },
  "sensitivity": "safe" | "normal" | "sensitive"
}

【可用動作 + 參數】

sendCustomerEmail (sensitivity=normal):
  args: { customerProfileId: number, subject: string, body: string, language?: "zh-TW"|"en" }
  用途: 寄信給客戶 (尾款提醒/特殊安排確認/感謝信)

addTourGroupNote (sensitivity=safe):
  args: { tourDepartureId: number, type: "ops"|"customer"|"financial"|"followup"|"ai_query", body: string }
  用途: 把對話中提到的事實記進團期筆記

assignTourLeader (sensitivity=normal):
  args: { tourDepartureId: number, tourLeader: string }
  用途: 指派/更換領隊

updateInternalNote (sensitivity=safe):
  args: { tourDepartureId: number, append: string }  // append to existing internalNotes
  用途: 對 tourDepartures.internalNotes 追加 1 行

markBookingPaid (sensitivity=sensitive):
  args: { bookingId: number, paymentType: "deposit"|"balance"|"full", amount: number }
  用途: 手動標記訂單已付 (繞過 Stripe webhook,慎用)

scheduleReminder (sensitivity=safe):
  args: { tourDepartureId: number, remindAt: ISO8601, message: string }
  用途: 自定義出發前提醒

cancelBooking (sensitivity=sensitive):
  args: { bookingId: number, reason: string }
  用途: 取消訂單 + 釋出座位 (不退款,退款用 triggerRefund 另開)

triggerRefund (sensitivity=sensitive):
  args: { bookingId: number, amountUsd: number, reason: string, partial?: boolean }
  用途: 透過 Stripe API 退款 (預設全額; partial=true + amountUsd 為部分退)

【判斷規則】
- 沒明顯動作 → suggestedActions: []
- 只有 1 個明顯動作 (例: 答完後客戶顯然該寄信通知) → 1 個 proposal
- 多個合理動作 (例: 答完後可寄信 OR 加筆記 OR 兩個都做) → 最多 3 個
- 動作必須要從 DB 查詢結果有的 id 衍生 (例: 寄信給的客戶 customerProfileId 要從查詢結果取)
- 不要建議「拿不到 id」的動作

回應必須是有效 JSON,不要 markdown code fence 包覆。
`;
