# Trust-first 財報資訊架構與 Invoice/AP 契約(Phase 0,docs-only)2026-07-17

> 依 Codex 2026-07-17 12:22 財報區 Phase 0 固定施工單 §五-§七。base: origin/main@4e9199d0。
> 本檔是設計稿,不是已上線能力;§六 逐項標明現況風險與「本輪明確不修」。數字定義一律引 number-contract-trust-first-20260717.md(下稱數字契約)。

## 一、定位:以現有 FinanceCockpit 為骨架,不建第三套 dashboard

現況真實拓撲(P1-7.1 修正,worktree 親核):/ops/finance 掛 FinanceCockpit;/workspace 公司分頁的 reports tab **同樣掛 FinanceCockpit**(client/src/components/workspace/WorkspaceCompany.tsx:80,lazy import :15-16),兩入口同一元件;FinanceReports.tsx 自身是六個 tabs 的獨立元件,另有掛載路徑。

裁定方向:**FinanceCockpit 是 canonical 入口**,六區 IA 落在 /ops/finance 之下;FinanceReports 各 tab 逐步收斂為六區的深層頁(Phase 1+ 逐頁遷移,遷移前保留互鏈),不重畫第三套。/ops 首頁任何財務 KPI 佔位不得作真值入口(§六.1)。

## 二、canonical IA 六區(固定)

| 區 | 路由 | 內容 | 對應數字契約 |
|----|------|------|--------------|
| 1 總覽 | /ops/finance | 例外與風險 → 現金與義務 → 績效 → 工作 queue(順序固定) | 槽 4 coverage、槽 14 unmatched 在第一區;槽 1/2/3a/3b 第二區;槽 5/8a/9 第三區 |
| 2 待處理 | /ops/finance/work | 待認領、缺件、待核 invoice、認列待審卡 | 槽 14、槽 7 needs_review |
| 3 帳本與對帳 | /ops/finance/ledger | 銀行流水、link 明細、月結 BofA PDF 核對 | A 層 drill-down |
| 4 績效 | /ops/finance/performance | Gross Bookings/Company Compensation 並列、Take Rate、費用、趨勢 | 槽 5/8a/8b/9/10 |
| 5 Trust 與合規 | /ops/finance/trust | 信託現金、會計合約負債、required reserve、coverage、轉出核准(未來) | 槽 2/3a/3b/4 |
| 6 月結與匯出 | /ops/finance/close | **future/not-configured**(最小 month-close 契約見 §八A;CPA export 在 canonical fold 收斂前保持 not-configured,不得讓「CPA Pack」看起來已存在) | 槽 11、closed truth |

總覽第一屏永遠先答「有沒有事」(例外與風險),再答「有多少錢與欠誰」(現金與義務),再答「賺不賺」(績效),最後是「今天要做什麼」(工作 queue)。

## 三、卡片狀態模型(P1-2 修正:四條正交軸,取代原十態互斥單值)

原 12:22 施工單的十詞互斥模型過粗(Codex 13:04 §四確認為原設計需更正)。正式契約=數字契約 §二的四軸:

- `dataStatus`:loading / ready / error / disconnected / not-configured
- `completeness`:complete / partial / empty-filter / true-zero / not-computable / unsupported
- `freshness`:fresh / stale
- `periodStatus`:open / closed

UI primary state 解析優先序:error > disconnected > not-configured > loading 任一命中即主態(附 reasonCode);否則主態由 completeness 呈現,freshness/periodStatus 以 badge 疊加。`closed + stale`、`partial + stale` 等合法組合各自顯示,不硬塞單值(overdue 是 AP due 子域的 badge,不屬卡片四軸)。

- **error ≠ true-zero ≠ empty-filter**:query 失敗顯示「無法核實」+ reasonCode + 重試;真值為零 = true-zero;篩選後無資料 = empty-filter。視覺可區分。
- 逐卡標 source/as-of(lastSyncedAt)/coverage,禁止頁級單一時間戳(§六.4)。
- 預設值禁令:任何 count/amount 不得以 `?? 0`/`|| 0` 把 error 折成 0(§六.5)。

## 四、Invoice/AP 契約(P1-5 修正:三條正交軸,取代原線性鏈)

