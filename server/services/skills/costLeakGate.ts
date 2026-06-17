/**
 * cost_leak_check — 出客人 PDF 前的機械防線。
 *
 * Port 自 packgo-quote skill 的 `references/cost_leak_check.py`(2026-06-15
 * David 漏價那課變成 code:供應商 invoice 成本數字絕不可出現在客人文件上)。
 * 自動出報價放大了漏價風險 — 一次性腳本繞過 gate 就是怎麼漏的 — 所以這條
 * 在 server 端非有不可,每張自動產的客人 PDF 出檔前都得過。
 *
 * 兩個職責:
 *   1. extractCostCandidates(supplierText) — 從 Jeff 上傳的供應商檔抽出「像成本」
 *      的數字當比對清單。自動防線:就算 Jeff 沒手動點出哪些是成本,把供應商成本
 *      直接抄進客人 PDF 也會被擋下。
 *   2. costLeakCheck(customerText, costNumbers) — 客人文件文字 vs 成本清單,命中就擋。
 *   3. assertNoCostLeakInHtml(html, costNumbers) — 對「即將變成 PDF 的 HTML」跑 gate
 *      (先剝掉 <style>/標籤,只留客人看得到的文字,免得 CSS 的 300px 之類誤判)。
 *
 * 比對規則(對齊 .py):
 *   - 千分位逗號(半形 , + 全形 ,)正規化:3,498 == 3498 == 3，498。
 *   - 前後接數字不誤判(digit-boundary:3498 不會誤中 34980 或 13498)。
 *   - 只比「有鑑別度」的數字:auto-extract 取 4 位數以上(≥1000),
 *     check 接受 3 位數以上(小數字如折扣 300/260 易跟正文碰撞,floor 擋掉)。
 *   - auto-extract 額外排除 4 位數年份(1900–2099),否則「2026」這種日期會誤擋。
 */

/** auto-extract 的成本數字下限:4 位數(對齊 .py「有鑑別度的 4 位數」)。 */
const AUTO_MIN_DIGITS = 4;
/** costLeakCheck 比對下限:3 位數(2 位數保證跟正文碰撞,純噪音)。 */
const CHECK_MIN_DIGITS = 3;

/** 去千分位逗號(半形 + 全形),讓 3,498 等同 3498。 */
function stripThousands(s: string): string {
  return s.replace(/,/g, "").replace(/，/g, "");
}

/**
 * 把「純電話/編號格式標點(空白、( ) - +)隔開的相鄰數字組」併回一條連續 run:
 * (510) 634-2307 → 5106342307。只併「兩數字之間、中間全是這些格式標點」的情況;
 * 中文/字母隔開的不併(34980 與 134981 仍是兩條 run)。
 *
 * 為什麼:digit-boundary 只看緊鄰字元,3 位數成本(如 634)會被 footer 電話裡的
 * 片段「634-2307」誤中(前是空白、後是 -,兩邊都非數字 → 誤判命中)。把電話併成
 * 單一 run 後,634 變成 run 中段(前 0 後 2)→ 正確地不命中。不含小數點「.」,
 * 免得 1749.50 這種價格被併成 174950 而漏掉成本 1749。 */
function joinFormattedDigits(s: string): string {
  return s.replace(/(\d)[\s()+\-]+(?=\d)/g, "$1");
}

/** 純數字字串(去逗號、去非數字)。空字串代表沒有有效數字。 */
function digitsOnly(s: string | number): string {
  return String(s).replace(/[^\d]/g, "");
}

/** 4 位數且落在 1900–2099 → 視為年份,auto-extract 不當成本。 */
function looksLikeYear(digits: string): boolean {
  return digits.length === 4 && /^(19|20)\d{2}$/.test(digits);
}

/**
 * 從供應商檔文字抽出候選成本數字(digit-only、去重)。
 *
 * 取 4 位數以上、排除年份。這些丟給 costLeakCheck 當清單,擋住把供應商成本
 * 直接搬進客人 PDF 的情況。回傳順序穩定(首次出現序)。
 */
export function extractCostCandidates(supplierText: string): string[] {
  const normalized = stripThousands(supplierText ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of normalized.matchAll(/\d+/g)) {
    const d = m[0];
    if (d.length < AUTO_MIN_DIGITS) continue;
    if (looksLikeYear(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

export type CostLeakResult = {
  /** true = 乾淨可出檔;false = 命中成本數字,擋下。 */
  ok: boolean;
  /** 命中的成本數字(digit-only)。 */
  hits: string[];
};

/**
 * 客人文件文字 vs 成本清單。命中任一即 ok=false。
 *
 * costNumbers 可以是 string / number 混雜(Jeff 手動給的 + auto-extract 的)。
 * 各自正規化成 digit-only;少於 3 位數的略過(純噪音)。
 */
export function costLeakCheck(
  customerText: string,
  costNumbers: Array<string | number>,
): CostLeakResult {
  const haystack = joinFormattedDigits(stripThousands(customerText ?? ""));
  const hits = new Set<string>();

  for (const raw of costNumbers) {
    const d = digitsOnly(raw);
    if (d.length < CHECK_MIN_DIGITS) continue;
    // digit-boundary:前後都不能接數字,免得 3498 誤中 34980 / 13498。
    const re = new RegExp(`(?<!\\d)${d}(?!\\d)`);
    if (re.test(haystack)) hits.add(d);
  }

  return { ok: hits.size === 0, hits: [...hits] };
}

/**
 * 把 HTML 剝成客人看得到的純文字:拿掉 <style>/<script> 區塊與所有標籤,
 * 解開常見 entity。gate 只該看可見文字 — 否則 CSS 裡的 300px、#1A1A1A
 * 之類會把數字餵進比對造成誤判。
 */
export function stripHtmlToVisibleText(html: string): string {
  return (html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 出檔硬擋:對「即將變成客人 PDF 的 HTML」跑 cost gate。
 * 先剝成可見文字再比對。回傳 CostLeakResult — caller 看到 ok=false 就
 * 不准 renderHtmlToPdf,改成 escalate 給 Jeff 改價重出。
 */
export function assertNoCostLeakInHtml(
  html: string,
  costNumbers: Array<string | number>,
): CostLeakResult {
  return costLeakCheck(stripHtmlToVisibleText(html), costNumbers);
}
