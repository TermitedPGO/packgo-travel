# Task 01:server 端 fail-closed(單一 opus 批)

- [ ] trustDeferralService:recognizeReadyDepartures → scanRecognitionDue,移除 recognizedAt/recognitionRunId 寫入,回傳 dueRows 清單
- [ ] 型別:RecognizeReadyResult → ScanRecognitionDueResult;queue.ts TrustRecognitionJobResult 同步;移除 recognized/totalRecognizedAmount 欄位
- [ ] trustRecognitionWorker:改呼叫 scanRecognitionDue;dueForReview>0 → agentMessages 待審卡(照 trustInvariantWatchdog.ts:150-196 模式,Redis 同集合去重,讀失敗照出卡)+ notifyOwner 待審摘要;刪「已認列該轉了」通知段
- [ ] plaidRouter.trustRecognizeNow:改掃描語意零寫入,audit action 改 trust.recognitionScan
- [ ] grep 全 server 確認無第二寫入點、無漏網 caller(tsc 抓 + grep 雙保險)
- [ ] 測試:design.md 五條釘死全綠;既有認列測試改遷不刪
- [ ] tsc --noEmit 0 錯(OOM 用 NODE_OPTIONS="--max-old-space-size=6144")

# Task 02:client 待審文案(同批)

- [ ] RecognitionCard.tsx:按鈕與卡文案改「掃描到期待審」,顯示待審清單,移除認列寫入暗示
- [ ] LedgerTrust.tsx + workspaceLedger.helpers.ts:認列卡改待審卡口徑
- [ ] i18n:zh-TW.ts + en.ts 新 key 同步,JSX 無硬編碼中文
- [ ] 圓角紅線自檢(改到的 UI 元素)
