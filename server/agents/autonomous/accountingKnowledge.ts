/**
 * AccountingAgent 知識庫 — M2 (記帳系統強化, 2026-05-28).
 *
 * 把 Jeff 今年人工修正過的分類知識，編成「永久、可版控、可單測」的規則。
 * 這是一個 LEAF 模組:純常數 + 純函式,沒有 DB、沒有 LLM、沒有 side-effect。
 * 因此可被 service 層直接 import,也容易寫 Vitest。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 設計鐵律(對應 Jeff「不準猜」+「我只算公司賺多少」):
 *
 *   1. 業主本人金流最優先 → transfer(不計營收)。Jeff 自己 Zelle / 轉帳
 *      進出公司戶,不是收入也不是費用。命中即覆蓋一切。
 *   2. 已知 outflow 供應商 → 指定類別(cogs_tour)。只在「出帳」(amount>0)
 *      時套用,避免把同名進帳誤判。
 *   3. memo 關鍵字 → 只當「中信心提示」(conf 60-75),不直接拍板,仍交 LLM
 *      參考、仍進待審佇列讓 Jeff 確認。
 *   4. 未知對方的進帳(無記名存款 / 無 memo)→ 回 null(不猜),交給 LLM;
 *      LLM 若也不確定 → other_review。**絕不腦補成收入。**
 *
 *   短 token(如 "ann")只比對「對方欄位的完整單字」,不掃整段描述,
 *   以免 "annual" / "channel" / "Ann Arbor" 之類誤命中。
 *
 * Jeff 維護方式:直接編輯下面三張表(OWNER_IDENTITIES /
 * KNOWN_OUTFLOW_VENDORS / MEMO_HINTS)。改完跑 `pnpm vitest
 * run server/accountingKnowledge.test.ts` 確認沒打破既有斷言即可。
 * ─────────────────────────────────────────────────────────────────────
 */

// 型別-only import:編譯後被抹除,故與 accountingAgent.ts 之間「無 runtime
// 循環依賴」(accountingAgent.ts 反過來 import 本檔的常數/函式)。
import type {
  AccountingCategory,
  CounterpartyType,
} from "./accountingAgent";

// ── 1. 業主本人身分 ────────────────────────────────────────────────
// 命中 → transfer(內部轉帳,不計營收/費用)。Jeff:「我自己拿出 那不代表
// 公司賺」。比對 payee/payer + 描述,lowercase + 包含比對(中文不受影響)。
// 拼法/大小寫變體都放進來。
export const OWNER_IDENTITIES: readonly string[] = [
  "chun fu hsieh",
  "chunfu hsieh",
  "jun fu hsieh",
  "junfu hsieh",
  "jeff hsieh",
  "謝俊甫",
] as const;

// ── 2. 已知 outflow 供應商 ──────────────────────────────────────────
// 只在出帳(amount>0)時套用。category 為確定性結果(conf 90,跳過 LLM)。
//
// mode:
//   "contains"          — 名稱夠獨特,可掃 merchant+描述+對方 整段 haystack。
//   "counterparty-word" — 短/常見 token,只比對「對方欄位」的完整單字
//                         (\bword\b),避免誤命中描述裡的隨機字。
//   "phrase"            — 多字片語,掃整段 haystack 但帶單字邊界(\bphrase\b)。
//                         專治「名字只在描述裡、對方欄位是 null」的 Zelle 行
//                         (例:"Zelle payment to Ann ...");邊界收尾擋掉
//                         "annual" / "Ann Arbor" 這類誤命中。
export interface KnownVendorRule {
  /** 顯示用乾淨名稱(寫進 counterparty 欄位)。 */
  readonly canonical: string;
  /** lowercase 比對 token(任一命中即算)。 */
  readonly match: readonly string[];
  readonly mode: "contains" | "counterparty-word" | "phrase";
  readonly category: AccountingCategory;
  readonly counterpartyType: CounterpartyType;
  /** 寫進 purposeNote 的業務目的說明。 */
  readonly note: string;
}

