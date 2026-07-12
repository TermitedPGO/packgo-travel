# B1 trust-recognition-fail-closed progress

| 階段 | 狀態 | 證據 |
|------|------|------|
| Stage 1 proposal | 完成 2026-07-12 | proposal.md |
| Stage 2 design | 完成 2026-07-12(指揮親核錨點:寫入唯一點 716、caller 兩個、卡機制 watchdog:178) | design.md |
| Stage 3 tasks | 完成 2026-07-12 | tasks/01 |
| Stage 4 施工 | 完成 2026-07-12(opus 執行,T6 報告收) | 見下方交付 |
| 對抗審查 | 完成 2026-07-12:fresh opus PASS 無阻塞;2 低風險發現已收(守門 regex 三層化+e2e 腳本去後門,sonnet 小修+紅綠自證) | 審查報告收於指揮 session |
| 指揮驗收 | 完成 2026-07-12:指揮親跑 grep 0 命中、tsc 0 錯、trust 8 檔 121 綠、i18n parity 3 檔 551 綠;錢路徑 diff 逐行親讀 | 本表下方證據欄 |
| commit | 已提交(hash 見 git log 本資料夾首個 commit) | — |
| 部署後觀察一輪零自動認列 | pending(等 Jeff pnpm ship 後次日 cron;查法:prod 唯讀查 trustDeferredIncome 無新 recognizedAt + worker log dueForReview) | — |

## 交付內容(evidence_reference)

- 服務層:server/services/trustDeferralService.ts — recognizeReadyDepartures 移除改 scanRecognitionDue(純掃描,零寫入),新增 maybePostRecognitionDueCard(agentMessages 待審卡,同集合去重,Redis 讀失敗照出卡,絕不 throw)。
- 守門測試:server/services/trustDeferralService.failClosed.test.ts(333+ 行,13 tests)— 2a 零 update/insert、2b 旗標四組合、2c 原始碼三層掃描(字面 regex + raw SQL 賦值 + .set 區塊),2d 卡去重六 case、2e 行為改遷。紅綠自證:假 offender 檔在時 2c 轉紅。
- worker:trustRecognitionWorker.ts — 待審卡+每日 notifyOwner 待審摘要(卡去重但摘要天天發,錢的可見性不沉默);runTrustTransferDetection 原樣保留 flag 閘前。
- router:plaidRouter.trustRecognizeNow 改唯讀掃描,audit action 改 trust.recognitionScan。
- client:RecognitionCard/LedgerTrust 拆確認寫入閘改唯讀掃描;i18n 雙語 parity 綠。
- 舊後門:server/scripts/test-phase4-e2e.mjs 的 raw UPDATE recognizedAt 改為零寫入掃描語意。

## 已知狀態(Jeff 須知)

- 認列現為全庫零寫入路徑:「逐筆核准」端點刻意未建(等 CPA 認列矩陣),建成前認列完全停擺,P&L 已認列面只有 2026-07-12 前舊列。這是裁定的 fail-closed 態,非缺陷。
- 回滾法:git revert 本批 commit 即回復自動認列(不建議;回滾須 Jeff 裁決)。
