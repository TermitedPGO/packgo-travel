# F1 對帳引擎 — 執行進度

> 對應派工單 `docs/features/finance-dept/dispatch-f1.md`。逐塊回寫,不倒填。

## 塊A:對帳資料模型 + 引擎 + 待認領流程

**狀態:✅ 完成。實作 → 3 路 fresh 對抗審查(全數 FAIL,共 3 P0/8 P1/5 P2/2 note)
→ 逐條修復 → 重驗 tsc/vitest/i18n 綠 → commit `4d0a1b4` → push 成功
(`294e9e4..4d0a1b4 main -> main`,pre-push 全套 315 files/4653 tests 綠)。**

**⚠ 營運事故(修復後才發現,已解決)**:對抗審查 iron_rules_and_ux 路抓到
main 曾經處於壞掉狀態 —— 另一並行 session(Wave1 收尾補丁,commit 0cbd000/
294e9e4)修改 `server/_core/index.ts` 時,用廣義 `git add`/`git commit -a`
把本批尚未 commit 的 F1 backfill 路由 hunk 一併掃進他們的 commit,但本批對應
的 `server/services/bankTransactionLinkBackfill.ts` 當時仍只在本 session
working tree(未 commit)——導致 origin/main 一度處於「index.ts 引用不存在
模組」的壞掉狀態(乾淨 checkout 跑 tsc 會炸)。過程中途working tree 也曾被
另一方 `git stash -u -m "f1-blockA-wip-20260708"` 暫存又還原(標籤清楚,無
資料遺失,`git stash pop` 復原全部檔案)。本批 commit 後 origin/main 已恢復
自洽(index.ts 引用的模組現在真的存在了)。教訓:多 session 共用同一份
working tree 編輯同一檔案時,commit 前必須逐檔核對 diff 範圍,不能用
`git commit -a`/廣義 `git add <整份共用檔案>`。

### 交付清單(尚未 commit,先列出檔案)

新增:
- `drizzle/0113_bank_transaction_links.sql` + `.down.sql`(唯一授權 migration)
- `drizzle/schema.ts` — `bankTransactionLinks` table export
- `server/services/bankTransactionLinkEngine.ts` — 4 條自動規則 + 分配驗證 + 主入口 `processInboundTransaction`
- `server/services/bankTransactionLinkEngine.test.ts`(17 tests)
- `server/services/bankTransactionLinkBackfill.ts` — 存量 dry_run/confirm
- `server/services/bankTransactionLinkBackfill.test.ts`(4 tests)
- `server/agents/autonomous/bankTransactionLinkAlerts.ts` — 待認領卡噪音閘(門檻/日上限/去重)
- `server/agents/autonomous/bankTransactionLinkAlerts.test.ts`(8 tests)
- `server/agents/autonomous/accountingKnowledge.test.ts`(8 tests,只測本批新增部分)
- `server/routers/bankTransactionLinks.ts` — `listPending` + `claim`
- `server/routers/bankTransactionLinks.test.ts`(7 tests)
- `client/src/components/admin/PendingClaimsTab.tsx` — 認領 UI

修改:
- `drizzle/meta/_journal.json`(新增 idx 113)
- `server/agents/autonomous/accountingKnowledge.ts` — export `norm`;新增 `isStripePayoutInflow`/`STRIPE_PAYOUT_DESCRIPTORS`(與塊C 共用來源)
- `server/services/customOrderWatchdog.ts` — export `resolveUnpaidLeg`(邏輯不變,供本批重用)
- `server/routers.ts` — 註冊 `bankTransactionLinksRouter`
- `server/_core/index.ts` — 新增 `POST /api/admin/backfill-bank-transaction-links`(LOCAL_SCRIPT_TOKEN)
- `server/plaidSyncWorker.ts` — post-sync 掛 `scanAndAlertPendingClaims`
- `client/src/components/admin-v2/FinanceReports.tsx` — 第 6 分頁「待認領」
- `client/src/i18n/zh-TW.ts` / `en.ts` — `pendingClaimsTab` key block

### 自測證據(修復後、commit 前重跑)

- `NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit`:0 錯
- `pnpm vitest run`(全套):315 passed | 11 skipped (326 files),4653 passed | 90 skipped (4743 tests)
- `pnpm i18n:parity`:7682 keys,0 missing/extra,0 hardcoded patterns
- 本批測試 7 個檔案 171 個測試全綠(含既有 customOrderWatchdog.test.ts 111
  例 + migrationBreakpoint.test.ts 3 例回歸驗證):
  bankTransactionLinkEngine.test.ts(27)、bankTransactionLinkBackfill.test.ts(4)、
  bankTransactionLinkAlerts.test.ts(8)、accountingKnowledge.test.ts(10)、
  bankTransactionLinks.test.ts(8)

### 對抗審查(3 路 fresh,sonnet)— 逐條修復記錄

三路(money_safety / iron_rules_and_ux / code_correctness)全數 verdict=FAIL,
合計 3 P0 + 8 P1 + 5 P2 + 2 note。逐條處理:

**P0(已修)**
1. `scanUnlinkedInflows` 先 LIMIT 再差集 → 已處理的舊資料把新資料擠出候選
   視窗,新錢可能永遠掃不到。改成:先撈全部候選 → 差集 → 新到舊排序才取
   limit。
2. main 已被另一 session 的 commit 意外引用不存在模組(見上方營運事故段)。
   本批 commit 後解決。
3.(與 P0-1 同一根因,money_safety 與 code_correctness 兩路獨立抓到)。

**P1(已修)**
1. `createBankTransactionLink` 的 SUM+新增<=|amount| 檢查與 INSERT 之間無鎖
   (TOCTOU 競態)→ 加 Redis per-bankTransactionId 鎖(fail-closed,重試 5 次
   仍搶不到就拒收;Redis 本身連不上才 fail-open,同 `withCustomerIntakeLock`
   慣例)+ DB transaction 包住讀-檢查-寫三步。
2. `order_ref` 規則文字對上訂單編號就 100 分直接 link,不比對金額 → 加金額
   核對(`resolveUnpaidLeg` 算該單還欠哪一段,金額吻合才 auto;對不上降級
   為候選卡)。
3. 自動 link 到 custom_order 後從不回寫 `depositPaidAt`/`balancePaidAt` →
   同一張單會被不同流水重複誤判唯一候選、重複自動認領。新增
   `syncCustomOrderPaymentAfterLink`,在同一個 transaction 內、分配金額吻合
   該段目標金額時才寫回(+ 狀態機只進不退推進)。
4. `trust_sync` 沒檢查 `reversedAt` → 已撤銷的 Trust 配對仍會被拿去建立正式
   link。加 `reversedAt IS NULL` 過濾;決策邏輯抽成純函式 `decideTrustSyncLink`
   可單測(原本零測試覆蓋的缺口,對抗審查明確點名)。
