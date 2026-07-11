# featureFlags 全清點(F2 塊D,2026-07-10)

> 來源:`server/_core/featureFlags.ts`(runtime boolean/數值旋鈕的唯一入口,
> SECURITY_AUDIT P3-3 立制:call site 禁裸讀 `process.env.*`,拼字錯誤要變
> compile error)。Fly secrets 開機注入,改 flag 需 redeploy(金融行為刻意
> 不做熱切換)。本表是 dispatch-f2 塊D #3 的交付;flag 增減時同步本表。

> **prod 實測(2026-07-10 v808 走查)**:`PLAID_TRUST_DEFERRAL_ENABLED` 在 prod 是
> **ON**(Fly secret = true,F2 之前既有,非本批所翻;prod 的遞延列即由此而來)。
> `STRIPE_TRUST_DEFERRAL_ENABLED` 未設 = OFF。下表「預設」欄是 code 預設(env 未設
> 時的行為),不是 prod 現值。含義:v808 的認列加回與四口徑接線對 Plaid 路徑
> **上線即生效**,損益月度歸屬自 v808 起修正(存入月減、認列月加);走查單第 2/2b
> 項對 Plaid 路徑應以 live 數據執行,不再是翻轉前的假想練習。

| Flag(env) | 讀取函式 | 用途 | 預設 | 翻轉條件 | 測試覆蓋 |
|---|---|---|---|---|---|
| `PLAID_TRUST_DEFERRAL_ENABLED` | `trustDeferralEnabled()` | CST §17550 主開關(Plaid 路徑):trust 帳戶 income_booking 入帳建遞延列,出發才認列 | **OFF**(prod 現值 ON,見上) | 已 ON(關閉才需裁決);CPA 口徑答覆回來調參不動結構 | featureFlags.test.ts;trustDeferralService.test.ts(isAnyTrustDeferralEnabled 四象限) |
| `STRIPE_TRUST_DEFERRAL_ENABLED` | `stripeTrustDeferralEnabled()` | Stripe tour checkout 收款走同一遞延帳(不在結帳當下認列);visa 服務費永不遞延 | **OFF** | CPA 對「Stripe 收的訂金是否屬信託監管」的裁示(dispatch-f1 塊B;Jeff 佇列中) | featureFlags.test.ts;stripeWebhook.test.ts:141-165(flag-OFF byte-identical,不准弱化)+ flag-ON 遞延分支 |
| `PLAID_TRUST_RECOGNITION_OFFSET_DAYS` | `trustRecognitionOffsetDays()` | 認列日 = 出發日 + N 天(CST 稽核緩衝) | `0` | CPA 答覆回來只調此參數,結構不動(isRecognitionDue 單一函式) | featureFlags.test.ts |
| `PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE` | `trustAutomatchMinConfidence()` | 入帳→booking 自動配對的最低信心,低於則轉人工 | `80` | 配對品質數據(誤配率)支持調整時 | featureFlags.test.ts |
| `PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD` | `trustAutomatchAmountWindowUsd()` | 同日配對金額容差(USD);F1 塊B 修過 falsy-zero(`'0'` 現在真的是 0) | `1.00` | 同上 | featureFlags.test.ts |
| `PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS` | `trustAutomatchDateWindowDays()` | 配對回看 ±N 天 | `2` | 同上 | featureFlags.test.ts |
| `PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS` | `trustEarlyRecognitionWindowDays()` | 出發距訂金 ≤N 天 → 認列日改訂金日(跨年歸屬);設 0 停用(F1 塊B 修過 falsy-zero) | `30` | CPA 對短前置期歸屬的裁示 | featureFlags.test.ts;trustDeferralService.test.ts(computeExpectedRecognitionDate 邊界) |

## featureFlags.ts 之外的相關 env 旋鈕(非 flag,行為參數;集中列供對照)

| env | 所在 | 用途 | 預設 |
|---|---|---|---|
| `TRUST_TRANSFER_DATE_WINDOW_DAYS` | trustTransferDetection.ts | 轉帳配對日窗 | 3 |
| `TRUST_TRANSFER_SCAN_DAYS` | trustTransferDetection.ts | 轉帳偵測掃描回看 | 60 |
| `TRUST_TRANSFER_REMINDER_DAYS` | trustTransferDetection.ts | 認了沒轉錢提醒天數(指揮令 N=7 起) | 7 |
| `TRUST_OPERATING_ACCOUNT_MASKS` | trustTransferDetection.ts | Operating 流入白名單(mask,逗號分隔) | `2174` |
| `PAYOUT_FEE_MIN_PCT` / `PAYOUT_FEE_MAX_PCT` | processorPayoutMapping.ts | 撥款↔銷售隱含費率帶 | 0.01 / 0.05 |
| `PAYOUT_DATE_WINDOW_DAYS` | processorPayoutMapping.ts | 銷售收款→撥款落地日窗 | 7 |
| `BANK_TXN_PENDING_CLAIM_MIN_USD` | bankTransactionLinkEngine.ts | 待認領門檻(低於走 small_inflow) | 100 |

## 翻 flag 前的走查(塊D P&L 接線後的「可翻」檢查單)

1. flag OFF 探針:`stripeWebhook.test.ts` byte-identical 測試綠(不准弱化)。
2. 翻 ON 後首月:P&L 的 `trustDeferredIncome`(存入期減項)與
   `trustRecognizedIncome`(認列期加回)兩 KPI 對得上遞延表;跨月案例走查
   (存入月收入不含訂金、認列月出現)。
2b. 稅表/財報口徑驗證(塊D 回爐 P2):generateBankMonthlyTrend(稅 CSV 資料
   源)、taxCsvService trust 摘要(totalReceived 含已認列全額/totalRecognized
   走共用口徑)、financialReportService 月度趨勢(trustRecognizedIncome 欄)
   三路與 generateBankPL 對同一筆跨月遞延各驗一次 —— 四個口徑必須同數。
3. 每日 trustRecognitionWorker 認列 → 轉帳偵測 → 提醒卡鏈路首跑觀察。
4. 翻與否是 Jeff 單獨裁決(dispatch-f2 塊D 原文),本批不翻。