export const KNOWN_OUTFLOW_VENDORS: readonly KnownVendorRule[] = [
  {
    canonical: "Jupiter Legend",
    match: ["jupiter legend", "jupiter"],
    mode: "contains",
    category: "cogs_tour",
    counterpartyType: "vendor",
    note: "旅行團供應商付款(簽證/巴士)— 已知 vendor",
  },
  {
    // Bug 2 修正(實測 2026-05-28):Ann 的進帳對方欄位是 null,名字只出現在
    // 描述「Zelle payment to Ann for ...」裡 → 舊的 counterparty-word 永遠
    // 漏接 24 筆 cogs_tour。改吃「片語 + 單字邊界」掃整段:命中
    // "zelle payment to ann" 但不會誤中 "annual" / "Ann Arbor"。
    canonical: "Ann (中國簽證 vendor)",
    match: ["zelle payment to ann", "zelle to ann"],
    mode: "phrase",
    category: "cogs_tour",
    counterpartyType: "vendor",
    note: "中國簽證代辦付款 — 已知 vendor(Ann),Jeff 2026-05-29 確認",
  },
  {
    // US Lion Travel — 旅行團供應商(大阪/東京迪士尼/台灣團…),出帳付團費。
    // 描述「Zelle payment to US LION TRAVEL for ...」,對方欄位常為 null →
    // 用 contains 掃整段。token "lion travel"(兩字,夠獨特)同時涵蓋
    // "US LION TRAVEL" 與 "U S LION TRAVEL"。Jeff 2026-05-29 確認:$30K+、
    // 十幾筆出帳全 cogs_tour(本檔最大供應商之一)。
    canonical: "US Lion Travel",
    match: ["lion travel"],
    mode: "contains",
    category: "cogs_tour",
    counterpartyType: "vendor",
    note: "旅行團供應商付款(Lion Travel)— 代客團費成本",
  },
  {
    // UnitedStars International — 旅行團供應商,出帳付團費。
    // **token 用 "unitedstars"(連寫),嚴禁用 "united"** — 否則會誤命中
    // United Airlines(退款 vendor,見下方 KNOWN_INFLOW_REFUND_VENDORS)。
    // "united air"(含空格)不是 "unitedstars" 的子字串,故兩者不衝突。
    canonical: "UnitedStars International",
    match: ["unitedstars international", "unitedstars"],
    mode: "contains",
    category: "cogs_tour",
    counterpartyType: "vendor",
    note: "旅行團供應商付款(UnitedStars International)— 代客團費成本",
  },
  {
    // 付清 Wells Fargo 卡(operating 戶出帳,描述含 WELLS FARGO CARD …CCPYMT)。
    // Jeff:WF 卡專拿來代客訂機票 → 付卡 = 代客機票成本 cogs_tour。
    // 跟 rule 3(以帳戶名判 WF 卡本身的刷卡)互補:這條看「描述」抓 operating
    // 戶的還款行。實測 2026-05-28,Jeff 2026-05-29 確認 3 筆。
    canonical: "Wells Fargo 卡扣款 (代客機票)",
    match: ["wells fargo card", "wf card ccpymt"],
    mode: "phrase",
    category: "cogs_tour",
    counterpartyType: "vendor",
    note: "付清 Wells Fargo 卡 — 代客機票成本(Expedia 點數)",
  },
  {
    // 已知軟體/SaaS 訂閱 → expense_software(實測 2026-05-28,Jeff 確認 18 筆)。
    // 固定清單比對,Jeff 可自行增刪。token 夠獨特才放 contains。
    canonical: "軟體訂閱",
    match: [
      "xsolla",
      "suno",
      "manus ai",
      "moises",
      "creem",
      "intuit",
      "dummyflight",
    ],
    mode: "contains",
    category: "expense_software",
    counterpartyType: "vendor",
    note: "軟體/SaaS 訂閱費 — 已知軟體 vendor 清單",
  },
] as const;

