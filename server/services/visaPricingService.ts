/**
 * visaPricingService.ts
 * 中國簽證代辦定價服務
 *
 * 定價結構：
 *   serviceFee  = 代辦服務費（我們收取）
 *   consulateFee = 領事館簽證費（政府費用，依國籍而定）
 *   totalAmount  = serviceFee + consulateFee
 *
 * 折扣規則：
 *   - 團體（5人以上）：服務費 10% off
 *   - 回頭客：服務費 5% off
 */

export type VisaType =
  | "L_tourist"
  | "M_business"
  | "Q1_family_long"
  | "Q2_family_short"
  | "S1_dependent_long"
  | "S2_dependent_short"
  | "Z_work"
  | "X1_study_long"
  | "X2_study_short";

export type EntryType = "single" | "double" | "multiple_6m" | "multiple_12m";
export type ProcessingSpeed = "regular" | "express" | "rush";
export type DiscountType = "none" | "group" | "returning";

export interface PricingInput {
  visaType: VisaType;
  entryType: EntryType;
  processingSpeed: ProcessingSpeed;
  passportCountry: string;
  groupSize?: number;
  isReturningCustomer?: boolean;
}

export interface PricingResult {
  serviceFee: number;
  consulateFee: number;
  totalAmount: number;
  discountType: DiscountType;
  discountAmount: number;
  breakdown: PricingBreakdown;
}

export interface PricingBreakdown {
  baseServiceFee: number;
  entryTypeSurcharge: number;
  processingSpeedSurcharge: number;
  consulateFee: number;
  discountAmount: number;
  discountLabel: string;
  totalAmount: number;
}

// ── 基本服務費（依簽證類型）──────────────────────────────────
const BASE_SERVICE_FEE: Record<VisaType, number> = {
  L_tourist: 120,       // 旅遊簽證
  M_business: 150,      // 商務簽證
  Q1_family_long: 180,  // 家庭團聚（長期）
  Q2_family_short: 150, // 家庭團聚（短期）
  S1_dependent_long: 180, // 隨行家屬（長期）
  S2_dependent_short: 150, // 隨行家屬（短期）
  Z_work: 200,          // 工作簽證
  X1_study_long: 180,   // 學生簽證（長期）
  X2_study_short: 150,  // 學生簽證（短期）
};

// ── 入境次數附加費 ────────────────────────────────────────────
const ENTRY_TYPE_SURCHARGE: Record<EntryType, number> = {
  single: 0,
  double: 20,
  multiple_6m: 50,
  multiple_12m: 80,
};

// ── 加急處理附加費 ────────────────────────────────────────────
const PROCESSING_SPEED_SURCHARGE: Record<ProcessingSpeed, number> = {
  regular: 0,    // 普通（10-15 個工作日）
  express: 60,   // 加急（5-7 個工作日）
  rush: 120,     // 特急（2-3 個工作日）
};

// ── 領事館費用（依護照國籍）──────────────────────────────────
// 美國公民費用較高（互惠原則）
const CONSULATE_FEE_BY_COUNTRY: Record<string, number> = {
  "United States": 185,
  "Canada": 100,
  "United Kingdom": 151,
  "Australia": 100,
  "Germany": 75,
  "France": 75,
  "Japan": 50,
  "South Korea": 50,
  "Taiwan": 50,
  "Singapore": 50,
  "Malaysia": 50,
  "Thailand": 50,
  "Philippines": 50,
  "Vietnam": 50,
  "Indonesia": 50,
  "India": 50,
  "Brazil": 50,
  "Mexico": 50,
  "Argentina": 50,
};

const DEFAULT_CONSULATE_FEE = 75; // 其他國家預設

// ── 折扣規則 ──────────────────────────────────────────────────
const GROUP_DISCOUNT_RATE = 0.10;     // 10% off 服務費
const RETURNING_DISCOUNT_RATE = 0.05; // 5% off 服務費
const GROUP_DISCOUNT_MIN_SIZE = 5;    // 5人以上才算團體

/**
 * 計算簽證申請費用
 */