原 `received→…→paid` 線性鏈出自 12:22 施工單,實質複核確認過粗(invoice 可提前付款、可 overdue 時部分付款、可 disputed 但已有 allocation)——三軸正交:

- **document/approval 軸**:received / needs_review / approved / disputed / void
- **due 軸**:not_due / due_today / overdue(由 dueDate + LA 日界計算,派生非儲存)
- **payment 軸**:unpaid / partially_paid / paid / overpaid(**只由 allocation/reversal 推導**)

規則:
- **收到 invoice ≠ 已批准 AP**。received/needs_review 的抽取值屬 D 層(AI OCR 建議);Jeff 核准「invoice 真實、金額正確、訂單歸屬、義務成立」四件後才 approved(B 層)。會計/稅務認列時間標待 CPA(問題包 B)。
- 每張 invoice 至少保存:supplier、supplier invoice number(同 supplier 唯一,防重)、booking/tour/order 綁定、issue date、due date、service date、USD total(currency 逐筆存,非 USD → unsupported)、原始 PDF evidence pointer、approval(誰/何時/理由,append-only)、payment allocations(逐筆金額+對應銀行交易 identity)。
- **最低 guard 集**(P1-5 固定):同 supplier+invoice number 唯一;allocation 與 invoice currency 一致;allocation 金額必須正數;Σ allocations 不得無聲超過 total(超過=overpaid 顯性態+例外卡);寫入帶 idempotency key 防併發重複;每筆 allocation 綁定銀行交易 identity;修改已付 invoice 只准 adjustment/reversal 列,禁止改原列。
- **Trust-eligible 不是整張 invoice 的布林**(P1-5 固定):每筆 withdrawal/payment allocation 各自帶法定提領類型、適用金額與證據(部分付款可能不同資格),對齊 §五 出帳五要素。
- disputed 凍結付款建議且 **disputed obligation 不消失**:另列 disputed exposure,總覽與 undisputed due 並列;void 留列不刪。payment 軸全由 canonical 三式推導,禁手動布林:`rawRemaining = total − net allocations(allocations − reversals)`、`remainingDue = max(0, rawRemaining)`、`overpaidAmount = max(0, −rawRemaining)`。

## 五、Trust 出帳設計(規格,施工受閘)

- 每筆 Trust 出帳綁定五要素:customer/order、evidence(supplier invoice / refund 單據 / compensation 證據)、法定提領類型(§17550.15(c) enum,律師確認值,無預設)、金額、Jeff approval。結構=proposal §四 轉出核准物件。
- **一般 operating expense 不得冒充 supplier travel payment 從 Trust 支出**:出帳閘檢查 evidence 類型與 (c) 款一致性,不一致即拒。
- 四軸各自獨立欄位:銀行資金位置(bankTransactions)/法律可提領(核准物件 (c) 款+證據)/管理認列(recognizedAt,逐筆核准)/稅務認列(CPA 口徑,close 流)。任何一軸不得由另一軸推導(60-evidence-and-ops §7)。
- 現行全部 fail-closed gate(trustTransferWriteGate 硬 false、認列零寫入者、端點 403)**本輪與 Phase 1 前置期間保持凍結**;本設計不含任何解凍條款,解凍另案走矩陣+三層驗證。

## 五A、經濟事件同一性圖與防雙計契約(P1-6;13:42 P1-3 補完整 edge/cardinality/unique key)

一筆錢的生命週期跨多個系統面,防雙計的根本是**同一經濟事件只入帳一次**,不是分類檢查。

### 5A.1 節點(穩定 source id)

processor sale/charge(processor 原生 charge id)、processor refund(refund id)、processor dispute(dispute id)、processor payout settlement(settlement id)、Plaid bank transaction(plaidTransactionId,現有 uniq_plaid_txn)、order(customOrders/bookings id)、invoice(supplier id + supplier invoice number)、allocation(link id)。

### 5A.2 關係契約(edge / cardinality / unique key,可落 DB)

