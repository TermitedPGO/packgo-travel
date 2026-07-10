# 派工單:F2 — Trust 合規結構化(2026-07-09 指揮簽發)

> 執行模型:opus 4.8。錢字批次:塊B/C/D 完工各需一路 fresh opus 對抗審查。worktree 隔離(git worktree add ../網站-f2 main)。
> 上游:blueprint.md F2 節 + f1-acceptance-20260709.md「F2 派工單必帶」彙總。T2 通用地雷七條全部適用(docs/agent/30-templates.md)。
> 目標一句話:Trust #5442 的合規(CST §17550)從「靠 Jeff 記得」變成結構性保證,加上把兩家處理商(Square 真實在跑、Stripe 就緒)的撥款對映建好,讓 P&L 不雙計不漏計。

## 已知錨點(指揮供,開工先讀)

- trustDeferralService.ts:deferStripeBookingIncome ~:489、reverseDeferral ~:755(reversedAt/reversedReason :763-767);遞延表 schema.ts ~:3221(depositDate/expectedRecognitionDate/recognizedAt/reversedAt,無轉出欄)。
- auditLog.ts:171-176:audit() 無 ctx.user 靜默 no-op —— 塊A 的存在理由。
- bankPLService.ts:53-106:INCOME 僅 income_booking;stripe_payout/transfer 兩中性桶已成 tile(F1 塊C 修復);SCHEDULE_C_MAP 在此。
- featureFlags.ts:20 isTrue、:130-131 STRIPE_TRUST_DEFERRAL_ENABLED;flag-OFF byte-identical 測試 stripeWebhook.test.ts:141-165,不准弱化。
- 內部端點先例:index.ts:1574 cleanup-sandbox-residue、:1540 declassify、backfill-bank-transaction-links;verifyInternalAuth :1187-1204。
- 探真事實(F1 round3):prod 408 筆入帳零 'stripe' 字樣;真處理商入帳 = Square「ACH CREDIT Square Inc SQ」;isStripePayoutInflow 已收緊(accountingKnowledge.ts:315-334),殘留窗記錄在案。
- 現況數:待認領 320 筆/$447,732;small_inflow 可自動掛 53 筆(存量 confirm 未跑);Trust 未認列三筆 $15,422 未歸戶。

## 塊A — systemAudit()(先做,小)

1. server/_core/auditLog.ts 加 systemAudit(actor: "system:<模組名>", action, target, detail):無 ctx.user 也寫 auditLog 列,actor 欄明確標系統行為者。
2. 接上四處:deferStripeBookingIncome、reverseDeferral、cleanup-sandbox-residue confirm、backfill-bank-transaction-links confirm。各補測試釘 actor/action/金額欄。
3. 此後新增 LOCAL_SCRIPT_TOKEN 寫端點必接 systemAudit,寫進該檔檔頭註解成慣例。

## 塊B — Trust 認列閉環(主體)

1. 認列生命週期補全:遞延表加 transferredAt(nullable)與 transferBankTransactionId(nullable)。允許一個 migration(0114,指揮此處授權),必附 .down.sql,過 migrationBreakpoint 守門,註解禁 breakpoint 字面。
2. 轉帳偵測:Plaid bankTransactions 中「Trust 流出 + Operating 流入」同額近日配對(金額符號地雷:正=流出負=流入),對上已認列(recognizedAt 非空)的遞延列 → 回填 transferredAt/transferBankTransactionId;對不上的認列(認了沒轉錢)超過 N 天出提醒卡(N=7 起,env 可調)。
3. 不變式看門狗:週稽核 D1 加一行 —— Trust 帳(30003)餘額 vs 遞延表(未認列+已認列未轉出)加總,漂移超過 $1 出 high 卡。走 observabilityCounters 同款絕不 throw 模式。
4. §17550 規則測試釘死:出發前不可認列、出發後可認列、認列後才可轉出,三條紅綠。CPA 答覆(Jeff 佇列中)回來只調參數不動結構,設計時把「認列時點」做成單一常數/函式。

## 塊C — 處理商撥款對映(Square 先行)

1. 先探真(唯讀,結論進 T6):Square 撥款在 bankTransactions 的 descriptor 全形狀取樣;Square 銷售現在怎麼進帳(customOrders recordPayment 'square' 手記?有無次帳紀錄?)。答案決定對映設計,先探再寫。
2. isSquarePayoutInflow 謂詞(仿收緊後的 stripe 版:錨點+語境,以真 descriptor 錨定)+ 中性桶 square_payout 進 bankPLService(SCHEDULE_C_MAP 標 excluded)+ 分類枚舉。
3. payout↔銷售對映:撥款金額 = 銷售扣手續費,設計對映結構(可先人工確認式:撥款卡列候選銷售,Jeff 確認),防雙計原則同 Stripe。
4. Stripe 同款機制就緒:payout 對映表/欄位同時涵蓋兩家,descriptor 校準點(殘留窗)一併收:真 Stripe 撥款落地時的校準步驟寫成 registry 條目 note。

## 塊D — flag 收口與 P&L 接線

1. P&L 接線(flag-ON 的前置,硬驗收):flag ON 情境下,遞延認列的收入在認列時進 P&L(bankPLService 或等價口徑),不再依賴 checkout 當下的次帳;flag OFF byte-identical 測試原樣不動。交付「可翻」狀態:本批不翻 flag,翻與否 Jeff 單獨裁決。
2. 部分退款遞延:F1 塊B 只處理未認列全額 reverse;補部分退款按比例 reverse(或明確擋下轉人工,你設計,opus 審查路把關),紅綠測試含邊界(退款>遞延、多次部分退款)。
3. featureFlags 全清點:featureFlags.ts 現有 flag 逐一列表(用途/預設/翻轉條件/測試覆蓋),寫進 docs/features/finance-dept/feature-flags.md。

## 紅線

- AI 絕不動錢:所有對映/認列/轉帳確認都是 Jeff 按;偵測與候選是搬運不是決定。
- STRIPE_TRUST_DEFERRAL_ENABLED 本批保持 OFF;flag-OFF 行為 byte-identical 測試不准弱化。
- migration 僅塊B 授權的一個;prod 唯讀(探真);pnpm ship 只有 Jeff;commit 帶 pathspec 只 add 自己檔案;零 LLM 呼叫。
- 涉及 scripts/*.ts 或字串內嵌 code 的交付,驗收附實跑證據(地雷 #7)。

## 驗收(T6)

1. tsc 0 錯 + vitest 全綠 + 新增測試清單(systemAudit 四處/§17550 三紅綠/轉帳配對/不變式/部分退款邊界/兩謂詞)。
2. migration 0114 上下行實測(prod 由 release_command 跑,本地附 SQL 審閱 + migrationBreakpoint 綠)。
3. 塊C 探真結論全文(Square descriptor 樣本、現行記帳路徑)。
4. 塊B/C/D 各一路 fresh opus 對抗審查 PASS。
5. 走查清單(ship 後執行者跑):D1 新行首跑、轉帳配對對歷史資料 dry-run、square_payout 謂詞對 prod 真撥款命中率、flag OFF 探針。
6. 回寫 progress.md + STATE.md 由指揮更新。