// ── 2b. 已知旅遊 vendor 的「進帳」= 退款 ───────────────────────────────
// 只在進帳(amount<0)時套用。航空/旅行團 vendor 把錢退回來 → refund
// (沖銷成本,不是營收)。實測 2026-05-28,Jeff 2026-05-29 確認 4 筆。
// 仍是確定性結果(conf 90):已知 vendor 退款風險低。**未知對方的進帳絕不
// 走這條** — refund 只保留給這張白名單,守住「不準猜」。
export const KNOWN_INFLOW_REFUND_VENDORS: readonly KnownVendorRule[] = [
  {
    canonical: "United Airlines (退款)",
    match: ["united airlines", "united air"],
    mode: "contains",
    category: "refund",
    counterpartyType: "refund",
    note: "航空 vendor 退款進帳 — 沖銷代客機票成本",
  },
  {
    canonical: "Jupiter Legend (退款)",
    match: ["jupiter legend", "jupiter"],
    mode: "contains",
    category: "refund",
    counterpartyType: "refund",
    note: "旅行團供應商退款進帳 — 沖銷團體成本",
  },
  {
    // US Lion Travel 退款 — 取消的團 Lion 把錢退回(描述含 "Refund")。
    // 用同一 token "lion travel",但這條只在進帳(amount<0)套用 → refund。
    // Jeff 2026-05-29 確認 1 筆($1,680, 26TN309FU Refund)。
    canonical: "US Lion Travel (退款)",
    match: ["lion travel"],
    mode: "contains",
    category: "refund",
    counterpartyType: "refund",
    note: "旅行團供應商退款進帳(Lion Travel)— 沖銷團體成本",
  },
] as const;

// ── 3. Wells Fargo 卡規則 ───────────────────────────────────────────
// Jeff:「Wells Fargo 都是幫客人訂機票用的(因為要急 Expedia 的點數)」。
// → WF 卡上的「出帳」一律 cogs_tour(代客機票,旅行團直接成本)。
// 以「帳戶名稱含 wells fargo / wf」判斷,而非帳戶 ID(ID 可能改變)。
export const WF_CARD_ACCOUNT_PATTERNS: readonly string[] = [
  "wells fargo",
  "wf card",
  "wells-fargo",
] as const;

// ── 3b. 信用卡自動扣款(還卡費)= transfer ────────────────────────────
// 描述含 "THANK YOU" / "AUTOMATIC PAYMENT" 的「出帳」= 還公司信用卡 = 把自己
// 的錢從支票戶搬去付卡,不是費用也不是收入。實測 2026-05-28:21 筆全是
// Jeff 標 transfer,零例外,Jeff 2026-05-29 確認。
//
// **順序鐵律**:這條在 preClassify 裡排在 vendor(rule 2)+ WF 卡(rule 3)
// 之後。WF 卡還款要走 cogs_tour(代客機票成本),描述含 "WELLS FARGO CARD"
// 會先被 rule 2 攔成 cogs_tour;到這裡的 THANK YOU 都是還「其他」公司卡 →
// transfer。靠執行順序保護 WF 例外,不靠這張清單判斷。
export const CARD_PAYOFF_PATTERNS: readonly string[] = [
  "thank you",
  "automatic payment",
] as const;

// ── 4. memo 關鍵字提示(中信心,不拍板)──────────────────────────────
// 只在「進帳」(amount<0)時當提示:客人付簽證/團費服務費 → 可能 income_booking。
// conf 65 < 90 → 不跳過 LLM,只把提示塞進 user prompt 供參考,仍進待審。
export interface MemoHintRule {
  readonly match: readonly string[]; // lowercase 子字串
  readonly category: AccountingCategory;
  readonly note: string;
}