5. 「有任何 link 即 already_handled」→ 部分認領後剩餘金額從所有清單永久消失
   (違反監工裁示 #1「一筆流水可拆多單」)。改成 SUM 判斷:完全分配才
   already_handled,部分分配回 pending_claim(不重跑 auto 規則搶餘額,交
   Jeff 補完)。`UnlinkedInflow` 新增 `remainingAmount` 欄位,`listPending`/
   卡片/回填報表金額顯示全部改用剩餘餘額,不是原始交易總額。
6. `exact_amount` 先按時間窗篩選訂單池再判斷唯一/模糊 → 窗外但仍未收款、
   金額吻合的訂單被篩選藏起來,真正的模糊情境被誤判成「唯一候選」。改成
   `findExactAmountCandidates` 對全部未收款訂單(不篩窗)判斷唯一/模糊,新增
   `isCandidateInWindow` 獨立檢查「唯一候選是否可以 auto」,唯一但窗外 → 不
   auto,仍可能因為就是唯一候選而被排除出 pending_claim 候選清單外顯示(此
   時視窗只影響 auto 資格,顯示候選清單不受影響)。
7. trust_sync 零測試覆蓋(見 P1-4,已修)。
8.(TOCTOU 與 P1-1 同根因,兩路獨立抓到)。

**P2(已修 4,未修 1 已記已知限制)**
1. `isStripePayoutInflow` 用裸子字串 includes 比對 "stripe" → "Stripeman"/
   "stripes diner" 之類會誤判。改用既有 `hasWord` 單字邊界比對(並 export
   `hasWord` 供跨檔重用)。
2. 部分認領餘額消失(見 P1-5,已修)。
3. order_ref/exact_amount 沒跟 `KNOWN_INFLOW_REFUND_VENDORS`(供應商退款白
   名單)交叉比對,供應商退款可能被誤配成客人訂單付款。新增
   `isKnownRefundVendorInflow`,在 order_ref/exact_amount 之前攔截,命中直接
   出待認領卡(無候選),不進客人訂單比對池。
4. 金額低於門檻但恰好命中 exact_amount 模糊候選 → 卡在 pending_claim,跳過
   small_inflow 自動歸類。把門檻檢查移到 exact_amount 判斷之前。
5. **未修,已記已知限制**:`approvalTasks.payload` 是 TEXT(64KB 上限),存量
   回填數千筆 pendingItems 完整塞入卡片 payload 有機會超限。已加輕量防護
   (卡片 payload 的 pendingItems 截斷前 50 筆),完整清單留在 HTTP 回應本身
   (dry_run/confirm 的回傳值,無此限制)。

**note(1 個未修,已記已知限制;1 個已用既有測試涵蓋)**
- `processInboundTransaction` 本體(含 Plaid 符號守門的實際執行入口)是
  DB-touching,本地無 DATABASE_URL 無法用單元測試直接覆蓋這個真正在 prod
  執行的守門點——純函式層(`findExactAmountCandidates`/`isCandidateInWindow`/
  `decideTrustSyncLink`/`isStripePayoutInflow`/`isKnownRefundVendorInflow`)
  已有完整紅綠例,但 orchestration 本身的方向判斷(`amount>=0` skip)仍只
  靠 code review 保證,建議下一批(F2)比照 `bankTransactionLinks.test.ts`
  的 `vi.mock("../db", ...)` 手法補上 2-3 個整合測試。

### 設計決策 / 偏離申報(待 T6 正式收斂)

1. **時間窗錨點欄位**:dispatch 未點名 exact_amount 規則 ±7 天時間窗要比對訂單的
   哪個日期欄位。採用 `customOrders.collectionSentAt`(缺則 `createdAt`)。
2. **FinanceReports「待認領」呈現形式**:dispatch 寫「加區塊」,語意可能是新分頁
   或既有分頁內的子區塊。採用「新增第 6 個分頁」(PendingClaimsTab),理由:
   跟現有 5 個分頁的架構一致,且監工裁示 #2「不做新頁」指的是不開新 admin
   頁面路由,分頁切換仍在同一個 FinanceReports 元件內,不違反這條裁示。
3. **stripe_payout 判斷邏輯歸屬**:塊A 只新增判斷原語(`isStripePayoutInflow`)
   供本批引擎使用;實際接進 `preClassify`(修正 bankTransactions.agentCategory
   誤判)是塊C 的範圍,兩塊共用同一份 `STRIPE_PAYOUT_DESCRIPTORS`。
4. **審計軌跡範圍**:`bankTransactionLinks.claim`(人工認領,adminProcedure,
   有 ctx.user)呼叫 `audit()`,符合派工單明文要求。存量回填端點(LOCAL_SCRIPT_TOKEN,
   無 ctx.user)比照既有 `caseDocumentImport.ts` 等腳本端點慣例,用結構化
   `logger.info` 記錄而非 `audit()`(`audit()` 設計上綁定真人 admin session)。
5. **已知限制**:approvalTasks 沒有 update API,聚合卡「當天已有 pending 聚合卡
   就不重複建」,不會動態更新卡片內數字——若第一張聚合卡建立後又新增溢出項目,
   當天不會再多開一張。
6. **併發鎖選型**:對抗審查抓到的 TOCTOU 競態,選用 Redis per-bankTransactionId
   鎖(仿既有 `withCustomerIntakeLock`)而非 DB 悲觀鎖(SELECT...FOR UPDATE)—
   —理由:Redis 鎖已是本庫既有慣例(有現成先例可對照),DB transaction 內
   仍保留讀-檢查-寫的原子性當第二層防線。刻意改成 fail-closed(重試 5 次
   拿不到鎖就丟錯)而非 `withCustomerIntakeLock` 的 fail-open-then-proceed,
   理由:這裡是錢的分配上限檢查,寧可讓一次認領/自動規則呼叫失敗重試,也
   不要在真的撞上併發時放行超額寫入。
7. **legKind='total' 的認列欄位對映**:`resolveUnpaidLeg` 回傳 `legKind='total'`
   時(訂單沒有分期,一次全額付清),沒有直接對應的單一 DB 欄位——選擇同時
   寫 `depositPaidAt` 與 `balancePaidAt`(兩者一起標,代表「一次結清」),
   `balancePaidAmount` 記全額,狀態機比照 `balance` 付款(終態 paid)。這條
   dispatch 沒有點名,是修復對抗審查 P1(自動 link 沒回寫付款狀態)時新增的
   判斷,執行者決定,標記供 Fable 驗收時留意。
8. **exact_amount 唯一/模糊判斷範圍變更**:原始設計(時間窗預篩選後才判斷唯一/
   模糊)被對抗審查判定有安全漏洞(窗外但仍未收款的同額訂單會被藏起來,讓
   模糊情境誤判成唯一)。修復後改成「公司層級全部未收款訂單判斷唯一/模糊,
   時間窗只決定唯一候選是否可以 auto」——這比 dispatch 原文字面(「時間窗
   ±7 天 + 唯一候選 → auto」)更保守:現在「唯一但窗外」不會 auto,但因為
   findExactAmountCandidates 回傳的候選清單就是那唯一一筆,還是會被視為
   pending_claim 的候選卡內容顯示給 Jeff,不影響「有候選可看」的體驗,只是
   不會被系統自動下決定。

### 對抗審查

- 3 路 fresh(sonnet):money_safety / iron_rules_and_ux / code_correctness
- 結果:全數 FAIL(3 P0 + 8 P1 + 5 P2 + 2 note),逐條修復記錄見上方對抗審查段落
- Commit `4d0a1b4`(實作+修復)+ `08c5959`(進度回寫),已 push

## 塊B:Stripe 收款統一進認列規則引擎(flag 化,預設 off)

**狀態:✅ 完成。實作 → 3 路 fresh 對抗審查(含 1 路 opus 專審錢路徑,全數 FAIL,
共 3 P1 + 6 P2 + 1 note,3 路獨立命中同一個核心 P1)→ 逐條修復 → 重驗 tsc/vitest
綠 → commit(見下方)。**

### 交付清單

新增:
- `server/_core/stripeWebhook.test.ts` — flag off byte-identical / flag on 改走遞延,含 getDepartureById 呼叫足跡斷言,4 例
- `server/_core/featureFlags.test.ts` — 新 flag + 3 個收口函式(含非數字字串案例補齊),14 例

修改:
- `server/_core/featureFlags.ts` — 新增 `stripeTrustDeferralEnabled()`;收口
  `trustAutomatchAmountWindowUsd()`/`trustAutomatchDateWindowDays()`/
  `trustEarlyRecognitionWindowDays()`(原本是 trustDeferralService.ts 裡的
  3 個裸 process.env 讀取,SECURITY_AUDIT_2026_05_14 P3-3 點名的拼字風險)
- `server/services/trustDeferralService.ts` —
  - 3 個裸 process.env 讀取改叫 featureFlags
  - 抽出純函式 `computeExpectedRecognitionDate`(原本在 processTrustInflow
    與 linkInflowToBooking 各寫一份的重複邏輯),兩個既有呼叫點改用同一支
  - 新增 `deferStripeBookingIncome(opts, tx)` — Stripe-direct 遞延寫入,
    bookingId 直接來自呼叫端(不跑 findBookingMatch 猜測配對)
  - 新增 `findStripeDeferredByPaymentId(paymentId)` — 退款邊界用
- `server/_core/stripeWebhook.ts` — `handleCheckoutSessionCompleted` 的
  tour booking 分支:flag on 時走 `deferStripeBookingIncome`(同一個 tx),
  flag off 行為 byte-identical(措辭上原本的 createAccountingEntry 呼叫完全
  不變,只是包了一層 if/else,測試釘死參數一致);`handleChargeRefunded`
  post-commit 新增退款邊界檢查(找到未認列的 stripe-direct 遞延列就標
  reversed,已認列的不動)
- `server/_core/stripeWebhook.refunds.test.ts` — 補 mock
  `../services/trustDeferralService`(既有測試原本沒 mock 這個新依賴,會
  導致例外洩漏、notifyAgentMessage 呼叫次數對不上,已修);新增 3 例退款
  邊界測試(找到未認列遞延列→reverse、已認列→不動、查無→不動)
- `server/services/trustDeferralService.test.ts` — `computeExpectedRecognitionDate`
  4 例(早鳥窗口內/外 + 邊界值)

### 自測證據

- `NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit`:0 錯
- `pnpm vitest run`(全套):317 passed | 11 skipped (328 files),4675 passed | 90 skipped (4765 tests)
- 本批新增/修改測試:stripeWebhook.test.ts(3)、featureFlags.test.ts(12)、
  trustDeferralService.test.ts 新增 4 例(既有 20 例回歸綠)、
  stripeWebhook.refunds.test.ts 新增 3 例(既有 5 例回歸綠,含修 mock 缺口)

### Schema 限制下的實作決策(dispatch 未點名,執行者決定,見下方偏離申報)

本批(F1 全部四塊)只有塊A 的 `bankTransactionLinks` 一張 migration 被授權,
塊B 不能新增/修改 schema。但 dispatch 要求「寫 trustDeferredIncome
(bookingId 直接有,matchMethod='stripe_direct')」,而現有 schema:
- `trustDeferredIncome.bankTransactionId` 是 `NOT NULL` + `UNIQUE`,設計上
  綁定一筆 Plaid `bankTransactions.id`——Stripe checkout 付款當下還沒有對應
  的銀行交易。
- `trustDeferredIncome.matchMethod` 是 `enum('auto'|'manual'|'unmatched')`,
  沒有 dispatch 原文提到的 `'stripe_direct'` 這個值。

解法(已在程式碼內詳細註解,T6 會再標記供 Fable 驗收留意):
1. 用 `-payments.id`(負值)當 `bankTransactionId` 的 sentinel 值——Plaid 的
   `bankTransactions.id` 是 autoincrement 正整數,負值保證零碰撞,且天然
   可追溯回是哪筆 Stripe payment,UNIQUE 約束天然提供 webhook 重放的冪等
   保護。
2. `matchMethod` 用既有的 `'auto'`(語意最接近:系統自動決定,非 Jeff 手動
   link),來源記在 `notes` 欄位(`"stripe_direct — ..."`)供追溯。
3. `linkedAccountId` 填 `0`(佔位)。

**⚠ 重大已知限制(標記供 Fable/Jeff 決定 flag 能不能打開前必須解決,對抗審查
opus 路獨立確認、並要求把敘述層級從「報表呈現缺口」升級為「稅表收入短報
風險」)**:
`linkedAccountId=0` 這個 sentinel 值會讓 `totalDeferredForUser()`(
`bankPLService` 用來從 gross income 扣掉未認列金額的函式,也是年終
Schedule-C 稅表匯出的 source of truth)的 `leftJoin(linkedBankAccounts, ...)`
找不到對應帳戶,`eq(linkedBankAccounts.isActive,1)` 這個過濾條件會把
stripe-direct 列整批排除在外。更根本的問題:flag 開啟時 checkout 當下不再
呼叫 `createAccountingEntry`,而對應的 Stripe 撥款落地(Plaid 同步)又被
F1 塊A 的 `stripe_payout` 規則正確排除在 income 之外(避免雙計)——這筆錢
從頭到尾不會出現在 `bankPLService` 的 gross income 計算裡,`recognizedAt`
被設定時也沒有任何機制把它「補記」成 P&L 收入,**年終報稅匯出
(taxCsvService/financialReportService 走同一條路徑)也會系統性漏掉這筆
應稅收入,且沒有任何錯誤提示讓 Jeff 發現**。即:遞延/認列的**狀態機**本身
正確(這是本批對抗審查的審查範圍,已修好,見下方),但**P&L/報稅報表呈現**
目前接不上——這是 F1 範圍外的架構缺口,dispatch 本批 5 點要求也沒有點名
這塊,判斷應留給 F2,**必須在 flag 真的打開之前解決**(flag 預設 off,目前
零 prod 影響)。

**⚠ 併發已知限制(同根因,對抗審查 opus 路追加發現)**:同一個
`linkedAccountId=0` sentinel 也讓 admin 唯一能查看/操作待處理 Trust 遞延列
的介面(`plaidRouter.trustDeferredList`/`trustReconciliation`,前端
TrustComplianceV2.tsx/LedgerTrust.tsx)整批看不到 Stripe-direct 列——
dispatch 塊B 第4點「Stripe 來源遞延列在既有 admin override(
linkInflowToBooking/reverseDeferral)同樣可操作」只在**函式層**成立(這兩支
函式本身只用 deferredId 操作,不看 linkedAccountId),在**操作層**不成立
(Jeff 從現有 UI 完全看不到、點不到任何 Stripe-direct 列,拿不到
deferredId)。與上面的 P&L 缺口同根因,建議 F2 一併解決(例如給
Stripe-direct 列一個真實/虛擬 linkedAccountId,或讓相關查詢改用
UNION/OR 條件涵蓋 linkedAccountId=0)。

### 對抗審查結果與修復(3 路 fresh,含 1 路 opus 專審錢路徑)

3 路(money_path_opus / byte_identical_and_tests / iron_rules_and_flag_safety)
全數 verdict=FAIL,合計 3 P1(其中核心那條 3 路獨立命中同一個問題,是很強的
訊號)+ 6 P2 + 1 note。逐條處理:

**P1(已修,含核心問題)**
1. **雙 flag 不同步(3 路獨立命中)**:`recognizeReadyDepartures`/
   `trustRecognitionWorker`/`trustRecognizeNow`/`totalDeferredForUser` 四處
   認列/查詢路徑,原本只看 `isTrustDeferralEnabled()`(PLAID flag),塊B 新加
   的 `STRIPE_TRUST_DEFERRAL_ENABLED` 完全不影響它們。若 Jeff/CPA 只翻
   STRIPE flag(PLAID flag 維持預設 off——這正是最可能發生的組合,`current-state.md`
   自己都寫 prod 上 PLAID flag 實際值「未知」),Stripe-direct 遞延列會被
   正常建立,但**永遠不會被認列**,也永遠不會出現在報表——連 Jeff 手動按
   「立即重跑」都會被誤導性的 `PLAID_TRUST_DEFERRAL_ENABLED is not set`
   訊息擋下。這推翻了 progress.md 原本「遞延/認列狀態機本身正確」的自我
   驗證陳述。修法:新增 `isAnyTrustDeferralEnabled()`(PLAID flag OR STRIPE
   flag),四個「認列/查詢」路徑改用它;`processTrustInflow`(建立路徑,
   Plaid 專用)與 `decideDeferralSync`(手動覆蓋同步,Plaid 專用)維持只看
   PLAID flag 不變——兩條建立路徑本來就該分開判斷,只有認列/查詢該合併。
2. **退款 post-commit 失敗 → 幽靈認列風險**:`reverseDeferral` 是
   post-commit(tx 外)執行,失敗會被 try/catch 吞掉(webhook 仍回 200,
   Stripe 不重試),而 `recognizeReadyDepartures` 原本完全不檢查 booking
   是否已 cancelled——兩者疊加,一筆已退款但沖銷失敗殘留的遞延列,到出發日
   還是會被正常認列成收入,且會被每日轉帳提醒金額誤算進去。修法:
   `recognizeReadyDepartures` 加一道防線——批次撈出「即將被認列」的
   bookingId 集合,查 `bookings.bookingStatus`,cancelled 的一律跳過不認列
   (新增 `skippedCancelledBooking` 計數器)。這是通用防線,Plaid 路徑同樣
   受益。
3.(與 #1 同一根因,`byte_identical_and_tests` 路獨立命中並補充了完整的
   失敗鏈路追蹤,強化了 #1 修復的信心。)

**P2(已修 5,未修 1 已記已知限制)**
1. Trust-direct admin UI 不可達(見上方「併發已知限制」)——未在本批修,
   已明確併入 P&L 缺口的已知限制段落,標記 F2 一併處理。
2. 部分退款(`amount_refunded < amount`)不會 touch 遞延列,出發日仍全額
   認列,實際只該認淨額——dispatch 塊B 退款邊界明文只要求處理全額退款,
   部分退款屬「更細的退款會計」範圍已由 dispatch 自己排除在 F1 外。已強化
   既有的 partial-refund log 訊息,明講這個關聯供未來排查用,不算完整修復。
3. `featureFlags.ts` 三個收口函式的 fallback 語意從 `||default`(對
   `env='0'` 誤判成 falsy 退回預設,是個既存 bug)改成
   `Number.isFinite&&v>=0`(正確處理 `env='0'`)——已在函式文件註解裡誠實
   標註這是「順手修 bug」不是「純收口」,不隱藏這個行為差異。目前 PLAID
   flag 預設 off,零 prod 影響。
4. `deferStripeBookingIncome` 的 `depositDate` 原本用 `new Date().toISOString()`
   取 UTC 曆日,美西深夜結帳時可能誤判成 UTC 的隔天,影響年度交界附近的
   早鳥認列窗口判斷——改用 `Intl.DateTimeFormat` 校正到 America/Los_Angeles
   曆日再取值。
5. 測試斷言補強:`stripeWebhook.test.ts` 補 `getDepartureById` 未被呼叫的
   斷言(釘死 flag off 時不多查);`featureFlags.test.ts` 補
   `trustAutomatchDateWindowDays`/`trustEarlyRecognitionWindowDays` 的非數字
   字串案例(原本只測負值,跟 `trustAutomatchAmountWindowUsd` 不對稱)。
6. `computeExpectedRecognitionDate` 抽出時拿掉了原本短前置期分支的
   `console.log` 副作用——純計算結果不變,但可觀測性行為有變,已在上方
   diff 記錄中如實說明(非隱藏)。

**note(已驗證,敘述已升級)**
- P&L gross-income 缺口:opus 獨立驗證 CONFIRMED,且指出這不只是「報表呈現
  接不上」,是 flag 打開後 Stripe tour 收入會**系統性從應稅收入消失(稅表
  短報)**——已在上方「重大已知限制」段落用這個更嚴重的敘述層級重寫。

### 已知限制(次要,未變動)

- `trustRecognitionWorker` 的每日「該轉帳 $X」提醒是聚合所有當日認列金額
  一起算,不分 Plaid 來源或 Stripe-direct 來源——若未來 flag 打開,這個
  提醒金額可能包含不需要人工做銀行轉帳的 Stripe-direct 認列金額(Stripe
  撥款是它自己的清算路徑,不是 Trust→Operating 銀行內部轉帳)。dispatch
  本批退款邊界外的細節都明講留 F2,這條屬同一類,未修。
- `linkInflowToBooking`/`reverseDeferral`(既有 admin override)對
  stripe-direct 列「同樣可操作」是靠程式碼讀過確認(純用
  `trustDeferredIncome.id`/`recognizedAt`/`reversedAt` 操作,不看資料
  來源),不是靠新的 DB 整合測試證明——這兩支本來就是 DB-touching、本地無
  DATABASE_URL、既有慣例本來就不測(見塊A 已知限制
  的同一套理由)。

## 塊C:雙計防護(Stripe payout 識別)

**狀態:實作完成,tsc/vitest/i18n 已綠,尚未送對抗審查/commit。**

零 migration(dispatch 硬性規定全批 migration 只有塊A 一張)——本塊只動
TS 列舉/陣列/i18n key,不動 schema。`agentCategory`/`jeffOverrideCategory`
在資料庫是 varchar,不是真 SQL enum,所以新增分類值不需要 migration。

### 交付清單

1. `server/agents/autonomous/accountingKnowledge.ts` —preClassify() 新增
   規則「2c」:進帳(amount<0)且 `isStripePayoutInflow(haystack)` 命中 →
   `category:"stripe_payout"`,`confidence:95`,`source:"stripe_payout"`
   (`PreClassifySource` 型別新增這個值)。`isStripePayoutInflow`/
   `STRIPE_PAYOUT_DESCRIPTORS` 本身是塊A 已建好的共用來源,本塊只是把它
   接進 preClassify 的規則鏈——之前只有函式存在,沒有規則分支呼叫它。
2. `server/agents/autonomous/accountingAgent.ts` — `ACCOUNTING_CATEGORIES`
   新增第 11 個值 `"stripe_payout"`;`CATEGORY_DESCRIPTIONS` 新增對應說明,
   並修正 `income_booking` 舊描述裡誤把「Stripe 撥款進帳」列為收入範例的
   錯誤措辭(這正是雙計 bug 的根因之一——preClassify 之前完全沒有攔截
   規則,LLM 分類全靠這段誤導性描述去猜)。
3. `server/services/bankPLService.ts` — `SCHEDULE_C_MAP` 新增
   `stripe_payout: "(excluded — Stripe payout landing, already counted at
   checkout)"`;`NEUTRAL_CATEGORIES` 加入 `stripe_payout`(排除稅表計算,
   跟 `transfer`/`other_review` 同待遇)。
4. `client/src/lib/accountingCategories.ts` — `AccountingCategoryKey` 型別
   +`ACCOUNTING_CATEGORY_CONFIG` 新增 `{key:"stripe_payout", group:"other",
   i18nKey:"catStripePayout"}`。
5. `client/src/i18n/zh-TW.ts` / `en.ts` — `admin.bankLedgerTab` 新增
   `catStripePayout` key(zh:「Stripe 撥款(轉撥)」/ en:「Stripe payout
   (transfer)」)。
6. `server/accountingCategories.test.ts`(**既有測試,本批修改**)—
   「M1 keystone guard」的 `exactly 10 categories` 斷言改成 11(taxonomy
   從 10 類擴充到 11 類是本塊的明確目的,不是誤破既有測試)。
7. `server/services/stripePayoutDeclassifyBackfill.ts`(新檔)— 存量回填
   探針:`runStripePayoutProbeDryRun`/`runStripePayoutProbeConfirm` +
   純函式 `buildStripePayoutDeclassifyReport`。掃描條件:入帳
   (`amount<0`)、未被排除(`excludeFromAccounting=0`)、effective category
   (`jeffOverrideCategory` 優先,否則 `agentCategory`)= `income_booking`、
   且 `isStripePayoutInflow` 命中。dry_run 只回報 `totalMisclassified`/
   `totalAmount`/樣本清單(截斷至 200 筆,`totalMisclassified` 數字不受
   截斷影響);confirm 把符合列的 `jeffOverrideCategory` 改成
   `"stripe_payout"`,`jeffOverrideReason` 寫入固定留痕字串,`agentCategory`
   維持原值不覆寫(比照既有 `bulkCategorize` 慣例,見下方偏離申報)。
8. `server/_core/index.ts` — 新路由
   `POST /api/admin/backfill-stripe-payout-declassify`,
   `{mode:"dry_run"|"confirm", limit?}`,LOCAL_SCRIPT_TOKEN 驗證,同塊A
   backfill 端點慣例(回應本身就是報表)。
9. 測試:
   - `server/agents/autonomous/accountingKnowledge.test.ts` 新增
     `describe("preClassify — stripe_payout 分支")`4 個案例:Stripe 撥款
     進帳→`stripe_payout`(綠)、真客人 Zelle 進帳不受影響(紅)、出帳側含
     stripe(手續費)不套用本規則、與 memo 提示分支不衝突。
   - `server/services/stripePayoutDeclassifyBackfill.test.ts`(新檔)3 個
     案例測 `buildStripePayoutDeclassifyReport`(空輸入歸零、金額加總、
     200 筆截斷）。`scanMisclassified`/dry_run/confirm 本體是 DB-touching,
     本地無 DATABASE_URL 測不到,誠實列為已知限制(同塊A/塊B 慣例）。

### 自測證據(commit 前重跑)

```
tsc --noEmit: 0 錯
pnpm vitest run: Test Files  318 passed | 11 skipped (329)
                 Tests  4688 passed | 90 skipped (4778)
pnpm i18n:parity: en 7683 keys │ missing 0 │ extra 0
                  ✓ 100% parity, 0 hardcoded patterns. Ship it.
```

### 偏離申報(dispatch 未點名細節,執行者決定)

1. **file:line 錨點漂移**:dispatch 寫「preClassify(accountingKnowledge.ts:308)」,
   但本 session 開工時該行實際落在 `isStripePayoutInflow`/`hasWord`
   輔助函式區(302-317),`preClassify` 函式本體開頭在 338 行——塊A 已先
   在檔案中插入大段共用規則(含這兩支輔助函式跟一大段解釋註解),把行號
   往後推了。以實際程式碼為準,插入點選在 preClassify 內部「規則 2b」
   (已知旅遊 vendor 退款進帳)之後、「規則 3」(Wells Fargo 卡出帳)之前,
   延續塊A 已經寫好、標號「2c」的註解區塊(該註解本身已預告塊C 會在這裡接
   規則)。
2. **信心值 95,非既有 vendor 規則的 90**:Stripe payout 判斷只靠單一
   token(`hasWord` 對 "stripe" 的完整單字比對,已通過對抗審查驗證不誤傷
   "stripeman"/"mystripe" 等子字串),比對明確度不輸「業主本人」規則
   (也是 95),高於「已知供應商」類規則(90,可能有多 vendor 別名歧義)。
   選 95 是執行者判斷,dispatch 未指定數字。
3. **confirm 模式覆寫對象是 `jeffOverrideCategory`,不動 `agentCategory`**:
   比照 `plaidRouter.ts` 既有 `bulkCategorize` mutation 的寫法(只寫
   override 欄位 + reason,不動 AI 原始判斷欄位,讓 `agentCategory` 保留
   歷史紀錄)。**風險揭露**:如果某筆歷史 Stripe payout 是 Jeff 手動
   override 成 `income_booking`(不是 AI 誤判,是 Jeff 自己標的),confirm
   仍會覆寫它——因為 dispatch 定義的「疑似雙計」範圍是 effective category
   (override 優先),沒有排除「人工已確認」的情況。這條 confirm 端點只能
   靠 Jeff 自己手動呼叫(LOCAL_SCRIPT_TOKEN,等同 Jeff 本人執行),且
   dry_run 報表會先給 Jeff 看過數字才決定要不要 confirm,不是 AI 自動跑;
   但如果 Jeff 之前是「明知是 Stripe 撥款、但故意標成 income_booking」的
   特殊案例(目前找不到會這樣做的理由,但不能完全排除),這支會誤改。
   T6 會把這條列為驗收前 Jeff 需要知道的風險點。
4. **未呼叫 `_core/auditLog.ts` 的 `audit()`**:讀過該函式後確認它硬性
   要求 `ctx.user`(admin 已登入 context),沒有就只 `log.warn` 然後靜默
   return——LOCAL_SCRIPT_TOKEN 端點沒有這個 context,呼叫了等於沒留痕
   但看起來像有。改用 `jeffOverrideReason` 欄位本身當留痕(比照
   `bulkCategorize` 既有慣例)+ 結構化 `logger.info`(比照塊A backfill 的
   既有慣例),鐵律五(留痕)用這個方式滿足,不是進 `adminAuditLog` 表。
5. **未建 approval card**:block A 存量回填 confirm 完會建一張聚合卡通知
   Jeff;塊C 的 dispatch 原文只要求「dry_run 先回報...confirm 才改標」,
   沒有提到要出卡通知——本批解讀為塊C 是資料修正動作(改分類標籤),不是
   需要 Jeff 逐筆認領的新事項,所以沒建卡。如果 Fable 認為 confirm 動作
   也該留一張通知卡,是可以補的小改動,執行者先不假設。

### 對抗審查結果與修復(3 路 fresh:correctness / double_count_guard / test_and_scope)

三路平行審查 + 一路 synthesis 去重排序(dispatch 塊C 未要求 opus,只有塊B
點名)。結論:核心規則(preClassify 的 stripe_payout 分支、NEUTRAL_CATEGORIES
排除)本身寫得對,但「雙計防護的退路」沒補完——以下逐條列出發現與修復。

**P0(commit 前必修,已修復)**

1. **`buildSystem()` 的 LLM system prompt 仍教「Stripe 撥款 = income_booking」**
   —— 2/3 路獨立發現(correctness 標 P1、double_count_guard 標 P0)。
   `accountingAgent.ts:252`/`:261` 是自由文字,`preClassify` 的確定性規則沒
   命中時會退回 LLM,LLM 讀的正是這段矛盾指令——遇到不含 "stripe" 字樣的
   簡化 descriptor(規則庫的已知限制,見下方 P1 #2)會原地重現雙計。**修復**:
   改寫兩處文字(不再暗示「收入幾乎全是 Stripe 撥款」,明確教「Plaid 把
   Stripe payout 分到 TRANSFER_IN,正確分類是 stripe_payout,沒被規則庫攔下
   就回 other_review 不要猜 income_booking」);「10 個類別」/「9 個類別」的
   寫死數字全部改成 `${ACCOUNTING_CATEGORIES.length}` 動態插值(TOOL 描述+
   兩處 buildSystem 文字);新增 `accountingAgent.test.ts` 的
   `describe("buildSystem — prompt hygiene guard")` 3 個測試,鎖死
   「Stripe payout」與「income_booking」不會同時出現在教 LLM 的語境裡,
   仿 repo 既有 `aafb7ef` commit 的 prompt-hygiene 守門測試先例。

**P1(commit 前必修,已修復)**

2. **`scanMisclassified` 的 haystack 缺 `paymentMeta`,跟 live preClassify 不
   同源**—— 3/3 路一致發現(correctness 標 P2、double_count_guard Q5 答覆
   時發現、test_and_scope 標 P1 並用具體情境驗證)。live path
   (`accountingAgentService.ts:108-114`)的 `counterparty` 來自
   `paymentMeta.payee/payer`,回填掃描原本完全沒撈這欄,dry_run 數字系統性
   低估。**修復**:`scanMisclassified` 的 SELECT 加入 `paymentMeta`,依同樣
   `payee || payer` 邏輯併入 haystack;補 4 個 mock-DB 測試鎖住這條路徑
   (`describe("runStripePayoutProbeDryRun — paymentMeta payee/payer 併入
   haystack")`)。
3. **`bankPLService.ts` 的 `foldBankPLRows`/`generateBankMonthlyTrend` 沒有
   `stripe_payout` 分支,金額靜默消失**—— 1/3 路發現(correctness),論證
   扎實(逐行追 if-chain 證明無分支命中)且後果嚴重:雖然正確排除出損益
   (雙計防護達標),但 Jeff 在 P&L UI 上完全看不到這筆錢,對帳時對不上銀行
   對帳單。**修復**:`foldBankPLRows` 新增 `stripe_payout` 分支(仿 `transfer`
   給獨立 `stripePayout: {total, count}` tile);`generateBankMonthlyTrend`
   的 skip guard 顯式排除;`BankPLReport` 介面+`emptyReport()`+
   `financeAlertProducer.test.ts` 的 `makeBankPL` 全部同步補欄位;
   `ProfitLossV2.tsx` 的「不計入損益」callout 區塊新增第 3 個 tile(grid 從
   2 欄改 3 欄,6 個 tile 剛好排滿兩列,i18n `stripePayoutTile`/
   `stripePayoutDesc` 兩地新增);`bankPLService.test.ts` 新增 3 個
   RED-LINE 測試鎖死「有自己的 tile」+「絕不進 income/expense/netProfit」。
4. **confirm 回填會靜默覆寫 Jeff 手動的 `jeffOverrideCategory`**—— 1/3 路
   發現(double_count_guard),執行者自己在初版也已在偏離申報承認是已知
   缺口。**修復(採「折衷版」,審查建議的兩個選項之一)**:`scanMisclassified`
   回傳的每筆候選新增 `isHumanOverridden` 欄位(`jeffOverrideCategory`
   非空字串即為 true);報表分兩桶——`autoEligibleCount/Amount`(AI 判斷、
   Jeff 從未動過的,confirm 會改標)與 `humanOverriddenCount/Amount`
   (Jeff 已手動設過 income_booking 的,只回報數字,confirm **絕不觸碰**)。
   `runStripePayoutProbeConfirm` 只對 autoEligible 桶的 id 執行 UPDATE。
   3 個 mock-DB 測試鎖死:全 autoEligible → update 呼叫一次;全
   humanOverridden → update 完全不呼叫、updatedCount=0;混合桶 → 只有
   autoEligible 那筆被改。
5. **`accountingKnowledge.test.ts`「紅」案例斷言太弱,mutation test 證明
   會放行真實回歸**—— 1/3 路發現(test_and_scope),附可重現證據:把
   `MEMO_HINTS` 的 `"tour deposit"` token 拿掉(模擬讓真實客人收入掉出
   正確分類的回歸),14 個測試全部照樣 PASS。原斷言只寫
   `expect(r.category).not.toBe("stripe_payout")`,沒證明「真的還是
   income_booking」。**修復**:改成
   `expect(r.category).toBe("income_booking")` +
   `expect(r.source).toBe("memo")`;順手把 descriptor 從借用
   `KNOWN_OUTFLOW_VENDORS`「Ann(中國簽證 vendor)」出帳字串換成乾淨的
   客人 Zelle 格式(P2 #10 一併處理,審查者也點出語意混淆問題)。
6. **`scanMisclassified` 零測試覆蓋 DB 邏輯,「本地無 DATABASE_URL」理由
   站不住腳**—— 1/3 路發現(test_and_scope),附具體反證:repo 已有
   `stripeWebhook.refunds.test.ts:243-244` 這類用 `vi.mock("../db", () =>
   ({getDb: vi.fn(...)}))` 在沒有真實 DB 時測 DB-touching orchestration 的
   既有慣例,塊A/塊C 都沒嘗試。**修復**:補 7 個 mock-DB 測試(dry_run 4 個
   + confirm 3 個,見上方 #2/#4),誠實揭露範圍——mock 的
   `.where()`/`.orderBy()`/`.limit()` 不會真的解析 drizzle SQL 條件樹,
   fixture 直接提供「假設 SQL WHERE 已篩過」的列,測的是 scanMisclassified
   收到 DB 列之後的 JS 後處理邏輯,不是 SQL WHERE 文字本身(CASE WHEN
   優先權/exclude 篩選邏輯簡單,仍是人工 review 保證,測試檔頂端註解已
   如實寫明)。

**P2(commit 前一併處理,低風險/低成本)**

7. **`bankTransactionLinkEngine.ts`(塊A 已 commit 檔案)的 `buildHaystack`
   缺 `paymentMetaReason`,跟塊C 的 preClassify haystack 不對稱**—— 1/3 路
   發現(double_count_guard)。這是**跨塊觸碰**:`LinkableBankTxn` 型別
   其實已有 `paymentMetaReason` 欄位(`extractOrderRef` 已在用),只是
   `buildHaystack`(供 stripe_payout auto-link 規則用)沒有併入。不是雙計
   風險(漏抓只會多出一張待認領卡讓 Jeff 白忙),但破壞「與塊C 同源」的
   宣稱。**修復**:一行加入 `txn.paymentMetaReason`,重跑塊A 既有 27 個
   測試全綠(沒有動到型別或呼叫端,單純多一個 haystack 輸入源)。完整
   payee/payer 級別的深度整合(型別加欄位+呼叫端 plumbing)留作已知
   殘餘差距,不在本次順手修復範圍。
8. `accountingAgent.ts:237`/`:247` 的「10 個類別」字樣同步(併入 P0 #1 一起
   改)。
9. `accountingCategories.ts` 註解殘留「10 keys」字樣(頂端已改 11,下方
   M1 說明+`isAccountingCategory` 函式註解沒同步)——已同步成 11。
10. `accountingKnowledge.test.ts` 紅例 descriptor 借用 vendor 出帳字串
    (併入 P1 #5 一起改)。
11. `stripePayoutDeclassifyBackfill.test.ts` 缺「剛好 200 筆」邊界測試
    (兩路審查對此結論矛盾,人工核對後確認 test_and_scope 是對的,原本
    只測 250 筆超過上限這一側)——已補上。

**未修復(操作面限制,無法用程式碼解決,已寫進 T6)**

12. **塊A、塊C 兩支存量回填是獨立端點,沒有機制保證兩個都會被跑**——
    `bankPLService`(真正決定 P&L/報稅數字的地方)只讀
    `bankTransactions.agentCategory`/`jeffOverrideCategory`,不讀
    `bankTransactionLinks`。若 Jeff 只跑了塊A 的 confirm,`bankTransactionLinks`
    顯示正確但 `bankTransactions` 的分類沒被塊C 改到,`bankPLService` 的
    數字依然雙計。這不是程式碼 bug,是兩支獨立端點的操作順序依賴——T6
    會明確提醒兩支都要各自 confirm 過,順序不重要但缺一不可。

### 自測證據(對抗審查修復後、commit 前重跑)

```
tsc --noEmit: 0 錯
pnpm vitest run: Test Files  318 passed | 11 skipped (329)
                 Tests  4703 passed | 90 skipped (4793)
pnpm i18n:parity: en 7685 keys │ missing 0 │ extra 0
                  ✓ 100% parity, 0 hardcoded patterns. Ship it.
```

### 已知限制

- 探針數字(存量中疑似雙計筆數,dry_run 的 `totalMisclassified`/
  `autoEligibleCount`/`humanOverriddenCount`)需要 prod 跑 dry_run 才有真
  數字——本地無 DATABASE_URL,無法在本 session 內產生真實探針結果,T6 會
  誠實列出這個限制,建議 ship 後由 Jeff/下一個 session 實際跑一次 dry_run
  並把數字回填進 T6。
- `ProfitLossV2.tsx` 新增的 `stripePayout` tile 因本地無 DATABASE_URL +
  無法通過 admin 登入(同一限制),無法在本 session 內實際截圖驗證渲染
  結果;已用 tsc(型別/JSX 結構正確)+ 比照同一 grid 內其餘 4 個 tile 的
  完全相同 pattern(rounded-lg border/icon/文字大小)手動核對一致性,視覺
  驗證留給 ship 後走查清單第 3 項(dispatch 原文已要求「FinanceReports
  待認領區塊截圖」,可以順便一併截這個新 tile)。
- `bankTransactionLinkEngine.ts` 的 haystack 對稱性只補了
  `paymentMetaReason`,payee/payer 級別的深度整合(型別加欄位+呼叫端
  plumbing)留作已知殘餘差距,見上方 P2 #7。

## 塊D:衛生清理 + 六項回爐(零 migration)

**狀態:✅ 完成。commit `3de1e67`,tsc 0 錯 + 全套 323 檔 4753 tests 綠 +
i18n 100% parity。完整 T6 見 `t6-report-20260709-f1.md`。**

塊D 三件:
1. recordPayment(adminCustomerOrders.ts)移除寫死 `'square'` 回退,method 與
   訂單既有值皆缺時存 `null` 不猜(Jeff 有五條收款通道,預設 square 會汙染對帳)。
2. 刪三個死 UI 元件(FinanceTab.tsx / landings/FinanceLanding.tsx /
   BankAccountsTab.tsx),fresh 驗證零 live import;ProfitLossV2.tsx:50 +
   plaidRouter.ts:1428/1531 三處孤兒註解改寫(financeKpi 端點仍 live,只改註解)。
3. Plaid sandbox 殘留清理端點 `POST /api/admin/cleanup-sandbox-residue`
   (dry_run/confirm,LOCAL_SCRIPT_TOKEN)+ 新檔 `sandboxResidueCleanup.ts`。
   三重防護(SQL WHERE + JS 逐列複驗 assertOnlySandboxRows + BofA 黑名單),
   只刪 First Platypus Bank + isActive=0。dry-run 實數待 prod 跑(本地無 DB)。

六項回爐(監工代 push 塊C 後回流):
1. 抽 `wouldExceedAllocation` 純函式,8 個真實數字紅綠例(engine.test.ts)。
2. `processInboundTransaction` 可注入假 db 四態整合測試(新檔
   `bankTransactionLinkEngine.process.test.ts`,8 例)。
3. `isStripePayoutInflow` 補獨立單字 'stripe' 誤標紅測試(釘現狀,記已知風險)。
4. `deferStripeBookingIncome`/`reverseDeferral` auditLog:T6 申報 webhook 豁免
   (無 ctx.user,靠 trustDeferredIncome 列 + reversedAt + idempotency 表追溯)。
5. 0113 migration 註解移除字面 `statement-breakpoint` marker。
6. T6 兩行紅字(STRIPE_TRUST_DEFERRAL_ENABLED 需先建 F2 P&L 接線;部分退款不觸
   遞延 → F2)。

順帶:Wave2 SQL 登記表行號漂移修正(registryEntries.ts 6 條 source)。

### 待 Jeff(見 T6 第 6 節)

- ~~sandbox 清理 dry-run 待 prod 跑(預期 24 帳戶),Jeff 點頭才 confirm。~~ 已完成,見下方追溯紀錄。
- ~~塊C 存量回填 dry-run 待 prod 跑,數字回填塊C T6 欄。~~ 已完成(totalMisclassified=0),見下方。
- STRIPE_TRUST_DEFERRAL_ENABLED flag 在 F2 P&L 接線建好前不准翻開。

## post-ship 追溯紀錄(v806,2026-07-09,Jeff 對話授權後執行)

> 指揮裁決:sandbox confirm 這個一次性硬刪動作,在 systemAudit() 建好前,
> 端點回應全文貼進本檔當追溯(補足這次沒有 DB 審計列的缺口)。

### sandbox 清理(cleanup-sandbox-residue)

dry_run(唯讀,狀態 200):`accountCount=24, transactionCount=104,
deletedAccounts=null, deletedTransactions=null`。24 個帳戶全部
institutionName="First Platypus Bank"、isActive=0、id 1-24(Plaid sandbox
兩輪各 12 種帳戶型)。

linkedBankAccounts 執行前總覽:First Platypus(isActive=0)24 + Bank of America
(isActive=1)4。

**confirm(Jeff 2026-07-09 對話授權,狀態 200)全文**:
```json
{"accountCount":24,"transactionCount":104,"accounts":[
{"id":1,"institutionName":"First Platypus Bank","accountName":"Plaid Checking","isActive":0},
{"id":2,"institutionName":"First Platypus Bank","accountName":"Plaid Saving","isActive":0},
{"id":3,"institutionName":"First Platypus Bank","accountName":"Plaid CD","isActive":0},
{"id":4,"institutionName":"First Platypus Bank","accountName":"Plaid Credit Card","isActive":0},
{"id":5,"institutionName":"First Platypus Bank","accountName":"Plaid Money Market","isActive":0},
{"id":6,"institutionName":"First Platypus Bank","accountName":"Plaid IRA","isActive":0},
{"id":7,"institutionName":"First Platypus Bank","accountName":"Plaid 401k","isActive":0},
{"id":8,"institutionName":"First Platypus Bank","accountName":"Plaid Student Loan","isActive":0},
{"id":9,"institutionName":"First Platypus Bank","accountName":"Plaid Mortgage","isActive":0},
{"id":10,"institutionName":"First Platypus Bank","accountName":"Plaid HSA","isActive":0},
{"id":11,"institutionName":"First Platypus Bank","accountName":"Plaid Cash Management","isActive":0},
{"id":12,"institutionName":"First Platypus Bank","accountName":"Plaid Business Credit Card","isActive":0},
{"id":13,"institutionName":"First Platypus Bank","accountName":"Plaid Checking","isActive":0},
{"id":14,"institutionName":"First Platypus Bank","accountName":"Plaid Saving","isActive":0},
{"id":15,"institutionName":"First Platypus Bank","accountName":"Plaid CD","isActive":0},
{"id":16,"institutionName":"First Platypus Bank","accountName":"Plaid Credit Card","isActive":0},
{"id":17,"institutionName":"First Platypus Bank","accountName":"Plaid Money Market","isActive":0},
{"id":18,"institutionName":"First Platypus Bank","accountName":"Plaid IRA","isActive":0},
{"id":19,"institutionName":"First Platypus Bank","accountName":"Plaid 401k","isActive":0},
{"id":20,"institutionName":"First Platypus Bank","accountName":"Plaid Student Loan","isActive":0},
{"id":21,"institutionName":"First Platypus Bank","accountName":"Plaid Mortgage","isActive":0},
{"id":22,"institutionName":"First Platypus Bank","accountName":"Plaid HSA","isActive":0},
{"id":23,"institutionName":"First Platypus Bank","accountName":"Plaid Cash Management","isActive":0},
{"id":24,"institutionName":"First Platypus Bank","accountName":"Plaid Business Credit Card","isActive":0}
],"deletedAccounts":24,"deletedTransactions":104}
```

**confirm 後唯讀複驗**:
- linkedBankAccounts 總覽:只剩 Bank of America(isActive=1)× 4。First Platypus 0 筆。
- BofA 四帳戶完好(id/名字/isActive 全在):
  - 30001 "packgo llc"(isActive=1)
  - 30002 "CORP Account - Business Advantage Travel Rewards - 4899"(isActive=1)
  - 30003 "Living Trust Account"(isActive=1)
  - 30004 "CORP Account - Business Adv Unlimited Cash Rewards - 9888"(isActive=1)
- 計數:`lba_total=4, fp_remaining=0`。刪除精準,BofA 一根毛沒動。

### 塊C 存量回填(backfill-stripe-payout-declassify)

before(dry_run,狀態 200)與 after(confirm,狀態 200)皆:
`totalMisclassified=0, autoEligibleCount=0, humanOverriddenCount=0, updatedCount=0`。
no-op —— prod 存量中沒有被誤分類成 income 類的疑似 Stripe 撥款(與 #3 探真一致:
prod 根本沒有 Stripe 撥款,真實處理商是 Square)。before/after 相同,無資料變動。

### post-ship 走查六項(唯讀,詳見 t6-report-20260709-f1.md 走查段)

- 待認領:$8,908/$2,916/$3,598(合 $15,422)三筆確認仍在 v806 未 link 入帳集
  (320 筆待認領 / 共 $447,732)。Chrome 截圖待 Jeff 登入補(Browser 3 未登入,
  不代輸密碼)。
- flag OFF:`STRIPE_TRUST_DEFERRAL_ENABLED=(unset)`;`PLAID_TRUST_DEFERRAL_ENABLED=true`
  (塊B 既有,非本批)。
- backfill dry_run:373 掃描、53 small_inflow、320 待認領、$447,732。
- 對帳引擎 link 現況:bankTransactionLinks total=0(存量回填 confirm 未跑、部署後
  尚無新 sync 觸發掛鉤;預期狀態非缺陷)。
- 煙霧七臂:指揮已驗全綠,引用。
- sandbox confirm + BofA 複驗:見上方追溯段。

## F3 財務駕駛艙(branch finance-f3,2026-07-09 夜間衝刺)

### 塊A:駕駛艙殼與真相列(commit 86c241b,指揮驗收有條件收)

新建 client/src/components/admin-v2/FinanceCockpit/(殼 + 真相列四格 + 雙欄骨架 +
第二層入口);掛載兩點(/ops/finance 取代 placeholder;/workspace 月報 tab);
新增唯讀 bankTransactionLinks.pendingSummary。

### 塊A 與 B-final 的偏離申報(指揮令 #8 留痕;初版六條 + 驗收裁定)

1. 待認領格接真源顯示 prod 真數(320 筆/$447,732),非 mockup「3 筆/$15,422」
   (mockup 那三筆實為 Trust 未歸戶)。裁定:合規,dispatch 明令接真源。
2. Trust 格接 trustReconciliation;flag off 顯示「Trust 遞延未啟用」不謊報數字。
   裁定:初版口徑走樣(誤用全 outstanding 當主數字)= P1,回爐修正:server 加
   三段拆分(trustOutstandingSplit),主數字 = 已對應未出發(38,600 口徑),
   等式 outstanding = matchedNotDeparted + departedPending + unmatched 測試釘死。
3. 真相列自建 4 欄 1:1(KPIStrip primitive 寫死 6 欄 grid,像素對不上 B-final);
   PageHeader primitive 有復用。裁定:接受。
4. 色值用 Tailwind 語意 class(emerald-700/amber-600/amber-700),非 B-final 字面
   hex var;負值初版誤用 rose-700,回爐改 red-700(B-final #c10007)。
5. 新增唯讀 server procedure pendingSummary(dispatch「缺唯讀才新增」授權);
   回爐加 Redis 快取 TTL 300s + single-flight + claim/unlink 主動失效。
6. 左右欄塊A 為建置中占位;第二層「報表與稅務」「報稅匯出 CSV」暫指
   FinanceReports "tax" 分頁(塊D 換 D 藍本正式頁)。

### 塊A 回爐(P1 + 批修,與塊B 同 commit)

- P1 Trust 口徑:見偏離 #2。trustReconciliation 每帳戶新增欄位
  matchedNotDeparted / departedPending / departedPendingCount(唯讀新增,不改
  既有欄位);TruthRow 主數字換 matchedNotDeparted,hint 標明「Trust 未對應」
  與左格「待認領」(全通道)是兩個語意的數。
- 批修:rose→red-700;誤導註解修正;pendingSummary Redis 快取(見偏離 #5);
  resolveTileState 加 stale 態(refetch 失敗但有上次好值 → 顯示上次值 + 淡標記,
  不翻「讀取失敗」);本章節即偏離申報留痕。

### 塊B:工作區(左欄)

- 待認領表 PendingClaimsCard:日期/#流水號/aging(>30 天紅字天數,LA 曆日兩端
  同套)/金額 amber-700/候選 chip/認領按鈕;卡頭彙總接 pendingSummary(與真相列
  同源);表列接 listPending(limit 200),列數 < 總數時表尾標「僅顯示前 N 筆」。
- 認領對話框 ClaimDialog:候選確認 + 訂單搜尋逃生口(新唯讀 searchClaimTargets,
  搜 customOrders 單號/客人/團名)+ 內部分類下拉(鎖 SCHEDULE_C_MAP 枚舉,
  claimCategories.ts 鏡像 + 測試斷言與 server 枚舉一致,禁自由文字)+ 備註欄
  (claim.note 既有欄位)。
- 待認列確認卡 RecognitionCard:trustDeferredList(pending) 前端摺
  foldDepartedPending(與 server departedPending 同口徑);認列按鈕接既有
  plaid.trustRecognizeNow(本批在該 mutation 加 audit,action trust.recognizeNow,
  fail-open 不吞認列結果);AI 不自動認列,全部 Jeff 按。
- 已自動處理卡 AutoHandledCard:新唯讀 listAutoLinked(claimedBy='system',
  LA 本月,join bankTransactions + customOrders)+ 摘要行;撤銷 unlink tRPC 已建
  (delete + audit action bankTransactionLink.unlink + 快取失效),UI 入口按
  dispatch 塊B#4 掛「對帳明細」層(本批只留入口按鈕)。
- 空態:待認領 0 且待認列 0 → 「今天沒有等你的事」(B-final 第二態);已自動卡
  仍顯示。

### 塊B 偏離申報

1. 認領按鈕未選候選時不做 disabled(B-final off 樣式),改為 outline 樣式仍可按
   (開對話框走搜尋/分類)—— 對不到訂單的列需要認領入口,純 off 會走不下去。
2. 待認列卡顯示「Booking #id」,未 join 客人名/團名(B-final「陳先生 韓國團」);
   trustDeferredList 無 join,名稱補齊留塊C/D。→ 塊C 已補(join + fallback)。
3. 認列按鈕 = 批次認列所有已到期(server recognizeReadyDepartures 語義),非逐筆
   認列;卡上逐筆列出、footer 顯示合計後一鍵確認。→ 指揮批准保留,塊C 文案
   誠實化(「執行認列掃描」+ footer 註明認列所有已到期)。
4. 分類下拉鎖全 11 個 SCHEDULE_C_MAP 枚舉;舊 PendingClaimsTab 的
   owner_transfer/other 選項不在枚舉內,屬既有債,本批不動舊元件。→ 塊C 小修
   server 端鎖 zod 枚舉後,舊元件選項 value 已對映到枚舉(見塊C)。

### 塊C:兩本帳(右欄)+ 小修

小修(指揮塊B 驗收回令):
- claim.categoryCode server 端 zod 鎖 SCHEDULE_C_MAP 枚舉(z.enum(ACCOUNTING_
  CATEGORIES),defense in depth);測試蓋枚舉外值(owner_transfer/interest/
  other/自由文字)被 zod 擋。連帶:舊 PendingClaimsTab 的 CATEGORY_OPTIONS
  value 對映到枚舉(owner_transfer→transfer、other→other_review、interest 無
  對應枚舉移除選項),否則鎖 zod 後舊 tab 認領會 400 —— label i18n key 沿用。
- 認列語義誠實化:recogAction 改「執行認列掃描」,footer 註明掃描會認列所有
  已到期訂金(全域掃描語義經指揮批准保留,冪等)。

塊C 本體:
- 損益卡 PLCard:topline / 成分條(灰階,淨利段字綠;寬度 compBarSegments 純
  函式,比例加總 100、0 收入不除零、負淨利藏條)/ legend / 損益行(refunds 或
  遞延 ≠0 時展開 總收款→減項→營業收入,否則單行)/ 中性列兩行(transfer /
  stripePayout tiles)/ 口徑 note(B-final 修訂版;退款 0 摺疊成一句)/ $0 月
  中性灰簡版。資料源申報:選 plaid.profitLossReport(LA 本月),不選 financeKpi
  —— 真相列只要 income/netProfit,本卡要成本 byCategory + 中性 tiles + refunds,
  只有 profitLossReport 回全量;兩者同一支 generateBankPL,總額口徑一致(唯
  financeKpi 期間用 server 時鐘 UTC 切月、本卡用 LA 曆月,月界深夜短暫可能差,
  月中恆一致)。成本行 label 復用 claim.cat* 譯文(同一組分類名)。
- 客人訂金卡 TrustCard:三段拆分直接吃 truth.trust(與真相列同源);逐團列表
  foldMatchedNotDeparted(前 4 筆 + 「其他 N 筆」聚合;近出發 <=30 天 amber
  dot);未對應列(認領後歸戶·見左側);已出發待認列列(red dot);footer
  等式錨在「未認列合計 = 三段之和」(結構恆真),銀行餘額相符顯示「相符」、
  drift >= $1 顯示差額待查(誠實,不假裝餘額恆等)。
- 名稱 join:trustDeferredList 唯讀擴充(getTableColumns spread + leftJoin
  bookings/tours,新增 bookingCustomerName/bookingTourTitle 兩欄,既有消費者
  形狀不變;dynamic import 避免頂部行號漂移破壞 sqlRehearsal 登記錨點)。
  RecognitionCard 同步升級顯示客人名+團名(fallback Booking #id)。
- 三態:各卡 loading(pulse)/error(讀取失敗)/stale(淡標記+上次值),
  沿用 resolveTileState。
- ColumnPlaceholder.tsx 刪除(塊C 落地後無消費者);ledger.placeholder* i18n
  同步刪(zh/en parity 維持)。

### 塊C 偏離申報

1. 成分條在淨利為負或 $0 月時整條隱藏(B-final 未定義虧損態;段寬無法表達
   負值,只列損益行)。
2. 損益卡 meta 用「Plaid 實收」,不照 B-final「Plaid 實收 · Stripe 遞延 OFF」
   寫死 flag 狀態(flag 是活的,寫死會說謊)。
3. footer 等式錨在未認列合計(恆真式),非 B-final 的「餘額 = 三段和」(那是
   drift=0 特例);drift ≠ 0 時顯示差額,經指揮「誠實顯示」指示。
4. 逐團列表每列 dot 的 amber 判定 = 距認列日 <=30 天(B-final 只畫了一個 19 天
   的 amber 例,未定義閾值;取 30 天與 aging 紅字同刻度)。
5. 損益卡口徑選擇(指揮令補入編號):資料源選 profitLossReport 不選 financeKpi
   (本卡要成本 byCategory + 中性 tiles + refunds,只有前者回全量;同一支
   generateBankPL,總額口徑一致)。原月界差異已由塊C 回爐 P2 統一 LA 曆月消除。

### 塊C 交付數字勘誤(指揮令)

- cockpitMath 測試數前報「26→36」有誤,實為 26→35(accountMask 1 + join 名稱
  透傳 1 + foldMatchedNotDeparted 3 + compBarSegments 4);全套總數 4823 正確。
- 中途修(執行過程抓到即修,非驗收發現):
  1. claim zod 枚舉收緊使兩處 client 端 string 型別紅(ClaimDialog /
     PendingClaimsTab)→ 改 ClaimCategory / CategoryValue union + 下拉來源 cast。
  2. claim 枚舉 import 鏈(accountingAgent→llm→llmCache)在測試模組載入時
     redis.ping() → 測試 redis mock 補 ping/on。

### 塊C 回爐(P1/P2/P3,與塊D 同 commit)

- P1 scope 一致:trustDeferredList 移除 eq(userId, ctx.user.id),比照
  trustReconciliation unscope(isTrustAccount=1 + isActive=1),support@ 開
  /ops/finance 標頭與明細不再打架。改動處註解已寫明理由與日期(plaidRouter
  trustDeferredList 段)。單一公司後台,adminProcedure 已是守門。
- P2 月界口徑:financeKpi 切月改 America/Los_Angeles 曆月(原 server UTC
  toISOString 切月,月初 UTC 領先 0-8 小時內真相列與損益卡顯示不同月)。回傳
  形狀不變,只有期間定義修正 —— 行為變更:UTC 月初深夜時段 thisMonth 從
  「新月」修正為「LA 仍在的舊月」,其他消費者同步受益。
- P3#1 registry 同步:trustDeferredList 兩條 handWritten 條目的 sql 文字補上
  leftJoin bookings/tours 真形狀(先前只 bump 行號,ship 前 EXPLAIN 會跑舊
  SQL);行號同步 1989/1992(P1/P2 位移),另三條 financeKpi 下游錨點
  1626/1639/1698 → 1628/1641/1700。
- P3#2 退款列帶號:PLCard 退款列改 fmtSignedMoney(-refunds),供應商退款入帳
  (refunds<0)顯示 +,不再 Math.abs 假裝減項,三列可 foot。
- P3#3 截斷尾註:TrustCard 逐團列表與 RecognitionCard footer 在來源打滿
  limit 200 時顯示「來源僅取前 200 筆」(ledger.listTruncated)。

### 塊D:報表與稅務正式頁 + 真數對比驗收

- TaxDetail.tsx(D 藍本):期間切換(本月 / YTD / 去年 + 年份選)→ KPI 4 格
  (營收+同期成長 / 應稅淨利 Line 31 / Trust 未認列不計本年稅 / 待複查)→
  月度趨勢(bar + 表 + 累計列;新唯讀 plaid.plMonthlyTrend 逐月 generateBankPL)
  → Schedule C 對照(profitLossReport.scheduleCMap 真對映抽 Line 行號,Part
  I/II + Line 31,vs 去年同期)→ Trust 對稅時點(本年已認列 / 未認列遞延)→
  已排除防雙計(stripePayout / transfer tiles)→ 1099-NEC(新唯讀
  plaid.vendor1099List:年付 ≥$600 的 cogs_tour 供應商,Jeff override 優先,
  JS 端彙總不新增 raw SQL 面)→ 1040-ES 四格「待建」(後端無算法,不猜稅率)
  → 匯出(年度報稅包 ZIP 接現成 yearEndExport;Schedule C 摘要 CSV 端點沒有,
  disabled + 待建標,不本批造)。
- CockpitDetail "tax" 分支換 TaxDetail(其餘 view 仍指 FinanceReports 過渡)。
- i18n:financeCockpit.tax 全區塊雙語,parity 100%。

### 塊D 偏離申報

1. 期間切換做「本月 / 今年 YTD / 去年」三段(D 藍本另有「本季 / 自訂」,資料
   源天然支援,UI 留待後續需求)。
2. KPI 合併 D 藍本的「YTD 淨利」與「應稅淨利」為一格 —— 真源 generateBankPL
   每期已扣退款,兩數恆等,分開顯示反而暗示有兩套口徑。
3. 1099 卡接真源(vendor1099List),但單一 vendor 金額未做獨立 SQL 對照
   (彙總邏輯 tsc + code 審查;探真對比表以 P&L / trust / pending 為準)。
4. Trust 對稅時點卡的「本年收到訂金」行(D 藍本三行之一)省略 —— 無精確現成
   資料源(recognized + outstanding 的 depositDate 混合口徑),不擺近似數。
5. plMonthlyTrend / vendor1099List 兩個新唯讀 procedure 無專屬單測(內部是
   generateBankPL 迴圈 / 純 JS 彙總;generateBankPL 本身已有單測)。

### 塊D 真數對比表(2026-07-10 prod 唯讀探真;壓軸驗收)

探真方法:flyctl ssh 容器內 node 探針(唯讀 SELECT,rows 原樣拉回)→ 本機以
worktree 真源碼 fold(頁面路徑)vs 獨立 SUM(不經 fold)逐格對比;待認領走
prod dry_run 端點(HTTP 200,唯讀)。探針經 node --check + 無反引號 /
dollar-brace 檢查(T2 地雷 #7)。LA 本月 = 2026-07-01 – 2026-07-10。

| 格 | 頁面路徑計算值 | 獨立探真值 | 判 |
|---|---|---|---|
| 現金部位(#2174 available) | $2,034.03 | $2,034.03(accounts row 直讀) | ✓ |
| 本月營收 income.total | $290.00 | income_booking SUM $290.00(退款 0、本月新遞延 0) | ✓ |
| 本月淨利 | −$238.97 | 290 − 210.90(COGS)− 318.07(OpEx)= −238.97 | ✓ |
| COGS(tour+other) | $210.90 | $210.00 + $0.90 | ✓ |
| OpEx 逐項 | office 96.40 / travel 120.17 / software 101.50 | 同值(獨立 SUM) | ✓ |
| 退款列 | $0(摺疊成 note 一句) | refund SUM $0 | ✓ |
| Stripe 撥款 tile | $0 | stripe_payout SUM $0 | ✓ |
| 內部轉帳 tile | +$0(count 4,netted) | gross SUM $13,540 | ✓* |
| 待認領(真相列) | pendingSummary = dry_run 同源 | dry_run:321 筆 / $448,022(掃 360、自動 39 small_inflow) | ✓ |
| Trust 主數字 matchedNotDeparted | $0 | bookingId 有 + 未到期 SUM = $0 | ✓ |
| Trust 未對應 | $15,422(3 筆) | bookingId NULL SUM = $15,422 / 3 筆 | ✓ |
| Trust 待認列 departedPending | $0(0 筆,認列卡隱藏) | 到期 SUM = $0 | ✓ |
| Trust 等式 | 0 + 0 + 15,422 = 15,422 = outstanding | trustTotal SUM $15,422 | ✓ |
| Trust 餘額 / drift | 餘額 $4,980,drift −$10,442 → footer 顯示差額待查 | balance 直讀 $4,980 | ✓ |
| 本年已認列(TaxDetail) | $0 | recognized2026 SUM $0 | ✓ |

✓* 內部轉帳 tile 口徑說明(非 mismatch):bankPLService transfer tile 是
netted(流入−流出,一出一進相抵 = $0,count 4),與 ProfitLossV2 owner-capital
tile 同語義;獨立 gross 加總 $13,540 是搬運總量。頁面照 tile 語義顯示
+$0(4 筆)。若要顯示 gross 搬運量屬後續口徑裁決,不影響數字真實性。

註:2026-07-09 探真基準(320 筆/$447,732)與本日(321/$448,022)差一筆新
入帳,屬資料自然增長;三筆 Trust 未歸戶 $8,908/$2,916/$3,598 = $15,422 兩日
一致。prod 真實狀態:Trust 未認列全部是未對應(matchedNotDeparted = $0),
真相列 Trust 格顯示 $0 + hint 未對應 $15,422 是誠實顯示,非缺陷。另
bankTransactionLinks 現有 14 筆 link(引擎部署後已開始工作)。

### 塊D 視覺驗收(fallback,誠實申報)

本機 dev server 起不來(無 DATABASE_URL),無法截圖與 B-final 並排。fallback:
designLint.test.ts 源碼級斷言 5 條全綠(狀態色不做背景填色 / serif 只准
PageHeader / 禁 rounded-none / 負值用 red-700 非 rose / 元件檔數防呆)。
像素級抽查(間距 4px 網格、字級)待 prod 部署後 Jeff 親驗或指揮截圖複核。

### 塊D 收官回爐(指揮總驗收六項,commit 見鏈尾)

1. vendor1099List / plMonthlyTrend 核心數學抽純函式 server/services/
   taxAggregates.ts + 專屬單測 11 個(照 foldBankPLRows 抽取慣例,比 mock db
   更強):trend 蓋當年止於本月 / 過去年 12 月 / 未來年空 / 2 月閏平年天數 /
   年初下界;1099 蓋 jeffOverride 優先序雙向 / amt<=0 毛額語義 / $600 邊界
   (600.00 含、599.99 不含、跨筆累計過線)/ 名稱 fallback 鏈 / 排序捨入。
2. 探針稽核留檔:附錄(下方)含探針原文與 node --check 證據。
3. drift 文案方向感知:負 drift(信託現金 < 追蹤中未認列)顯示查核級文案
   「信託帳戶現金低於追蹤中的未認列訂金 $gap,需查核(訂金可能未入信託或
   提前轉出)」;正 drift 維持原文案。i18n 雙語
   (trustNoteBalanceDriftNegative)。prod 現況 drift −$10,442 會走新文案。
4. TaxDetail 營收 KPI 改毛收入(Line 1 gross receipts,標籤同步標明);
   refunds ≠ 0 副行「退款 −$X · 淨 $Y」,= 0 保留同期成長副行;growth 改
   gross 對 gross。
5. transfer tile 主值保留淨額,副字「(N 筆 · 搬運 $gross)」——
   foldBankPLRows 新增 transfer.gross(絕對值和;新欄位不破壞消費者,
   bankPLService.test 紅線測試補 gross=7000 斷言)。
6. 1099 note 補句:金額為毛額(供應商退款未淨扣),以 Jeff 覆核為準(雙語)。

順手留檔:
- 寫路徑清點更新:F3 全案觸及的 mutation 共四支 —— claim / unlink /
  trustRecognizeNow(皆 Jeff 按 + audit)+ yearEndExport(第四支,唯讀
  mutation:只讀 DB 組 ZIP 上傳 R2 回 URL,無 DB 寫入,mutation 形式僅因
  含外部副作用)。
- UX 觀察(留待 Jeff 反饋):TaxDetail「Trust 對稅時點」卡的「本年已認列」
  固定算 curYear,而 Schedule C 卡跟著期間切換(本月/YTD/去年)—— 選「去年」
  時兩卡期間不同步。對稅時點語義上「本年」合理,但雙期間並存可能困惑,
  等 Jeff 用過裁示。

### 附錄:塊D 探針原文與實跑證據(治理先例 e38ddcd;T2 地雷 #7 留檔)

驗證證據:`node --check f3-probe.cjs` exit 0;
`grep -c '（反引號或 dollar-brace)' f3-probe.cjs` = 0 處。
prod 執行:flyctl ssh console 內 base64 解碼至 /tmp 執行後即刪,
NODE_PATH=/app/node_modules,輸出 PROBE_JSON(8,211 bytes)無 PROBE_FAIL。
dry_run 探針(f3-dryrun.cjs,node 內建 fetch 打 localhost:8080 端點,
Bearer LOCAL_SCRIPT_TOKEN 容器內取用不外流):HTTP 200。

f3-probe.cjs 原文(唯讀 SELECT 六句):

```js
// F3 塊D prod 唯讀探真(2026-07-10)。只 SELECT,零寫入。
// 注意:本檔會經 base64 進 flyctl ssh 執行 —— 全檔禁止反引號與 dollar-brace
// (T2 地雷 #7),字串一律單引號串接。
var mysql = require("mysql2/promise");

var MONTH_START = "2026-07-01";
var TODAY_LA = "2026-07-10";

function run() {
  return mysql.createConnection(process.env.DATABASE_URL).then(function (conn) {
    var out = {};
    return conn
      .execute(
        "SELECT bt.amount, bt.agentCategory, bt.jeffOverrideCategory, bt.excludeFromAccounting, bt.isPending " +
          "FROM bankTransactions bt LEFT JOIN linkedBankAccounts a ON bt.linkedAccountId = a.id " +
          "WHERE a.isActive = 1 AND bt.date >= ? AND bt.date <= ?",
        [MONTH_START, TODAY_LA]
      )
      .then(function (r) {
        out.plRows = r[0];
        return conn.execute(
          "SELECT t.id, t.amount, t.bookingId, DATE_FORMAT(t.expectedRecognitionDate, '%Y-%m-%d') AS expectedRecognitionDate " +
            "FROM trustDeferredIncome t JOIN linkedBankAccounts a ON t.linkedAccountId = a.id " +
            "WHERE a.isTrustAccount = 1 AND a.isActive = 1 AND t.recognizedAt IS NULL AND t.reversedAt IS NULL"
        );
      })
      .then(function (r) {
        out.trustRows = r[0];
        return conn.execute(
          "SELECT id, accountMask, currentBalance, availableBalance, isTrustAccount FROM linkedBankAccounts WHERE isActive = 1"
        );
      })
      .then(function (r) {
        out.accounts = r[0];
        return conn.execute(
          "SELECT t.amount FROM trustDeferredIncome t LEFT JOIN linkedBankAccounts a ON t.linkedAccountId = a.id " +
            "WHERE a.isActive = 1 AND t.depositDate >= ? AND t.depositDate <= ? AND t.recognizedAt IS NULL AND t.reversedAt IS NULL",
          [MONTH_START, TODAY_LA]
        );
      })
      .then(function (r) {
        out.deferredThisMonth = r[0];
        return conn.execute(
          "SELECT t.amount, DATE_FORMAT(t.recognizedAt, '%Y-%m-%d') AS recognizedDay FROM trustDeferredIncome t " +
            "WHERE t.recognizedAt IS NOT NULL AND t.recognizedAt >= '2026-01-01' AND t.recognizedAt < '2027-01-01'"
        );
      })
      .then(function (r) {
        out.recognized2026 = r[0];
        return conn.execute(
          "SELECT COUNT(*) AS c FROM bankTransactionLinks"
        );
      })
      .then(function (r) {
        out.linkCount = r[0];
        console.log("PROBE_JSON_START" + JSON.stringify(out) + "PROBE_JSON_END");
        return conn.end();
      });
  });
}

run().catch(function (e) {
  console.error("PROBE_FAIL " + (e && e.message));
  process.exit(1);
});
```

f3-dryrun.cjs 原文(唯讀 dry_run 端點):

```js
// F3 塊D:prod 內打 backfill dry_run 端點(唯讀:dry_run 只算不寫)。
// 禁反引號 / dollar-brace(T2 地雷 #7)。
fetch("http://localhost:8080/api/admin/backfill-bank-transaction-links", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + process.env.LOCAL_SCRIPT_TOKEN,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ mode: "dry_run" }),
})
  .then(function (res) {
    return res.text().then(function (txt) {
      console.log("DRYRUN_STATUS " + res.status);
      console.log("DRYRUN_JSON_START" + txt + "DRYRUN_JSON_END");
    });
  })
  .catch(function (e) {
    console.error("DRYRUN_FAIL " + (e && e.message));
    process.exit(1);
  });
```

## F2 塊C 探真結論(2026-07-10,prod 唯讀;T6 依據)

方法:flyctl ssh 容器內 node 探針(唯讀 SELECT 六句,base64 → /tmp 執行後即刪,
NODE_PATH=/app/node_modules)。探針 `node --check` exit 0、全檔零反引號零
dollar-brace(T2 地雷 #7);輸出 PROBE_JSON 無 PROBE_FAIL。

### Square 撥款 descriptor 全形狀(bankTransactions,19 筆:16 入 3 出,全在 30001/#2174)

1. `ACH CREDIT Square Inc SQ ON ##/##`(description+merchantName;5 筆入帳)
2. `Square Inc DES:SQ###### ID:T############### INDN:PACK & GO, LLC CO ID:XXXXX##### PPD|WEB`
   (BofA originalDescription;9 筆入帳)
3. `Square Inc DES:ACCTVERIFY ... INDN:Chunfu hsieh ... CCD`(±$0.01 帳戶驗證一對,agent=transfer)
4. 出帳側:`ACH HOLD Square Inc SQ ON ##/##`(+$3,106 hold)與同額 DES:SQ WEB 出帳
   (2026-06-22/23 一組 hold/回沖形狀,值得 Jeff 留意但非本批範圍)

### 現行記帳路徑(決定對映設計的關鍵事實)

- Square 撥款入帳 agentCategory 幾乎全是 income_booking(兩筆有 jeffOverride)——
  撥款入帳「就是」bankTransactions 主帳(P&L 權威帳)唯一收入紀錄。
- customOrders paymentMethod='square' 僅 2 筆(ORD-2026-0011 收 $490+$490、
  ORD-2026-0004 金額 NULL);paymentMethod 分布:null 9、square 2。
- accountingEntries 含 square 字樣:0 筆。無次帳紀錄。
- → 與 Stripe(結帳當下已寫收入,撥款=雙計風險)相反:Square 今天不存在雙計,
  自動把撥款歸中性桶 = 真收入從損益靜默消失(Ann 漏斗病同款)。
- → 設計裁定:isSquarePayoutInflow 謂詞 + square_payout 桶「就緒」但不接
  preClassify / linkEngine 自動分類;撥款照走待認領,卡上帶費率帶候選銷售
  (processorPayoutMapping),Jeff 用既有 ClaimDialog 對映
  (bankTransactionLinks 即對映結構,零新表)。自動對映留待 recordPayment
  紀律成熟(dispatch 塊C #3 原文)。

### 帳戶對照(watchdog/白名單依據)

- 30001 mask 2174 = PACK&GO LLC operating(Operating 白名單預設值)
- 30002 mask 4899、30004 mask 9888 = 信用卡(非白名單)
- 30003 mask 5442 = Living Trust Account(isTrustAccount=1)—— dispatch 錨點
  「Trust 帳(30003)」即此 linkedAccountId。

探針原文(f2c-square-probe.cjs,唯讀 SELECT 六句):與 F3 探針同款結構
(mysql2/promise + 單引號串接),六句依序:square 字樣 txn 取樣(LIMIT 60)/
square txn 計數(入出分列)/ customOrders square 取樣(LIMIT 40)/
paymentMethod 分布 / accountingEntries square 計數 / linkedBankAccounts 全列。
完整原文在 git 歷史與本 session 記錄;關鍵防護:全檔 var+function 語法、
零反引號、零 dollar-brace、只 SELECT。
