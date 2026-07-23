# 財報區 Phase 1 施工計畫(plan-only,不施工)2026-07-17 consolidated v4.3

> base: origin/main@fef3bdbc。worktree: 網站-finance-phase1,branch finance-reporting-phase1-plan。
> v4 = 依 Codex 19:13 十二項 exact check(FAIL:P0 2/P1 6/P2 2)九項差額返工後的**單一自足全文**;不引用任何已覆寫草稿。
> v4.3 = 依 Codex 23:09 七組窄修終驗(FAIL:P0 0/P1 3/P2 3,不授 1A0a)六個機械差額**原地窄修**:①boot orchestration 收進可注入 Seam(reportBootOnce+shortBuildSha,success 才寫 guard/reject 可重試皆在 helper 內可測,§3.2.9) ②現行 TileState/"error" 雙型別收掉+cockpitMath.test.ts 納 1A0a fixed tests(§6.1/§3.3) ③1B 納 bankPLService.trend.test.ts(fixture 補 isoCurrencyCode:"USD"+TWD/XXX 案)與 financialReportService.test.ts(隨計算面同批刪除,契約遷 managementAdapter 測試)(§9) ④freshness 邊界補等號案(age===threshold→ready,兩源)(§7.3) ⑤標題改 v4.3+boot 測試總表列 server+client 兩檔(§十) ⑥§1.7 C8 摘要同步 ingest 真值。23:09 已 PASS 凍結面(clientBoot server Interface/600s+240s 門檻方向/三個 advisor-tax 舊測入 1A0b/denylist Adapter/C8 ingest XXX 裁定/C9 兩路/單 Lua 限流/adjustment 禁止/user FK/AP 雙 FK+remainder CHECK)不重寫。
> v4.2 = 依 Codex 21:27 七項機械差額終驗(FAIL:P0 0/P1 6/P2 4,不授 1A0a)最後固定窄修清單七組**原地窄修**:①boot client Seam(adminShellBoot.ts helper+adminShellBoot.test.ts,per-SHA guard 失敗可重試) ②QueryDisplayState 單一 export 於 FinanceCockpit/types.ts+兩源 freshness 門檻寫死(600s/240s)+邊界測試 ③1A0b 補三個必轉紅現有測試+executor「保留 case」殘影更正 ④C8 更正為 ingest `?? "XXX"`+C9 兩路 recognized fold 帶 currency+三個現有 trust/tax 測試入 1B ⑤限流復用 checkAtomicRateLimit(rateLimit.ts:94 單 Lua self-healing)+adjustment 本期明文禁止+reAuthGrants userId FK ON DELETE RESTRICT+假 cleanup worker 作廢改明記保留 ⑥lines 補雙 order FK+unassignedRemainderMinor DDL CHECK>=0+FK 負例 ⑦§3.1/§11/§9 說明殘影同步+通信更正。21:27 已 PASS 凍結面(clientBoot server Interface/denylist Adapter 主體/allClear 唯一來源/DataStatus 去 loading/grant userId 綁定+canary/獨立 reversal 表)不重寫。
> v4.1 = 依 Codex 21:03 九項差額終驗(FAIL:P0 1/P1 5/P2 2,主架構通過、最後機械接線未閉)七項機械差額**原地窄修**:①boot telemetry 改真實 admin-authenticated Interface(§3.2.9,「既有 funnel」假設作廢) ②agent denylist Adapter(§4.2) ③allClear 唯一來源+server DataStatus 去 loading(§6.1/§7.3) ④1A0a 補 AccountingTab、1B 補三檔(§3.2-3.3/§9) ⑤re-auth userId 原子條件+closed scopes+canary+atomic 限流+DDL/rollback(§8.1/§8.4) ⑥AP 獨立 reversal 表 DB 歸屬保證+lines exact DDL+負例(§8.1/§8.3/§十) ⑦通信更正。21:03 已 PASS 凍結面(出口盤點/兩段部署順序/型別主體/七 KPI id/currency 方向/financeEvent-first/多筆 reversal 方向/disputed→void guard/.test.ts 規則/1C-docs)不重寫。數字定義引 number-contract-trust-first-20260717.md(數字契約);IA/狀態模型引 design-trust-first-finance-reporting-20260717.md(設計稿)。
> 已通過且凍結、本檔照抄不重談(Codex 19:13 §一):Phase 0 契約與批次大順序、flag OFF=unavailable、management/tax/raw-evidence 三投影分層、company operating whitelist+trust flag fail-closed、AdminHome 五個 MOCK_* 全清、allocation 第四表獨立 migration 批、1C-docs 前置批。
> 行號=fef3bdbc `rg`/`sed` 實測,指揮親跑;【親核】=指揮親讀原文,【盤點】=三路唯讀盤點回報經抽核。

## 〇、批次總覽(順序固定)

`1A0a client-compat → 1A0b server-block → 1A1 truth-service tracer → 1B 三出口收斂 → 1C-docs 契約同步 → 1C0 events/re-auth 基建 → 1C1 invoice 進件/核准 → 1C2 allocation/payment`

1A0 拆成 a/b 兩個 deployment gate(Codex 19:13 P0-2 新增安全停止線):**先改 client 讓一切消費端能誠實顯示錯誤並取得 Jeff 換版證明,才封 server**。單次部署方案捨棄——現況無 client-version hard gate(serviceWorker.ts:37-50 註解自承更新 silent、無 force reload【親核】),舊 bundle 收到封鎖錯誤會把七個 KPI 顯示成假 $0(KpiStrip.tsx:46-52 全部 `?? 0`【親核】)。

## 一、current-state evidence(實際檔案+行號)

### 1.1 hardcoded / mock financial values

| # | 位置 | 內容 | 證據 |
|---|------|------|------|
| M1 | client/src/pages/AdminHome.tsx:34 | `MOCK_FINANCE = { revenue: 12450, pending: 8200, trust: 45000, operating: 12300 }`,FinanceCard :77 直接 render(:87/:91/:95/:99) | 【親核】 |
| M2 | AdminHome.tsx:22、:31 | 假逾期尾款「Lisa Wu 尾款 $1,820」兩處硬編 | 【親核】 |
| M3 | AdminHome.tsx:38 | `MOCK_AGENT = {..., syncOk: true, failures: 0}` 假同步綠燈(:153-154 綠勾;failures 恆 0 使 :157 紅色分支死碼) | 【親核】 |
| M4 | AdminHome.tsx:17、:26、:36 | MOCK_MESSAGES / MOCK_TODO / MOCK_TOURS(非財務 mock,同頁) | 【親核】 |
| M5 | client/src/pages/AdminFinance.tsx | 死碼 placeholder,無 route 掛載(App.tsx:28 註解「舊檔保留不刪」) | 【盤點】 |

rg 全 client 非 /preview/ 路徑 `MOCK_` 唯一命中檔=AdminHome.tsx【親核】。

### 1.2 fail-open:查詢失敗把 trust deposit / customer funds 誤算收入

| # | 位置 | 行為 | 證據 |
|---|------|------|------|
| F1 | server/services/bankPLService.ts:226-232 | generateBankPL trust 遞延 catch 後 warn「returning gross」,deferredIncomeSubtracted 保持 0 照樣出數 → 在途訂金整額計入收入 | 【親核】 |
| F2 | bankPLService.ts:548-554 | generateBankMonthlyTrend 同款 catch「trend stays gross」 | 【盤點】 |
| F3 | server/services/trustDeferralService.ts:1175-1177、:1306-1308、:1410-1412、:1109-1112 | totalDeferredForUser / recognizedTrustIncomeInPeriod / monthlyDeferralAdjustments / computeOutstandingTrust `if(!db) return 0/zeros` 靜默成功 | 【盤點】 |
| F4 | bankPLService.ts:157-159 | generateBankPL `if(!db) return emptyReport(...)` 200 全零 | 【盤點】 |
| F5 | server/routers/plaidRouter.ts:281、:914、:1170、:1614、:1690、:1856、:1952、:2244 | `if(!db) return 空` 200 靜默成功(linkedAccountsList/transactionsList/transactionAuditHistory/uncategorizedGroups/accountingLegacyOverrideAudit/trustReconciliation/trustDeferredList/vendor1099List);financeKpi(:1440)無守門靠 emptyReport 出 $0 | 【盤點】 |
| F6 | plaidRouter.ts:2141-2156 | auditExclusionList `if(!db)` 回假空 records+空 csv(reader TrustComplianceV2.tsx:124) | 【親核】 |

### 1.3 三條銀行側算法路徑漂移+一套平行系統

| 面向 | generateBankPL(畫面) | generateBankMonthlyTrend(稅 CSV 源) | yearEndExportService(ZIP) |
|------|----------------------|--------------------------------------|---------------------------|
| 排除清單 | fold 顯式分支 transfer(:316)/stripe_payout(:327)/square_payout(:337)/other_review(:311)/refund(:345) | 單行守門 :517 四類 | **:212 只排 transfer/other_review,漏兩 payout**【親核】 |
| 遞延調整 | 有(:207-225/:375-382) | 有(:540-554 共用 monthlyDeferralAdjustments) | **無** |
| 月分桶 | 單一期間 | `new Date(r.date)` 分桶(:519-520),未用 monthKeyOfDate,mysql2 DATE 字串態日界位移風險(driver-dependent 未實證) | 整年一桶 |
| userId 範圍 | 跨 active 帳戶(:170-172) | 跨(:477-479) | **強制 eq(userId)(:132),ctx.user.id 傳入(plaidRouter:1527)→ support@ 產 ZIP 漏 trust 帳戶** |

- ZIP 後果:stripe_payout/square_payout 進 schedule_c_summary.csv(SCHEDULE_C_MAP :53/:58 標籤自稱 excluded)→ 撥款雙計;parseFloat 直加(:214【親核】);README 過時(:353「Phase 4 尚未上線」、:362-384)誤導 CPA。
- 平行系統:server/services/financialReportService.ts 讀 accountingEntries(手記帳),自有 foldMonthlyTrend(:214-233),僅遞延口徑共用(:191-192);accountingEntries 與 bankTransactions 零關聯約束(schema.ts:2148 soft-ref)。