export const MEMO_HINTS: readonly MemoHintRule[] = [
  {
    match: ["china visa", "chinavisa", "簽證", "visa fee", "visa service"],
    category: "income_booking",
    note: "memo 提及簽證服務 — 可能是客人付的簽證服務費",
  },
  {
    match: ["tour fee", "trip fee", "tour deposit", "團費", "訂金", "package trip"],
    category: "income_booking",
    note: "memo 提及團費/訂金 — 可能是客人付的旅行團款",
  },
] as const;

// ── preClassify ─────────────────────────────────────────────────────

/** 餵給 preClassify 的最小輸入(刻意不依賴 accountingAgent 的大型 input)。 */
export interface PreClassifyInput {
  /** Plaid 慣例:>0 = 出帳(費用), <0 = 進帳(收入)。 */
  amount: number;
  merchantName: string | null;
  description: string | null;
  originalDescription: string | null;
  /** 候選對方(payee/payer),來自 paymentMeta。 */
  counterparty: string | null;
  accountName: string | null;
  accountType: string | null; // "credit" | "depository" | ...
}

export type PreClassifySource =
  | "owner"
  | "vendor"
  | "stripe_payout"
  | "wf_card"
  | "card_payoff"
  | "memo"
  | null;

export interface PreClassifyResult {
  category: AccountingCategory | null;
  confidence: number; // 0-100;>=90 表示確定性(可跳過 LLM)
  reason: string;
  source: PreClassifySource;
  /** 確定性命中時一併給出,讓 service 不必再呼叫 LLM 就能填 IRS 欄位。 */
  counterparty?: string;
  counterpartyType?: CounterpartyType;
  purposeNote?: string;
}

const MISS: PreClassifyResult = {
  category: null,
  confidence: 0,
  reason: "",
  source: null,
};

