# B1 信託認列 fail-closed（proposal）

> 來源:PLAN-2026-07-13 第一優先 B1(Codex 第6輪裁定)。高風險類別:錢+帳。
> 批次負責:Fable 指揮;執行 opus;2026-07-12 開工。

## 要解什麼

trustRecognitionQueue 每日 06:00 UTC 跑,把到期(expectedRecognitionDate <= today)
且已配對 booking 的信託訂金自動寫 recognizedAt = 自動認列為收入。
PLAID_TRUST_DEFERRAL_ENABLED=ON,這條路徑是活的。

這違反兩條已裁定原則:
1. 認列是 Jeff 的動錢權,不是排程的。
2. CPA 認列矩陣+律師提領矩陣未核准前,任何認列時點推導(含出發日)都不可依賴
   (60-evidence-and-ops.md §7:四件不同的事)。

三筆問題款目前 unmatched 不會被動,但下一筆對上的客款就會被自動認列。

## 為什麼不是關 flag

關 PLAID_TRUST_DEFERRAL_ENABLED 會讓新收款退回「立即認列」,更糟。
正確方向:保持 deferred(收款照建遞延列),移除自動認列寫入,認列動作凍結
到 Jeff 逐筆核准(那個核准鍵等 CPA 矩陣後另開批次,本批不建)。

## 驗收長怎樣(完成線,Codex 裁定原文)

1. 測試釘死:worker 跑完,到期+已配對列的 recognizedAt 仍 NULL,只產待審卡。
2. 無論旗標怎麼組合(PLAID/STRIPE on/off),都不存在自動寫 recognizedAt 的路徑。
3. prod 部署後觀察一輪(次日 cron)零自動認列 — 此項部署後才能收,標 pending。

## 不做(本批明確排除)

- 逐筆核准端點/UI(等 CPA 認列矩陣,另開批次)
- 提領矩陣、轉出綁定(另案)
- reverseDeferral、linkInflowToBooking、runTrustTransferDetection 行為(不動)
- schema 變更(不加表;待審卡走既有 agentMessages)
