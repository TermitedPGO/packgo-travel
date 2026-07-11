/**
 * PendingClaimsCard 的純邏輯層(F-workbench)—— 分頁攤平、批次選取加總、鍵盤
 * 焦點移動。零 React / DOM,node 環境可單測(repo vitest env=node,只收 *.test.ts)。
 *
 * 這些抽出來是為了讓「批次選取金額加總」「鍵盤焦點在頭尾的邊界」有紅綠例釘死,
 * 不必起 dev server / RTL(本機無 DATABASE_URL,起不了 headless 截圖)。
 */

/** 待認領最小結構(只取這層邏輯用到的欄位;寬鬆吃真 listPending row)。 */
export interface PendingRowLike {
  bankTransactionId: number;
  amount: number;
}

/** useInfiniteQuery 的多頁攤平成單一陣列(順序即翻頁順序)。 */
export function flattenPages<T>(pages: { items: T[] }[] | undefined | null): T[] {
  if (!pages) return [];
  return pages.flatMap((p) => p.items);
}

/** 勾選集裡的列金額加總(四捨五入到分,避免浮點雜訊)。 */
export function sumSelectedAmount(
  items: PendingRowLike[],
  selected: ReadonlySet<number>,
): number {
  let total = 0;
  for (const it of items) if (selected.has(it.bankTransactionId)) total += it.amount;
  return Math.round(total * 100) / 100;
}

/** 切換一個 id 的勾選狀態(回新 Set,不改原集)。 */
export function toggleSelected(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * 只保留「還在目前列表」的勾選 id —— 翻頁 / 認領後列表變動時,清掉已消失列的
 * 殘留勾選(否則批次會送出已不存在的列)。
 */
export function pruneSelected(
  selected: ReadonlySet<number>,
  items: PendingRowLike[],
): Set<number> {
  const live = new Set(items.map((it) => it.bankTransactionId));
  const next = new Set<number>();
  for (const id of selected) if (live.has(id)) next.add(id);
  return next;
}

/**
 * 鍵盤焦點移動:current 為目前焦點索引(-1 = 無焦點),delta ±1。空列表回 -1;
 * 無焦點時往下到第 0 列 / 往上到最後一列;有焦點時夾在 [0, len-1] 不繞回。
 */
export function moveFocus(current: number, delta: number, len: number): number {
  if (len <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : len - 1;
  return Math.min(len - 1, Math.max(0, current + delta));
}

/**
 * 均分成 ≤size 的塊(保序)。批次認領選取集可能超過 server 單請求上限
 * (BATCH_CLAIM_MAX=200),client 自動分塊循序送,使用者不用自己算 200
 * (指揮驗收回令 P2 #1)。size <= 0 視為防呆回單塊。
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  if (size <= 0) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
