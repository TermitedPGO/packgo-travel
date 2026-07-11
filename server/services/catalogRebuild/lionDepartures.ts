/**
 * catalogRebuild/lionDepartures — Lion 班期 adapter (純函式).
 *
 * UV 與 Lion 的 supplierDepartures.rawDepartureJson 形狀不同,所以重建管線在
 * index.ts 的 per-supplier adapter 層各自把「鏡像 raw → 乾淨客人班期」算好,再餵給
 * supplier-無關的 staging。這支是 Lion 那半,對照 UV 的 `buildDepartureFromMirrorRow`
 * (uvBulkImportService.ts)。
 *
 * Lion 的 rawDepartureJson 是一個 `LionGroupEntry`:
 *   { GroupID, GoDate:"YYYY/MM/DD", Status, StraightLowestPrice, IndustryLowestPrice, ... }
 *
 * 紅線(焊死,測試釘住):
 *   - 起價一律取 **StraightLowestPrice(直客/零售價)**,絕不取 IndustryLowestPrice
 *     (同業價 = 我們的成本;guard.ts 的禁字也擋 industrylowestprice + agentprice)。
 *   - 幣別:Lion 全 TWD。**這支只算 TWD**(純同步、可測);TWD→USD 換匯是 async,
 *     放在 index.ts 的 adapter 層(見 `convertLionDeparturesToUsd`,吃一個已 fetch 好
 *     的匯率 number,仍是純函式可測)。別把 async 換匯塞進 buildStagedTour 純函式。
 *   - GroupID 漂移:只建「未來」班期(過去的跳過),代表團(明細用)取最近未來那顆
 *     (`pickRepresentativeGroupId`),不拿鏡像最舊那顆(lion-audit §2.3)。
 */

import type { BuiltMirrorDeparture } from "../uvBulkImportService";

/** 一筆從 Lion 鏡像 rawDepartureJson 建出的班期(價格仍是 TWD,尚未換匯)。 */
export interface BuiltLionDeparture {
  departureDate: Date;
  returnDate: Date;
  /** 直客零售價,單位 TWD。由 `convertLionDeparturesToUsd` 換成 USD。 */
  adultPriceTwd: number;
  totalSlots: number;
  bookedSlots: number;
  status: "open" | "full";
  /** 這筆班期的 Lion GroupID(含出發日碼,如 26TS716SL38-T)。代表團選取用。 */
  groupId: string;
}

/** 去掉千分位逗號後轉數字。壞值回 0。 */
function parseLionPrice(s: string | number | null | undefined): number {
  if (s == null) return 0;
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * 把一筆 Lion 鏡像 rawDepartureJson 建成一筆班期(TWD)。
 *
 * 回 null 的情況(與 UV 一致 — 寧可跳過不亂建):無法解析、無 GoDate、日期不合法、
 * 已過期(< todayMs)、或直客價 <= 0(沒有可用零售價)。**永不取同業價當退路。**
 */
export function buildLionDepartureFromMirrorRow(
  rawDepartureJson: string | null | undefined,
  tripDays: number,
  todayMs: number,
): BuiltLionDeparture | null {
  if (!rawDepartureJson) return null;
  let dep: {
    GroupID?: string;
    GoDate?: string;
    Status?: string;
    StraightLowestPrice?: string | number;
    IndustryLowestPrice?: string | number;
  } | null;
  try {
    dep = JSON.parse(rawDepartureJson);
  } catch {
    return null;
  }
  if (!dep || !dep.GoDate) return null;
  // Lion GoDate 是 "YYYY/MM/DD"(也容忍 "-" 分隔)。
  const m = String(dep.GoDate).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || !month || !day) return null;
  const departureDate = new Date(year, month - 1, day, 8, 0, 0);
  if (departureDate.getTime() < todayMs) return null; // 跳過過去班期

  // 起價 = 直客零售價(Straight)。絕不碰 IndustryLowestPrice(同業=成本)。
  const adultPriceTwd = parseLionPrice(dep.StraightLowestPrice);
  if (adultPriceTwd <= 0) return null; // 沒有可用直客價 → 跳過,不低報

  const returnDate = new Date(
    year,
    month - 1,
    day + Math.max(0, tripDays - 1),
    20,
    0,
    0,
  );
  // Lion search 不回真正的餘位數,只有 Status。額滿 → full,其餘(available/hot)→ open。
  const status: "open" | "full" = dep.Status === "full" ? "full" : "open";

  return {
    departureDate,
    returnDate,
    adultPriceTwd,
    totalSlots: 20, // Lion search 不給座位數;給個非零預設,狀態靠 status 表達
    bookedSlots: 0,
    status,
    groupId: String(dep.GroupID ?? ""),
  };
}

/**
 * 把一批 Lion 鏡像 rawDepartureJson 建成班期(TWD),順帶回起價(TWD MIN)+ 未來班期數。
 * 對照 UV 的 `buildUvDepartures`。
 */
export function buildLionDepartures(
  rawDepartureJsons: Array<string | null>,
  tripDays: number,
  todayMs: number,
): { built: BuiltLionDeparture[]; priceRetailTwd: number; futureCount: number } {
  const built: BuiltLionDeparture[] = [];
  for (const raw of rawDepartureJsons) {
    const d = buildLionDepartureFromMirrorRow(raw, tripDays, todayMs);
    if (d) built.push(d);
  }
  const priceRetailTwd = built.reduce<number>(
    (min, d) =>
      d.adultPriceTwd > 0 && (min === 0 || d.adultPriceTwd < min)
        ? d.adultPriceTwd
        : min,
    0,
  );
  return { built, priceRetailTwd, futureCount: built.length };
}

/**
 * 換匯:TWD → USD。吃一個「已在 async adapter 層 fetch 好的匯率 number」
 * (twdToUsdRate = 1 TWD 值多少 USD,例 ~0.0308),把每筆班期價換成整數 USD,
 * 並轉成 supplier-無關的 `BuiltMirrorDeparture`(丟掉 groupId、TWD 標記)。
 * 純函式 → 直接測(14,950 TWD × 0.03077 ≈ 460 USD)。
 */
export function convertLionDeparturesToUsd(
  built: BuiltLionDeparture[],
  twdToUsdRate: number,
): BuiltMirrorDeparture[] {
  return built.map((d) => ({
    departureDate: d.departureDate,
    returnDate: d.returnDate,
    adultPrice: Math.round(d.adultPriceTwd * twdToUsdRate),
    totalSlots: d.totalSlots,
    bookedSlots: d.bookedSlots,
    status: d.status,
  }));
}

/**
 * 代表 GroupID(明細 enrich 用):最近的未來班期那顆。built 皆為未來(過去已跳過),
 * 取 departureDate 最小者 = 最近即將出發 = 當前代表團。**不是**鏡像最舊那顆
 * (lion-audit §2.3:最舊那顆可能已賣完/過期 → 拿到過期價或空)。無班期回 null。
 */
export function pickRepresentativeGroupId(
  built: BuiltLionDeparture[],
): string | null {
  let best: BuiltLionDeparture | null = null;
  for (const d of built) {
    if (!d.groupId) continue;
    if (!best || d.departureDate.getTime() < best.departureDate.getTime()) {
      best = d;
    }
  }
  return best?.groupId ?? null;
}
