/**
 * gmailAuthoritativeGate — Gmail intake 的 authoritative(history)模式下游餵送機械閘
 * (Codex 17 輪 §五.1)。照 trustTransferWriteGate 先例:現階段硬回 false。
 *
 * 現階段硬回 false 的意義:intakeMode=history 時,分類過的 customer/receipt 列雖已
 * 落帳(pending),但一律「不餵下游」——不跑 processOneEmail / 收據鏈、不上傳附件、
 * 不建 proposal、不寄 auto reply、不貼標。ledger 列留 pending 不損,靠上游一次性
 * 去重告警卡讓人看見被擋。
 *
 * 為什麼硬閘而不只改呼叫端:Codex 16/17 輪已證下游商業副作用本質 at-least-once
 * ——心跳續租失效的極端窗口(單封超租且 peer 重搶)同一封信可能兩次進
 * downstream.process。row claim + token-gated 寫回只保證 ledger 終態恰一次,不保證
 * 客人不收兩封回信、系統不產兩份附件/proposal。在「所有可重複副作用具穩定
 * idempotency key 或 durable outbox 的機械證據」齊備前,authoritative 餵送必須
 * fail-closed。閘放在下游餵送呼叫端(runIntakeStages),呼叫端傳什麼參數都無法翻它。
 *
 * 翻成 true 的前置(三者同時具備才可翻):
 *   (1) outbox / 冪等鍵的機械證據齊(文件以 messageId+attachment identity、proposal
 *       以 messageId+skill/version、回信以 inbound messageId+reply type 做唯一事件,
 *       只在 durable claim 成功後執行,retry 讀同一 outbox 狀態);
 *   (2) Codex 明確裁定該證據足夠;
 *   (3) Jeff 逐條核准。
 * 翻閘 = 獨立設計批(涉及客戶可見副作用),須走三層驗證(60 §3);單獨改本檔亦視為
 * 高風險變更。shadow 模式本就不餵下游,不受本閘影響。
 *
 * 放獨立模組(而非寫在 gmailHistorySync.ts 內)純為讓「既有 feed 寫入邏輯」的單元
 * 測試能以 vi.mock 覆寫本閘為 true、繼續守護那批 feed 碼(留待未來核准批復用);
 * 本檔無副作用、無 I/O。
 */
export function isGmailAuthoritativeApproved(): boolean {
  return false;
}
