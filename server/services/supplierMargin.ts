/**
 * supplierMargin — 批5 m5 成本毛利稽核(唯讀)。
 *
 * Joins imported tours back to their supplier mirror via the external code
 * embedded in tours.sourceUrl (same identifier convention as
 * suppliersRouter's notYetImported / mass-import queries), takes the MIN
 * future-departure agentPrice as cost, and computes margin against Jeff's
 * selling price.
 *
 * 誠實規則:cost 與售價幣別不同時不換匯不假算 — margin=null +
 * currencyMismatch=true,前端照實顯示。
 */

export type MarginAuditRawRow = {
  tourId: number;
  title: string;
  price: number;
  priceCurrency: string;
  externalProductCode: string;
  supplierCode: string;
  /** decimal column → mysql2 returns string. */
  minCost: string | number | null;
  costCurrency: string | null;
};

export type MarginAuditItem = {
  tourId: number;
  title: string;
  price: number;
  priceCurrency: string;
  externalProductCode: string;
  supplierCode: string;
  cost: number | null;
  costCurrency: string | null;
  /** (price − cost) / price, rounded to 3 decimals. null = not computable. */
  margin: number | null;
  belowThreshold: boolean;
  currencyMismatch: boolean;
};

/**
 * Shape + sort raw join rows. Worst margin first; rows we could not compute
 * (currency mismatch / missing cost / price<=0) sink to the bottom but stay
 * visible — hiding them would fake a clean audit.
 */
export function shapeMarginAudit(
  rows: MarginAuditRawRow[],
  threshold: number,
): MarginAuditItem[] {
  const items = rows.map((r): MarginAuditItem => {
    const cost = r.minCost == null ? null : Number(r.minCost);
    const costOk = cost != null && Number.isFinite(cost) && cost > 0;
    const mismatch =
      costOk && r.costCurrency != null && r.costCurrency !== r.priceCurrency;
    const computable = costOk && !mismatch && r.price > 0;
    const margin = computable
      ? Math.round(((r.price - (cost as number)) / r.price) * 1000) / 1000
      : null;
    return {
      tourId: r.tourId,
      title: r.title,
      price: r.price,
      priceCurrency: r.priceCurrency,
      externalProductCode: r.externalProductCode,
      supplierCode: r.supplierCode,
      cost: costOk ? cost : null,
      costCurrency: r.costCurrency,
      margin,
      belowThreshold: margin != null && margin < threshold,
      currencyMismatch: Boolean(mismatch),
    };
  });

  return items.sort((a, b) => {
    if (a.margin == null && b.margin == null) return a.tourId - b.tourId;
    if (a.margin == null) return 1;
    if (b.margin == null) return -1;
    return a.margin - b.margin;
  });
}