### 1.4 正式財務真值出口全圖(1A0 封鎖對象)

| # | 出口 | 錨點 | 證據 |
|---|------|------|------|
| O1 | plaid.yearEndExport(ZIP) | plaidRouter.ts:1512;readers ProfitLossV2.tsx:151、TaxDetail.tsx:101 | 【盤點+親核】 |
| O2 | commandCenter.downloadTaxCsv | commandCenter.ts:693-703;reader admin-v2/CommandCenter/FinanceDashboard.tsx:38 | 【親核】 |
| O3 | commandCenter.askFinanceAdvisor | commandCenter.ts:678-685;reader FinanceDashboard.tsx:37;advisor 內部讀第二套 P&L(financeAdvisor.ts:70-73 generateMonthlyTrend、:105-108 generateTaxSummary)與 bankPL(:53-54) | 【親核】 |
| O4 | ops agent `downloadTaxCsv` 全鏈 | opsActions.ts:38-41(ACTION_TYPES)、:176-181(executor switch)、:636-657(doDownloadTaxCsv);opsAgent.ts:416-418(type union)、:578(proposal schema)、:626-641(tool docs);opsAgentStream.ts:121-124(stream enum) | 【親核】 |
| O5 | ops agent `askFinanceAdvisor` 全鏈 | 同上各檔:opsActions.ts:38-41、:176-181、:576-581(doAskFinanceAdvisor);opsAgent.ts:416-418、:578、:626-632;opsAgentStream.ts:121 | 【親核】 |
| O6-O9 | accounting.dashboard(:147)/profitAndLoss(:160)/monthlyTrend(:170)/taxSummary(:177) | server/routers/accounting.ts;**client 直讀 rg 零命中(AccountingTab 實讀 plaid.profitLossReport:193/:201 與 plaid.profitLossTrend:206,v3 錯 caller 更正)** | 【親核】 |
| O10 | TaxDetail 未裁稅務計算區 | TaxDetail.tsx:86-101 六 query;Schedule C 區 :456-539;1099-NEC 區 :630-670;vendor1099List procedure plaidRouter.ts:2240(reader 僅 TaxDetail.tsx:99);**來源健康時直接渲染 Schedule C 與 1099 稅務產品** | 【親核】 |
| O11 | 稅 CSV 服務本體 | taxCsvService.ts:160-243(generateTaxCsv) | 【盤點】 |

### 1.5 API/UI 缺 dataStatus/completeness/assurance/reasonCode

現況唯一狀態機制=client 端 resolveTileState(cockpitMath.ts:316-331)四態 fail-open(refetch 失敗保留舊值→stale);無 reasonCode/completeness/assurance/per-source as-of;server 回裸數字。

