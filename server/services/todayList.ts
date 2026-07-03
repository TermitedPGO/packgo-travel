/**
 * todayList — 客戶頁駕駛艙 Phase4 今日清單(design-phase3-4.md「Phase4」節)。
 * 中欄空狀態(沒選客人時)顯示全公司今天該做的事,零 LLM、純規則計算,寧漏勿誤。
 *
 * 五條規則各自純函式,輸入是呼叫端已經查好、篩過非空欄位的資料;任何必要欄位
 * 缺值就回 null,不猜。曆日比較一律用字串比較或 Date.parse(YYYY-MM-DD 當 UTC
 * 午夜)相減,不用時間戳相減除以毫秒再手動處理時區 —— 跟 customOrderWatchdog.ts
 * 既有的 laDayDiff / laDayDiffFromDateStrings 同一套精神。
 */

export type TodayListCategory =
  | "followUpDue"
  | "quoteExpiring"
  | "commitment"
  | "departureCountdown"
  | "balanceDue";

export type TodayListItem = {
  category: TodayListCategory;
  customerProfileId: number;
  /** customerProfiles.userId — 呼叫端(router)查好餵進來,null = 訪客(guest)。
   *  前端選客機制(CustomerList.tsx onSelect)用 {id, kind} 定位客人,guest 的
   *  id 是 customerProfileId 本身,registered user 的 id 卻是 userId(不是
   *  profileId)— 兩者是不同的 id 空間,todayList 端點若只帶 customerProfileId,
   *  前端無法組出 registered 客人正確的 onSelect ref。帶上 userId 讓前端直接
   *  判斷 kind,不用另開查詢或發明新路由(design-phase3-4.md 只提到帶
   *  customerProfileId,這是必要的最小延伸,見 todayList router 註解)。 */
  userId: number | null;
  customerName: string | null;
  oneLiner: string;
  /** 數字或字串,越緊急排越前面(前端可直接依此排序攤平顯示)。 */
  sortKey: number | string;
};

const DAY_MS = 86_400_000;

/** 兩個 YYYY-MM-DD 曆日字串的天數差(to − from)。兩邊都已經是純日期字串,
 *  Date.parse 一律當 UTC 午夜,相減即曆日差 —— 跟 customOrderWatchdog.ts 的
 *  laDayDiffFromDateStrings 同一套寫法,不重新發明時區數學。 */
function dayDiff(fromDateStr: string, toDateStr: string): number {
  return Math.round((Date.parse(toDateStr) - Date.parse(fromDateStr)) / DAY_MS);
}

// ── 1. 到期跟進(customerProfiles.followUpDate)──────────────────────────────

export type FollowUpDueInput = {
  id: number;
  /** customerProfiles.userId — null = 訪客(guest)。見 TodayListItem.userId 註解。 */
  userId: number | null;
  name: string | null;
  followUpDate: string | null;
};

/**
 * followUpDate 有值且 <= todayLA(字串比較,YYYY-MM-DD 天然可排序)才回傳項目。
 * 沒設跟進日 → null(誠實,不猜)。
 */
export function evaluateFollowUpDue(
  profile: FollowUpDueInput,
  todayLA: string,
): TodayListItem | null {
  if (!profile.followUpDate) return null;
  if (profile.followUpDate > todayLA) return null; // 還沒到期

  return {
    category: "followUpDue",
    customerProfileId: profile.id,
    userId: profile.userId,
    customerName: profile.name,
    oneLiner: profile.name
      ? `${profile.name}:今天該跟進了`
      : "今天該跟進了",
    // 越早該跟進(followUpDate 越舊)越緊急 → 字串本身就可排序,越小越前面。
    sortKey: profile.followUpDate,
  };
}

// ── 2. 報價將過期(customOrders.quoteSentAt + 客人最後一次 inbound)─────────

export type QuoteExpiringInput = {
  customerProfileId: number;
  /** customerProfiles.userId — null = 訪客(guest)。見 TodayListItem.userId 註解。 */
  userId: number | null;
  customerName: string | null;
  quoteSentAt: string | null;
  /** 客人最後一次 inbound 互動日期(YYYY-MM-DD),呼叫端已經查好餵進來。 */
  lastInboundAt: string | null;
};

const QUOTE_EXPIRING_SOON_DAYS = 11;
const QUOTE_EXPIRED_DAYS = 14;

/**
 * quoteSentAt 為 null → null。客人最後一次 inbound 晚於或等於 quoteSentAt
 * (已經回覆過這次報價,不用再提醒)→ null。距今天數 < 11 → null(還早);
 * 11-13 天(含)→「還剩 N 天」;>= 14 天(達到/超過 14 天效期)→「已過效期」。
 */
export function evaluateQuoteExpiring(
  order: QuoteExpiringInput,
  todayLA: string,
): TodayListItem | null {
  if (!order.quoteSentAt) return null;
  if (order.lastInboundAt && order.lastInboundAt >= order.quoteSentAt) return null;

  const days = dayDiff(order.quoteSentAt, todayLA);
  if (days < QUOTE_EXPIRING_SOON_DAYS) return null; // 還早

  const namePrefix = order.customerName ? `${order.customerName}:` : "";
  if (days >= QUOTE_EXPIRED_DAYS) {
    return {
      category: "quoteExpiring",
      customerProfileId: order.customerProfileId,
      userId: order.userId,
      customerName: order.customerName,
      oneLiner: `${namePrefix}報價已過效期(寄出 ${days} 天)`,
      sortKey: -days, // 過期越久越緊急,越前面
    };
  }

  const daysLeft = QUOTE_EXPIRED_DAYS - days;
  return {
    category: "quoteExpiring",
    customerProfileId: order.customerProfileId,
    userId: order.userId,
    customerName: order.customerName,
    oneLiner: `${namePrefix}報價還剩 ${daysLeft} 天到期`,
    sortKey: daysLeft, // 剩越少天越緊急,排越前面(正數,天然比未過期的 case 更前)
  };
}

