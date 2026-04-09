/**
 * 中國簽證代辦定價服務
 *
 * 全包價，包含：領事館簽證費 + 證件照拍攝 + 代填表格 + 人工運送至領事館
 * 客戶不需要再付任何額外費用。
 *
 *   $290/人 — 個人申請
 *   $275/人 — 團體申請（2 人以上同時申請）
 */

export const CHINA_VISA_PRICING = {
  regular: 290,       // 個人價 USD
  group: 275,         // 團體價 USD
  groupMinSize: 2,    // 2 人以上即為團體
} as const;

export interface VisaPricingResult {
  pricePerPerson: number;    // 290 or 275
  groupSize: number;
  grandTotal: number;        // pricePerPerson × groupSize
  isGroupDiscount: boolean;
  savedPerPerson: number;    // 0 or 15
}

export function calculateVisaPricing(input: {
  groupSize: number;
}): VisaPricingResult {
  const { groupSize } = input;
  const isGroup = groupSize >= CHINA_VISA_PRICING.groupMinSize;
  const pricePerPerson = isGroup ? CHINA_VISA_PRICING.group : CHINA_VISA_PRICING.regular;

  return {
    pricePerPerson,
    groupSize,
    grandTotal: pricePerPerson * groupSize,
    isGroupDiscount: isGroup,
    savedPerPerson: isGroup ? CHINA_VISA_PRICING.regular - CHINA_VISA_PRICING.group : 0,
  };
}
