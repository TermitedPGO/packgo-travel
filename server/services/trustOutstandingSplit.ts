/**
 * trustOutstandingSplit —— Trust 未認列餘額的三段拆分(F3 塊A 回爐 P1,2026-07-10)。
 *
 * B-final 定稿的 Trust 勾稽等式(缺一不可):
 *   未認列總額 = 已對應未出發(matchedNotDeparted)
 *              + 已出發待認列(departedPending)
 *              + 未對應待認領(unmatched)
 *
 * 真相列 Trust 格的主數字是 matchedNotDeparted(38,600 口徑),不是全部
 * outstanding(54,022 口徑)—— 塊A 初版用錯口徑被指揮驗收抓 P1,本檔釘死。
 *
 * 純函式(無 DB),caller(plaidRouter.trustReconciliation)負責先過濾
 * recognizedAt IS NULL AND reversedAt IS NULL 再傳入 —— 與
 * trustDeferralService.foldOutstandingTrust 同一 caller 合約。
 * 本檔刻意不放進 trustDeferralService(F2 並行 branch 在動那一帶,禁碰)。
 */

export interface TrustSplitRowLike {
  amount: string | number;
  bookingId: number | null;
  /** MySQL DATE 欄位:mysql2 可能回 'YYYY-MM-DD' 字串或 local-midnight Date。 */
  expectedRecognitionDate: string | Date | null;
}

export interface TrustOutstandingSplit {
  /** 已對應且未出發 —— 真相列主數字(B-final 38,600 口徑)。 */
  matchedNotDeparted: number;
  /** 已對應且已出發(可認列,等 Jeff 按)。 */
  departedPending: number;
  departedPendingCount: number;
  /** 未對應(對不到 booking)。 */
  unmatched: number;
  unmatchedCount: number;
  /** 三段之和 = 全部未認列(等式驗算用;鐵則測試釘死)。 */
  total: number;
}

/**
 * DATE 欄位 → 'YYYY-MM-DD' 曆日字串。
 * mysql2 對 DATE 欄回 local-midnight Date 物件 —— 用 local getters 還原 SQL
 * 曆日(用 toISOString 會在非 UTC 伺服器上偏一天;T2 地雷 #2 同族)。
 */
export function dateOnly(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 今天的 America/Los_Angeles 曆日('YYYY-MM-DD')。
 * 「出發了沒」是 LA 業務曆日概念:比較的兩端(DB 的 expectedRecognitionDate
 * 曆日字串 vs 今天)都用同一套 LA 換算(T2 地雷 #2:UTC 伺服器傍晚後
 * toISOString 會系統性早一天)。
 */
export function laToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * 三段拆分。分類規則(互斥完備,故 total 恆等於三段之和):
 *   - bookingId 空                          → unmatched
 *   - bookingId 有 + 認列日 <= 今天(LA)     → departedPending(出發了,可認列)
 *   - bookingId 有 + 認列日 > 今天 或 null   → matchedNotDeparted
 *     (認列日 null = recognizeReadyDepartures 還排不進認列,視為未到期)
 */
export function splitOutstandingTrust(
  rows: TrustSplitRowLike[],
  todayStr: string = laToday(),
): TrustOutstandingSplit {
  const out: TrustOutstandingSplit = {
    matchedNotDeparted: 0,
    departedPending: 0,
    departedPendingCount: 0,
    unmatched: 0,
    unmatchedCount: 0,
    total: 0,
  };
  for (const r of rows) {
    const a = parseFloat(r.amount as any) || 0;
    out.total += a;
    if (!r.bookingId) {
      out.unmatched += a;
      out.unmatchedCount++;
      continue;
    }
    const rec = dateOnly(r.expectedRecognitionDate);
    if (rec !== null && rec <= todayStr) {
      out.departedPending += a;
      out.departedPendingCount++;
    } else {
      out.matchedNotDeparted += a;
    }
  }
  return out;
}