| edge | cardinality | unique key(重放冪等) | 備註 |
|------|-------------|----------------------|------|
| refund → original charge | N:1(一 charge 可多次退,單筆 refund 只指一 charge) | refund id 唯一;(refund id → charge id)不可變 | Σ refunds ≤ charge 未退餘額(guard) |
| dispute → charge | N:1 | dispute id 唯一 | chargeback 為獨立 operation 類型 |
| payout settlement → charges/refunds/disputes/fees | 1:N membership | (settlement id, line item id)唯一 | settlement 金額 = Σ line items(對帳到 1 cent) |
| bank transaction → payout settlement | N:1(一 settlement 通常一筆落地;拆帳多筆時各自綁同一 settlement) | (plaidTransactionId → settlement id)唯一 | 綁定後該交易恆 transfer-neutral |
| order → charge | 1:N(一單可多次收款) | charge id 唯一歸一 order(經 allocation) | |
| invoice → order | N:1 | (supplier id, supplier invoice number)唯一 | 防重放/重掃 |
| allocation → invoice + bank transaction | N:1 對 invoice;N:1 對 bank txn | (invoice id, bank txn id, seq)唯一 | 正數;Σ per invoice 依 rawRemaining 數學;Σ per bank txn ≤ abs(amount) |

### 5A.3 canonical rail 與關帳閘

- **落地現金的 canonical rail = bankTransactions**(權威帳,blueprint 既裁);processor 事件的 canonical 來源 = processor 原生 ledger(導入前 RC-PROC);**accountingEntries 為投影/輔助帳,不是第二條 rail**。bank payout 是 settlement/transfer,不是第二筆 sale,綁定 settlement 後恆 transfer-neutral,永不進 income。
- 每筆 bank transaction 的 resolution status ∈ `matched / partially-matched / unresolved / transfer-neutral / excluded`(與 match method auto/manual 分軸);unmatched 金額 = abs(amount) − Σ(valid allocations)。
- **關帳閘機械拒絕**:上表任一 unique constraint 未建、或期間內存在 unresolved 交易未豁免,close 動作直接拒絕(不是 watchdog 提醒);watchdog 只是 detection,不冒充 prevention。DB constraint 建成前,accountingEntries 與 bankTransactions 禁止合加進 closed truth。

## 六、現況資料真值風險(唯讀核實 @4e9199d0,八項全數成立;**全部 explicitly not fixed in Phase 0**)

八路獨立唯讀核實(workflow wf_7d4c8248-310,journal 留檔),關鍵錨點另經指揮抽核原文(AdminHome.tsx:34、bankPLService.ts:226-232、yearEndExportService.ts:212)。每項:現況證據/風險/future gate。

### 6.1 /ops 首頁 mock 財務 KPI 無標示
- 證據:`MOCK_FINANCE = { revenue: 12450, pending: 8200, trust: 45000, operating: 12300 }`(AdminHome.tsx:34,直接 render 於 FinanceCard:77-99);假逾期尾款「Lisa Wu $1,820」(:31);假同步綠燈 `syncOk: true`(:38);i18n 標籤與真值頁同語氣(zh-TW.ts:3583-3585),唯一 mock 標記在原始碼註解使用者不可見;/ops 與 /ops/finance 同導航並列無視覺區分(AdminShell.tsx:15-18)。
- 風險:Jeff 看到假營收/假 Trust $45,000/假綠燈當真值做判斷。
- future gate:CI grep gate —— 非 /preview/ 路徑的 `MOCK_` 金額元件即 fail;FinanceCard 接真 tRPC 或撤卡/掛「示意資料」badge。

### 6.2 Trust lookup 失敗時 Bank P&L 退回 gross(fail-open)
- 證據:bankPLService.ts:226-232 catch 後照樣 foldBankPLRows 出數,註解自承 `returning gross`(月度趨勢 :548-554 同款);trustDeferralService 三支查詢 `if (!db) return 0/zeros`(:1177/:1308/:1412)靜默成功,連錯誤漏斗都不觸發;輸出無任何 degraded 欄位,fail-open 的 0 與「本期無信託活動」不可分辨。
- 風險:遞延查詢掛掉時,仍在信託的客戶訂金整額計為收入,靜默高估收入與稅基,下游稅 CSV/財報全繼承。
- future gate:兩處 catch 改 fail-closed(rethrow 或 degraded:true 且消費端拒出數);`if (!db) return` 改 throw;Vitest 釘死「trust lookup throw → generateBankPL rejects」。

