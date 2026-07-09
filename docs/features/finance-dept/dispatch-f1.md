# 派工單:財務部 F1 — 對帳引擎(每筆入帳要嘛有單、要嘛有待認領卡)

> 指揮(Fable)2026-07-08 簽發。母計畫 `docs/features/finance-dept/blueprint.md`(含目標態示意圖 blueprint-diagram.html)。現況地圖 `docs/features/finance-map/current-state.md`(核心宣稱已經三路對抗驗證全 CONFIRMED)。錨點來自 2026-07-08 偵察與 prod 唯讀探針,動手前 Read 確認。

## 建議模型

- 執行:sonnet。對抗審查:每塊 ≥3 路 fresh;塊B(碰錢認列)其中一路必須 opus(碰錢=高風險,10-dispatch §3)。
- 同塊回爐 2 次或 prod 疑難:停,失敗軌跡升 opus。

## 必讀

`CLAUDE.md`、`docs/agent/30-templates.md`(T2 地雷五條+T6)、`docs/features/finance-dept/blueprint.md`、`docs/features/finance-map/current-state.md`、`docs/standards/backend.md`。UI 塊加讀 `docs/standards/design.md`。

## 鐵律(藍圖六條,對抗審查每路必驗)

1. AI 只看只算只建議,永遠不動錢;認領/認列每個動作都是 Jeff 按。
2. 絕不自動歸信心不足的款;規則型自動對帳必須每條規則可解釋、可追溯(matchMethod 記錄)。
3. supplierCost 與成本不出現在任何客人可見面。
4. Trust 規則(CST §17550)測試釘死。
5. 所有寫入(認領/改 link/清理)留 auditLog。
6. 全批零 LLM(對帳候選全靠純規則;既有 accountingAgent 的 LLM 分類不動)。

## 本批點名地雷(全文見 30-templates.md T2)

1. **Plaid 符號(頭號雷)**:`bankTransactions.amount` 正=支出、負=入帳(schema.ts:3109 註解)。每個讀 amount 的新函式都要紅綠例釘死符號。
2. **migration 註解禁含 `--> statement-breakpoint` 字面**(0112 事故;守門測試 migrationBreakpoint.test.ts 必須綠)。
3. **TiDB raw SQL**:新查詢傾向 Drizzle builder;必須 raw 時 `.toSQL()` 形狀斷言。raw `sql<Date>` 回 naive 字串,server 端 coerce UTC。
4. **噪音閘**:待認領卡就是「放寬進口」,本單塊A 的閘是硬規格不是建議(v801 洪水教訓)。
5. **秒級截斷/時區**:時間窗比較取整到秒;日期口徑跟既有 findBookingMatch 慣例。

## 塊A:對帳資料模型 + 引擎 + 待認領流程

範圍:**只做入帳(inflow)**。支出面沿用既有 agentCategory,F3/F4 再管。

1. **migration(本批唯一授權一張)**:新表 `bankTransactionLinks`:
   - id PK、bankTransactionId int notNull(idx)、targetType enum('custom_order','invoice','booking','category')、targetId int null、categoryCode varchar(64) null(targetType=category 用,如 stripe_payout/owner_transfer/interest/small_inflow)、amountAllocated decimal(14,2) notNull(一筆流水可拆多單)、matchMethod varchar(64)(`auto:<rule>` 或 `manual`)、matchConfidence int null、claimedBy varchar(32)('jeff'/'system')、note text null、createdAt/updatedAt。
   - code 層驗:同一 txn 的 SUM(amountAllocated) ≤ |amount|;超額拒收。
   - 欄位細節可申報偏離,表型不可(link 表多對多是拍板的,不准改回單欄)。
2. **自動對帳規則(純規則,各附 matchMethod=auto:<rule-name>)**:
   - `stripe_payout`:descriptor/merchantName 識別 Stripe 轉撥 → category link,絕不 income(與塊C 同一條)。
   - `trust_sync`:trustDeferredIncome 既有配對成果(findBookingMatch,trustDeferralService.ts:159-239)同步寫 link,共用不重造。
   - `order_ref`:originalDescription/paymentMeta.reason(schema.ts:3120-3124,BofA Zelle memo 落點)含 ORD-YYYY-NNNN → 直接 link。
   - `exact_amount`:金額吻合單一未收款 customOrder(全額或訂金比例枚舉,沿用批8 演算)+ 時間窗 ±7 天 + **唯一候選** → auto;多候選 → 出卡列候選。
   - Zelle payer 名對 customerProfiles(exact)只加分,不單獨成 auto。
3. **待認領卡(噪音閘硬規格)**:
   - 出卡條件:入帳 且 未 auto-link 且 |金額| ≥ $100(env 可調)且 非已識別內部轉撥;低於門檻自動 category=small_inflow 不出卡。
   - 每日出卡上限 10,超過收斂成一張聚合卡。
   - **存量絕不逐筆出卡**:另建回填端點(dry_run/confirm,LOCAL_SCRIPT_TOKEN 慣例)跑存量 → 產報表檔(auto-link 統計 + 待認領清單)+ 一張聚合卡;Jeff 從 UI 批次認領。
4. **認領 UI**:FinanceReports.tsx(live 路徑,client/src/components/admin-v2/)加「待認領入帳」區塊:pending 清單 + 每筆候選(訂單/分類)+ 認領鈕 → 新 tRPC adminProcedure(link 寫入 + auditLog);黑白高密度、圓角、i18n zh-TW/en 同步。inbox 卡只做通知,動作在財務頁。
5. 完成判準測試:任一入帳處理後狀態 ∈ {已 link, 已出卡待認領, 低額自動歸類},不存在第四態。