| # | 位置 | 缺口 | 證據 |
|---|------|------|------|
| U1 | FinanceCockpit/WorkColumn.tsx:28 | `allClear = pendingCount===0 && recogCount===0 && !data.isLoading` 不查 isError;counts 經 useCockpitData.ts:80-81 `?? 0` 歸零 → 假綠勾 | 【親核】 |
| U2 | useCockpitData.ts:83 | 頁級 asOf=四 query dataUpdatedAt 取 max(index.tsx:85-89 render 單一時間戳) | 【盤點】 |
| U3 | useCockpitData.ts:86 | 頁級 isError=四查全錯才算(`&&`) | 【盤點】 |
| U4 | ProfitLossV2.tsx | 只有 isLoading 分支(:280/:288/:303/:313/:323),失敗 `r?.income.total ?? 0`(:277)render $0 | 【盤點】 |
| U5 | TrustComplianceV2.tsx | 三查詢(:112/:115/:124)只有 isLoading 分支 | 【盤點】 |
| U6 | admin/PendingClaimsTab.tsx:44 | 只解構 `{data,isLoading}` | 【盤點】 |
| U7 | RecognitionCard.tsx:52 | `count===0 → return null`,error 折 0 → 整卡消失 | 【盤點】 |
| U8 | AutoHandledCard.tsx:92、cockpitMath.ts:186/:242 | `parseFloat(...) || 0` | 【盤點】 |
| U9 | mobile/KpiStrip.tsx:46-52 | 七個值全 `?? 0`(income/expenses/net/growth/needsReviewCount/trustDeferred/**ytdNet:52**),error 顯示假 $0 | 【親核】 |
| U10 | client/src/_core/serviceWorker.ts:37-50 | SW 更新 silent(「For now silent」),無 force reload/版本閘 | 【親核】 |

好反例(沿用):TruthRow per-tile state(:61)、TaxDetail per-query error 分支、selectOperatingBalance null→「尚未連結」(cockpitMath.ts:54)。

### 1.6 invoice/AP 缺口

- 供應商 invoice 表/AP ledger/payment allocation 表/應付狀態機:全 schema 零命中(`supplierInvoice|accountsPayable|payableLedger|apLedger|vendorBill|paymentAllocation`)【盤點】。
- invoices(schema.ts:2169)=客戶發票,status enum draft/sent/paid/overdue/cancelled(:2188)無 partial;suppliers(:3389)零財務欄;供應商付款唯一系統紀錄=事後分類 cogs_tour(accountingAgent.ts:32)。
- overpaid/overpayment server 零命中;收款側 allocation(bankTransactionLinkEngine.ts:259、:464 AllocationExceededError)無 idempotency key,unlink 硬 DELETE(bankTransactionLinks.ts:394-396【親核】),schema 無 reversedAt。

### 1.7 currency 現況(九處全鏈)

C1 plaidSyncService.ts:98、C2 :164(txn ingest `?? "USD"`);C3 plaidRouter.ts:212、C4 :496(帳戶/CSV 路);C5 plaidWebhook.ts:397(餘額 `?? "USD"`);C6 bankCsvImportService.ts:45、:151(硬編 "USD");C7 accountingAgentService.ts:225(讀取層 `?? "USD"`);C8 trustDeferralService.ts:423(**ingest 路**:processTrustInflow db.insert values 內 `?? "USD"`,:416-425 親核;§7.2 裁改 `?? "XXX"`,非讀取死碼);**C9 stripeWebhook.ts:314 `(session.currency ?? "usd").toUpperCase()` 寫入 deferStripeBookingIncome【親核】——recognized trust income 進 bank P&L,而 recognizedTrustIncomeInPeriod 讀回時不帶 currency 進 fold**。另 generateBankPL select 不取 isoCurrencyCode(:173-187)、fold parseFloat 直加(:293)、financeKpi 硬編 "USD"(plaidRouter:1498)。

### 1.8 月結/權限/audit/flag/測試基建現況

- 月結結構零命中(close/period/snapshot grep)【盤點】。
- 權限:adminProcedure 單一 role 比對(trpc.ts:37)+mutation rate-limit(:45-56);**零 re-auth/step-up**;auth 棧=email+password(server/auth.ts bcrypt :21;server/routers/auth.ts 9 procedures,login:95;auth.ts 內 "google" 僅 reCAPTCHA :190【親核】)。**Jeff 帳號是否有可用 password hash 未證——不得由 code 推斷,見 §八.4 preflight**。
- audit:adminAuditLog(schema.ts:2528)SHA-256 hash chain(:2559-2560);audit()/systemAudit()(auditLog.ts:249/:315)。
- Trust gate 凍結原樣:trustTransferWriteGate.ts:18-20 硬 false【親核】;trustTransferDetection.ts:345 強制 dry-run、:576-582 backfill 拒;端點 403(trustTransferDetectEndpoint.ts:50-52);scanRecognitionDue propose-only、:680 DB 不可用 throw(全庫唯一 fail-closed 正例)。
- flags:featureFlags.ts:30 PLAID_TRUST_DEFERRAL_ENABLED、:130 STRIPE_TRUST_DEFERRAL_ENABLED;isTrustDeferralEnabled(建列)/isAnyTrustDeferralEnabled(掃描查詢)分工(trustDeferralService.ts:71/:88)。
- 測試基建:vitest+jsdom only(package.json:96/:177),**vitest.config.ts:18-23 include 僅 `server/**/*.{test,spec}.ts` 與 `client/**/*.{test,spec}.ts`——`.test.tsx` 不被收集**【親核】;無 MSW/@testing-library;component 先例=renderToStaticMarkup(customerRowLayout.test.ts);hooks=.husky/{pre-commit,pre-push};白名單先例=TRUST_OPERATING_ACCOUNT_MASKS(trustTransferDetection.ts:85)。

## 二、canonical financeTruthService 邊界

新模組=唯一算數層:UI、tRPC、稅 CSV、ZIP 全部經它;它不擁有資料,只擁有口徑+狀態封套。邊界內:封套、fail-closed、三出口單一 fold、currency guard、AP 數學。邊界外(不納入):Trust gate 全鏈(凍結)、律師軸數值(槽 3b 恆 not-computable+RC-LAW)、payment_attempt/outbox/退款 ledger(Batch 1/saga)、月結 close 流(設計稿 §八A future;periodStatus 恆 "open")、financialReportService 終局=**永久錄入-only**(§四.4)。

## 三、1A0a client-compat(第一個 deployment gate)

### 3.1 目標

**既有財務 server 行為零變更**;所有財務 query 消費端先具備誠實 error/blocked/stale 呈現;取得 Jeff browser/PWA 換版證明。唯一 server 面新增=clientBoot telemetry(additive 新 router+audit 寫入,§3.2.9;不觸碰任何既有財務 procedure/service)。

### 3.2 改造清單(除 3.2.9 telemetry server 件外全 client)

1. mobile/KpiStrip.tsx:46-52 七個 `?? 0` 全撤,改 per-query state(error→「無法核實」卡;loading→骨架;stale→badge);DailyCheckMobile.tsx(transactionsList:47)、BankTriagePage.tsx(:60)補 isError 分支。
2. useCockpitData.ts:逐 query state 傳遞,廢頁級 max asOf(:83)與四錯才 error(:86);counts `?? 0`(:80-81)撤。
3. WorkColumn.tsx:28 allClear 公式改 §七.3(任一 error/loading/stale 即 false)。
4. TruthRow/PLCard/TrustCard/RecognitionCard(error≠消失)/AutoHandledCard(parseFloat||0 撤)/ProfitLossV2/TrustComplianceV2/PendingClaimsTab(isError 分支)/LedgerTrust/LedgerTriage/BankLedgerV2:逐 reader 補 error/stale/zero 三態 render(§五.2 配對表逐檔)。
5. TaxDetail.tsx:移除 Schedule C 區(:456-539)、1099-NEC 區(:630-670)、yearEndExport 鈕與 mutation(:101),整區改「口徑收斂前停用」卡(**client 先撤 UI,server 端 1A0b 才封 procedure**);vendor1099List/plMonthlyTrend 等 query 呼叫一併移除。
6. CommandCenter/FinanceDashboard.tsx:37-38 兩鈕撤下改停用卡。
7. AdminHome.tsx 五個 MOCK_ 全清(M1-M4),/ops 改純導航卡;AdminFinance.tsx 死碼刪除。
8. AccountingTab.tsx:三個 plaid live readers(profitLossReport:193/:201、profitLossTrend:206)補 error/stale 分支(§5.2 配對表對應施工項;v4 前版漏列,更正)。
9. boot telemetry(換版證明的真實機制;「既有 funnel」假設作廢——repo 只有 server-internal reportFunnelError(server/_core/errorFunnel.ts:115),無 browser 可呼叫端點,且正常 boot 不得冒充 error):

```ts
// server/routers/clientBoot.ts(新)
export const clientBootRouter = router({
  report: adminProcedure                                  // admin-authenticated
    .input(z.object({
      buildSha: z.string().regex(/^[0-9a-f]{7,40}$/),     // closed payload
      clientKind: z.enum(["desktop-browser", "pwa-standalone"]),
    }).strict())                                          // 拒額外欄位/自由文字/PII
    .mutation(async ({ ctx, input }) => { /* 去重+audit,見下 */ }),
});
```

- 儲存與查證:寫入既有 append-only adminAuditLog(audit(),action="clientBoot.report",changes={buildSha, clientKind});**雙裝置證據=audit 列存在 clientKind 兩值且 buildSha=新 sha**,Jeff 授權唯讀查詢可逐裝置核實。
- 去重:同 (userId, buildSha, clientKind) 24h 內已有 audit 列即 no-op;rate limit 沿 adminProcedure 既有 mutation limiter。
- client 掛載與可測 Seam:**整段 orchestration 抽至 client/src/layouts/adminShellBoot.ts(新)並 export,AdminShell.tsx 只接線**(修「helper 有測、承重 orchestration 藏在 AdminShell」缺口):

```ts
export function detectClientKind(matchMediaFn: typeof window.matchMedia): "pwa-standalone" | "desktop-browser";
export function shortBuildSha(sha: string): string;                       // footer 顯示值唯一切法來源
export async function reportBootOnce(deps: {
  storage: Pick<Storage, "getItem" | "setItem">;                          // per-SHA guard(key 含 sha)
  buildSha: string;
  matchMediaFn: typeof window.matchMedia;
  report: (payload: { buildSha: string; clientKind: "pwa-standalone" | "desktop-browser" }) => Promise<unknown>;
}): Promise<"reported" | "skipped" | "failed">;
// 契約:guard 已存在→"skipped" 不呼 report;await report 成功→先寫 guard 再回 "reported";
// report reject→不寫 guard、回 "failed"(下次 mount 可重試)。mutation 之前絕不寫 guard。
```

  AdminShell.tsx useEffect 只呼 `reportBootOnce({storage: sessionStorage, buildSha: __BUILD_SHA__, matchMediaFn, report: mutateAsync})`;footer 渲染 `shortBuildSha(__BUILD_SHA__)`。
- global type:client/src/vite-env.d.ts 宣告 `declare const __BUILD_SHA__: string;`(vite.config.ts define 注入)。
- client 測試(承重 Seam,collectable):client/src/layouts/adminShellBoot.test.ts——以注入 fake storage/report 直測 `reportBootOnce` orchestration:**success 後 guard 才寫入、reject 後 guard 未寫入可重試、mutation 呼叫前 guard 不存在、guard 已存在時不呼 report("skipped")**、新 sha 重報、兩種 clientKind 判定、exact payload 形狀、`shortBuildSha` 切法(footer 值同源斷言)。

10. i18n:client/src/i18n/zh-TW.ts、client/src/i18n/en.ts 補狀態文案 key。

### 3.3 1A0a 固定 production 檔案清單

client/src/components/mobile/{KpiStrip.tsx, DailyCheckMobile.tsx, BankTriagePage.tsx};client/src/components/admin-v2/FinanceCockpit/{useCockpitData.ts, cockpitMath.ts, types.ts, index.tsx, TruthRow.tsx, WorkColumn.tsx, PLCard.tsx, TrustCard.tsx, RecognitionCard.tsx, AutoHandledCard.tsx, TaxDetail.tsx, **PendingClaimsCard.tsx(nullable 修改+stale;v4.2 前版漏列,Codex 7-18 P1-8 更正補入)**};client/src/components/admin-v2/{ProfitLossV2.tsx, TrustComplianceV2.tsx, BankLedgerV2.tsx};client/src/components/admin/{AccountingTab.tsx, PendingClaimsTab.tsx};client/src/components/admin-v2/CommandCenter/FinanceDashboard.tsx;client/src/components/workspace/{LedgerTrust.tsx, LedgerTriage.tsx};client/src/pages/AdminHome.tsx;client/src/pages/AdminFinance.tsx(刪);client/src/App.tsx(AdminFinance import 移除);client/src/layouts/AdminShell.tsx(boot 接線+footer sha);client/src/layouts/adminShellBoot.ts(新,純 helper Seam);client/src/vite-env.d.ts(__BUILD_SHA__ 宣告);server/routers/clientBoot.ts(新,boot telemetry);server/routers.ts(mount clientBoot);client/src/i18n/{zh-TW.ts, en.ts};vite.config.ts(define __BUILD_SHA__);**Dockerfile(ARG GIT_SHA);scripts/safe-deploy.mjs+scripts/safe-deploy.test.mjs(build-arg GIT_SHA 傳入+exact sha 測試,Codex 7-18 P1-1;15:56 窄修4 加真產物契約:依 .dockerignore 複製無 .git context 實跑 pnpm build,dist/public 掃 exact 40-hex —— 註解停用 ARG/ENV 或 vite 強制 unknown 均親跑紅→還原綠)**;.husky/pre-push+package.json+scripts/check-no-mock.mjs(CI grep gate)。
測試檔(vitest 可收集,全 `.test.ts`):client/src/components/admin-v2/FinanceCockpit/cockpitState.test.ts(純 adapter:state 折疊/allClear 公式)、**client/src/components/admin-v2/FinanceCockpit/cockpitMath.test.ts(現有檔,:150-163 逐字鎖 "error" 的期望隨 TileState 遷移同批改 "transport-error",§6.1)**、client/src/components/mobile/kpiStripState.test.ts(七值 state 折疊)、client/src/components/admin-v2/financePagesRender.test.ts(renderToStaticMarkup+mocked hook:各頁 error/stale/zero render 斷言,含 AccountingTab)、server/routers/clientBoot.test.ts(closed payload 拒自由文字/額外欄位、24h best-effort 去重+併發兩列、durable ack re-query、rate-limit denied regression、DB skipped、audit 列寫入;15:56 窄修5 改真 predicate 評估:MySqlDialect 渲染 production where 對 in-memory rows 求值,實際模擬 insert 成功+hash update 失敗→failed、rowHash-null 孤列不擋 dedup、eq/gte/like 逐條承重 —— 移除 isNotNull 或 findRow(true)→false 均親跑紅→還原綠)、client/src/components/mobile/bankTriageInteraction.test.ts(jsdom 真事件+mutation spy:fresh 四路徑 exact payload 對照組+cached-stale 四路徑零呼叫、被擋不 advance、跳過非寫入 —— 移除 performTriageWrite guard 親跑紅→還原綠)、client/src/layouts/adminShellBoot.test.ts(client 承重 orchestration Seam,規格見 §3.2.9;只認 reported|deduped 才寫 guard)、client/src/pages/adminHomeRender.test.ts(四 href 含 /workspace、零 nested anchor、零 $ 金額)、financePagesRender.test.ts 擴 TaxDetail/TrustComplianceV2/ProfitLossV2 cold-error render(無 $0、有錯誤文案)、client/src/components/admin-v2/financeReadersRender.test.ts + financeConsumersRender.test.ts(**承重驗收 criterion(不縮小 12:05 裁定):目標每個 production consumer 鎖 cold-error / cached-stale / true-zero 三態。逐 consumer 實際覆蓋(誠實表,含殘留與理由)**:

| consumer | cold | stale | zero | 備註 |
|----------|:--:|:--:|:--:|------|
| KpiStrip / TrustCard / PLCard / PendingClaimsCard / BankLedgerV2 / TrustComplianceV2 / RecognitionCard / AutoHandledCard / PendingClaimsTab / LedgerTriage / LedgerTrust / ProfitLossV2 | ✓ | ✓ | ✓ | 三態齊;TrustCard 另獨立釘 state token;BankLedgerV2 另測 cached-empty stale counts 全「–」+不落 clean EmptyState/「暫無資料」(15:56 P1-1);ProfitLossV2 stale/zero 補於 financeConsumersRender(15:56 P1-3) |
| BankTriagePage | ✓ | ✓(禁寫 lock) | ✓(全部清完) | staleWriteBlocked banner 親跑突變紅→綠;shouldBlockTriageWrite 純函式單元測試(cold/stale/fresh);**15:56 P1-3 補 bankTriageInteraction.test.ts(jsdom):真 touch/click 事件+mutation spy,stale 四路徑零呼叫、fresh 四路徑 exact payload、被擋不 advance、stale 跳過後不顯「全部清完」—— 移除 performTriageWrite guard 親跑紅(swipe 兩測)→還原綠** |
| AccountingTab | ✓(plUnverifiable 專屬 key,親跑紅→綠) | ✓ | ✓ | 舊「多 query shape 互斥」殘留已由 financeConsumersRender 的 per-procedure 狀態表清除(15:56 P1-2/P1-3):逐 procedure 給正確 shape,true-zero(真「沒有趨勢資料」)、plTrend cached-empty stale(staleHint 且不得同顯 clean 零態)、P&L cached-stale 三案齊 |
| DailyCheckMobile | ✓ | ✓ | ✓ | 舊「三 query shape 互斥」殘留已由 per-procedure 狀態表清除(15:56 P1-3):cold(「– 筆」不寫 0)、true-zero(activityEmpty+「0 筆」)、txns cached-stale(保留 review pile)、activity cached-stale(保留 cached rows)四案齊 |
| FinanceDashboard | ✓(停用卡) | N/A | N/A | 已改停用卡(§3.2),無 stale/zero 數值態 |
| TaxDetail(頁) | ✓ | ✓ | ✓ | 舊「四 query 不同 shape」殘留已由 per-procedure 狀態表清除(15:56 P1-3):同 procedure 依 input(startDate 年份)分流 cur/prev 兩個 profitLossReport;true-zero(真 $0)、cur cached-stale(舊值+staleHint)、prev cached-stale(prevUnverifiable、不把 stale growth 當 current)三案齊 |

殘留清零(2026-07-18 15:56 窄修後):前版所稱「多 query 不同 shape + SSR 全渲染」結構限制,實際由 financeConsumersRender.test.ts 的 per-procedure 狀態表解掉(逐 procedure 登記正確 shape、同 procedure 依 input 分流),不成立為殘留理由。本表所有 stateful production consumer 均達 cold / cached-stale / true-zero 三態,BankTriage 另有 jsdom 真事件禁寫互動 regression —— 12:05「不縮小」criterion 全額恢復,無例外。

### 3.4 1A0a 驗收與換版證明(1A0b 的硬前置)

- 全部 §3.3 測試綠+`rg "MOCK_" client/src --glob '!**/preview/**'` 零命中+`rg "\?\? 0|\|\| 0" 於 §3.3 finance 消費檔` 白名單外零命中。
- 部署(Jeff pnpm ship)後:adminAuditLog 存在 action="clientBoot.report"、buildSha=新 sha 的兩列,clientKind 分別為 desktop-browser 與 pwa-standalone(Jeff 的兩個裝置),且 footer 短 sha 由 Jeff 口頭確認——**兩證齊才開 1A0b**;不得以「既有 error UI」或「既有 funnel」假設代替。

## 四、1A0b server-block(第二個 deployment gate)

### 4.1 封鎖語意

tRPC 出口:`throw TRPCError({ code: "PRECONDITION_FAILED", message: "finance.blockedPending" })`。agent 出口:**非 tRPC**——proposal/stream schema 移除 action(LLM 無法提案)+**executor 入口 denylist Adapter(§4.2 E4/E5 三段解析;switch 不保留 legacy case)**回固定拒絕 `{ ok:false, summary:"財務口徑收斂前停用", error:"blocked" }`(縱深);underlying service 入口 throw。健康來源同樣封鎖。

### 4.2 E-matrix(封鎖面+各自黑箱預期)

| # | 入口 | 施工位置 | 黑箱預期(健康 fixture) |
|---|------|----------|------------------------|
| E1 | plaid.yearEndExport | plaidRouter.ts:1512 | tRPC PRECONDITION_FAILED |
| E2 | commandCenter.downloadTaxCsv | commandCenter.ts:693-703 | 同上 |
| E3 | commandCenter.askFinanceAdvisor | commandCenter.ts:678-685 | 同上 |
| E4 | ops agent downloadTaxCsv | denylist Adapter(見下);opsActions.ts:38-41 自 ACTION_TYPES 移除、:636-657 函式刪除;opsAgent.ts:416-418/:578/:626-641 移除;opsAgentStream.ts:121-124 移除 | proposal schema 無此 action;executor 公開 Seam 傳 raw 字串得固定拒絕物件(**非 TRPC error**) |
| E5 | ops agent askFinanceAdvisor | 同 E4 denylist+各檔(:576-581 函式刪除);financeAdvisor.ts askFinanceAdvisor 函式頭 throw | 同 E4 型拒絕;直呼 financeAdvisor throw |

E4/E5 executor Adapter(修 v4 前版 TypeScript 矛盾——自 ActionType union 移除後 switch 不可能保留 case):

```ts
// opsActions.ts:executeOpsAction 入口改收 raw string,三段解析
const BLOCKED_LEGACY_ACTIONS = ["askFinanceAdvisor", "downloadTaxCsv"] as const;
type BlockedLegacyAction = (typeof BLOCKED_LEGACY_ACTIONS)[number];
export async function executeOpsAction(rawActionType: string, args: unknown): Promise<ExecutionResult> {
  if ((BLOCKED_LEGACY_ACTIONS as readonly string[]).includes(rawActionType))
    return { ok: false, summary: "財務口徑收斂前停用", error: "blocked" };   // runtime 拒絕,不進 ActionType
  const parsed = ActionTypeEnum.safeParse(rawActionType);
  if (!parsed.success) return { ok: false, summary: "未知動作", error: "unknown-action" };
  switch (parsed.data) { /* active actions,union 已不含兩 legacy 值 */ }
}
```
| E6-E9 | accounting.dashboard/:147、profitAndLoss/:160、monthlyTrend/:170、taxSummary/:177 | accounting.ts | tRPC PRECONDITION_FAILED(client 直讀 0,無 UI 配對工作) |
| E10 | plaid.vendor1099List | plaidRouter.ts:2240 | tRPC PRECONDITION_FAILED(UI 已於 1A0a 撤) |
| E11 | plaid.auditExclusionList 假空 | plaidRouter.ts:2141-2156 | `!db` → throw(功能保留:出的是排除清單原始列非稅值) |
| E12 | taxCsvService.generateTaxCsv | taxCsvService.ts:160 函式頭 throw | 任何 caller 直呼 throw(縱深,E2/E4 之下) |

### 4.3 fail-open 守門改 throw(同批)

F1/F2 catch 刪除 rethrow;F3 四支 `if(!db)` 改 throw(向 scanRecognitionDue :680 正例看齊);F4 emptyReport 守門改 throw;F5 八處 `if(!db) return 空` 改 throw;F6 見 E11。procedure→readers 配對(§五.2)已於 1A0a 鋪好 error render,本批只驗 regression。agent 側:financeAlertProducer/opsTools 隨 generateBankPL rethrow 自然 fail-closed,regression 斷言 alert/tool 回「無法核實」非假數。

### 4.4 1A0b 固定 production 檔案清單

server/routers/{plaidRouter.ts, commandCenter.ts, accounting.ts};server/services/{bankPLService.ts, trustDeferralService.ts, taxCsvService.ts};server/agents/autonomous/{opsActions.ts, opsAgent.ts, opsAgentStream.ts, financeAdvisor.ts};**同批必改的三個現有測試檔(現斷言成功,封鎖後必轉紅,改鎖 blocked/throw):server/agents/autonomous/opsActions.test.ts(兩 action 成功斷言→denylist 拒絕)、server/agents/autonomous/financeAdvisor.test.ts(advisor 回答斷言→throw)、server/services/taxCsvService.test.ts(CSV 成功斷言→throw)**。
測試檔:server/services/financeFailClosed.test.ts(F1-F6:trust lookup throw→generateBankPL rejects 等)、server/routers/financeBlocked.test.ts(E1-E3/E6-E11 逐入口 PRECONDITION_FAILED+E11 !db throw)、server/agents/autonomous/opsActionsBlocked.test.ts(E4/E5:兩 proposal schema 零可提案+公開 executor Seam 傳兩 legacy raw 字串各得固定拒絕+未知字串得 unknown-action)、server/services/taxCsvBlocked.test.ts(**E12 direct-call regression:generateTaxCsv 直呼 throw,不靠 E2/E4 間接覆蓋;financeAdvisor.askFinanceAdvisor 直呼 throw 同檔**)。

## 五、五類 caller graph(逐檔 rg 可重現)

分類:procedure owner/direct caller/invalidator/comment-only/UI renderer。

### 5.1 financeKpi

| 類 | 檔:行 |
|----|--------|
| owner | plaidRouter.ts:1440 |
| direct caller | useCockpitData.ts:27;mobile/KpiStrip.tsx:44 |
| invalidator | RecognitionCard.tsx:35;BankLedgerV2.tsx:311,:624;DailyCheckMobile.tsx:56;BankTriagePage.tsx:68 |
| comment-only | PLCard.tsx:4-10(實讀 profitLossReport:42,需 byCategory shape,不得硬接 KPI) |
| UI renderer | TruthRow.tsx、WorkColumn.tsx(經 CockpitData props) |

### 5.2 procedure→live readers 完整配對(1A0a UI 工作面)

| procedure(plaidRouter 行號) | live readers |
|------------------------------|--------------|
| financeKpi(:1440) | useCockpitData.ts:27、KpiStrip.tsx:44 |
| profitLossReport(:1389) | PLCard.tsx:42、ProfitLossV2.tsx:146、AccountingTab.tsx:193/:201、TaxDetail.tsx:86/:90 |
| profitLossTrend(:1411) | AccountingTab.tsx:206 |
| plMonthlyTrend(:2204) | TaxDetail.tsx:94 |
| trustReconciliation(:1854) | useCockpitData.ts:33、LedgerTrust.tsx:18、TrustComplianceV2.tsx:112、TaxDetail.tsx:95 |
| trustDeferredList(:1938) | TrustCard.tsx:43、RecognitionCard.tsx:26、LedgerTrust.tsx:19/:23、TrustComplianceV2.tsx:115、TaxDetail.tsx:98 |
| vendor1099List(:2240) | TaxDetail.tsx:99(1A0a 撤) |
| linkedBankAccounts(:273) | useCockpitData.ts:30、BankLedgerV2.tsx:1561 |
| transactionsList(:898) | BankLedgerV2.tsx:229、LedgerTriage.tsx:36、**DailyCheckMobile.tsx:47、BankTriagePage.tsx:60**(v3 漏列 mobile,更正) |
| transactionAuditHistory(:1166) | BankLedgerV2.tsx:1459 |
| bankTransactionLinks.pendingSummary(bankTransactionLinks.ts:203) | useCockpitData.ts:36 |
| uncategorizedGroups(:1604)、accountingLegacyOverrideAudit(:1690) | client 直讀 0(rg 全庫) |

### 5.3 generateBankPL / generateBankMonthlyTrend

| 類 | 檔:行 |
|----|--------|
| owner | bankPLService.ts:148、:444 |
| direct caller | plaidRouter.ts:1400-1401,:1420-1423,:1458-1462,:2207,:2222;financeAlertProducer.ts:134,:141-142,:183,:187;financeAdvisor.ts:53-54;opsTools.ts:972,:992;taxCsvService.ts:171,:178 |
| comment-only | trustDeferralService.ts:1292,:1368;taxAggregates.ts:6;financialReportService.ts:184 |

## 六、1A1 truth-service tracer(financeKpiV1 一條鏈)

### 6.1 完整型別(自足;TypeScript stub 可直接編譯)

```ts
// server/services/financeTruth/types.ts(新)
export type SourceName = "plaid-bank" | "trust-deferral" | "bank-links" | "supplier-ap";
export type ClosedMetricId =
  | "kpi.month.income" | "kpi.month.expenses" | "kpi.month.netProfit"
  | "kpi.month.needsReviewCount" | "kpi.vsLastMonth.growthPct"
  | "kpi.ytd.trustDeferredIncome" | "kpi.ytd.netProfit";      // 七個;KpiStrip.tsx:52 ytdNet 為第七值(v3 漏,更正)
export type PeriodSpec =
  | { kind: "month"; year: number; month: number }            // LA 曆月
  | { kind: "ytd"; year: number }
  | { kind: "range"; startDate: string; endDate: string };    // YYYY-MM-DD,LA 日界
export type DataStatus = "ready" | "error" | "disconnected" | "not-configured";
// server 端無 loading:已完成的 MetricBatchV1 不可能回「還在載入」的 envelope(I1-I7 無從約束)。
// loading/transport 是 client query 狀態,canonical client-only 型別**固定 export 於
// client/src/components/admin-v2/FinanceCockpit/types.ts(唯一定義處,禁止第二處重宣告)**:
//   export type QueryDisplayState = "loading" | "transport-error" | "stale" | "ready";
// **現行雙型別收掉(1A0a)**:cockpitMath.ts:316 `TileState = "loading"|"error"|"stale"|"ready"` 刪除、
// 改 `export type TileState = QueryDisplayState`(過渡 alias,1A1 前清光引用後刪);resolveTileState(:323-331)
// 回值 "error" 改 "transport-error";types.ts:9-11 反向 re-export 改為自 types.ts 正向輸出。
// cockpitMath.test.ts:150-163 逐字鎖 "error" 的期望同批更正(納入 §3.3 fixed tests)。
// 設計稿 §三 dataStatus 含 loading 不改(Phase 0 凍結):server DataStatus 是其 server 子集,loading 由 client QueryDisplayState 承載,語意分層聲明。
export type Completeness = "complete" | "partial" | "empty-filter" | "true-zero" | "not-computable" | "unsupported";
export type Assurance = "posted-fact" | "jeff-approved" | "operational" | "suggested" | "unverified-proxy";
export type OperationalReason =
  | "OP-DB-UNAVAILABLE" | "OP-QUERY-FAILED" | "OP-SOURCE-DISCONNECTED"
  | "OP-NOT-CONFIGURED" | "OP-SCOPE-VIOLATION";
export type ReasonCode =                                       // 數字契約 §二 註冊表(凍結,照抄)
  | "RC-LAW" | "RC-CPA" | "RC-BOFA" | "RC-AP" | "RC-MATCH" | "RC-EVENT"
  | "RC-DEDUP" | "RC-PROC" | "RC-FOLD" | "RC-FROZEN" | "RC-CCY";
export type GapReason =
  | "unclaimed-transactions" | "uncategorized-transactions" | "unsynced-account"
  | "missing-supplier-cost" | "source-partial-failure";
export type Unit = "usd-minor" | "count" | "percent-bp";       // 金額=USD cents;百分比=basis points
export interface UnsupportedBucket { currency: string; amountMinorAbs: string; count: number; }  // string 承載 BIGINT
export interface SourceStamp { name: SourceName; asOf: string | null; }   // ISO;null=該源 not-computable
export interface Coverage { numeratorDesc: string; denominatorDesc: string; gapReason: GapReason | null; }
export interface Lineage { components: { source: SourceName; assurance: Assurance }[]; }
export interface MetricEnvelope<T> {
  value: T | null;                       // 不變量 I1-I4 見 §六.2
  unit: Unit;
  dataStatus: DataStatus;
  completeness: Completeness;
  assurance: Assurance | null;           // 合成=組成最低;not-computable 時 null
  reasonCodes: ReasonCode[];             // 業務未定格
  operationalReason: OperationalReason | null;  // 技術失敗;與 reasonCodes 分軸
  sources: SourceStamp[];
  coverage: Coverage | null;
  lineage: Lineage | null;
  freshness: "fresh" | "stale";
  periodStatus: "open";                  // 月結 future;Phase 1 恆 open
  closedEligible: false;                 // Phase 1 恆 false(關帳未建)
  taxEligible: false;                    // CPA 矩陣前恆 false
  unsupportedBuckets: UnsupportedBucket[];
  scope: { accountIds: number[]; masks: string[] } | null;    // §七.1
}
export interface MetricBatchV1 {
  contractVersion: 1;
  asOfServer: string;
  metrics: Partial<Record<ClosedMetricId, MetricEnvelope<number>>>;
  // subset 語意:回應 keys === 請求 metricIds 集合,恰好不多不少(runtime 斷言+測試);
  // kpiV1 procedure 固定請求全部七個,故對 kpiV1 而言七 key 必在。
}
export class SourceError extends Error {
  constructor(readonly source: SourceName,
    readonly kind: "db-unavailable" | "query-failed" | "disconnected" | "not-configured" | "scope-violation",
    readonly cause?: unknown) { super(`${source}:${kind}`); }
}
// kind→OperationalReason 一一映射:db-unavailable→OP-DB-UNAVAILABLE、query-failed→OP-QUERY-FAILED、
// disconnected→OP-SOURCE-DISCONNECTED、not-configured→OP-NOT-CONFIGURED、scope-violation→OP-SCOPE-VIOLATION。

// server/services/financeTruth/normalized.ts(新)
export interface NormalizedTxnRow {                     // A 層原始列的正規化投影(不改資料)
  bankTransactionId: number;
  accountId: number;
  amountMinorSigned: string;                            // 正=流出(schema.ts:3160-3161 慣例保留)
  currency: string;                                     // 原樣;缺值已於 ingest 標 "XXX"
  dateLA: string;                                       // YYYY-MM-DD(monthKeyOfDate 同源)
  effectiveCategory: string | null;                     // jeffOverride ?? agent
  categoryTier: "jeff-approved" | "suggested" | "unclassified";
  excluded: boolean; pending: boolean;
}
export interface NormalizedFinancePeriod {
  period: PeriodSpec;
  scope: { accountIds: number[]; masks: string[] };
  rows: NormalizedTxnRow[];                             // USD 列
  unsupportedRows: NormalizedTxnRow[];                  // 非 USD/XXX 列(顯性桶)
  deferral: { deferredMinor: string; recognizedMinor: string; sources: SourceStamp[] };
  sources: SourceStamp[];
}

// server/services/financeTruth/views.ts(新)
export interface ManagementPLLine { category: string; tier: "jeff-approved" | "suggested"; amountMinor: string; }
export interface ManagementPLView {
  incomeMinor: string; cogsMinor: string; operatingMinor: string; netMinor: string;
  byCategory: ManagementPLLine[];                       // PLCard byCategory shape 由此供給
  unsupportedBuckets: UnsupportedBucket[];
}
export interface ManagementTrendPoint { monthKey: string; incomeMinor: string; expensesMinor: string; netMinor: string; }
export interface ManagementTrendView { points: ManagementTrendPoint[]; unsupportedBuckets: UnsupportedBucket[]; }
export interface BankEvidenceExport {                   // raw evidence,零推導稅值
  rowsCsv: string;                                      // 原始列+lineage 欄
  manifest: { rowCount: number; periodDesc: string; generatedAt: string; disclaimer: "NOT-CPA-READY" };
}
```

### 6.2 envelope 不變量(測試逐條釘死)

- I1 `value !== null ⇔ completeness ∈ {complete, partial, true-zero, empty-filter}`。
- I2 `completeness === "true-zero" ⇒ value === 0`。
- I3 `completeness === "unsupported" ⇒ unsupportedBuckets.length > 0`(逐 currency)。
- I4 `completeness === "partial" ⇒ coverage !== null && coverage.gapReason !== null`。
- I5 `dataStatus ∈ {error, disconnected, not-configured} ⇒ operationalReason !== null && value === null`。
- I6 assurance=組成最低(enum 有序);任一組成 not-computable ⇒ 整體 not-computable。
- I7 業務 reasonCodes 不得表達技術失敗(RC-FROZEN≠查詢失敗;分軸 operationalReason)。

### 6.3 五個 public Interface 與 Seam

```ts
// server/services/financeTruth/sourceAdapters.ts(新)
export interface FinanceSourceAdapter<Q, R> { readonly name: SourceName; fetch(query: Q): Promise<R>; }  // 只取數;失敗 throw SourceError
// server/services/financeTruth/index.ts(新)
export interface FinanceTruthService {
  getMetrics(req: { metricIds: ClosedMetricId[]; period: PeriodSpec }): Promise<MetricBatchV1>;
  getNormalizedPeriod(period: PeriodSpec): Promise<MetricEnvelope<NormalizedFinancePeriod>>;
}
// server/services/financeTruth/managementAdapter.ts(新)
export interface ManagementProjectionAdapter {
  projectPL(n: NormalizedFinancePeriod): ManagementPLView;              // 純函式,禁 IO
  projectTrend(ns: NormalizedFinancePeriod[]): ManagementTrendView;
}
// server/services/financeTruth/taxAdapter.ts(新)
export interface TaxProjectionAdapter { project(n: NormalizedFinancePeriod): MetricEnvelope<never>; }  // 恆 not-computable+RC-CPA,型別上不可回數
// server/services/financeTruth/rawEvidenceAdapter.ts(新)
export interface RawEvidenceAdapter { exportBankEvidence(period: PeriodSpec, n: NormalizedFinancePeriod): BankEvidenceExport; }
```

- source 實作檔:server/services/financeTruth/sources/{plaidBankSource.ts, trustDeferralSource.ts, bankLinksSource.ts}(1A1)、supplierApSource.ts(1C1)。
- Seam:`createFinanceTruthService(deps: { sources... })` constructor 注入;tRPC 經單例工廠;測試注入 fake adapters(拋各型 SourceError/回 fixture),不需 MSW。
- 掛載:新 server/routers/financeTruth.ts → server/routers.ts 固定一行 mount(非條件式)。
- bankPLService thin-wrapper 終止條件:1B 內五個 direct-caller 檔(§5.3)全改呼 truth service+regression 綠後,`rg "generateBankPL" server` 僅剩 wrapper 自身與測試 → 同批刪 wrapper;不跨批存活。

### 6.4 financeKpiV1 rollout

- 新 procedure `financeTruth.kpiV1`:無 input,固定請求七個 id,回 MetricBatchV1(單次 polling 取代多次)。
- 舊 plaid.financeKpi:1A0b 起 fail-closed;funnel 計數舊 endpoint 命中;**連續 7 天零命中 → 下一批刪除**。
- 測試:unknown/missing contractVersion → client 顯示升級提示不 render 數字;subset 斷言(回應 keys===請求集合);舊 endpoint 命中 PRECONDITION_FAILED。
- 換版風險已由 1A0a/1A0b 拆批消化(client 先會顯示 error,才封 server);不再宣稱「舊 bundle 有既有 error UI」。

### 6.5 1A1 固定 production 檔案清單

server/services/financeTruth/{types.ts, normalized.ts, views.ts, sourceAdapters.ts, index.ts, sources/plaidBankSource.ts, sources/trustDeferralSource.ts, sources/bankLinksSource.ts}(新);server/routers/financeTruth.ts(新);server/routers.ts(mount);client/src/components/admin-v2/FinanceCockpit/{useCockpitData.ts, types.ts}(financeKpi→kpiV1);client/src/components/mobile/KpiStrip.tsx(kpiV1);client/src/i18n/{zh-TW.ts, en.ts}。
測試:server/services/financeTruth/envelope.test.ts(I1-I7)、server/services/financeTruth/kpiV1.test.ts(subset/七 id/SourceError 映射)、client/src/components/admin-v2/FinanceCockpit/kpiV1Adapter.test.ts。

## 七、company scope、currency、client 語意

### 7.1 company scope(fail-closed 白名單)

沿 TRUST_OPERATING_ACCOUNT_MASKS(trustTransferDetection.ts:85)先例:新 env `FINANCE_OPERATING_ACCOUNT_MASKS`(operating 白名單)+trust 集合=isTrustAccount=1。isActive=1 帳戶必屬兩集合之一;**任一不屬、或 mask 重複/模糊匹配 → SourceError("plaid-bank","scope-violation") → 全部 metrics not-computable+OP-SCOPE-VIOLATION**;envelope.scope 列 accountIds+masks。個人帳戶接入即 fail-closed,無需 membership migration。

### 7.2 currency 九處裁定

| # | 位置 | 裁定 |
|---|------|------|
| C1/C2 | plaidSyncService.ts:98/:164 | `?? "XXX"`(unsupported 桶) |
| C3/C4 | plaidRouter.ts:212/:496 | `?? "XXX"` |
| C5 | plaidWebhook.ts:397 | `?? "XXX"` |
| C6 | bankCsvImportService.ts:45/:151 | 保留 "USD",標「來源證明 USD」(BofA 月結單 CSV,帳戶幣別 USD 正本親證;檔頭加註前提:未來非 BofA CSV 必帶幣別欄) |
| C7 | accountingAgentService.ts:225 | 讀取層 fallback=死碼(欄 NOT NULL default "USD",schema.ts:3165),刪除;讀取層永不造幣別 |
| C8 | trustDeferralService.ts:423 | **ingest 路(processTrustInflow 的 db.insert values 內,:416-425 親核;v4.1 前版誤判「讀取層死碼」,更正)**:改 `?? "XXX"` 寫入 unsupported 幣別,不預設 USD |
| C9 | stripeWebhook.ts:314 | `session.currency` 缺值 → "XXX"(不造 "usd");deferStripeBookingIncome 儲存幣別;**recognized 讀回兩路都帶 currency**:①recognizedTrustIncomeInPeriod(期間路)②monthlyDeferralAdjustments+foldMonthlyDeferralAdjustments(:1405/:1374,月趨勢與稅 CSV 路)——非 USD recognized 一律入 unsupported 桶不入 income/加回 |

fold 層:generateBankPL select 取 isoCurrencyCode,非 USD/XXX 全部 unsupported 桶(1B);financeKpi 硬編 "USD"(plaidRouter:1498)由 kpiV1 envelope unit 取代。

### 7.3 client Adapter 語意與 allClear

- `query.isError && !query.data` → transport-error(重試 UI)。
- `query.isError && query.data` → 呈現 cached envelope+強制 stale badge。
- background refetch 不遮既有好值(isFetching 僅小 spinner)。
- **WorkColumn allClear 的兩個依賴不是 KPI envelope**。唯一來源裁定(修 v4 前版混軸):pendingCount=bankTransactionLinks.pendingSummary(bankTransactionLinks.ts:203);departedPendingCount=**trustReconciliation 一源**(現行事實 useCockpitData.ts:33/:81 親核;trustDeferredList 非 count 來源,不混入)。1A0a 建 client-state Adapter:

```ts
import type { QueryDisplayState } from "./types";          // §6.1 唯一定義,復用不重宣告
type WorkSourceState = { state: QueryDisplayState; count: number | null };   // "transport-error" 非 "error"
// 四態互斥;state==="ready" 明確蘊含 fresh:dataUpdatedAt 距今 ≤ 該源 FRESH_MAX_AGE 且最近 fetch 成功;
// 超齡(含 refetch 失敗留舊值)=「stale」。freshness 門檻寫死(cockpitMath.ts 常數,=2×現行輪詢間隔,親核值):
//   FRESH_MAX_AGE.pendingSummary       = 600_000  // PENDING_POLL_MS=300_000(useCockpitData.ts:24/:37)
//   FRESH_MAX_AGE.trustReconciliation  = 240_000  // KPI_POLL_MS=120_000(useCockpitData.ts:23/:34)
function deriveWorkState(pendingQ: QueryLike, reconQ: QueryLike, nowMs: number): { pending: WorkSourceState; recog: WorkSourceState };
const allClear = pending.state === "ready" && recog.state === "ready" && pending.count === 0 && recog.count === 0;
// 任一 loading/transport-error/stale/count>0/count===null → false。
```

  逐態測試(loading/transport-error/stale/zero/non-zero × 兩源全組合)+**freshness 邊界測試三點**(契約 `age <= threshold → ready`:age = 門檻−1ms → ready;**age === 門檻 → ready(等號案,錯寫 `<` 即紅)**;age = 門檻+1ms → stale;pendingSummary 與 trustReconciliation 兩源各測三點)。正常輪詢下 age 恆 < 門檻,allClear 不會被門檻誤壓 false。兩源是否納入版本化 envelope 留 1A1 後評估,不阻塞。

## 八、AP contracts(1C0/1C1/1C2)

### 8.1 migration 批次(additive-only,tracked)

- 1C0:financeEvents+reAuthGrants(drizzle/schema.ts+drizzle/0117_finance_events_reauth.sql+meta/_journal.json+meta/0117_snapshot.json;序號以施工時 journal 下一號為準,下同)。
- 1C1:supplierInvoices+supplierInvoiceEvents+supplierInvoiceLines(0118_supplier_invoices.sql+journal+snapshot)。
- 1C2:supplierInvoicePaymentAllocations+supplierApAllocationReversals **兩表**(0119_supplier_ap_allocations.sql+journal+snapshot;修 v4 前版 self-FK 模型——DB 保證歸屬改用獨立 reversal 表,歸屬不重複存)。
- supplierInvoicePaymentAllocations DDL:id BIGINT PK;invoiceId BIGINT NOT NULL FK→supplierInvoices;bankTransactionId INT NOT NULL FK→bankTransactions;amountMinor BIGINT NOT NULL CHECK(amountMinor>0);seq INT NOT NULL;idempotencyKey VARCHAR(64) NOT NULL UNIQUE;financeEventId BIGINT NOT NULL UNIQUE FK→financeEvents;createdAt;UNIQUE(invoiceId,bankTransactionId,seq)。**無 reversal 欄**。
- supplierApAllocationReversals DDL:id BIGINT PK;allocationId BIGINT NOT NULL FK→supplierInvoicePaymentAllocations(id);amountMinor BIGINT NOT NULL CHECK(amountMinor>0);idempotencyKey VARCHAR(64) NOT NULL UNIQUE;financeEventId BIGINT NOT NULL UNIQUE FK→financeEvents;createdAt;INDEX(allocationId)。
- supplierInvoiceLines DDL(0118 批,exact):id BIGINT PK;invoiceId BIGINT NOT NULL FK→supplierInvoices;lineNo INT NOT NULL;customOrderId INT NULL **FK→customOrders(id)**;bookingId INT NULL **FK→bookings(id)**(不存在的 order/booking id DB 層直接拒);amountMinor BIGINT NOT NULL CHECK(amountMinor>0);UNIQUE(invoiceId,lineNo);**CHECK((customOrderId IS NULL) <> (bookingId IS NULL))**(exactly-one)。
- supplierInvoices 投影欄(0118 批同表):**unassignedRemainderMinor BIGINT NOT NULL DEFAULT 0 CHECK(unassignedRemainderMinor>=0)**(§8.5 依賴的容器由 DDL 落地,負值 DB 層拒)。
- reAuthGrants DDL(0117 批,exact):id BIGINT PK;userId INT NOT NULL **FK→users(id) ON DELETE RESTRICT**(禁 orphan grant);actionScope VARCHAR(32) NOT NULL;tokenHash CHAR(64) NOT NULL UNIQUE;issuedAt TIMESTAMP NOT NULL;expiresAt TIMESTAMP NOT NULL(**TTL=issue+15min**);consumedAt TIMESTAMP NULL;INDEX(userId, actionScope, expiresAt)。**過期列明記保留不清理(audit 保全;repo 現無任何每日 cleanup worker——v4.1 前版「既有每日 worker」為假機制,作廢;未來若需清理=真實 worker+測試另立批)**。

### 8.2 三軸與 canonical 三式(Phase 0 照抄不重開)

document/approval 軸儲存;due 軸派生(dueDate+LA 日界);payment 軸只由 allocation/reversal 推導:`rawRemaining = total − net allocations`;`remainingDue = max(0,rawRemaining)`;`overpaidAmount = max(0,−rawRemaining)`;unpaid/partially_paid/paid/overpaid 由 rawRemaining 對照 total 推導;禁手動布林。guard:同 supplier+invoice number 唯一;幣別一致;正數;超額=overpaid 顯性態;idempotency key;綁 bankTransactionId;**bankTransactions.excludeFromAccounting=1 硬拒**;**已付 invoice 修改只准 reversal;invoice total 的 adjustment 本期(Phase 1 全程)明文禁止——ActionScopeEnum 無對應 scope 即無路徑,未來若需要=新增 `ap.adjust-total` scope 走 contract 版本+獨立批,不得借用其他 scope**。disputed=document 軸狀態,效果=凍結新 allocation,不在 payment 軸。

### 8.3 reversal 唯一模型(本輪選定:獨立 reversal 表,DB 層歸屬保證)

**多筆 reversal 指回 original,存於 supplierApAllocationReversals**(§8.1):
- **歸屬由 DB 機械保證**:reversal 列只存 allocationId(NOT NULL FK),invoice/bank txn 歸屬經 join original 取得、**不重複儲存**——同 invoice/同 bank txn 不可能漂移,cross-invoice/cross-bank reversal 在結構上不存在(v4 前版「僅 server assertion」缺口關閉)。
- **reversal-of-reversal 結構上不可能**:reversals 表無 self-reference 欄,FK 只指 allocations 表。
- Σ(同 allocationId 之 reversals.amountMinor) ≤ original.amountMinor:於 invoice lock transaction 內機械核對(`SELECT original FOR UPDATE` 後驗和);兩筆併發 partial reversal 合計超額 → 恰一成功(黑箱測試 §十)。
- caller input 型別只有 allocationId+amountMinor+idempotencyKey,無 invoice/bank txn 欄。
- canonical 三式改寫為 join 口徑:`net allocations = Σ allocations − Σ reversals(join by allocationId)`,三式本體不變(Phase 0 凍結)。

### 8.4 transition matrix 與 recent-auth 交易

document 軸:

| from \ to | needs_review | approved | disputed | void |
|-----------|--------------|----------|----------|------|
| received | ✓ | ✓(grant) | ✓ | ✓(grant+無 active allocation) |
| needs_review | — | ✓(grant) | ✓ | ✓(grant+無 active allocation) |
| approved | ✗ | — | ✓ | ✓(grant+無 active allocation) |
| disputed | ✗ | ✓(grant) | — | **✓(grant+無 active allocation)**(v3 漏此 guard,補) |
| void(終態) | ✗ | ✗ | ✗ | — |

「無 active allocation」= net allocations(allocations−reversals)=0。

**單一 DB transaction 固定順序(FK 可滿足,financeEvent-first)**:
1. `UPDATE reAuthGrants SET consumedAt=NOW() WHERE tokenHash=? AND userId=? AND actionScope=? AND consumedAt IS NULL AND expiresAt>NOW()`(**userId=ctx.user.id 入原子條件——洩漏 token 不可被其他 admin session 消費;v4 前版漏,補**),affectedRows===1 否則 rollback;
2. `SELECT invoice 投影列 FOR UPDATE`(version 檢查);
3. `INSERT financeEvents`(跨域 control/audit spine);
4. `INSERT supplierInvoiceEvents`(AP domain truth;financeEventId NOT NULL UNIQUE FK→步 3 已存在);
5. 投影列 UPDATE(version+1);
6. COMMIT;任一步失敗全 rollback。

**rollback 測試(逐步注入失敗)**:於步 3/步 4/步 5 各注入失敗 → 斷言 grant 未消費(consumedAt 仍 NULL)、financeEvents/supplierInvoiceEvents/投影零部分列。

replay determinism:投影全部欄位可由 supplierInvoiceEvents 重放推導,property test 斷言 replay===儲存投影。

**reAuth.issue 寫死**:adminProcedure;input `z.object({ password: z.string(), actionScope: ActionScopeEnum }).strict()` 恰二欄;**closed privilege set:`ActionScopeEnum = z.enum(["ap.approve", "ap.void", "ap.allocate", "ap.reverse", "auth.canary"])`**(新 scope=contract 變更走版本);identity 只取 ctx.user(禁止 caller 傳 email/userId);bcrypt 驗證走 server/auth.ts。
**專屬限流(atomic)**:**復用既有單 Lua self-healing 實作 `checkAtomicRateLimit`(server/rateLimit.ts:94,doc :68-93 自述修 checkRateLimit 的 TOCTOU)**——不另造 INCR+EXPIRE 兩操作版本(crash 窗口會留 TTL=-1;v4.1 前版方案作廢);key=`reauth:issue:${ctx.user.id}`,limit=5/window=900s;測試:mocked-Redis burst 20 併發恰 5 過+**TTL=-1 殘留自癒 regression**。
**password capability preflight(1C0 驗收前置)**:repo 同時存在 password 與 Google 登入面,不得由 code 推斷;兩段:①Jeff 授權一次唯讀 prod 查詢證明 Jeff user row password hash 非 null 且 bcrypt 格式;②**Jeff 親自成功完成一次 re-auth canary(actionScope="auth.canary",不綁任何財務動作)**——hash 形狀只證 DB 有值,canary 才證 Jeff 知道密碼。兩段未齊前 reAuth.issue 對財務 scope 部署為 unavailable(PRECONDITION_FAILED);canary 失敗 → Jeff reset password 或另裁 WebAuthn/OTP。

### 8.5 lines contract

- 每行 `customOrderId XOR bookingId` 恰一非 null(**必填,無雙 null 行**;v3 矛盾處更正);UNIQUE(invoiceId, lineNo);amountMinor>0。
- `Σ lines ≤ invoice total`:於 invoice lock transaction 內機械核對(非 row CHECK);差額=invoice 投影欄 `unassignedRemainderMinor ≥ 0` 顯性承載,禁止靜默不平。
- 併發:addLine/removeLine 同走 §8.4 鎖序;雙 line race 測試(兩並發 addLine 合計超 total,恰一成功)。

### 8.6 1C0/1C1/1C2 固定 production 檔案清單

- 1C0:drizzle/schema.ts+0117 migration 三件;server/_core/reAuth.ts(新,含 atomicRateLimit);server/routers/financeAuth.ts(新);server/routers.ts;client/src/components/admin-v2/ReAuthDialog.tsx(新);server/_core/featureFlags.ts;測試 server/_core/reAuth.test.ts(原子消費含 userId 條件/200-way 同 grant 恰一成功/跨 user 消費拒/過期/scope 拒/strict input 拒額外欄/checkAtomicRateLimit 復用:mocked-Redis burst 20 併發恰 5 過+TTL=-1 殘留自癒/步 3-5 注入失敗 rollback 斷言)。
- 1C1:schema+0118 三件;server/services/financeTruth/apService.ts(新)+sources/supplierApSource.ts(新);server/routers/apRouter.ts(新);server/routers.ts;client/src/components/admin-v2/FinanceCockpit/InvoiceReviewCard.tsx(新);client/src/i18n/{zh-TW.ts,en.ts};server/_core/featureFlags.ts;測試 server/services/financeTruth/apStateMachine.test.ts(matrix 全分支+replay)+server/routers/apRouter.test.ts。
- 1C2:schema+0119 三件;apService.ts+apRouter.ts(allocation 面);client AP 明細元件;server/_core/featureFlags.ts;測試 server/services/financeTruth/apAllocation.test.ts(三式 property/reversal 模型/race)。
- 容器 DB(1C0 起):scripts/test-db/docker-compose.yml+scripts/test-db/run-integration.sh(新;腳本開頭斷言連線目標非 DATABASE_URL,prod 拒跑)+package.json(scripts.test:db)。

## 九、1B 三出口收斂(摘要;固定清單)

yearEndExportService 改 import canonical fold+NEUTRAL_CATEGORIES+遞延+userId 範圍統一;generateBankMonthlyTrend 廢第二支手寫摺疊改 monthKeyOfDate;currency C1-C5+C7-C9 落地、C6 註記(§7.2 真清單)+fold 取 isoCurrencyCode;E6-E9 procedures 與 financialReportService 計算函式(generateMonthlyTrend/generateTaxSummary/dashboard/profitAndLoss)**刪除**(永久錄入-only 終局;保留 accounting.ts :46/:60/:73/:99/:121/:129/:142/:188-306 錄入面);financeAdvisor 兩處 import(:70-73/:105-108)移除、advisor 接 truth service 後另批復啟;README 真值修正(yearEndExportService.ts:353/:362-384)。
固定清單:server/services/{bankPLService.ts, yearEndExportService.ts, taxCsvService.ts, plaidSyncService.ts, financialReportService.ts, **bankCsvImportService.ts(C6 檔頭「來源證明 USD」前提註記), accountingAgentService.ts(C7 死碼 fallback 刪除), trustDeferralService.ts(C8 ingest `?? "XXX"`+C9 兩路 recognized 讀回帶 currency:recognizedTrustIncomeInPeriod 與 monthlyDeferralAdjustments/foldMonthlyDeferralAdjustments)**, financeTruth/managementAdapter.ts(新), financeTruth/taxAdapter.ts(新), financeTruth/rawEvidenceAdapter.ts(新)};server/routers/{plaidRouter.ts, accounting.ts};server/_core/{plaidWebhook.ts, stripeWebhook.ts};server/agents/autonomous/{financeAdvisor.ts, financeAlertProducer.ts, opsTools.ts};測試 server/services/triExportParity.test.ts(同 fixture 三出口逐項相等,含 1/1、12/31 邊界與兩 payout 列、support@ 與 jeff 同值)+**server/services/financeTruth/managementAdapter.test.ts(新;承接 financialReportService.test.ts 刪除後的等價 fold 契約:trust-aware 月度 netProfit 不變量)**+server/services/currencyGuard.test.ts(TWD 不入總額/XXX 桶/C7 讀取層無 fallback regression/C8 ingest XXX/C9 兩路非 USD recognized 入 unsupported 桶不入 income 與月加回)+**同批必改的現有 trust/tax 型別與回歸測試:server/services/trustDeferralService.test.ts、server/services/trustDeferralService.sentinel.test.ts、server/services/taxCsvService.test.ts(隨 C8/C9 shape 變更同步)、server/services/bankPLService.trend.test.ts(deferral fixtures 現無 currency,C9 後缺值進 unsupported 不加回、既有 USD 期望必紅——fixture 逐列補明確 `isoCurrencyCode:"USD"`,另鎖 TWD/XXX recognized 不入收入案)、server/services/financialReportService.test.ts(全檔 import foldMonthlyTrend,計算面刪除後 collection 必紅——處置:該檔隨計算函式同批刪除,等價 fold 契約由 managementAdapter 測試承接,見 §9 新測試)**。

## 十、測試矩陣(總表)

| 域 | 測試檔(vitest 真收集,全 .test.ts) | 批 |
|----|-----------------------------------|-----|
| client 狀態折疊 | cockpitState.test.ts、cockpitMath.test.ts(TileState→transport-error)、kpiStripState.test.ts、financePagesRender.test.ts(renderToStaticMarkup) | 1A0a |
| boot telemetry | server:clientBoot.test.ts(closed payload/去重/rate limit/audit 列)+client:adminShellBoot.test.ts(reportBootOnce orchestration:success 才寫 guard/reject 可重試/skipped/clientKind/payload/shortBuildSha) | 1A0a |
| 封鎖黑箱 | financeBlocked.test.ts(E1-E3/E6-E11 各自預期)、opsActionsBlocked.test.ts(E4/E5 denylist Seam)、taxCsvBlocked.test.ts(E12+financeAdvisor direct-call) | 1A0b |
| fail-closed | financeFailClosed.test.ts(F1-F6) | 1A0b |
| envelope | envelope.test.ts(I1-I7)、kpiV1.test.ts(subset/七 id/映射) | 1A1 |
| 三出口/currency | triExportParity.test.ts、currencyGuard.test.ts、managementAdapter.test.ts(新,承接等價 fold 契約)、bankPLService.trend.test.ts(fixture 補 USD+TWD/XXX 案)、trustDeferralService.test.ts、trustDeferralService.sentinel.test.ts、taxCsvService.test.ts(C8/C9 同步)、financialReportService.test.ts(同批刪除) | 1B |
| re-auth | reAuth.test.ts(原子含 userId/200-way/跨 user 拒/過期/scope/burst 限流+TTL 自癒/rollback 逐步注入) | 1C0 |
| AP 狀態機 | apStateMachine.test.ts(matrix 全分支+replay determinism)+lines 容器負例(雙 null 拒/雙非 null 拒/duplicate lineNo 拒/amountMinor≤0 拒/unassignedRemainderMinor<0 拒/**不存在 customOrderId 拒/不存在 bookingId 拒(FK)**) | 1C1 |
| AP allocation | apAllocation.test.ts(三式 property join 口徑/多筆 reversal Σ≤original 鎖內核對/direct-DB cross-invoice 與 cross-bank reversal 結構性不可能斷言/reversal-of-reversal 結構性不可能/兩併發 partial reversal 合計超額恰一成功/removed txn 拒/雙 line race/approve-void race/雙 approve race) | 1C2 |
| DB 黑箱 | 上列 1C 測試經 scripts/test-db 容器實跑 | 1C0-1C2 |
| 回歸 | 既有全套綠;1B 口徑差異逐項列 | 各批 |

測試禁插真實資料進 DB;全走 fixture/fake adapter/容器 DB。

## 十一、rollback / feature flag

- 1A0a:client 誠實化+mock 清除+additive clientBoot telemetry(既有財務 server 行為零變更),不掛 flag(無合理回退場景);回滾=git revert。
- 1A0b:封鎖與 fail-closed 不掛可逆 flag(flag OFF 只准=unavailable,不准復活 legacy 假數——Codex 既裁);回滾=git revert+re-ship。
- 1A1:`FINANCE_TRUTH_V1_ENABLED`(預設 OFF;OFF=kpiV1 回 PRECONDITION_FAILED,舊 endpoint 已封,cockpit 顯示 unavailable——**不回假數**)。
- 1C 各批:`SUPPLIER_AP_ENABLED`(OFF=表存在但 API/UI unavailable)。
- 部署一律 Jeff pnpm ship;本 plan 不含部署動作。

## 十二、明確禁止範圍

不碰:inquiries.ts 電話 hotfix、Email/PDF、Trip.com、Safe Booking Saga、credential、deployment、Trust withdrawal/recognition gate 全鏈(trustTransferWriteGate/trustTransferDetection/scanRecognitionDue/端點 403)、既有 migration、production database、STATE.md。payment_attempt/operation/outbox、退款 ledger 歸 Batch 1/saga。認列端點維持刻意未建。財務批不得作為任何 gate 解凍載體。槽 3b/4/8b 與稅務軸數值受 RC-LAW/RC-CPA/RC-BOFA 阻塞,Phase 1 全程 not-computable,未裁定內容不得寫成會計真值(問題包 A/B/C 見 proposal §三)。

## 十三、1C-docs 前置批(1C1 硬前置,docs-only 另批)

1. 設計稿 §5A.2 invoice→order N:1 修訂為 line 層 N:M(對齊 §8.5)。
2. invoice number normalization v1 入數字契約附錄:NFKC→uppercase→去空白與分隔符 `[-_/., ]`→僅留 `[A-Z0-9]`;空結果→`HASH:<sha256(pdf) 前 32 hex>`;normVersion=1 隨列存;golden cases(`inv-2026/001`≡`INV2026001`;全形 `ＩＮＶ００１`≡`INV001`;純符號→HASH fallback)。
3. 未合併前 1C1 無施工資格;不准先造 schema 再改契約。

## 十四、風險與獨立反駁

| # | 風險 | 反駁/驗證 |
|---|------|-----------|
| R1 | fail-closed 使 cockpit 在 DB 抖動時報錯,可用性降 | 逐指標 not-computable 只滅該卡;stale 態保留舊值+badge;fail-closed 只殺「無數據裝 0」 |
| R2 | 三出口收斂改變歷史稅表數字 | ZIP 現值本來就錯(payout 雙計+無遞延+userId 漏 trust 帳);1B 交付含舊 ZIP vs 新 ZIP 差異清單供 CPA 對照 |
| R3 | financeTruthService 成第三套系統 | 它不算數只包口徑;fold 單一;三出口 import 同 fold 的 CI 測試結構性排除;financialReportService 終局=永久錄入-only 已裁 |
| R4 | AP 表建了但矩陣未定 | AP 記可證事實(義務+付款);Trust-eligible 語意留白 RC-LAW;寫入被既有 gate 凍結;測試斷言 AP mutation 無法觸達 trust 寫入路徑 |
| R5 | 1A0a/1A0b 拆批拉長止血時程 | 成立但必要:舊 bundle 假 $0(KpiStrip 七值 ?? 0)是實測行為非假設;單次部署需先建 version hard gate,成本更高 |
| R6 | Jeff 密碼能力未證 | 兩段 preflight(§8.4):hash 查證+Jeff 親跑 canary 成功;未齊前 reAuth.issue 對財務 scope unavailable,canary 失敗走 reset 或另裁 WebAuthn/OTP;不阻塞 1C0 其餘 |
| R7 | mysql2 DATE 月分桶 bug 未實證,修了可能變現值 | 1B fixture 先證現值是否受影響,受影響才改+附差異 |
| R8 | 盤點行號漂移 | 承重錨點指揮親核(F1/ZIP:212-214/gate:18-20/unlink:394-396/MOCK:34/allClear:28/KpiStrip:46-52/serviceWorker:37-50/stripeWebhook:314/vitest include/TaxDetail/ops agent 鏈);其餘施工時逐一 re-verify 後動刀 |

## 十五、停止線

本輪只交付本 plan v4.3 窄修+progress 追加+repo 外通信/索引。零 production code、零 schema、零 migration、零 Trust gate、零 STATE、零新 repo 檔案、零 commit、零 push。下一輪 Codex 只核 23:09 六個機械差額;全過先只授 **1A0a client-compat** 施工資格;1A0a 部署+換版證據(§3.4 兩證)通過後才授 **1A0b**;1A1/1B/1C 各批另驗。
