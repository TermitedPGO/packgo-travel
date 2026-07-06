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
// laToday / mergeCustomerNote moved to _core/customerMerge (2026-07-02 G2)
// with the merge core; re-exported below so existing importers/tests keep
// their `from "./opsTools"` path.
import { laToday, mergeCustomerNote } from "../../_core/customerMerge";

export { mergeCustomerNote };

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
    description:
      "Search the customer CRM by name (matches 檔案名字 / email / AI 筆記). Single match shows full contact info; multiple matches redact email/phone. " +
      "合併場景注意:查不到目標客人不代表不存在(可能是已隱藏的檔案),merge_into_customer 可直接用 targetName / targetProfileId 指定,含隱藏檔。",
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
  {
    name: "list_customer_promises",
    description:
      "列出『目前釘住的這位客人』所有還沒兌現、也沒被撤銷的承諾(系統從寄出的信裡自動抽出的)," +
      "每則附 id、承諾原文、到期日(dueDate,可能是 null——代表系統解不出具體日期,承諾仍存在只是" +
      "看門狗不會因為它跳卡)、來源信的寄出日期。" +
      "**Jeff 說『這個承諾兌現了』『那件事處理好了』『不用管了』『撤銷這個提醒』時,先呼叫這個工具" +
      "拿到正確的 promiseId,再呼叫 mark_promise —— 絕不用猜的編號直接呼叫 mark_promise。** " +
      "只看目前釘住的這位客人,不接受、也不需要指定其他客人。清單是空的就老實說沒有未兌現的承諾。",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ── Write tools (Jeff 2026-06-27: 「說了就做」— direct execution, no chip) ───

export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "update_customer_note",
    description:
      "Add to Jeff's private note (jeffPersonalNote) for the current customer. " +
      "Jeff says '備註加上…' → pass ONLY the new text; the tool itself appends " +
      "it under the existing note as a dated line, so the old note is always " +
      "preserved (you don't need to — and can't — read it first). Jeff says " +
      "'備註改成…' / '整個換掉' / '清掉備註' → pass replace:true to overwrite " +
      "the whole field. The note is Jeff-only (never shown to customer). The " +
      "result message echoes the FULL note after the change so Jeff sees what " +
      "it now says.",
    input_schema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description:
            "New note text. Appended to the existing note by default; with " +
            "replace:true it becomes the entire note.",
        },
        replace: {
          type: "boolean",
          description:
            "true = overwrite the ENTIRE note with `note` (only when Jeff " +
            "explicitly says 改成/換掉/清掉). Default false = append.",
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
      "from a prior search_bookings call first. Only works on bookings that " +
      "belong to the CURRENT pinned customer — other customers' bookings are " +
      "rejected. Refunds can NEVER be marked here: propose them via " +
      "suggest_action so Jeff reviews.",
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
          enum: ["unpaid", "deposit", "paid"],
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
      "email 用目前這位客人的 email(系統已釘在上面),不要自己編 — 釘住的客人檔案上有 " +
      "email 時只收得了那一個,給別的地址(例如轉寄信裡的 cc / 第三方寄件人)會被拒。" +
      "**收完直接報結果,不要叫 Jeff 點任何按鈕**(這個對話框沒有可點的按鈕)。",
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
          description:
            "跟進日。首選 YYYY-MM-DD(從【今天日期】把『下週三/三天後/月底』換算成絕對日期);" +
            "也接受 M/D、MM/DD、M-D 簡寫(例「7/21」),年份會以洛杉磯的今天自動推:該月日還沒過(或就是今天)算今年,已過算明年。" +
            "非法日(例 2/30)會被拒。清除時免填。",
        },
        clear: { type: "boolean", description: "true = 清除這位客人的跟進日" },
      },
      required: [],
    },
  },
  {
    name: "create_custom_order",
    description:
      "為『目前這位客人』建立一張獨立訂製單(=客戶頁上的一個專案 / ProjectBar 一個 chip)。" +
      "用在 Jeff 說「幫這幾筆機票建單」「補進去」「開一張簽證單」「這個案子開個專案」時。" +
      "適用單獨的機票 / 簽證 / 報價 / 一般諮詢 — 這類不需要掛在出團團期(tourDeparture)上," +
      "所以不要用 booking / update_booking_status,直接用這個工具建 customOrder。" +
      "一次只建一張;要建多張(例如同一位協調人底下好幾筆機票)就連續呼叫多次,每筆各一張。" +
      "title 用一眼看懂的短描述(例:『劉衛國 PEK-SFO 商務艙機票』『Jeff Green 中國簽證』)。" +
      "category 分四類:flight=機票 / visa=簽證 / quote=報價行程 / general=一般諮詢。" +
      "totalPrice 是直客售價(選填);supplierCost 是成本(選填,只給 Jeff 算毛利,絕不上客人文件)。" +
      "**金額一律不要自己編,對話/附件裡有才填,沒有就留空。** " +
      "supplierCost 若要填,必須同時提供 sourceDocId(指向已上傳的供應商文件);" +
      "系統會驗證這個金額真的出現在該文件文字裡,對不上會被拒絕。沒有文件佐證就不要填這個欄位。" +
      "單一律建成 draft(草稿)狀態;" +
      "就算 Jeff 說『已付清』也不要在這裡標成已付款 — 碰錢的狀態改由 Jeff 之後在客戶頁手動標。" +
      "建好用一句話跟 Jeff 報:建了哪張、單號。",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "短描述,一眼看懂這張單是什麼(例:『劉衛國 PEK-SFO 商務艙機票』)",
        },
        category: {
          type: "string",
          enum: ["flight", "visa", "quote", "general"],
          description: "總類:flight=機票 / visa=簽證 / quote=報價行程 / general=一般諮詢",
        },
        destination: { type: "string", description: "目的地(選填)" },
        totalPrice: {
          type: "number",
          description: "直客售價(選填,不確定就留空,絕不編)",
        },
        supplierCost: {
          type: "number",
          description:
            "成本(選填,只給 Jeff 算毛利,絕不上客人文件,絕不編)。" +
            "**填這個欄位就一定要同時填 sourceDocId**,否則會被系統拒絕不寫入。",
        },
        sourceDocId: {
          type: "number",
          description:
            "supplierCost 的文件佐證——指向已上傳給這位客人的供應商文件(customerDocuments.id)。" +
            "系統會驗證 supplierCost 的金額真的出現在這份文件的文字裡,對不上會被拒絕。" +
            "只在填 supplierCost 時需要;沒有文件佐證就兩者都留空。",
        },
        departureDate: { type: "string", description: "出發日 YYYY-MM-DD(選填)" },
        returnDate: { type: "string", description: "回程日 YYYY-MM-DD(選填)" },
        needsQuote: {
          type: "boolean",
          description: "是否還要報價。補歷史/已成交的單傳 false(預設);全新還沒報價的案子才傳 true。",
        },
        notes: { type: "string", description: "內部備註(選填,例如『客人說已付清,待 Jeff 標記』)" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_custom_order",
    description:
      "改『目前這位客人』既有的一張訂製單(專案)。用在 Jeff 說「這張補上票價」「把這筆改成簽證」" +
      "「填一下出發日」「這單標題改成…」,或你從剛丟進來的 PDF 讀到既有單缺的資料要補回去時。" +
      "先從帳務/專案列表拿到那張單的 orderId,再只傳「要改的欄位」— 沒傳的欄位不會動(這是補丁,不是覆蓋," +
      "補一個票價不會把標題洗掉)。可改:title / category(flight|visa|quote|general)/ destination / " +
      "totalPrice(直客售價)/ supplierCost(成本,只給 Jeff 算毛利,絕不上客人文件)/ departureDate / " +
      "returnDate / needsQuote / notes。**金額一律不編,PDF/對話裡有才填。** " +
      "supplierCost 若要填,必須同時提供 sourceDocId(指向已上傳的供應商文件);" +
      "系統會驗證這個金額真的出現在該文件文字裡,對不上會被拒絕。沒有文件佐證就不要填這個欄位。" +
      "**不能在這改付款/狀態** — 標已付款、確認、取消這種碰錢的仍由 Jeff 手動。只能改屬於這位客人的單。" +
      "改完用一句話報:改了哪張、動了哪些欄位。",
    input_schema: {
      type: "object",
      properties: {
        orderId: { type: "number", description: "要改的訂製單 id(從帳務/專案列表拿,不要編)" },
        title: { type: "string", description: "新標題(選填)" },
        category: {
          type: "string",
          enum: ["flight", "visa", "quote", "general"],
          description: "改總類(選填):flight=機票 / visa=簽證 / quote=報價行程 / general=一般諮詢",
        },
        destination: { type: "string", description: "目的地(選填;傳空字串=清除)" },
        totalPrice: { type: "number", description: "直客售價(選填,不確定就別傳這欄,絕不編)" },
        supplierCost: {
          type: "number",
          description:
            "成本(選填,只給 Jeff 算毛利,絕不編)。" +
            "**填這個欄位就一定要同時填 sourceDocId**,否則會被系統拒絕不寫入。",
        },
        sourceDocId: {
          type: "number",
          description:
            "supplierCost 的文件佐證——指向已上傳給這位客人的供應商文件(customerDocuments.id)。" +
            "系統會驗證 supplierCost 的金額真的出現在這份文件的文字裡,對不上會被拒絕。" +
            "只在填 supplierCost 時需要;沒有文件佐證就兩者都留空。",
        },
        departureDate: { type: "string", description: "出發日 YYYY-MM-DD(選填)" },
        returnDate: { type: "string", description: "回程日 YYYY-MM-DD(選填)" },
        needsQuote: { type: "boolean", description: "是否還要報價(選填)" },
        notes: { type: "string", description: "內部備註(選填;傳空字串=清除)" },
      },
      required: ["orderId"],
    },
  },
  {
    name: "attach_interaction_to_order",
    description:
      "把『目前這位客人』指定的往來對話掛到指定的一張訂製單(專案)上。" +
      "**必須明確指定要掛哪些** — 二選一(其一必填):interactionIds(一串 interaction id)或 " +
      "gmailThreadId(整個 email thread)。兩個都沒給會被拒絕:這個工具不再『整批歸全部未歸戶對話』," +
      "因為那會把不相干主題(例如客人另外問的新行程)混進同一張單。" +
      "只掛還沒歸戶(customOrderId 為空)且屬於這位客人的那幾筆;指定到的若都已歸戶/不是這位客人的會被拒。" +
      "orderId 一律用剛剛 create_custom_order / update_custom_order 回傳過的 orderId,或 Jeff 直接講的單號" +
      "對應的 id,絕不要編。單已取消/完成的不能再歸戶。" +
      "如果 Jeff 只說『把未分類的都掛上去』但沒給明確的信件/thread,先請他到客戶頁『歷史』分頁多選、" +
      "或給你明確的 gmailThreadId / interactionIds,不要自己猜著整批掛。做完用一句話報:歸了幾筆。",
    input_schema: {
      type: "object",
      properties: {
        orderId: {
          type: "number",
          description: "要歸戶到的訂製單 id(從剛才建單/改單的回傳,或帳務/專案列表拿,不要編)",
        },
        interactionIds: {
          type: "array",
          items: { type: "number" },
          description: "要掛的 interaction id 清單(與 gmailThreadId 二選一,必填其一)",
        },
        gmailThreadId: {
          type: "string",
          description: "要掛的整個 email thread 的 gmailThreadId(與 interactionIds 二選一,必填其一)",
        },
      },
      required: ["orderId"],
    },
  },
  {
    name: "merge_into_customer",
    description:
      "把「目前釘住的這位客人」整份併入另一位既有客人。用在同案聯絡人被誤建成獨立客人時" +
      "(同公司同一個案子、替某案協調的人,例如 leslie@ 其實是 Emerald(AXT 案)的聯絡窗口)。" +
      "**只有 Jeff 明說「把這位併進某某」才呼叫;你察覺到疑似同案聯絡人時只能提醒,絕不自行合併。** " +
      "target 用 targetEmail(精確比對客人檔案上的 email)、targetProfileId(檔案編號)或 targetName(名字精確比對)指定;" +
      "targetName / targetProfileId 直接查客人檔案本身,連已隱藏(blocked)的檔案也找得到 — " +
      "search_customers 找不到目標時不要放棄,直接用 Jeff 講的名字傳 targetName。" +
      "targetName 撞到多位同名會回候選清單(編號+名字),把清單唸給 Jeff,請他用編號指定。" +
      "來源固定是目前釘住的這位,系統釘死,你不用也不能指定。" +
      "工具會把互動紀錄、文件、專案(訂製單)、聊天訊息全搬到 target 名下,再把這個重複檔隱藏並留備註。" +
      "目前這位是註冊會員、target 不存在、或 target 就是本人都會被拒;搬完照工具回傳的筆數報結果。",
    input_schema: {
      type: "object",
      properties: {
        targetEmail: {
          type: "string",
          description: "要併入的那位客人的 email(精確比對客人檔案,不要編)",
        },
        targetProfileId: {
          type: "number",
          description: "要併入的那位客人的檔案編號(知道編號時用,優先於 targetEmail)",
        },
        targetName: {
          type: "string",
          description:
            "要併入的那位客人的名字(檔案名字精確比對,含已隱藏的檔案;沒有 email/編號時用。重名會回候選清單請 Jeff 指定)",
        },
      },
      required: [],
    },
  },
  {
    name: "mark_promise",
    description:
      "把系統從寄出的信裡自動抽出的一則『承諾』標記成已兌現(fulfilled)或撤銷/不用管了(dismissed)。" +
      "用在 Jeff 在聊天裡說類似『這個承諾已經兌現了』『那件事處理好了』『不用管了』『撤銷這個提醒』的時候 —— " +
      "只有 Jeff 明確這樣講才呼叫,絕不自己判斷承諾是否完成就自動呼叫。" +
      "需要先知道 promiseId:先呼叫 list_customer_promises 拿到這位客人目前未兌現的承諾清單" +
      "(id + 原文 + 到期日 + 來源信日期),對照 Jeff 講的內容確認是哪一則,也可能來自看門狗黃卡" +
      "(commitment 類 finding,帶 promiseId 欄位);如果不確定 promiseId,先跟 Jeff 確認是哪一則承諾," +
      "不要用猜的編號呼叫。這個工具只能操作『目前釘住的這位客人』名下的承諾 —— 屬於別的客人的 promiseId 會被拒絕。",
    input_schema: {
      type: "object",
      properties: {
        promiseId: {
          type: "number",
          description: "這則承諾的 id(從看門狗黃卡或客人對話紀錄取得,不要編)",
        },
        action: {
          type: "string",
          enum: ["fulfilled", "dismissed"],
          description: "fulfilled = 已兌現;dismissed = 撤銷/不用再提醒",
        },
      },
      required: ["promiseId", "action"],
    },
  },
];

