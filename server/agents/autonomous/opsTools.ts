/**
 * opsTools — Read-only query tools for the PACK&GO Agent agentic loop (2026-06-01).
 *
 * This is the keystone that turns the agent from a "single-shot prefetch + LLM"
 * into a real Claude-Code-style agent: it gets a set of typed read tools and
 * calls them in a loop, deciding what to look up based on the question. This
 * fixes the "reports 15 when there are 165" bug — now it runs an actual
 * COUNT / GROUP BY instead of counting whatever slice was prefetched.
 *
 * Safety:
 *   - Every tool is READ-ONLY (SELECT only, no writes ever).
 *   - PII (email / phone) follows Jeff's rule (2026-06-01): a single-record
 *     lookup shows full contact info (he needs it to reach the customer); any
 *     multi-record result REDACTS email + phone (defends against "dump all
 *     emails" injection + persisted-chat leakage).
 *   - Results are capped + field-limited to keep token cost bounded.
 *
 * The action proposals (sendCustomerEmail, triggerRefund, classifyBank…) stay
 * in opsActions.ts — those WRITE and require Jeff's confirmation chip. These
 * tools only READ and run autonomously inside the loop.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "opsTools" });

// ── PII redaction (Jeff 2026-06-01: single full, bulk masked) ───────────────

function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const head = user.slice(0, 1);
  return `${head}***@${domain}`;
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-3)}`;
}

// ── Tool definitions (what the model sees) ──────────────────────────────────

export const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "count_records",
    description: "Count records of an entity, with optional filters. USE THIS whenever Jeff asks 'how many' / '幾個' / '幾團' / '多少'. Returns an exact total, not a sample.",
    input_schema: {
      type: "object",
      properties: {
        entity: { type: "string", enum: ["tours", "departures", "bookings", "customers"], description: "What to count" },
        status: { type: "string", description: "Optional status filter (tours: active/draft; bookings: confirmed/pending/cancelled)" },
        futureOnly: { type: "boolean", description: "departures only: count only future departures" },
        withinDays: { type: "number", description: "departures only: count departures within the next N days" },
        unpaidBalance: { type: "boolean", description: "bookings only: count confirmed bookings still on deposit (balance unpaid)" },
      },
      required: ["entity"],
    },
  },
  {
    name: "aggregate_departures",
    description: "Group future departures by a dimension and return counts per group. USE THIS for '哪個目的地最多' / 'which destination has the most' / breakdowns.",
    input_schema: {
      type: "object",
      properties: {
        groupBy: { type: "string", enum: ["destinationCountry", "month"], description: "Dimension to group by" },
        topN: { type: "number", description: "Return only the top N groups (default 10)" },
      },
      required: ["groupBy"],
    },
  },
  {
    name: "search_tours",
    description: "Search the PACK&GO tour catalog by keyword (title/destination). Returns matching active tours.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Chinese keyword, e.g. 日本/夏威夷/京都" },
        limit: { type: "number", description: "Max rows (default 10, max 25)" },
      },
      required: [],
    },
  },
  {
    name: "search_departures",
    description: "Search tour departures with availability. Filter by destination keyword and/or month. Returns departure date, price, seats left, ops status.",
    input_schema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Chinese destination keyword" },
        month: { type: "number", description: "Month 1-12" },
        year: { type: "number", description: "Year, e.g. 2026 (defaults to current)" },
        availableOnly: { type: "boolean", description: "Only departures with seats left" },
        limit: { type: "number", description: "Max rows (default 15, max 30)" },
      },
      required: [],
    },
  },
  {
    name: "search_bookings",
    description: "Search customer bookings by name and/or status. Single match shows full contact info; multiple matches redact email/phone.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Customer name (partial ok)" },
        bookingStatus: { type: "string", description: "confirmed/pending/cancelled" },
        paymentStatus: { type: "string", description: "deposit/paid/refunded" },
        limit: { type: "number", description: "Max rows (default 10, max 25)" },
      },
      required: [],
    },
  },
  {
    name: "search_customers",
    description: "Search the customer CRM by name. Single match shows full contact info; multiple matches redact email/phone.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Customer name (partial ok)" },
        limit: { type: "number", description: "Max rows (default 10, max 25)" },
      },
      required: [],
    },
  },
  {
    name: "get_finance_summary",
    description: "Get a trust-aware P&L summary (income, expenses, net profit) for a period. USE THIS for '淨利多少' / 'net profit' / financial overview questions. Numbers already exclude unrecognized trust deposits (CST §17550).",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["this_month", "last_month", "this_year"], description: "Which period (default this_month)" },
      },
      required: [],
    },
  },
  {
    name: "list_missing_receipts",
    description: "List expense transactions that have NO receipt attached yet. USE THIS when Jeff asks 哪些要 receipt / 哪些需要收據 / which expenses need a receipt. Jeff needs to provide receipts for these (IRS audit trail). Returns date, merchant, amount, category — biggest first.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows (default 20, max 50)" },
        sinceDays: { type: "number", description: "Only expenses in the last N days (default: all time)" },
      },
      required: [],
    },
  },
  {
    name: "search_supplier_inventory",
    description: "Search live Lion Travel supplier inventory by destination (for sourcing new tours to package/resell). Separate from the PACK&GO catalog.",
    input_schema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Chinese destination keyword" },
        monthsAhead: { type: "number", description: "Search window in months (default 3)" },
      },
      required: ["destination"],
    },
  },
  {
    name: "preview_customer_threads",
    description:
      "唯讀預覽某個 email 在連線 Gmail 裡的往來(不寫入任何東西)。回傳找到幾條 thread + 最近一條的對話樣本(已遮卡號)。" +
      "用在 Jeff 說「收/歸檔某客人的記錄」時:先用這個確認那個 email 是不是要收的人,把 thread 數 + 樣本講給 Jeff 聽,再出 collectCustomerThreads 動作讓他點。" +
      "絕不要自己猜 email — 名字先用 search_customers 查;查不到就請 Jeff 給 email。",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "客人的 email(必須是 Jeff 給的或 search_customers 查到的,不要編)" },
      },
      required: ["email"],
    },
  },
  {
    name: "read_customer_conversation",
    description:
      "讀某個客人在系統裡【已歸檔的真實對話】,回最後一封是誰寄的、哪天、幾天沒回、現在輪到誰回 (waiting on customer / waiting on us)、以及最近幾封訊息摘要。" +
      "Jeff 問「某客人什麼時候回我 / 進度到哪 / 上次聊到哪 / 要不要跟進」時【一定先用這個查真資料再回】,絕不憑印象編時間或進度。" +
      "查不到資料(系統還沒收他的對話)就老實跟 Jeff 說,並建議先用 collectCustomerThreads(收這個 email)把對話收進來。可用名字或 email 查。",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "客人的名字或 email" },
      },
      required: ["customer"],
    },
  },
  {
    name: "list_followups_needed",
    description:
      "列出『我們最後寄出、客人安靜超過幾天沒回』的客人(報價/行程發了沒下文,輪到客人回)。" +
      "Jeff 問「誰需要跟進 / 哪些客人沒回我 / 有哪些卡住的」用這個,讀真實對話算出來,絕不憑印象。回每位客人的 email + 幾天沒回。",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "至少安靜幾天才算(預設 3)" },
      },
      required: [],
    },
  },
  {
    name: "get_customer_documents",
    description:
      "Check a customer's documents (passport, visa, insurance) expiry status. " +
      "Use when Jeff asks '護照還有效嗎' / '簽證到期了嗎' / '文件狀態'. " +
      "NEVER expose passport numbers — only show expiry date + whether it's current.",
    input_schema: {
      type: "object",
      properties: {
        profileId: {
          type: "number",
          description: "customerProfileId (get from search_customers first)",
        },
      },
      required: ["profileId"],
    },
  },
  {
    name: "get_payment_history",
    description:
      "Get payment timeline for a booking — when deposits/balances were paid, " +
      "by what method, how much. Use when Jeff asks '付了沒' / '幾時收到' / " +
      "'還欠多少'. Requires bookingId from search_bookings.",
    input_schema: {
      type: "object",
      properties: {
        bookingId: {
          type: "number",
          description: "Booking ID (from search_bookings)",
        },
      },
      required: ["bookingId"],
    },
  },
];

// ── Write tools (Jeff 2026-06-27: 「說了就做」— direct execution, no chip) ───

export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "update_customer_note",
    description:
      "Update Jeff's private note (jeffPersonalNote) for the current customer. " +
      "Jeff says '備註加上…' or '備註改成…' → use this. The note is Jeff-only " +
      "(never shown to customer). Pass the FULL desired note text — to append, " +
      "read the current note first (search_customers), then concatenate.",
    input_schema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Full note content (replaces existing note entirely)",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "update_booking_status",
    description:
      "Update a booking's bookingStatus and/or paymentStatus. Use when Jeff " +
      "says '這筆確認了' / '標記已付款' / '取消這筆訂單'. Get the bookingId " +
      "from a prior search_bookings call first.",
    input_schema: {
      type: "object",
      properties: {
        bookingId: {
          type: "number",
          description: "Booking ID (from search_bookings)",
        },
        bookingStatus: {
          type: "string",
          enum: ["pending", "confirmed", "completed", "cancelled"],
        },
        paymentStatus: {
          type: "string",
          enum: ["unpaid", "deposit", "paid", "refunded"],
        },
      },
      required: ["bookingId"],
    },
  },
  {
    name: "collect_customer_threads",
    description:
      "收/歸檔某個客人的 Gmail 往來到系統。用在 Jeff 在某客人的對話框說「收」/「收進來」/" +
      "「歸檔他的記錄」時:直接呼叫這個工具把該客人 email 的所有 thread 收進他的檔案" +
      "(idempotent,重收只補不漏)。收完用一句話跟 Jeff 報結果(收了幾條、新增幾條)。" +
      "email 用目前這位客人的 email(系統已釘在上面),不要自己編。**收完直接報結果," +
      "不要叫 Jeff 點任何按鈕**(這個對話框沒有可點的按鈕)。",
    input_schema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "目前這位客人的 email(從釘住的客人資料拿,不要編)",
        },
      },
      required: ["email"],
    },
  },
  {
    name: "set_follow_up_date",
    description:
      "設定或清除『目前這位客人』的跟進日(只對釘住的這位客人生效)。Jeff 說「跟進日設下週三」" +
      "「下週五跟進他」「三天後提醒我跟進」「月底跟進」時用這個。把相對講法用系統給的【今天日期】" +
      "換算成絕對日期 YYYY-MM-DD,換算後自己核對星期對不對;清除就傳 clear=true。設定後跟進日會顯示" +
      "在客戶頁真相條,到日當天跳『今天該跟進』。設完用一句話跟 Jeff 確認(設了哪天 / 已清除)。",
    input_schema: {
      type: "object",
      properties: {
        followUpDate: {
          type: "string",
          description: "跟進日 YYYY-MM-DD(從【今天日期】把『下週三/三天後/月底』換算成絕對日期)。清除時免填。",
        },
        clear: { type: "boolean", description: "true = 清除這位客人的跟進日" },
      },
      required: [],
    },
  },
];

export const CREATE_CUSTOMER_TOOL: Anthropic.Tool = {
  name: "create_customer",
  description:
    "Create a new customer profile. Use when Jeff says '新增客人' / " +
    "'加一個客人' / drags a file with customer info. Extract name + at " +
    "least one of email or phone from the conversation or attached file. " +
    "Returns the new profile id on success.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Customer display name" },
      email: { type: "string", description: "Email (optional if phone given)" },
      phone: { type: "string", description: "Phone (optional if email given)" },
    },
    required: ["name"],
  },
};

export const WRITE_TOOL_NAMES = new Set([...WRITE_TOOLS, CREATE_CUSTOMER_TOOL].map((t) => t.name));

// ── Executor ────────────────────────────────────────────────────────────────

const clamp = (n: number | undefined, def: number, max: number) =>
  Math.min(Math.max(1, n ?? def), max);

/**
 * Execute one read tool. Returns a compact JSON string the model reads as a
 * tool_result. Never throws — returns an { error } object string instead so
 * the loop keeps going.
 */
