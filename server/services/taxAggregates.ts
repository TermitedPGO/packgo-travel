/**
 * taxAggregates —— F3 塊D 報表與稅務頁的兩個純聚合(2026-07-10 回爐 #1 抽取)。
 *
 * 照 repo 慣例(foldBankPLRows / foldOutstandingTrust / buildBackfillReport):
 * 純函式無 DB,單測直接餵形狀;plaidRouter 的 plMonthlyTrend / vendor1099List
 * 只負責取 rows 與逐月呼叫 generateBankPL,數學都在這裡。
 */

/** 月度趨勢的期間窗:當年止於本月(endDate = 今天),過去年 12 個月全出,未來年空。 */
export interface MonthWindow {
  month: number;
  startDate: string;
  endDate: string;
}

export function monthlyTrendWindows(year: number, todayStr: string): MonthWindow[] {
  const curY = Number(todayStr.slice(0, 4));
  const curM = Number(todayStr.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastMonth = year < curY ? 12 : year > curY ? 0 : curM;

  const out: MonthWindow[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    out.push({
      month: m,
      startDate: `${year}-${pad(m)}-01`,
      endDate:
        year === curY && m === curM
          ? todayStr
          // new Date(y, m, 0).getDate() = 該月天數(純曆法,與時區無關)
          : `${year}-${pad(m)}-${pad(new Date(year, m, 0).getDate())}`,
    });
  }
  return out;
}

/** vendor1099 的輸入列(bankTransactions 相關欄位,寬鬆型別吃真 row)。 */
export interface Vendor1099RowLike {
  counterparty: string | null;
  merchantName: string | null;
  amount: string | number;
  agentCategory: string | null;
  jeffOverrideCategory: string | null;
}

export const VENDOR_1099_THRESHOLD = 600;

/**
 * 1099-NEC 候選彙總:
 *   - 分類 Jeff override 優先(bankPLService 同一優先序),只算 cogs_tour
 *   - amt <= 0 跳過(正 = 流出付款;毛額語義,退款不淨扣 —— UI note 已標注)
 *   - 名稱 fallback 鏈:counterparty → merchantName → 空名跳過
 *   - 年累計 >= $600 才進清單(600.00 含、599.99 不含),金額大到小排序
 */
export function foldVendor1099(
  rows: Vendor1099RowLike[],
  threshold: number = VENDOR_1099_THRESHOLD,
): { counterparty: string; total: number }[] {
  const byVendor = new Map<string, number>();
  for (const r of rows) {
    const cat = r.jeffOverrideCategory ?? r.agentCategory;
    if (cat !== "cogs_tour") continue;
    const amt = parseFloat(String(r.amount)) || 0;
    if (amt <= 0) continue;
    const name = (r.counterparty || r.merchantName || "").trim();
    if (!name) continue;
    byVendor.set(name, (byVendor.get(name) ?? 0) + amt);
  }
  return [...byVendor.entries()]
    .map(([counterparty, total]) => ({
      counterparty,
      total: Math.round(total * 100) / 100,
    }))
    .filter((v) => v.total >= threshold)
    .sort((a, b) => b.total - a.total);
}
