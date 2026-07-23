# B1 信託認列 fail-closed(design)

> 指揮親核事實錨點(2026-07-12):
> - 自動寫入唯一點:`server/services/trustDeferralService.ts:713-719`(recognizeReadyDepartures 內 `set({ recognizedAt: new Date(), recognitionRunId })`)。
> - 非測試呼叫端只有兩個:`server/trustRecognitionWorker.ts:74`(每日 cron)、`server/routers/plaidRouter.ts:2092`(trustRecognizeNow adminProcedure,前端兩處用:RecognitionCard.tsx、LedgerTrust.tsx)。
> - 卡機制:看門狗 `server/services/trustInvariantWatchdog.ts:178` insert agentMessages,同值去重走 Redis,讀失敗照出卡。
> - 看門狗漂移 = 餘額 − 遞延加總;列維持未認列則遞延加總不變,不與本改動打架。

## 核心決策

1. 單一咽喉點法:把寫入從 `recognizeReadyDepartures` 函式體整個移除,函式改為
   純掃描 propose-only。不加參數、不加旗標讓它復活;沒有任何 caller 能要求它寫。
2. 函式改名 `scanRecognitionDue`(舊名 export 移除,靠 tsc 抓漏網 caller)。
   回傳 `{ runId, scanned, dueForReview, dueRows[], skipped* }`;dueRows 每筆含
   id/amount/bookingId/expectedRecognitionDate。舊欄位 recognized/totalRecognizedAmount
   從型別移除(queue.ts TrustRecognitionJobResult 同步改),讓殘留讀取端變編譯錯,逐一改掉。
3. 待審卡:worker 掃到 dueForReview > 0 時 insert agentMessages 卡(照看門狗模式),
   內容列每筆 id/金額/booking/到期日 + 「等 CPA 認列矩陣核准後由 Jeff 逐筆核」。
   去重:due 集合(排序後 id+amount 串雜湊)不變期間不重複出卡,集合變化才再出;
   Redis 讀失敗照出卡(合規寧可偏吵,同看門狗)。notifyOwner 摘要保留但文案改
   「待審」,絕不出現「已認列/該轉了」誤導語。
4. trustRecognizeNow 端點:同一服務改掃描語意,回待審清單,零寫入。audit 記
   `trust.recognitionScan`(改 action 名,舊 `trust.recognizeNow` 語意已不真)。
   前端 RecognitionCard/LedgerTrust 改文案:按鈕=「掃描到期待審」,顯示清單,
   移除「認列」動詞與 🔒 confirm 的寫入暗示;i18n 雙語同步。
5. F2 轉帳偵測(`runTrustTransferDetection`,flag 閘之前)不動:對象是歷史已認列列。

## 資料流(改後)

每日 cron / Jeff 按鈕 → scanRecognitionDue(唯讀掃描,含既有四類 skip 統計)
→ dueRows → agentMessages 待審卡(去重)+ notifyOwner 摘要 → Jeff 看卡。
recognizedAt 永遠不被本路徑寫入。全庫唯一合法寫入者:未來的逐筆核准批次(未建)。

## 測試釘死(不變量,60 §3 第 2 層)

1. 造「到期+已配對+未取消」的遞延列,跑 scanRecognitionDue → recognizedAt 仍 NULL,
   dueForReview 正確計數。
2. 旗標矩陣:PLAID/STRIPE 四種組合下跑 worker 處理函式 → 全庫 recognizedAt 寫入為零。
3. mode 復活防護:grep 產線碼(排除 tests)`recognizedAt: new Date` 或 `set({ recognizedAt`
   命中數為 0 的守門測試(讀原始碼斷言,防未來回加)。
4. 卡產出:dueForReview > 0 → agentMessages 有卡;同集合第二次跑不重複出卡。
5. 既有測試改遷:原斷言「會認列」的測試改斷言「不認列+進待審」,不得刪測試了事。

## 影響面盤點(executor 必逐一確認)

- queue.ts:TrustRecognitionJobResult 型別、worker 回傳。
- trustRecognitionWorker.ts:通知文案兩段(認列成功段刪除,改待審卡段)。
- plaidRouter.ts:trustRecognizeNow(語意改)+ 其 audit。
- client:RecognitionCard.tsx、workspaceLedger.helpers.ts、LedgerTrust.tsx、zh-TW.ts、en.ts。
- 讀取端(bankPLService/trustOutstandingSplit/trustTransferDetection/看門狗)只讀
  recognizedAt,不受影響,但 executor 要 grep 確認沒有第二個寫入點/隱藏 caller。
- 測試檔:trustDeferralService*.test.ts 及任何引用 recognizeReadyDepartures 的測試。