### 6.3 currency 盲加卻標 USD
- 證據:schema 有 isoCurrencyCode(schema.ts:3165)但 generateBankPL select 不取(bankPLService.ts:173-187),fold 原幣直加(:293);ingest 對 null 幣別 fallback 成 "USD"(plaidSyncService.ts:98);financeKpi 硬編碼 `currency: "USD"`(plaidRouter.ts:1498);schedule_c_summary 混幣加總(yearEndExportService.ts:203-218)。
- 風險:任何非 USD 交易以原幣面額 1:1 進 USD 報表(TWD 30,000 變 $30,000),全程無警示;現僅因帳戶恰為 USD 未觸發。
- future gate:fold 取 isoCurrencyCode,非 USD 列進 unsupported 桶不入總額;Vitest「TWD 列不得進 income/expense 總額」;ingest fallback 改保留 null 標 review。即數字契約 §二 currency 條的 Phase 1 落地。

### 6.4 頁級 as-of 掩蓋過期來源
- 證據:useCockpitData.ts:49-54 asOf = 四條 query 客戶端 fetch 時間的 max,非資料層同步時間;Plaid 停同步三天,cockpit 每 120 秒重讀過期 DB 值,asOf 永遠顯示「剛剛」,lastSyncError 不上畫面。
- 風險:三天前的現金/Trust 部位被當即時真相。
- future gate:逐卡標 source/as-of/coverage(取 linkedBankAccounts.lastSyncedAt(schema.ts:3144)/lastSyncError),stale 態接卡片狀態機(§三)。

### 6.5 error 缺省為 0 的假 all-clear
- 證據:WorkColumn.tsx:28 `allClear = pendingCount === 0 && recogCount === 0 && !isLoading` 不查 isError,query 失敗時 `?? 0`(useCockpitData.ts:62-63)把 error 折成 0,亮綠勾「今天沒有等你的事」(zh-TW.ts:8827-8828)並隱藏待認領/待認列卡;server 端 `if (!db) return []`(plaidRouter.ts:1856 等)與 emptyReport(bankPLService.ts:157-158)以 200 回全零。反證:TruthRow 四格與 PLCard 等有正確 error 分支,tile 層防禦是好的。
- 風險:讀取失敗被顯示成「財務無事」,漏認領漏認列;P&L $0 月與 DB 掛掉不可分辨。
- future gate:allClear 判定必含 isError;finance 讀取 procedure 禁 `if (!db) return 空` 靜默成功,一律 throw;grep 白名單 CI gate。

### 6.6 雙計邊界零 DB 約束
- 證據:agentCategory/jeffOverrideCategory 是自由 varchar 無 CHECK(schema.ts:3181/3185);accountingEntries 與 bankTransactions 零關聯約束(:2148);防雙計 100% 在 code 層(preClassify 2c + NEUTRAL_CATEGORIES fold 排除);**yearEndExportService.ts:212 排除清單漏 stripe_payout/square_payout,與 bankPLService.NEUTRAL_CATEGORIES 已漂移**;Stripe descriptor 從未被真撥款資料驗證(prod 至今零 Stripe 撥款,latent)。
- 風險:分類一漏,同筆錢在 checkout 側帳與銀行側帳重複認列進稅表;排除清單漂移已是現行分歧。
- future gate(P1-6 修正):真正的閘是 §五A 經濟事件同一性契約 —— 每筆 processor sale/payout/refund 有穩定 source id 與唯一 link,DB 層唯一性/link constraint(走 tracked migration,非 runtime DDL)建成前 accountingEntries 與 bankTransactions 禁止合加進 closed truth。輔助措施:三個合併點 import 同一 NEUTRAL_CATEGORIES 常數+同源 Vitest;每日 watchdog 不變量「income_booking 且 isStripePayoutInflow 命中 = 0 筆」**僅為 detection,不冒充 prevention**。