/** lowercase + 收斂空白 + trim。null/undefined → ""。 */
export function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ── 2c. Stripe 撥款進帳 = 轉帳,非收入(F1 對帳引擎 塊A, 2026-07-08)──────────
// Stripe 把 Checkout 收到的錢撥款進 PACK&GO 銀行帳戶,這筆撥款落地時是一筆普通
// Plaid 進帳(amount<0)。但這筆錢的「收入」已經在 stripeWebhook 當下(客人結帳
// 那一刻,server/_core/stripeWebhook.ts:258-297/1077-1091)寫過一次
// accountingEntries(income)了 —— 撥款落地絕不能再算一次收入,否則雙計(見
// docs/features/finance-dept/dispatch-f1.md 塊C「雙計防護」)。
//
// 這份清單與判斷函式是 F1 塊A(bankTransactionLinkEngine 的 stripe_payout 自動
// link 規則)與塊C(preClassify 雙計防護)共用的唯一來源 —— 塊C 接進 preClassify
// 判斷 bankTransactions.agentCategory 時,直接呼叫這支函式,不重造規則。
//
// ⚠ 2026-07-09 塊D 回爐(指揮打回釘現狀,改真修)+ prod 唯讀探真結論:
//   flyctl ssh 探 prod bankTransactions(1612 筆,408 入帳)發現「stripe」字樣
//   在任何欄位(merchantName/description/originalDescription/paymentMeta)出現
//   次數 = 0。PACK&GO 真實的金流處理商入帳是 Square(descriptor 形如
//   "ACH CREDIT Square Inc SQ ON 06/01"),不是 Stripe;Stripe 目前只做線上
//   Checkout,其撥款尚未落進 Plaid 同步的銀行資料。
//   → 後果:舊版「裸 stripe 單字即命中」在 prod 抓到 0 筆真撥款,卻會把任何
//     姓名/memo 含獨立單字 "stripe" 的真客人入帳誤判成撥款(轉撥不計收入)
//     → 該筆真收入靜默從損益表消失、且永不進待認領(Ann 同類漏斗病)。
//   → 修法(不對稱風險取捨):要求「stripe 錨點 + 撥款語境 token」才命中。
//     真實 Stripe ACH 撥款的銀行摘要慣例帶 "TRANSFER"/"PAYOUT"(Stripe 預設
//     statement descriptor 為 "STRIPE TRANSFER" / "STRIPE PAYOUT")。裸 stripe
//     不再命中 → 落 pending_claim 交 Jeff 覆核(安全:漏抓變人工看,不是靜默
//     消失)。日後真 Stripe 撥款開始落地,Jeff 看到真實 descriptor 再校準本
//     清單(按真資料定,不憑空猜形狀)。
//   只在「進帳」判斷有意義 —— 出帳側含 stripe 是手續費扣款(cogs_other),
//   不屬本規則,呼叫端負責只在 amount<0 時呼叫。
// ── 處理商撥款 descriptor 校準登記(F2 塊C 回令 #4,2026-07-10)────────────────
// 這一段是兩家處理商撥款判斷的「descriptor registry」:每家一組 錨點+語境 token,
// 全部以 prod 真 descriptor 錨定,不憑空猜形狀。校準步驟(任一家撥款形狀改變
// /首次落地時照做):
//   1. flyctl ssh 唯讀探 prod bankTransactions,LIKE 取樣該處理商字樣全形狀
//      (四欄位:merchantName/description/originalDescription/paymentMeta),
//      形狀樣本進 T6/progress 附錄留檔(F1 round3 / F2 塊C 先例)。
//   2. 錨點取「不可能出現在客人姓名/memo 的完整詞組」(如 "square inc"),
//      語境取真 descriptor 內穩定共現的 token;裸品牌單字絕不做錨點
//      (裸 stripe 誤傷案:2026-07-09 塊D 回爐)。
//   3. 改動後跑 accountingKnowledge.test.ts 紅綠(真樣本必中、姓氏/memo 誤傷
//      必不中),並對 prod 全量入帳 dry-run 謂詞命中率覆核。
// Stripe 殘留窗:prod 至今零真 Stripe 撥款(408 筆入帳零 'stripe' 字樣,
// f1-acceptance-20260709.md);首筆真撥款落地時按上述步驟校準下方 token。
export const STRIPE_PAYOUT_DESCRIPTORS: readonly string[] = ["stripe"] as const;
/** 撥款語境 token:錨點單字 "stripe" 必須與其一同現才算撥款,擋掉裸 stripe 誤中。 */
export const STRIPE_PAYOUT_CONTEXT_TOKENS: readonly string[] = ["payout", "transfer"] as const;

// ── 2d. Square 撥款進帳判斷(F2 塊C,2026-07-10)──────────────────────────────
// 探真(2026-07-10,prod 唯讀,樣本進 T6):Square 撥款 19 筆(16 入 3 出),
// 全落 Operating 30001(#2174),descriptor 兩形狀:
//   a. "ACH CREDIT Square Inc SQ ON 06/01"(Plaid description/merchantName)
//   b. "Square Inc DES:SQ190723 ID:Txxxx INDN:PACK & GO, LLC CO ID:xxxx PPD/WEB"
//      (BofA originalDescription)
// 錨點 = 詞組 "square inc"(完整詞組,客人姓 Square 的 memo 不可能帶 "inc"
// 共現 → 裸 square 字樣永不命中,防姓氏誤傷);語境 token = sq / des / ach
// (兩形狀各自穩定含其一)。
//
// ⚠ 與 Stripe 的關鍵差異(探真結論,決定對映設計):Square 撥款入帳目前
// agentCategory 幾乎全是 income_booking,而 Square 銷售幾乎沒有第二處紀錄
// (customOrders paymentMethod='square' 僅 2 筆、accountingEntries 0 筆)——
// 撥款入帳「就是」P&L 唯一收入紀錄,今天不存在雙計。因此本謂詞【不接】
// preClassify、也【不接】linkEngine 自動 link(接了 = 新 Square 入帳被中性
// 桶吃掉 → 真收入從損益靜默消失,Ann 漏斗病同款)。謂詞用途:
//   1. 待認領卡的「撥款形狀」偵測 → 附上費率帶候選銷售(processorPayoutMapping);
//   2. 未來銷售紀錄成熟(recordPayment 紀律 + 次帳)後的自動對映(塊C #3
//      「自動對映留待真資料量夠」)。
// square_payout 中性桶已進 SCHEDULE_C_MAP/枚舉(Jeff 人工歸類用 + 就緒),
// 何時開始自動歸類由指揮/Jeff 依銷售紀錄成熟度裁決。
export const SQUARE_PAYOUT_ANCHOR_PHRASES: readonly string[] = ["square inc"] as const;
export const SQUARE_PAYOUT_CONTEXT_TOKENS: readonly string[] = ["sq", "des", "ach"] as const;

