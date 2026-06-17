/**
 * catalogRebuild/guard — 紅線回歸鎖:客人團物件絕不可帶供應商成本價。
 *
 * 背景:`supplierDepartures.agentPrice` = Lion IndustryLowestPrice = 同業價
 * = 我們的成本。現況架構已安全(tours 表無成本欄、客人端點不吐整列 departure),
 * 這支不是補漏,是把它「鎖住」:重抓 pipeline 把供應商資料 hydrate 進 tours、
 * 再 promote 上架時,出口各過一次 assertRetailOnly。任何 cost / agentPrice key
 * 或整列 supplierDepartures 不小心混進對客 payload 就 throw,寧可中斷重抓也不漏。
 * (David 漏價那課的延伸,[[feedback_no_cost_on_customer_docs]] / [[costLeakGate]])
 */

/**
 * 禁止出現在「對客 tour payload」的 key(成本 / 內部欄位)。
 * 比對時大小寫不敏感、子字串命中即擋(agentPriceMin、cost_price 都中)。
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  "agentprice", // 同業價 = 成本(supplierDepartures.agentPrice)
  "industrylowestprice", // Lion 原始欄名
  "costprice",
  "spareseats", // 原始餘位數(只給分級,不給確切數)
  "rawdeparturejson", // 整列 departure raw(含 agentPrice)
];

/** key 命中任一禁字(正規化:小寫 + 去底線/連字號)即視為禁欄。 */
function isForbiddenKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[_-]/g, "");
  return FORBIDDEN_KEY_SUBSTRINGS.some((bad) => norm.includes(bad));
}

export class CostLeakGuardError extends Error {
  constructor(public readonly path: string) {
    super(
      `[catalogRebuild/guard] 對客 tour payload 出現成本/內部欄位 "${path}" — 中斷,絕不上架(紅線)。`,
    );
    this.name = "CostLeakGuardError";
  }
}

/**
 * 遞迴掃描一個即將給客人看的 tour 物件,任何禁欄(成本/內部)key → throw。
 * 也擋字串值內嵌的 supplierDepartures raw（罕見,但 rawDepartureJson 被誤塞進
 * 某文字欄時抓得到）。在 hydrate→tours 與 promote 出口各呼叫一次。
 *
 * @param payload 對客 tour 物件(已 hydrate 的欄位 map)
 * @param maxDepth 防環,預設 6 層
 */
export function assertRetailOnly(payload: unknown, maxDepth = 6): void {
  walk(payload, "tour", maxDepth);
}

function walk(node: unknown, path: string, depth: number): void {
  if (depth < 0 || node == null) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, depth - 1));
    return;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (isForbiddenKey(key)) throw new CostLeakGuardError(`${path}.${key}`);
      walk(value, `${path}.${key}`, depth - 1);
    }
  }
}

/**
 * 便利版:不 throw,回報哪些路徑命中(給驗收 / 回報用)。空陣列 = 乾淨。
 */
export function findCostLeaks(payload: unknown, maxDepth = 6): string[] {
  const hits: string[] = [];
  const collect = (node: unknown, path: string, depth: number): void => {
    if (depth < 0 || node == null) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => collect(v, `${path}[${i}]`, depth - 1));
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (isForbiddenKey(key)) hits.push(`${path}.${key}`);
        collect(value, `${path}.${key}`, depth - 1);
      }
    }
  };
  collect(payload, "tour", maxDepth);
  return hits;
}