// ── 3. 承諾未兌現 — 轉換函式,判斷邏輯來自 Phase3a findCommitmentIssues ──────

/** customOrderWatchdog.CustomerPromiseFinding 的最小形狀(避免直接 import 型別
 *  造成循環相依疑慮;欄位跟 customOrderWatchdog.ts 的 CustomerPromiseFinding 對齊)。 */
export type CommitmentFindingInput = {
  customerProfileId: number;
  promiseText: string;
  daysOverdue: number;
};

/**
 * 純形狀轉換,不是規則判斷 —— findCommitmentIssues 已經做過判斷(過期未兌現才會
 * 出現在輸入陣列裡),這裡只是把 CustomerPromiseFinding 轉成 TodayListItem。
 * customerName/userId 由呼叫端另外查好傳入(finding 本身沒有這兩欄),沒有就
 * 顯示/帶 null。
 */
export function commitmentToTodayItem(
  finding: CommitmentFindingInput,
  customerName: string | null,
  userId: number | null = null,
): TodayListItem {
  const namePrefix = customerName ? `${customerName}:` : "";
  return {
    category: "commitment",
    customerProfileId: finding.customerProfileId,
    userId,
    customerName,
    oneLiner: `${namePrefix}承諾「${finding.promiseText}」已過期 ${finding.daysOverdue} 天未兌現`,
    sortKey: -finding.daysOverdue, // 過期越久越緊急
  };
}

// ── 4. 出發倒數(customOrders.departureDate)─────────────────────────────────

export type DepartureCountdownInput = {
  customerProfileId: number;
  /** customerProfiles.userId — null = 訪客(guest)。見 TodayListItem.userId 註解。 */
  userId: number | null;
  customerName: string | null;
  departureDate: string | null;
};

const DEPARTURE_COUNTDOWN_WINDOWS = [30, 7] as const;

/**
 * departureDate 為 null → null。距今天數精確等於 30 或精確等於 7 才回傳項目
 * (精確視窗,不是範圍,一天只提醒一次;參考既有 tripReminder 倒數視窗寫法但只取
 * 30 跟 7 這兩個精確值)。文案講證件檢查提醒(護照/簽證/選位)。
 */
export function evaluateDepartureCountdown(
  order: DepartureCountdownInput,
  todayLA: string,
): TodayListItem | null {
  if (!order.departureDate) return null;

  const days = dayDiff(todayLA, order.departureDate);
  if (!DEPARTURE_COUNTDOWN_WINDOWS.includes(days as 30 | 7)) return null;

  const namePrefix = order.customerName ? `${order.customerName}:` : "";
  return {
    category: "departureCountdown",
    customerProfileId: order.customerProfileId,
    userId: order.userId,
    customerName: order.customerName,
    oneLiner: `${namePrefix}距出發還有 ${days} 天,提醒證件檢查(護照/簽證/選位)`,
    sortKey: days, // 越接近出發(天數越小)越緊急
  };
}

// ── 5. 尾款到期(customOrders.totalPrice/depositPaidAt/balancePaidAt/departureDate)──

export type BalanceDueInput = {
  customerProfileId: number;
  /** customerProfiles.userId — null = 訪客(guest)。見 TodayListItem.userId 註解。 */
  userId: number | null;
  customerName: string | null;
  totalPrice: string | number | null;
  depositPaidAt: string | null;
  balancePaidAt: string | null;
  departureDate: string | null;
};

const BALANCE_DUE_WINDOW_DAYS = 30;

/**
 * totalPrice 為 null、或 depositPaidAt 為 null、或 balancePaidAt 有值(已收完)、
 * 或 departureDate 為 null → null。distance = departureDate − todayLA:
 * > 30 天 → null(還不急);< 0(已出發)→ null;0-30 天(含)才回傳項目。
 */
export function evaluateBalanceDue(
  order: BalanceDueInput,
  todayLA: string,
): TodayListItem | null {
  if (order.totalPrice == null) return null;
  if (order.depositPaidAt == null) return null;
  if (order.balancePaidAt != null) return null; // 已收完尾款
  if (!order.departureDate) return null;

  const daysToDeparture = dayDiff(todayLA, order.departureDate);
  if (daysToDeparture > BALANCE_DUE_WINDOW_DAYS) return null; // 還不急
  if (daysToDeparture < 0) return null; // 已經出發

  const namePrefix = order.customerName ? `${order.customerName}:` : "";
  return {
    category: "balanceDue",
    customerProfileId: order.customerProfileId,
    userId: order.userId,
    customerName: order.customerName,
    oneLiner: `${namePrefix}尾款到期提醒(距出發 ${daysToDeparture} 天)`,
    sortKey: daysToDeparture, // 越接近出發越緊急
  };
}