## 塊B:Stripe 收款統一進認列規則引擎(flag 化,預設 off)

1. 新 flag `STRIPE_TRUST_DEFERRAL_ENABLED` 進 featureFlags.ts;**順手收口**:trustDeferralService.ts:73-93 三個裸 process.env(AMOUNT_WINDOW/DATE_WINDOW/EARLY_RECOGNITION)搬進 featureFlags.ts(F2 提前小項)。
2. flag ON 時:stripeWebhook 兩個 income 寫入點(handleCheckoutSessionCompleted stripeWebhook.ts:258-297、handleVisaPaymentCompleted :1077-1091)之中,**只有 tour checkout** 改走遞延:寫 trustDeferredIncome(bookingId 直接有,matchMethod='stripe_direct',expectedRecognitionDate 沿用出發日規則),不立即 createAccountingEntry income;visa 維持現行立即認列(服務型,CPA 若裁定要再開,本批不做)。
3. flag OFF 時:行為與現行 **byte-identical**(測試釘死:off 時 createAccountingEntry 呼叫參數與現版完全一致)。
4. 認列端:recognizeReadyDepartures(trustDeferralService.ts:440)要能認列 stripe_direct 列;Stripe 來源的遞延列在既有 admin override(linkInflowToBooking/reverseDeferral)同樣可操作。
5. 對抗審查:一路 opus 專審錢路徑(遞延/認列/reversal 三態、退款時遞延列怎麼辦、金額精度)。**退款邊界**:本批只要求「Stripe refund 發生時該遞延列標 reversed 不認列」,更細的退款會計留 F2。

## 塊C:雙計防護

1. Stripe payout 落行識別:preClassify(accountingKnowledge.ts:308)或其上游加規則:Stripe 轉撥 descriptor → 分類 stripe_payout(轉撥非收入),絕不 income_booking;與塊A 規則同源共用。
2. 先探針後動手:回填端點 dry_run 先回報存量中有多少筆疑似 Stripe payout 已被分類成 income 類(數字進 T6),confirm 才改標。
3. 紅綠例:payout 樣式 → stripe_payout;真客人 Zelle 入帳 → 不受影響。

## 塊D:衛生(零 migration)

1. recordPayment 寫死 'square' 回退移除(adminCustomerOrders.ts:1170):method 與訂單既有值皆缺時存 null,不猜。
2. 死碼三元件刪除:FinanceTab.tsx、landings/FinanceLanding.tsx、BankAccountsTab.tsx(fresh 驗證零引用;ProfitLossV2.tsx:50 的註解提及一併更新);grep 零 orphan。
3. Plaid sandbox 殘留清理端點(dry_run/confirm):linkedBankAccounts 24 條 First Platypus Bank(id 1-24,全 isActive=0)+ 其掛的 bankTransactions;dry_run 先報數,Jeff 授權才 confirm。⚠ 只准刪 institutionName='First Platypus Bank' 且 isActive=0,BofA 一根毛都不准碰。

## 驗收條件(每塊 commit 前,逐條附證據)

1. tsc 0 錯;全套 vitest 綠,總結行原樣貼(數字紀律)。
2. Plaid 符號紅綠例;migrationBreakpoint.test.ts 綠;flag off byte-identical 測試綠。
3. 塊A:四規則各有紅綠例;噪音閘三條(門檻/日上限/存量不出卡)各有測試;認領寫入含 auditLog 斷言。
4. i18n 100% parity(UI 塊)。
5. 鐵律六條逐條自檢寫進 T6。

## 驗收走查清單(ship 後,執行者自跑附證據)

1. 回填 dry_run:貼統計(存量入帳 N 筆,auto-link X、待認領 Y、small Z、疑似 payout 雙計 W)。
2. 3 筆 trust unmatched($8,908 4/13、$2,916 6/2、$3,598 6/12)在新 UI 實測認領(Jeff 說得出案子就 link,說不出留卡標 unknown),探針證據:link 列 + auditLog + 卡收掉。
3. FinanceReports 待認領區塊截圖(黑白/對齊/i18n)。
4. flag off 現網行為不變:ship 後觀察既有 Stripe 訂票一筆,accountingEntries 寫入與現版一致(唯讀探針)。
5. sandbox 清理 dry_run 數字報 Jeff,授權後 confirm,複驗 BofA 四帳戶完好。
6. 煙霧七臂照舊全綠(Wave 1 資產,ship 輸出貼上)。

## 監工已代答的裁示

1. link 表不綁 UNIQUE(bankTransactionId):一筆流水拆多單是合法狀態。
2. 待認領動作面放 FinanceReports,不做新頁(admin 簡單原則);inbox 卡只通知。
3. Stripe 遞延預設 off,等 CPA 答案翻 flag;visa 本批不遞延。
4. 存量認領不趕:回填報表出來後 Jeff 分批做,系統不催。
5. 節奏:等 Wave 1 收尾補丁 + ship + 走查收完才開工本批;與 Wave 1 執行不並行動 code。

## T6 完工報告

`docs/features/finance-dept/t6-report-<date>-f1.md`,照 30-templates.md T6 六欄,測試總結行原樣貼,回報超 30 行落檔傳路徑。Wave 1 的教訓直接吸收:宣稱有測試就必須附測試名與檔案,漏一條=驗收陳述誇大,監工會逐條核。