/** haystack 組法同 isStripePayoutInflow(呼叫端負責只在進帳時呼叫)。
 *  命中條件:詞組 "square inc" 完整出現 + 至少一個語境 token(sq/des/ach)
 *  單字邊界命中。裸 "square"(姓氏/memo)永不命中。 */
export function isSquarePayoutInflow(haystack: string): boolean {
  const h = norm(haystack);
  const hasAnchor = SQUARE_PAYOUT_ANCHOR_PHRASES.some((p) => hasWord(h, norm(p)));
  if (!hasAnchor) return false;
  return SQUARE_PAYOUT_CONTEXT_TOKENS.some((token) => hasWord(h, norm(token)));
}

/** haystack 已是呼叫端組好的 merchantName+description+originalDescription+對方
 *  字串(見 preClassify 的 haystack 組法)。呼叫端負責只在進帳時呼叫。
 *
 * 命中條件(2026-07-09 塊D 回爐後):hasWord("stripe") 且 至少一個撥款語境
 * token(payout / transfer)也 hasWord 命中。單字邊界比對(hasWord)沿用,
 * 續擋 "stripeman"/"mystripe" 之類子字串誤中;新增的語境要求再擋掉「客人姓
 * Stripe」「memo 提到 stripe trip」這類裸 stripe 誤中(prod 探真:真撥款 0 筆,
 * 誤中風險 > 真陽性效益,故收緊)。 */
export function isStripePayoutInflow(haystack: string): boolean {
  const h = norm(haystack);
  const hasAnchor = STRIPE_PAYOUT_DESCRIPTORS.some((token) => hasWord(h, norm(token)));
  if (!hasAnchor) return false;
  return STRIPE_PAYOUT_CONTEXT_TOKENS.some((token) => hasWord(h, norm(token)));
}

/** \bword\b 完整單字比對(token 已是 lowercase)。 */
export function hasWord(haystack: string, token: string): boolean {
  if (!token) return false;
  // 轉義 regex 特殊字元;CJK 無 \b 概念,改用「前後非字母數字或邊界」判斷。
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[\x00-\x7F]+$/.test(token)) {
    return new RegExp(`\\b${esc}\\b`, "i").test(haystack);
  }
  // 非 ASCII(中文等):直接包含比對即可(無單字邊界問題)。
  return haystack.includes(token);
}

/** 依 mode 比對一條 vendor 規則。任一 match token 命中即算。 */
function vendorHit(
  rule: KnownVendorRule,
  haystack: string,
  counterparty: string,
): boolean {
  return rule.match.some((m) => {
    const token = norm(m);
    if (!token) return false;
    if (rule.mode === "counterparty-word") return hasWord(counterparty, token);
    if (rule.mode === "phrase") return hasWord(haystack, token);
    return haystack.includes(token); // "contains"
  });
}

/**
 * 確定性 / 提示 pre-classifier。順序就是優先級:
 *   業主身分 → 已知供應商(出帳)→ WF 卡(出帳)→ memo 提示(進帳)→ 不猜(null)。
 */
