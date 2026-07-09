# F1 對帳引擎 — 執行進度

> 對應派工單 `docs/features/finance-dept/dispatch-f1.md`。逐塊回寫,不倒填。

## 塊A:對帳資料模型 + 引擎 + 待認領流程

**狀態:實作完成 → 3 路 fresh 對抗審查(全數 FAIL,共 3 P0/8 P1/5 P2/2 note)
→ 逐條修復 → 重驗 tsc/vitest/i18n 綠 → 已 commit+push。**

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
- 結果:待 workflow 完成後回填本節(verdict + findings + 修復摘要)

<!-- 待補:對抗審查結果 + 修復摘要 + commit hash -->