export async function executeReadTool(
  name: string,
  input: any,
): Promise<string> {
  try {
    const result = await runTool(name, input ?? {});
    return JSON.stringify(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ name, err: msg }, "[opsTools] read tool failed");
    return JSON.stringify({ error: msg });
  }
}

// ── Slice 3: structured cards for the chat-first UI ────────────────────────
// The OpsAgent renders data as cards in the conversation, not just markdown.
// toCard() maps a read tool's structured result → a typed card the frontend
// knows how to render. Returns null for non-cardable tools / empty results.
export type OpsCard =
  | { type: "departures"; items: any[] }
  | { type: "bookings"; items: any[] }
  | { type: "customers"; items: any[] }
  | {
      type: "finance";
      period: string;
      income: number;
      expenses: number;
      netProfit: number;
      trustDeferredIncome: number;
      missingReceiptCount: number;
    };

export function toCard(name: string, data: any): OpsCard | null {
  if (!data || data.error) return null;
  switch (name) {
    case "search_departures":
      if (!Array.isArray(data.departures) || data.departures.length === 0) return null;
      return {
        type: "departures",
        items: data.departures.slice(0, 6).map((d: any) => ({
          id: d.id,
          title: d.title,
          country: d.country,
          date: d.departureDate,
          seatsLeft: d.seatsLeft,
          totalSlots: d.totalSlots,
          opsStatus: d.opsStatus,
          tourLeader: d.tourLeader,
        })),
      };
    case "search_bookings":
      if (!Array.isArray(data.bookings) || data.bookings.length === 0) return null;
      return {
        type: "bookings",
        items: data.bookings.slice(0, 6).map((b: any) => ({
          id: b.id,
          customerName: b.customerName,
          tourTitle: b.tourTitle,
          date: b.departureDate,
          totalPrice: b.totalPrice,
          paymentStatus: b.paymentStatus,
          bookingStatus: b.bookingStatus,
        })),
      };
    case "search_customers":
      if (!Array.isArray(data.customers) || data.customers.length === 0) return null;
      return {
        type: "customers",
        items: data.customers.slice(0, 6).map((c: any) => ({
          id: c.id,
          email: c.email,
          budgetTier: c.budgetTier,
          bookingCount: c.bookingCount,
          totalSpend: c.totalSpend,
          vipScore: c.vipScore,
        })),
      };
    case "get_finance_summary":
      return {
        type: "finance",
        period: data.period,
        income: data.income,
        expenses: data.expenses,
        netProfit: data.netProfit,
        trustDeferredIncome: data.trustDeferredIncome,
        missingReceiptCount: data.missingReceiptCount,
      };
    default:
      return null;
  }
}

