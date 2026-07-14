# B1/B1.1 部署前 prod 基準(Codex 6.5 第七節第 1 步)

- 時間:2026-07-12T23:53:53Z(UTC)
- 核准:Jeff 同日核准(紅線 9:prod 診斷唯讀+核准+留 audit;本檔即 audit reference)
- 通道:flyctl ssh console -a packgo-travel -C "sh -lc 'node'" < probe.cjs(同 sqlRehearsalGate 已驗證通道;DATABASE_URL 只在機上 env,不進命令列)
- 探針:單一 SELECT 聚合,去識別,零 PII。原擬加 SET SESSION TRANSACTION READ ONLY,TiDB noop 拒絕(未開 tidb_enable_noop_functions),唯讀由構造保證(無任何寫語句),誠實記。
- 部署版本狀態:探針時 prod 仍為 v811(B1/B1.1 未部署);origin/main 已在 46707896。

## 基準數字(trustDeferredIncome 全表聚合)

| 指標 | 值 |
|------|-----|
| totalRows | 3 |
| recognizedCount | 0 |
| maxRecognizedAt | null |
| reversedCount | 0 |
| transferredCount | 0 |
| maxTransferredAt | null |
| pendingCount(未認列未沖銷) | 3 |

與 A3 對帳一致:三筆信託訂金皆 unmatched(bookingId NULL),從未被自動認列。
另一含義:prod 目前不存在任何歷史已認列列,transfer detection 現況本就無回填對象;B1.1 機械閘是對未來的防護,非清理現況。

## 部署後驗證線(照 Codex 6.5 第七節;oracle 依 6.7 校正)

1. 正式 cron 或手動掃描:recognizedCount 仍 0、maxRecognizedAt 仍 null、transferredCount 仍 0。
2. cron oracle(Codex 6.6/6.7 抓出我原寫 skippedNotMatched=3 是錯的;指揮 02:40Z 擴充探針親證三筆 expectedRecognitionDate 與 bookingId 皆 NULL,掃描先判日期):
   scanned=3、dueForReview=0、skippedNoDepartureDate=3、skippedNotMatched=0、skippedCancelledBooking=0;job completed 非 failed;無「請轉出」通知。
3. 次日同一排程再驗一次,全過才標「控制已運行驗證」。記部署 SHA、Fly release、排程時間、查核結果。

## 探針 audit(6.6 要求留 exact SELECT)

單條去識別聚合(無 PII、無寫語句):
SELECT COUNT(*), SUM(recognizedAt IS NOT NULL), MAX(recognizedAt), SUM(reversedAt IS NOT NULL), SUM(transferredAt IS NOT NULL), MAX(transferredAt), SUM(recognizedAt IS NULL AND reversedAt IS NULL), SUM(expectedRecognitionDate IS NULL), SUM(bookingId IS NULL) FROM trustDeferredIncome
(CASE 寫法同義;通道 flyctl ssh stdin node,DATABASE_URL 只在機上 env。)

## 執行紀錄

- 2026-07-13T00:14Z 前後:Jeff pnpm ship → v812 complete(flyctl releases 核)。v812 image SHA = ae0ea9d4;其後的 6f09ba0d/後續為部署後證據文件 commit,不在 v812 image 內,分開記(6.7 §一.3)。ship 時 LOCAL_SCRIPT_TOKEN 未載入,ship 側煙霧跳過。
- 補驗:Codex 以正式機上既有 token 執行同一 authenticated deploy-smoke,HTTP 200、ok=true、八臂全綠(6.7 §一.5;token 值不記錄)。
- 2026-07-13T02:23:20Z 部署後比對探針:與部署前基準逐項相同,部署本身零信託狀態寫入。/health 四項全 ok。狀態=「部署後即時資料不變驗證 PASS」(6.7 校正措辭;非「控制已運行驗證」,worker 尚未跑)。
- 2026-07-13T02:40:55Z 擴充探針:noExpectedDateCount=3、noBookingCount=3,親證 6.6/6.7 的 cron oracle 正確、我原 oracle 錯誤。
- BullMQ 現場唯一 trust-recognition-daily repeatable job,pattern 0 6 * * *,next=2026-07-13T06:00:00Z(6.7 §一.6,Codex 現場核)。
- 2026-07-13T06:00:00Z cron 首跑(監看窗 05:57-06:13Z 自動收):worker log 原樣「scan run=cron-repeat:...:1783922400000-... scanned=3 dueForReview=0 skippedNoDate=3 skippedNoMatch=0 skippedCancelled=0」+「✅ ... 0 due for review」;job completed 非 failed;無「請轉出」通知;transfer detection 零輸出(=零回填零催促)。五項計數與 oracle 完全一致。
- 2026-07-13T06:13:07Z cron 後探針:與基準逐項相同(recognizedCount 0/maxRecognizedAt null/transferredCount 0/pendingCount 3)。
- 裁定:首次 worker 運行驗證通過(6.7 §三四條全中)。「控制已運行驗證」仍待次日 06:00Z 第二輪同標準複驗。原始 log 檔:scratchpad cron-window-trust.log(session 暫存,關鍵行已原樣抄錄於上)。

## 第二輪 cron 驗證(2026-07-14T06:00Z)

- 收證方式誠實記:長 sleep 監看程序死亡(疑機器休眠),log 緩衝回不到事發點;改讀 BullMQ completed job 回傳值(耐久紀錄,證據等級高於 log)。
- job repeat:...:1784008800000,finishedOn 2026-07-14T06:00:00.339Z,returnvalue 原樣:scanned=3 dueForReview=0 dueRows=[] skippedNoDepartureDate=3 skippedNotMatched=0 skippedCancelledBooking=0;failedReason null。與 oracle 完全一致。
- 06:31:15Z 探針:recognizedCount 0、maxRecognizedAt null、transferredCount 0、pendingCount 3,與基準逐項相同。
- 附帶佐證:BullMQ 歷史 completed jobs 顯示 07-11/07-12(v811 舊碼)同樣 recognized=0 — 三筆自始未被自動認列。
- 裁定:第二輪同標準通過,第三層運行證據完成。B1/B1.1 於 v812 = 「已部署且運行驗證」(待 Codex 複核蓋章)。v813(B1.2)ship 條件=Codex 複核+審查閘綠(待傳信結案)。
