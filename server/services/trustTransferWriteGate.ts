/**
 * trustTransferWriteGate — B1.1(Codex 第 6.5 輪 P0.1)信託轉出/回填的機械閘。
 *
 * 現階段硬回 false:在 (1) CPA 認列矩陣定稿、(2) 律師提領矩陣定稿、(3) Jeff 逐條
 * 裁定「可翻」三者同時具備之前,任何 Trust→Operating 轉帳回填
 * (transferredAt / transferBankTransactionId 寫入)與催轉通知一律停用。
 *
 * 為什麼硬閘而不只改呼叫端:加州 BPC §17550.15(c) 的可提領條件裡沒有「會計已認列
 * 即可轉」這一條;而歷史 recognizedAt 可能來自錯誤的出發日規則(short-lead 用訂金日),
 * 不得憑它驅動 Jeff 動真錢。閘放在服務內部,呼叫端傳什麼參數都無法翻它。
 *
 * 翻成 true = 高風險批:必須補齊逐筆核准端點/稽核,並走三層驗證(60 §3)。單獨改本檔
 * 亦視為高風險變更。
 *
 * 放獨立模組(而非寫在 trustTransferDetection.ts 內)純為讓「既有寫入邏輯」的單元測試
 * 能以 vi.mock 覆寫本閘為 true、繼續守護那批寫入碼(留待未來批復用);本檔無副作用。
 */
export function isTrustTransferWriteApproved(): boolean {
  return false;
}
