# v808 ship 後走查（唯讀）— 2026-07-10

> 執行：Opus 走查執行者（Fable 派工）。全程唯讀，未 commit / push / 對 prod 寫入。
> dry_run 模式本身不寫。報告以「證據原文（指令＋回傳）」為主。
> v808 = F2 財務合規全案（八 commit，merge 6698dfb）＋ migration 0114
> （trustDeferredIncome 加 transferredAt / transferBankTransactionId）。

## 版本與健康（前置探真）

```
$ curl -s https://packgoplay.com/health
{"overall":"ok","checks":{"db":{"status":"ok","latencyMs":24},"redis":{"status":"ok","latencyMs":2},"stripe":{"status":"ok","latencyMs":205},"llm":{"status":"ok","latencyMs":385}}}

$ flyctl releases -a packgo-travel
 v808 │ complete │ Release │ jeffhsieh09@gmail.com │ 18m41s ago
 v807 │ complete │ ...
$ flyctl status -a packgo-travel
 app │ 48e6399bd42778 │ VERSION 808 │ sjc │ started │ 1 total, 1 passing
```

四路健康全 ok（db/redis/stripe/llm），v808 release complete，機器已在 v808、checks passing。

---

## 走查清單逐項判定

### 1. migration 0114 已套用 — PASS

證據鏈（無 prod mysql client，改以「部署合約 + 端點行為」佐證，四路互證）：

1. 0114 已登記進 drizzle journal：
   ```
   $ grep -n "0114_trust_transfer_lifecycle" drizzle/meta/_journal.json
   786:  "tag": "0114_trust_transfer_lifecycle",
   ```
2. 遷移在 Fly `release_command` 跑，失敗即中止部署：
   ```
   # fly.toml:13-14
   # If this fails the deploy is aborted — prevents partially-migrated DBs.
   release_command = "node scripts/migrate.mjs"
   ```
   `scripts/migrate.mjs` 用 drizzle-orm 內建 migrator：`migrate(db, { migrationsFolder: "./drizzle" })`，失敗 `process.exit(1)`。
3. v808 release STATUS = `complete`、機器 v808 started、health checks passing
   ⟹ release_command（含 0114 前的所有待套遷移）exit 0。
4. 端點旁證：trust-transfer-detect dry_run（其 eligibleRows 查詢 SELECT/篩選
   `trustDeferredIncome.transferredAt`，見 trustTransferDetection.ts:355/363）回傳
   well-formed 200 報表，非 "Unknown column" 500。
5. 0114 本身冪等（`ADD COLUMN IF NOT EXISTS`），重跑安全（0114_trust_transfer_lifecycle.sql:20/24）。

判定：兩新欄 transferredAt / transferBankTransactionId 已存在於 prod。
說明：flyctl logs（--no-tail buffer）已無 18 分鐘前的 migration 行可撈，改以 release
「complete」為權威訊號；此為 release_command 合約的必然結果。

### 2. trust-transfer-detect dry_run — PASS（乾淨 no-op）

```
$ TOKEN=$(flyctl ssh console -a packgo-travel -C "printenv LOCAL_SCRIPT_TOKEN")   # len=64
$ curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    https://packgoplay.com/api/admin/trust-transfer-detect -d '{"mode":"dry_run"}' -m 120
{"eligibleRows":0,"scannedTxns":0,"pairsFound":0,"backfills":[],"suggestions":[],
 "backfilled":0,"overdueCount":0,"overdueTotal":0,"reminderPosted":false}
```

- backfills：0 筆；suggestions：0 筆；overdueCount：0（overdueTotal $0）。
- `reminderPosted:false` ⟹ dry_run 未寫任何東西（提醒卡也沒發）。
- eligibleRows:0 = prod 無「已認列（recognizedAt 非空）且未轉出（transferredAt IS NULL）」
  的遞延列；scannedTxns:0 = 60 天窗內 Trust/Operating 帳無配對候選交易。
