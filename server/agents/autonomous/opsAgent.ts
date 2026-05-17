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

/**
 * Main entry — takes a natural-language question, returns the agent's answer.
 */
export async function runOpsAgent(question: string): Promise<{
  answer: string;
  contextUsed: Record<string, unknown>;
  hints: ReturnType<typeof extractHints>;
}> {
  const hints = extractHints(question);
  const ctx = await fetchOpsContext(hints);

  // Estimate context size — truncate if huge to stay within 8K tokens
  const ctxStr = JSON.stringify(ctx, null, 2);
  const truncated = ctxStr.length > 12000 ? ctxStr.slice(0, 12000) + "\n…(truncated)" : ctxStr;

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 1024,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content:
          `【Jeff 的問題】\n${question}\n\n` +
          `【系統從你的問題抽出的線索】\n` +
          `客戶名: ${hints.customerNameHints.join(", ") || "(無)"}\n` +
          `目的地: ${hints.destinationHints.join(", ") || "(無)"}\n` +
          `日期: ${hints.dateHint ? JSON.stringify(hints.dateHint) : "(無)"}\n` +
          `天數: ${hints.daysHint ?? "(無)"}\n\n` +
          `【DB 查詢結果】\n${truncated}\n\n` +
          `請依此回答 Jeff 的問題。如果資料庫沒有相關結果,誠實說「沒查到」+建議下一步。`,
      },
    ],
  });

  const text =
    (response?.content?.[0] as any)?.text ||
    response?.choices?.[0]?.message?.content ||
    "(no response)";

  return {
    answer: typeof text === "string" ? text : String(text),
    contextUsed: ctx,
    hints,
  };
}