export function preClassify(input: PreClassifyInput): PreClassifyResult {
  const isOutflow = input.amount > 0;
  const isInflow = input.amount < 0;

  const counterparty = norm(input.counterparty);
  // 完整 haystack 給 "contains" 類比對用。
  const haystack = [
    input.merchantName,
    input.description,
    input.originalDescription,
    input.counterparty,
  ]
    .map(norm)
    .filter(Boolean)
    .join(" | ");

  // 1) 業主本人 — 只在「出帳」時判 transfer(業主提取/墊款出公司戶)。
  //    進帳側「放生」:實測 2026-05-28 證明掛業主名字的進帳(Zelle from
  //    CHUNFU HSIEH 系列)歷史上 Jeff 全標 income_booking — 是客人用業主
  //    個人戶付的團費,不是內部轉帳。硬判 transfer 會把 29 筆真實營收抹掉。
  //    故進帳不在此拍板,往下交給 memo 提示 / LLM / Jeff 審(守「不準猜」)。
  if (isOutflow) {
    for (const id of OWNER_IDENTITIES) {
      const token = norm(id);
      if (!token) continue;
      if (counterparty.includes(token) || haystack.includes(token)) {
        return {
          category: "transfer",
          confidence: 95,
          reason: `對方為業主本人(${id})— 業主提取/墊款出公司戶,內部轉帳不計損益`,
          source: "owner",
          counterparty: "謝俊甫(業主本人)",
          counterpartyType: "owner",
          purposeNote: "業主本人提取/墊款出公司戶 — 內部轉帳不影響損益",
        };
      }
    }
  }

  // 2) 已知 outflow 供應商 — 只在出帳時套用。
  if (isOutflow) {
    for (const v of KNOWN_OUTFLOW_VENDORS) {
      if (vendorHit(v, haystack, counterparty)) {
        return {
          category: v.category,
          confidence: 90,
          reason: `已知供應商付款(${v.canonical})`,
          source: "vendor",
          counterparty: v.canonical,
          counterpartyType: v.counterpartyType,
          purposeNote: v.note,
        };
      }
    }
  }

  // 2b) 已知旅遊 vendor 的進帳 = 退款。只在進帳時套用(確定性 conf 90)。
  if (isInflow) {
    for (const v of KNOWN_INFLOW_REFUND_VENDORS) {
      if (vendorHit(v, haystack, counterparty)) {
        return {
          category: v.category,
          confidence: 90,
          reason: `已知旅遊 vendor 退款進帳(${v.canonical})`,
          source: "vendor",
          counterparty: v.canonical,
          counterpartyType: v.counterpartyType,
          purposeNote: v.note,
        };
      }
    }
  }

  // 2c) Stripe 撥款進帳 = 轉帳,絕不 income_booking(F1 塊C 雙計防護,
  //     2026-07-08)。只在進帳時判斷 —— 出帳側含 "stripe" 是手續費扣款,
  //     不屬本規則管轄(isStripePayoutInflow 呼叫端契約,見上方 2c 節說明)。
  //     與塊A(bankTransactionLinkEngine 的 stripe_payout 自動 link 規則)
  //     共用同一 STRIPE_PAYOUT_DESCRIPTORS/isStripePayoutInflow 來源,防止
  //     兩塊規則各自維護一份判斷邏輯而漂移。
  if (isInflow && isStripePayoutInflow(haystack)) {
    return {
      category: "stripe_payout",
      confidence: 95,
      reason: "Stripe 撥款進帳 — 轉撥落地,收入已在 Stripe 結帳當下記過一次,不可再記",
      source: "stripe_payout",
      counterparty: "Stripe",
      counterpartyType: "transfer",
      purposeNote: "Stripe 撥款落地 — 資金搬運,非二次收入",
    };
  }

  // 3) Wells Fargo 卡出帳 = 代客訂機票 → cogs_tour。
  if (isOutflow) {
    const acct = norm(input.accountName);
    const isWf = WF_CARD_ACCOUNT_PATTERNS.some((p) => acct.includes(norm(p)));
    if (isWf) {
      return {
        category: "cogs_tour",
        confidence: 90,
        reason: "Wells Fargo 卡消費 — Jeff 規則:WF 卡都是代客訂機票",
        source: "wf_card",
        counterparty: input.merchantName?.trim() || "代客機票(WF 卡)",
        counterpartyType: "vendor",
        purposeNote: "代客訂機票 — Wells Fargo 卡(Expedia 點數)",
      };
    }
  }

  // 3b) 信用卡自動扣款(還卡費)= transfer。只在出帳套用,且**必須**排在
  //     vendor(rule 2)+ WF 卡(rule 3)之後 — WF 卡還款已被前面攔成
  //     cogs_tour,到這裡的 THANK YOU / AUTOMATIC PAYMENT 都是還其他公司卡 =
  //     搬自己的錢。實測 21/21 全 transfer,Jeff 2026-05-29 確認。
  if (isOutflow) {
    for (const p of CARD_PAYOFF_PATTERNS) {
      if (hasWord(haystack, norm(p))) {
        return {
          category: "transfer",
          confidence: 90,
          reason: `信用卡自動扣款(${p})— 還公司信用卡,內部轉帳不計損益`,
          source: "card_payoff",
          counterparty: "信用卡還款",
          counterpartyType: "transfer",
          purposeNote: "還公司信用卡卡費 — 內部轉帳,不影響損益",
        };
      }
    }
  }

  // 4) memo 提示 — 只在進帳時,中信心(不拍板,交 LLM 參考)。
  if (isInflow) {
    for (const h of MEMO_HINTS) {
      const hit = h.match.some((m) => haystack.includes(norm(m)));
      if (hit) {
        return {
          category: h.category,
          confidence: 65,
          reason: h.note,
          source: "memo",
        };
      }
    }
  }

  // 5) 不猜。未知對方進帳 / 無訊號 → 交給 LLM(可能仍是 other_review)。
  return MISS;
}

