# 批3 — 財務(記帳待分類 · 信託合規 · 催款唯讀)

> Stage 3 task 文件。設計依據:後台_06_財務.html(4 畫面)+ redesign-39.md。
> 拍板:**碰錢批 — 只重排版 reuse 既有 mutation,零新自動流程;版面 Jeff 親驗後才接新動作線。**
> 退款畫面(PAGE 4)已由批1 escalation 卡 + 批2 客戶 inbox 覆蓋,本批不重做。

## 實況調查(2026-06-11)

### 後端(碰錢 mutation 全齊,催款無後端)
- `plaid.transactionsList`:{dateFrom/dateTo/categoryAgent/includeExcluded/limit/offset} → {items, total};sign:amount>0=支出、<0=入帳
- `plaid.transactionUpdate`:{transactionId, category(canonical 10)/exclude/counterparty/purposeNote/receiptUrl} — **既有碰錢 mutation,待分類卡重用**
- `plaid.classifyBatch` / `bulkCategorize`:AI 批量分類(≥80 自動)/ 批量套用 — BankLedgerV2 已有入口
- `plaid.trustReconciliation`:per-trust-account {balance, outstandingTotal, outstandingRows, unmatchedCount, drift}
- `plaid.trustDeferredList`:{status: unmatched/pending/recognized/reversed/all} → 在途訂金明細
- `plaid.trustRecognizeNow`:手動觸發認列掃描(**全域**,掃出發日已到的 pending)— 🔒 gated
- `plaid.receiptUploadAndMatch`:收據 OCR(Claude Vision)+ 配對 — ReceiptCameraFAB 既有
- `bookings.adminList`:全訂單(customerName/totalPrice/depositAmount/remainingAmount/paymentStatus/depositDueDate/balanceDueDate)→ 應收唯讀列表資料線
- **催款草稿/送出:無後端** — 不虛構,唯讀列表 + gap 記錄

### 前端現況
- WorkspaceCompany ledger tab = BankLedgerV2(600 行 DataTable,功能完整)— 保留為「全部交易」power view
- FinanceReports(reports tab)= 5 報表 hub — **本批不動**
- mobile BankTriagePage(Tinder 卡)= 手機待分類;批3 做桌面卡片版(同 transactionUpdate)
- canonical 10 分類:income_booking · cogs_tour · cogs_other · expense_marketing · expense_software · expense_office · expense_travel · refund · transfer · other_review

### Mockup 對照與誠實 gap
- PAGE 1 待分類卡 ✅(AI 建議+信心、分類 select、公司/個人=exclude、確認)
  - 「全部接受 AI 建議(高把握)」:無一鍵 mutation(現行 = classifyBatch ≥80 自動 + bulkCategorize 選取套用)→ v1 不放此鈕,記 gap
  - 入帳判別卡(訂金→信託):信託訂金由 trustDeferralService 在信託帳戶自動遞延,不是人工選;入帳卡照實顯示 badge,不虛構判別流程
  - 收據 OCR 卡:桌面 v1 不做上傳(ReceiptCameraFAB 是手機既有),記 re-home 待辦
- PAGE 2 催款:唯讀「誰還沒付」列表(訂金未付/尾款未清 + 到期 T-n/逾期)✅ bookings.adminList;**草稿/語氣/送出 = 無後端,不做不放死按鈕**
- PAGE 3 信託 ✅(餘額卡+對帳 drift、認列卡=🔒 trustRecognizeNow 全域掃描、在途明細表)
- PAGE 4 退款:已有(批1/批2),不重做

## Milestones

### m1 — WorkspaceLedger shell + 待分類卡 ✅
- [x] WorkspaceCompany ledger tab:BankLedgerV2 → WorkspaceLedger(4 sub-views:待分類/信託/催款/全部交易)
- [x] 全部交易 = lazy BankLedgerV2 原樣(power view 不動)
- [x] 待分類卡:needsTriage(無人工分類 且(無 AI 分類 或 other_review))→ 卡片(入帳/支出 badge + raw desc mono + 商家 + 金額 + AI 建議含信心/理由)
- [x] 動作(reuse transactionUpdate):分類 select(canonical 10,預設 AI 建議)+ 確認;個人/排除
- [x] i18n · tsc 0 · Vitest(needsTriage/sign 判讀)

### m2 — 信託合規卡 ✅
- [x] 餘額卡:trustReconciliation(餘額 = N 筆未出發訂金、銀行對帳 drift 照實:0=對得上,≠0 黑框)
- [x] 認列卡:pending 且 expectedRecognitionDate 已到 → 「N 筆可認列 合計 $X」+ 🔒 黑鎖條 confirm → trustRecognizeNow(全域掃描,照實說明)
- [x] 在途訂金明細表(trustDeferredList pending/recognized,已認列淡化)
- [x] i18n · tsc 0 · Vitest(due 認列計算)

### m3 — 催款唯讀列表 ✅
- [x] 「誰還沒付」:bookings.adminList → 應收計算(unpaid→訂金、deposit→尾款)+ T-n/逾期 排序(逾期最前)
- [x] 誠實標示:此頁唯讀;催款草稿/送出未接(無後端,系統不自動發)
- [x] i18n · tsc 0 · Vitest(receivableOf/排序/T-n)

## DoD
- [x] tsc 0 · 全套 Vitest 綠(2187 passed,基線 2126 → +61)· i18n parity 7339 keys
- [x] 零新碰錢路徑:只 reuse transactionUpdate / trustRecognizeNow(皆既有,🔒 gated)
- [x] 300 行紅線(5 檔全 ≤300)· 手機規則內建
- [ ] Jeff visual approval(prod)— **碰錢批,版面親驗後才接新動作線(催款送出等)**

## Gaps(記錄,不虛構)
- 一鍵「全部接受 AI 建議(高把握)」mutation
- 催款草稿/語氣/管道/送出(整條無後端)
- 桌面收據上傳(ReceiptCameraFAB re-home)
- 批量催款
