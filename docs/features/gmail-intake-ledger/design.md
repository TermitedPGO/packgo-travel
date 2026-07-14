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
(逐 mailbox 開旗標的機制;shadow=History 路徑跑+寫 ledger 但不餵下游不貼標,與 legacy 並行對照——
即「新增 ledger shadow 路徑零新增商業副作用,legacy 仍是唯一 writer」,不是「shadow 模式零副作用」,
見 §八)。

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

## v2 修正(Codex 12 輪退回兩結構 P0,取代 §2 的部分設計)

### P0-1 ledger 先於分類(唯一事實源)
- 發現即入帳:History 每頁收到 messageAdded → 立即 INSERT IGNORE pending ledger(僅 integrationId/gmailMessageId/gmailThreadId/gmailHistoryId/source;fromAddress 改可空,metadata 後補)。eligibility 不再擋入帳。
- 分類移到下游:classification 階段補抓 headers → route enum(customer/receipt/noise/self_or_outbound/manual_review)+終態。noise 也留稽核態,不得在 ledger 前消失。原 gmailEligibility 邏輯改為分類器的輸入。
- 收據(12 輪 §五裁定):單一發現入口+receipt route。receipt classifier 在 noreply/noise 終態之前跑;route=receipt → 既有收據 handler(history 模式);shadow 只記 would_route 與 legacy 比對,legacy 仍是唯一商業副作用 writer;正式切換才停 legacy receipt scanner,以 gmailMessageId/既有外部鍵防雙寫。拒絕永久雙掃描器。
- 0117 尚未套用於任何 DB:migration 就地修訂(fromAddress 改 NULL、加 route/classifiedAt/wouldRoute 欄),註記修訂原因。

### P0-2 liveness(截斷不得變永久飢餓)
- 發現量無上限:cap 只限下游處理批量,不限事件發現。
- 逐頁推進:每頁全部 messageId 耐久落帳後,官方游標可 CAS 推進到「已落帳前綴」的該頁 historyId;絕不推過未落帳頁。crash 從上次前綴重跑,唯一鍵去重,無前頁循環。
- 測試:backlog>3×cap 多輪收斂(每 messageId 最終入帳、tail 可達、backlog 歸零、零重複、游標僅隨完整前綴推進)、page-2 crash、continuation 失效重跑。
- 冪等邊界明示(Codex 16 輪對抗審查):row claim + token-gated 寫回保證的是 ledger 終態恰一次;下游商業副作用本質 at-least-once —— 心跳續租失效的極端窗口(單封超租且 peer 重搶)同一封信可能兩次進 downstream.process,去重依賴 §3/§5 既有要求的下游 external-id 冪等(processOneEmail/收據鏈以 gmailMessageId/既有外部鍵去重),此依賴為切片外保證,不得移除。

### v814 狀態梯(12 輪 §七,照抄為紀律)
code review(現在)→ inert deploy(旗標全關+migration rehearsal/manifest/smoke/forward-fix 齊)→ shadow(兩 P0+receipt route 修好+證明零回信零建單零貼標零收據寫入)→ authoritative(兩信箱 parity+30 天 dry-run+136 分類+watch 運行證據,逐信箱)。
migration 證據要求:production-like TiDB fresh+existing 各實跑、schema probe 讀回、耗時/鎖表/forward-fix/回退保表安全性紀錄。

## v3 修正(Codex 18 輪切片1.5 退回三阻塞 + scan floor 窄修,取代 §2 / v2 對應語義)

### P0-1 事件消耗水位 = 三值數值 MAX(不是 COALESCE-first-non-null)
- requeue 閘門:incoming label 事件 id 必須嚴格大於「lastRequeueEventId、lastSeenHistoryId、
  scanConsumedFloor 三者非 NULL 值的數值最大值」(NULL-safe GREATEST-COALESCE)。v5 的
  `COALESCE(lastRequeueEventId, lastSeenHistoryId)` 只取第一個非 NULL,不是 MAX——反例
  lastRequeue=E10、lastSeen=E30、label=E20 會誤重排;MAX(E10,E30)=E30,E20 不 >E30,正確不重排。
- 三者皆 NULL(NULL 分支)獨立處理不混入:X>NULL→NULL→不重排(fail-closed),不把 NULL 當 '0' 兜底。
- 正式 SQL(gmailIntakeAdapters.ts requeue WHERE)與 FakeStore 同語義;精確紅綠 fixture:E10/E30/E20。

### P0-2 404 recovery baseline-first(掃描中新信零永久遺失)
- 照 bootstrap 先例:404 後先 getMailboxHistoryId 取 baseline B → 完整 scan 逐頁耐久落帳 →
  drained 且 fencing token 有效才把 cursor 寫 B。scan 期間抵達的新信(event > B)留給下一輪
  History,唯一鍵吸收重複。舊順序(先掃後取 head)會把 cursor 跳過掃描中新信 → 永久漏接。

### P0-3 authoritative 硬閘旁路封死(雙/三層)
- gate 下沉:orchestrator(runIntakeStages)前置 guard 保留;feedPendingDownstream 本體、
  runDownstreamForLedgerMessage sink 層各加 authoritative gate,gate=false 一律零副作用 return/throw。
- legacy pipeline 重讀 mode:runGmailPipeline / runGmailPipelineForMessageIds 重讀 integration 後
  mode=history → 在建 Gmail client / ensureLabel / DB / LLM / 任何副作用之前 fail-closed(去重告警卡)。
- gmailRunNow 按 mode 路由:history 只走 ledger engine(仍受 sink gate);legacy/shadow 走 legacy。
- push worker 修 fail-open:DB 不可用或 integration 查不到時停止+告警,不猜成 legacy。
- source call-site guard:runDownstreamForLedgerMessage / feedPendingDownstream 呼叫點只允許白名單檔案。
- authoritative 翻閘前的 mode epoch / active-job drain 註記為未來批,不在本切片。

### scan floor(§七,'0' 兜底棄案)
- schema.ts + 0117 就地加 `scanConsumedFloor` VARCHAR(100) NULL(down 隨 DROP TABLE)。
- scan/bootstrap 掃描前 capture 的 baseline B 持久寫入 scan-created row 的 scanConsumedFloor
  (不冒充 lastSeenHistoryId);重排條件納入第三水位(見 P0-1 的 MAX)。四案測試:scan row+真新
  label(>floor)重排恰一次、同 event replay 不動、較舊 label(<floor)不動、messageAdded 建列不受影響。

## §八 shadow 語義固定措辭(不得漂移)

成立的是:**「新增 ledger shadow 路徑零新增商業副作用,legacy 仍是唯一 writer」**。
不成立的是:「整個 shadow 模式零副作用」——poll 與 push 在 shadow 仍刻意執行 legacy writer
(既定的並行對照設計,是既有正常副作用,不是硬閘失效)。design.md 與相關測試描述一律用前一種
說法,避免日後把 legacy 正常副作用誤認為 hard gate 失效,或把 hard gate 旁路藏在「shadow 本來就
有副作用」裡。