export function calculateVisaPricing(input: PricingInput): PricingResult {
  const {
    visaType,
    entryType,
    processingSpeed,
    passportCountry,
    groupSize = 1,
    isReturningCustomer = false,
  } = input;

  const baseServiceFee = BASE_SERVICE_FEE[visaType];
  const entryTypeSurcharge = ENTRY_TYPE_SURCHARGE[entryType];
  const processingSpeedSurcharge = PROCESSING_SPEED_SURCHARGE[processingSpeed];
  const consulateFee = CONSULATE_FEE_BY_COUNTRY[passportCountry] ?? DEFAULT_CONSULATE_FEE;

  // 服務費小計（折扣前）
  const serviceSubtotal = baseServiceFee + entryTypeSurcharge + processingSpeedSurcharge;

  // 決定折扣類型（團體優先）
  let discountType: DiscountType = "none";
  let discountRate = 0;

  if (groupSize >= GROUP_DISCOUNT_MIN_SIZE) {
    discountType = "group";
    discountRate = GROUP_DISCOUNT_RATE;
  } else if (isReturningCustomer) {
    discountType = "returning";
    discountRate = RETURNING_DISCOUNT_RATE;
  }

  const discountAmount = Math.round(serviceSubtotal * discountRate * 100) / 100;
  const serviceFee = Math.round((serviceSubtotal - discountAmount) * 100) / 100;
  const totalAmount = Math.round((serviceFee + consulateFee) * 100) / 100;

  const discountLabel =
    discountType === "group"
      ? `團體優惠 (${groupSize}人) -${Math.round(GROUP_DISCOUNT_RATE * 100)}%`
      : discountType === "returning"
      ? `回頭客優惠 -${Math.round(RETURNING_DISCOUNT_RATE * 100)}%`
      : "";

  return {
    serviceFee,
    consulateFee,
    totalAmount,
    discountType,
    discountAmount,
    breakdown: {
      baseServiceFee,
      entryTypeSurcharge,
      processingSpeedSurcharge,
      consulateFee,
      discountAmount,
      discountLabel,
      totalAmount,
    },
  };
}

/**
 * 取得簽證類型的中文名稱
 */
export function getVisaTypeName(visaType: VisaType, lang: "zh" | "en" = "zh"): string {
  const names: Record<VisaType, { zh: string; en: string }> = {
    L_tourist: { zh: "L 簽 — 旅遊簽證", en: "L Visa — Tourist" },
    M_business: { zh: "M 簽 — 商務簽證", en: "M Visa — Business" },
    Q1_family_long: { zh: "Q1 簽 — 家庭團聚（長期）", en: "Q1 Visa — Family Reunion (Long-term)" },
    Q2_family_short: { zh: "Q2 簽 — 家庭探親（短期）", en: "Q2 Visa — Family Visit (Short-term)" },
    S1_dependent_long: { zh: "S1 簽 — 隨行家屬（長期）", en: "S1 Visa — Dependent (Long-term)" },
    S2_dependent_short: { zh: "S2 簽 — 隨行家屬（短期）", en: "S2 Visa — Dependent (Short-term)" },
    Z_work: { zh: "Z 簽 — 工作簽證", en: "Z Visa — Work" },
    X1_study_long: { zh: "X1 簽 — 學生簽證（長期）", en: "X1 Visa — Student (Long-term)" },
    X2_study_short: { zh: "X2 簽 — 學生簽證（短期）", en: "X2 Visa — Student (Short-term)" },
  };
  return names[visaType][lang];
}

/**
 * 取得處理速度的中文名稱與預估時間
 */
export function getProcessingSpeedInfo(
  speed: ProcessingSpeed,
  lang: "zh" | "en" = "zh"
): { label: string; duration: string } {
  const info: Record<ProcessingSpeed, { zh: { label: string; duration: string }; en: { label: string; duration: string } }> = {
    regular: {
      zh: { label: "普通", duration: "10-15 個工作日" },
      en: { label: "Regular", duration: "10-15 business days" },
    },
    express: {
      zh: { label: "加急", duration: "5-7 個工作日" },
      en: { label: "Express", duration: "5-7 business days" },
    },
    rush: {
      zh: { label: "特急", duration: "2-3 個工作日" },
      en: { label: "Rush", duration: "2-3 business days" },
    },
  };
  return info[speed][lang];
}

/**
 * 取得入境次數的中文名稱
 */
export function getEntryTypeName(entryType: EntryType, lang: "zh" | "en" = "zh"): string {
  const names: Record<EntryType, { zh: string; en: string }> = {
    single: { zh: "單次入境", en: "Single Entry" },
    double: { zh: "兩次入境", en: "Double Entry" },
    multiple_6m: { zh: "半年多次入境", en: "Multiple Entry (6 months)" },
    multiple_12m: { zh: "一年多次入境", en: "Multiple Entry (12 months)" },
  };
  return names[entryType][lang];
}

/**
 * 取得所有支援的護照國家清單
 */
export function getSupportedCountries(): string[] {
  return [
    "United States",
    "Canada",
    "United Kingdom",
    "Australia",
    "Germany",
    "France",
    "Japan",
    "South Korea",
    "Taiwan",
    "Singapore",
    "Malaysia",
    "Thailand",
    "Philippines",
    "Vietnam",
    "Indonesia",
    "India",
    "Brazil",
    "Mexico",
    "Argentina",
    "Other",
  ];
}

/**
 * 取得指定國家的領事館費用
 */
export function getConsulateFee(country: string): number {
  return CONSULATE_FEE_BY_COUNTRY[country] ?? DEFAULT_CONSULATE_FEE;
}