/**
 * 給 accountingAgent.buildSystem() 注入的「知識庫摘要」。
 * 全為靜態常數 → 每次呼叫產出 byte 相同字串,不破壞 Anthropic prompt cache。
 */
export function summarizeKnowledgeForPrompt(): string {
  const owners = OWNER_IDENTITIES.join(" / ");
  const vendors = KNOWN_OUTFLOW_VENDORS.map(
    (v) => `${v.canonical}→${v.category}`,
  ).join("、");
  const refundVendors = KNOWN_INFLOW_REFUND_VENDORS.map((v) =>
    v.canonical.replace(/\s*\(退款\)$/, ""),
  ).join("、");
  return `【PACK&GO 知識庫(已確認規則,優先於你的猜測)】
- 業主本人「出帳」= transfer(業主提取/墊款,不計營收): ${owners}
- 業主本人「進帳」不自動判 → 多半是客人用業主個人戶付的團費(income_booking),交 LLM/Jeff 確認,別硬判 transfer
- 已知供應商出帳: ${vendors}
- 已知旅遊 vendor 進帳 = 退款 refund(沖銷成本): ${refundVendors}
- Wells Fargo 卡的出帳 / 付清 WF 卡 = 代客訂機票 → cogs_tour
- 信用卡自動扣款出帳(描述含 THANK YOU / AUTOMATIC PAYMENT)= transfer(還公司卡,不計損益);WF 卡還款例外仍走 cogs_tour
- 進帳 memo 含「簽證/團費/訂金/visa」等 → 多半是 income_booking(客人付服務費),但仍需確認
- 未知對方的進帳(無記名、無 memo)→ 不要猜成收入,回 other_review 讓 Jeff 確認`;
}