- 無意外（無 backfills>0、無 overdue）。未觸發任何寫入路徑。

⚠ 誠實揭露一個口徑細節（不影響本項判定）：runTrustTransferDetection 在 DB 例外時會
degrade 成同樣全 0 的 EMPTY_REPORT（trustTransferDetection.ts:474-475）。也就是「欄位缺失
導致查詢 throw」與「查詢成功但 0 列」回傳字面相同。但第 1 項已獨立證明 0114 已套用
（欄位存在），排除了 degraded 分支，故本項全 0 判為真 no-op。

### 3. 兩個遞延 flag OFF 探針 — 待 Jeff 確認（STRIPE 符合，PLAID 不符前提）

env 名（server/_core/featureFlags.ts）：`PLAID_TRUST_DEFERRAL_ENABLED`（trustDeferralEnabled）、
`STRIPE_TRUST_DEFERRAL_ENABLED`（stripeTrustDeferralEnabled）。

```
$ flyctl ssh console -a packgo-travel -C "sh -c 'echo VAL=[\$PLAID_TRUST_DEFERRAL_ENABLED]'"
VAL=[true]
$ flyctl ssh console -a packgo-travel -C "sh -c 'echo VAL=[\$STRIPE_TRUST_DEFERRAL_ENABLED]'"
VAL=[]
$ flyctl secrets list -a packgo-travel | grep -i deferral
 PLAID_TRUST_DEFERRAL_ENABLED              │ d8c5ac2e11c8e492 │ Deployed
 PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS │ b134196ffeb28941 │ Deployed
```

- `STRIPE_TRUST_DEFERRAL_ENABLED` = 未設 → OFF ✓（符合「F2 新 flag OFF」的預期）。
- `PLAID_TRUST_DEFERRAL_ENABLED` = `true` → **ON** ✗（與本走查任務「兩個遞延 flag 都 OFF」
  的前提不符）。且以 deployed Fly secret 形式存在。

文件互證（存在內部不一致，如實記錄）：
- `feature-flags.md`（v808，2026-07-10）：PLAID flag 預設 **OFF**，翻轉條件「CPA 對信託遞延
  整體口徑點頭 + Jeff 裁決」，且「本批不翻」。
- `progress.md:281-282`：程式設計假設「PLAID flag 維持預設 off」，並註「current-state.md 自己
  都寫 prod 上 PLAID flag 實際值『未知』」。
- `progress.md:690-691`（F1 走查，2026-07-09）：已實測記錄 `PLAID_TRUST_DEFERRAL_ENABLED=true`
  並註「（塊B 既有，非本批）」。

結論：PLAID flag ON 是 **F2 之前既有的常態**（非 v808 引入的回歸），F1 走查已觀測到。
但它意味 CST §17550 的 Plaid 信託遞延主開關目前在 prod 是開的（trustDeferralEnabled()=true，
isAnyTrustDeferralEnabled()=true）——Plaid 信託帳入帳會走遞延、認列路徑會啟用。這與
feature-flags.md 的「預設 OFF／本批不翻」表述、以及本任務「兩個 flag 都 OFF」的前提相矛盾。

需 Jeff 確認：(a) PLAID flag ON 是否為你先前刻意翻的（塊B/Phase 4 上線）而非殘留；
(b) 若是刻意，請把 feature-flags.md 與 current-state.md 的「預設 OFF／值未知」敘述更正為
「prod = ON」，消除文件自相矛盾。走查未對此做任何改動（唯讀）。

### 4. Square 謂詞命中率 — 待 Jeff（無現成唯讀端點，未新建）

盤點結果：Square 撥款謂詞在 `server/services/processorPayoutMapping.ts`
（`findSquarePayoutSaleCandidates`，171 行）＋ LLM square_payout 後衛（塊D P1），
但 server/_core/index.ts 的 admin HTTP 端點清單中，**沒有**任何唯讀端點會列出
bankTransactions 的 Square descriptor 或回報謂詞命中率：

