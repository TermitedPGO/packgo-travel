/**
 * catalogRebuild/heroDedupe — 跨國同圖上架守門(2026-07-10 外部設計審查 Block B)。
 *
 * 背景:審查在 live 站上抓到兩個不同目的地的行程(id2 / id7)用了同一張 hero 圖。
 * stockPhotoResolver 的批次內去重(見 stockPhotoResolver.ts + index.ts
 * attachStockHeroImages)已讓「同一次 rebuild 批次」內不同團儘量拿到不同 url,
 * 但仍可能:
 *   - 兩團查詢字串剛好命中同一批候選、但去重 Set 沒攔到(理論上不會,防禦性補洞)
 *   - 舊批殘留的 heroImage(這次沒重新解析、fields 沒帶 heroImage 的團不受影響,
 *     因為本函式只比對「這次 promotable.fields 裡有值」的 heroImage)
 * 上架前這道純函式再守一次:同一個 hero url 若被兩個「不同 destinationCountry」
 * 的團共用,後出現者(陣列順序較後)的 heroImage / imageUrl / heroImageCredit 一律
 * 置 null(寧無圖不跨國錯配,可信度優先於「有圖比較好看」)。
 *
 * 同一國共用同一 url 不強制 null — 那屬於 resolver 層批次去重的責任範圍(同國多團
 * 撞圖時,resolveStockPhoto 應該已經換了候選;就算沒換到,同國同圖不算「跨國錯配」,
 * 不在這支的守門範圍內)。
 *
 * 純函式:只讀寫傳入的 promotable.fields,不碰 DB / 外部 API,直接用合成資料單元測。
 * 呼叫時機:rebuildCatalog 的 attachStockHeroImages 之後、promoteBatch 的 transaction
 * 之前(見 index.ts)。
 */

import type { PromotableTour } from "./promote";

/** 把 destinationCountry 正規化成比對用的 key(trim;空/缺 → null,自成一類)。 */
function countryKey(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

/**
 * 掃過 promotable(依陣列順序,先出現者視為「原圖擁有者」):凡「不同
 * destinationCountry」共用同一個 hero url 者,把後出現者的 heroImage / imageUrl /
 * heroImageCredit 一律置 null。就地改 fields,不回傳新陣列(與 attachStockHeroImages
 * 的就地寫入慣例一致)。
 */
export function dedupeHeroImagesAcrossCountries(promotable: PromotableTour[]): void {
  // url → 第一個使用它的團的 destinationCountry key
  const firstCountryByUrl = new Map<string, string | null>();

  for (const p of promotable) {
    const url = p.fields.heroImage;
    if (typeof url !== "string" || !url) continue; // 這團這次沒配到 hero,不比對

    const country = countryKey(p.fields.destinationCountry);
    const firstCountry = firstCountryByUrl.get(url);

    if (firstCountry === undefined) {
      // 這張 url 第一次出現,記下它的國家當基準。
      firstCountryByUrl.set(url, country);
      continue;
    }

    if (firstCountry !== country) {
      // 同一張圖、不同國家 → 後出現者讓圖(寧無圖不跨國錯配)。
      p.fields.heroImage = null;
      p.fields.imageUrl = null;
      p.fields.heroImageCredit = null;
    }
    // firstCountry === country(同國同圖):交給 resolver 層去重負責,這裡不強制清空。
  }
}
