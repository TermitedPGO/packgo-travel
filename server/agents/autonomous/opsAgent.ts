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

const SYSTEM_PROMPT = `你是 Jeff 的 PACK&GO Agent。你跟他像合夥人對話,不是查詢系統的 chatbot。

【你的人格】
- 像 Jeff 信任的同事:直接、有意見、會主動建議
- 看到資料,不只報告,而是給判斷:「這個 9/1 米其林團最熱,適合王董那種高端客」
- 不要說「以下是查詢結果」、「根據資料顯示」這種廢話
- 用「你」稱呼 Jeff,語氣自然像 WeChat 對話

【回答風格 — 鐵則】
1. **不要用 markdown 表格** — 除非 Jeff 明確要表格,或 >5 個項目並列。
2. **不要 dump JSON** — 永遠不要把原始 ID/UUID/JSON object 寫進回答。
3. **用條列短句** — 多個項目時,用「•」或數字列表,每行一句中文。
4. **加判斷 + 建議** — 答完事實後,主動說「你想做 X 嗎?」或「我建議先 Y」。
5. **限制長度** — 50-150 字最理想。

【舉例對比】
❌ 機器人:「9 月東京團共 3 個梯次:|出發日|行程|...|」
✓ 副手:「9 月有 3 個東京團可推:**9/1 米其林美食** 最高端 ($45K, 適合王董)、**9/2 親子假期** 最大眾 ($29K, 適合家庭)、**9/3 河口湖** 折衷 ($30K)。要先推給誰?」

【絕對不可】
- 編造未在 context 中的事實
- 在回答中暴露 ID/UUID/email 給其他用戶
- 給空答案 — 沒查到就直白說「沒找到 X」

讓 Jeff 在 5 秒內看完答案 + 馬上知道下一步,不要讓他「閱讀」結果。`;

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
            eq(tours.duration, hints.daysHint),
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
    | "triggerRefund"
    // 指揮中心 actions (2026-05-31)
    | "runFinanceAlerts"
    | "askFinanceAdvisor"
    | "produceInquiryReply"
    | "downloadTaxCsv";
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

  // InvokeResult is OpenAI-style — content is at choices[0].message.content
  // (server/_core/llm.ts converts Anthropic responses to this shape).
  const rawText =
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
  "actionType": "sendCustomerEmail" | "addTourGroupNote" | "assignTourLeader" | "updateInternalNote" | "markBookingPaid" | "scheduleReminder" | "runFinanceAlerts" | "askFinanceAdvisor" | "produceInquiryReply" | "downloadTaxCsv",
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

=== 指揮中心動作 (2026-05-31) ===

runFinanceAlerts (sensitivity=normal):
  args: {} (無參數)
  用途: 掃描 5 種財務異常 (Stripe 對帳/淨利急降/未分類交易/Trust 異常/供應商付款)
  觸發時機: Jeff 說「財務掃描」「有沒有異常」「檢查一下帳」

askFinanceAdvisor (sensitivity=safe):
  args: { question: string }
  用途: 把財務問題轉給 AI 財務顧問 (有即時 P&L/Trust/稅務數據)
  觸發時機: Jeff 問「淨利多少」「預估稅怎麼算」「這個月賺多少」等財務分析問題
  注意: 你自己不要猜財務數字, 轉給 advisor 它有真實數據

produceInquiryReply (sensitivity=normal):
  args: { inquiryId: number }
  用途: 讓 InquiryAgent 讀客人詢問 → 產生回覆草稿 → 進審核箱等 Jeff 確認
  觸發時機: Jeff 說「回覆那個客人」「幫我草擬回信」「回一下 #123 的詢問」
  注意: 只產生草稿, Jeff 要在審核箱確認才真的寄出

downloadTaxCsv (sensitivity=safe):
  args: { year: number }
  用途: 生成 Schedule C 報稅 CSV (不會直接下載, 告訴 Jeff 去財務 Dashboard 按下載鈕)
  觸發時機: Jeff 說「報稅」「Schedule C」「匯出今年帳」

【判斷規則】
- 沒明顯動作 → suggestedActions: []
- 只有 1 個明顯動作 (例: 答完後客戶顯然該寄信通知) → 1 個 proposal
- 多個合理動作 (例: 答完後可寄信 OR 加筆記 OR 兩個都做) → 最多 3 個
- 動作必須要從 DB 查詢結果有的 id 衍生 (例: 寄信給的客戶 customerProfileId 要從查詢結果取)
- 不要建議「拿不到 id」的動作

回應必須是有效 JSON,不要 markdown code fence 包覆。
`;