### 6.7 supplier AP ledger 不存在
- 證據:全 schema 唯一 invoices 表是客戶發票(schema.ts:2169);suppliers 表純產品目錄零財務欄(:3389);供應商付款唯一系統性紀錄=錢流出後 AI 事後分類 cogs_tour(accountingAgent.ts:32);cockpit 現金 tile 標「可動用」= Plaid availableBalance 原值,未扣已承諾未付供應商款(cockpitMath.ts:42,zh-TW.ts:8762);真實付款時程活在 case file 文件靠人記;1099 名單直接依賴事後分類(plaidRouter.ts:2236)。
- 風險:已承諾未付的錢被當可花;漏付晚付;1099/Schedule C 跟著錯。**AP ledger 建成前不得宣稱「可安全花費」或可靠 cash forecast**(現查無 forecast 功能,風險集中在「可動用」標籤)。
- future gate:§四 invoice/AP 契約落地前,CI 文案 gate:現金 tile 必含「未扣供應商應付」警語,全 repo 禁「可安全花費」字樣。

### 6.8 三個 CPA 出口 canonical fold 未收斂
- 證據:畫面 P&L 走 canonical foldBankPLRows(F3 塊D 已收斂畫面側);遞延口徑 trend/稅CSV/財報共用 monthlyDeferralAdjustments(F2 已收斂遞延半邊);**未收斂兩處**:①稅 CSV 依賴的 generateBankMonthlyTrend 是同檔第二支手寫摺疊(bankPLService.ts:510-534),月分桶未用 monthKeyOfDate,mysql2 DATE 字串態下 1/1 交易日界位移靜默丟列(driver-dependent,未在 prod 實證);②年終 ZIP 全路獨立(yearEndExportService 未 import canonical fold),零遞延調整、排除清單漂移(6.6)、userId 範圍與 canonical 相反(support@ 觸發即短缺,同型 bug 有 F3 前例)、README:353「Phase 4 尚未上線」已過時會誤導 CPA。
- 風險:同一年度三份產物三個 Line 1/淨利,報稅直接引用即申報錯誤;**收斂前不得稱 CPA-ready**(數字契約槽 11)。
- future gate:CI 三出口對帳單測(同 fixture 斷言 generateBankPL/taxCsv/ZIP summary 逐項相等,含 1/1 與 12/31 邊界列);ZIP 改走共用 fold;README 真值修正。

## 七、權限與 AI 邊界

- 人類角色只有 `Owner: Jeff`。不建多人簽核 UI、不建假 RBAC。單人不取消稽核:high-risk 動作一律 re-auth + 理由 + 證據 + append-only audit。
- high-risk 動作清單(至少):Trust withdrawal、refund、manual journal adjustment、write-off、close/reopen、修改已付款 invoice、改已認列收入。
- AI/system 是**不可批准角色**:只可 OCR 抽取、配對候選、分類 suggestion、缺件提醒、forecast(全部 D 層)。不得 approve invoice、不得把分類寫進 closed truth、不得移錢/付款/退款/認列/關帳/重開。
- 所有 money mutation 規格 append-only;修正以 reversal/adjustment 列表達,禁止 update/delete 改寫歷史。

## 八、誠實邊界(施工單 §八原樣落地)

1. Jeff 的 Trust-first 描述是營運意圖,不是對 BofA 帳戶法律資格、IOLTA/Living Trust/CST 三說、§17550.16 豁免或可提領條件的法律裁定;待律師/BofA 問題包。
2. Gross/Net 同時顯示是管理報表需求;正式 revenue 口徑待 principal/agent 產品矩陣與 CPA。
3. Phase 1 只支援 USD;非 USD fail-closed 列 unsupported。
4. 本檔全部內容是設計稿;§六 所列風險在 Phase 0 一律不修,Phase 1 施工單逐項對應。

## 八A、最小 month-close 契約(P2-1,future/not-configured)

- 期間狀態:`open → closing → closed → reopened`(reopened 後可再 closing→closed,歷史 close 不消失)。
- close 動作:產生 close snapshot(期間全指標值+組成 drill-down 凍結)、通過 coverage gate(unmatched/uncategorized 低於門檻或逐項豁免附理由)、Jeff re-auth + 理由 + 證據,append-only。
- reopen:**append-only event,不准覆寫原 close**;reopen 後的更正以 adjustment/reversal 列進下一次 close。
- CPA export:canonical fold 收斂(§六.8)前保持 not-configured。

## 九、停止線

本輪只取得 Phase 0 docs 複核資格。零 schema、零 production code、零 migration、零正式帳務寫入、零 Trust transfer/recognition、零 commit/push/deploy。固定清單外需求記 backlog。
