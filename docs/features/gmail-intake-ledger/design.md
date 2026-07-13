# gmail-intake-ledger(design)— Codex 11 輪九點契約固化

> 指揮親核事實錨點:查詢組裝 _core/gmail.ts:198-201(is:unread);watch 註冊 _core/gmail.ts:1044-1065,
> 呼叫點 gmailOAuth.ts:63 + gmailPushWorker.ts:132(每日 renew 排程在 queue.ts:760),兩處 topic 缺=靜默 return;
> prod GMAIL_PUBSUB_TOPIC=false(機上親測);failed 累加 gmailPipeline.ts:314/:821,catch 在 :534/:621,
> 失敗不蓋標籤靠 unread 重試(被讀即停)。lastHistoryId 欄位已存在(gmailIntegration)。

## 1. Schema(tracked migration,禁 runtime DDL)

新表 gmailIngestionLedger:
- id PK、integrationId、gmailMessageId(128)、gmailThreadId(128)、gmailHistoryId(100,可空)、
  internalDateMs bigint、fromAddress(320)、source enum(history/push_wake/fallback_scan/backfill)、
  status enum(pending/processed/ignored/failed)、failureKind(64,可空)、errorDetail(512,截斷,禁 PII 內容)、
  httpStatus int 可空、retryCount int default 0、nextRetryAt、firstSeenAt、lastAttemptAt、processedAt、
  interactionId int 可空(落成 interaction 後回填)。
- UNIQUE(integrationId, gmailMessageId)= message 級冪等鍵(同 thread 每封新信是獨立商業事件)。
- 不存 subject/body/附件任何內容;fromAddress 為 eligibility 判斷必要最小欄。

gmailIntegration 加欄:lastSuccessfulSyncAt timestamp 可空;intakeMode enum(legacy/shadow/history) default legacy
(逐 mailbox 開旗標的機制;shadow=History 路徑跑+寫 ledger 但不餵下游不貼標,與 legacy 並行對照)。

## 2. 同步引擎(權威路徑)

- 每 integration 單一 writer:Redis lock + fencing token(鎖值=token,寫游標前驗 token)。
- history.list 自 lastHistoryId 完整分頁(historyTypes=messageAdded;不得對 historyId 做加減推算)。
- 順序鐵律:全部 pages 收完 → 候選過 eligibility → 逐筆 INSERT IGNORE 進 ledger(耐久)→
  CAS 推游標(UPDATE gmailIntegration SET lastHistoryId=new, lastSuccessfulSyncAt=NOW()
  WHERE id=? AND lastHistoryId=old)。CAS 失敗=有並發 writer,放棄本輪不覆蓋較新游標。
- 任一候選未耐久入帳 → 游標不得前進;崩潰後重抓由唯一鍵去重(at-least-once)。
- History 404(游標過舊)→ bounded full sync:以 lastSuccessfulSyncAt−24h 起 -label 查詢全分頁掃描
  → 全候選落 ledger → 用 getProfile 取新 historyId 當基準;禁止直接把游標跳到現在而不掃缺口。
- push(Pub/Sub)只喚醒:訊息 → 耐久排隊(BullMQ job 落 Redis)成功後才 ack;重送冪等(ledger 唯一鍵)。
- 定期排程(既有 3 分鐘 poll 位置)同走 History 路徑;unread 查詢在 history/shadow 模式下不再用於發現。

## 3. 下游處理

- ledger pending → 既有 processOneEmail 鏈 → status=processed(+interactionId)/ignored(noise,記 failureKind=noise 類別)/failed。
- failed:分類(llm/db/gmail_api/attachment/auth/unknown)+httpStatus+retryCount+指數退避 nextRetryAt+
  超閾(3 次)出人工卡;重試不回退游標;terminal 狀態必有。
- Gmail label=提交後副作用:失敗重試,不影響 DB 事實;人工移除標籤不得造成重複建單(ledger 鍵擋)或藏信。

## 4. 對帳 tripwire(D,Codex 版)

每 5 分鐘每 integration:同一份 eligibility 規則(單一函式,history/fallback/對帳三方共用)做 set difference:
1. 合格新信>10 分鐘無 ledger 紀錄 → P1 卡。
2. pending/failed>30 分鐘 → P1 卡。
3. last successful history sync>10 分鐘 → 通道 P1。
4. watchExpiration NULL/已過期 → 立即 P1;<24h → warning。
事故指紋=integrationId+failureKind+firstMissingMessageId;同指紋更新同卡,60 分鐘最多再提醒一次;
恢復自動關卡並記持續時間與缺件數。

## 5. watch 生命週期

啟動註冊+每日提前續期(排程已存在)+watchExpiration/historyId 落庫;NULL/過期/續期失敗/連續無 push
皆走 §4 告警。兩 integration 各自驗證。GCP topic 建立與 GMAIL_PUBSUB_TOPIC 設定=Jeff 手動
(runbook: docs/features/customer-cockpit/gmail-push-runbook.md),缺 topic 時告警不再靜默。

## 6. 十攻擊面(executor 逐項設防+測試,Codex 11 輪 §五)

1 bootstrap:首啟無 lastHistoryId → getProfile 建基準+起始 fallback 掃描一輪。2 多頁未落庫游標先進(順序鐵律+測試 page-2 crash)。
3 雙 worker 競爭覆蓋新游標(fencing+CAS)。4 thread 級去重吃新信(message 鍵)。5 DB/label 兩序皆安全(測試)。
6 Pub/Sub 先 ack 後落庫(先排隊後 ack)+重送+延遲。7 自寄/轉寄/auto-reply/bounce 循環(eligibility 排除,沿既有 own-email 邏輯)。
8 已讀/封存/刪除/filter 搬移=eligibility 漂移(單一 eligibility 函式)。9 OAuth 撤銷/401/403/429/5xx 分類退避+dead-letter(failed 終態)。
10 兩 integration 資料隔離;附件與個資不進 log/卡/證據。

## 7. 本批邊界

單一 mailbox(jeffhsieh09 線,問題發生地)shadow 模式起;legacy poll 原樣保留(shadow 對照期的安全網);
支援 intakeMode 切 history 的程式路徑完成但預設不切,切換=Jeff 裁(v814 部署後逐信箱)。
E backfill 與 136 分類表=獨立唯讀工具(dry-run 輸出 metadata 清單),不自動建單。
