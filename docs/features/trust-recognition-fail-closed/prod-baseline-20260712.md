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

## 部署後驗證線(照 Codex 6.5 第七節)

1. ship 後手動掃描一次(trustRecognizeNow 或等 cron):dueForReview 可產生(預期 0,三筆皆 unmatched 走 skippedNotMatched),recognizedCount 仍 0、maxRecognizedAt 仍 null。
2. 次日排程再驗一次,同標準。
3. 全過才標「已部署且運行驗證」。記 Git SHA、Fly release、排程時間、查核結果。
