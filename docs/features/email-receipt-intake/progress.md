# email-receipt-intake — 實作進度

> Stage 4 (coding)。design.md 已拍板。動手前已用 AskUserQuestion 釐清 3 個 data-model 決策(見下)。

## Jeff 拍板的決策 (2026-06-15)

1. 入帳目標 = 確認時二選一(最不會重複):
   - 沒走 Plaid(現金/海外匯款/還沒對上)→ 寫一筆 `accountingEntries` expense。
   - 有刷卡會被 Plaid 抓到 → 只把收據歸檔對帳(`receipt_only`),不另記分錄。
2. Trust/Operating → 在 `pendingExpenses` + `accountingEntries` 加 `account` enum,確認時選。
3. 「算哪一團」→ 連 `bookingId`(bookings 客人訂單),用 `globalSearch.search` 當選團 picker。

## 現有資料流(摸清後的事實)

- 兩本帳:手動 `accountingEntries`(次要)+ Plaid `bankTransactions`(財報主源)。
- Trust/Operating 原本只活在 Plaid 側(linkedBankAccounts.isTrustAccount + trustDeferredIncome)。
- Gmail pipeline:`gmailPollWorker` → `runGmailPipeline`(每 10 分,PACKGO_AI_PROCESSED label 去重)。
- 客服分類在 `inquiryAgent`。receipt 是廠商信,不走客服流(避免誤 draft 回客人)。
- 既有 pre-LLM noise filter 會丟掉 marriott/hilton/noreply → receipt 偵測必須跑在 noise filter 之前。
- `listUnreadMessages` query 帶 `-from:noreply` → phase 1 鎖供應商發票(真人 vendor 地址),雜支(noreply 收據)留 phase 2。

## 任務清單

- [x] 1. schema:`pendingExpenses` 表 + `accountingEntries.account` enum
- [x] 2. migration 0096 (idempotent, CREATE IF NOT EXISTS + INFORMATION_SCHEMA guard) + journal
- [x] 3. db helpers:pendingExpenses CRUD + `confirmPendingExpenseToLedger`(transaction) (server/db/accounting.ts)
- [x] 4. gmail.ts:`fetchRawAttachments` 取原始 bytes(30MB cap)
- [x] 5. receiptExtractor.ts:detectReceipt(rules gate) + extractReceipt(LLM vision) + .test.ts(29 tests)
- [x] 6. gmailPipeline.ts:receipt 偵測分支(noise filter 之前)+ processReceiptEmail
- [x] 7. router:accounting.pendingExpenses (list/count/attachmentUrl/confirm/reject)
- [x] 8. client:AccountingTab「待確認支出」tab(badge)+ confirm dialog(入帳/歸檔二選一)
- [x] 9. i18n:zh-TW + en(全 key 雙語到位)
- [x] 10. tsc 0 錯 ✓ + vitest 綠 ✓(29 extractor + 7 gmail + 4 agent router)

## 驗證結果 (2026-06-15)

- `tsc --noEmit`(NODE_OPTIONS=6144)→ 0 errors
- vitest:receiptExtractor 29/29、gmail 7/7、agent router 4/4 綠
- i18n key 交叉比對:component 用到的 pending.* 全在 zh-TW + en
- 待 Jeff `pnpm ship`(§4.3,需 `.deploy-approve` token;我不部署)

## Phase 1 範圍備註 / phase 2 待放寬

- Gmail poll query 帶 `-from:noreply` → noreply 收據(Stripe/航空/飯店自動信)現在「不會進來」。
  phase 1 鎖真人 vendor 地址(供應商發票最準)。放寬雜支時要改 listUnreadMessages 的 query。
- detectReceipt 目前要求「PDF/圖附件 + 收據關鍵字」。純文字收據(無附件)phase 2 再做。
- 通知:目前靠 bookkeeping tab badge(countPendingExpenses)surface,沒發 office inbox 卡片。

## 鐵則(碰錢)

- AI 只接收/讀出/排好,不自己入帳。金額/算哪團/Trust-Operating 全 Jeff 確認時決定。
- 讀不清楚 → needsReview=1「請人工看」,留白,不准猜。
- 絕不碰付款,只收單。
- gmailMessageId unique 去重,重複 poll 不重建。
