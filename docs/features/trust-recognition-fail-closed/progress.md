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
| B1.1 施工(Codex 6.5 五完成線) | 完成 2026-07-12(opus 執行):機械閘 trustTransferWriteGate 硬 false 強制 dry-run、manual_backfill blocked、端點 confirm/manual_backfill 403、中性文案+LA 曆日、!db throw、守門擴 .mjs/.js/.cjs/.sql+scripts/、worker processor 抽出+整合測試 | tasks/03 + 本表下 |
| B1.1 對抗審查 | 完成 2026-07-12:fresh opus PASS 零阻塞(三寫入點全在閘後、mock 不入產線圖、端點 body 覆寫無效、LA 無 off-by-one 逐一驗);1 觀察級遞延:en.ts trustNote/trustNoteEq「recognized (departed)」非本 diff,列 backlog | 審查報告收於指揮 session |
| B1.1 指揮驗收 | 完成 2026-07-12:親跑 trust 10 檔 133 綠、i18n 551 綠、tsc 0 錯、grep 僅 2 呼叫點皆 dryRun:true+催轉語 0 命中;機械閘/worker/scan diff 逐行親讀 | 本表下方交付 |

## 交付內容(evidence_reference)

- 服務層:server/services/trustDeferralService.ts — recognizeReadyDepartures 移除改 scanRecognitionDue(純掃描,零寫入),新增 maybePostRecognitionDueCard(agentMessages 待審卡,同集合去重,Redis 讀失敗照出卡,絕不 throw)。
- 守門測試:server/services/trustDeferralService.failClosed.test.ts(333+ 行,13 tests)— 2a 零 update/insert、2b 旗標四組合、2c 原始碼三層掃描(字面 regex + raw SQL 賦值 + .set 區塊),2d 卡去重六 case、2e 行為改遷。紅綠自證:假 offender 檔在時 2c 轉紅。
- worker:trustRecognitionWorker.ts — 待審卡+每日 notifyOwner 待審摘要(卡去重但摘要天天發,錢的可見性不沉默);runTrustTransferDetection 原樣保留 flag 閘前。
- router:plaidRouter.trustRecognizeNow 改唯讀掃描,audit action 改 trust.recognitionScan。
- client:RecognitionCard/LedgerTrust 拆確認寫入閘改唯讀掃描;i18n 雙語 parity 綠。
- 舊後門:server/scripts/test-phase4-e2e.mjs 的 raw UPDATE recognizedAt 改為零寫入掃描語意。

## 已知狀態(Jeff 須知)

- 認列現為全庫零寫入路徑:「逐筆核准」端點刻意未建(等 CPA 認列矩陣),建成前認列完全停擺,P&L 已認列面只有 2026-07-12 前舊列。這是裁定的 fail-closed 態,非缺陷。
- 回滾紀律(Codex 6.5 P0.2 裁定,取代本行原「git revert 即回滾」錯誤寫法):停止線不得用恢復危險行為當回滾。不得 revert 77045fc、不得 Fly 回退到含自動認列的版本(v811 含);一律 forward-fix;前端壞只回退前端;若被迫整體退版,必須先讓 Trust worker 無法執行舊認列路徑並凍結相關 P&L/稅務輸出。
- Codex 6.5 獨立複核(2026-07-12):B1 窄目標通過,完整信託停止線退回 B1.1(P0.1 transfer detection 仍動錢、P0.2 回滾復活、P1.1 假已出發、P1.2 守門漏 .mjs/.js/.sql、P1.3 DB 不可用偽裝零筆、P1.4 報表未定稿標示)。B1.1 五項完成線見 tasks/03-b1.1-codex-blockers.md。