```
$ grep -noE 'app\.(post|get)\("/api/[a-z0-9/_-]+"' server/_core/index.ts
  .../api/admin/backfill-bank-transaction-links   (link 引擎, dry_run)
  .../api/admin/backfill-stripe-payout-declassify (Stripe 誤分類, dry_run)
  .../api/admin/trust-transfer-detect
  ...（無 square 專用唯讀列表端點）
```

`bankTransactionLinks.pendingSummary` 是唯讀 tRPC，但走 admin session 驗證（非
LOCAL_SCRIPT_TOKEN），走查端無法呼叫。

依派工指示，不為此新建端點。註記：**需 Jeff 開 /ops/finance 看「待認領卡」上的 square
撥款候選註記**（F3 駕駛艙塊A 的待認領格接的是 prod 真源 320 筆／$447,732）。

### 5. /ops/finance 煙霧 — PASS

```
$ curl -s -o /dev/null -w "HTTP %{http_code} size=%{size_download}\n" https://packgoplay.com/ops/finance
HTTP 200 size=6000
$ curl ... -A "...Googlebot/2.1..." https://packgoplay.com/ops/finance
HTTP 200 size=6000
```

SPA shell 200、bot-prerender（Googlebot UA）200 可及。UI 細節（真相列四格數字、Trust 格
口徑）留 Jeff 親驗。

### 6. 看門狗 trustInvariantWatchdog — PASS（排程，下次首跑 2026-07-13 12:00 UTC）

掛點：`trustInvariantWatchdog` 由每週 correctness 稽核觸發——
```
# server/_core/weeklyCorrectnessAudit.ts:500-501
await import("../services/trustInvariantWatchdog");
const [ ... , trustInvariant] = await Promise.all([ ... ]);
```
排程（server/queue.ts:1021-1038）：
```
repeat: { pattern: "0 12 * * 1" }   // weekly, Monday 12:00 UTC
```

今日 UTC = 2026-07-11（週六；Jeff 端 local 為 2026-07-10）→ **下次首跑 = 2026-07-13（週一）
12:00 UTC**。看門狗為唯讀不變式檢查（僅 drift 時發一張 drift 卡到 agentMessages，
trustInvariantWatchdog.ts:199），偵測到偏離才寫卡，平時不寫。**未手動觸發**（依指示）。

說明：以上為程式碼排程；Redis 內 repeatable job 的實際註冊狀態未另行查證（需 Redis 讀取，
超出唯讀 ssh 範圍）。scheduleWeeklyCorrectnessAudit 於服務啟動時註冊。

---

## 總表

| 項 | 判定 | 一句話 |
|---|---|---|
| 1 migration 0114 | PASS | journal 已登記＋release「complete」＋端點查 transferredAt 正常，兩新欄已在 prod |
| 2 transfer-detect dry_run | PASS | 全 0 no-op，reminderPosted:false，未寫入，無意外 backfills/overdue |
| 3 flag OFF 探針 | 待 Jeff | STRIPE=unset(OFF)✓；PLAID=true(**ON**)✗——F2 前既有常態，但與文件/前提矛盾，請確認並更正文件 |
| 4 Square 謂詞命中率 | 待 Jeff | 無唯讀端點；未新建；請開 /ops/finance 看待認領卡 square 候選註記 |
| 5 /ops/finance 煙霧 | PASS | 200 + bot-prerender 200 可及 |
| 6 看門狗 | PASS | 排程週一 12:00 UTC，下次首跑 2026-07-13 12:00 UTC，未手動觸發 |

最需 Jeff 注意：第 3 項——prod 的 `PLAID_TRUST_DEFERRAL_ENABLED=true`（CST §17550 Plaid
信託遞延主開關目前是開的）。非 v808 回歸，但 feature-flags.md／current-state.md 仍寫
「預設 OFF／值未知」，兩者需對齊；請確認 ON 為刻意狀態。