export const CREATE_CUSTOMER_TOOL: Anthropic.Tool = {
  name: "create_customer",
  description:
    "Create a new customer profile. Use when Jeff says '新增客人' / " +
    "'加一個客人' / drags a file with customer info. Extract name + at " +
    "least one of email or phone from the conversation or attached file. " +
    "Returns the new profile id on success. Dedup is built in: if a profile " +
    "already exists with the same email OR phone, the existing profile is " +
    "returned (never a duplicate); an email that belongs to a registered " +
    "member is rejected — tell Jeff to open that member from the customer " +
    "list instead.",
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
  profileId?: number,
): Promise<string> {
  try {
    const result = await runTool(name, input ?? {}, profileId);
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

async function runTool(name: string, input: any, profileId?: number): Promise<unknown> {
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
            // 檔案名字也要比對 (2026-07-01 實測:「測試三號」只存在 name 欄,
            // aiNotes/email 都比不到 → 查無此人)。
            like(customerProfiles.name, `%${input.name}%`),
            like(customerProfiles.aiNotes, `%${input.name}%`),
            like(customerProfiles.email, `%${input.name}%`),
          )!,
        );
      }
      const rows = await db
        .select({
          id: customerProfiles.id,
          name: customerProfiles.name,
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

    case "list_customer_promises": {
      // customer-cockpit Phase0b — 跨客戶守門沿用 mark_promise 同款:只認
      // 「目前釘住的這位客人」的 profileId(呼叫端從 pinned customer 傳進來,
      // 不是 LLM input 的一部分),不接受也不需要指定其他客人。
      if (!profileId)
        return { error: "沒有選定客人 — 這個工具只能在某位客人的對話框裡用" };
      const { customerPromises, customerInteractions } = await import("../../../drizzle/schema");
      const rows = await db
        .select({
          id: customerPromises.id,
          promiseText: customerPromises.promiseText,
          dueDate: customerPromises.dueDate,
          sourceDate: customerInteractions.createdAt,
        })
        .from(customerPromises)
        .leftJoin(
          customerInteractions,
          eq(customerPromises.sourceInteractionId, customerInteractions.id),
        )
        .where(
          and(
            eq(customerPromises.customerProfileId, profileId),
            isNull(customerPromises.fulfilledAt),
            isNull(customerPromises.dismissedAt),
          ),
        )
        .orderBy(desc(customerPromises.extractedAt))
        .limit(50);
      if (!rows.length) {
        return { count: 0, promises: [], note: "這位客人目前沒有未兌現的承諾。" };
      }
      return {
        count: rows.length,
        promises: rows.map((r) => ({
          id: r.id,
          promiseText: r.promiseText,
          dueDate: r.dueDate,
          sourceDate: r.sourceDate ? new Date(r.sourceDate).toISOString().slice(0, 10) : null,
        })),
        note: "Jeff 說某則承諾已經兌現/撤銷時,用這裡的 id 呼叫 mark_promise,不要用猜的編號。",
      };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}

// ── Write tool executor ───────────────────────────────────────────────────

/** Validate a strict YYYY-MM-DD string is a REAL calendar day (2026-02-30 is
 *  rejected by the ISO round-trip). Returns the normalized string or null. */
function realCalendarDay(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

/**
 * Pure validator for set_follow_up_date input. `clear:true` → null (clear);
 * otherwise `followUpDate` must be a REAL calendar day (rejects e.g.
 * 2026-02-30). Accepted formats (事故 2026-07-01: model 傳「7/21」被拒,然後
 * 吞掉失敗宣稱已設好 — 簡寫直接收下,降低工具失敗率):
 *   - "YYYY-MM-DD"                         → as-is
 *   - "M/D" / "MM/DD" / "M-D" / "MM-DD"    → year inferred from TODAY in
 *     America/Los_Angeles: that month/day still ahead (or today) → this year,
 *     already past → next year.
 * Returned errors are fed back to the model as a tool_result so it can correct
 * itself (e.g. recompute the date) without a hard failure. Pure (clock injected
 * via `now`) so the date guard is unit-tested without a DB.
 */
export function resolveFollowUpDateArg(
  input: { followUpDate?: unknown; clear?: unknown } | null | undefined,
  now: Date = new Date(),
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input?.clear === true) return { ok: true, value: null };
  const raw = typeof input?.followUpDate === "string" ? input.followUpDate.trim() : "";
  if (!raw) return { ok: false, error: "需要 followUpDate(YYYY-MM-DD 或 M/D),或傳 clear=true 清除" };

  // Shorthand "M/D" / "MM/DD" / "M-D" — infer the year from LA-today.
  const short = raw.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (short) {
    const m = Number(short[1]);
    const d = Number(short[2]);
    const [ty, tm, td] = laToday(now).split("-").map(Number);
    const alreadyPast = m < tm || (m === tm && d < td);
    const year = alreadyPast ? ty + 1 : ty;
    const candidate = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const valid = realCalendarDay(candidate);
    if (!valid) return { ok: false, error: `不是有效日期:「${raw}」(換算成 ${candidate})` };
    return { ok: true, value: valid };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return { ok: false, error: `日期格式要 YYYY-MM-DD 或 M/D 簡寫,收到「${raw}」` };
  const valid = realCalendarDay(raw);
  if (!valid) return { ok: false, error: `不是有效日期:${raw}` };
  return { ok: true, value: valid };
}

/**
 * Pure validator for merge_into_customer's TARGET argument. The SOURCE is
 * always the pinned profileId (never model-supplied); the model only names the
 * target, by profile id (preferred), exact profile email, or exact profile
 * name (2026-07-01 實測補:目標 status=blocked 被客人搜尋濾掉,名字要能直達檔案)。
 * Errors flow back as a tool_result so the model can ask Jeff / self-correct.
 * Pure so it's unit-tested without a DB.
 */
export function resolveMergeTargetArgs(
  input: any,
):
  | {
      ok: true;
      value: {
        targetProfileId: number | null;
        targetEmail: string | null;
        targetName: string | null;
      };
    }
  | { ok: false; error: string } {
  const rawId = input?.targetProfileId;
  if (rawId !== undefined && rawId !== null && rawId !== "") {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0)
      return { ok: false, error: "targetProfileId 要是正整數(客人檔案編號)" };
    return { ok: true, value: { targetProfileId: id, targetEmail: null, targetName: null } };
  }
  const email = typeof input?.targetEmail === "string" ? input.targetEmail.trim() : "";
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { ok: false, error: `targetEmail 不是有效 email:「${email}」` };
    return {
      ok: true,
      value: { targetProfileId: null, targetEmail: email.toLowerCase(), targetName: null },
    };
  }
  const name = typeof input?.targetName === "string" ? input.targetName.trim() : "";
  if (name)
    return { ok: true, value: { targetProfileId: null, targetEmail: null, targetName: name } };
  return {
    ok: false,
    error: "需要 targetEmail、targetProfileId 或 targetName 指定要併入哪位客人",
  };
}

/**
 * Normalize a phone number for duplicate matching (CLAUDE.md §4.2 red line —
 * customerProfiles has no DB-level unique constraint, dedup is application
 * code). Strips pure formatting (spaces / dashes / parens / dots) so
 * "510-333-1234", "(510) 333.1234" and "5103331234" all collide. Leading "+"
 * is kept: "+1510…" vs "510…" genuinely differ and we'd rather miss than merge
 * two different people.
 */
export function normalizePhoneForMatch(phone: string): string {
  return phone.replace(/[\s\-().]/g, "");
}

/** The four project categories a customOrder can carry (mirrors the tRPC
 *  create's PROJECT_CATEGORY_KEYS — flight/quote/visa/general). */
export const CUSTOM_ORDER_CATEGORIES = ["flight", "visa", "quote", "general"] as const;

export interface CreateCustomOrderFields {
  title: string;
  category: string | null;
  destination: string | null;
  totalPrice: string | null;
  supplierCost: string | null;
  departureDate: string | null;
  returnDate: string | null;
  needsQuote: number;
  notes: string | null;
}

type ArgResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Shared money normalizer for create/update custom-order tools: blank → null
 *  (leave unset, never coerce to 0), otherwise a >=0 finite number → decimal
 *  string. Rejects negatives / NaN / absurdly large so the model self-corrects. */
function moneyArg(v: unknown, label: string): ArgResult<string | null> {
  if (v == null || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${label} 要是 >= 0 的數字` };
  if (n > 99_999_999) return { ok: false, error: `${label} 數字太大` };
  return { ok: true, value: String(n) };
}

/** Shared date normalizer: blank → null, otherwise a REAL YYYY-MM-DD calendar
 *  day (rejects 2026-02-30 etc.). */
function dateArg(v: unknown, label: string): ArgResult<string | null> {
  if (v == null || v === "") return { ok: true, value: null };
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
    return { ok: false, error: `${label} 格式要 YYYY-MM-DD,收到「${s}」` };
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
    return { ok: false, error: `${label} 不是有效日期:${s}` };
  return { ok: true, value: s };
}

/** Shared category validator: blank → null, otherwise must be whitelisted. */
function categoryArg(v: unknown): ArgResult<string | null> {
  const cat = typeof v === "string" ? v.trim() : "";
  if (cat && !CUSTOM_ORDER_CATEGORIES.includes(cat as any))
    return { ok: false, error: `category 只能是 ${CUSTOM_ORDER_CATEGORIES.join("/")},收到「${cat}」` };
  return { ok: true, value: cat || null };
}

/**
 * Gate for writing customOrders.supplierCost (Phase2 2b — the only place in
 * the codebase allowed to set this column). supplierCost is Jeff's internal
 * cost number; it must never be an LLM-invented figure, only one carried over
 * from a document that's actually been verified to contain it.
 *
 *   - supplierCost present, no sourceDocId → reject the field (not the whole
 *     call): no DB write for supplierCost, everything else proceeds normally.
 *   - supplierCost + sourceDocId → resolveAndVerifySupplierCost must pass, or
 *     the field is rejected the same way.
 *   - no supplierCost at all → nothing to do, field simply omitted.
 *
 * Returns `rejectedReason` (for the tool_result message back to the model)
 * whenever supplierCost gets dropped, so the model knows to retry with a
 * sourceDocId or just omit the field — never a silent drop.
 */
async function gateSupplierCost(
  supplierCost: string | null | undefined,
  sourceDocId: unknown,
  customerProfileId: number,
): Promise<{ supplierCost: string | null | undefined; rejectedReason?: string }> {
  if (supplierCost == null) return { supplierCost };

  const docId =
    typeof sourceDocId === "number"
      ? sourceDocId
      : typeof sourceDocId === "string" && sourceDocId.trim()
        ? Number(sourceDocId)
        : NaN;
  if (!Number.isInteger(docId) || docId <= 0) {
    return {
      supplierCost: undefined,
      rejectedReason:
        "supplierCost 需要搭配 sourceDocId 才能寫入(指向已上傳的供應商文件)," +
        "請附上文件來源或省略 supplierCost 這個欄位。",
    };
  }

  const { resolveAndVerifySupplierCost } = await import("../../_core/supplierCostVerification");
  const result = await resolveAndVerifySupplierCost({
    claimedAmount: Number(supplierCost),
    sourceDocId: docId,
    customerProfileId,
  });
  if (!result.ok) {
    return {
      supplierCost: undefined,
      rejectedReason: `supplierCost 未寫入:${result.reason}`,
    };
  }
  return { supplierCost };
}

/**
 * Pure validator/normalizer for the create_custom_order tool. Turns the model's
 * loose args into the exact insert-shape fields (money → decimal string, dates →
 * validated YYYY-MM-DD, category → whitelisted). Pure so it is unit-tested with
 * no DB (local has no DATABASE_URL). DB-derived fields (orderNumber, profile
 * snapshot, createdBy) are added by the executor, not here. Errors flow back to
 * the model as a tool_result so it can self-correct (e.g. drop a bad date).
 */
export function resolveCreateCustomOrderArgs(
  input: any,
): { ok: true; value: CreateCustomOrderFields } | { ok: false; error: string } {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "title 必填(一眼看懂這張單是什麼)" };
  if (title.length > 200) return { ok: false, error: "title 太長(上限 200 字)" };

  const catRes = categoryArg(input?.category);
  if (!catRes.ok) return catRes;
  const category = catRes.value;

  const total = moneyArg(input?.totalPrice, "totalPrice");
  if (!total.ok) return total;
  const cost = moneyArg(input?.supplierCost, "supplierCost");
  if (!cost.ok) return cost;

  const dep = dateArg(input?.departureDate, "departureDate");
  if (!dep.ok) return dep;
  const ret = dateArg(input?.returnDate, "returnDate");
  if (!ret.ok) return ret;

  const destination =
    typeof input?.destination === "string" && input.destination.trim()
      ? input.destination.trim().slice(0, 200)
      : null;
  const notes =
    typeof input?.notes === "string" && input.notes.trim()
      ? input.notes.trim().slice(0, 5000)
      : null;
  const needsQuote = input?.needsQuote === true ? 1 : 0;

  return {
    ok: true,
    value: {
      title,
      category,
      destination,
      totalPrice: total.value,
      supplierCost: cost.value,
      departureDate: dep.value,
      returnDate: ret.value,
      needsQuote,
      notes,
    },
  };
}

/** The fields update_custom_order may patch. Only the keys the model actually
 *  supplies land in the patch (a missing field is left untouched — this is a
 *  PATCH, not a replace, so「補一個票價」never blanks the title). Deliberately
 *  excludes status / payment — money-touching lifecycle changes stay manual
 *  (Jeff advances status; see the admin-AI boundary). */
export interface UpdateCustomOrderPatch {
  title?: string;
  category?: string | null;
  destination?: string | null;
  totalPrice?: string | null;
  supplierCost?: string | null;
  departureDate?: string | null;
  returnDate?: string | null;
  needsQuote?: number;
  notes?: string | null;
}

/**
 * Pure validator/normalizer for update_custom_order. Requires a positive orderId
 * and at least one field to change; builds a PARTIAL patch of ONLY the provided
 * fields (so unspecified fields are never overwritten). Same normalizers as
 * create (money → decimal string, dates validated, category whitelisted). Pure →
 * unit-tested with no DB. The cross-customer guard (order must belong to THIS
 * customer) lives in the executor, not here.
 */
export function resolveUpdateCustomOrderArgs(
  input: any,
): { ok: true; value: { orderId: number; patch: UpdateCustomOrderPatch } } | { ok: false; error: string } {
  const orderId = typeof input?.orderId === "number" ? input.orderId : Number(input?.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0)
    return { ok: false, error: "需要要改的 orderId(正整數;先從帳務/專案列表拿單號對應的 id)" };

  const patch: UpdateCustomOrderPatch = {};

  if (input?.title !== undefined) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) return { ok: false, error: "title 不能改成空的" };
    if (title.length > 200) return { ok: false, error: "title 太長(上限 200 字)" };
    patch.title = title;
  }
  if (input?.category !== undefined) {
    const catRes = categoryArg(input.category);
    if (!catRes.ok) return catRes;
    patch.category = catRes.value;
  }
  if (input?.destination !== undefined) {
    const d = typeof input.destination === "string" ? input.destination.trim() : "";
    patch.destination = d ? d.slice(0, 200) : null;
  }
  if (input?.totalPrice !== undefined) {
    const r = moneyArg(input.totalPrice, "totalPrice");
    if (!r.ok) return r;
    patch.totalPrice = r.value;
  }
  if (input?.supplierCost !== undefined) {
    const r = moneyArg(input.supplierCost, "supplierCost");
    if (!r.ok) return r;
    patch.supplierCost = r.value;
  }
  if (input?.departureDate !== undefined) {
    const r = dateArg(input.departureDate, "departureDate");
    if (!r.ok) return r;
    patch.departureDate = r.value;
  }
  if (input?.returnDate !== undefined) {
    const r = dateArg(input.returnDate, "returnDate");
    if (!r.ok) return r;
    patch.returnDate = r.value;
  }
  if (input?.needsQuote !== undefined) {
    patch.needsQuote = input.needsQuote === true ? 1 : 0;
  }
  if (input?.notes !== undefined) {
    const n = typeof input.notes === "string" ? input.notes.trim() : "";
    patch.notes = n ? n.slice(0, 5000) : null;
  }

  if (Object.keys(patch).length === 0)
    return { ok: false, error: "沒有要改的欄位 — 至少給一個(title/category/totalPrice/supplierCost/日期/notes…)" };

  return { ok: true, value: { orderId, patch } };
}

/** Booking statuses the agent may write (mirrors drizzle bookings.bookingStatus). */
export const AGENT_BOOKING_STATUS_VALUES = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
] as const;
/** Payment statuses the agent may write. "refunded" is DELIBERATELY absent:
 *  refunds are money-moving and always go through suggest_action for Jeff's
 *  review (same rule the system prompt teaches) — never a direct agent write. */
export const AGENT_PAYMENT_STATUS_VALUES = ["unpaid", "deposit", "paid"] as const;

export interface BookingStatusUpdates {
  bookingStatus?: (typeof AGENT_BOOKING_STATUS_VALUES)[number];
  paymentStatus?: (typeof AGENT_PAYMENT_STATUS_VALUES)[number];
}

/**
 * Pure validator for the update_booking_status tool. Server-side enum
 * whitelist — the enums in the tool schema are only a hint to the model, so
 * an off-enum string (or "refunded") must be rejected HERE, not by MySQL
 * strict mode. Errors flow back to the model as a tool_result so it can
 * self-correct or explain to Jeff. Pure so it's unit-tested without a DB.
 */
export function resolveBookingStatusArgs(
  input: any,
): { ok: true; value: { bookingId: number; updates: BookingStatusUpdates } } | { ok: false; error: string } {
  const bookingId = Number(input?.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0)
    return { ok: false, error: "missing bookingId" };
  const updates: BookingStatusUpdates = {};
  if (input?.bookingStatus !== undefined) {
    if (!AGENT_BOOKING_STATUS_VALUES.includes(input.bookingStatus))
      return {
        ok: false,
        error: `bookingStatus 只能是 ${AGENT_BOOKING_STATUS_VALUES.join("/")},收到「${input.bookingStatus}」`,
      };
    updates.bookingStatus = input.bookingStatus;
  }
  if (input?.paymentStatus !== undefined) {
    if (input.paymentStatus === "refunded")
      return {
        ok: false,
        error:
          "退款不能由 AI 直接標 — 退款碰錢,一律用 suggest_action 提案,讓 Jeff 審核後手動操作",
      };
    if (!AGENT_PAYMENT_STATUS_VALUES.includes(input.paymentStatus))
      return {
        ok: false,
        error: `paymentStatus 只能是 ${AGENT_PAYMENT_STATUS_VALUES.join("/")},收到「${input.paymentStatus}」`,
      };
    updates.paymentStatus = input.paymentStatus;
  }
  if (Object.keys(updates).length === 0)
    return { ok: false, error: "no status fields provided" };
  return { ok: true, value: { bookingId, updates } };
}

/**
 * Cross-customer ownership rule for bookings (2026-07-01 P1 fix — parity with
 * orderBelongsToProfiles for customOrders). bookings carry no
 * customerProfileId, so ownership is derived from what they DO carry:
 * bookings.userId ↔ the pinned profile's linked userId, or
 * bookings.customerEmail ↔ the profile's email (guest bookings have no
 * userId). Pure so the guard is trivially testable without a DB.
 */
export function bookingBelongsToCustomer(
  booking: { userId: number | null; customerEmail: string | null },
  owner: { userId: number | null; email: string | null },
): boolean {
  if (owner.userId != null && booking.userId != null && booking.userId === owner.userId)
    return true;
  const bookingEmail = (booking.customerEmail ?? "").trim().toLowerCase();
  const ownerEmail = (owner.email ?? "").trim().toLowerCase();
  return bookingEmail !== "" && bookingEmail === ownerEmail;
}

export async function executeWriteTool(
  name: string,
  input: any,
  profileId: number | undefined,
  adminUserId?: number,
): Promise<string> {
  try {
    const result = await runWriteTool(name, input, profileId, adminUserId);
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
  adminUserId?: number,
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
      const replace = input.replace === true;
      // Read-before-write (2026-07-01 P2 fix): the model can't see the old
      // note, so blind overwrite destroyed it. Default = append as a dated
      // line; replace:true is the only whole-field overwrite.
      const [existing] = await db
        .select({ note: customerProfiles.jeffPersonalNote })
        .from(customerProfiles)
        .where(eq(customerProfiles.id, profileId))
        .limit(1);
      const merged = mergeCustomerNote(existing?.note ?? null, note, replace);
      await db
        .update(customerProfiles)
        .set({ jeffPersonalNote: merged || null, updatedAt: new Date() })
        .where(eq(customerProfiles.id, profileId));
      log.info(
        { profileId, noteLen: merged.length, replace },
        "update_customer_note executed",
      );
      // The message becomes a tool_result chip — echo the full note so Jeff
      // sees exactly what it says now (requirements §3: tool憑證,嘴上宣稱不算).
      return {
        success: true,
        note: merged || null,
        message: merged ? `備註已更新,目前全文:\n${merged}` : "備註已清空",
      };
    }

    case "update_booking_status": {
      // Cross-customer guard + enum whitelist + audit (2026-07-01 P1 fix).
      // Booking status touches money, so this write gets the same three
      // protections the human admin path (routers/bookings.ts
      // adminUpdateStatus) has: the booking MUST belong to the pinned
      // customer, the values MUST be whitelisted server-side (the tool-schema
      // enum is only a hint to the model), and every change is audit-logged.
      if (!profileId)
        return { error: "沒有選定客人 — 這個工具只能在某位客人的對話框裡用" };
      if (!adminUserId) return { error: "缺少操作者(系統沒帶到 admin userId)" };
      const parsed = resolveBookingStatusArgs(input);
      if (!parsed.ok) return { error: parsed.error };
      const { bookingId, updates } = parsed.value;
      const { getBookingById, updateBooking } = await import("../../db/booking");
      const booking = await getBookingById(bookingId);
      if (!booking) return { error: `找不到訂單 #${bookingId}` };
      const { getCustomerProfileSnapshot } = await import("../../db/customOrder");
      const snap = await getCustomerProfileSnapshot(profileId);
      if (
        !bookingBelongsToCustomer(
          { userId: booking.userId ?? null, customerEmail: booking.customerEmail ?? null },
          { userId: snap.userId, email: snap.email },
        )
      )
        return { error: `訂單 #${bookingId} 不是這位客人的,不能改` };
      const before = {
        bookingStatus: booking.bookingStatus,
        paymentStatus: booking.paymentStatus,
      };
      const updated = await updateBooking(bookingId, updates);
      const { audit } = await import("../../_core/auditLog");
      await audit({
        ctx: { user: { id: adminUserId, email: "ops-agent", role: "admin" } },
        action: "booking.updateStatus",
        targetType: "booking",
        targetId: bookingId,
        changes: { before, after: updates },
        reason: `ops-agent write tool (customer chat, profileId=${profileId})`,
      });
      log.info({ profileId, bookingId, updates }, "update_booking_status executed");
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
      // profile (Emerald Young, 2026-06-30). CLAUDE.md §4.2 red line: check
      // BOTH identifiers (OR, like agent/profiles.ts upsertByIdentifier) —
      // "email misses but phone hits" is still the same person. Phone compares
      // formatting-normalized on both sides. Return the existing one (oldest
      // first = the original, with the real history) instead of creating a 2nd.
      {
        const { or, sql } = await import("drizzle-orm");
        const conds: any[] = [];
        if (cEmail) conds.push(eq(customerProfiles.email, cEmail));
        if (cPhone) {
          const normPhone = normalizePhoneForMatch(cPhone);
          conds.push(
            sql`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${customerProfiles.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ${normPhone}`,
          );
        }
        let [dup] = await db
          .select({ id: customerProfiles.id, name: customerProfiles.name })
          .from(customerProfiles)
          .where(conds.length === 1 ? conds[0] : or(...conds))
          .orderBy(customerProfiles.createdAt)
          .limit(1);
        if (dup) {
          // 0109:命中的可能是被併走的隱藏卡(email/phone 還留著)→ 跟指標
          // 走到最終卡,不然回給 model 一張列表上看不到的空卡(review P2)。
          const { followMergePointer } = await import("../../_core/mergedProfile");
          const canonicalId = await followMergePointer(db, dup.id);
          if (canonicalId !== dup.id) {
            const [canon] = await db
              .select({ id: customerProfiles.id, name: customerProfiles.name })
              .from(customerProfiles)
              .where(eq(customerProfiles.id, canonicalId))
              .limit(1);
            if (canon) dup = canon;
          }
          log.info({ profileId: dup.id, name: cName }, "create_customer deduped → existing");
          return {
            success: true,
            profileId: dup.id,
            deduped: true,
            message: `客人「${dup.name ?? cName}」已經有檔案了,直接用既有的(沒有重複建立)`,
          };
        }
      }
      // Registered-member guard (same rule as tRPC createManualCustomer's
      // email_exists_registered): an email that belongs to a users row must
      // never become a guest profile — the member's file attaches to the
      // account, a parallel guest card would split their history.
      if (cEmail) {
        const { users } = await import("../../../drizzle/schema");
        const [registered] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, cEmail))
          .limit(1);
        if (registered) {
          log.info(
            { email: cEmail, userId: registered.id },
            "create_customer rejected — email belongs to a registered member",
          );
          return {
            error:
              `這個 email(${cEmail})是註冊會員的帳號,不建訪客檔 — ` +
              `請 Jeff 直接在客人清單搜尋這位會員操作(跟後台手動新增同一條規則)`,
          };
        }
      }
      // insertCustomerProfileSafely (2026-07-03, 任務7 對抗審查 P0) — closes the
      // race window between the dedup SELECT above and this INSERT; two
      // near-simultaneous create_customer calls for the same new email/phone
      // would otherwise both pass the dedup check and both insert.
      const { insertCustomerProfileSafely } = await import("../../db/customerProfile");
      const insertResult = await insertCustomerProfileSafely(db, {
        name: cName,
        email: cEmail ?? null,
        phone: cPhone ?? null,
        source: "manual",
      });
      if (insertResult.recoveredFromRace) {
        log.info(
          { profileId: insertResult.profileId, name: cName },
          "create_customer race-recovered → existing",
        );
        return {
          success: true,
          profileId: insertResult.profileId,
          deduped: true,
          message: `客人「${cName}」已經有檔案了,直接用既有的(沒有重複建立)`,
        };
      }
      log.info({ profileId: insertResult.profileId, name: cName }, "create_customer executed");
      return { success: true, profileId: insertResult.profileId, message: `已新增客人「${cName}」` };
    }

    case "collect_customer_threads": {
      const cEmail = (input.email ?? "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(cEmail))
        return { error: "需要一個有效的客人 email(不要自己編)" };
      // Pin guard (2026-07-01 P2 fix): the model sometimes grabs a third-party
      // address out of thread text (a cc, a forwarded sender) and would file
      // the WRONG person's mail. When this chat is pinned to a profile that
      // has an email, the input MUST equal it. A phone-only profile has no
      // email to check against — collect the given address INTO this customer
      // and say so explicitly.
      let pinnedWithoutEmail = false;
      if (profileId) {
        const { getCustomerProfileSnapshot } = await import("../../db/customOrder");
        const snap = await getCustomerProfileSnapshot(profileId);
        const pinnedEmail = (snap.email ?? "").trim().toLowerCase();
        if (pinnedEmail && pinnedEmail !== cEmail) {
          // 0109 例外:cEmail 的卡若已「整份併進」目前釘住的客人(同案聯絡人,
          // 例 leslie 併進 Emerald),那收它的信本來就該進這位客人 — 放行。
          let mergedIntoPinned = false;
          const [emailCard] = await db
            .select({ id: customerProfiles.id })
            .from(customerProfiles)
            .where(eq(customerProfiles.email, cEmail))
            .limit(1);
          if (emailCard) {
            const { followMergePointer } = await import("../../_core/mergedProfile");
            mergedIntoPinned = (await followMergePointer(db, emailCard.id)) === profileId;
          }
          if (!mergedIntoPinned) {
            return {
              error:
                `這位客人檔案上的 email 是 ${pinnedEmail},你要收的卻是 ${cEmail} — ` +
                `對不上,不收(避免把別人的信收進這位客人)。要收 ${cEmail} 的往來,` +
                `請 Jeff 開那位客人的頁面再收。`,
            };
          }
        }
        pinnedWithoutEmail = !pinnedEmail;
      }
      const { doCollectCustomerThreads } = await import("./opsActions");
      const r = await doCollectCustomerThreads(
        profileId ? { email: cEmail, profileId } : { email: cEmail },
      );
      log.info({ email: cEmail, profileId, ok: r.ok }, "collect_customer_threads executed");
      if (!r.ok) return { error: r.summary || r.error || "收進失敗" };
      const message = pinnedWithoutEmail
        ? `這位客人檔案沒有 email,已把 ${cEmail} 的往來收進目前這位客人的檔案。${r.summary}`
        : r.summary;
      return { success: true, message, details: r.details };
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

    case "create_custom_order": {
      if (!profileId) return { error: "沒有選定客人 — 這個工具只能在某位客人的對話框裡用" };
      if (!adminUserId) return { error: "缺少建立者(系統沒帶到 admin userId)" };
      const parsed = resolveCreateCustomOrderArgs(input);
      if (!parsed.ok) return { error: parsed.error };
      const v = parsed.value;
      const costGate = await gateSupplierCost(v.supplierCost, input?.sourceDocId, profileId);
      const { createCustomOrder, generateOrderNumber, getCustomerProfileSnapshot } =
        await import("../../db/customOrder");
      const snap = await getCustomerProfileSnapshot(profileId);
      const orderNumber = await generateOrderNumber();
      const order = await createCustomOrder({
        orderNumber,
        customerProfileId: profileId,
        userId: snap.userId ?? null,
        customerName: snap.name || snap.email || "客戶",
        customerEmail: snap.email ?? null,
        title: v.title,
        category: v.category,
        destination: v.destination,
        needsQuote: v.needsQuote,
        status: "draft",
        currency: "USD",
        totalPrice: v.totalPrice,
        supplierCost: costGate.supplierCost ?? null,
        departureDate: v.departureDate,
        returnDate: v.returnDate,
        notes: v.notes,
        createdBy: adminUserId,
      });
      if (!order) return { error: "建立失敗(資料庫沒回傳)" };
      // Recompute the customer's driver-bar / summary so the new project shows
      // up in「做了什麼」immediately (same bump the tRPC create does).
      void import("../../queue")
        .then((m) => m.enqueueCustomerSummaryRefresh(profileId))
        .catch(() => {});
      log.info(
        { profileId, orderId: order.id, orderNumber, category: v.category, supplierCostRejected: !!costGate.rejectedReason },
        "create_custom_order executed",
      );
      return {
        success: true,
        orderId: order.id,
        orderNumber,
        title: v.title,
        category: v.category,
        ...(costGate.rejectedReason ? { warning: costGate.rejectedReason } : {}),
        message: costGate.rejectedReason
          ? `已建立專案「${v.title}」(${orderNumber});${costGate.rejectedReason}`
          : `已建立專案「${v.title}」(${orderNumber})`,
      };
    }

    case "update_custom_order": {
      if (!profileId) return { error: "沒有選定客人 — 這個工具只能在某位客人的對話框裡用" };
      const parsed = resolveUpdateCustomOrderArgs(input);
      if (!parsed.ok) return { error: parsed.error };
      const { orderId, patch } = parsed.value;
      const {
        getCustomOrderById,
        updateCustomOrder,
        getCustomerProfileSnapshot,
        resolveCustomerProfileIds,
        orderBelongsToProfiles,
      } = await import("../../db/customOrder");
      const order = await getCustomOrderById(orderId);
      if (!order) return { error: `找不到訂單 #${orderId}` };
      // Cross-customer guard (same rule as ask-ops-stream + assignConversation):
      // the order MUST belong to this customer's profile set, never another's.
      const snap = await getCustomerProfileSnapshot(profileId);
      const scopeIds =
        snap.userId != null
          ? await resolveCustomerProfileIds({ userId: snap.userId })
          : [profileId];
      if (!scopeIds.includes(profileId)) scopeIds.push(profileId);
      if (!orderBelongsToProfiles(order.customerProfileId, scopeIds))
        return { error: `訂單 #${orderId} 不是這位客人的,不能改` };

      let rejectedReason: string | undefined;
      if ("supplierCost" in patch) {
        const costGate = await gateSupplierCost(patch.supplierCost, input?.sourceDocId, order.customerProfileId);
        if (costGate.rejectedReason) {
          delete (patch as any).supplierCost;
          rejectedReason = costGate.rejectedReason;
        }
      }
      if (Object.keys(patch).length === 0)
        return { error: rejectedReason ?? "沒有要改的欄位" };

      const updated = await updateCustomOrder(orderId, patch as any);
      if (!updated) return { error: "更新失敗(資料庫沒回傳)" };
      void import("../../queue")
        .then((m) => m.enqueueCustomerSummaryRefresh(profileId))
        .catch(() => {});
      const changed = Object.keys(patch);
      log.info({ profileId, orderId, changed, supplierCostRejected: !!rejectedReason }, "update_custom_order executed");
      return {
        success: true,
        orderId,
        orderNumber: updated.orderNumber,
        changed,
        ...(rejectedReason ? { warning: rejectedReason } : {}),
        message: rejectedReason
          ? `已更新單 ${updated.orderNumber}(改了:${changed.join("、")});${rejectedReason}`
          : `已更新單 ${updated.orderNumber}(改了:${changed.join("、")})`,
      };
    }

    case "attach_interaction_to_order": {
      // customer-cockpit Phase6 B2「聊天手動掛單」→ F1 回爐(e2e-sweep-20260705 §F1)。
      // 舊版一次歸『全部未歸戶對話』,粒度太粗,prod 實測把 Yosemite+北海道+Napa 三個
      // 不相干主題全灌進同一張單。現在必須明確指定 interactionIds 或 gmailThreadId(二選一),
      // 兩者都沒給 → 拒絕;只掛指定到的、屬於這位客人、且尚未歸戶(customOrderId 為空)的那幾筆。
      const orderId = Number(input?.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0)
        return { error: "需要要歸戶的 orderId(正整數;從剛才建單/改單的回傳或帳務/專案列表拿,不要編)" };
      if (!profileId) return { error: "沒有選定客人 — 這個工具只能在某位客人的對話框裡用" };
      // F1:二選一必填 —— interactionIds 或 gmailThreadId,兩者都沒給就拒絕。
      const rawInteractionIds = Array.isArray(input?.interactionIds) ? input.interactionIds : null;
      const selInteractionIds: number[] = rawInteractionIds
        ? rawInteractionIds
            .map((n: unknown) => Number(n))
            .filter((n: number) => Number.isInteger(n) && n > 0)
        : [];
      const selThreadId =
        typeof input?.gmailThreadId === "string" && input.gmailThreadId.trim()
          ? input.gmailThreadId.trim()
          : null;
      if (selInteractionIds.length === 0 && !selThreadId)
        return {
          error:
            "必須指定要掛哪些:interactionIds(一串 id)或 gmailThreadId(整個 thread)二選一。" +
            "這個工具不再整批歸全部未歸戶對話(會把不相干主題混進同一張單)。" +
            "若 Jeff 沒給明確選擇,請他到客戶頁『歷史』分頁多選,或給你明確的 thread / interaction id。",
        };

      const {
        getCustomOrderById,
        getCustomerProfileSnapshot,
        resolveCustomerProfileIds,
        orderBelongsToProfiles,
        assignInteractionsToOrder,
      } = await import("../../db/customOrder");
      const order = await getCustomOrderById(orderId);
      if (!order) return { error: `找不到訂單 #${orderId}` };

      // Cross-customer guard — copied verbatim from update_custom_order (the
      // dispatch doc explicitly forbids inventing a new variant of this check).
      const snap = await getCustomerProfileSnapshot(profileId);
      const scopeIds =
        snap.userId != null
          ? await resolveCustomerProfileIds({ userId: snap.userId })
          : [profileId];
      if (!scopeIds.includes(profileId)) scopeIds.push(profileId);
      if (!orderBelongsToProfiles(order.customerProfileId, scopeIds))
        return { error: `訂單 #${orderId} 不是這位客人的,不能歸戶` };

      // Terminal-status guard — a closed order (cancelled/completed) must not
      // silently absorb new conversation history via chat. The UI-equivalent
      // adminCustomerOrders.ts assignConversation only blocks "cancelled" (a
      // narrower pre-existing gap left as-is there); this chat tool blocks both
      // terminal states since a fresh chat instruction has no reason to be able
      // to re-open bookkeeping on an already-wrapped-up case.
      if (order.status === "cancelled" || order.status === "completed")
        return {
          error: `訂單 #${orderId} 已經是「${order.status === "cancelled" ? "取消" : "完成"}」狀態,不能再歸戶新對話`,
        };

      const { customerInteractions } = await import("../../../drizzle/schema");
      const { and, inArray, isNull, eq } = await import("drizzle-orm");
      // F1:只掛「指定到的」那幾筆 —— 本客人 scope + 尚未歸戶 + (interactionIds 或整個 thread)。
      const selectionClause =
        selInteractionIds.length > 0
          ? inArray(customerInteractions.id, selInteractionIds)
          : eq(customerInteractions.gmailThreadId, selThreadId!);
      const unfiled = await db
        .select({ id: customerInteractions.id })
        .from(customerInteractions)
        .where(
          and(
            inArray(customerInteractions.customerProfileId, scopeIds),
            isNull(customerInteractions.customOrderId),
            selectionClause,
          ),
        )
        .limit(200);
      if (unfiled.length === 0)
        return { error: "指定的對話沒有可歸的(可能已歸戶、不是這位客人的、或指定的 id/thread 不存在)" };

      const updated = await assignInteractionsToOrder({
        profileIds: scopeIds,
        orderId,
        interactionIds: unfiled.map((r) => r.id),
      });
      void import("../../queue")
        .then((m) => m.enqueueCustomerSummaryRefresh(profileId))
        .catch(() => {});
      log.info({ profileId, orderId, updated }, "attach_interaction_to_order executed");
      return {
        success: true,
        orderId,
        orderNumber: order.orderNumber,
        updated,
        message: `已把 ${updated} 筆未歸戶對話歸到單 ${order.orderNumber}`,
      };
    }

    case "merge_into_customer": {
      // 同案聯絡人合併 (2026-07-01, leslie@greencommunicationsllc.com 其實是
      // Emerald Young(AXT 案)的聯絡窗口卻被建成獨立客人)。SOURCE 永遠是釘住
      // 的 profileId — 絕不信 model 給的 source;model 只指定 target。
      if (!profileId)
        return { error: "沒有選定客人 — 這個工具只能在某位客人的對話框裡用" };
      if (!adminUserId) return { error: "缺少操作者(系統沒帶到 admin userId)" };
      const parsed = resolveMergeTargetArgs(input);
      if (!parsed.ok) return { error: parsed.error };

      // Resolve the target (must exist). Email lookup takes the OLDEST match —
      // same rule as create_customer dedup: the original row has the history.
      const targetFields = {
        id: customerProfiles.id,
        name: customerProfiles.name,
        email: customerProfiles.email,
        mergedIntoProfileId: customerProfiles.mergedIntoProfileId,
      };
      let target:
        | { id: number; name: string | null; email: string | null; mergedIntoProfileId: number | null }
        | undefined;
      if (parsed.value.targetProfileId != null) {
        [target] = await db
          .select(targetFields)
          .from(customerProfiles)
          .where(eq(customerProfiles.id, parsed.value.targetProfileId))
          .limit(1);
      } else if (parsed.value.targetEmail != null) {
        [target] = await db
          .select(targetFields)
          .from(customerProfiles)
          .where(eq(customerProfiles.email, parsed.value.targetEmail))
          .orderBy(customerProfiles.createdAt)
          .limit(1);
      } else {
        // targetName — 直接查 customerProfiles 做名字精確比對,刻意「不」濾
        // status(含 blocked/已隱藏)。2026-07-01 實測:「把這位併進 測試三號」
        // 失敗,因為目標已被隱藏,客人搜尋工具看不到;合併目標本來就常是
        // 隱藏過的重複檔,名字解析必須繞過可見性濾網。命中多筆 → 回候選清單
        // 請 Jeff 用編號指定,絕不自己挑。
        const matches = await db
          .select(targetFields)
          .from(customerProfiles)
          .where(eq(customerProfiles.name, parsed.value.targetName!))
          .orderBy(customerProfiles.createdAt)
          .limit(10);
        if (matches.length > 1) {
          const candidates = matches
            .map((m) => `#${m.id} ${m.name ?? "(無名)"}${m.email ? ` <${m.email}>` : ""}`)
            .join("、");
          return {
            error:
              `同名「${parsed.value.targetName}」有 ${matches.length} 位,不能自己挑。` +
              `請 Jeff 指定編號(targetProfileId):${candidates}`,
          };
        }
        target = matches[0];
      }
      if (!target) {
        const who =
          parsed.value.targetEmail ??
          parsed.value.targetName ??
          `#${parsed.value.targetProfileId}`;
        return { error: `找不到要併入的客人(${who}),確認名字、email 或編號後再試,不要編` };
      }
      if (target.id === profileId)
        return { error: "目標就是目前這位客人,不能把自己併進自己" };

      // 目標自己也被併走過(舊卡)→ 跟著 0109 指標走到最終卡,避免把人併進
      // 一張已經空掉的隱藏卡;走完若繞回來源就是循環,拒絕。
      if (target.mergedIntoProfileId != null) {
        const { followMergePointer } = await import("../../_core/mergedProfile");
        const canonicalId = await followMergePointer(db, target.id);
        if (canonicalId === profileId)
          return {
            error: `「${target.name || target.email || `#${target.id}`}」已經被併進目前這位客人,不能再反著併回去(會成循環)`,
          };
        if (canonicalId !== target.id) {
          [target] = await db
            .select(targetFields)
            .from(customerProfiles)
            .where(eq(customerProfiles.id, canonicalId))
            .limit(1);
          if (!target) return { error: `合併鏈指向的最終卡(#${canonicalId})不存在,請人工確認` };
        }
      }

      const [source] = await db
        .select({
          id: customerProfiles.id,
          userId: customerProfiles.userId,
          name: customerProfiles.name,
          email: customerProfiles.email,
          status: customerProfiles.status,
          jeffPersonalNote: customerProfiles.jeffPersonalNote,
        })
        .from(customerProfiles)
        .where(eq(customerProfiles.id, profileId))
        .limit(1);
      if (!source) return { error: `找不到目前這位客人的檔案(#${profileId})` };
      if (source.userId != null)
        return {
          error:
            "這位客人是註冊會員,不能整份併進別人(會員的歷史要留在帳號上)。" +
            "要合併請反過來:開那個重複的訪客檔,把訪客併進這位會員,或人工處理。",
        };

      // Mechanical merge (dup-drop by externalId, 4-table move, block+0109
      // pointer, dated note, audit, touchLastInbound recompute, summary
      // refresh) extracted to _core/customerMerge (2026-07-02 G2) so the
      // filing-entrance auto-heal shares the exact same semantics. The
      // preloaded source/target rows keep the query sequence identical to the
      // pre-extraction inline code.
      const { mergeCustomerProfiles } = await import("../../_core/customerMerge");
      const outcome = await mergeCustomerProfiles(db, {
        sourceProfileId: profileId,
        targetProfileId: target.id,
        actor: { id: adminUserId, email: "ops-agent", role: "admin" },
        reason: `ops-agent merge_into_customer (customer chat, source=${profileId} target=${target.id})`,
        source,
        target: { id: target.id, name: target.name, email: target.email },
      });
      const { moved, duplicatesDropped, sourceLabel, targetLabel } = outcome;

      log.info(
        { sourceProfileId: profileId, targetProfileId: target.id, moved, duplicatesDropped },
        "merge_into_customer executed",
      );
      return {
        success: true,
        targetProfileId: target.id,
        moved,
        duplicatesDropped,
        message:
          `已把「${sourceLabel}」併入「${targetLabel}」(#${target.id}):` +
          `互動 ${moved.interactions} 筆、文件 ${moved.documents} 筆、` +
          `專案 ${moved.orders} 筆、聊天 ${moved.chatMessages} 筆` +
          (duplicatesDropped > 0 ? `,略過 ${duplicatesDropped} 筆兩邊都有的重複互動` : "") +
          "。原檔已隱藏。",
      };
    }

    case "mark_promise": {
      // customer-cockpit Phase3 3a — 唯一能寫 fulfilledAt/dismissedAt 的路徑,
      // 且只在 Jeff 聊天裡明確表達時才由 LLM 呼叫這個工具(工具描述已講清楚,
      // 沒有任何自動化路徑——收信/夜掃/看門狗——會呼叫這個工具)。
      //
      // 跨客戶守門照抄 update_customer_note 的模式:input 不帶 customerProfileId,
      // 守門邏輯在這裡用「目前釘住客人」的 profileId 比對這筆 promise 實際的
      // customerProfileId,不符就拒絕(回結構化錯誤,不寫入)。
      if (!profileId)
        return { error: "沒有選定客人 — 這個工具只能在某位客人的對話框裡用" };
      const promiseId = Number(input?.promiseId);
      if (!Number.isFinite(promiseId) || promiseId <= 0)
        return { error: "promiseId 缺失或不是有效數字" };
      const action = input?.action;
      if (action !== "fulfilled" && action !== "dismissed")
        return { error: `action 只能是 fulfilled 或 dismissed,收到「${action}」` };

      const { customerPromises } = await import("../../../drizzle/schema");
      const [promise] = await db
        .select({
          id: customerPromises.id,
          customerProfileId: customerPromises.customerProfileId,
        })
        .from(customerPromises)
        .where(eq(customerPromises.id, promiseId))
        .limit(1);
      if (!promise) return { error: `找不到承諾 #${promiseId}` };
      if (promise.customerProfileId !== profileId)
        return { error: `承諾 #${promiseId} 不是這位客人的,不能標記` };

      const now = new Date();
      await db
        .update(customerPromises)
        .set(action === "fulfilled" ? { fulfilledAt: now } : { dismissedAt: now })
        .where(eq(customerPromises.id, promiseId));

      log.info({ profileId, promiseId, action }, "mark_promise executed");
      return {
        success: true,
        promiseId,
        action,
        message:
          action === "fulfilled"
            ? `已標記承諾 #${promiseId} 為已兌現`
            : `已撤銷承諾 #${promiseId} 的提醒`,
      };
    }

    default:
      return { error: `unknown write tool: ${name}` };
  }
}