async function runTool(name: string, input: any): Promise<unknown> {
  const { getDb } = await import("../../db");
  const { tours, tourDepartures, bookings, customerProfiles, bankTransactions } =
    await import("../../../drizzle/schema");
  const { eq, and, or, gte, lte, sql, desc, like, isNull } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { error: "database unavailable" };

  switch (name) {
    case "count_records": {
      const entity = input.entity as string;
      if (entity === "tours") {
        const conds = [];
        if (input.status) conds.push(eq(tours.status, input.status));
        const [r] = await db
          .select({ n: sql<number>`count(*)` })
          .from(tours)
          .where(conds.length ? and(...conds) : undefined);
        return { entity, count: Number(r?.n ?? 0), filter: input.status ?? "all" };
      }
      if (entity === "departures") {
        const conds = [];
        if (input.futureOnly || input.withinDays) conds.push(gte(tourDepartures.departureDate, new Date()));
        if (input.withinDays) {
          const end = new Date(Date.now() + input.withinDays * 86400000);
          conds.push(lte(tourDepartures.departureDate, end));
        }
        const [r] = await db
          .select({ n: sql<number>`count(*)` })
          .from(tourDepartures)
          .where(conds.length ? and(...conds) : undefined);
        return { entity, count: Number(r?.n ?? 0), filter: { futureOnly: !!input.futureOnly, withinDays: input.withinDays ?? null } };
      }
      if (entity === "bookings") {
        const conds = [];
        if (input.status) conds.push(eq(bookings.bookingStatus, input.status));
        if (input.unpaidBalance) {
          conds.push(eq(bookings.paymentStatus, "deposit"));
          conds.push(eq(bookings.bookingStatus, "confirmed"));
        }
        const [r] = await db
          .select({ n: sql<number>`count(*)` })
          .from(bookings)
          .where(conds.length ? and(...conds) : undefined);
        return { entity, count: Number(r?.n ?? 0), filter: { status: input.status ?? "all", unpaidBalance: !!input.unpaidBalance } };
      }
      if (entity === "customers") {
        const [r] = await db.select({ n: sql<number>`count(*)` }).from(customerProfiles);
        return { entity, count: Number(r?.n ?? 0) };
      }
      return { error: `unknown entity: ${entity}` };
    }

    case "aggregate_departures": {
      const topN = clamp(input.topN, 10, 30);
      if (input.groupBy === "destinationCountry") {
        const rows = await db
          .select({ g: tours.destinationCountry, n: sql<number>`count(*)` })
          .from(tourDepartures)
          .leftJoin(tours, eq(tourDepartures.tourId, tours.id))
          .where(gte(tourDepartures.departureDate, new Date()))
          .groupBy(tours.destinationCountry)
          .orderBy(desc(sql`count(*)`))
          .limit(topN);
        return { groupBy: "destinationCountry", groups: rows.map((r) => ({ group: r.g ?? "(未分類)", count: Number(r.n) })) };
      }
      // month
      const rows = await db
        .select({ g: sql<string>`DATE_FORMAT(${tourDepartures.departureDate}, '%Y-%m')`, n: sql<number>`count(*)` })
        .from(tourDepartures)
        .where(gte(tourDepartures.departureDate, new Date()))
        .groupBy(sql`DATE_FORMAT(${tourDepartures.departureDate}, '%Y-%m')`)
        .orderBy(sql`DATE_FORMAT(${tourDepartures.departureDate}, '%Y-%m')`)
        .limit(topN);
      return { groupBy: "month", groups: rows.map((r) => ({ group: r.g, count: Number(r.n) })) };
    }

    case "search_tours": {
      const limit = clamp(input.limit, 10, 25);
      const conds = [eq(tours.status, "active")];
      if (input.keyword) {
        conds.push(
          or(
            like(tours.title, `%${input.keyword}%`),
            like(tours.destinationCountry, `%${input.keyword}%`),
            like(tours.destinationCity, `%${input.keyword}%`),
          )!,
        );
      }
      const rows = await db
        .select({ id: tours.id, title: tours.title, country: tours.destinationCountry, city: tours.destinationCity, duration: tours.duration })
        .from(tours)
        .where(and(...conds))
        .limit(limit);
      return { count: rows.length, tours: rows };
    }

    case "search_departures": {
      const limit = clamp(input.limit, 15, 30);
      const conds = [gte(tourDepartures.departureDate, new Date())];
      if (input.destination) {
        conds.push(
          or(
            like(tours.destinationCountry, `%${input.destination}%`),
            like(tours.destinationCity, `%${input.destination}%`),
            like(tours.title, `%${input.destination}%`),
          )!,
        );
      }
      if (input.month) {
        const year = input.year ?? new Date().getFullYear();
        const start = new Date(year, input.month - 1, 1);
        const end = new Date(year, input.month, 0, 23, 59, 59);
        conds.push(gte(tourDepartures.departureDate, start));
        conds.push(lte(tourDepartures.departureDate, end));
      }
      let rows = await db
        .select({
          id: tourDepartures.id,
          title: tours.title,
          country: tours.destinationCountry,
          departureDate: tourDepartures.departureDate,
          price: tourDepartures.adultPrice,
          totalSlots: tourDepartures.totalSlots,
          bookedSlots: tourDepartures.bookedSlots,
          opsStatus: tourDepartures.opsStatus,
          tourLeader: tourDepartures.tourLeader,
        })
        .from(tourDepartures)
        .leftJoin(tours, eq(tourDepartures.tourId, tours.id))
        .where(and(...conds))
        .orderBy(tourDepartures.departureDate)
        .limit(input.availableOnly ? 100 : limit);
      if (input.availableOnly) {
        rows = rows.filter((r) => (r.totalSlots ?? 0) - (r.bookedSlots ?? 0) > 0).slice(0, limit);
      }
      return {
        count: rows.length,
        departures: rows.map((r) => ({
          ...r,
          seatsLeft: (r.totalSlots ?? 0) - (r.bookedSlots ?? 0),
        })),
      };
    }

    case "search_bookings": {
      const limit = clamp(input.limit, 10, 25);
      const conds = [];
      if (input.customerName) conds.push(like(bookings.customerName, `%${input.customerName}%`));
      if (input.bookingStatus) conds.push(eq(bookings.bookingStatus, input.bookingStatus));
      if (input.paymentStatus) conds.push(eq(bookings.paymentStatus, input.paymentStatus));
      const rows = await db
        .select({
          id: bookings.id,
          customerName: bookings.customerName,
          email: bookings.customerEmail,
          phone: bookings.customerPhone,
          totalPrice: bookings.totalPrice,
          paymentStatus: bookings.paymentStatus,
          bookingStatus: bookings.bookingStatus,
          tourTitle: tours.title,
          departureDate: tourDepartures.departureDate,
        })
        .from(bookings)
        .leftJoin(tours, eq(bookings.tourId, tours.id))
        .leftJoin(tourDepartures, eq(bookings.departureId, tourDepartures.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(bookings.createdAt))
        .limit(limit);
      const single = rows.length === 1;
      return {
        count: rows.length,
        piiMasked: !single,
        bookings: rows.map((r) => ({
          ...r,
          email: single ? r.email : maskEmail(r.email),
          phone: single ? r.phone : maskPhone(r.phone),
        })),
      };
    }

    case "search_customers": {
      const limit = clamp(input.limit, 10, 25);
      const conds = [];
      if (input.name) {
        conds.push(
          or(
            like(customerProfiles.aiNotes, `%${input.name}%`),
            like(customerProfiles.email, `%${input.name}%`),
          )!,
        );
      }
      const rows = await db
        .select({
          id: customerProfiles.id,
          email: customerProfiles.email,
          phone: customerProfiles.phone,
          budgetTier: customerProfiles.budgetTier,
          bookingCount: customerProfiles.bookingCount,
          totalSpend: customerProfiles.totalSpend,
          vipScore: customerProfiles.vipScore,
        })
        .from(customerProfiles)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(customerProfiles.vipScore))
        .limit(limit);
      const single = rows.length === 1;
      return {
        count: rows.length,
        piiMasked: !single,
        customers: rows.map((r) => ({
          ...r,
          email: single ? r.email : maskEmail(r.email),
          phone: single ? r.phone : maskPhone(r.phone),
        })),
      };
    }

    case "get_finance_summary": {
      const { generateBankPL } = await import("../../services/bankPLService");
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      let startDate: string, endDate: string, label: string;
      if (input.period === "last_month") {
        const ly = m === 0 ? y - 1 : y;
        const lm = m === 0 ? 11 : m - 1;
        startDate = `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
        endDate = `${ly}-${String(lm + 1).padStart(2, "0")}-${String(new Date(ly, lm + 1, 0).getDate()).padStart(2, "0")}`;
        label = "last_month";
      } else if (input.period === "this_year") {
        startDate = `${y}-01-01`;
        endDate = `${y}-12-31`;
        label = "this_year";
      } else {
        startDate = `${y}-${String(m + 1).padStart(2, "0")}-01`;
        endDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
        label = "this_month";
      }
      const pl = await generateBankPL({ startDate, endDate });
      // How many expenses in this period still need a receipt (Jeff 2026-06-01:
      // finance must proactively flag missing receipts).
      const effCat = sql`COALESCE(${bankTransactions.jeffOverrideCategory}, ${bankTransactions.agentCategory})`;
      const EXPENSE_CATS = ["cogs_tour", "cogs_other", "expense_marketing", "expense_software", "expense_office", "expense_travel"];
      const [rc] = await db
        .select({ n: sql<number>`count(*)` })
        .from(bankTransactions)
        .where(and(
          eq(bankTransactions.excludeFromAccounting, 0),
          eq(bankTransactions.isPending, 0),
          isNull(bankTransactions.receiptUrl),
          gte(bankTransactions.date, startDate as any),
          lte(bankTransactions.date, endDate as any),
          sql`${effCat} IN (${sql.join(EXPENSE_CATS.map((c) => sql`${c}`), sql`, `)})`,
        ));
      return {
        period: label,
        range: { startDate, endDate },
        income: Number(pl.income.total.toFixed(2)),
        expenses: Number(pl.expenses.total.toFixed(2)),
        netProfit: Number(pl.netProfit.toFixed(2)),
        trustDeferredIncome: Number(pl.trustDeferredIncome.toFixed(2)),
        needsReviewCount: pl.needsReviewCount,
        missingReceiptCount: Number(rc?.n ?? 0),
        note: "trust-aware: 已扣除未認列的客人訂金 (CST §17550)。missingReceiptCount = 這期間還沒附收據的支出筆數,提醒 Jeff 補。",
      };
    }

    case "list_missing_receipts": {
      const limit = clamp(input.limit, 20, 50);
      // Expense = effective category (jeff override → agent) is an expense type.
      const EXPENSE_CATS = [
        "cogs_tour", "cogs_other", "expense_marketing",
        "expense_software", "expense_office", "expense_travel",
      ];
      const effCat = sql`COALESCE(${bankTransactions.jeffOverrideCategory}, ${bankTransactions.agentCategory})`;
      const conds = [
        eq(bankTransactions.excludeFromAccounting, 0),
        eq(bankTransactions.isPending, 0),
        isNull(bankTransactions.receiptUrl),
        sql`${effCat} IN (${sql.join(EXPENSE_CATS.map((c) => sql`${c}`), sql`, `)})`,
      ];
      if (input.sinceDays) {
        const since = new Date(Date.now() - input.sinceDays * 86400000)
          .toISOString().slice(0, 10);
        conds.push(gte(bankTransactions.date, since as any));
      }
      // Count total missing (so the agent can say "共 N 筆")
      const [cnt] = await db
        .select({ n: sql<number>`count(*)` })
        .from(bankTransactions)
        .where(and(...conds));
      const rows = await db
        .select({
          id: bankTransactions.id,
          date: bankTransactions.date,
          merchant: bankTransactions.merchantName,
          description: bankTransactions.description,
          amount: bankTransactions.amount,
          category: effCat,
        })
        .from(bankTransactions)
        .where(and(...conds))
        .orderBy(sql`ABS(${bankTransactions.amount}) DESC`)
        .limit(limit);
      return {
        totalMissing: Number(cnt?.n ?? 0),
        showing: rows.length,
        note: "這些支出還沒附 receipt — Jeff 需要補收據 (IRS 稽核用)",
        transactions: rows.map((r) => ({
          id: r.id,
          date: r.date,
          merchant: r.merchant || r.description?.slice(0, 40) || "(無商家名)",
          amount: r.amount,
          category: r.category,
        })),
      };
    }

    case "search_supplier_inventory": {
      const { searchProducts } = await import("../../suppliers/lionClient");
      const now = new Date();
      const monthsAhead = clamp(input.monthsAhead, 3, 12);
      const future = new Date(now.getTime() + monthsAhead * 30 * 86400000);
      const fmt = (d: Date) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
      const res = await searchProducts({
        goDateStart: fmt(now),
        goDateEnd: fmt(future),
        keywords: input.destination,
        page: 1,
        pageSize: 10,
      });
      return {
        source: "Lion Travel (live)",
        count: (res.NormGroupList ?? []).length,
        products: (res.NormGroupList ?? []).slice(0, 8).map((g: any) => ({
          name: g.GroupName,
          departureDate: g.GoDate,
          price: g.SalePrice,
          days: g.Days,
          status: g.IsSold ? "sold" : "available",
        })),
      };
    }

    case "preview_customer_threads": {
      const email = String(input.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: "需要一個有效的 email(請 Jeff 提供,不要自己編)" };
      }
      const { gmailIntegration } = await import("../../../drizzle/schema");
      const { buildGmailClient } = await import("../../_core/gmail");
      const { previewCustomerThreads } = await import("../../_core/customerBackfill");
      const integrations = await db
        .select()
        .from(gmailIntegration)
        .where(eq(gmailIntegration.isActive, 1));
      if (integrations.length === 0) {
        return { email, threadsSeen: 0, mailboxes: [], sample: [], note: "沒有連線中的 Gmail 帳號" };
      }
      let threadsSeen = 0;
      const mailboxes: Array<{ mailbox: string; threadsSeen: number }> = [];
      let sample: Array<{ date: string; direction: string; snippet: string }> = [];
      for (const integ of integrations) {
        try {
          const gmail = buildGmailClient(integ);
          const pv = await previewCustomerThreads(gmail, integ.emailAddress, email);
          threadsSeen += pv.threadsSeen;
          mailboxes.push({ mailbox: integ.emailAddress, threadsSeen: pv.threadsSeen });
          // Show one sample (from the first mailbox that has any).
          if (sample.length === 0 && pv.sample.length > 0) {
            sample = pv.sample.map((s) => ({
              date: s.date.toISOString().slice(0, 10),
              direction: s.direction,
              snippet: s.snippet,
            }));
          }
        } catch (e) {
          mailboxes.push({ mailbox: integ.emailAddress, threadsSeen: 0 });
          log.warn({ name, email, err: e instanceof Error ? e.message : String(e) }, "[opsTools] preview one mailbox failed");
        }
      }
      return {
        email,
        threadsSeen,
        mailboxes,
        sample,
        note:
          threadsSeen === 0
            ? "這個 email 在連線信箱裡找不到往來,可能拼錯或不在這兩個帳號。"
            : undefined,
      };
    }

    case "read_customer_conversation": {
      const q = String(input.customer ?? "").trim();
      if (!q) return { error: "需要客人名字或 email" };
      const { customerInteractions } = await import("../../../drizzle/schema");
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);

      // Resolve to a single profile (never guess; ask Jeff to disambiguate).
      let profile: { id: number; email: string | null } | undefined;
      if (isEmail) {
        profile = (
          await db
            .select({ id: customerProfiles.id, email: customerProfiles.email })
            .from(customerProfiles)
            .where(eq(customerProfiles.email, q.toLowerCase()))
            .limit(1)
        )[0];
      } else {
        const matches = await db
          .select({ id: customerProfiles.id, email: customerProfiles.email })
          .from(customerProfiles)
          .where(or(like(customerProfiles.aiNotes, `%${q}%`), like(customerProfiles.email, `%${q}%`))!)
          .limit(5);
        if (matches.length === 1) profile = matches[0];
        else if (matches.length > 1) {
          return {
            found: false,
            note: "對到多位客人,請改用 email 指定(或先 search_customers 確認),不要自己挑。",
            candidates: matches.map((m) => ({ profileId: m.id, email: maskEmail(m.email) })),
          };
        }
      }
      if (!profile) {
        return {
          found: false,
          note: `系統裡還沒有「${q}」的對話。先用 collectCustomerThreads(收這個 email)把對話收進來,我才讀得到。在收進來之前,不要憑印象回答他的進度或回信時間。`,
        };
      }

      const rows = await db
        .select({
          direction: customerInteractions.direction,
          content: customerInteractions.content,
          contentSummary: customerInteractions.contentSummary,
          createdAt: customerInteractions.createdAt,
        })
        .from(customerInteractions)
        .where(eq(customerInteractions.customerProfileId, profile.id))
        .orderBy(desc(customerInteractions.createdAt))
        .limit(40);

      if (rows.length === 0) {
        return {
          found: true,
          profileId: profile.id,
          email: profile.email,
          totalMessages: 0,
          note: "這位客人有檔案但系統裡沒有任何對話訊息;可能還沒收 Gmail。不要編進度。",
        };
      }

      const snippet = (r: { content: string; contentSummary: string | null }) =>
        (r.contentSummary || r.content || "").replace(/\s+/g, " ").trim().slice(0, 140);
      const newest = rows[0]; // newest-first
      const dayMs = 24 * 60 * 60 * 1000;
      const daysSinceLast = Math.floor((Date.now() - new Date(newest.createdAt).getTime()) / dayMs);
      const ballInCourt = newest.direction === "outbound" ? "customer" : "us";
      return {
        found: true,
        profileId: profile.id,
        email: profile.email,
        totalMessages: rows.length >= 40 ? "40+" : rows.length,
        lastMessage: {
          direction: newest.direction,
          date: new Date(newest.createdAt).toISOString().slice(0, 10),
          daysSinceLast,
          snippet: snippet(newest),
        },
        ballInCourt,
        ballHint:
          ballInCourt === "customer"
            ? `最後一封是我們寄出的,在等客人回(已 ${daysSinceLast} 天沒下文)`
            : `最後一封是客人寄來的,我們還沒回他(已 ${daysSinceLast} 天)`,
        recent: rows.slice(0, 6).map((r) => ({
          direction: r.direction,
          date: new Date(r.createdAt).toISOString().slice(0, 10),
          snippet: snippet(r),
        })),
      };
    }

    case "list_followups_needed": {
      const { findStaleQuotedCustomers } = await import("../../_core/followupScan");
      const minDays = clamp(input.days, 3, 60);
      const list = await findStaleQuotedCustomers(db, { minDays });
      return {
        count: list.length,
        customers: list.map((c) => ({
          email: c.email,
          daysSilent: c.daysSince,
          lastContact: c.lastDate.toISOString().slice(0, 10),
        })),
        note:
          list.length === 0
            ? "目前沒有卡住的客人(最近寄出的都還在合理等待範圍內,或客人都有回)。"
            : "這些是我們最後寄出、客人還沒回的。要跟進哪一個就跟我說,我可以幫你草擬。",
      };
    }

    case "get_customer_documents": {
      const { customerDocuments } = await import("../../../drizzle/schema");
      const profileId = input.profileId;
      if (!profileId) return { error: "missing profileId" };
      const docs = await db
        .select({
          type: customerDocuments.type,
          fileName: customerDocuments.fileName,
          expiresAt: customerDocuments.expiresAt,
          isCurrent: customerDocuments.isCurrent,
        })
        .from(customerDocuments)
        .where(eq(customerDocuments.customerProfileId, profileId))
        .orderBy(desc(customerDocuments.uploadedAt))
        .limit(20);
      if (!docs.length) return { found: false, note: "這位客人沒有上傳過證件文件。" };
      const now = new Date();
      return {
        found: true,
        documents: docs.map((d) => ({
          type: d.type,
          fileName: d.fileName,
          expiresAt: d.expiresAt ? new Date(d.expiresAt).toISOString().slice(0, 10) : null,
          isCurrent: d.isCurrent,
          isExpired: d.expiresAt ? new Date(d.expiresAt) < now : null,
        })),
      };
    }

    case "get_payment_history": {
      const { payments, bookings: bk } = await import("../../../drizzle/schema");
      const bookingId = input.bookingId;
      if (!bookingId) return { error: "missing bookingId" };
      const [booking] = await db
        .select({
          totalPrice: bk.totalPrice,
          currency: bk.currency,
          paymentStatus: bk.paymentStatus,
          bookingStatus: bk.bookingStatus,
        })
        .from(bk)
        .where(eq(bk.id, bookingId))
        .limit(1);
      if (!booking) return { error: `booking #${bookingId} not found` };
      const paymentRows = await db
        .select({
          amount: payments.amount,
          currency: payments.currency,
          paymentMethod: payments.paymentMethod,
          paymentType: payments.paymentType,
          paymentStatus: payments.paymentStatus,
          paidAt: payments.paidAt,
          notes: payments.notes,
        })
        .from(payments)
        .where(eq(payments.bookingId, bookingId))
        .orderBy(payments.paidAt);
      const totalPaid = paymentRows
        .filter((p) => p.paymentStatus === "completed")
        .reduce((s, p) => s + p.amount, 0);
      const totalPrice = Number(booking.totalPrice) || 0;
      return {
        bookingId,
        bookingStatus: booking.bookingStatus,
        paymentStatus: booking.paymentStatus,
        totalPrice,
        currency: booking.currency,
        totalPaid,
        balance: totalPrice - totalPaid,
        payments: paymentRows.map((p) => ({
          type: p.paymentType,
          amount: p.amount,
          method: p.paymentMethod,
          status: p.paymentStatus,
          paidAt: p.paidAt ? new Date(p.paidAt).toISOString().slice(0, 10) : null,
          notes: p.notes,
        })),
      };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}

// ── Write tool executor ───────────────────────────────────────────────────

/**
 * Pure validator for set_follow_up_date input. `clear:true` → null (clear);
 * otherwise `followUpDate` must be a REAL YYYY-MM-DD calendar day (rejects e.g.
 * 2026-02-30). Returned errors are fed back to the model as a tool_result so it
 * can correct itself (e.g. recompute the date) without a hard failure. Pure so
 * the date guard is unit-tested without a DB (local has no DATABASE_URL).
 */
export function resolveFollowUpDateArg(
  input: { followUpDate?: unknown; clear?: unknown } | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input?.clear === true) return { ok: true, value: null };
  const raw = typeof input?.followUpDate === "string" ? input.followUpDate.trim() : "";
  if (!raw) return { ok: false, error: "需要 followUpDate(YYYY-MM-DD),或傳 clear=true 清除" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return { ok: false, error: `日期格式要 YYYY-MM-DD,收到「${raw}」` };
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw)
    return { ok: false, error: `不是有效日期:${raw}` };
  return { ok: true, value: raw };
}

export async function executeWriteTool(
  name: string,
  input: any,
  profileId: number | undefined,
): Promise<string> {
  try {
    const result = await runWriteTool(name, input, profileId);
    return JSON.stringify(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ name, err: msg }, "[opsTools] write tool failed");
    return JSON.stringify({ error: msg });
  }
}

async function runWriteTool(
  name: string,
  input: any,
  profileId: number | undefined,
): Promise<unknown> {
  const { getDb } = await import("../../db");
  const { customerProfiles } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { error: "database unavailable" };

  switch (name) {
    case "update_customer_note": {
      if (!profileId) return { error: "no customer selected" };
      const note = (input.note ?? "").trim();
      await db
        .update(customerProfiles)
        .set({ jeffPersonalNote: note || null, updatedAt: new Date() })
        .where(eq(customerProfiles.id, profileId));
      log.info({ profileId, noteLen: note.length }, "update_customer_note executed");
      return { success: true, message: "備註已更新" };
    }

    case "update_booking_status": {
      const bookingId = input.bookingId;
      if (!bookingId) return { error: "missing bookingId" };
      const updates: Record<string, any> = {};
      if (input.bookingStatus) updates.bookingStatus = input.bookingStatus;
      if (input.paymentStatus) updates.paymentStatus = input.paymentStatus;
      if (Object.keys(updates).length === 0)
        return { error: "no status fields provided" };
      const { updateBooking } = await import("../../db/booking");
      const updated = await updateBooking(bookingId, updates);
      log.info({ bookingId, updates }, "update_booking_status executed");
      return {
        success: true,
        message: `訂單 #${bookingId} 已更新`,
        bookingStatus: updated.bookingStatus,
        paymentStatus: updated.paymentStatus,
      };
    }

    case "create_customer": {
      const cName = (input.name ?? "").trim();
      if (!cName) return { error: "name is required" };
      const cEmail = (input.email ?? "").trim() || undefined;
      const cPhone = (input.phone ?? "").trim() || undefined;
      if (!cEmail && !cPhone) return { error: "email or phone required" };
      if (cEmail && !/^\S+@\S+\.\S+$/.test(cEmail))
        return { error: "invalid email format" };
      // Dedup before insert — the tRPC createManualCustomer guards against a
      // same-email/phone profile, but THIS agent path was missing it, so asking
      // the AI to「新增客人」for someone we already have made a duplicate empty
      // profile (Emerald Young, 2026-06-30). Return the existing one (oldest
      // first = the original, with the real history) instead of creating a 2nd.
      if (cEmail || cPhone) {
        const [dup] = await db
          .select({ id: customerProfiles.id, name: customerProfiles.name })
          .from(customerProfiles)
          .where(cEmail ? eq(customerProfiles.email, cEmail) : eq(customerProfiles.phone, cPhone!))
          .orderBy(customerProfiles.createdAt)
          .limit(1);
        if (dup) {
          log.info({ profileId: dup.id, name: cName }, "create_customer deduped → existing");
          return {
            success: true,
            profileId: dup.id,
            deduped: true,
            message: `客人「${dup.name ?? cName}」已經有檔案了,直接用既有的(沒有重複建立)`,
          };
        }
      }
      const [row] = await db
        .insert(customerProfiles)
        .values({
          name: cName,
          email: cEmail ?? null,
          phone: cPhone ?? null,
          source: "manual",
        } as any)
        .$returningId();
      log.info({ profileId: row.id, name: cName }, "create_customer executed");
      return { success: true, profileId: row.id, message: `已新增客人「${cName}」` };
    }

    case "collect_customer_threads": {
      const cEmail = (input.email ?? "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(cEmail))
        return { error: "需要一個有效的客人 email(不要自己編)" };
      const { doCollectCustomerThreads } = await import("./opsActions");
      const r = await doCollectCustomerThreads({ email: cEmail });
      log.info({ email: cEmail, ok: r.ok }, "collect_customer_threads executed");
      if (!r.ok) return { error: r.summary || r.error || "收進失敗" };
      return { success: true, message: r.summary, details: r.details };
    }

    case "set_follow_up_date": {
      if (!profileId) return { error: "no customer selected" };
      const parsed = resolveFollowUpDateArg(input);
      if (!parsed.ok) return { error: parsed.error };
      await db
        .update(customerProfiles)
        .set({ followUpDate: parsed.value })
        .where(eq(customerProfiles.id, profileId));
      log.info({ profileId, followUpDate: parsed.value }, "set_follow_up_date executed");
      return {
        success: true,
        followUpDate: parsed.value,
        message: parsed.value ? `跟進日設為 ${parsed.value}` : "跟進日已清除",
      };
    }

    default:
      return { error: `unknown write tool: ${name}` };
  }
}
