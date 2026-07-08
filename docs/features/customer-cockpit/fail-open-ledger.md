# fail-open 全面盤點 — Wave1 塊D

> 硬化戰役 Wave1 塊D(2026-07-08)。派工單 `dispatch-wave1.md`,母計畫 `hardening-plan.md`。目標:枚舉 server/ 底下所有 catch/`.catch(` 吞錯誤的地方,逐一分類「這個失敗被吞掉之後,Jeff 該不該知道」,把真正該浮出卻沒浮出的接上 `server/_core/errorFunnel.ts`(Wave1 塊B)的漏斗。

## 數字紀律(對帳)

枚舉指令(2026-07-08,Wave1 塊A-C 已落地後的基線):

```
grep -rnE "\\bcatch\\s*\\(|\\.catch\\(" server --include="*.ts" | grep -v "\\.test\\.ts" | wc -l
```

grep 總數:**873**。ledger 條目數:**873**。**對帳成立(873 = 873)**。

**重要方法論說明(避免未來重跑此 grep 對帳時誤判)**:本批塊D 自己的接線動作(每一處高風險 A 類新增 `reportFunnelError({...}).catch(() => {})`)本身會被同一條 grep 指令算成一個新的 `.catch(` 命中。因此塊D 收工後(接線完成)若重跑同一條 grep,總數會膨脹到約 1002(873 + 129 個新接線點),**這不是本次枚舉漏掉了 129 筆** —— 是這次枚舉自己的修復動作新增的 catch 站點。任何下一輪盤點要重新對帳,基線應該是「這次 ledger 收錄的 873 筆」加上「後續新增的程式碼變更」,而不是拿當下 grep 總數直接跟 873 比較。

## 分類總覽

| 分類 | 筆數 | 說明 |
|---|---|---|
| A 必須浮出 | 143 | 其中 **129** 筆屬四類高風險路徑,本批已接線;**14** 筆記帳留給 Wave4 |
| B 可以安靜 | 724 | 刻意 fail-open 設計,理由逐條記錄於下方 |
| C 爭議 | 6 | 拿不準,交指揮裁決,完整清單見下方專節 |
| **總計** | **873** | = grep 總數 873 |

## C 類清單(交指揮裁決,完整列出)

### `server/translation.ts:339`

- 吞了什麼:translateText 整體翻譯流程(含 LLM 呼叫)發生任何例外
- 拿不準的原因:catch-all 吞下所有翻譯錯誤並靜默回退原文,LLM 若長期故障會大量靜默降級且無人知曉,但也可視為合理 graceful degrade,難判斷業務重要性

### `server/_core/gmail.ts:986`

- 吞了什麼:sendReplyInThread 呼叫 Gmail send API 失敗,回傳結構化 {ok:false, error}
- 拿不準的原因:有回傳失敗信號但這批看不到上游呼叫端是否真的把 ok:false 轉告 Jeff;客人回信寄送失敗風險高,拿不準故誠實標 C

### `server/routers/photos.ts:87`

- 吞了什麼:上傳行程照片後發 Packpoint 獎勵(含更新 pointsAwarded 欄位)失敗,只 console.error
- 拿不準的原因:Packpoint 是可兌換 voucher 的準貨幣,若 awardPackpoint 已入帳但 pointsAwarded 欄位更新失敗,回傳給客人的 pointsEarned 會與實際餘額不一致,但材質金額小且不確定是否會導致重複發放,拿不準算不算 money 級風險

### `server/routers/bookings.ts:252`

- 吞了什麼:折扣金額換算回 USD 失敗時,用原始請求折抵值當備援,實際扣點數可能與真實折扣不完全對應
- 拿不準的原因:影響 Packpoint 帳務準確度但有保守備援值,金額本身不受影響,嚴重度拿不準

### `server/routers/bookings.ts:415`

- 吞了什麼:排程棄單挽回信/座位到期釋放失敗,只有 console.warn
- 拿不準的原因:若座位到期釋放排程失效,未付款訂單可能永久佔位造成庫存流失,但屬背景排程且無法判斷是否有其他兜底機制

### `server/routers/bookings.ts:778`

- 吞了什麼:組裝供應商訂單包時查詢 departure 失敗,被吞成 null,出發日期靜默變 null
- 拿不準的原因:供應商下單包缺出發日期可能影響真實下單準確度,但 admin 通常會注意到空值,嚴重度拿不準

## A 類清單(必須浮出,129 筆已接線 + 14 筆 Wave4 記帳)

### 已接線(本批,呼叫 reportFunnelError)

| file:line | 吞了什麼 | 高風險類型 | 理由 |
|---|---|---|---|
| `server/_core/caseFileImport.ts:519` | 匯入案件時單筆 customerInteractions insert 失敗,log.warn 後在迴圈內繼續 | ①客人資料流 | 整體 importCaseFile 仍回傳 status:'imported' 成功,遺失的那筆客人互動紀錄完全不會反映在結果裡 |
| `server/_core/chatLogImport.ts:410` | LLM 分類/擷取聊天記錄截圖失敗,回傳 null | ①客人資料流 | 上層 importChatLogForCustomer 把 null 轉成 status:error;主要呼叫端 ask-ops-stream 原始碼明文規定 error 狀態不特別告知 Jeff(視同不是聊天記錄的靜默處理),客人對話截圖匯入失敗但 Jeff 會以為已處理 |
| `server/_core/chatLogImport.ts:569` | classifyAndExtractChatLog 呼叫本身拋出例外 | ①客人資料流 | 回傳 status:error,同樣被 ask-ops-stream 呼叫端明文設計為靜默不告知 Jeff |
| `server/_core/chatLogImport.ts:692` | 聊天記錄整批 DB 寫入(dedup+insert 迴圈)外層失敗 | ①客人資料流 | 回傳 status:error,同樣被 ask-ops-stream 呼叫端明文設計為靜默不告知 Jeff |
| `server/_core/customerBackfill.ts:147` | 回填客人 Gmail 歷史對話時,單一 thread 同步進 customerInteractions 失敗,log.warn 後繼續下一筆 | ①客人資料流 | BackfillResult 沒有明確 failedCount 欄位,失敗的那個 thread 的客人對話紀錄就此silently消失不進客人檔案,呼應 Ann Yuan 事故型態 |
| `server/_core/customerFacts.ts:506` | 客戶駕駛艙的事實面板彙整(訂單/報價/發票/已交付文件/訂金餘款/確認訂單數)DB 查詢失敗,整包退回 EMPTY_FACTS | ②錢 | 此模組正是為了修正先前「卡片顯示與實際訂單/付款狀態不符」的舊事故而生,若靜默退回空白事實,Jeff 看到的會是誤導性的「客人尚無任何進展」,僅 log.warn 沒有主動通知 |
| `server/_core/draftEval.ts:600` | 寫入 agentMessages 摘要卡(通知 Jeff 本月草稿評分)失敗 | ③cron/部署可見性 | 這是整個月度評分機制唯一真正把結果送到 Jeff 眼前的步驟,失敗只 log.warn(非 Sentry bridge)且函式仍回傳報告,cron 不會標記失敗,Jeff 完全不會被通知本月草稿品質/劣化偵測結果 |
| `server/_core/draftEval.ts:608` | runMonthlyDraftEval 最外層整段(含抽樣/彙整)失敗,回傳 null 而非往上拋 | ③cron/部署可見性 | worker 只在 job 真正 throw 時才呼叫 notifyOwner,但這裡把整個失敗吞成 return null,job 對 BullMQ/errorFunnel 呈現「完成」,月度評分整批失效卻無任何管道通知 Jeff |
| `server/_core/gmail.ts:259` | 整封 Gmail 訊息 hydrate(fetch+parse)失敗直接回 null,customer-inquiry push/poll 路徑靜默跳過這封信 | ①客人資料流 | 客人來信可能因暫時性 Gmail API 錯誤被永久漏掉且無人得知,吻合 Ann Yuan 事故根因模式 |
| `server/_core/gmail.ts:669` | email-receipt-intake 路徑抓取單一附件原始位元組失敗,記 warn 後直接跳過,該附件完全不進 out 陣列無任何痕跡 | ②錢 | 若剛好是那張收據圖片/PDF,會整筆漏收不進後續 OCR/記帳流程且無任何信號留下 |
| `server/_core/imessageIngest.ts:212` | 客人簡訊/iMessage 寫入 customerInteractions 失敗(非重複鍵) | ①客人資料流 | 單則訊息永久遺失於客戶時間軸,僅計入回傳的 errors 計數與 log.warn,沒有主動通知 Jeff |
| `server/_core/imessageIngest.ts:229` | 單則訊息整體處理失敗(外層 catch) | ①客人資料流 | 整則客人訊息可能未進入 customerInteractions 時間軸,僅計入 errors 計數與 log.warn,沒有主動通知 Jeff |
| `server/_core/index.ts:587` | 拖入檔案逐筆寫入 R2+customerDocuments(自動歸檔到客戶專案)失敗,只 log warn,該檔永久不會被歸檔 | ①客人資料流 | 客人文件歸檔寫入失敗且無任何提示,Jeff 不會知道這份文件沒進客戶檔案 |
| `server/_core/index.ts:599` | 整段拖入檔案持久化流程(含 profile 解析、R2 上傳、customerDocuments 寫入)失敗,只 log warn | ①客人資料流 | 客人文件歸檔整段失敗且靜默,與上一筆同一機制的外層保險 |
| `server/_core/index.ts:686` | importChatLogForCustomer 把聊天截圖寫入 customerInteractions 失敗,只 log warn | ①客人資料流 | 客人互動記錄匯入失敗且不會出現在給 Jeff 的回覆結果裡,客人資料流可能不完整 |
| `server/_core/index.ts:703` | 整段聊天記錄匯入流程(候選篩選+逐則匯入)失敗,只 log warn | ①客人資料流 | 客人互動記錄匯入整段失敗且靜默,與上一筆同一機制的外層保險 |
| `server/_core/index.ts:1947` | 啟動時註冊 zombie task cleanup 排程(首次執行+setInterval 註冊)整段失敗,只 log warn | ③cron/部署可見性 | cron 排程若從未成功註冊會完全靜默,Jeff 不會知道 zombie cleanup 排程沒有在跑 |
| `server/_core/index.ts:1955` | 啟動時註冊 daily tour monitor 排程失敗,只 log warn | ③cron/部署可見性 | 排程若沒註冊成功會整個消失且無警報 |
| `server/_core/index.ts:1966` | 啟動時註冊 daily trip-reminder 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 客人出發提醒排程若沒註冊成功不會有任何警報 |
| `server/_core/index.ts:1977` | 啟動時註冊 weekly self-retrospective 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:1988` | 啟動時註冊 customer summary 每日預熱排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:1997` | 啟動時初始化 customerBackfillWorker 失敗,只 log warn | ③cron/部署可見性 | 新客 Gmail 歷史回填 worker 若沒啟動成功不會有警報 |
| `server/_core/index.ts:2009` | 啟動時註冊 monthly draft-eval 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2020` | 啟動時註冊 daily followup-scan 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2034` | 啟動時註冊 weekly duplicate-profile scan 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 這是防重複客戶檔案的 backstop 排程,沒註冊成功不會有警報 |
| `server/_core/index.ts:2048` | 啟動時註冊 weekly correctness audit 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2065` | 啟動時註冊 weekly canary(0909 表單煙霧測試)排程+worker 失敗,只 log warn | ③cron/部署可見性 | 這支 canary 正是用來偵測 Ann Yuan 那類事故的機制,若排程本身沒註冊成功會完全沒有警報 |
| `server/_core/index.ts:2077` | 啟動時註冊 nightly case-learning backlog 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2089` | 啟動時註冊 Gmail poll 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 這是客人來信的核心收信排程,沒註冊成功等於客服信箱停止輪詢,且無警報 |
| `server/_core/index.ts:2102` | 啟動時初始化 Gmail push(Pub/Sub)workers+watch-renew 排程失敗,只 log warn | ③cron/部署可見性 | 收信管線的另一路徑沒啟動成功不會有警報 |
| `server/_core/index.ts:2111` | 啟動時初始化 bookingFollowupWorker 失敗,只 log warn | ③cron/部署可見性 | 此 worker 負責出訂金 PDF+寄確認信,沒啟動成功客人訂單後續動作會卡住且無警報 |
| `server/_core/index.ts:2124` | 啟動時註冊 Plaid daily sync 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 帳務同步排程沒註冊成功不會有警報 |
| `server/_core/index.ts:2136` | 啟動時註冊 trust account 每日 recognition 排程+worker 失敗,只 log warn | ③cron/部署可見性 | Trust 會計 recognize 排程沒註冊成功不會有警報 |
| `server/_core/index.ts:2146` | 啟動時註冊 scaling guardrails(archive+LLM 預算檢查)排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2158` | 啟動時註冊 supplier detail enrichment 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2174` | 啟動時註冊 monthly priority rewrite cron+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2188` | 啟動時註冊 Packpoint daily maintenance 排程+worker 失敗,只 log warn | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2200` | 啟動時初始化 poster processing worker 失敗,只 log warn | ③cron/部署可見性 | worker 註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2215` | 啟動時初始化 supplier sync worker+每日排程失敗,只 log warn | ③cron/部署可見性 | 排程/worker 註冊失敗只留 log,無其他浮出機制 |
| `server/_core/index.ts:2290` | startServer() 整個啟動流程拋錯,只 log error | ③cron/部署可見性 | 全站啟動失敗只留一行 log,沒有 process.exit 或其他警報機制,Jeff 可能完全不知道這次部署沒有真的起得來 |
| `server/_core/inquiryReply.ts:135` | 寄送客人回覆 email 失敗,只 log.error,emailSent 維持 false | ④客人可見輸出 | 客人回覆信實際寄送失敗只留 server log,沒有主動通知任何人,與 Ann Yuan 事故同型態的客人信件寄送失敗 |
| `server/_core/outboundInteraction.ts:95` | 回信寄出後,寫入 customerInteractions 時間軸紀錄失敗,log.warn 後回 {recorded:false} | ①客人資料流 | 客人互動記錄可能丟失,雙向對話時間軸出現缺口,Ops AI/Jeff 之後讀取真實對話會漏看這筆已回覆內容 |
| `server/_core/plaidWebhook.ts:159` | webhook 類型分派處理(觸發交易同步/處理 ITEM 錯誤/Hosted Link)整段失敗,只 log.error + 寫入 DB processedError 欄位,沒有 notifyOwner | ②錢 | 銀行交易同步觸發失敗只寫進沒人主動看的稽核表,Jeff 不會知道 Plaid 同步斷了 |
| `server/_core/plaidWebhook.ts:301` | Hosted Link 流程取得 public_tokens (linkTokenGet) 失敗,log.error 後導致整個銀行連結流程無聲結束(無 notifyOwner) | ②錢 | Jeff 主動連結銀行帳戶的操作背景失敗卻無任何通知,對照後面成功路徑有明確 notifyOwner |
| `server/_core/plaidWebhook.ts:398` | 個別銀行帳戶 insert linkedBankAccounts 失敗(非重複鍵),只 log.error 略過該帳戶繼續 | ②錢 | 帳戶未寫入卻沒有 notifyOwner,且後面仍會用原始帳戶總數發送成功通知,誤導 Jeff 以為全部連結成功 |
| `server/_core/plaidWebhook.ts:448` | Hosted Link 單一 public_token 兌換/入帳整體流程失敗,只 log.error,無 notifyOwner | ②錢 | 與成功路徑明確呼叫 notifyOwner 對比,失敗路徑完全無聲,Jeff 不會知道連結失敗 |
| `server/_core/preDepartureDraftService.ts:99` | 單一訂單的行前提醒信草稿(LLM 生成+寫入 preDepartureNotifications)失敗 | ④客人可見輸出 | 迴圈內 log.error 後繼續下一筆,該客人行前重要提醒(集合地點/注意事項)完全沒有草稿產生,僅回傳的 created 計數會少於預期,無明確錯誤浮出 |
| `server/_core/sentMailFiling.ts:157` | 單一寄件附件上傳 R2 並寫入 customerDocuments 失敗,log.warn non-fatal 後繼續下一附件 | ①客人資料流 | 失敗後仍會走到 applyLabel 標記整封信已處理,該附件永遠不會被重新掃描或補歸檔 |
| `server/_core/stripeWebhook.ts:449` | 寄給客人的付款成功確認信整段流程失敗(含供應商通知子區塊) | ④客人可見輸出 | 客人付款後可能完全收不到任何確認信,屬客人應收到的輸出遺失 |
| `server/_core/stripeWebhook.ts:495` | notifyOwner + notifyAgentMessage 通知 Jeff「收到付款」本身失敗 | ②錢 | 與 Ann Yuan 事故同型態 — Jeff 對付款到帳完全不知情 |
| `server/_core/stripeWebhook.ts:555` | 客戶駕駛艙時間軸訂票互動紀錄寫入失敗(fire-and-forget) | ①客人資料流 | 客人自己時間軸的訂票事實紀錄可能遺失或不完整,屬客人資料流斷 |
| `server/_core/stripeWebhook.ts:596` | notifyOwner 通知「付款失敗」本身又失敗 | ②錢 | 客人卡被拒時 Jeff 完全不知情,錯過補款挽回時機 |
| `server/_core/stripeWebhook.ts:627` | notifyOwner 通知 Stripe 爭議款(chargeback)本身又失敗 | ②錢 | 爭議款有申訴截止時間,Jeff 沒收到通知可能逾期直接輸掉爭議 |
| `server/_core/stripeWebhook.ts:807` | 退款時 Packpoint clawback(收回點數)失敗 | ②錢 | 客人退款後點數未收回,造成點數帳務與實際付款不一致的金流缺口 |
| `server/_core/stripeWebhook.ts:846` | notifyOwner 通知「已退款」本身又失敗 | ②錢 | 程式註解自承退款是最高觸點財務事件,Jeff 沒被通知等於對退款一無所知 |
| `server/_core/stripeWebhook.ts:1093` | 簽證付款完成後的確認信寄送失敗 | ④客人可見輸出 | 客人已付簽證代辦費卻可能收不到任何確認信,屬客人應收到的輸出遺失 |
| `server/_core/stripeWebhook.ts:1109` | notifyOwner 通知簽證付款本身失敗 | ②錢 | Jeff 對簽證付款進帳不知情 |
| `server/_core/stripeWebhook.ts:1437` | notifyOwner 通知「會員試用即將結束」本身失敗(空 catch,連 log 都無) | ②錢 | AB-390 合規提醒信是否寄出的關鍵通知,空 catch 連 log 都沒有,Jeff 完全無從得知 |
| `server/_core/stripeWebhook.ts:1477` | 上一步「緊急通知 Jeff 補寄提醒信」的 notifyOwner 呼叫本身也失敗 | ②錢 | 雙重失敗後已無任何管道通知 Jeff,AB-390 合規提醒信可能徹底漏發 |
| `server/agents/autonomous/financeAlertProducer.ts:347` | 已偵測到的財務異常(payload 已產生)要建立 approval task 通知 Jeff 時失敗,只 log.error,continue 下一筆 | ②錢 | 這是真正偵測到金流異常後,通知機制本身失敗,Jeff 完全不會看到這個已發現的異常 |
| `server/agents/autonomous/gmailPipeline.ts:196` | listUnreadMessages 抓信整批失敗,回傳 ok:false+errors 但不 throw | ①客人資料流 | 回傳值不拋出,繞過 gmailPollWorker 外層專門處理 OAuth 撤銷通知的 catch,整輪 0 封信被處理也無人被通知 |
| `server/agents/autonomous/gmailPipeline.ts:527` | 收據信處理失敗(vision 擷取或建 pendingExpense 出錯) | ②錢 | 只 result.totalFailed++/console log,未接 failedThisRun 卡片機制,也未 notify,Jeff 不會知道這封供應商收據沒被記到 |
| `server/agents/autonomous/gmailPipeline.ts:638` | 貼「客人來信失敗」單卡本身(notifyAgentMessage)又失敗 | ①客人資料流 | 只 log.error,沒有第二層保險,原始的客人來信處理失敗這件事完全沒有任何管道通知 Jeff |
| `server/agents/autonomous/gmailPipeline.ts:649` | 貼「客人來信失敗」聚合卡(>5封洪水閘)本身又失敗 | ①客人資料流 | 只 log.error,同上,整批客人來信處理失敗完全無人知道 |
| `server/agents/autonomous/gmailPipeline.ts:727` | history.list 增量抓信(push 路徑)整批失敗,回傳 ok:false+errors 但不 throw | ①客人資料流 | 與196同構,繞過外層 OAuth 撤銷通知,push 這輪不會處理任何新信也無人被通知 |
| `server/agents/autonomous/gmailPipeline.ts:1502` | 自動回覆實際寄送(sendReplyInThread)拋出例外 | ④客人可見輸出 | sendOutcome 標成 send_failed 但 shouldEscalate 為 false 時只落入通用 observation 卡且標籤誤植成「Draft 已存」,今日待辦 autoReplyBox 只認 auto_replied/would_auto_send 兩種狀態、不含 send_failed,客人沒收到回覆且沒人被正確提醒 |
| `server/agents/autonomous/opsActions.ts:740` | collectCustomerThreads 迴圈中單一 mailbox 的客人信件回填失敗 | ①客人資料流 | 僅 log.warn 標 non-fatal 繼續下一個 mailbox,整體結果仍回傳 ok:true,該客人信件歷史可能不完整且無人知曉 |
| `server/agents/itineraryUnifiedAgent.ts:938` | execute() 整個行程生成流程失敗,只 console.error 回傳 {success:false} | ④客人可見輸出 | 確認呼叫端 fanout.ts 對此結果不會 throw,而是靜默把 itineraryData 設為空陣列繼續組出行程頁,客人可能看到空白行程且無人知曉 |
| `server/agents/trainAgent.ts:182` | 火車資訊 LLM 結構化生成失敗 | ④客人可見輸出 | 吞例外後用 generateDefaultTrain 通用預設值頂替,仍回傳 success:true,下游 fanout.ts 的「失敗才用 fallback」判斷因此永遠不會觸發,佔位資料可能被當成真實內容進入客人可見的行程/團資訊而無人知道 |
| `server/auth.ts:131` | requestPasswordReset 呼叫 sendPasswordResetEmail 拋出的例外(email 兩個管道都已在 emailService.ts 內部處理,這裡理論上只在更底層意外情況觸發) | ④客人可見輸出 | console.error 記錄後函式仍固定回傳 success:true 訊息給前端,客人以為重設信一定會寄達,實際完全沒寄出且 Jeff 端也無任何告警,只有 Fly log 裡的 console.error |
| `server/competitorMonitorWorker.ts:188` | scheduleCompetitorMonitorJobs 排程掃描/派工整批拋錯,只 console.error | ③cron/部署可見性 | 這是每 6 小時觸發一次的排程函式本身,失敗代表整輪競品監控完全沒派工且無 notify/Sentry,屬排程可見性缺口 |
| `server/customerBackfillWorker.ts:56` | 單一 mailbox 對該客人的 Gmail 歷史回填(customerInteractions)失敗 | ①客人資料流 | 該客人在此 mailbox 的歷史互動紀錄會不完整,但整個 job 仍視為成功不會觸發 errorFunnel,Jeff 不會知道 |
| `server/db/accounting.ts:318` | Trust 遞延金額查詢失敗,console.warn 後以 gross(0 遞延)繼續計算會計統計 | ②錢 | 違反 CLAUDE.md Trust 會計鐵律風險:失敗會讓後台財務儀表板把未認列訂金當成營收顯示,且無任何提示告知計算已降級 |
| `server/email/templates/abandonmentRecovery.ts:63` | 寄送購物車放棄挽回信(含折扣碼)給客人失敗 | ④客人可見輸出 | 回傳 false 但呼叫端 BullMQ job 仍視為工作完成({sent:false}),不會觸發 job failed/notifyOwner,客人完全收不到提醒與折扣碼且無人知曉 |
| `server/email/templates/bookingConfirmation.ts:70` | smtp.sendMail 實際寄送訂單確認信給客人失敗,只 console.error,函式仍unconditionally return true | ④客人可見輸出 | 雖稍早已呼叫 notifyOwner 通知 Jeff 有新訂單,但沒有告知 Jeff 客人的確認信實際寄送失敗,客人可能誤以為訂單未成立 |
| `server/email/templates/customOrder.ts:84` | 客製訂單客人信件(報價/確認信等)實際 SMTP 寄送失敗 | ④客人可見輸出 | 客人可能完全收不到報價/確認信,此路徑無 observability counter 兜底,且 Jeff 已提前收到心安通知容易誤判已成功 |
| `server/email/templates/trialEnding.ts:133` | 會員試用即將結束(AB-390 合規提醒信)SMTP 實際寄送失敗 | ②錢 | 吞例外只回傳 false,導致呼叫端 stripeWebhook.handleTrialWillEnd 設計好的 URGENT notifyOwner 安全網完全失效(沒有例外可讓外層 catch 到),flag 已 commit 不會重試,提醒信可能徹底漏發 |
| `server/email/templates/tripReminder.ts:136` | smtp.sendMail 實際寄送行前提醒信失敗,只 console.error 回傳 false | ④客人可見輸出 | 呼叫端 tripReminderService.ts 未檢查此回傳值就記為已寄送,加上 idempotency key 已鎖定,客人永久收不到提醒且統計顯示為成功 |
| `server/email/templates/voucherIssued.ts:65` | 兌換 voucher 後寄送確認信給客人失敗,console.error 後回 false,沒有 owner 通知 | ④客人可見輸出 | voucher 代碼主要透過此信寄給客人,寄送失敗且無任何告知 Jeff 的管道,客人可能誤以為兌換失敗來詢問 |
| `server/gmailPollWorker.ts:65` | runSentMailCapture 寄件信歸檔(附件+互動記錄)失敗,只 console.error | ①客人資料流 | 客人寄件端歸檔資料可能永久漏失且無任何通知或重試機制 |
| `server/gmailPollWorker.ts:138` | failed 事件中 notifyOwner(...) 本身呼叫失敗,只 console.error | ③cron/部署可見性 | 通知鏈路本身斷裂,Jeff 完全不會知道這次 worker job 失敗 |
| `server/plaidSyncWorker.ts:74` | Plaid 同步後自動分類交易失敗 | ②錢 | 新交易入帳後未分類會悄悄堆積成待整理帳目,無 owner 通知,影響 P&L 準確性 |
| `server/queues/packpointMaintenanceQueue.ts:123` | runAutoUpgrade(會員自動升等)整段拋錯被吞,只 console.error+result.errors++,job 本身不 rethrow 仍視為成功完成 | ③cron/部署可見性 | job 不 throw 所以 BullMQ 不會標記 failed,notifyOwner 與 getFailedCount 監控都不會發現,升等邏輯可能連續多天靜默失效無人知曉 |
| `server/queues/packpointMaintenanceQueue.ts:129` | runExpirySweep(18個月未活動點數歸零)整段拋錯被吞,只 console.error+errors++,不 rethrow | ③cron/部署可見性 | 同上,job 視為成功完成,點數過期清理邏輯失效無任何告警管道 |
| `server/queues/packpointMaintenanceQueue.ts:135` | runBirthdayBonus(生日獎勵)整段拋錯被吞,只 console.error+errors++,不 rethrow | ③cron/部署可見性 | 同上,生日獎勵邏輯可能持續失效客人收不到獎勵,無告警 |
| `server/queues/packpointMaintenanceQueue.ts:146` | sweepExpiredVouchers(過期票券清理)整段拋錯被吞,只 console.error+errors++,不 rethrow | ③cron/部署可見性 | 同上模式,票券過期清理靜默失效無告警 |
| `server/queues/supplierSyncQueue.ts:177` | 重試耗盡後呼叫 notifyOwner 通知 Jeff 供應商同步最終失敗,若 notifyOwner 本身失敗只 console.error 靜默吞掉 | ③cron/部署可見性 | 這是唯一會通知 Jeff 的最後防線,若通知本身失敗,Jeff 對供應商同步最終失敗完全不知情 |
| `server/retrospectiveWorker.ts:191` | worker failed 事件內呼叫 notifyOwner 通知 Jeff 任務失敗,若 notifyOwner 本身失敗只 console.error 靜默吞掉 | ③cron/部署可見性 | 與 supplierSyncQueue 相同模式:通知機制本身失敗會讓 Jeff 完全不知道背景任務失敗 |
| `server/routers/aiQuotes.ts:97` | AI 報價產生後,排程 24h/3d/7d 客人跟進信(scheduleQuoteFollowUps)失敗 | ④客人可見輸出 | 只有 console.warn,無任何下游檢查或重試,報價流程本身照常回傳成功,客人本該收到的後續跟進信可能整組默默消失,公司高度重視跟進完整性 |
| `server/routers/bookings.ts:310` | Packpoint 扣點失敗(訂單已用折扣價建立,若扣點失敗等於白送折扣),只有 console.error 沒有任何浮出動作 | ②錢 | 註解自稱 CRITICAL 且要求 ops 人工對帳,但實際只寫 console.error 沒有 notifyOwner,Jeff 不會知道 |
| `server/routers/bookings.ts:399` | 降級備援的同步確認信本身也寄送失敗,只有 console.error | ④客人可見輸出 | 佇列與備援皆失敗,客人完全收不到訂單確認信,只留 console.error 沒有任何浮出給 Jeff |
| `server/routers/bookings.ts:780` | 組裝供應商訂單包時查詢乘客(含護照PII)失敗,被吞成空陣列 | ①客人資料流 | 此端點專門提供護照等乘客資料供 admin 送出真實供應商訂單;空陣列無法與「客人尚未填寫」區分,可能導致漏帶乘客資料下單而不自知 |
| `server/routers/departures.ts:191` | 刪除出發日前查詢是否有有效訂單(activeBookings)關聯失敗 | ①客人資料流 | 這是刪除前唯一的安全閘;查詢一旦失敗被吞成空陣列,會讓有真實客人訂單的出發日被直接刪除,孤兒化客人訂單(註解本身寫明「否則會 orphan customer bookings」) |
| `server/routers/inquiries.ts:78` | ingestWebsiteInquiryContact 把網站表單/緊急聯絡資訊寫入 customerProfiles+customerInteractions 失敗,只 console.error | ①客人資料流 | 原始 inquiry 雖仍在 inquiries 表,但客人這則訊息不會出現在客人互動時間軸/客戶座艙,AI ops chat 讀不到這則對話 |
| `server/routers/inquiries.ts:453` | addMessage procedure 內,同一支 ingestWebsiteInquiryContact 失敗,只 console.error | ①客人資料流 | 與第 78 行同一風險,客人這則跟進留言不會進客人互動時間軸 |
| `server/routers/invoices.ts:103` | 客人自助發票 forBooking 流程中 db.createInvoice 寫入失敗,inserted 設為 null | ②錢 | 若此時 R2 上傳恰好成功(r2Url 有值),下方 !finalUrl 判斷為 false 不會拋錯,客人仍拿到可用網址,但這張發票在資料庫裡完全沒有記錄,系統帳務對不上且無任何信號通知 Jeff |
| `server/routers/plaidRouter.ts:214` | 單一 Plaid 帳戶寫入 linkedBankAccounts 失敗,只 console.warn,迴圈繼續下一個帳戶,該帳戶不會出現在 insertedIds | ②錢 | 銀行帳戶連結失敗會導致該帳戶永遠不會被同步交易,屬於金流基礎設施相關且無主動通知 |
| `server/routers/plaidRouter.ts:822` | CSV 匯入單筆交易列寫入 bankTransactions 失敗,只 console.warn,跳過該筆繼續下一筆 | ②錢 | bankTransactions 是權威 P&L 帳本,單筆交易寫入失敗且無任何浮出等同帳目憑空漏一筆,Jeff 不會知道 |
| `server/routers/plaidRouter.ts:1139` | 手動覆蓋交易分類後,同步 trust deferral 狀態失敗,只 console.warn | ②錢 | Trust 帳戶遞延認列狀態若與分類覆蓋不同步,可能造成 Trust vs Operating 認列金額算錯且無人知曉,涉及 CLAUDE.md Trust 會計硬紅線 |
| `server/routers/preDepartureNotifications.ts:90` | 行前通知信寄送給客人失敗,log.error 後把狀態改回 approved(而非 sent),回傳 { ok: true, sent: false } | ④客人可見輸出 | 行前通知是直接寄給客人的重要文件,寄送失敗只留 server log 與狀態欄位,沒有主動通知 Jeff,容易被忽略 |
| `server/routers/visa.ts:248` | 簽證狀態更新信(approved/rejected/status update)寄送失敗 | ④客人可見輸出 | 只 console.error,mutation 仍無條件回傳 success:true,admin(Jeff)會誤以為客人已收到通知 |
| `server/services/accountingAgentService.ts:323` | processTrustInflow(Trust 帳戶遞延收入紀錄)呼叫失敗 | ②錢 | Trust 會計是 CLAUDE.md 明訂硬紅線,這裡吞掉例外後完全沒有任何標記或回傳反映此筆遞延收入未寫入,交易分類本身仍顯示成功,錢的紀錄可能因此對不上 |
| `server/services/bankPLService.ts:183` | Trust 遞延收入查詢(totalDeferredForUser)失敗,導致 deferredIncomeSubtracted 維持 0 | ②錢 | P&L 計算會退化成「未扣除 Trust 遞延收入的毛額」,等同把尚未 recognize 的訂金當本期營收,直接牴觸 CLAUDE.md 硬紅線 §3(CST §17550);只有 console.warn,Jeff 看到的月報數字可能是錯的卻毫無察覺 |
| `server/services/catalogRebuild/index.ts:261` | 刷新一團客人班期 refreshTourDepartures(先刪舊未來班期再寫入重建班期)失敗 | ④客人可見輸出 | 刪除/寫入若中途失敗可能讓客人正在看的行程班期消失或不完整,導致無法訂位卻無人知曉,要等下次重建才修復 _(審查三抓到誤標,修復階段已補接線(見 fix-phase 回報))_ |
| `server/services/dailyDigestService.ts:434` | 早報信本身寄送失敗(sendMail 拋錯),console.error 後回 false,無其他備援通知 | ③cron/部署可見性 | 這是 Jeff 每日了解營運狀況的主要管道,寄送失敗自己也沒有第二層告警,Jeff 完全不知道今天沒收到早報 |
| `server/services/financialReportService.ts:196` | 財務月趨勢報表計算信託遞延(trust deferral, CST §17550)金額失敗,console.warn 後 deferredByMonth 維持空物件,每個月退回 gross 計算 | ②錢 | 報表可能因此高估月營收/淨利(把還沒認列的信託訂金算進去),觸及 Trust 會計硬紅線,只有 console.warn 沒有任何後台可見警示 |
| `server/services/plaidSyncService.ts:129` | bankTransactions 新增交易 insert 失敗(非重複鍵的未知錯誤)只 console.warn,不計入任何失敗統計 | ②錢 | authoritative 銀行交易可能永久漏記且無任何統計或通知會反映這筆遺失 |
| `server/services/plaidSyncService.ts:211` | 標記已移除交易 excludeFromAccounting 失敗,只 console.warn | ②錢 | 該筆本應排除的交易可能繼續被誤計入報表且無通知 |
| `server/services/scheduledLearningService.ts:81` | 整個排程學習 scheduler 初始化失敗(讀取排程列表/設置 job),只 console.error,無任何浮出 | ③cron/部署可見性 | cron 排程系統初始化全面失敗會導致所有 scheduled learning job 永遠不會被註冊,且無任何地方記錄這個系統性失敗,Jeff 無從得知 |
| `server/services/scheduledLearningService.ts:134` | 單一排程的 BullMQ job 設置失敗(cron 表達式/queue.add),只 console.error | ③cron/部署可見性 | 該排程的 cron job 永遠不會被建立且無 DB 狀態記錄失敗、下次執行時間也不會更新,Jeff 無從察覺 |
| `server/services/supplierSync/index.ts:61` | syncLionCatalog() 整體拋出例外(非回傳 status=failed,而是真的 throw) | ③cron/部署可見性 | 只 console.error 不 rethrow,導致 BullMQ job 視為完成而非失敗;wireWorkerFunnel/notifyOwner 都掛在 worker 的 failed 事件上不會觸發,Jeff 對每日供應商目錄同步完全失敗會毫無所知 |
| `server/services/supplierSync/index.ts:66` | syncUvCatalog() 整體拋出例外 | ③cron/部署可見性 | 同 61,console.error 不 rethrow 使 BullMQ job 誤判成功,UV 供應商目錄同步全滅時 Jeff 收不到任何通知 |
| `server/services/taxCsvService.ts:175` | generateBankMonthlyTrend 讀取月度銀行趨勢失敗,log.error 後 monthlyRows 維持空陣列繼續產生 CSV | ②錢 | 稅務 CSV 會在沒有任何錯誤提示的情況下產出缺月資料的報表,Jeff 拿去報稅可能不知道資料不完整 |
| `server/services/taxCsvService.ts:203` | Trust 遞延金額查詢失敗,log.warn 後 trust 統計維持預設 0 值繼續產生 CSV | ②錢 | Trust 遞延收入是 CST §17550 認列鐵律核心欄位,靜默歸零可能讓稅務報表把未認列訂金誤算成營收 |
| `server/services/tourMonitorService.ts:116` | 寫入 tourMonitorLogs 失敗紀錄本身又失敗,只 console.warn | ③cron/部署可見性 | 註解明言『監控日誌表本身壞掉要知道』,但實作只 console.warn 沒有任何其他浮出管道 |
| `server/services/tourMonitorService.ts:129` | 更新 tours.monitorStatus='error' 失敗,只 console.warn | ③cron/部署可見性 | 這是唯一讓 admin 看到該行程監控失敗的欄位,寫入失敗會讓失敗狀態完全不可見 |
| `server/services/tourMonitorService.ts:281` | 偵測到狀態變更後,實際更新 tourDepartures.status 失敗,只 console.warn | ④客人可見輸出 | tourMonitorLogs 已先記為 success,但實際資料庫欄位未更新,客人看到的出發日狀態(額滿/開放)與稽核記錄不一致 |
| `server/services/tourMonitorService.ts:298` | 偵測到座位數變更後,實際更新 tourDepartures.bookedSlots 失敗,只 console.warn | ④客人可見輸出 | 同上,客人看到的可訂位/剩位數可能停留在舊值,影響訂購判斷甚至超賣風險 |
| `server/services/tripReminderService.ts:48` | Redis 已寄送檢查(exists/setex)失敗,fail-safe 直接視為「已寄送」跳過本次提醒 | ④客人可見輸出 | Redis 故障期間所有行前提醒(護照/尾款/出發日)會被永久跳過且無告警,exact-day 視窗過了無法補發,屬系統性故障訊號被吞 |
| `server/services/tripReminderService.ts:136` | sendTripReminderEmail 寄送失敗,只 console.error+result.errors++ | ④客人可見輸出 | idempotency key 已在寄送前設定為已寄送,寄送失敗永不會重試,客人永久收不到該筆行前提醒且無人知曉 |
| `server/services/trustDeferralService.ts:390` | Trust 遞延收入資料寫入(trustDeferredIncome insert)失敗(非重複鍵情況),只回傳 reason 字串於結果物件 | ②錢 | 確認呼叫端 accountingAgentService.ts 只 console.log 該 reason 未做任何檢查或告警,該筆 Trust 存款可能永遠未建立遞延收入紀錄,牽涉 Trust 會計規則(CLAUDE.md 硬紅線#3) |
| `server/services/wechatAssistService.ts:124` | 客人來信與 AI 草稿寫入 wechatMessages(審核佇列)失敗 | ①客人資料流 | 只有 console.warn,這筆客人互動紀錄可能永久沒進審核佇列 |
| `server/tourGenerator.ts:492` | B5 整批出發日重建(先刪舊再插新)IIFE 拋錯,只 console.warn | ④客人可見輸出 | delete 已先執行,若 insert 中途失敗會讓已上線行程的出發日/價格整批消失且無人知道 |
| `server/tourGenerator.ts:635` | addTourTranslationJob 佇列加入失敗,只 console.warn | ④客人可見輸出 | 連重試安全網(BullMQ 佇列)本身都沒排進去,新行程英文翻譯可能永久缺失且無人知道 |
| `server/tourMonitorWorker.ts:64` | failed 事件中 notifyOwner(...) 本身呼叫失敗,只 console.error | ③cron/部署可見性 | 通知鏈路本身斷裂,Jeff 完全不會知道這次 worker job 失敗 |
| `server/tripReminderWorker.ts:30` | 行後評價信排程(post-trip review scan)失敗 | ③cron/部署可見性 | 不 rethrow 導致外層 catch 與 wireWorkerFunnel 監控都看不到這次失敗,只留在 console log |
| `server/tripReminderWorker.ts:42` | 30 天 winback 挽回信排程失敗 | ③cron/部署可見性 | 同上,子掃描失敗被吞,job 仍回報成功,wireWorkerFunnel 監控不到 |
| `server/tripReminderWorker.ts:53` | 90 天 check-in 信排程失敗 | ③cron/部署可見性 | 同上,子掃描失敗被吞,job 仍回報成功,監控機制看不到 |
| `server/trustRecognitionWorker.ts:109` | worker job 失敗後呼叫 notifyOwner 通知 Jeff,這個通知呼叫本身又失敗,只 console.error,無備援 | ②錢 | Trust 認列 worker 是錢的敏感流程(CST §17550),若 job 失敗+失敗通知又失敗,Jeff 對這筆信託認列問題完全零可見度 |

### Wave4 記帳(A 類但不屬於四類高風險路徑,本批不接線)

| file:line | 吞了什麼 | 理由 |
|---|---|---|
| `server/_core/agentNotify.ts:90` | agentMessages 通知寫入 DB 失敗(notifyAgentMessage 主要管道) | 此為系統對 Jeff 的通知主管道,非 critical 優先度訊息在此失敗後完全沒有其他管道浮出,只 log.error |
| `server/_core/agentNotify.ts:107` | critical 優先度訊息的 email fallback(notifyOwner)本身也失敗 | critical 訊息設計上要靠 email fallback 保證不被 DB 故障 silence,若這條也失敗則完全沒人知道,只 log.error |
| `server/_core/context.ts:68` | tRPC createContext 中 JWT 驗證/db.getUserById 查詢失敗,不分原因一律吞掉並把 user 設為 null | 完全空的 catch,零 log,涵蓋所有錯誤類型(含 DB 連線問題等非預期基礎設施故障),會把系統性故障偽裝成「訪客身份」,在每一個請求的認證路徑上零診斷紀錄 |
| `server/_core/llmCreditAlert.ts:109` | LLM 額度耗盡的 notifyAgentMessage 高優先度警示卡貼卡本身失敗,只 log.warn | 這是全站 AI 降級的最後一道通知機制,失敗又沒有 Sentry/其他管道兜底,Jeff 可能完全不知道全站 AI 已經掛了 |
| `server/_core/stripeWebhook.ts:444` | 供應商到府通知信寄送失敗 | 供應商沒收到已付款通知可能導致實際出團準備缺失,Jeff 無從得知需人工補寄 |
| `server/agentActivityService.ts:87` | logAgentStart 寫入 agentActivityLogs 開始紀錄失敗(DB insert) | 這是 Jeff 賴以觀察所有 agent 執行狀況的核心紀錄系統本身寫入失敗且被靜默吞掉,屬於系統性故障訊號被吞 |
| `server/agentActivityService.ts:137` | logAgentComplete 寫入 agentActivityLogs 完成/失敗狀態失敗(DB update) | 活動紀錄系統本身寫入失敗會讓任務永遠卡在 started 狀態且無人知道,是系統性故障訊號被吞 |
| `server/db.ts:94` | getDb() 建立 MySQL 連線池失敗,console.warn 後 _db 設為 null(全站每個 DB 函式各自靜默回傳空值/false) | 這是整站唯一的 DB 連線入口,連線失敗會讓下游數十個函式各自安靜降級成空結果,沒有任何集中告警讓 Jeff 知道系統性 DB 故障 |
| `server/email/templates/supplierNotification.ts:114` | 寄送供應商訂單通知信 smtp.sendMail 失敗,console.error 後回傳 false | 呼叫端 stripeWebhook 不檢查回傳值,仍會記 log 誤稱已寄出,供應商可能完全不知道有新訂單 |
| `server/queues/abandonmentRecoveryQueue.ts:140` | 取消未付款訂單後釋放出發場次座位(releaseDepartureSlots)失敗,只 console.warn | booking 已標記 cancelled 但座位庫存未實際釋回,長期會造成場次餘位持續被低估、影響銷售但無人察覺 |
| `server/routers/bookingsPayment.ts:344` | 全額退款後釋放出團名額(座位)失敗 | 座位未釋放可能造成出團名額顯示已滿、錯失後續訂位,無任何通知讓 Jeff 知道要人工修正 |
| `server/routers/inquiries.ts:310` | notifyOwner(緊急客人求助通知)本身寄送失敗,只 console.error,無備援管道 | 這是 🆘 緊急客人事件通知 Jeff 的唯一管道,失敗即代表 Jeff 完全不知道有緊急案例待處理 |
| `server/tourGenerator.ts:565` | notifyAgentMessage 發送 #catalog 頻道校準結果通知本身拋錯,只 console.warn | 這正是要讓 Jeff 看到新行程審核結果的通知機制失敗且無其他管道補位,Jeff 該知道而不知道 |
| `server/tourGenerator.ts:643` | 整個 generateTour 流程任何未捕捉例外,console.error 後回傳 {success:false} 而非 throw | worker.ts 呼叫端未檢查 result.success 直接視為 job 完成,導致 Sentry/notifyOwner 的 failed 事件警報鏈完全繞過 |

## 全枚舉(逐檔案,含 B 類)

> 以下依檔案分組列出全部 873 筆(含上方已列出的 A/C 類,方便照檔案查閱)。

### `server/_core/agentNotify.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 90 | agentMessages 通知寫入 DB 失敗(notifyAgentMessage 主要管道) | A(必須浮出) | — | 此為系統對 Jeff 的通知主管道,非 critical 優先度訊息在此失敗後完全沒有其他管道浮出,只 log.error |
| 107 | critical 優先度訊息的 email fallback(notifyOwner)本身也失敗 | A(必須浮出) | — | critical 訊息設計上要靠 email fallback 保證不被 DB 故障 silence,若這條也失敗則完全沒人知道,只 log.error |

### `server/_core/attachmentParser.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 279 | 附件解析(PDF/圖片/文字等)整體失敗,log.warn 後回傳 {parseStatus:'parse_error', parseError} | B(可以安靜) | — | 與檔案內其他分支一致的結構化降級設計(ok/empty/unsupported/parse_error),非靜默吞錯,呼叫端可依 parseStatus 判斷 |

### `server/_core/auditLog.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 106 | Redis SET NX 取得 audit tip 鎖失敗,.catch 回傳 null | B(可以安靜) | — | 註解明確設計:Redis 掛掉時 fallback 為不帶 previousHash 照樣寫入,優於整筆遺失 |
| 114 | 釋放 Redis 鎖的 Lua eval 失敗,.catch 回傳 null | B(可以安靜) | — | 純鎖釋放清理動作,鎖本身有 10s TTL 自然過期 |
| 243 | audit() 整體寫入稽核紀錄失敗,log.error 後靜默結束(request 繼續) | B(可以安靜) | — | 註解明確設計:audit 寫入失敗絕不可讓請求中斷,log.error 已寫入 Fly logs 供事後查核 |

### `server/_core/caseConversationImport.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 121 | importCaseConversationsForFolder 整體匯入案件對話記錄失敗,log.warn 後回傳 {status:"error", warnings} | B(可以安靜) | — | 以結構化 status/warnings 回傳給呼叫端(admin 觸發的案件匯入工具),非靜默吞掉 |

### `server/_core/caseDocumentImport.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 297 | 案件文件匯入(customerDocuments)整體流程失敗 | B(可以安靜) | — | 回傳明確 {status:"error",warnings} 結構給呼叫端,非靜默吞掉 |

### `server/_core/caseFileImport.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 184 | LLM 抽取案件欄位失敗,回傳 null | B(可以安靜) | — | 檔案頭部文件明言 best-effort, never throws, returns null on any failure,是設計內建的 fail-open |
| 382 | extractCaseFields 拋錯,log.warn 後回傳 {status:'error'} | B(可以安靜) | — | 以結構化 status 回傳給呼叫端(批次匯入報表),失敗已浮出可被彙總看到 |
| 397 | resolveOrIdentifyCustomer 拋錯,log.warn 後回傳 {status:'error'} | B(可以安靜) | — | 同上,結構化 status 回傳,呼叫端可見失敗 |
| 519 | 匯入案件時單筆 customerInteractions insert 失敗,log.warn 後在迴圈內繼續 | A(必須浮出) | ①客人資料流 | 整體 importCaseFile 仍回傳 status:'imported' 成功,遺失的那筆客人互動紀錄完全不會反映在結果裡 |
| 528 | confirm 模式整體 DB 寫入流程拋錯,log.warn 後回傳 {status:'error'} | B(可以安靜) | — | 結構化 status 回傳給呼叫端(批次匯入報表),失敗已浮出 |
| 631 | repairCaseInteractions 修復流程拋錯,log.warn 後回傳 {status:'error'} | B(可以安靜) | — | 結構化 status 回傳,一次性人工觸發修復工具,失敗已浮出可見 |

### `server/_core/caseLearning.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 131 | extractCaseLesson 呼叫 LLM 抽取案例教訓失敗,log.warn 後回 null | B(可以安靜) | — | 內部教訓蒸餾功能,失敗不影響訂單狀態或客人資料,函式註解明訂 non-fatal |
| 262 | distillCaseLearning 整段(含寫入 caseLearnings)失敗,log.warn 後回 distilled:false | B(可以安靜) | — | 函式註解明寫絕不能影響已成功的訂單狀態轉換,刻意 fail-open |
| 334 | getCaseLearningsForProfiles 查詢過往教訓失敗,log.warn 後回空陣列 | B(可以安靜) | — | 函式註解明寫 DB 掛掉一律回空陣列視為誠實的沒有,supply 端 chat 仍可正常運作 |
| 409 | runCaseLearningBacklogScan 夜間補漏批次整體失敗,log.warn 後回全 0 結果 | B(可以安靜) | — | 內部學習系統的補漏批次,非客人資料/金流關鍵路徑,刻意 non-fatal 設計 |

### `server/_core/caseLessonHarvest.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 122 | 去識別化案例教訓的 LLM 呼叫失敗 | B(可以安靜) | — | 註解明寫 non-fatal,回傳空陣列即可,屬內部學習迴圈的次要功能 |
| 224 | harvestCaseLessons 整體流程(DB 查詢/寫入/deid)失敗 | B(可以安靜) | — | 已用結構化 status:'error' 回傳供呼叫端顯示,非靜默吞掉 |

### `server/_core/chatLogImport.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 410 | LLM 分類/擷取聊天記錄截圖失敗,回傳 null | A(必須浮出) | ①客人資料流 | 上層 importChatLogForCustomer 把 null 轉成 status:error;主要呼叫端 ask-ops-stream 原始碼明文規定 error 狀態不特別告知 Jeff(視同不是聊天記錄的靜默處理),客人對話截圖匯入失敗但 Jeff 會以為已處理 |
| 569 | classifyAndExtractChatLog 呼叫本身拋出例外 | A(必須浮出) | ①客人資料流 | 回傳 status:error,同樣被 ask-ops-stream 呼叫端明文設計為靜默不告知 Jeff |
| 658 | 單則聊天訊息 insert 進 customerInteractions 失敗 | B(可以安靜) | — | 不中斷其餘訊息匯入,失敗數計入 droppedCount,呼叫端仍會用「另有 X 則未匯入」提示 Jeff(雖文案誤植成缺日期) |
| 692 | 聊天記錄整批 DB 寫入(dedup+insert 迴圈)外層失敗 | A(必須浮出) | ①客人資料流 | 回傳 status:error,同樣被 ask-ops-stream 呼叫端明文設計為靜默不告知 Jeff |

### `server/_core/context.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 68 | tRPC createContext 中 JWT 驗證/db.getUserById 查詢失敗,不分原因一律吞掉並把 user 設為 null | A(必須浮出) | — | 完全空的 catch,零 log,涵蓋所有錯誤類型(含 DB 連線問題等非預期基礎設施故障),會把系統性故障偽裝成「訪客身份」,在每一個請求的認證路徑上零診斷紀錄 |

### `server/_core/customerAiSummary.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 244 | AI 摘要寫回 customerProfiles 快取欄位失敗,log.warn 忽略 | B(可以安靜) | — | 註解明寫 best-effort,寫入失敗仍回傳本次算好的摘要供畫面顯示,只是不快取 |
| 383 | 夜間批次重算單一客人 AI 摘要失敗,log.warn 後計入 errors 繼續下一位 | B(可以安靜) | — | 內部摘要快取的背景重算批次,單一客人失敗不影響其他客人也不影響核心資料 |

### `server/_core/customerBackfill.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 147 | 回填客人 Gmail 歷史對話時,單一 thread 同步進 customerInteractions 失敗,log.warn 後繼續下一筆 | A(必須浮出) | ①客人資料流 | BackfillResult 沒有明確 failedCount 欄位,失敗的那個 thread 的客人對話紀錄就此silently消失不進客人檔案,呼應 Ann Yuan 事故型態 |

### `server/_core/customerChatContext.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 61 | Ops chat 客人文件區塊組裝(loadCustomerDocs/buildCustomerDocsText)失敗 | B(可以安靜) | — | 註解明寫 degrade 成空字串,chat 主流程不中斷,屬 Jeff 自用工具的 best-effort |

### `server/_core/customerDocsText.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 162 | realFetchBytes 抓取文件位元組失敗,log.warn 後回傳 null | B(可以安靜) | — | 函式上方註解明確設計:抓取/解析失敗一律回傳 null,呼叫端會將該文件列為不可讀,never throw |
| 199 | extractDocTextCached 單一文件抽取失敗,log.warn 後回傳 null | B(可以安靜) | — | 同上,設計上刻意 fail-open 為不可讀而非拋錯 |

### `server/_core/customerFacts.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 506 | 客戶駕駛艙的事實面板彙整(訂單/報價/發票/已交付文件/訂金餘款/確認訂單數)DB 查詢失敗,整包退回 EMPTY_FACTS | A(必須浮出) | ②錢 | 此模組正是為了修正先前「卡片顯示與實際訂單/付款狀態不符」的舊事故而生,若靜默退回空白事實,Jeff 看到的會是誤導性的「客人尚無任何進展」,僅 log.warn 沒有主動通知 |

### `server/_core/customerMerge.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 273 | 合併後重算目標卡 lastInboundAt(收件紅點指標)失敗 | B(可以安靜) | — | 程式碼註明 best-effort,紅點指標壞了不可弄死已完成的合併主流程 |
| 320 | 合併後觸發客戶摘要 refresh 排入佇列失敗 | B(可以安靜) | — | 僅影響顯示端摘要即時刷新,非核心合併資料本身 |
| 528 | filing 入口 auto-heal 把訪客卡併入同 email 會員卡失敗 | B(可以安靜) | — | 程式碼註明 heal 失敗絕不弄斷收信,照舊 file 到訪客卡且下一封會再試 |

### `server/_core/customerPreferenceExtractor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 264 | AI 客人偏好摘要抽取失敗 | B(可以安靜) | — | 原始客人訊息仍留在 customerInteractions,且有夜間 back-fill 任務會重跑補齊 |
| 299 | 合併觸發後重跑一次 extractAfterReply 失敗(fire-and-forget) | B(可以安靜) | — | 註解明示 best effort、永不對呼叫端拋錯,且有 back-fill 機制兜底 |
| 438 | 夜間 back-fill 批次中單一客人 profile 抽取失敗 | B(可以安靜) | — | 批次繼續處理其他客人,且「掃了卻全部 0 成功」的系統性失敗另有警示邏輯處理 |
| 569 | 客製專案(on-the-fly)AI 理解抽取失敗 | B(可以安靜) | — | 不落地儲存,單純這次呼叫沒有結果,下次呼叫會重跑,無資料遺失 |
| 890 | Jeff 手動點「重新分析」時的訂單 AI 理解失敗 | B(可以安靜) | — | 同步的人工觸發動作,失敗會直接反映在當下 UI 沒有結果,Jeff 自己看得到 |

### `server/_core/customerUnread.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 133 | 更新客戶 lastInboundAt 未讀指標失敗,只 log.warn | B(可以安靜) | — | 程式註解明確標註絕不 throw、只影響未讀紅點顯示,真正的 customerInteraction 記錄已在呼叫前完成寫入 |

### `server/_core/deploySmoke.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 71 | 單一煙霧測試臂執行拋錯,log.error 後回傳 { ok:false, error } 該臂結果 | B(可以安靜) | — | 這個 catch 本身就是把例外轉成結構化結果給上層 smoke result 彙總消費的機制,是刻意設計的浮出點而非隱藏失敗 |

### `server/_core/draftEval.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 507 | 月度草稿評分迴圈中單一客人的評分失敗,略過該客人繼續下一位 | B(可以安靜) | — | 抽樣式內部品質監控,單一樣本失敗不影響整體報告產出,樣本數自然減少 |
| 534 | 讀取 eval-history.md 取得上月分數失敗時的 inline fallback,回傳空字串 | B(可以安靜) | — | 首次執行/檔案不存在的良性 fallback,非真正錯誤吞噬 |
| 536 | 讀取上月分數整段失敗,previousScore 維持 null(視同首次執行) | B(可以安靜) | — | 只影響劣化偵測的比較基準,本月報告仍會照常算出並透過 agentMessages 通知 Jeff |
| 565 | 寫入 eval-history.md 前讀取既有內容失敗的 inline fallback,回傳空字串 | B(可以安靜) | — | 同534,良性 fallback |
| 568 | 寫入 eval-history.md(月度歷史紀錄檔)失敗 | B(可以安靜) | — | 只影響歷史趨勢檔案持久化,本月報告仍會透過另一段獨立 try 寫入 agentMessages 通知 Jeff |
| 600 | 寫入 agentMessages 摘要卡(通知 Jeff 本月草稿評分)失敗 | A(必須浮出) | ③cron/部署可見性 | 這是整個月度評分機制唯一真正把結果送到 Jeff 眼前的步驟,失敗只 log.warn(非 Sentry bridge)且函式仍回傳報告,cron 不會標記失敗,Jeff 完全不會被通知本月草稿品質/劣化偵測結果 |
| 608 | runMonthlyDraftEval 最外層整段(含抽樣/彙整)失敗,回傳 null 而非往上拋 | A(必須浮出) | ③cron/部署可見性 | worker 只在 job 真正 throw 時才呼叫 notifyOwner,但這裡把整個失敗吞成 return null,job 對 BullMQ/errorFunnel 呈現「完成」,月度評分整批失效卻無任何管道通知 Jeff |

### `server/_core/errorFunnel.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 105 | flushCountToDb 週期性把 in-memory count 回寫既有卡片失敗 | B(可以安靜) | — | 卡片本身已在別處貼出,只是次數欄位這次沒更新,下次還會再試 |
| 134 | fire-and-forget flushCountToDb 呼叫的 promise rejection 被 .catch(() => {}) 吞掉 | B(可以安靜) | — | flushCountToDb 內部已自行 try/catch,此為雙保險不影響主流程 |
| 193 | 既有卡片 count 累加的 DB update 失敗 | B(可以安靜) | — | log.warn 註明卡片已存在,只是次數沒更新,Jeff 仍看得到卡片本身 |
| 204 | Layer2 去重查詢 DB 失敗 | B(可以安靜) | — | 刻意設計成失敗就當新事件直接貼卡,fail-open 方向是「多貼卡」而非「漏貼卡」 |
| 230 | notifyAgentMessage 貼新卡片失敗 | B(可以安靜) | — | 已用 log.error({err}) 方式浮出(logger.ts 有 Sentry bridge,error 帶 err 欄位會自動 captureException) |
| 236 | reportFunnelError 最外層未預期例外 | B(可以安靜) | — | 已用 log.error({err}) 方式浮出(logger Sentry bridge) |
| 255 | 該行實際是 JSDoc 註解非程式碼,無對應 catch;就近核對到 272 行 wireWorkerFunnel 的 .catch(() => {}) | B(可以安靜) | — | 行號可能飄移,已就近核對,判斷同 272 行:reportFunnelError 內部已自行處理不會真的 reject |
| 272 | worker.on("failed") 轉呼叫 reportFunnelError 的 promise rejection 被 .catch(() => {}) 吞掉 | B(可以安靜) | — | reportFunnelError 文件明載絕不 throw,此為雙保險 |
| 275 | worker.on("error") 轉呼叫 reportFunnelError 的 promise rejection 被 .catch(() => {}) 吞掉 | B(可以安靜) | — | 同 272,雙保險不影響主流程 |

### `server/_core/escalationBox.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 697 | 附件解析(resolveReplyAttachments)失敗,擋下這次寄送 | B(可以安靜) | — | 已用 log.error({err}) 觸發 Sentry.captureException,且直接回傳 errorMessage 讓觸發動作的 Jeff 當下就看到失敗 |
| 770 | 寄出回覆後,fire-and-forget 排入客人摘要卡重算失敗 | B(可以安靜) | — | 註解明確 non-fatal,郵件已成功寄出,只是摘要卡沒有立即刷新 |
| 798 | 寄出回覆後,fire-and-forget 承諾追蹤擷取(recordPromisesForInteraction)失敗 | B(可以安靜) | — | 註解明確 best-effort絕不影響已寄出結果;Jeff 已人工核准並寄出該封信,承諾內容他自己知道,只是少一筆自動化提醒 |

### `server/_core/followupScan.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 186 | 查詢候選客人是否已有報價證據失敗 | B(可以安靜) | — | 程式碼註明 fallback 為對所有人用中性措辭,不影響是否發提醒本身 |
| 263 | 單筆客人 follow-up 提醒寫入 Jeff 收件匣(agentMessages)失敗 | B(可以安靜) | — | 隔天排程會因 dedup 判斷此客人未被提醒過而自動重試,屬於自我修復設計 |

### `server/_core/gmail.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 252 | hydrateMessageById 內解析郵件附件文字失敗,記 warn 後繼續只回信件本文 | B(可以安靜) | — | best-effort,信件本文仍正常處理,只是附件文字擷取失敗(繼續 with body only) |
| 259 | 整封 Gmail 訊息 hydrate(fetch+parse)失敗直接回 null,customer-inquiry push/poll 路徑靜默跳過這封信 | A(必須浮出) | ①客人資料流 | 客人來信可能因暫時性 Gmail API 錯誤被永久漏掉且無人得知,吻合 Ann Yuan 事故根因模式 |
| 396 | threadExists 查詢遇到非 404 錯誤 | B(可以安靜) | — | mechanical:非 404 一律 throw err(rethrow),只有 404 轉成業務語意 false |
| 592 | 單一附件解析(parseAttachment)失敗,記 warn 後在附件陣列塞入 parseStatus:'parse_error' 佔位項 | B(可以安靜) | — | 失敗狀態被保留在資料結構裡並標記,非完全消失,下游可辨識這筆附件解析失敗 |
| 669 | email-receipt-intake 路徑抓取單一附件原始位元組失敗,記 warn 後直接跳過,該附件完全不進 out 陣列無任何痕跡 | A(必須浮出) | ②錢 | 若剛好是那張收據圖片/PDF,會整筆漏收不進後續 OCR/記帳流程且無任何信號留下 |
| 986 | sendReplyInThread 呼叫 Gmail send API 失敗,回傳結構化 {ok:false, error} | C(爭議,交指揮裁決) | — | 有回傳失敗信號但這批看不到上游呼叫端是否真的把 ok:false 轉告 Jeff;客人回信寄送失敗風險高,拿不準故誠實標 C |
| 1006 | verifyConnection 測試 Gmail 整合連線失敗,回傳 {ok:false, error} | B(可以安靜) | — | 這是連線健康檢查用途的函式,失敗本就該原樣回傳給呼叫端顯示連線狀態 |
| 1073 | stopGmailWatch 呼叫 users.stop 失敗,只記 warn | B(可以安靜) | — | 函式註解明說 never throws,已過期/不存在的 watch 本就是 no-op,刻意設計為 non-fatal 清理 |
| 1120 | history.list 呼叫失敗且非 404 | B(可以安靜) | — | mechanical:非 404 一律 throw e(rethrow),只有 404 轉成 expired:true 業務語意讓呼叫端回退時間窗輪詢 |

### `server/_core/gmailAccountRouting.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 77 | 多帳號 thread 歸屬 probe 對某帳號查詢失敗 | B(可以安靜) | — | 失敗被誠實記錄進回傳的 probeErrors 陣列,與「查過確認沒有」明確區分,屬刻意設計的誠實信號 |

### `server/_core/gmailPushWebhook.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 77 | Pub/Sub OIDC bearer token 驗證(verifyIdToken)失敗 | B(可以安靜) | — | 回傳結構化 {ok:false, reason} 供呼叫端 log.warn 並回應 res.status(401),失敗已透過 HTTP 狀態碼回應呼叫端(Pub/Sub 會依此重試) |
| 201 | 解析出通知後,排入 gmailPushQueue 失敗(Redis 問題) | B(可以安靜) | — | 已用 log.error({err}) 觸發 Sentry.captureException,且 res.status(500) 讓 Pub/Sub 重試,註解說明另有 poll 機制兜底 |

### `server/_core/guestNoiseHygiene.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 256 | 分類回填批次流程整體拋錯,回傳 {status:'error', mode, error} | B(可以安靜) | — | 結構化 status 回傳給呼叫端(ops 工具),失敗已浮出可見 |
| 328 | 訪客噪音稽核報表整體拋錯,回傳 {status:'error', error} | B(可以安靜) | — | 結構化 status 回傳給呼叫端,失敗已浮出可見 |

### `server/_core/healthCheck.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 123 | withTimeout 內部 promise 失敗,清掉逾時計時器後 reject 往外拋 | B(可以安靜) | — | 屬於 rethrow(reject 即例外往外傳遞) |
| 163 | DB SELECT 1 健康檢查失敗 | B(可以安靜) | — | 轉成 status:fail 進健康檢查彙總,UptimeRobot 每5分鐘輪詢並 email Jeff,已用結構化方式浮出 |
| 192 | Redis PING 健康檢查失敗 | B(可以安靜) | — | 同上,轉成 status:fail 進健康檢查彙總並對外告警 |
| 236 | Stripe balance.retrieve 健康檢查失敗 | B(可以安靜) | — | 同上,轉成 status:fail 進健康檢查彙總並對外告警 |
| 287 | Anthropic models.list 健康檢查失敗 | B(可以安靜) | — | 同上,轉成 status:fail 進健康檢查彙總並對外告警 |

### `server/_core/imageGeneration.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 100 | 讀取失敗回應的 body 文字失敗,.catch(()=>'') 忽略後仍會 throw 原錯誤 | B(可以安靜) | — | 僅是組錯誤訊息用的防禦性讀取,後面緊接著仍會 throw 真正的錯誤 |
| 186 | Google CSE 圖片搜尋失敗,log.error 後回傳 {url:undefined} | B(可以安靜) | — | 圖片產生為內容增強,呼叫端(如 tourGenerator)本就以 non-blocking 方式處理缺圖情況 |
| 214 | 單一候選圖片上傳 R2 失敗,log.error 後嘗試下一個候選 | B(可以安靜) | — | 註解明言 try next candidate,是迴圈內建的容錯重試設計 |

### `server/_core/imageOcr.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 59 | sharp 無法解碼客人附件圖片 | B(可以安靜) | — | 轉成 {ok:false} 明確訊號,依 docstring 設計由呼叫端 fallback 請客人重傳,非靜默 |
| 92 | 圖片 vision OCR LLM 呼叫失敗 | B(可以安靜) | — | 同上,轉成 {ok:false} 由呼叫端 fallback 處理 |
| 140 | PDF vision 讀取 LLM 呼叫失敗 | B(可以安靜) | — | 同上,轉成 {ok:false} 由呼叫端 fallback 處理 |

### `server/_core/imessageIngest.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 83 | 批次確認手機號是否為已知客人時,單一號碼查詢失敗被略過(不列入已知) | B(可以安靜) | — | 模組文件明確聲明 fail-closed 隱私設計,查不到寧可當作未知不外流簡訊內容,屬刻意安全選擇 |
| 212 | 客人簡訊/iMessage 寫入 customerInteractions 失敗(非重複鍵) | A(必須浮出) | ①客人資料流 | 單則訊息永久遺失於客戶時間軸,僅計入回傳的 errors 計數與 log.warn,沒有主動通知 Jeff |
| 229 | 單則訊息整體處理失敗(外層 catch) | A(必須浮出) | ①客人資料流 | 整則客人訊息可能未進入 customerInteractions 時間軸,僅計入 errors 計數與 log.warn,沒有主動通知 Jeff |

### `server/_core/index.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 322 | chat 圖片上傳(multer+R2 storagePut)失敗的例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出給前端 |
| 431 | OpsAgent 附件迴圈中單一檔案 parseAttachment 解析失敗,只 log warn 跳過該檔 | B(可以安靜) | — | admin 自己即時操作,droppedFiles 已先 push,失敗只影響該次對話能否讀到該檔內容,不影響後續 customerDocuments 歸檔迴圈 |
| 587 | 拖入檔案逐筆寫入 R2+customerDocuments(自動歸檔到客戶專案)失敗,只 log warn,該檔永久不會被歸檔 | A(必須浮出) | ①客人資料流 | 客人文件歸檔寫入失敗且無任何提示,Jeff 不會知道這份文件沒進客戶檔案 |
| 599 | 整段拖入檔案持久化流程(含 profile 解析、R2 上傳、customerDocuments 寫入)失敗,只 log warn | A(必須浮出) | ①客人資料流 | 客人文件歸檔整段失敗且靜默,與上一筆同一機制的外層保險 |
| 686 | importChatLogForCustomer 把聊天截圖寫入 customerInteractions 失敗,只 log warn | A(必須浮出) | ①客人資料流 | 客人互動記錄匯入失敗且不會出現在給 Jeff 的回覆結果裡,客人資料流可能不完整 |
| 703 | 整段聊天記錄匯入流程(候選篩選+逐則匯入)失敗,只 log warn | A(必須浮出) | ①客人資料流 | 客人互動記錄匯入整段失敗且靜默,與上一筆同一機制的外層保險 |
| 1007 | runOpsAgentStream 串流消費迴圈拋錯 | B(可以安靜) | — | 已用 SSE error 事件方式浮出給呼叫端,Jeff 當下畫面會看到錯誤 |
| 1078 | ask-ops-stream 整支路由未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 或 SSE error 事件方式浮出給呼叫端 |
| 1270 | /api/internal/test-generate 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1307 | /api/internal/bulk-import-lion 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1363 | /api/admin/import-case-file 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1393 | /api/admin/deploy-smoke 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1445 | /api/admin/import-case-documents 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1488 | /api/admin/harvest-case-lessons 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1525 | /api/admin/import-case-conversations 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1559 | /api/admin/backfill-interaction-orders 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1598 | /api/admin/backfill-guest-classification 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1621 | /api/admin/guest-noise-hygiene-report 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1659 | /api/admin/imessage-check-known-phones 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1710 | /api/admin/imessage-ingest 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1730 | /api/internal/test-status/:jobId 端點未預期例外 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1790 | sitemap.xml 動態產生失敗 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1813 | /api/aiQuotes/:id/view 內嵌 HTML 檢視失敗 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1854 | /api/invoices/:id/view 內嵌 HTML 檢視失敗 | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出 |
| 1902 | tRPC onError 內呼叫 reportFunnelError 本身失敗(雙保險 catch,body 為空) | B(可以安靜) | — | 此 catch 緊接在 reportFunnelError(...) 呼叫之後,官方註解說明 reportFunnelError 內部設計為永不 throw,原始錯誤已透過 reportFunnelError 浮出 |
| 1934 | 啟動時立即執行的 cleanupZombieTasks(30) 失敗 | B(可以安靜) | — | catch 內容呼叫 reportFunnelError,已用 reportFunnelError 方式浮出 |
| 1935 | reportFunnelError(...) 呼叫本身失敗(雙保險 catch,body 為空) | B(可以安靜) | — | 緊接在 reportFunnelError 呼叫之後的雙保險,原始錯誤已透過 reportFunnelError 浮出 |
| 1939 | 行號落在註解上(飄移),就近核對到 1942 行 setInterval 內 cleanupZombieTasks(30) 排程執行失敗 | B(可以安靜) | — | 行號可能飄移,已就近核對;該 catch 內容呼叫 reportFunnelError,已用 reportFunnelError 方式浮出 |
| 1942 | 10 分鐘一次的 cleanupZombieTasks(30) 排程執行失敗 | B(可以安靜) | — | catch 內容呼叫 reportFunnelError,已用 reportFunnelError 方式浮出 |
| 1943 | reportFunnelError(...) 呼叫本身失敗(雙保險 catch,body 為空) | B(可以安靜) | — | 緊接在 reportFunnelError 呼叫之後的雙保險,原始錯誤已透過 reportFunnelError 浮出 |
| 1947 | 啟動時註冊 zombie task cleanup 排程(首次執行+setInterval 註冊)整段失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | cron 排程若從未成功註冊會完全靜默,Jeff 不會知道 zombie cleanup 排程沒有在跑 |
| 1955 | 啟動時註冊 daily tour monitor 排程失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程若沒註冊成功會整個消失且無警報 |
| 1966 | 啟動時註冊 daily trip-reminder 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 客人出發提醒排程若沒註冊成功不會有任何警報 |
| 1977 | 啟動時註冊 weekly self-retrospective 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 1988 | 啟動時註冊 customer summary 每日預熱排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 1997 | 啟動時初始化 customerBackfillWorker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 新客 Gmail 歷史回填 worker 若沒啟動成功不會有警報 |
| 2009 | 啟動時註冊 monthly draft-eval 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 2020 | 啟動時註冊 daily followup-scan 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 2034 | 啟動時註冊 weekly duplicate-profile scan 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 這是防重複客戶檔案的 backstop 排程,沒註冊成功不會有警報 |
| 2048 | 啟動時註冊 weekly correctness audit 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 2065 | 啟動時註冊 weekly canary(0909 表單煙霧測試)排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 這支 canary 正是用來偵測 Ann Yuan 那類事故的機制,若排程本身沒註冊成功會完全沒有警報 |
| 2077 | 啟動時註冊 nightly case-learning backlog 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 2089 | 啟動時註冊 Gmail poll 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 這是客人來信的核心收信排程,沒註冊成功等於客服信箱停止輪詢,且無警報 |
| 2102 | 啟動時初始化 Gmail push(Pub/Sub)workers+watch-renew 排程失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 收信管線的另一路徑沒啟動成功不會有警報 |
| 2111 | 啟動時初始化 bookingFollowupWorker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 此 worker 負責出訂金 PDF+寄確認信,沒啟動成功客人訂單後續動作會卡住且無警報 |
| 2124 | 啟動時註冊 Plaid daily sync 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 帳務同步排程沒註冊成功不會有警報 |
| 2136 | 啟動時註冊 trust account 每日 recognition 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | Trust 會計 recognize 排程沒註冊成功不會有警報 |
| 2146 | 啟動時註冊 scaling guardrails(archive+LLM 預算檢查)排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 2158 | 啟動時註冊 supplier detail enrichment 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 2174 | 啟動時註冊 monthly priority rewrite cron+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 2188 | 啟動時註冊 Packpoint daily maintenance 排程+worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程註冊失敗只留 log,無其他浮出機制 |
| 2200 | 啟動時初始化 poster processing worker 失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | worker 註冊失敗只留 log,無其他浮出機制 |
| 2215 | 啟動時初始化 supplier sync worker+每日排程失敗,只 log warn | A(必須浮出) | ③cron/部署可見性 | 排程/worker 註冊失敗只留 log,無其他浮出機制 |
| 2255 | graceful shutdown 時關閉共用 Chromium pool(shutdownPool)失敗 | B(可以安靜) | — | process 即將 exit(0),failure 不影響任何資料或客人,刻意 fail-open 的收尾清理 |
| 2290 | startServer() 整個啟動流程拋錯,只 log error | A(必須浮出) | ③cron/部署可見性 | 全站啟動失敗只留一行 log,沒有 process.exit 或其他警報機制,Jeff 可能完全不知道這次部署沒有真的起得來 |

### `server/_core/inquiryReply.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 135 | 寄送客人回覆 email 失敗,只 log.error,emailSent 維持 false | A(必須浮出) | ④客人可見輸出 | 客人回覆信實際寄送失敗只留 server log,沒有主動通知任何人,與 Ann Yuan 事故同型態的客人信件寄送失敗 |
| 162 | email 寄送成功後,更新 thread 狀態為 replied 失敗,只 log.error | B(可以安靜) | — | 程式註解明確標註 best-effort、never block,失敗只影響 Inbox 狀態顯示,客人信本身已成功寄出 |
| 172 | 背景擷取客戶偏好(preference extraction)失敗,只 log.warn | B(可以安靜) | — | 明確標註 fire-and-forget 的加值功能,不影響已完成的回覆寄送 |

### `server/_core/interactionBackfill.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 320 | 分類回填單筆 customOrderId update 失敗 | B(可以安靜) | — | 不中斷其餘筆處理,批次工具本身可重跑,不影響既有資料正確性 |
| 337 | 分類回填整體流程例外 | B(可以安靜) | — | 回傳 status:error 給呼叫端,這是管理員手動觸發的批次工具,結果會直接顯示給觸發者 |

### `server/_core/llm.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 802 | Anthropic API 呼叫例外(含429限流) | B(可以安靜) | — | 記錄後由迴圈外層統一 throw(wrapped 或原始 err),屬 rethrow |

### `server/_core/llmCache.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 22 | Redis ping 啟動自檢失敗,標記 redisAvailable=false 改用記憶體快取 | B(可以安靜) | — | Redis 快取類 best-effort,有記憶體 fallback,不影響主流程 |
| 65 | Redis get 快取讀取失敗,fallback 改讀記憶體快取 | B(可以安靜) | — | Redis 快取類 best-effort,有 fallback |
| 101 | Redis set 快取寫入失敗,fallback 只寫記憶體快取 | B(可以安靜) | — | Redis 快取類 best-effort,有 fallback |
| 139 | 取得 Redis 快取統計(keys 數)失敗,只 log.warn 回傳 0 | B(可以安靜) | — | 純統計查詢,失敗不影響快取實際運作 |
| 169 | 清除 Redis 快取失敗,只 log.warn,記憶體快取仍照常清除 | B(可以安靜) | — | 快取清理 best-effort,非關鍵路徑 |

### `server/_core/llmCreditAlert.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 109 | LLM 額度耗盡的 notifyAgentMessage 高優先度警示卡貼卡本身失敗,只 log.warn | A(必須浮出) | — | 這是全站 AI 降級的最後一道通知機制,失敗又沒有 Sentry/其他管道兜底,Jeff 可能完全不知道全站 AI 已經掛了 |

### `server/_core/logger.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 200 | Sentry bridge 本身(logger.error 攔截轉發邏輯)執行失敗 | B(可以安靜) | — | 文件明確設計「NEVER throw from the observability layer」,失敗會寫入 stderr(非完全靜默),避免觀測層自身故障遞迴拖垮 logger |

### `server/_core/mergedProfile.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 85 | followMergePointer 查找合併指標(mergedIntoProfileId)失敗 | B(可以安靜) | — | 程式碼註明 filing 必須永遠不能因指標查找卡住而斷,degrade 回傳原始 id |

### `server/_core/notification.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 154 | notifyOwner 實際寄送 email(transport.sendMail)失敗,logger.error 後回傳 false | B(可以安靜) | — | 函式一開始(try 之前)已無條件呼叫 captureMessage 送 Sentry,email 通道即使失敗,通知內容已有 Sentry 記錄留底 |

### `server/_core/observabilityCounters.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 92 | messagesFailed 週增量計算的 DB/Redis 讀寫失敗 | B(可以安靜) | — | Wave1 硬化本身的觀測模組,刻意設計 never-throw 並回傳可辨識的 {kind:"error"} 狀態,會浮進週稽核卡片 |
| 161 | 載入某個佇列定義模組失敗,跳過該模組的佇列計數 | B(可以安靜) | — | 同一份刻意設計的觀測模組,單一模組失敗不影響其餘佇列統計,有 log.warn |
| 174 | 單一佇列 getFailedCount() 呼叫失敗 | B(可以安靜) | — | 回傳可辨識的 null(非真實 0),刻意設計避免與正常 0 混淆,有 log.warn |
| 228 | LLM circuit 統計讀取 Redis 失敗 | B(可以安靜) | — | 刻意設計 never-throw 並回傳可辨識的 {kind:"error"} 狀態,會浮進週稽核卡片 |

### `server/_core/outboundInteraction.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 95 | 回信寄出後,寫入 customerInteractions 時間軸紀錄失敗,log.warn 後回 {recorded:false} | A(必須浮出) | ①客人資料流 | 客人互動記錄可能丟失,雙向對話時間軸出現缺口,Ops AI/Jeff 之後讀取真實對話會漏看這筆已回覆內容 |

### `server/_core/parseLlmJson.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 67 | JSON.parse 解析 LLM 回應失敗 | B(可以安靜) | — | 已包裝成新的 SyntaxError 並 rethrow |

### `server/_core/plaidWebhook.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 70 | webhook raw body JSON.parse 失敗,log.error 後回 res.status(400) 給 Plaid | B(可以安靜) | — | 已將失敗回應給呼叫端(400)+記錄,且該路徑僅在已通過簽章驗證後幾乎不可能觸發,Plaid 會重送 |
| 102 | plaidWebhookEvents 稽核紀錄 insert 失敗,log.warn 忽略 | B(可以安靜) | — | 註解明寫 best-effort,webhook 確認不依賴此紀錄成功 |
| 159 | webhook 類型分派處理(觸發交易同步/處理 ITEM 錯誤/Hosted Link)整段失敗,只 log.error + 寫入 DB processedError 欄位,沒有 notifyOwner | A(必須浮出) | ②錢 | 銀行交易同步觸發失敗只寫進沒人主動看的稽核表,Jeff 不會知道 Plaid 同步斷了 |
| 301 | Hosted Link 流程取得 public_tokens (linkTokenGet) 失敗,log.error 後導致整個銀行連結流程無聲結束(無 notifyOwner) | A(必須浮出) | ②錢 | Jeff 主動連結銀行帳戶的操作背景失敗卻無任何通知,對照後面成功路徑有明確 notifyOwner |
| 398 | 個別銀行帳戶 insert linkedBankAccounts 失敗(非重複鍵),只 log.error 略過該帳戶繼續 | A(必須浮出) | ②錢 | 帳戶未寫入卻沒有 notifyOwner,且後面仍會用原始帳戶總數發送成功通知,誤導 Jeff 以為全部連結成功 |
| 448 | Hosted Link 單一 public_token 兌換/入帳整體流程失敗,只 log.error,無 notifyOwner | A(必須浮出) | ②錢 | 與成功路徑明確呼叫 notifyOwner 對比,失敗路徑完全無聲,Jeff 不會知道連結失敗 |

### `server/_core/plaidWebhookVerify.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 100 | JWT header 解碼失敗,回傳 {valid:false, reason} | B(可以安靜) | — | fail-closed 安全驗證設計,結構化失敗結果由呼叫端 res.status(400) 拒絕請求,已浮出 |
| 111 | JWK 載入失敗,回傳 {valid:false, reason, kid} | B(可以安靜) | — | 同上,fail-closed 並結構化回傳供呼叫端拒絕請求 |
| 129 | JWT 簽章驗證失敗,回傳 {valid:false, reason, kid} | B(可以安靜) | — | 同上,fail-closed 並結構化回傳供呼叫端拒絕請求 |

### `server/_core/posterProcessor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 245 | 海報 logo 疊圖合成失敗 | B(可以安靜) | — | 裝飾性 logo 疊加失敗,略過即可,不影響海報主體產出 |
| 337 | AI Vision 海報分析結果 JSON 解析失敗 | B(可以安靜) | — | 回傳明顯佔位標題『AI 解析失敗,請手動輸入標題』,已用 UI 可見佔位文字浮出給操作者 |
| 534 | 多平台行銷文案 JSON 解析失敗 | B(可以安靜) | — | fallback 直接把原始文字當作文案回傳讓 admin 可編輯,並非靜默消失 |

### `server/_core/preDepartureDraftService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 99 | 單一訂單的行前提醒信草稿(LLM 生成+寫入 preDepartureNotifications)失敗 | A(必須浮出) | ④客人可見輸出 | 迴圈內 log.error 後繼續下一筆,該客人行前重要提醒(集合地點/注意事項)完全沒有草稿產生,僅回傳的 created 計數會少於預期,無明確錯誤浮出 |

### `server/_core/prerender.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 83 | 等待頁面渲染完成(schema 注入)逾時 | B(可以安靜) | — | 註解明確聲明容許逾時,直接回傳當下 DOM 內容,屬刻意設計的 SEO 渲染降級 |
| 89 | 整個 bot 預渲染流程失敗(catch 本體) | B(可以安靜) | — | 函式文件明確聲明 never throws,呼叫端會退回靜態 shell,屬刻意 fail-open 的 SEO 輔助功能 |

### `server/_core/prerenderMiddleware.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 91 | Redis cache get 失敗 | B(可以安靜) | — | 註解明講 best-effort,失敗當作 cache miss 處理 |
| 101 | Redis cache set 失敗 | B(可以安靜) | — | 註解明講 best-effort,只是放棄快取不影響回應 |
| 142 | prerender middleware 整體渲染流程失敗 | B(可以安靜) | — | 註解明講 Never 500 a crawler,刻意退回靜態 shell 給 bot |

### `server/_core/promiseExtraction.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 127 | 呼叫 LLM 抽取客人承諾(promise)失敗,log.warn(non-fatal)後回傳 null | B(可以安靜) | — | 程式明確設計為寄信成功後的 best-effort 加值分析,失敗絕不能影響已成功寄出的信本身 |
| 294 | 整段承諾抽取與寫入 customerPromises 流程失敗(LLM 或 DB 錯誤),log.warn 後回傳 recorded:0 | B(可以安靜) | — | 函式文件明確標註絕不對外 throw,是掛在成功寄信之後的 best-effort 監控層 |

### `server/_core/puppeteerPool.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 66 | 關閉過期瀏覽器實例失敗,完全靜默 | B(可以安靜) | — | browser 變數緊接著被設為 null 準備重新啟動,舊實例是否真的關閉乾淨不影響後續流程 |
| 134 | 建立新分頁(newPage)失敗,log.error 後 throw err | B(可以安靜) | — | 已用 rethrow 方式浮出給呼叫端 |
| 182 | 伺服器啟動時預熱 Chromium 失敗,log.warn(non-fatal) | B(可以安靜) | — | 程式註解明確設計為 fire-and-forget、絕不能讓開機失敗,之後會 lazy-launch 補上 |
| 194 | 優雅關機時關閉瀏覽器失敗,完全靜默 | B(可以安靜) | — | 程序即將結束退出,瀏覽器關閉與否不影響任何後續行為 |

### `server/_core/receiptExtractor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 284 | 收據附件轉檔(圖片/PDF 前處理)失敗 | B(可以安靜) | — | 失敗走 parseReceiptResponse("") 進入 needsReview 狀態,有人工複核路徑接住,非真正靜默 |
| 323 | 收據 vision LLM 辨識呼叫失敗 | B(可以安靜) | — | 同上,進入 needsReview 讓人工複核 |

### `server/_core/referral.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 67 | 推薦碼寫入遇到非重複鍵的資料庫錯誤,重新 throw 往上拋(重複鍵則 continue 重試新碼) | B(可以安靜) | — | 已用 rethrow 方式浮出 |

### `server/_core/repurchaseCta.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 125 | 附加會員升級 CTA 到草稿回覆失敗 | B(可以安靜) | — | 已用 log.error({err}) 方式浮出(Sentry bridge),且註解明載「絕不能因為行銷附加失敗而搞壞詢問回覆流程」,fallback 回傳原始草稿 |

### `server/_core/requireAdmin.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 71 | authenticate() middleware 內部未預期錯誤,log.error 後 res.status(500).json(...) | B(可以安靜) | — | mechanical:已用 res.status(500) 回應呼叫端,已浮出 |

### `server/_core/sentMailFiling.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 157 | 單一寄件附件上傳 R2 並寫入 customerDocuments 失敗,log.warn non-fatal 後繼續下一附件 | A(必須浮出) | ①客人資料流 | 失敗後仍會走到 applyLabel 標記整封信已處理,該附件永遠不會被重新掃描或補歸檔 |
| 172 | 整封寄件信處理(profile 比對/labeling)失敗,log.warn non-fatal | B(可以安靜) | — | 失敗發生在 applyLabel 之前,該信不會被標記,3 分鐘後下次 poll 會自動重新掃描重試 |

### `server/_core/sentry.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 153 | Sentry SDK 本身呼叫 captureException 失敗,寫入 process.stderr | B(可以安靜) | — | 程式註解明確設計為觀測工具本身絕不能拖垮業務流程,已寫入 stderr 供伺服器日誌查看 |
| 172 | Sentry SDK 本身呼叫 captureMessage 失敗,寫入 process.stderr | B(可以安靜) | — | 同上,觀測工具 fail-open 設計 |

### `server/_core/spamBox.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 190 | 垃圾信救回後,自動生成 AI 草稿回覆任務失敗 | B(可以安靜) | — | inquiry 本身資料已保留(救回成功),只有 AI 草稿產生失敗,且錯誤已寫入 audit() 記錄供操作的 admin 查看 |

### `server/_core/stripeWebhook.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 47 | Stripe webhook 簽章驗證失敗(constructEvent 拋錯) | B(可以安靜) | — | 已回 res.status(400) 給 Stripe,Stripe Dashboard 會顯示此次 webhook 失敗,屬預期防禦行為 |
| 149 | event 處理過程中任何 handler 拋出的錯誤 | B(可以安靜) | — | 已用 res.status(500) 浮出,Stripe 會依此重試 |
| 151 | markStripeEventFailed 寫入失敗紀錄本身又失敗 | B(可以安靜) | — | 外層已用 res.status(500) 讓 Stripe 重試,此處只防止標記寫入例外炸掉回應 |
| 181 | checkout.session.completed 時補提升會員 tier 失敗 | B(可以安靜) | — | 屬安全網 fallback,customer.subscription.created 事件會另外觸發同一升級邏輯 |
| 336 | 付款成功後 award Packpoint 失敗 | B(可以安靜) | — | 程式碼明確註解「不讓 webhook 因點數失敗」,屬刻意 fail-open 次要獎勵功能 |
| 353 | 首筆付費 referral 獎金發放失敗 | B(可以安靜) | — | 以 users.referralBonusAwarded flag 判斷是否已發放,下次付款事件會自動重試,非永久遺失 |
| 367 | 取消棄單挽回信排程失敗 | B(可以安靜) | — | fail-open,最壞情況客人已付款仍收到催付信,屬體驗小瑕疵非資料/金流問題 |
| 444 | 供應商到府通知信寄送失敗 | A(必須浮出) | — | 供應商沒收到已付款通知可能導致實際出團準備缺失,Jeff 無從得知需人工補寄 |
| 449 | 寄給客人的付款成功確認信整段流程失敗(含供應商通知子區塊) | A(必須浮出) | ④客人可見輸出 | 客人付款後可能完全收不到任何確認信,屬客人應收到的輸出遺失 |
| 495 | notifyOwner + notifyAgentMessage 通知 Jeff「收到付款」本身失敗 | A(必須浮出) | ②錢 | 與 Ann Yuan 事故同型態 — Jeff 對付款到帳完全不知情 |
| 555 | 客戶駕駛艙時間軸訂票互動紀錄寫入失敗(fire-and-forget) | A(必須浮出) | ①客人資料流 | 客人自己時間軸的訂票事實紀錄可能遺失或不完整,屬客人資料流斷 |
| 596 | notifyOwner 通知「付款失敗」本身又失敗 | A(必須浮出) | ②錢 | 客人卡被拒時 Jeff 完全不知情,錯過補款挽回時機 |
| 627 | notifyOwner 通知 Stripe 爭議款(chargeback)本身又失敗 | A(必須浮出) | ②錢 | 爭議款有申訴截止時間,Jeff 沒收到通知可能逾期直接輸掉爭議 |
| 807 | 退款時 Packpoint clawback(收回點數)失敗 | A(必須浮出) | ②錢 | 客人退款後點數未收回,造成點數帳務與實際付款不一致的金流缺口 |
| 846 | notifyOwner 通知「已退款」本身又失敗 | A(必須浮出) | ②錢 | 程式註解自承退款是最高觸點財務事件,Jeff 沒被通知等於對退款一無所知 |
| 891 | 讀取 RefundAgent 客製化政策規則失敗 | B(可以安靜) | — | fallback 使用預設政策規則繼續跑,不影響退款本身已完成 |
| 969 | RefundAgent 自動 triage 失敗 | B(可以安靜) | — | 已用 notifyOwner 方式浮出,告知 Jeff 需自行撰寫客服回覆 |
| 1093 | 簽證付款完成後的確認信寄送失敗 | A(必須浮出) | ④客人可見輸出 | 客人已付簽證代辦費卻可能收不到任何確認信,屬客人應收到的輸出遺失 |
| 1109 | notifyOwner 通知簽證付款本身失敗 | A(必須浮出) | ②錢 | Jeff 對簽證付款進帳不知情 |
| 1437 | notifyOwner 通知「會員試用即將結束」本身失敗(空 catch,連 log 都無) | A(必須浮出) | ②錢 | AB-390 合規提醒信是否寄出的關鍵通知,空 catch 連 log 都沒有,Jeff 完全無從得知 |
| 1454 | 試用結束提醒信整段後續流程失敗(flag 已 commit 後 email 失敗) | B(可以安靜) | — | 已用 notifyOwner 緊急告知 Jeff 需人工補寄,符合浮出定義 |
| 1477 | 上一步「緊急通知 Jeff 補寄提醒信」的 notifyOwner 呼叫本身也失敗 | A(必須浮出) | ②錢 | 雙重失敗後已無任何管道通知 Jeff,AB-390 合規提醒信可能徹底漏發 |

### `server/_core/stripeWebhookIdempotency.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 11 | (行號位於檔頭 JSDoc 範例註解內,非真實程式碼)示範用法中的 catch | B(可以安靜) | — | 行號可能飄移,已就近核對:此行實為文件註解中的使用範例,真正對應的實際 catch 在同檔 line 69,該處對非重複鍵錯誤會 rethrow |
| 69 | claimStripeEvent insert 撞到唯一鍵時,查詢既有事件狀態；非重複鍵錯誤則繼續往外拋 | B(可以安靜) | — | 已用 throw 方式浮出(非重複鍵錯誤 rethrow),重複鍵視為合法的冪等跳過 |

### `server/_core/supplierCostVerification.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 129 | 成本佐證文件驗證流程意外失敗,log.warn 後回傳 ok:false 附原因 | B(可以安靜) | — | fail-closed 設計,呼叫端會看到明確的未驗證原因而非誤判為已驗證 |

### `server/_core/vite.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 54 | SPA fallback 渲染頁面(讀檔/transformIndexHtml)失敗,呼叫 next(e) | B(可以安靜) | — | 已交給 Express 錯誤處理中介層,等效回應 5xx 給呼叫端 |

### `server/_core/websiteIntake.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 126 | 網站表單客人建檔/歸戶解析(ensureCustomerProfileForWebsiteContact)失敗 | B(可以安靜) | — | 三個呼叫端(inquiries.ts、stripeWebhook.ts)皆註明 fire-and-forget/錦上添花,主要記錄(inquiries 表或 Stripe booking)都已在別處先完成,這裡只是客戶時間軸/紅點的次要增強 |
| 168 | recordWebsiteInteraction 寫入 customerInteractions 失敗 | B(可以安靜) | — | 同上,主記錄已在呼叫端別處完成,這裡是次要時間軸記錄,docstring 明寫絕不 throw |

### `server/_core/weeklyCanary.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 279 | checkUnreadCountQueryOk 未讀徽章查詢拋錯,log.error 後回 false | B(可以安靜) | — | 回傳 false 會被 verifyCanaryOutcome 判定失敗,觸發後續 high-priority agentMessages 卡通知 Jeff |
| 330 | submitCanaryInquiry HTTP 提交呼叫拋錯,log.warn,submitted 維持 false | B(可以安靜) | — | submitted=false 會在後面被判定為 canary 失敗,一樣觸發告警卡通知 Jeff |
| 356 | 三項驗證查詢的 Promise.all 拋錯,log.warn 後強制設 result={allPassed:false,...} | B(可以安靜) | — | 明確強制判定失敗,觸發後續告警卡通知 Jeff,不是靜默放行 |

### `server/_core/weeklyCorrectnessAudit.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 445 | 寫入週稽核 Redis heartbeat 失敗,log.warn | B(可以安靜) | — | 註解明言 fire-forget、Redis blip 絕不可讓稽核本身失敗,刻意設計的 fail-open |
| 482 | 單一客人 facts-gathering/diff 失敗,log.warn 後迴圈繼續 | B(可以安靜) | — | 函式註解明言 one customer's facts-gathering failure never aborts the scan,為刻意設計、下週會再次覆蓋該客人 |

### `server/_helpers/llmPlaceNormalizer.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 119 | LLM 地名正規化呼叫失敗 | B(可以安靜) | — | fail-open,結果留空由呼叫端使用原始字串,屬非關鍵文字增強功能 |

### `server/agentActivityService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 87 | logAgentStart 寫入 agentActivityLogs 開始紀錄失敗(DB insert) | A(必須浮出) | — | 這是 Jeff 賴以觀察所有 agent 執行狀況的核心紀錄系統本身寫入失敗且被靜默吞掉,屬於系統性故障訊號被吞 |
| 137 | logAgentComplete 寫入 agentActivityLogs 完成/失敗狀態失敗(DB update) | A(必須浮出) | — | 活動紀錄系統本身寫入失敗會讓任務永遠卡在 started 狀態且無人知道,是系統性故障訊號被吞 |
| 196 | cleanupZombieTasks 清理殭屍任務的 DB 操作失敗 | B(可以安靜) | — | 次要維護性清理,失敗只是殭屍任務未被標記失敗,不影響任務本身結果,下次執行可自我修復 |
| 225 | withActivityLog 包裝的任務函式執行失敗 | B(可以安靜) | — | 已寫入 logAgentComplete 失敗狀態後 throw err,已用 rethrow 方式浮出 |

### `server/agents/_helpers/safety.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 77 | 自動代理人(autonomous agent)執行失敗 | B(可以安靜) | — | 已用 notifyOwner 通知 + 最終 rethrow 原始錯誤方式浮出 |
| 92 | 上面 notifyOwner 通知本身也失敗 | B(可以安靜) | — | 只吞通知動作本身的失敗(寫入 stderr 留痕),原始錯誤仍在外層繼續 throw 出去,非完全靜默;文件明確設計避免遞迴崩潰 |

### `server/agents/_pipeline/assembly.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 145 | 套用已學習技能產生行程標籤(applyLearnedSkills fallback)失敗 | B(可以安靜) | — | 僅是行程自動標籤加值功能,失敗只是少了智能標籤,不影響行程主要內容 |
| 496 | Round68 用 dailyItinerary 長度回推 duration 的 JSON.parse 失敗 | B(可以安靜) | — | fallback 失敗只是維持原值(可能0天),後續 QA calibration 會扣分攔下 |
| 766 | 圖片存入 imageLibrary 失敗(含重複或DB錯誤) | B(可以安靜) | — | 註解明講 image library is non-critical,刻意 fail-open |
| 856 | 價格搶救後重跑 calibration 失敗 | B(可以安靜) | — | 非致命品質校準重試步驟,失敗保留原 calibrationReport |
| 942 | Self-Repair 重跑 ContentAnalyzer 失敗 | B(可以安靜) | — | 註解明講 non-fatal,自我修復迴圈其中一步失敗不影響主流程 |
| 961 | Self-Repair 重跑 ItineraryUnifiedAgent 失敗 | B(可以安靜) | — | 註解明講 non-fatal,自我修復迴圈失敗步驟 |
| 986 | Self-Repair 重跑 DetailsSkill(hotel/meal/cost/notice)失敗 | B(可以安靜) | — | 註解明講 non-fatal,自我修復迴圈失敗步驟 |
| 1015 | Self-Repair 迴圈內重跑 CalibrationAgent 失敗 | B(可以安靜) | — | 註解明講 non-fatal,失敗即 break 停止重試迴圈 |
| 1026 | 整個 P6 CalibrationAgent 階段失敗 | B(可以安靜) | — | 呼叫 progressTracker.failPhase 記錄該階段失敗狀態,且註解明講 non-fatal |

### `server/agents/_pipeline/colorTheme.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 96 | 記錄 ColorThemeAgent 活動的 logAgentComplete 呼叫失敗,log.warn+console.warn | B(可以安靜) | — | 純粹是後台 activity 稽核記錄失敗,配色方案本身已在稍早成功產生並快取,不影響實際功能 |

### `server/agents/_pipeline/contentAnalyzer.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 70 | 記錄 ContentAnalyzerAgent 活動紀錄(logAgentStart/logAgentComplete)失敗 | B(可以安靜) | — | 此時內容分析本身已成功(第48-53行已過關),這裡只是活動紀錄/儀表板用途失敗,不影響行程生成主流程 |

### `server/agents/_pipeline/fanout.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 111 | PDF→Unsplash hero/feature 圖片智慧管線整段失敗,吞掉繼續用預設空圖片產生行程 | B(可以安靜) | — | 圖片管線刻意 fail-open,不影響行程核心資料只影響圖片品質 |
| 150 | Vision 分析+smart-match 圖片配對失敗,吞掉繼續(圖片配對降級) | B(可以安靜) | — | 圖片智慧配對 best-effort,失敗不影響行程資料本身 |
| 246 | 記錄 ItineraryUnifiedAgent 詳細活動(logAgentStart/logAgentComplete)失敗,只 console.warn | B(可以安靜) | — | 純活動記錄用途,失敗不影響已產生的行程資料 |
| 338 | Unsplash hero 圖片搜尋(第三層 fallback)失敗,吞掉繼續用既有 fallback hero | B(可以安靜) | — | 圖片搜尋 best-effort,已有多層 fallback 鏈 |
| 392 | 記錄 DetailsSkill 詳細活動失敗,只 console.warn | B(可以安靜) | — | 純活動記錄用途,失敗不影響已產生的費用/飯店/餐飲資料 |
| 399 | DetailsSkill 結果寫入 generationCache 快取失敗,吞掉繼續(本次回傳資料不受影響) | B(可以安靜) | — | 純快取寫入,Redis/快取類 best-effort,掛了下次重算即可 |
| 469 | 記錄 TransportationAgent 詳細活動失敗,只 console.warn | B(可以安靜) | — | 純活動記錄用途,失敗不影響已產生的交通資料 |
| 533 | hotelImagePool 的 Unsplash 補圖搜尋失敗,吞掉繼續(圖片池可能較短) | B(可以安靜) | — | 圖片補位 best-effort,不影響飯店資料正確性 |
| 553 | mealImagePool 的 Unsplash 補圖搜尋失敗,吞掉繼續 | B(可以安靜) | — | 圖片補位 best-effort,不影響餐飲資料正確性 |
| 593 | highlightImagePool 的 Unsplash 補圖搜尋失敗,吞掉繼續 | B(可以安靜) | — | 圖片補位 best-effort,不影響行程亮點文字資料 |

### `server/agents/_pipeline/rollback.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 87 | pipeline 失敗後的 R2 資產清理(rollback)本身失敗,只 log.warn+console.warn | B(可以安靜) | — | 程式注解明寫 non-fatal best-effort 清理,失敗只造成少量孤兒檔案,不影響資料正確性 |

### `server/agents/_pipeline/scrape.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 224 | 補充 URL(supplement URL)動態爬取+日期擷取處理失敗 | B(可以安靜) | — | 註解明載 non-fatal,只是少合併一些補充資料,主流程繼續 |
| 817 | 雄獅行事曆(groupcalendarjson)Puppeteer 補值失敗 | B(可以安靜) | — | 僅是出發日期資料的補充嘗試,失敗不影響已快取的主要 rawData |
| 848 | Puppeteer 動態爬取失敗(逾時例外會直接 rethrow,其餘才落到這裡) | B(可以安靜) | — | 有 scrapeStaticFallback 靜態 HTTP 備援接手,且逾時案例本身已 throw 出去 |
| 874 | DateExtractorAgent(AI 視覺辨識出發日)執行失敗 | B(可以安靜) | — | 註解明載 non-fatal,extractedTourMeta 留 null,行程仍可繼續產生供 admin 審核 |
| 1061 | 雄獅價格救援 API 呼叫也失敗 | B(可以安靜) | — | 本身就是「搶救」性質的額外嘗試,失敗只是沒搶救成功,不影響既有 rawData |

### `server/agents/_subskills/details/detailsSkill.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 326 | SKILL.md 載入失敗,退回內建 fallback 內容 | B(可以安靜) | — | 刻意設計的降級內容,有 console.error 記錄,不影響整體流程繼續 |
| 456 | 合併單次 LLM 呼叫失敗,退回原始四次並行子技能模式 | B(可以安靜) | — | 多層次刻意降級架構(combined→parallel→各子技能自身 default),有記錄 |
| 609 | 餐飲資訊 LLM 生成失敗,退回 getDefaultMeals 預設值 | B(可以安靜) | — | 刻意設計的 fallback 預設內容,有 console.error 記錄 |
| 690 | 住宿資訊 LLM 生成失敗,退回 getDefaultHotels 預設值 | B(可以安靜) | — | 刻意設計的 fallback 預設內容,有 console.error 記錄 |
| 746 | 費用說明 LLM 生成失敗,退回 getDefaultCosts 預設值 | B(可以安靜) | — | 刻意設計的 fallback 預設內容,有 console.error 記錄 |
| 796 | 注意事項 LLM 生成失敗,退回 getDefaultNotices 預設值 | B(可以安靜) | — | 刻意設計的 fallback 預設內容,有 console.error 記錄 |

### `server/agents/_subskills/skillLoader.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 85 | 掃描 skills 目錄(discoverSkills)失敗 | B(可以安靜) | — | 內部 agent 子技能設定載入,非客人資料/金流,失敗只是回傳空清單 |
| 316 | SKILL.md 內嵌 JSON Schema 解析失敗 | B(可以安靜) | — | 內部設定檔解析,失敗回傳 null 不影響其他部分 |

### `server/agents/agentOrchestration.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 76 | RetryManager.executeWithRetry 單次執行失敗,catch 內判斷是否可重試,不可重試或重試耗盡則 throw error | B(可以安靜) | — | 已用 rethrow 方式浮出(不可重試立即拋出,重試耗盡後拋出) |
| 401 | executeTask 執行單一任務失敗,標記 task.status=failed 並 throw error 重新拋出 | B(可以安靜) | — | 已用 rethrow 方式浮出 |

### `server/agents/autonomous/agentTools.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 492 | agent tool 呼叫分派整體失敗(所有 case 的統一 catch) | B(可以安靜) | — | 回傳 ok:false+error 給呼叫端(LLM/agent 工具呼叫者),即時可見失敗 |

### `server/agents/autonomous/financeAdvisor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 152 | askFinanceAdvisor 呼叫 invokeLLM 失敗 | B(可以安靜) | — | 直接把錯誤訊息當作回答文字回傳給提問者,提問當下就能看到失敗訊息,非靜默吞掉 |

### `server/agents/autonomous/financeAlertProducer.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 121 | Stripe 對帳檢查本身執行失敗(reconciliationService 呼叫錯誤),log.warn 後回傳 null(視同無異常) | B(可以安靜) | — | 模組文件明確設計為每個 check 失敗就 skip gracefully,屬於刻意 fail-open 的唯讀監控層 |
| 170 | 利潤下滑檢查執行失敗,log.warn 後回傳 null | B(可以安靜) | — | 同模組刻意 fail-open 設計的監控檢查 |
| 206 | 未分類交易堆積檢查執行失敗,log.warn 後回傳 null | B(可以安靜) | — | 同模組刻意 fail-open 設計的監控檢查 |
| 243 | Trust 帳戶異常檢查執行失敗,log.warn 後回傳 null | B(可以安靜) | — | 此為刻意 fail-open 的檢查機制本身失敗,不是 trust 帳務本身算錯 |
| 291 | 供應商付款對帳檢查執行失敗,log.warn 後回傳 null | B(可以安靜) | — | 同模組刻意 fail-open 設計的監控檢查 |
| 347 | 已偵測到的財務異常(payload 已產生)要建立 approval task 通知 Jeff 時失敗,只 log.error,continue 下一筆 | A(必須浮出) | ②錢 | 這是真正偵測到金流異常後,通知機制本身失敗,Jeff 完全不會看到這個已發現的異常 |

### `server/agents/autonomous/financeExecutor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 41 | finance_alert 審核執行器內部例外,log.error 後回傳 {status:failed, errorMessage} | B(可以安靜) | — | 註解明訂 never-throw 合約,失敗以結構化狀態回傳給審核箱路由,Jeff 在審核箱 UI 會看到該列失敗 |

### `server/agents/autonomous/followupDraftOnDemand.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 75 | fetchRecentGeneratedAttachments 查詢最近產生的 PDF 附件失敗,log.warn 後回空陣列 | B(可以安靜) | — | 函式註解明寫 best-effort,查失敗回空陣列,且有誠實閘擋住聲稱附上卻沒附件的空寄情形 |
| 164 | draftFollowupEnforcingLanguage 產生跟進草稿失敗,log.warn 後回傳 {status:skipped, reason:empty_draft} | B(可以安靜) | — | Jeff 在聊天中即時要求產草稿,失敗結果同步回到當次聊天回應,Jeff 會立即看到沒有草稿 |

### `server/agents/autonomous/followupDraftProducer.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 275 | 動態載入 schema/drizzle-orm 失敗,導致 honesty-gate 查詢無法執行 | B(可以安靜) | — | 註解明講兩道 gate 都刻意 fail open,屬設計上的保守預設 |
| 325 | 查詢 delivery evidence(quote/confirm/文件)失敗 | B(可以安靜) | — | 註解明講 claim gate fails open,刻意設計 |
| 341 | 查詢客人姓名 profileName 失敗 | B(可以安靜) | — | 註解明講 greeting gate fails open,刻意設計 |
| 705 | 批次迴圈中單一客人跟進信草稿產生失敗 | B(可以安靜) | — | log.warn 標 non-fatal 並累計 skipped.error 計數,批次繼續處理下一位客人,屬背景批次個別失敗 |

### `server/agents/autonomous/gmailPipeline.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 118 | Redis SET NX 訊息鎖取得失敗(例外),吞掉後視為已取得鎖繼續處理該封信 | B(可以安靜) | — | 模組頂部註解明載 FAIL-OPEN 設計:Redis 掛了寧可重複處理也不能漏信 |
| 196 | listUnreadMessages 抓信整批失敗,回傳 ok:false+errors 但不 throw | A(必須浮出) | ①客人資料流 | 回傳值不拋出,繞過 gmailPollWorker 外層專門處理 OAuth 撤銷通知的 catch,整輪 0 封信被處理也無人被通知 |
| 295 | trailing-reconcile 補漏同步整段失敗 | B(可以安靜) | — | 註解明載 non-fatal,只是回填已讀未歸檔訊息的補強機制,下一輪還會重試 |
| 465 | LLM 訂單自動指派失敗,customOrderId 留 NULL | B(可以安靜) | — | log.warn 明寫 non-fatal,只影響互動要不要自動掛單,不影響信件本身歸檔 |
| 527 | 收據信處理失敗(vision 擷取或建 pendingExpense 出錯) | A(必須浮出) | ②錢 | 只 result.totalFailed++/console log,未接 failedThisRun 卡片機制,也未 notify,Jeff 不會知道這封供應商收據沒被記到 |
| 609 | processOneEmail 單封真實客人來信處理失敗 | B(可以安靜) | — | 同函式稍後透過 failedThisRun 洪水閘呼叫 notifyAgentMessage 貼卡浮出,這正是 Ann Yuan 事故修復本身 |
| 638 | 貼「客人來信失敗」單卡本身(notifyAgentMessage)又失敗 | A(必須浮出) | ①客人資料流 | 只 log.error,沒有第二層保險,原始的客人來信處理失敗這件事完全沒有任何管道通知 Jeff |
| 649 | 貼「客人來信失敗」聚合卡(>5封洪水閘)本身又失敗 | A(必須浮出) | ①客人資料流 | 只 log.error,同上,整批客人來信處理失敗完全無人知道 |
| 727 | history.list 增量抓信(push 路徑)整批失敗,回傳 ok:false+errors 但不 throw | A(必須浮出) | ①客人資料流 | 與196同構,繞過外層 OAuth 撤銷通知,push 這輪不會處理任何新信也無人被通知 |
| 951 | 新客歷史信件自動收集佇列(customerBackfillQueue)enqueue 失敗 | B(可以安靜) | — | log.warn 明寫 non-fatal,只影響新客歷史信件是否自動回補 |
| 969 | email→會員帳號歸戶連結(linkProfileToUserByEmail)失敗 | B(可以安靜) | — | 註解明寫 best-effort,失敗不影響信件本身歸檔 |
| 1030 | tour 代碼解析(resolveFromEmail)失敗 | B(可以安靜) | — | 註解明寫 best-effort,resolver 失敗不擋回覆生成 |
| 1057 | Gmail 整串 thread 歷史抓取失敗 | B(可以安靜) | — | 註解明寫 best-effort,只影響 agent 看到的上下文完整度 |
| 1180 | customerInteractions insert 撞 UNIQUE(profileId, externalId)例外 | B(可以安靜) | — | 非重複鍵情況會在同一 catch 內 throw e 往外拋(已 rethrow),重複鍵才是預期內的冪等恢復 |
| 1267 | 單一客人文件附件(passport 掃描等)上傳/寫入失敗 | B(可以安靜) | — | per-attachment try/catch,註解明寫 non-fatal,其餘附件仍照常處理 |
| 1275 | 客人文件歸檔整體流程(含 import/偵測)失敗 | B(可以安靜) | — | 註解明寫 non-fatal,失敗不擋信件本身處理 |
| 1359 | skill 自動派工(dispatchAndPersistFromInquiry)動態 import 或執行意外拋出 | B(可以安靜) | — | 註解明寫吞掉後退回既有 legacy draftReply 路徑,不中斷客人草稿產生 |
| 1390 | PACK&GO Plus 升級 CTA 附加(maybeAppendUpgradeCta)失敗 | B(可以安靜) | — | log.warn 明寫 non-fatal,只影響行銷文字是否附加 |
| 1502 | 自動回覆實際寄送(sendReplyInThread)拋出例外 | A(必須浮出) | ④客人可見輸出 | sendOutcome 標成 send_failed 但 shouldEscalate 為 false 時只落入通用 observation 卡且標籤誤植成「Draft 已存」,今日待辦 autoReplyBox 只認 auto_replied/would_auto_send 兩種狀態、不含 send_failed,客人沒收到回覆且沒人被正確提醒 |
| 1709 | #inquiry 頻道 observation 通知卡(notifyAgentMessage)寄送失敗 | B(可以安靜) | — | 底層 interactionOutcomes/customerInteractions 已先落 DB,今日待辦 autoReplyBox 另有獨立讀取路徑,這裡只是次要通知卡失敗 |
| 1762 | RefundAgent 深度退款 triage 失敗 | B(可以安靜) | — | refund_request 分類已在 InquiryAgent 的 alwaysEscalate 讓通用 escalation 卡先浮出,這裡失敗只遺失額外 severity/reasonCategory 細節 |
| 1802 | 整封信所屬 Gmail thread 全量同步(syncThreadToInteractions)失敗 | B(可以安靜) | — | 註解明寫 best-effort,信件本身已處理完成,失敗只影響是否補齊同 thread 其他訊息 |
| 1817 | 客戶卡片摘要刷新(enqueueCustomerSummaryRefresh)enqueue 失敗 | B(可以安靜) | — | 註解明寫 fire-forget non-fatal,等下次夜間 cron 仍會補上 |
| 1829 | 客人偏好萃取(extractAfterReply)promise 鏈失敗 | B(可以安靜) | — | 註解明寫 fire-forget non-fatal |
| 1857 | 收據信原始附件(fetchRawAttachments)抓取失敗 | B(可以安靜) | — | 註解明寫 non-fatal,extraction 仍會用信件本文繼續跑,且 Jeff 本就會人工審每一筆 pendingExpense |
| 1876 | 收據附件上傳 R2 失敗 | B(可以安靜) | — | 註解明寫 non-fatal,pendingExpense 仍會建立供 Jeff 人工審核,只是少了附件連結 |

### `server/agents/autonomous/inquiryAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 656 | JSON.parse 解析 LLM tool_call 參數失敗,catch 後 throw new Error 重新拋出 | B(可以安靜) | — | 已用 rethrow 方式浮出 |

### `server/agents/autonomous/inquiryReplyExecutor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 116 | 核准後寄出客人詢問回覆時發生未預期 DB 錯誤 | B(可以安靜) | — | 明確轉成 {status:"failed",errorMessage} 結構化結果回傳,approval 任務流程會看到失敗狀態 |

### `server/agents/autonomous/marketingExecutor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 104 | marketing draft 核准執行器內未預期錯誤 | B(可以安靜) | — | 已用 log.error({err}) 觸發 Sentry.captureException,且回傳 {status:"failed", errorMessage} 供核准流程呈現 |

### `server/agents/autonomous/opsActions.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 189 | executeAction 統一 catch:任何 action(退款/寄信/分類帳單等)執行拋出例外 | B(可以安靜) | — | 回傳 ok:false+error 給呼叫端(chat/agent 介面即時看到失敗訊息),非真正吞掉 |
| 511 | Stripe 退款 API 呼叫失敗 | B(可以安靜) | — | triggerRefund 為 sensitive 動作,經人工核准流程呼叫,失敗訊息即時回傳給核准/呼叫端 |
| 535 | 財務警示掃描 produceFinanceAlerts 失敗 | B(可以安靜) | — | 回傳 ok:false 給呼叫端,指揮中心互動流程即時可見 |
| 552 | askFinanceAdvisor 問答失敗 | B(可以安靜) | — | 回傳 ok:false 給呼叫端,Jeff 在對話中即時看到失敗 |
| 595 | doProduceInquiryReply 產生詢問客服草稿失敗 | B(可以安靜) | — | 回傳 ok:false 給呼叫端,操作者即時可見 |
| 620 | 報稅 CSV 生成失敗 | B(可以安靜) | — | 回傳 ok:false 給呼叫端,手動觸發動作操作者即時可見 |
| 651 | 銀行交易批次分類 classifyUncategorizedBatch 失敗 | B(可以安靜) | — | 回傳 ok:false 給呼叫端,操作者即時可見 |
| 679 | 微信回覆草稿生成失敗 | B(可以安靜) | — | 回傳 ok:false 給呼叫端,操作者即時可見 |
| 740 | collectCustomerThreads 迴圈中單一 mailbox 的客人信件回填失敗 | A(必須浮出) | ①客人資料流 | 僅 log.warn 標 non-fatal 繼續下一個 mailbox,整體結果仍回傳 ok:true,該客人信件歷史可能不完整且無人知曉 |

### `server/agents/autonomous/opsAgentStream.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 159 | withRetry 內單次呼叫失敗(429/500/529 可重試,其餘或已達上限直接失敗) | B(可以安靜) | — | 已用 rethrow(不可重試或達上限時 throw err)方式浮出 |
| 376 | draft_followup 工具呼叫產生跟進信草稿失敗 | B(可以安靜) | — | outcome 訊息「草擬時出錯,請再試一次」會直接回寫進 SSE 對話串給 Jeff 看到,屬即時浮出 |
| 463 | runOpsAgentStream 產生器最外層串流失敗 | B(可以安靜) | — | 已用 log.error({err}) 方式浮出(Sentry bridge),且同時 yield type:"error" 回前端聊天視窗 |

### `server/agents/autonomous/opsTools.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 664 | executeReadTool 執行讀取工具拋錯,記 warn 後轉成 {error} JSON 字串回傳給呼叫端 | B(可以安靜) | — | 設計上失敗轉成 error 結果回傳 ops chat 對話,不是真的吞掉,Jeff 看得到工具失敗訊息 |
| 1130 | 掃描客人 Gmail 往來時,單一 mailbox 查詢失敗 | B(可以安靜) | — | best-effort 多信箱掃描,失敗記 warn 後繼續下一個 mailbox,整體結果仍回傳(該信箱標 threadsSeen:0) |
| 1645 | 蒐集訂單 invoice 金額防呆(gatherOrderInvoiceForbiddenCents)失敗直接回空陣列 | B(可以安靜) | — | 註解明說 best-effort,supplierCost 硬防線仍在別處守住,不影響主流程 |
| 1747 | 把剛產生的客人文件掛到待審草稿(attachDocToPendingDraft)失敗回 null | B(可以安靜) | — | best-effort attach,呼叫端會誠實在回覆訊息告知 Jeff 文件已產生但沒掛上草稿 |
| 1980 | executeWriteTool 執行寫入工具拋錯,記 warn 後轉成 {error} JSON 回傳給呼叫端 | B(可以安靜) | — | 同讀取工具,設計上轉成 error 結果回傳 ops chat 對話可見 |
| 2284 | 建立客製訂單後,重算客人摘要(enqueueCustomerSummaryRefresh)排入佇列失敗完全靜默 | B(可以安靜) | — | 非核心 UI 摘要快取刷新,best-effort,訂單本身已建立成功回傳 |
| 2342 | 更新客製訂單後,同樣重算客人摘要排入佇列失敗完全靜默 | B(可以安靜) | — | 同上,best-effort 快取刷新,訂單更新本身已成功 |
| 2490 | generate_customer_document 產生文件時非 gate 類的非預期錯誤,log.error 後回傳一般錯誤訊息給呼叫端 | B(可以安靜) | — | 已回傳 error 給 ops chat 呼叫端,Jeff 看得到並可重試或改手動流程 |
| 2591 | 把對話歸戶到訂單後,重算客人摘要排入佇列失敗完全靜默 | B(可以安靜) | — | 同 2284/2342,best-effort 快取刷新,歸戶動作本身已成功 |

### `server/agents/autonomous/quoteExecutor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 125 | quoteDraftExecutor 標記已報價流程意外拋錯,回傳 {status:'failed', errorMessage} | B(可以安靜) | — | 註解明言讓 approval router 乾淨標記該任務列為失敗,結構化狀態在任務佇列中可見 |

### `server/agents/calibrationAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 243 | combinedQualityLLM 合併品質檢查 LLM 呼叫失敗,console.warn 後回 null | B(可以安靜) | — | 註解明說會 fall back 到逐項 LLM 呼叫,是設計內建的降級路徑 |
| 544 | checkContentFidelity 內容忠實度 LLM 呼叫失敗 | B(可以安靜) | — | 註解記錄 2026-05-16 修過的吞錯誤 bug,現在改成強制回傳 score:0 + critical _llm_failure 標記讓 orchestrator 強制 reject,不會被靜默放行 |
| 620 | checkTranslationQuality 翻譯品質檢查失敗,console.warn 後推入 warning 級 issue 並回傳 score:80 | B(可以安靜) | — | 失敗會變成校準報告裡一筆可見的 warning issue,不是完全消失 |
| 1129 | autoFix 迴圈中單一欄位自動修正失敗,console.warn 後略過該欄位繼續下一個 | B(可以安靜) | — | best-effort 自動修正,失敗只是少修一個欄位,主要校準分數/issue 已由其他檢查函式各自算好 |

### `server/agents/claudeAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 263 | LLM usage/cost 記錄非同步寫入 DB 失敗 | B(可以安靜) | — | 程式碼註明「非阻塞...失敗不影響主流程」,純內部成本監控非客人金流 |
| 356 | sendMessage 呼叫 Anthropic API 整體失敗(含 Forge fallback 嘗試) | B(可以安靜) | — | 回傳 {success:false,error} 給呼叫端,非靜默吞掉 |
| 383 | sendMessage 的 Forge fallback 也失敗 | B(可以安靜) | — | 只 console.error,但外層仍會回傳 success:false 給呼叫端,失敗狀態仍浮出 |
| 460 | sendConversation 呼叫失敗 | B(可以安靜) | — | 回傳 {success:false,error} 給呼叫端 |
| 587 | sendStructuredMessage 呼叫整體失敗(含 Forge fallback 嘗試) | B(可以安靜) | — | 回傳 {success:false,error} 給呼叫端 |
| 627 | sendStructuredMessage 的 Forge fallback 也失敗 | B(可以安靜) | — | 只 console.error,但外層仍回傳 success:false 給呼叫端 |
| 690 | streamConversation SSE 串流過程出錯 | B(可以安靜) | — | console.error 後 throw error rethrow 浮出 |
| 755 | legacy extractStructuredData 解析回應 JSON 失敗 | B(可以安靜) | — | 回傳 {success:false,error} 給呼叫端 |

### `server/agents/colorThemeAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 46 | 配色主題生成(generateColorTheme)失敗 | B(可以安靜) | — | 誠實回傳 success:false+error 給呼叫端,且僅為頁面裝飾用色非核心資料 |

### `server/agents/contentAnalyzerAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 260 | ContentAnalyzerAgent.execute() 整段失敗,只 console.error 回傳 {success:false} | B(可以安靜) | — | 確認呼叫端 _pipeline/contentAnalyzer.ts 對 success:false 會直接 throw,使整個行程生成任務可見地失敗,已用 rethrow 方式浮出 |
| 411 | generateAllContent 的 LLM 文案生成失敗,吞掉改用原標題/描述組成的預設文案 | B(可以安靜) | — | 有明確合理 fallback 內容,不影響行程核心資料 |
| 641 | applySkills 標籤分類失敗,吞掉回傳全空陣列 | B(可以安靜) | — | 僅影響行銷標籤展示,不影響核心行程資料 |

### `server/agents/dateExtractorAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 679 | logLlmUsage 記錄 Claude Vision 用量失敗 | B(可以安靜) | — | 用量記錄 best-effort,不影響抽取結果 |
| 754 | Claude Vision 抽取出發日/價格/名額失敗 | B(可以安靜) | — | 刻意設計 5 策略文字 fallback chain 繼續產出結果,fail-open |

### `server/agents/diagnostics.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 158 | 診斷步驟「URL 分析」解析網址失敗 | B(可以安靜) | — | 診斷工具設計本就把每步驟失敗轉成 status:'error'+error 訊息回傳,直接顯示在診斷報告 UI 上 |
| 298 | 診斷步驟「ItineraryExtractAgent 行程提取」測試拋錯 | B(可以安靜) | — | 同上,診斷報告設計上本就要顯示每步驟成功/失敗狀態 |
| 365 | 診斷步驟「ItineraryPolishAgent 行程美化」測試拋錯 | B(可以安靜) | — | 同上,診斷工具刻意把錯誤轉成可見的診斷步驟結果 |
| 407 | 診斷步驟「ContentAnalyzerAgent 內容分析」測試拋錯 | B(可以安靜) | — | 同上,診斷報告設計上顯示每步驟結果 |
| 441 | 診斷步驟「ColorThemeAgent 配色主題」測試拋錯 | B(可以安靜) | — | 同上,診斷工具本就要把失敗顯示出來,不是靜默吞掉 |

### `server/agents/exchangeRateAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 66 | 呼叫外部匯率 API 失敗,console.error 後回傳硬編碼備用匯率 | B(可以安靜) | — | 三層快取加備用匯率是文件明確記載的刻意設計,備用匯率僅供大略換算使用 |
| 113 | Redis 匯率快取讀取失敗,console.warn 後降級到記憶體快取 | B(可以安靜) | — | 多層快取 fallback 設計的一環,純 best-effort |
| 133 | 寫入 Redis 匯率快取失敗,console.warn,訊息標註 non-critical | B(可以安靜) | — | 快取寫入 best-effort,不影響已取得的匯率結果回傳 |

### `server/agents/flightAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 216 | 航班資訊 LLM 生成失敗,退回 generateDefaultFlight 通用預設值 | B(可以安靜) | — | 與 detailsSkill 系列一致的刻意 fallback 預設內容架構,有 console.error 記錄,預設文字保守(如「依實際訂位為準」) |

### `server/agents/imageGenerationAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 91 | execute() 整體圖片生成流程任何例外 | B(可以安靜) | — | 以結構化 return {success:false, error} 回傳給呼叫端,非靜默吞掉 |
| 147 | CSE 主圖搜尋失敗 | B(可以安靜) | — | 刻意 fallback chain,改用 Unsplash 取圖,fail-open 設計 |
| 171 | 單一 highlight 圖片產生失敗 | B(可以安靜) | — | fallback 至預留圖繼續迴圈,不影響其他圖片 |
| 208 | 單一 feature 圖片產生失敗 | B(可以安靜) | — | 同上,fallback 至預留圖 |
| 260 | Unsplash 搜尋圖片失敗 | B(可以安靜) | — | fallback 至預留圖,fail-open |
| 290 | 圖片上傳 S3 失敗 | B(可以安靜) | — | fallback 直接回傳原始外部圖片網址,功能仍可運作 |

### `server/agents/imagePromptAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 86 | ImagePromptAgent.execute 整體流程未預期例外 | B(可以安靜) | — | 回傳結構化 {success:false,error} 供呼叫端判斷,且行程圖片生成本身有多層 fallback |
| 151 | Hero 圖片 prompt 生成呼叫 Claude 失敗(重試中) | B(可以安靜) | — | 有 2 次重試 + 最終 fallback 到 basePrompt,不影響最終仍能產圖 |
| 210 | 亮點圖片 prompt 生成失敗 | B(可以安靜) | — | fallback 直接 push basePrompt,圖片仍可產生只是 prompt 較樸素 |
| 267 | 特色圖片 prompt 生成失敗 | B(可以安靜) | — | 同上,fallback 到 basePrompt 不中斷流程 |

### `server/agents/itineraryUnifiedAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 170 | 載入 Data-Fidelity-Rules 參考文件失敗,只 console.warn 繼續 | B(可以安靜) | — | 僅使 LLM 提示詞失去領域規則文字,屬品質降級非資料遺失,有既有 fallback |
| 222 | 載入 Taiwan-Tour-Types(鳴日號)參考段落失敗,只 console.warn,MINGRI_TRAIN 判定仍成立 | B(可以安靜) | — | 僅提示詞失去領域知識,判斷邏輯本身仍正確運作 |
| 640 | LLM 美化行程整段失敗,吞掉改用未美化的原始 extractedItineraries 當結果回傳 | B(可以安靜) | — | 有明確合理 fallback,保留原始資料正確性,只是文字未潤飾 |
| 938 | execute() 整個行程生成流程失敗,只 console.error 回傳 {success:false} | A(必須浮出) | ④客人可見輸出 | 確認呼叫端 fanout.ts 對此結果不會 throw,而是靜默把 itineraryData 設為空陣列繼續組出行程頁,客人可能看到空白行程且無人知曉 |

### `server/agents/learningAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 181 | LLM 用量記錄 logLlmUsage 寫入失敗 | B(可以安靜) | — | 註解 /* silent */,刻意 best-effort 用量記錄 |
| 192 | 解析 LLM 回應 JSON 失敗 | B(可以安靜) | — | 推進 errors 陣列並隨結果回傳給呼叫端,技能學習非核心客人流程 |
| 234 | 建立單一技能 createSkill 失敗 | B(可以安靜) | — | 推進 errors 陣列並隨結果回傳,技能學習屬輔助功能 |
| 253 | 整體技能學習流程 learnSkillsFromContent 失敗 | B(可以安靜) | — | 回傳 success:false 給呼叫端,技能學習屬輔助功能 |
| 307 | 套用已學習技能 applyLearnedSkills 失敗 | B(可以安靜) | — | 回傳空 labels,僅影響行程自動標籤加值 |
| 320 | 初始化內建技能 seedBuiltInSkills 失敗 | B(可以安靜) | — | 僅影響非核心的內建技能標籤功能初始化 |

### `server/agents/masterAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 184 | LionTravel 舊網址格式自動轉換失敗,console.warn 後保留原 url 繼續 | B(可以安靜) | — | 程式碼註解明說 non-fatal,退回使用原始網址繼續走後續流程 |
| 404 | 行程生成成功後,清理殭屍任務(cleanupZombieTasks)失敗完全靜默 | B(可以安靜) | — | fire-and-forget 背景維護任務,不影響剛完成的行程結果 |
| 413 | MasterAgent 整體 try 區塊的總 catch,console.error 後記錄 logAgentComplete(status:'failed')並回傳 success:false | B(可以安靜) | — | 已寫入 agent activity log 供後台稽核可見,且回傳 success:false 讓呼叫端知道失敗,不是靜默吞掉 |
| 427 | 失敗時嘗試取得 progress 快照供 rollback 用,取快照本身失敗只 console.warn,partialDataForRollback 維持 undefined | B(可以安靜) | — | 次要清理用途的旁支失敗,主錯誤已在外層 catch 完整記錄,只是可能少清理孤兒 R2 資產 |
| 447 | 失敗路徑也清理殭屍任務,完全靜默 | B(可以安靜) | — | 同 404,fire-and-forget 背景維護任務 |
| 453 | rollback(partialData) 失敗只 console.warn | B(可以安靜) | — | 註解明說 rollback 設計上 never throws、不遮蓋原始錯誤,失敗已記錄供之後調查孤兒資產累積 |

### `server/agents/parsers/lionTravelPrintParser.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 140 | URL 轉列印版網址時失敗 | B(可以安靜) | — | 退回原始 URL,不影響後續解析主流程 |
| 192 | 解析 Lion 行程列印版 Markdown 內容整體失敗 | B(可以安靜) | — | 回傳 null,屬供應商目錄匯入解析步驟,呼叫端可另行處理失敗 |

### `server/agents/pdfParserAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 141 | logLlmUsage 記錄 LLM 用量失敗,.catch 靜默吞掉 | B(可以安靜) | — | 僅用量計費統計記錄,非核心 PDF 解析結果 |
| 147 | analyzePdfWithText 呼叫 LLM 分析文字失敗,console.error 後 throw new Error 重新拋出 | B(可以安靜) | — | 已用 rethrow 方式浮出 |
| 304 | logLlmUsage 記錄 LLM 用量失敗,.catch 靜默吞掉 | B(可以安靜) | — | 僅用量計費統計記錄,非核心 PDF 解析結果 |
| 310 | analyzePdfWithLLM 直接分析 PDF 失敗,console.error 後 throw new Error 重新拋出 | B(可以安靜) | — | 已用 rethrow 方式浮出 |
| 338 | 下載 PDF buffer(供圖片提取用)失敗,console.warn 後 pdfBuffer 維持 null 繼續執行 | B(可以安靜) | — | 僅影響行程圖片提取,不影響文字/價格/行程主解析結果 |
| 465 | PDF 圖片提取(extractImagesFromPdf/uploadPdfImages)失敗,console.warn 後回傳空陣列 | B(可以安靜) | — | 程式碼明確註記 non-fatal,圖片是行程附加內容非核心資料 |
| 477 | parsePdf 整體解析失敗,console.error 後 throw error 重新拋出 | B(可以安靜) | — | 已用 rethrow 方式浮出,交由呼叫端(如 BullMQ job)處理 |
| 593 | PdfParserAgent.execute 呼叫 parsePdf 失敗,console.error 後回傳 {success:false, error} | B(可以安靜) | — | 以結構化錯誤回傳給呼叫端,非靜默吞掉;且此 class 目前未接入主要 tour 生成路徑(該路徑走 parsePdf 直接 throw) |

### `server/agents/pdfTextExtractor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 41 | 下載 PDF 重定向遞迴呼叫的例外 | B(可以安靜) | — | .catch(reject) 是把錯誤轉發到外層 Promise,等同 rethrow,並非真的吞掉 |
| 51 | 下載失敗時刪除暫存檔案失敗 | B(可以安靜) | — | 只是暫存檔清理的 best-effort,真正的下載錯誤仍在同一個 handler 用 reject(err) 往外拋 |
| 88 | pdftotext 系統工具執行失敗 | B(可以安靜) | — | 三層策略中的第二層,失敗回傳空字串讓上層繼續嘗試其他方法 |
| 145 | 方法一 pdf-parse 提取失敗 | B(可以安靜) | — | 有方法二/三接續 fallback,非最終失敗 |
| 176 | 方法二 pdftotext 提取失敗 | B(可以安靜) | — | 落到方法三 LLM 直讀備援,設計上就是 fallback 鏈 |
| 192 | finally 區塊清理暫存檔失敗 | B(可以安靜) | — | 暫存檔清理 best-effort,不影響已回傳的提取結果 |

### `server/agents/progressTracker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 122 | 寫入 Redis 進度快照失敗 | B(可以安靜) | — | 文件註解明確聲明刻意吞掉(in-memory Map 才是權威來源),Redis 只是輔助快取 |
| 307 | 跨 worker 讀取 Redis 進度快取失敗 | B(可以安靜) | — | 僅影響進度輪詢顯示,非關鍵資料,有 console.warn 記錄 |
| 318 | 刪除任務進度 Redis key 失敗 | B(可以安靜) | — | 註解明確標示 silent,key 本身有 TTL 會自然過期,清理失敗無實質影響 |

### `server/agents/skillLearnerAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 124 | 載入現有技能 loadExistingSkills 失敗 | B(可以安靜) | — | 重置為空陣列並繼續,技能學習屬輔助功能 |
| 279 | LLM 用量記錄 logLlmUsage 寫入失敗 | B(可以安靜) | — | 註解 /* silent */,刻意 best-effort 用量記錄 |
| 294 | AI 分析內容(關鍵字/分類)失敗 | B(可以安靜) | — | 回傳空結果物件,技能學習屬輔助功能 |
| 464 | 套用關鍵字建議到技能失敗 | B(可以安靜) | — | 回傳 false,技能學習屬輔助功能 |
| 497 | 建立新技能失敗 | B(可以安靜) | — | 回傳 null,技能學習屬輔助功能 |

### `server/agents/skillLoader.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 101 | 解析 SKILL.md 內 JSON Schema 區塊失敗,console.error 後回傳 null | B(可以安靜) | — | 純內部 agent 設定/schema 載入工具,失敗屬於開發期即可發現的問題,非客人/金流 |

### `server/agents/skills/dispatcher.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 217 | skillRuns 認領 insert(status=running)失敗 | B(可以安靜) | — | 註解明寫這是 audit hole 不是資料遺失,客人草稿仍會照常產生 |
| 244 | skill 產出的 PDF 上傳 R2 失敗 | B(可以安靜) | — | 註解明寫 orchestrator 輸出仍會回傳,只是通知卡少一個 PDF 連結,草稿文字本身不受影響 |
| 279 | skillRuns 完成狀態(succeeded/failed)更新失敗 | B(可以安靜) | — | 註解明寫只影響 audit trail,outcome 仍會回傳給呼叫端 |

### `server/agents/skills/orchestrator.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 126 | skill orchestrator 執行拋出例外,轉換成 { ok:false, reason, needsJeff:true } | B(可以安靜) | — | 已用 needsJeff:true 結構化標記交給呼叫端(dispatcher)升級處理,屬於設計好的浮出協議 |

### `server/agents/skills/tourComparison.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 446 | LLM 翻譯輸出的 JSON 解析失敗,退回原始未翻譯資料 | B(可以安靜) | — | 刻意設計的降級 fallback(維持可用資料),有 console.warn 記錄 |

### `server/agents/trainAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 182 | 火車資訊 LLM 結構化生成失敗 | A(必須浮出) | ④客人可見輸出 | 吞例外後用 generateDefaultTrain 通用預設值頂替,仍回傳 success:true,下游 fanout.ts 的「失敗才用 fallback」判斷因此永遠不會觸發,佔位資料可能被當成真實內容進入客人可見的行程/團資訊而無人知道 |

### `server/agents/transportationAgent.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 99 | 交通子 Agent(火車/郵輪/巴士/機票)執行整體例外,回傳 {success:false, error} | B(可以安靜) | — | 結構化失敗結果回傳給上層 masterAgent,行程生成管線可依此判斷後續處理 |

### `server/aiChatStreamRouter.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 106 | 客服聊天串流前,即時語境豐富化(enrichChatContext)失敗,console.warn 後 liveContext 維持空字串 | B(可以安靜) | — | 註解明說 non-fatal,對話繼續進行只是少了即時型錄語境,不影響核心聊天功能 |
| 176 | 整個 AI 客服聊天串流處理拋出未預期錯誤,console.error 後送出 SSE 'error' 事件給前端帶通用錯誤訊息 | B(可以安靜) | — | 錯誤已透過 SSE error 事件回傳給呼叫端,客戶端會看到錯誤提示,功能等同 res.status(5xx) 回應呼叫端 |

### `server/auth.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 64 | timing-attack 防禦用的 dummy bcrypt.compare 失敗 | B(可以安靜) | — | 結果本來就不使用,純粹用來拉齊回應時間,之後一律 throw 錯誤密碼 |
| 131 | requestPasswordReset 呼叫 sendPasswordResetEmail 拋出的例外(email 兩個管道都已在 emailService.ts 內部處理,這裡理論上只在更底層意外情況觸發) | A(必須浮出) | ④客人可見輸出 | console.error 記錄後函式仍固定回傳 success:true 訊息給前端,客人以為重設信一定會寄達,實際完全沒寄出且 Jeff 端也無任何告警,只有 Fly log 裡的 console.error |

### `server/avatarUpload.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 70 | 頭像上傳(base64 解析/R2 上傳)失敗 | B(可以安靜) | — | 已用 res.status(500) 方式浮出,回應端會看到錯誤 |

### `server/bookingFollowupWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 69 | trackPdfFailure 內 Redis 計數器操作失敗,console.warn 忽略 | B(可以安靜) | — | 監控機制自身的 best-effort 容錯(監控失敗不影響主流程),屬於監控之監控的邊角情形 |
| 130 | 訂金發票 PDF 產生失敗,不 throw,改呼叫 trackPdfFailure 累計計數並繼續寄確認信(無 PDF 連結) | B(可以安靜) | — | 註解明確設計為刻意 fail-open,並已接上連續失敗達門檻即 notifyOwner 的機制 |
| 167 | 確認信寄送失敗 | B(可以安靜) | — | 已 rethrow(throw emailErr),交由 BullMQ 重試機制浮出 |
| 208 | worker 'failed' 事件內呼叫 notifyOwner 本身失敗,只 console.error | B(可以安靜) | — | 同一個 'failed' 事件另有 wireWorkerFunnel 監聽器會呼叫 reportFunnelError,原始失敗已透過別條路徑浮出 |

### `server/cache/generation-cache.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 41 | cacheFullResult 寫入 redis.setex 失敗,只 console.error 不拋出 | B(可以安靜) | — | AI 生成結果快取寫入,best-effort,失敗不影響主流程直接重算 |
| 57 | getFullResult 讀取 redis.get 失敗,回傳 null 視為未命中 | B(可以安靜) | — | 快取讀取失敗即視為 cache miss,呼叫端會走原本生成路徑 |
| 75 | cacheColorPalette 寫入配色快取失敗,只 log | B(可以安靜) | — | 配色方案快取 best-effort 寫入失敗不影響功能 |
| 89 | getColorPalette 讀取配色快取失敗,回傳 null | B(可以安靜) | — | 快取未命中處理,呼叫端會重新計算配色 |
| 107 | cacheScrapeResult 寫入爬取結果快取失敗,只 log | B(可以安靜) | — | 爬取結果快取 best-effort 寫入 |
| 121 | getScrapeResult 讀取爬取快取失敗,回傳 null | B(可以安靜) | — | 快取未命中會重新爬取,不影響資料正確性 |
| 139 | cacheHeroImage 寫入 Hero 圖片快取失敗,只 log | B(可以安靜) | — | 圖片快取 best-effort 寫入 |
| 153 | getHeroImage 讀取 Hero 圖片快取失敗,回傳 null | B(可以安靜) | — | 快取未命中會重新抓圖,不影響核心功能 |
| 171 | cacheDetailsResult 寫入 Details 快取失敗,只 log | B(可以安靜) | — | DetailsSkill 結果快取 best-effort 寫入 |
| 185 | getDetailsResult 讀取 Details 快取失敗,回傳 null | B(可以安靜) | — | 快取未命中會重新計算,不影響正確性 |
| 214 | clearUrlCache 清除特定 URL 快取失敗,只 log | B(可以安靜) | — | 清快取失敗頂多留下舊快取,非關鍵維運操作 |
| 229 | clearAll 清除所有快取失敗,回傳 0 | B(可以安靜) | — | 測試用清快取工具,失敗不影響生產資料 |
| 249 | getStats 取得快取統計失敗,回傳全零預設統計 | B(可以安靜) | — | 純觀測用統計端點,失敗只影響儀表板數字 |
| 267 | exists 檢查快取是否存在失敗,回傳 false | B(可以安靜) | — | 視為快取不存在,呼叫端會走原本生成路徑 |
| 277 | getTTL 取得快取剩餘秒數失敗,回傳 -1 | B(可以安靜) | — | 純觀測用 TTL 查詢,失敗不影響核心功能 |

### `server/competitorMonitorWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 125 | 競品監控 job processor 整體例外,更新 scrapeStatus 後 throw error | B(可以安靜) | — | 已用 rethrow 方式浮出,交給 wireWorkerFunnel/BullMQ failed 事件鏈處理 |
| 151 | 競品監控 job failed 事件中 notifyOwner 寄送本身失敗,只 console.error | B(可以安靜) | — | 同一 failed 事件另外掛了 wireWorkerFunnel→reportFunnelError 獨立監聽器,不依賴這個 notifyOwner 是否成功 |
| 188 | scheduleCompetitorMonitorJobs 排程掃描/派工整批拋錯,只 console.error | A(必須浮出) | ③cron/部署可見性 | 這是每 6 小時觸發一次的排程函式本身,失敗代表整輪競品監控完全沒派工且無 notify/Sentry,屬排程可見性缺口 |

### `server/customerBackfillWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 56 | 單一 mailbox 對該客人的 Gmail 歷史回填(customerInteractions)失敗 | A(必須浮出) | ①客人資料流 | 該客人在此 mailbox 的歷史互動紀錄會不完整,但整個 job 仍視為成功不會觸發 errorFunnel,Jeff 不會知道 |

### `server/customerSummaryWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 33 | 單一客戶 AI 摘要即時刷新(refreshSummaryForProfile)失敗,只 console.error 回傳 errors:1 | B(可以安靜) | — | 僅影響admin端摘要快取新鮮度,非客人原始資料,job 不 throw 但屬低風險唯讀快取 |
| 54 | 客戶偏好回填(backfillMissingPreferences)失敗,只 console.error | B(可以安靜) | — | 程式注解明寫 non-fatal,屬漸進式增強功能非核心資料 |

### `server/db.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 94 | getDb() 建立 MySQL 連線池失敗,console.warn 後 _db 設為 null(全站每個 DB 函式各自靜默回傳空值/false) | A(必須浮出) | — | 這是整站唯一的 DB 連線入口,連線失敗會讓下游數十個函式各自安靜降級成空結果,沒有任何集中告警讓 Jeff 知道系統性 DB 故障 |

### `server/db/accounting.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 318 | Trust 遞延金額查詢失敗,console.warn 後以 gross(0 遞延)繼續計算會計統計 | A(必須浮出) | ②錢 | 違反 CLAUDE.md Trust 會計鐵律風險:失敗會讓後台財務儀表板把未認列訂金當成營收顯示,且無任何提示告知計算已降級 |

### `server/db/customerProfile.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 208 | insertCustomerProfileSafely insert 失敗,非重複鍵一律 rethrow,重複鍵找不到 winner 也 rethrow | B(可以安靜) | — | 註解與程式碼皆明示非預期錯誤一律 throw err 浮出,未真正吞任何未知錯誤 |
| 301 | withCustomerIntakeLock 釋放 Redis lock 的 eval 失敗,直接吞掉 | B(可以安靜) | — | 刻意 best-effort 設計,鎖有 30 秒 TTL 會自然過期,不影響正確性 |

### `server/db/search.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 89 | getImageLibrary 查詢 imageLibrary 失敗,console.error 後回傳空陣列 | B(可以安靜) | — | 圖片庫列表讀取失敗,admin CMS 內容非客人/金流關鍵路徑 |
| 112 | addImageToLibrary 寫入圖片庫失敗,console.error 後回傳 null | B(可以安靜) | — | 圖片庫新增失敗,屬內容管理非客人資料/金流 |
| 137 | deleteImageFromLibrary 刪除失敗,console.error 後回傳 false | B(可以安靜) | — | 圖片庫刪除失敗,非客人/金流關鍵路徑 |
| 157 | incrementImageUsage 更新使用次數失敗,console.error 無回傳值 | B(可以安靜) | — | 僅使用計數器,失敗不影響任何客人或金流功能 |
| 175 | getImageById 查詢失敗,console.error 後回傳 null | B(可以安靜) | — | 單張圖片讀取失敗,非客人/金流關鍵路徑 |
| 236 | getHomepageContent 查詢失敗,console.error 後回傳 null | B(可以安靜) | — | 首頁內容區塊讀取失敗,行銷內容非客人資料/金流 |
| 254 | getAllHomepageContent 查詢失敗,console.error 後回傳空陣列 | B(可以安靜) | — | 首頁內容列表讀取失敗,非關鍵路徑 |
| 280 | upsertHomepageContent 寫入首頁內容失敗,console.error 後回傳 false | B(可以安靜) | — | admin 編輯首頁文案失敗,非客人資料/金流 |
| 302 | getAllDestinations 查詢失敗,console.error 後回傳空陣列 | B(可以安靜) | — | 首頁目的地卡片讀取失敗,非關鍵路徑 |
| 322 | getActiveDestinations 查詢失敗,console.error 後回傳空陣列 | B(可以安靜) | — | 首頁顯示用目的地清單讀取失敗,非客人資料/金流 |
| 341 | getDestinationById 查詢失敗,console.error 後回傳 null | B(可以安靜) | — | 單一目的地讀取失敗,非關鍵路徑 |
| 360 | createDestination 新增失敗,console.error 後回傳 null | B(可以安靜) | — | admin 新增目的地卡片失敗,非客人資料/金流 |
| 379 | updateDestination 更新失敗,console.error 後回傳 false | B(可以安靜) | — | admin 編輯目的地卡片失敗,非客人資料/金流 |
| 398 | deleteDestination 刪除失敗,console.error 後回傳 false | B(可以安靜) | — | admin 刪除目的地卡片失敗,非客人資料/金流 |
| 421 | reorderDestinations 更新排序失敗,console.error 後回傳 false | B(可以安靜) | — | 目的地排序失敗,純展示用非客人資料/金流 |

### `server/db/tour.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 283 | 刪除 tour 後的 R2 圖片清理失敗 | B(可以安靜) | — | 文件明確標示 best-effort,DB row 已成功刪除,孤兒 R2 key 只是後續清理議題 |
| 308 | batchDeleteTours 迴圈中單一 tour 刪除失敗 | B(可以安靜) | — | 失敗原因已收集進 skipped 陣列並回傳給呼叫端(admin API 回應),非真正吞掉 |
| 387 | 訂位滿額後把 departure 狀態翻成 'full' 的次要 UPDATE 失敗 | B(可以安靜) | — | 真正防超賣的是前面帶 WHERE 容量檢查的原子 UPDATE,這次翻狀態只是顯示欄位同步,失敗不影響實際容量保護 |

### `server/db/user.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 91 | upsertUser 寫入/更新 users 失敗,console.error 後 rethrow | B(可以安靜) | — | 已用 throw error 方式浮出給呼叫端 |
| 188 | createUserWithPassword 註冊送 50 Packpoint 獎勵失敗,只 console.error | B(可以安靜) | — | 註解明文 best-effort,不擋帳號建立,獎勵點數非交易金流 |
| 197 | createUserWithPassword 產生 referral code 失敗,只 console.error | B(可以安靜) | — | 註解明文 best-effort,不擋帳號建立 |
| 233 | createUserWithGoogle 註冊送 50 Packpoint 獎勵失敗,只 console.error | B(可以安靜) | — | 同密碼註冊流程,刻意 best-effort 設計 |
| 241 | createUserWithGoogle 產生 referral code 失敗,只 console.error | B(可以安靜) | — | 同密碼註冊流程,刻意 best-effort 設計 |
| 430 | addFavorite insert 收藏失敗,console.error 後 rethrow | B(可以安靜) | — | 已用 throw error 方式浮出給呼叫端 |
| 452 | removeFavorite 刪除收藏失敗,console.error 後 rethrow | B(可以安靜) | — | 已用 throw error 方式浮出給呼叫端 |
| 573 | recordBrowsingHistory 寫入瀏覽紀錄失敗,console.error 後 rethrow | B(可以安靜) | — | 已用 throw error 方式浮出給呼叫端 |

### `server/draftEvalWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 61 | draft-eval worker failed 事件中呼叫 notifyOwner 通知 Jeff 失敗 | B(可以安靜) | — | 這是通知機制本身失敗的次要防護,已用 console.error 記錄,且整個 worker 另有 wireWorkerFunnel 錯誤漏斗兜底 |

### `server/email/templates/abandonmentRecovery.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 63 | 寄送購物車放棄挽回信(含折扣碼)給客人失敗 | A(必須浮出) | ④客人可見輸出 | 回傳 false 但呼叫端 BullMQ job 仍視為工作完成({sent:false}),不會觸發 job failed/notifyOwner,客人完全收不到提醒與折扣碼且無人知曉 |

### `server/email/templates/bookingConfirmation.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 70 | smtp.sendMail 實際寄送訂單確認信給客人失敗,只 console.error,函式仍unconditionally return true | A(必須浮出) | ④客人可見輸出 | 雖稍早已呼叫 notifyOwner 通知 Jeff 有新訂單,但沒有告知 Jeff 客人的確認信實際寄送失敗,客人可能誤以為訂單未成立 |

### `server/email/templates/checkin.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 82 | 90 天關懷信(check-in)寄送失敗 | B(可以安靜) | — | 客戶關懷性質的非必要通訊,失敗不影響任何交易或客人資料完整性 |

### `server/email/templates/customOrder.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 64 | 客製訂單信寄出前的 Jeff 心裡有數通知失敗 | B(可以安靜) | — | 純內部 FYI 通知,不影響後面實際寄給客人的信件流程繼續執行 |
| 84 | 客製訂單客人信件(報價/確認信等)實際 SMTP 寄送失敗 | A(必須浮出) | ④客人可見輸出 | 客人可能完全收不到報價/確認信,此路徑無 observability counter 兜底,且 Jeff 已提前收到心安通知容易誤判已成功 |

### `server/email/templates/paymentSuccess.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 75 | 付款成功後寄送客人確認信失敗,console.error | B(可以安靜) | — | 函式稍早已無條件呼叫 notifyOwner 通知 Jeff 這筆付款成功,Jeff 已知情,只是客人自己的確認信沒收到 |

### `server/email/templates/quoteFollowUp.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 65 | 報價追蹤行銷信(3天/7天)SMTP 寄送失敗 | B(可以安靜) | — | 屬行銷催信,已有 observabilityCounters 對 quoteFollowUp 做每週稽核計數兜底,非完全無監控 |

### `server/email/templates/reviewRequest.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 56 | 寄送售後評價邀請信 smtp.sendMail 失敗,console.error 後回傳 false | B(可以安靜) | — | 行銷性質信件非交易關鍵,失敗頂多少一封邀評信 |

### `server/email/templates/supplierNotification.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 114 | 寄送供應商訂單通知信 smtp.sendMail 失敗,console.error 後回傳 false | A(必須浮出) | — | 呼叫端 stripeWebhook 不檢查回傳值,仍會記 log 誤稱已寄出,供應商可能完全不知道有新訂單 |

### `server/email/templates/trialEnding.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 133 | 會員試用即將結束(AB-390 合規提醒信)SMTP 實際寄送失敗 | A(必須浮出) | ②錢 | 吞例外只回傳 false,導致呼叫端 stripeWebhook.handleTrialWillEnd 設計好的 URGENT notifyOwner 安全網完全失效(沒有例外可讓外層 catch 到),flag 已 commit 不會重試,提醒信可能徹底漏發 |

### `server/email/templates/tripReminder.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 121 | 寄提醒信後順便通知 owner 的 notifyOwner 呼叫失敗,完全靜默吞掉(無 log) | B(可以安靜) | — | 僅是 FYI 性質通知,不影響已進行中的客人信件寄送本身 |
| 136 | smtp.sendMail 實際寄送行前提醒信失敗,只 console.error 回傳 false | A(必須浮出) | ④客人可見輸出 | 呼叫端 tripReminderService.ts 未檢查此回傳值就記為已寄送,加上 idempotency key 已鎖定,客人永久收不到提醒且統計顯示為成功 |

### `server/email/templates/voucherIssued.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 65 | 兌換 voucher 後寄送確認信給客人失敗,console.error 後回 false,沒有 owner 通知 | A(必須浮出) | ④客人可見輸出 | voucher 代碼主要透過此信寄給客人,寄送失敗且無任何告知 Jeff 的管道,客人可能誤以為兌換失敗來詢問 |

### `server/email/templates/winback.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 86 | win-back 挽回信寄送失敗 | B(可以安靜) | — | 行銷性質的再互動信,非交易必要通訊,console.error 已留紀錄可回查 |

### `server/emailService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 132 | SendGrid 寄送密碼重設信失敗,console.error 記錄後 return false | B(可以安靜) | — | 轉成布林值回傳給上層(auth.ts)決策,非最終吞錯點 |
| 235 | SMTP 寄送密碼重設信失敗,console.error 記錄後 return false | B(可以安靜) | — | 同上,設計上把失敗轉為回傳值交給呼叫端處理 |
| 326 | SendGrid 寄送歡迎信失敗,console.error 後 return false | B(可以安靜) | — | 歡迎信非關鍵通訊,失敗僅影響體驗不影響帳號本身 |
| 426 | SMTP 寄送歡迎信失敗,console.error 後 return false | B(可以安靜) | — | 同上,非關鍵歡迎信 |
| 465 | SendGrid 寄送電子報訂閱確認信失敗,console.error 記錄(未 return,繼續往下嘗試 SMTP fallback) | B(可以安靜) | — | 非關鍵行銷信,且有 SMTP fallback 續試 |
| 474 | SMTP 寄送電子報確認信失敗,console.error 後 return false | B(可以安靜) | — | 非關鍵行銷信,兩種管道都試過後才放棄 |
| 623 | SendGrid 寄送客服詢問回覆信失敗,console.error 後 return false | B(可以安靜) | — | 上層 inquiryReply.ts 依此 false 讓 thread 狀態停在待處理不推進,已有產品面浮出設計 |
| 659 | SMTP 寄送客服詢問回覆信失敗,console.error 後 return false | B(可以安靜) | — | 同 623,上層靠 emailSent=false 讓 Inbox 狀態停留在待處理 |
| 684 | SMTP transporter.verify() 測試失敗,console.error 後 return false | B(可以安靜) | — | admin 測試信箱設定用的工具函式,非客人流程 |

### `server/generalImageUpload.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 95 | 圖片壓縮優化(sharp)失敗 | B(可以安靜) | — | fallback 回傳原始未壓縮圖片繼續上傳,不影響上傳成功與否 |
| 137 | 通用圖片上傳整體失敗 | B(可以安靜) | — | 已用 res.status(500) 回應呼叫端,已浮出 |
| 181 | 行程圖片上傳整體失敗 | B(可以安靜) | — | 已用 res.status(500) 回應呼叫端,已浮出 |

### `server/gmailOAuth.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 74 | tryRegisterWatchOnConnect 註冊 Gmail push watch 失敗,console.error(non-fatal) 靜默吞掉 | B(可以安靜) | — | 程式碼明確註記 best-effort never throws,poll 機制仍可運作 |
| 111 | getGmailAuthUrl 建立授權網址失敗,回傳 res.status(500).send(...) | B(可以安靜) | — | 已用 res.status(5xx) 方式浮出給呼叫的 admin |
| 205 | OAuth callback 整體流程失敗,console.error 後 redirect 到 /admin?gmailError=... | B(可以安靜) | — | 以帶錯誤參數的 redirect 浮出給正在操作的 admin(Jeff)本人 |

### `server/gmailPollWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 65 | runSentMailCapture 寄件信歸檔(附件+互動記錄)失敗,只 console.error | A(必須浮出) | ①客人資料流 | 客人寄件端歸檔資料可能永久漏失且無任何通知或重試機制 |
| 71 | 單一 gmail integration 的收件 pipeline 失敗,呼叫 handleIntegrationPollError | B(可以安靜) | — | catch 內傳入 notifyOwner,已用通知方式浮出(此為 Ann Yuan 事故修復點) |
| 138 | failed 事件中 notifyOwner(...) 本身呼叫失敗,只 console.error | A(必須浮出) | ③cron/部署可見性 | 通知鏈路本身斷裂,Jeff 完全不會知道這次 worker job 失敗 |

### `server/gmailPushWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 152 | gmailWatchRenewWorker 逐一 integration 續約 watch 失敗 | B(可以安靜) | — | 已用 log.error({err}) 方式浮出(Sentry bridge),且透過 handleIntegrationPollError 視情況呼叫 notifyOwner/標記 disconnectReason |
| 202 | worker failed 事件內 notifyOwner 派送本身失敗 | B(可以安靜) | — | 已用 log.error({err}) 方式浮出(Sentry bridge),為 notifyOwner 呼叫的雙保險 catch |

### `server/googleAuth.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 58 | Google OAuth Strategy verify callback 內部錯誤,console.error 後呼叫 done(error) | B(可以安靜) | — | 錯誤透過 passport 的 done(error) callback 慣例往上傳,等同 rethrow,由 passport 框架導向失敗流程(failureRedirect) |
| 169 | OAuth callback route handler 內錯誤,console.error 後 redirect 到 /login?error=auth_failed | B(可以安靜) | — | 已用帶錯誤參數的 redirect 回應瀏覽器,登入失敗的使用者自己會看到畫面,不是無聲吞掉 |

### `server/jwt.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 56 | JWT token 驗證失敗(過期/簽章錯誤/格式錯誤)一律回傳 null | B(可以安靜) | — | 標準 auth 流程預期行為,不是異常故障訊號 |

### `server/llmUsageService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 120 | LLM 用量記錄寫入 DB 失敗 | B(可以安靜) | — | 註解明講 靜默失敗，不影響主流程 |
| 203 | 查詢 LLM 用量統計(後台儀表板)失敗 | B(可以安靜) | — | 回傳空統計,僅影響後台用量分析頁面顯示 |

### `server/marketingWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 201 | 行銷 worker job 失敗後嘗試 notifyOwner email 通知,該通知本身也失敗 | B(可以安靜) | — | 原始 job 失敗已透過 console.error 記錄且已嘗試 notifyOwner,此為單一 worker 通知信的邊緣二次失敗,影響範圍侷限於行銷素材產生 |

### `server/pdfUpload.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 74 | PDF 檔案上傳(multipart)流程失敗 | B(可以安靜) | — | 已用 res.status(500) 回應給呼叫端 |
| 125 | PDF 檔案上傳(base64)流程失敗 | B(可以安靜) | — | 已用 res.status(500) 回應給呼叫端 |

### `server/plaidSyncWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 74 | Plaid 同步後自動分類交易失敗 | A(必須浮出) | ②錢 | 新交易入帳後未分類會悄悄堆積成待整理帳目,無 owner 通知,影響 P&L 準確性 |
| 105 | 整個 Plaid 同步 job 失敗 | B(可以安靜) | — | rethrow(throw err),交由 BullMQ failed 事件 + notifyOwner 處理 |
| 131 | job failed 通知 notifyOwner 本身又失敗 | B(可以安靜) | — | 同檔案已用 wireWorkerFunnel 獨立監控此 worker,非唯一浮出管道 |

### `server/queues/abandonmentRecoveryQueue.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 140 | 取消未付款訂單後釋放出發場次座位(releaseDepartureSlots)失敗,只 console.warn | A(必須浮出) | — | booking 已標記 cancelled 但座位庫存未實際釋回,長期會造成場次餘位持續被低估、影響銷售但無人察覺 |
| 165 | 取得出發場次資料(getDepartureById)失敗回傳 null,召回信中出發日期顯示 TBD | B(可以安靜) | — | 棄單召回信屬行銷性質,日期顯示降級不影響核心功能 |
| 191 | worker failed 事件中呼叫 notifyOwner 本身失敗,只 console.error | B(可以安靜) | — | 告警路徑自身次級 fallback,job 失敗已嘗試通知過一次 |

### `server/queues/packpointMaintenanceQueue.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 123 | runAutoUpgrade(會員自動升等)整段拋錯被吞,只 console.error+result.errors++,job 本身不 rethrow 仍視為成功完成 | A(必須浮出) | ③cron/部署可見性 | job 不 throw 所以 BullMQ 不會標記 failed,notifyOwner 與 getFailedCount 監控都不會發現,升等邏輯可能連續多天靜默失效無人知曉 |
| 129 | runExpirySweep(18個月未活動點數歸零)整段拋錯被吞,只 console.error+errors++,不 rethrow | A(必須浮出) | ③cron/部署可見性 | 同上,job 視為成功完成,點數過期清理邏輯失效無任何告警管道 |
| 135 | runBirthdayBonus(生日獎勵)整段拋錯被吞,只 console.error+errors++,不 rethrow | A(必須浮出) | ③cron/部署可見性 | 同上,生日獎勵邏輯可能持續失效客人收不到獎勵,無告警 |
| 146 | sweepExpiredVouchers(過期票券清理)整段拋錯被吞,只 console.error+errors++,不 rethrow | A(必須浮出) | ③cron/部署可見性 | 同上模式,票券過期清理靜默失效無告警 |
| 167 | worker failed 事件中呼叫 notifyOwner 本身失敗,只 console.error | B(可以安靜) | — | 這是告警路徑自身的次級 fallback,job 失敗已透過同一 handler 嘗試通知過一次 |
| 256 | 會員升等的 pointsTransactions audit 記錄寫入失敗,只 console.warn | B(可以安靜) | — | 程式注解明寫非關鍵,tier 升等本身已完成不受影響,只是稽核紀錄缺失 |

### `server/queues/posterProcessingQueue.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 115 | 海報處理 job 失敗(產圖/轉檔/寫 DB 任一步) | B(可以安靜) | — | 已 rethrow(throw err),交由 BullMQ 重試 |
| 135 | worker 'failed' 事件內呼叫 notifyOwner 失敗,只 console.error | B(可以安靜) | — | 同一事件另有 wireWorkerFunnel 監聽器呼叫 reportFunnelError,原始 job 失敗已透過別條路徑浮出 |

### `server/queues/priorityRewriteCron.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 192 | 月度優先重寫 cron 中,單一行程加入 tourGenerationQueue 失敗 | B(可以安靜) | — | log.warn 後 continue 處理下一筆,整體 queued 數量仍會於 log.info 中回報,非全面性故障 |

### `server/queues/quoteFollowUpQueue.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 143 | worker 'failed' 事件內呼叫 notifyOwner 失敗,只 console.error | B(可以安靜) | — | 同一事件另有 wireWorkerFunnel 監聽器呼叫 reportFunnelError,原始 job 失敗已透過別條路徑浮出 |

### `server/queues/supplierSyncQueue.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 146 | supplier sync worker 執行同步任務失敗,console.error 後 throw err 重新拋出 | B(可以安靜) | — | 已用 rethrow 方式浮出,交由 BullMQ 標記失敗並重試 |
| 177 | 重試耗盡後呼叫 notifyOwner 通知 Jeff 供應商同步最終失敗,若 notifyOwner 本身失敗只 console.error 靜默吞掉 | A(必須浮出) | ③cron/部署可見性 | 這是唯一會通知 Jeff 的最後防線,若通知本身失敗,Jeff 對供應商同步最終失敗完全不知情 |

### `server/retrospectiveWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 191 | worker failed 事件內呼叫 notifyOwner 通知 Jeff 任務失敗,若 notifyOwner 本身失敗只 console.error 靜默吞掉 | A(必須浮出) | ③cron/部署可見性 | 與 supplierSyncQueue 相同模式:通知機制本身失敗會讓 Jeff 完全不知道背景任務失敗 |

### `server/routers/adminCustomerOrders.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 115 | bumpCustomerSummary 內 enqueueCustomerSummaryRefresh 失敗被吞,客人摘要卡不會即時刷新 | B(可以安靜) | — | 文件註解明確:fire-forget,refresh hiccup 絕不能讓已成功的訂單動作失敗,24h TTL 兜底 |
| 126 | triggerCaseLearningDistillation 內 distillCaseLearning 呼叫失敗被吞,案例學習蒸餾略過 | B(可以安靜) | — | 同上 fire-and-forget 模式,且 distillCaseLearning 內部已自行吞錯,純屬學習閉環加分功能 |
| 190 | 單一 customerDocuments PDF 文字擷取失敗(壞檔/R2逾時),該文件金額不計入比對候選 | B(可以安靜) | — | watchdog 提示功能,文件本身註解:沒有可信金額跟查詢失敗效果相同,不需要特殊錯誤路徑,不影響其餘文件比對 |
| 200 | loadInvoiceMismatchFindings 整段(DB/IO)失敗,回傳空陣列 | B(可以安靜) | — | 刻意設計的 watchdog 建議功能,非帳務記錄本身,失敗只是少一組比對提示 |
| 282 | loadPaymentMatchFindings 銀行流水比對查詢失敗,回傳空陣列 | B(可以安靜) | — | 純讀取型建議功能,註解明確 AI 絕不自動標記付款、不寫欄位,失敗不影響任何實際帳務記錄 |
| 330 | loadCommitmentFindings(單客人)承諾查詢失敗,回傳空陣列 | B(可以安靜) | — | watchdog 提示功能,失敗只是這次沒顯示承諾提醒,非資料遺失 |
| 339 | 行號落在純註解區塊(loadTodayListItems 函式說明),無實際 catch;就近核對對應第330行 loadCommitmentFindings 的 catch(距離最近) | B(可以安靜) | — | 行號可能飄移,已就近核對,判斷理由同第330行條目 |
| 372 | todayList 內 userIdByProfile 映射查詢失敗,Map 維持空白 | B(可以安靜) | — | 儀表板單一區塊查詢失敗不擋其餘區塊,只影響前端跳轉連結的 userId,下次刷新可自癒 |
| 391 | todayList「到期跟進」查詢失敗,該區塊項目整個不顯示 | B(可以安靜) | — | 文件明確設計為儀表板分區塊 try/catch,單次查詢失敗下次頁面刷新即可重新查詢,屬短暫性 |
| 452 | todayList「報價將過期」查詢失敗,該區塊項目整個不顯示 | B(可以安靜) | — | 同上,儀表板分區塊隔離設計,實時查詢下次刷新自癒 |
| 498 | todayList「承諾未兌現」(全公司)查詢失敗,該區塊項目整個不顯示 | B(可以安靜) | — | 同上,儀表板分區塊隔離設計 |
| 548 | todayList「出發倒數+尾款到期」查詢失敗,兩區塊項目整個不顯示 | B(可以安靜) | — | 同上,儀表板分區塊隔離設計 |
| 686 | todayList tRPC procedure 外層整段失敗,回傳空陣列 | B(可以安靜) | — | 儀表板性質功能,查詢失敗不擋整頁,前端顯示空清單而非報錯,下次刷新自癒 |
| 1089 | 自動 createPaymentLink 失敗,回傳 null 改用手貼連結 | B(可以安靜) | — | 有下游 guard:!link 就丟 PRECONDITION_FAILED 擋下整個催款動作,失敗不會真的被吞,Jeff 會看到錯誤 |
| 1106 | createOrderInvoice(催款附帶發票)失敗,invoiceUrl 設為 null | B(可以安靜) | — | 文件註解明確 best-effort、不擋催款送出;invoiceUrl 會回傳給前端且寫入 audit(invoiced:false),失敗有痕跡可查非全靜默 |
| 1371 | 建立發票後補寫 pdfUrl 為 view-route 網址的 updateInvoice 失敗 | B(可以安靜) | — | viewUrl 變數已在呼叫前算出並直接回傳給呼叫端,DB 欄位沒同步只是次要一致性問題,不影響功能 |

### `server/routers/adminCustomers.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 874 | 刪除客人時清 R2 文件實體檔案失敗,log.warn 後繼續刪 DB | B(可以安靜) | — | 註解明言 storage 失敗絕不可讓 DB 半刪,刻意 warn+continue 設計 |
| 1135 | parseAttachment 解析上傳檔案拋錯,log.warn 後回傳 {ok:false, reason:'parse_error'} | B(可以安靜) | — | 同步 mutation 直接把失敗結構化回傳給前端呼叫者,admin 立即看得到 |
| 1212 | LLM 抽取客人姓名/email/電話失敗,log.warn 後回傳 {ok:false, reason:'extract_failed'} | B(可以安靜) | — | 同上,結構化回傳給前端,admin 立即看得到失敗訊息 |
| 2392 | 背景 extractAfterReply(AI 筆記/偏好抽取)失敗,空 catch 完全忽略 | B(可以安靜) | — | 純輔助 AI 摘要快取,hasData 判斷會讓下次查詢自動重試,不影響核心客人資料 |

### `server/routers/adminPlatform.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 68 | admin 統計 Redis 快取讀取失敗 | B(可以安靜) | — | 典型 Redis best-effort 快取,失敗就照舊查 DB |
| 147 | admin 統計結果寫入 Redis 快取失敗 | B(可以安靜) | — | 快取寫入失敗不影響本次已算出並回傳的統計結果 |

### `server/routers/agent/chat.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 104 | office assistant 自動回覆生成/寫入失敗 | B(可以安靜) | — | 已用 logger.error({err}) 觸發 Sentry.captureException;且註解明確 Jeff 的貼文本身已成功,這只是加分的自動回覆功能失敗 |
| 365 | agent chat 核心呼叫(runOfficeAssistant/LLM)失敗 | B(可以安靜) | — | 已用 rethrow 方式浮出(丟出 TRPCError INTERNAL_SERVER_ERROR) |

### `server/routers/agent/gmail.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 32 | getGmailAuthUrl 產生 OAuth URL 失敗,回傳 {ok:false, error} | B(可以安靜) | — | 同步查詢直接結構化回傳給前端 admin UI,立即可見 |
| 82 | runGmailPipeline 手動觸發執行失敗,轉成 TRPCError 拋出 | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出給呼叫端 |

### `server/routers/agent/ops.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 107 | OpsAgent 回答 Jeff 提問時執行失敗 | B(可以安靜) | — | 寫入 agentMessages alert 高優先訊息且 mutation 同步回傳 error 給前端聊天介面,Jeff 當場看得到 |
| 251 | 自我回顧(runSelfRetrospective)agent 執行失敗 | B(可以安靜) | — | 丟 TRPCError INTERNAL_SERVER_ERROR 回前端,已用錯誤回應方式浮出 |

### `server/routers/agent/profiles.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 138 | customerProfiles insert 失敗(競態情境下的重複鍵) | B(可以安靜) | — | 非重複鍵錯誤或救援失敗時都會 throw err rethrow 浮出 |

### `server/routers/agent/reports.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 94 | 單一 agent 報告生成失敗(catch 本體) | B(可以安靜) | — | 已用 throw 方式浮出(rethrow 為 TRPCError) |
| 203 | 批次請求所有 agent 報告時,單一 agent 報告生成失敗 | B(可以安靜) | — | 錯誤被收進 results 陣列並回傳給呼叫的 admin,非靜默,不影響其他 agent |

### `server/routers/ai.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 276 | AI Chat 使用量記錄寫入 aiAdvisorUsage 失敗,只 console.warn,訊息標註 non-fatal | B(可以安靜) | — | 純分析/流量記錄用途,不影響已回傳給使用者的 AI 回應 |
| 298 | AI Chat 訊息處理整體失敗,console.error 後 throw TRPCError | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出給呼叫端 |

### `server/routers/aiQuotes.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 97 | AI 報價產生後,排程 24h/3d/7d 客人跟進信(scheduleQuoteFollowUps)失敗 | A(必須浮出) | ④客人可見輸出 | 只有 console.warn,無任何下游檢查或重試,報價流程本身照常回傳成功,客人本該收到的後續跟進信可能整組默默消失,公司高度重視跟進完整性 |

### `server/routers/auth.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 86 | 註冊流程(createUser/authenticateUser/建立 token)失敗 | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出 |
| 162 | 登入認證失敗 | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出 |
| 205 | reCAPTCHA 驗證服務呼叫失敗 | B(可以安靜) | — | 刻意 fail-open,註解明寫允許通過,且已有多層 rate limit 防護 |
| 253 | requestPasswordReset 呼叫失敗 | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出 |
| 271 | resetPassword 呼叫失敗 | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出 |

### `server/routers/bookings.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 192 | 價格計算異常中止訂單時,釋放已預訂座位的清理動作失敗被吞掉 | B(可以安靜) | — | cleanup best-effort,主錯誤仍以 throw 浮出給客人,座位釋放失敗是罕見邊界情境 |
| 206 | Packpoint 餘額不足中止訂單時,釋放座位的清理動作失敗被吞掉 | B(可以安靜) | — | 同一組 best-effort 座位釋放清理模式,主錯誤仍浮出給客人 |
| 213 | 折抵點數低於下限中止訂單時,釋放座位的清理動作失敗被吞掉 | B(可以安靜) | — | 同一組 best-effort 座位釋放清理模式,主錯誤仍浮出給客人 |
| 231 | 匯率轉換失敗(catch 本體) | B(可以安靜) | — | 已用 throw 方式浮出(rethrow 為 TRPCError INTERNAL_SERVER_ERROR) |
| 232 | 匯率轉換失敗中止訂單時,釋放座位的清理動作失敗被吞掉 | B(可以安靜) | — | 同一組 best-effort 座位釋放清理模式,外層已 rethrow 浮出 |
| 252 | 折扣金額換算回 USD 失敗時,用原始請求折抵值當備援,實際扣點數可能與真實折扣不完全對應 | C(爭議,交指揮裁決) | — | 影響 Packpoint 帳務準確度但有保守備援值,金額本身不受影響,嚴重度拿不準 |
| 289 | 訂單列寫入失敗(catch 本體) | B(可以安靜) | — | 已用 throw 方式浮出(rethrow err) |
| 291 | 訂單建立失敗回滾時,釋放座位的清理動作失敗被吞掉 | B(可以安靜) | — | 同一組 best-effort 座位釋放清理模式,外層已 rethrow 浮出 |
| 310 | Packpoint 扣點失敗(訂單已用折扣價建立,若扣點失敗等於白送折扣),只有 console.error 沒有任何浮出動作 | A(必須浮出) | ②錢 | 註解自稱 CRITICAL 且要求 ops 人工對帳,但實際只寫 console.error 沒有 notifyOwner,Jeff 不會知道 |
| 375 | 訂單後續信件佇列(deposit PDF+確認信)排入失敗,退回同步寄送基本確認信 | B(可以安靜) | — | 已有降級備援同步寄出含金額資訊的確認信,並用 console.error 記錄,非完全靜默 |
| 399 | 降級備援的同步確認信本身也寄送失敗,只有 console.error | A(必須浮出) | ④客人可見輸出 | 佇列與備援皆失敗,客人完全收不到訂單確認信,只留 console.error 沒有任何浮出給 Jeff |
| 415 | 排程棄單挽回信/座位到期釋放失敗,只有 console.warn | C(爭議,交指揮裁決) | — | 若座位到期釋放排程失效,未付款訂單可能永久佔位造成庫存流失,但屬背景排程且無法判斷是否有其他兜底機制 |
| 546 | getById 的 Redis 限流檢查失敗,只有 console.warn | B(可以安靜) | — | 程式註解明確聲明刻意 fail-open(Redis 掛掉不擋合法用戶),屬設計選擇 |
| 610 | 客人取消訂單後釋放座位失敗,只有 console.warn | B(可以安靜) | — | best-effort 座位釋放清理,已記錄 warn,非本次操作的關鍵路徑 |
| 651 | admin 更新訂單狀態前查詢訂單失敗,被吞成 null 進而回報 NOT_FOUND | B(可以安靜) | — | 雖誤標為找不到,但仍會擋下整個操作並回傳可見錯誤給 admin,不是靜默成功 |
| 686 | admin 更新訂單狀態為取消時釋放座位失敗,只有 console.warn | B(可以安靜) | — | 同一組 best-effort 座位釋放清理模式 |
| 732 | admin 設定供應商狀態前查詢訂單失敗,被吞成 null 進而回報 NOT_FOUND | B(可以安靜) | — | 同 651 模式,雖誤標但仍擋下操作並回傳可見錯誤 |
| 776 | 組裝供應商訂單包時查詢 tour 失敗,被吞成 null | B(可以安靜) | — | 有安全預設 fallback 標題(Tour #id)顯示給 admin,屬可辨識的降級呈現 |
| 778 | 組裝供應商訂單包時查詢 departure 失敗,被吞成 null,出發日期靜默變 null | C(爭議,交指揮裁決) | — | 供應商下單包缺出發日期可能影響真實下單準確度,但 admin 通常會注意到空值,嚴重度拿不準 |
| 780 | 組裝供應商訂單包時查詢乘客(含護照PII)失敗,被吞成空陣列 | A(必須浮出) | ①客人資料流 | 此端點專門提供護照等乘客資料供 admin 送出真實供應商訂單;空陣列無法與「客人尚未填寫」區分,可能導致漏帶乘客資料下單而不自知 |
| 839 | admin 設定供應商成本前查詢訂單失敗,被吞成 null 進而回報 NOT_FOUND | B(可以安靜) | — | 同 651/732 模式,雖誤標但仍擋下操作並回傳可見錯誤 |

### `server/routers/bookingsPayment.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 311 | admin 退款操作時 Stripe API 呼叫失敗 | B(可以安靜) | — | throw new TRPCError(...) 直接把錯誤丟回操作的 admin,並有 audit() 記錄 |
| 344 | 全額退款後釋放出團名額(座位)失敗 | A(必須浮出) | — | 座位未釋放可能造成出團名額顯示已滿、錯失後續訂位,無任何通知讓 Jeff 知道要人工修正 |

### `server/routers/commandCenter.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 128 | approve 後執行 lane executor 意外拋錯,標記 markApprovalTaskFailed 並回傳 status:failed | B(可以安靜) | — | 已寫回任務狀態並在 Command Center Inbox 可見,等同浮出 |
| 409 | 建立回覆附件上傳失敗,包成 TRPCError 或原樣拋出 | B(可以安靜) | — | 已用 throw TRPCError/原錯誤 浮出給呼叫端 |

### `server/routers/departures.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 167 | 更新出發日前查詢舊值(用於稽核 diff)失敗 | B(可以安靜) | — | 只影響 audit log 的 before 快照精細度,實際 updateDeparture 仍照常執行 |
| 187 | 刪除出發日前查詢舊值失敗 | B(可以安靜) | — | 失敗會讓 before=null 觸發 NOT_FOUND 提前中止刪除,雖訊息不精準但方向是安全的(擋下刪除而非放行) |
| 191 | 刪除出發日前查詢是否有有效訂單(activeBookings)關聯失敗 | A(必須浮出) | ①客人資料流 | 這是刪除前唯一的安全閘;查詢一旦失敗被吞成空陣列,會讓有真實客人訂單的出發日被直接刪除,孤兒化客人訂單(註解本身寫明「否則會 orphan customer bookings」) |

### `server/routers/homepage.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 93 | 首頁 hero 內容自動翻譯成英文失敗,只 console.warn | B(可以安靜) | — | 行銷首頁翻譯屬於非關鍵加值功能,admin 可隨時人工檢查/重新編輯,非個別客人文件 |
| 96 | 動態載入 translation 模組本身失敗,只 console.warn | B(可以安靜) | — | 同上,非核心功能且為 fire-and-forget |

### `server/routers/inquiries.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 78 | ingestWebsiteInquiryContact 把網站表單/緊急聯絡資訊寫入 customerProfiles+customerInteractions 失敗,只 console.error | A(必須浮出) | ①客人資料流 | 原始 inquiry 雖仍在 inquiries 表,但客人這則訊息不會出現在客人互動時間軸/客戶座艙,AI ops chat 讀不到這則對話 |
| 310 | notifyOwner(緊急客人求助通知)本身寄送失敗,只 console.error,無備援管道 | A(必須浮出) | — | 這是 🆘 緊急客人事件通知 Jeff 的唯一管道,失敗即代表 Jeff 完全不知道有緊急案例待處理 |
| 453 | addMessage procedure 內,同一支 ingestWebsiteInquiryContact 失敗,只 console.error | A(必須浮出) | ①客人資料流 | 與第 78 行同一風險,客人這則跟進留言不會進客人互動時間軸 |

### `server/routers/invoices.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 39 | 查詢既有 invoice(by bookingId)失敗,視同沒有既有發票 | B(可以安靜) | — | 查詢失敗只會導致重新產生一張發票(可能重複),不影響金額正確性 |
| 103 | 客人自助發票 forBooking 流程中 db.createInvoice 寫入失敗,inserted 設為 null | A(必須浮出) | ②錢 | 若此時 R2 上傳恰好成功(r2Url 有值),下方 !finalUrl 判斷為 false 不會拋錯,客人仍拿到可用網址,但這張發票在資料庫裡完全沒有記錄,系統帳務對不上且無任何信號通知 Jeff |
| 114 | R2 不可用時,把 fallback view-route 網址補寫回 invoice.pdfUrl 的 updateInvoice 失敗 | B(可以安靜) | — | finalUrl 變數已在此之前賦值並會正確回傳給客人,DB 欄位沒同步只是次要一致性問題 |
| 195 | admin 手動建立發票時,補寫 fallback pdfUrl 的 updateInvoice 失敗 | B(可以安靜) | — | 同114,回傳物件的 pdfUrl 已在本地正確賦值,不影響回傳結果 |

### `server/routers/membership.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 89 | 建立 Stripe customer 後,寫回 stripeCustomerId 到 users 表失敗 | B(可以安靜) | — | 註解明確聲明 best-effort,webhook 之後也會補寫入,屬有備援的設計 |
| 156 | 防濫用的 dot-trick 同信箱重複試用檢查失敗 | B(可以安靜) | — | 註解明確標示 non-fatal,屬刻意 fail-open 的防濫用檢查,失敗頂多讓極少數濫用漏網 |

### `server/routers/newsletter.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 66 | 電子報訂閱確認信寄送失敗 | B(可以安靜) | — | 只 console.warn,訂閱本身的 DB row 已先成功建立,屬行銷次要通知的 best-effort |
| 78 | 訂閱流程整體例外(非重複鍵情況) | B(可以安靜) | — | 丟 TRPCError INTERNAL_SERVER_ERROR 回前端,已用錯誤回應方式浮出 |

### `server/routers/ops.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 44 | Redis SCAN/DEL 清 translate 快取失敗,只 console.warn | B(可以安靜) | — | 註解明言 non-fatal,admin 手動觸發的一次性快取清理工具 |
| 76 | 迴圈內單一 tour 的 addTourTranslationJob 佇列加入失敗,只 console.warn 後繼續下一筆 | B(可以安靜) | — | mutation 最終回傳 queuedJobs 實際成功筆數給呼叫的 admin,可從數字落差看出有失敗 |

### `server/routers/photos.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 87 | 上傳行程照片後發 Packpoint 獎勵(含更新 pointsAwarded 欄位)失敗,只 console.error | C(爭議,交指揮裁決) | — | Packpoint 是可兌換 voucher 的準貨幣,若 awardPackpoint 已入帳但 pointsAwarded 欄位更新失敗,回傳給客人的 pointsEarned 會與實際餘額不一致,但材質金額小且不確定是否會導致重複發放,拿不準算不算 money 級風險 |

### `server/routers/plaidRouter.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 127 | 建立 Plaid Link token 失敗,catch 後 throw TRPCError | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出給呼叫端 |
| 214 | 單一 Plaid 帳戶寫入 linkedBankAccounts 失敗,只 console.warn,迴圈繼續下一個帳戶,該帳戶不會出現在 insertedIds | A(必須浮出) | ②錢 | 銀行帳戶連結失敗會導致該帳戶永遠不會被同步交易,屬於金流基礎設施相關且無主動通知 |
| 524 | 單一帳戶的 Plaid 交易同步失敗,錯誤訊息寫入 results 陣列該帳戶項目,continue 處理下一帳戶 | B(可以安靜) | — | 錯誤已包含在 mutation 回傳的 results 陣列裡,呼叫端可讀取到該帳戶的 error 欄位 |
| 736 | CSV 匯入與 Plaid 既有列合併(去重)失敗,只 console.warn,繼續下一筆 | B(可以安靜) | — | 合併失敗最壞情況是兩筆重複列並存讓 Jeff 人工看到,不會遺失交易金額資料 |
| 772 | 合併後重新分類(classifyUncategorizedBatch)失敗,只 console.warn(訊息本身標註 non-fatal) | B(可以安靜) | — | 程式註解明確標註 non-fatal,只影響自動分類,交易資料本身已寫入 |
| 822 | CSV 匯入單筆交易列寫入 bankTransactions 失敗,只 console.warn,跳過該筆繼續下一筆 | A(必須浮出) | ②錢 | bankTransactions 是權威 P&L 帳本,單筆交易寫入失敗且無任何浮出等同帳目憑空漏一筆,Jeff 不會知道 |
| 869 | 呼叫 Plaid /item/remove 解除授權失敗,只 console.warn,註解明講繼續軟刪除 | B(可以安靜) | — | 程式明確設計為 fail-open,即使 Plaid 端失敗仍會繼續完成本地軟刪除,不影響既有交易資料 |
| 1139 | 手動覆蓋交易分類後,同步 trust deferral 狀態失敗,只 console.warn | A(必須浮出) | ②錢 | Trust 帳戶遞延認列狀態若與分類覆蓋不同步,可能造成 Trust vs Operating 認列金額算錯且無人知曉,涉及 CLAUDE.md Trust 會計硬紅線 |

### `server/routers/posterGen.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 207 | 海報生成(composePoster)失敗 | B(可以安靜) | — | 先記錄 errored 狀態到 DB 再丟 TRPCError 回前端,已用錯誤回應方式浮出 |

### `server/routers/posters.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 67 | 海報上傳後排入後製處理佇列失敗 | B(可以安靜) | — | 失敗會把該筆狀態改成 failed 並寫入 notes,admin 在列表上看得到,非靜默 |

### `server/routers/preDepartureNotifications.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 90 | 行前通知信寄送給客人失敗,log.error 後把狀態改回 approved(而非 sent),回傳 { ok: true, sent: false } | A(必須浮出) | ④客人可見輸出 | 行前通知是直接寄給客人的重要文件,寄送失敗只留 server log 與狀態欄位,沒有主動通知 Jeff,容易被忽略 |

### `server/routers/reviews.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 155 | 插入 tourReviews(訂單評論)失敗 | B(可以安靜) | — | 已用 rethrow 方式浮出(重複鍵轉 TRPCError,其餘原樣拋出) |
| 205 | 插入 tourReviews(開放式評論 createPublic)失敗 | B(可以安靜) | — | 已用 rethrow 方式浮出(重複鍵轉 TRPCError,其餘原樣拋出) |
| 316 | 審核通過評論後發放 Packpoint 獎勵 awardPackpoint 失敗 | B(可以安靜) | — | 註解明講不讓核准失敗,管理員可事後手動補發,刻意 fail-open |

### `server/routers/skills.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 306 | 單一技能測試案例執行失敗,錯誤訊息寫入 results 陣列該筆項目,continue 下一筆 | B(可以安靜) | — | 錯誤已包含在回傳給 admin UI 的 results 陣列裡,屬於內部開發測試工具 |

### `server/routers/storage.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 30 | R2 健康檢查 PUT 探測失敗 | B(可以安靜) | — | 這是健康檢查端點本身,錯誤內容直接寫入回傳的 result.put.error / summary,整個函式的目的就是回報這個失敗狀態 |
| 38 | R2 健康檢查 GET 探測失敗 | B(可以安靜) | — | 同30,錯誤已寫入回傳結果供呼叫端顯示 |

### `server/routers/suppliersRouter.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 80 | triggerSync 排入同步任務失敗,包成 TRPCError 拋出 | B(可以安靜) | — | 已包成 TRPCError 回應給呼叫端 |
| 960 | bulkImport 逐筆 createTour 失敗,收進 errors 陣列 | B(可以安靜) | — | errors 與 errorSamples 隨 mutation 回傳值一併交給呼叫的 admin |
| 1918 | 逐筆同步供應商價格/基本資訊到 tours 失敗,收進 errors 陣列 | B(可以安靜) | — | errors 隨回傳值一併交給呼叫的 admin |
| 2075 | 逐筆 hydrate 供應商解析資料寫回 tours 失敗,收進 errors 陣列 | B(可以安靜) | — | errors 與 errorSamples 隨回傳值一併交給呼叫的 admin |
| 2300 | 逐筆重建 UV tour(含刪除重建 departures)失敗,收進 errors 陣列 | B(可以安靜) | — | errors 與 errorSamples 隨回傳值一併交給呼叫的 admin |

### `server/routers/toolsRouter.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 94 | generateQuote PDF 產生/上傳流程失敗 | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出 |
| 150 | generateDeposit PDF 產生/上傳流程失敗 | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出 |
| 223 | generateTourComparison 產生/上傳流程失敗 | B(可以安靜) | — | 已用 rethrow(TRPCError)方式浮出 |

### `server/routers/toursAdmin.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 177 | tour.create 後排入翻譯佇列失敗,只 console.warn,tour 本身已建立成功 | B(可以安靜) | — | 非關鍵背景翻譯任務,fire-and-forget 設計 |
| 252 | update 前讀取 tour 舊值失敗,catch 後 fallback 為 null | B(可以安靜) | — | 僅影響 audit log 的 before 值,真正的 update 失敗會在下方另外拋出 |
| 257 | db.updateTour 失敗 | B(可以安靜) | — | 已用 throw e / 轉 TRPCError rethrow 浮出 |
| 281 | update 後排入翻譯佇列失敗,只 console.warn | B(可以安靜) | — | 非關鍵背景翻譯任務,fire-and-forget 設計 |
| 354 | patchField 前讀取 tour 舊值失敗,fallback 為 null | B(可以安靜) | — | 僅影響 audit log 的 before 值,實際 patch 仍照跑 |
| 386 | patchField 後排入翻譯佇列失敗,只 console.warn | B(可以安靜) | — | 非關鍵背景翻譯任務,fire-and-forget 設計 |
| 414 | db.deleteTour 失敗 | B(可以安靜) | — | 依訊息轉 CONFLICT TRPCError 或直接 rethrow,已浮出 |
| 757 | saveFromPreview 後排入翻譯佇列失敗,只 console.warn | B(可以安靜) | — | 非關鍵背景翻譯任務,fire-and-forget 設計 |
| 764 | saveFromPreview 整體儲存流程失敗 | B(可以安靜) | — | 已轉 TRPCError rethrow 給呼叫端 |
| 946 | diagnoseEnv 中 LLM 自我測試失敗 | B(可以安靜) | — | 結果 {ok:false,error} 直接回傳給觸發診斷的 admin,已浮出 |
| 962 | diagnoseEnv 中 LionTravel API 自我測試失敗 | B(可以安靜) | — | 結果直接回傳給觸發診斷的 admin,已浮出 |
| 983 | diagnoseEnv 中靜態 HTTP 爬取自我測試失敗 | B(可以安靜) | — | 結果直接回傳給觸發診斷的 admin,已浮出 |
| 1062 | llmStressTest 壓力測試呼叫失敗 | B(可以安靜) | — | {success:false,error} 明確回傳給呼叫端 |
| 1172 | confirmExtractedDepartures 中單筆出發日期建立失敗 | B(可以安靜) | — | 收進 errors 陣列並在 mutation 回應「X 筆失敗」訊息中明確回報給呼叫的 admin |
| 1289 | backfillLionDepartures 中單一 tour 的出發日回填失敗 | B(可以安靜) | — | 收進 results 陣列並在回應 failCount 中明確回報給呼叫的 admin |

### `server/routers/translation.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 140 | 客人瀏覽尚無翻譯的行程頁面時,觸發補翻譯佇列任務失敗 | B(可以安靜) | — | fire-and-forget 補種翻譯任務,失敗只是這次沒補到,下次客人再訪會重新觸發,屬可自癒的低風險路徑 |

### `server/routers/visa.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 248 | 簽證狀態更新信(approved/rejected/status update)寄送失敗 | A(必須浮出) | ④客人可見輸出 | 只 console.error,mutation 仍無條件回傳 success:true,admin(Jeff)會誤以為客人已收到通知 |

### `server/routers/vouchers.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 100 | 兌換成功後寄送 voucher 通知信失敗,只 console.error | B(可以安靜) | — | 註解明言 Don't fail the redemption — code is still in the UI,兌換結果仍正確回傳並可在 myVouchers 頁查到 |

### `server/scripts/accounting-eval.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 93 | CLI 腳本 main() 執行失敗 | B(可以安靜) | — | 標準 CLI top-level catch,console.error + process.exit(1) 讓執行端(終端機/CI)明確看到非零結束碼,非靜默 |

### `server/scripts/backfill-passport-encryption.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 241 | 護照加密回填腳本整體致命錯誤 | B(可以安靜) | — | 已用 captureException(Sentry)浮出 |

### `server/scripts/backfill-supplier-details.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 124 | main() 批次排入 enrichment queue 失敗,console.error 後 process.exit(1) | B(可以安靜) | — | 開發者手動執行的一次性 backfill 腳本,終端機直接可見錯誤且非零結束碼 |

### `server/scripts/enrich-tour-ambiance.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 319 | 單一 tour 套用 ambiance 文案/色票更新失敗 | B(可以安靜) | — | 人工執行的一次性 CLI 腳本,逐筆處理失敗只跳過該筆,console 有輸出供操作者查看 |
| 359 | CLI 腳本整體致命錯誤 | B(可以安靜) | — | console.error 後 process.exit(1),操作者在終端機直接看得到失敗 |

### `server/scripts/findTourUrls.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 42 | checkUrl 檢查雄獅候選網址失敗,catch 後回傳 {valid:false} | B(可以安靜) | — | 開發者互動式一次性腳本,非 production 執行路徑 |
| 72 | main() 執行失敗,.catch(console.error) 印出錯誤 | B(可以安靜) | — | 開發者手動執行的一次性腳本,終端機直接可見錯誤 |

### `server/scripts/fix-destination-countries.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 256 | main() 頂層例外,console.error 後 process.exit(1) | B(可以安靜) | — | CLI 維護腳本標準寫法,非零結束碼對執行者可見 |

### `server/scripts/sweep-place-aliases.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 141 | 單一地名的 LLM 正規化呼叫失敗,計入 failed 計數並 console.warn 後繼續下一筆 | B(可以安靜) | — | 人工執行的一次性維護腳本,失敗筆數會在結尾 summary 印出,非背景無聲失敗 |
| 151 | main() 頂層例外,console.error 後 process.exit(1) | B(可以安靜) | — | CLI 腳本標準寫法,非零結束碼 + 完整錯誤輸出,對執行者可見 |

### `server/services/accountingAgentService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 261 | runAccountingAgent 交易分類 LLM 呼叫失敗 | B(可以安靜) | — | 已回傳結構化結果並標記 needsHumanReview:true 與 error 訊息,agentCategory 留空供下批重試,非靜默吞掉 |
| 323 | processTrustInflow(Trust 帳戶遞延收入紀錄)呼叫失敗 | A(必須浮出) | ②錢 | Trust 會計是 CLAUDE.md 明訂硬紅線,這裡吞掉例外後完全沒有任何標記或回傳反映此筆遞延收入未寫入,交易分類本身仍顯示成功,錢的紀錄可能因此對不上 |

### `server/services/affiliateLinkService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 121 | trackAffiliateClick 寫入 affiliate 點擊紀錄失敗 | B(可以安靜) | — | 程式碼註解明寫 Non-critical,純分析用途 |

### `server/services/aiChatContextService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 169 | AI chat 上下文即時查詢符合行程資料庫失敗 | B(可以安靜) | — | 僅影響聊天機器人回覆時能否引用即時行程資料,屬加值功能失敗不影響核心聊天 |

### `server/services/aiChatSkillService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 174 | 智慧技能比對(intelligent skill match)失敗 | B(可以安靜) | — | 回傳空陣列,後續回覆生成流程仍繼續進行,非阻斷性失敗 |
| 275 | Claude 生成技能強化回覆失敗 | B(可以安靜) | — | fallback 回固定道歉文字給使用者,使用者可見並可重試,非靜默無反應 |
| 345 | 整個 processMessageWithSkills 流程失敗 | B(可以安靜) | — | 同上,fallback 回固定道歉訊息給使用者,屬 graceful degradation |

### `server/services/aiQuoteService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 262 | AI 報價單 HTML 上傳至 R2 失敗,只 console.warn | B(可以安靜) | — | 程式注解明寫 nice-to-have,仍回傳 HTML 讓呼叫端走 inline 儲存/view 路由,不影響報價單可用性 |

### `server/services/bankPLService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 183 | Trust 遞延收入查詢(totalDeferredForUser)失敗,導致 deferredIncomeSubtracted 維持 0 | A(必須浮出) | ②錢 | P&L 計算會退化成「未扣除 Trust 遞延收入的毛額」,等同把尚未 recognize 的訂金當本期營收,直接牴觸 CLAUDE.md 硬紅線 §3(CST §17550);只有 console.warn,Jeff 看到的月報數字可能是錯的卻毫無察覺 |

### `server/services/catalogRebuild/index.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 226 | 單一產品明細 enrich(UV enrichUvProduct)失敗 | B(可以安靜) | — | 註解明講 non-fatal,會在完整度 gate 另行把關 |
| 261 | 刷新一團客人班期 refreshTourDepartures(先刪舊未來班期再寫入重建班期)失敗 | A(必須浮出) | ④客人可見輸出 | 刪除/寫入若中途失敗可能讓客人正在看的行程班期消失或不完整,導致無法訂位卻無人知曉,要等下次重建才修復 |

### `server/services/competitorScraperService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 114 | 整體競品爬蟲流程失敗,console.error 後回傳 {success:false, departures:[], error} | B(可以安靜) | — | 競品價格監控爬蟲,非客人資料/金流關鍵路徑 |
| 117 | browser.close() 關閉瀏覽器失敗,.catch 靜默吞掉 | B(可以安靜) | — | 純資源清理動作,不影響爬蟲結果本身 |
| 262 | scrapeDetailPage 爬取詳情頁失敗,console.error 後回傳 {success:false, departures:[]} | B(可以安靜) | — | 競品監控爬蟲策略 1 失敗,有策略 2/3 fallback,非客人/金流路徑 |
| 304 | scrapeWithFirecrawl 呼叫 Firecrawl API 失敗,console.error 後回傳 {success:false, departures:[]} | B(可以安靜) | — | 競品監控爬蟲策略 2 失敗,非客人/金流路徑 |
| 352 | scrapePrintPage 爬取列印頁失敗,console.error 後回傳 {success:false, departures:[]} | B(可以安靜) | — | 競品監控爬蟲策略 3(最後手段)失敗,非客人/金流路徑 |

### `server/services/dailyDigestService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 159 | 每日早報彙整資料時,月結對帳(runReconciliation)失敗,只把錯誤訊息塞進 reconciliationWarnings 陣列 | B(可以安靜) | — | 已確認 reconciliationWarnings 會被渲染進早報信件的「⚠️ 系統警告」區塊,Jeff 看得到 |
| 434 | 早報信本身寄送失敗(sendMail 拋錯),console.error 後回 false,無其他備援通知 | A(必須浮出) | ③cron/部署可見性 | 這是 Jeff 每日了解營運狀況的主要管道,寄送失敗自己也沒有第二層告警,Jeff 完全不知道今天沒收到早報 |

### `server/services/dynamicScraperService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 155 | page.on('response') 攔截器內 response.text() 讀取失敗,回空字串繼續 | B(可以安靜) | — | 刻意 fail-open:API 攔截是輔助偵察,單一回應讀不到不影響主要爬蟲流程 |
| 181 | response 攔截器整體例外,註解明寫非致命錯誤直接忽略 | B(可以安靜) | — | 註解明確標示 non-fatal,best-effort 偵察邏輯 |
| 197 | page.goto networkidle2 導航逾時,落入 domcontentloaded fallback 策略 | B(可以安靜) | — | 刻意設計的多層 fallback 導航策略(SPA 常態逾時),非靜默失敗 |
| 209 | domcontentloaded fallback 導航也失敗,console.warn 後改用部分內容繼續 | B(可以安靜) | — | 爬蟲最終 fallback,warn 記錄且用部分頁面內容繼續,屬設計內降級 |
| 255 | page.evaluate 內讀取 #tourPara DOM 元素失敗,記下錯誤字串到 results | B(可以安靜) | — | 偵察用輔助資料擷取,失敗只記錄字串不影響主流程 |
| 262 | 讀取 #seoPara DOM 元素失敗,空 catch 完全忽略 | B(可以安靜) | — | 同上,偵察用輔助資料擷取,best-effort |
| 311 | 呼叫雄獅 API 端點(daytripinfojson 等)全部嘗試失敗,記下 error 到 results 繼續下一個端點 | B(可以安靜) | — | 多端點輪詢偵察,單一端點失敗记录後繼續,不影響整體 |
| 330 | 整段 page.evaluate(雄獅 API 偵察)例外,回傳 {evaluate_error} 物件 | B(可以安靜) | — | 偵察資料擷取 fail-open,回傳結構化錯誤物件供後續記錄,非核心爬蟲路徑 |
| 346 | page.title() 讀取失敗,fallback 回空字串 | B(可以安靜) | — | 刻意 fail-open,頁面標題讀不到不影響後續爬蟲步驟 |
| 356 | page.content() 讀取渲染後 HTML 失敗,fallback 回空字串 | B(可以安靜) | — | 刻意 fail-open,與其他 page.* 呼叫一致的降級模式 |
| 364 | page.evaluate 擷取純文字失敗,fallback 回空字串 | B(可以安靜) | — | 刻意 fail-open,純文字擷取失敗不中斷爬蟲 |
| 372 | page.screenshot() 全頁截圖失敗,fallback 回空 Buffer | B(可以安靜) | — | 刻意 fail-open,截圖失敗不影響其餘擷取結果 |
| 500 | JS 價格擷取 page.evaluate 失敗,fallback 回空價格陣列 | B(可以安靜) | — | 刻意 fail-open,價格擷取失敗有其他來源(靜態 fallback)可補 |
| 533 | browser.close() 關閉瀏覽器失敗,只 console.warn | B(可以安靜) | — | 清理階段 best-effort,不影響已完成的爬蟲結果 |
| 558 | autoScroll 自動滾動觸發 lazy load 失敗,完全忽略 | B(可以安靜) | — | 註解明寫忽略滾動錯誤,輔助性動作 |
| 632 | 靜態 HTTP fallback 抓取整體失敗,log 後 rethrow | B(可以安靜) | — | 已 rethrow(throw err),失敗已浮出給呼叫端 |

### `server/services/emailMarketingService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 262 | 行銷信單一收件人寄送失敗 | B(可以安靜) | — | failed 計數器累加,批次結束後 sent/failed 統計會回傳,非完全靜默 |
| 282 | 寄送完成後更新 campaign 狀態/統計到 DB 失敗 | B(可以安靜) | — | 行銷活動內部狀態記錄非關鍵路徑,信已經寄出,只是儀表板統計可能不準確 |

### `server/services/financialReportService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 196 | 財務月趨勢報表計算信託遞延(trust deferral, CST §17550)金額失敗,console.warn 後 deferredByMonth 維持空物件,每個月退回 gross 計算 | A(必須浮出) | ②錢 | 報表可能因此高估月營收/淨利(把還沒認列的信託訂金算進去),觸及 Trust 會計硬紅線,只有 console.warn 沒有任何後台可見警示 |

### `server/services/googlePlacesService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 147 | 單張 Google Places 照片 URL 解析失敗,只 console.warn 跳過該張 | B(可以安靜) | — | 圖片增強類非關鍵失敗,不影響其他照片與核心功能 |
| 155 | searchPlacePhotos 整體查詢失敗,只 console.warn 回傳空陣列 | B(可以安靜) | — | 圖片搜尋 best-effort,呼叫端可接受空結果 |

### `server/services/hotelImageService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 83 | searchHotelImage 對單一關鍵字搜圖失敗,console.error 後繼續嘗試下個關鍵字 | B(可以安靜) | — | 非關鍵的圖片增強功能,失敗最多是沒有配圖 |
| 105 | 批次補圖時單一飯店處理失敗,console.error 後退回原始飯店資料繼續下一筆 | B(可以安靜) | — | 非關鍵的圖片增強功能,已有原始資料 fallback |

### `server/services/imageIntelligenceService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 70 | findBestImage 中 imageLibrary 搜尋失敗 | B(可以安靜) | — | 多來源 fallback chain 第一層,失敗會繼續往下一來源找,非客人資料/金流 |
| 101 | findBestImage 中 Google Places 圖片搜尋失敗 | B(可以安靜) | — | fallback chain 中間層,失敗繼續往下一來源找 |
| 116 | findBestImage 中 Unsplash 圖片搜尋失敗 | B(可以安靜) | — | fallback chain 最後一層,失敗只是回傳 null 圖片 |
| 158 | Vision 分析後把 tags/描述寫回 imageLibrary 失敗 | B(可以安靜) | — | 僅影響圖庫 metadata 豐富度,分析結果本身仍正常回傳給呼叫端 |
| 310 | 單張 PDF 抽取圖片上傳 S3 失敗 | B(可以安靜) | — | 逐張處理,失敗只少一張圖不影響其他圖片與整體流程 |

### `server/services/invoiceService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 62 | Invoice HTML 上傳 R2 失敗 | B(可以安靜) | — | 程式碼明確註解 R2 是 best-effort,沒有就走 /view route,html 內容一律回傳不受影響 |

### `server/services/itineraryImageService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 57 | 目的地 fallback 圖片池預抓失敗 | B(可以安靜) | — | 程式碼註明 non-fatal,只影響配圖覆蓋率 |
| 68 | 單日行程關鍵字圖片搜尋失敗 | B(可以安靜) | — | 逐天處理,失敗會 fallback 到備用圖池或留空,不影響其他天 |
| 95 | assignItineraryImages 整體配圖流程出錯 | B(可以安靜) | — | catch 後直接回傳未配圖的原始 itineraries,純裝飾性功能不影響核心行程資料 |
| 161 | 補配缺圖行程時單日圖片搜尋失敗 | B(可以安靜) | — | 逐天處理,失敗只是該天仍缺圖,非核心資料 |

### `server/services/lionBulkImportService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 69 | listLionCategoryTours 抓取雄獅分類頁失敗,console.error 後回傳空陣列 | B(可以安靜) | — | 批次匯入前置的清單抓取失敗,admin 觸發流程,非客人/金流 |
| 211 | importOneTour 匯入單一雄獅團失敗,詳細 console.error 後回傳 {success:false, error} | B(可以安靜) | — | 錯誤結果會被彙總進批次結果並經 notifyAgentMessage 回報,也直接回傳給呼叫端 admin UI |
| 297 | notifyAgentMessage 發送批次匯入摘要到 catalog 頻道失敗,console.warn 靜默吞掉 | B(可以安靜) | — | 此為次要通知管道,主要回饋(imported/failed 計數)已同步回傳給觸發匯入的 admin UI |
| 343 | queueRewriteForImportedTours 將單一 tour 加入 LLM 重寫佇列失敗,console.warn 後繼續下一筆 | B(可以安靜) | — | 該 tour 仍停留在 draft/needs_review 狀態,admin 草稿列表可見,非完全隱形 |

### `server/services/lionTravelApiService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 163 | fetch 呼叫失敗(網路/逾時) | B(可以安靜) | — | 已用 rethrow 方式浮出(throw fetchErr) |
| 170 | 讀取非 2xx 回應的錯誤內文失敗時的 inline fallback | B(可以安靜) | — | 只影響 log 顯示用的錯誤內文預覽,下一行仍會 throw 真正的 HTTP 錯誤,不吞真正失敗 |
| 234 | noticeinfojson(注意事項)查詢失敗,回傳空清單 | B(可以安靜) | — | 程式碼註解明確標示「noticeinfojson is optional」,非核心資料 |
| 247 | groupcalendarjson(出發日曆)查詢失敗,回傳空陣列 | B(可以安靜) | — | 刻意設計:單一子查詢失敗不擋主資料,價格/行程等核心資料仍完整回傳 |
| 428 | fetchLionTravelData 整段爬取/解析失敗,回傳 null | B(可以安靜) | — | 供應商即時資料屬於 scrape 服務,公司既有政策要求報價前一律在供應商後台人工核對,此爬蟲失敗不會被盲目信任下游使用 |

### `server/services/marketingContentService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 151 | 週報社群貼文生成中單一平台 caption 失敗,console.error 後跳過繼續下一個 | B(可以安靜) | — | 行銷內容生成非關鍵功能,產出數量變少時人工審閱會直接看見 |

### `server/services/pdfImageExtractor.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 117 | 整份 PDF 圖片擷取失敗,console.warn 後回傳空陣列 | B(可以安靜) | — | 非關鍵內容擷取輔助功能,失敗只是少了幾張可用圖片 |

### `server/services/plaidSyncService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 129 | bankTransactions 新增交易 insert 失敗(非重複鍵的未知錯誤)只 console.warn,不計入任何失敗統計 | A(必須浮出) | ②錢 | authoritative 銀行交易可能永久漏記且無任何統計或通知會反映這筆遺失 |
| 211 | 標記已移除交易 excludeFromAccounting 失敗,只 console.warn | A(必須浮出) | ②錢 | 該筆本應排除的交易可能繼續被誤計入報表且無通知 |
| 247 | 整個銀行帳戶同步失敗,寫入 lastSyncError 到 DB 並回傳 error 欄位 | B(可以安靜) | — | lastSyncError 會在 admin BankAccountsTab 顯示,已有 UI 浮出管道 |
| 282 | 同步後自動分類交易失敗,只 console.warn | B(可以安靜) | — | 註解明文 non-fatal,交易仍在,之後可手動或下次自動再分類 |

### `server/services/posterGeneratorService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 272 | 產生海報後關閉 puppeteer 瀏覽器實例失敗 | B(可以安靜) | — | 純資源清理 best-effort,不影響已產出的海報結果 |

### `server/services/receiptOcrService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 129 | 收據 OCR LLM 呼叫失敗,console.error 後回傳 amount:null、confidence:0、rawResponse 帶錯誤訊息的結構化結果 | B(可以安靜) | — | 失敗已轉成明確的 confidence:0+錯誤字串回傳,呼叫端可判斷這筆抓取失敗不是真的 $0,非靜默吞掉 |

### `server/services/reconciliationService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 179 | 對帳報告抓 Stripe charges API 失敗 | B(可以安靜) | — | 失敗訊息寫入 report.warnings,會顯示在對帳報告 UI 上讓 Jeff 看到 |
| 382 | 對帳報告查銀行分類明細失敗 | B(可以安靜) | — | 同上,寫入 report.warnings 顯示在對帳報告 UI |

### `server/services/routeMap/fallbacks.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 236 | tryGoogle 地理編碼呼叫失敗,只 log.warn 回傳 null | B(可以安靜) | — | 路線圖地理編碼刻意多層 fallback(Google→Nominatim→國家層級),單層失敗屬預期 |
| 284 | tryNominatim 地理編碼呼叫失敗,只 log.warn 回傳 null | B(可以安靜) | — | 同上,fallback 鏈的一環,非核心資料 |

### `server/services/scheduledLearningService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 81 | 整個排程學習 scheduler 初始化失敗(讀取排程列表/設置 job),只 console.error,無任何浮出 | A(必須浮出) | ③cron/部署可見性 | cron 排程系統初始化全面失敗會導致所有 scheduled learning job 永遠不會被註冊,且無任何地方記錄這個系統性失敗,Jeff 無從得知 |
| 134 | 單一排程的 BullMQ job 設置失敗(cron 表達式/queue.add),只 console.error | A(必須浮出) | ③cron/部署可見性 | 該排程的 cron job 永遠不會被建立且無 DB 狀態記錄失敗、下次執行時間也不會更新,Jeff 無從察覺 |
| 349 | 單一行程的 AI 技能學習(learnFromContent)失敗,只 console.error,迴圈繼續處理下一個行程 | B(可以安靜) | — | per-item best-effort 迴圈,單一行程失敗不影響其他行程處理,且整趟結果仍會寫入歷史紀錄 |
| 404 | 整趟排程學習執行失敗,只 console.error,更新排程狀態為 failed 後回傳 null | B(可以安靜) | — | 失敗狀態已寫入 skillLearningSchedule.lastRunStatus,admin 可在後台查詢到,且屬於低風險內部功能(技能學習建議) |
| 475 | notifyOwner 發送學習完成通知失敗,只 console.error | B(可以安靜) | — | 只影響非核心的技能學習建議通知,非客人/金流相關 |
| 550 | 單一行程的 AI 技能學習失敗,只 console.error,迴圈繼續處理下一個行程 | B(可以安靜) | — | per-item best-effort,與 349 相同模式,不影響其他行程處理 |
| 592 | 手動觸發學習整體流程失敗,只 console.error,回傳 null | B(可以安靜) | — | admin 主動點擊觸發,mutation 回傳 null 前端可感知失敗,且非客人/金流功能 |
| 639 | 查詢學習歷史列表失敗,只 console.error,回傳空陣列 | B(可以安靜) | — | 純讀取型 admin 列表查詢,失敗只影響顯示,非核心資料 |
| 657 | 查詢排程列表失敗,只 console.error,回傳空陣列 | B(可以安靜) | — | 純讀取型 admin 列表查詢,非客人/金流相關 |
| 723 | 建立排程寫入 DB 失敗,只 console.error,回傳 null | B(可以安靜) | — | admin CRUD 操作,mutation 回傳 null 供前端判斷失敗,非客人/金流功能 |
| 776 | 更新排程設定失敗,只 console.error,回傳 false | B(可以安靜) | — | admin CRUD 操作,回傳 false 供前端判斷,非客人/金流功能 |
| 807 | 刪除排程失敗,只 console.error,回傳 false | B(可以安靜) | — | admin CRUD 操作,非客人/金流功能 |
| 836 | 更新學習建議狀態(accepted/rejected)失敗,只 console.error,回傳 false | B(可以安靜) | — | 內部技能學習建議狀態更新,非客人/金流功能 |

### `server/services/supplierRewriteService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 289 | 三個 AI prose agent 生成內容失敗,log.error 後回傳 success:false | B(可以安靜) | — | 已用結構化 success:false + error 回傳值浮出給呼叫端 |
| 362 | calibrateTour 校驗流程失敗,log.warn 後退回 verdict=review | B(可以安靜) | — | 註解明文刻意退回人工複核而非自動發布或隱藏,是設計好的保守後備 |
| 399 | 排入 EN 翻譯 queue job 失敗,只 log.warn | B(可以安靜) | — | 註解明文 non-blocking 且 never throws,刻意 best-effort |

### `server/services/supplierSync/index.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 61 | syncLionCatalog() 整體拋出例外(非回傳 status=failed,而是真的 throw) | A(必須浮出) | ③cron/部署可見性 | 只 console.error 不 rethrow,導致 BullMQ job 視為完成而非失敗;wireWorkerFunnel/notifyOwner 都掛在 worker 的 failed 事件上不會觸發,Jeff 對每日供應商目錄同步完全失敗會毫無所知 |
| 66 | syncUvCatalog() 整體拋出例外 | A(必須浮出) | ③cron/部署可見性 | 同 61,console.error 不 rethrow 使 BullMQ job 誤判成功,UV 供應商目錄同步全滅時 Jeff 收不到任何通知 |

### `server/services/supplierSync/lion.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 180 | lionSearch 分頁抓取失敗,console.warn 後設 status:'partial'+errorMessage 並跳出迴圈,已抓的資料繼續處理 | B(可以安靜) | — | 失敗狀態會經 finally 的 closeRun 寫入 sync run 記錄,後台供應商同步頁可查 |
| 318 | 整個 Lion 供應商同步流程失敗,console.error 後設 status:'failed'+errorMessage | B(可以安靜) | — | 同樣經 finally 的 closeRun 寫入 run 記錄,供後台稽核可見 |

### `server/services/supplierSync/lionDetail.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 139 | getDayTripInfo(每日行程細節)抓取失敗 | B(可以安靜) | — | 註解明講 daytripinfojson is optional,失敗退回只用航班資訊 |
| 194 | safeFetch 包裝的 Lion 供應商 API 端點(itinerary/priceTerms/notices/optional/tourInfo)之一失敗 | B(可以安靜) | — | 註解明講其餘端點照跑取得部分資料,屬供應商目錄同步刻意容錯設計 |

### `server/services/supplierSync/sharedDetail.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 69 | withRetry 內單次呼叫失敗(4xx 直接放棄,其餘依 backoff 重試,最終仍失敗會 throw lastErr) | B(可以安靜) | — | 已用 rethrow 方式浮出(4xx 立即 throw;達最大重試次數後迴圈外 throw lastErr) |

### `server/services/supplierSync/uv.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 154 | uvList 分頁抓取失敗,console.warn 後設定 status=partial 並中斷分頁迴圈 | B(可以安靜) | — | 以 partial 狀態記錄進 sync run,經 closeRun 存檔供後台監控頁查看 |
| 210 | uvDepartures 抓取單一產品出團資訊失敗,console.warn 後 continue 跳過該產品出團 | B(可以安靜) | — | 程式碼明確註記 log and continue,產品主檔已存,出團資料下次同步補齊 |
| 282 | UV 整體同步流程失敗,console.error 後設定 status=failed 並記錄 errorMessage | B(可以安靜) | — | 失敗狀態經 finally 區塊 closeRun 存檔,並回傳於函式結果,供後台監控 |

### `server/services/supplierSync/uvDetail.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 77 | UV getProductMain 供應商 API 呼叫失敗 | B(可以安靜) | — | 以 main=null 繼續,下游用 fail() 標記該項目 enrichment 失敗並回傳在結構化結果中,屬批次供應商同步的預期部分失敗 |
| 89 | UV getProductTravelDetail 供應商 API 呼叫失敗 | B(可以安靜) | — | 同上,travel=null 後下游以 fail() 標記回傳,非靜默吞掉 |

### `server/services/taxCsvService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 175 | generateBankMonthlyTrend 讀取月度銀行趨勢失敗,log.error 後 monthlyRows 維持空陣列繼續產生 CSV | A(必須浮出) | ②錢 | 稅務 CSV 會在沒有任何錯誤提示的情況下產出缺月資料的報表,Jeff 拿去報稅可能不知道資料不完整 |
| 203 | Trust 遞延金額查詢失敗,log.warn 後 trust 統計維持預設 0 值繼續產生 CSV | A(必須浮出) | ②錢 | Trust 遞延收入是 CST §17550 認列鐵律核心欄位,靜默歸零可能讓稅務報表把未認列訂金誤算成營收 |

### `server/services/tourMonitorService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 103 | 單一行程監控檢查失敗,increment failedTours + console.error + 嘗試寫審計/狀態 | B(可以安靜) | — | 已透過 monitorStatus='error' 欄位+tourMonitorLogs 記錄+failedTours 計數結構化浮出,可查 |
| 116 | 寫入 tourMonitorLogs 失敗紀錄本身又失敗,只 console.warn | A(必須浮出) | ③cron/部署可見性 | 註解明言『監控日誌表本身壞掉要知道』,但實作只 console.warn 沒有任何其他浮出管道 |
| 129 | 更新 tours.monitorStatus='error' 失敗,只 console.warn | A(必須浮出) | ③cron/部署可見性 | 這是唯一讓 admin 看到該行程監控失敗的欄位,寫入失敗會讓失敗狀態完全不可見 |
| 186 | scrapeTourPage 抓取來源失敗,console.warn 後寫入 tourMonitorLogs status:failed 並回傳無變化 | B(可以安靜) | — | 已寫入結構化稽核記錄(tourMonitorLogs)供查詢,屬刻意設計的可觀測 fail-open |
| 281 | 偵測到狀態變更後,實際更新 tourDepartures.status 失敗,只 console.warn | A(必須浮出) | ④客人可見輸出 | tourMonitorLogs 已先記為 success,但實際資料庫欄位未更新,客人看到的出發日狀態(額滿/開放)與稽核記錄不一致 |
| 298 | 偵測到座位數變更後,實際更新 tourDepartures.bookedSlots 失敗,只 console.warn | A(必須浮出) | ④客人可見輸出 | 同上,客人看到的可訂位/剩位數可能停留在舊值,影響訂購判斷甚至超賣風險 |
| 406 | liontravel 直連 API 監控失敗,console.warn 後 fall through 到 Puppeteer 備援路徑 | B(可以安靜) | — | 註解明言 Fall through to Puppeteer path,是刻意設計的備援機制 |

### `server/services/tripReminderService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 48 | Redis 已寄送檢查(exists/setex)失敗,fail-safe 直接視為「已寄送」跳過本次提醒 | A(必須浮出) | ④客人可見輸出 | Redis 故障期間所有行前提醒(護照/尾款/出發日)會被永久跳過且無告警,exact-day 視窗過了無法補發,屬系統性故障訊號被吞 |
| 136 | sendTripReminderEmail 寄送失敗,只 console.error+result.errors++ | A(必須浮出) | ④客人可見輸出 | idempotency key 已在寄送前設定為已寄送,寄送失敗永不會重試,客人永久收不到該筆行前提醒且無人知曉 |
| 172 | 售後評論邀請信的 Redis 已寄送檢查失敗,fail-safe 跳過本次寄送 | B(可以安靜) | — | 評論邀請屬行銷性質非關鍵營運資訊,漏發不影響客人行程 |
| 231 | sendReviewRequestEmail 寄送失敗,只 console.error+errors++ | B(可以安靜) | — | 評論邀請信屬行銷性質,非關鍵客人溝通 |
| 267 | 30天回購召回信的 Redis 已寄送檢查失敗,fail-safe 跳過 | B(可以安靜) | — | 回購行銷信非關鍵營運溝通,漏發影響有限 |
| 326 | sendWinbackEmail 寄送失敗,只 console.error+errors++ | B(可以安靜) | — | 回購行銷信非關鍵,失敗不影響既有客人權益 |
| 361 | 90天關懷信的 Redis 已寄送檢查失敗,fail-safe 跳過 | B(可以安靜) | — | 低壓力關懷信屬行銷性質,漏發影響有限 |
| 417 | sendCheckinEmail 寄送失敗,只 console.error+errors++ | B(可以安靜) | — | 關懷信屬行銷性質,非關鍵客人溝通 |

### `server/services/trustDeferralService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 390 | Trust 遞延收入資料寫入(trustDeferredIncome insert)失敗(非重複鍵情況),只回傳 reason 字串於結果物件 | A(必須浮出) | ②錢 | 確認呼叫端 accountingAgentService.ts 只 console.log 該 reason 未做任何檢查或告警,該筆 Trust 存款可能永遠未建立遞延收入紀錄,牽涉 Trust 會計規則(CLAUDE.md 硬紅線#3) |

### `server/services/unsplashService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 248 | Unsplash 圖片搜尋整體失敗,只 console.error 回傳空陣列 | B(可以安靜) | — | 圖片搜尋 best-effort,呼叫端普遍有多層 fallback 處理空結果 |

### `server/services/uvBulkImportService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 348 | readUvSupplierRow 讀取失敗,fallback 回 null | B(可以安靜) | — | Promise.all 平行讀取的容錯設計,null 由下游邏輯判斷並回傳結構化失敗結果 |
| 349 | getProductTravelDetail 讀取失敗,fallback 回 null | B(可以安靜) | — | 同上,下游會因缺資料而回傳明確 success:false |
| 350 | getDeparturesNext180Days 讀取失敗,fallback 回空陣列 | B(可以安靜) | — | 同上,容錯設計,缺班期會在後續價格檢查被攔下 |
| 357 | getProductMain 取得標題 fallback 失敗,回 null | B(可以安靜) | — | title 仍為 null 時函式在下一行明確回傳 success:false + error,已結構化浮出 |
| 483 | importOneUvProduct 整體匯入失敗,log.error 後回傳 {success:false, error} | B(可以安靜) | — | 函式頂部註解明訂 never throws,失敗以結構化結果回傳給批次呼叫端統計 |
| 569 | 批次匯入後排入 LLM 改寫 rewrite job 失敗,log.warn 後繼續下一筆 | B(可以安靜) | — | 匯入後的錦上添花式 LLM 潤飾佇列,失敗不影響已匯入的草稿 tour 本身 |

### `server/services/visionAnalysisService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 34 | Vision 結果 Redis 快取讀取失敗,console.warn 後停用快取,回傳 null(視同未命中) | B(可以安靜) | — | 純快取層 best-effort,最壞情況只是多花一次 LLM 呼叫重新分析圖片 |
| 49 | Vision 結果寫入 Redis 快取失敗,只 console.warn | B(可以安靜) | — | 純快取層 best-effort,不影響本次分析結果回傳 |
| 173 | analyzeImage 內 fire-and-forget 寫快取失敗,.catch 完全靜默不做任何事 | B(可以安靜) | — | 快取寫入 best-effort,不影響本次已回傳的分析結果 |
| 175 | 呼叫 Claude Vision 分析圖片整體失敗(LLM 呼叫/JSON parse 等),console.warn 後回傳 DEFAULT_RESULT | B(可以安靜) | — | 函式文件明確設計為 never throws、fallback 到預設標籤,只影響圖片自動標籤品質,非客人/金流 |

### `server/services/wechatAssistService.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 69 | draftReply 中 enrichChatContext 讀取行程 context 失敗 | B(可以安靜) | — | 僅影響 AI 草稿的上下文豐富度與信心分數,不影響草稿本身產出 |
| 90 | LLM 草稿生成失敗 | B(可以安靜) | — | fallback 顯示明確提示文字「AI 草稿失敗,請手動回覆」,已用可見方式浮出給使用者 |
| 124 | 客人來信與 AI 草稿寫入 wechatMessages(審核佇列)失敗 | A(必須浮出) | ①客人資料流 | 只有 console.warn,這筆客人互動紀錄可能永久沒進審核佇列 |

### `server/storage.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 223 | storageDelete 刪除 R2 物件失敗 | B(可以安靜) | — | 函式文件明確標示「errors are swallowed to prevent cascading failures during cleanup」,且回傳 boolean 讓呼叫端可自行檢查 |
| 260 | storageDeleteMany 單一批次(最多1000 key)刪除失敗 | B(可以安靜) | — | 失敗數計入回傳的 failed 計數,呼叫端可見,屬 rollback 清理的儘量而為操作 |
| 265 | storageDeleteMany 整體 setup(取得 R2 client 等)失敗 | B(可以安靜) | — | 同260,失敗數回傳給呼叫端,清理性質操作 |

### `server/suppliers/lionClient.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 174 | 雄獅團體列表搜尋 API 網路請求失敗 | B(可以安靜) | — | throw new SupplierApiError(...) 已 rethrow 給呼叫端 |
| 236 | 雄獅明細 API 網路請求失敗 | B(可以安靜) | — | throw new SupplierApiError(...) 已 rethrow 給呼叫端 |

### `server/suppliers/uvClient.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 105 | UV SOA2 API fetch 網路層錯誤 | B(可以安靜) | — | 已用 rethrow 方式浮出(包裝成 SupplierApiError 後 throw) |

### `server/tourGenerator.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 372 | Unsplash 封面圖搜尋/更新 tour.imageUrl 失敗,只 console.warn | B(可以安靜) | — | 註解明言 non-fatal,B3 封面圖是次要顯示增強,不影響行程本身 |
| 388 | extractedDepartures 中繼資料寫回 tours 表失敗,只 console.warn | B(可以安靜) | — | 註解明言 non-blocking,屬輔助解析中繼資料,非客人可見核心欄位 |
| 487 | 迴圈內單筆 tourDepartures insert 失敗,空 catch 直接跳過該筆 | B(可以安靜) | — | 註解明言 non-critical/skip,單筆出發日缺漏,下次重新生成會整批重建自癒 |
| 492 | B5 整批出發日重建(先刪舊再插新)IIFE 拋錯,只 console.warn | A(必須浮出) | ④客人可見輸出 | delete 已先執行,若 insert 中途失敗會讓已上線行程的出發日/價格整批消失且無人知道 |
| 513 | saveCalibrationResult 寫入 calibrationResults 稽核表失敗,只 console.warn | B(可以安靜) | — | 純內部品質稽核歷史記錄,非客人資料也非上架判斷本身 |
| 522 | calibrationScore/Verdict 回寫 tours 表失敗,只 console.warn | B(可以安靜) | — | admin UI 顯示用的稽核摘要欄位,non-fatal 設計,不影響行程實際內容 |
| 565 | notifyAgentMessage 發送 #catalog 頻道校準結果通知本身拋錯,只 console.warn | A(必須浮出) | — | 這正是要讓 Jeff 看到新行程審核結果的通知機制失敗且無其他管道補位,Jeff 該知道而不知道 |
| 588 | rejected tour 清理時刪 tourDepartures 子表失敗,.catch(()=>{}) 忽略 | B(可以安靜) | — | 僅是刪除已隔離行程的孤兒清理動作,失敗只留殘列不影響客人 |
| 589 | rejected tour 清理時刪 calibrationResults 子表失敗,.catch(()=>{}) 忽略 | B(可以安靜) | — | 同上,稽核歷史孤兒清理,非客人資料風險 |
| 590 | rejected tour 清理時刪 tourMonitorLogs 子表失敗,.catch(()=>{}) 忽略 | B(可以安靜) | — | 同上,監控日誌孤兒清理,非客人資料風險 |
| 591 | rejected tour 清理時刪 tourGroupNotes 子表失敗,.catch(()=>{}) 忽略 | B(可以安靜) | — | 同上,孤兒清理,非客人資料風險 |
| 595 | rejected tour 自動刪除整體流程失敗,只 console.warn | B(可以安靜) | — | Jeff 已在同一流程更早的 notifyAgentMessage(rejected=alert)收到警示,這裡失敗只是殘留一筆待清理的行程列 |
| 635 | addTourTranslationJob 佇列加入失敗,只 console.warn | A(必須浮出) | ④客人可見輸出 | 連重試安全網(BullMQ 佇列)本身都沒排進去,新行程英文翻譯可能永久缺失且無人知道 |
| 643 | 整個 generateTour 流程任何未捕捉例外,console.error 後回傳 {success:false} 而非 throw | A(必須浮出) | — | worker.ts 呼叫端未檢查 result.success 直接視為 job 完成,導致 Sentry/notifyOwner 的 failed 事件警報鏈完全繞過 |
| 652 | 生成失敗後的 R2 資產回滾清理失敗,只 console.warn | B(可以安靜) | — | 僅是失敗後孤兒儲存空間清理,不影響客人資料或金額 |

### `server/tourImageUpload.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 113 | 圖片 sharp 優化失敗,退回使用原始未優化圖片 | B(可以安靜) | — | 刻意設計的降級(保留原圖繼續上傳),有 console.error 記錄 |
| 197 | 單張圖片上傳端點整體失敗 | B(可以安靜) | — | 已用 res.status(500) 方式浮出給呼叫端 |
| 285 | 批次上傳中單張圖片處理失敗 | B(可以安靜) | — | 錯誤被收進 errors 陣列並回傳給呼叫端(admin 看得到每張失敗),非靜默 |
| 322 | 批次圖片上傳端點整體失敗 | B(可以安靜) | — | 已用 res.status(500) 方式浮出給呼叫端 |

### `server/tourMonitorWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 40 | monitor job 執行失敗,console.error 後 rethrow | B(可以安靜) | — | 已用 throw error 交給 BullMQ failed 事件浮出 |
| 64 | failed 事件中 notifyOwner(...) 本身呼叫失敗,只 console.error | A(必須浮出) | ③cron/部署可見性 | 通知鏈路本身斷裂,Jeff 完全不會知道這次 worker job 失敗 |

### `server/translation.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 19 | Redis ping() 失敗用來偵測 Redis 可用性 | B(可以安靜) | — | 刻意 fail-open,Redis 掛了退化成記憶體快取,不影響翻譯主流程 |
| 227 | logLlmUsage 記錄翻譯 LLM 用量寫入失敗 | B(可以安靜) | — | LLM 用量記錄屬分析用途,失敗不影響翻譯結果本身 |
| 327 | CJK 洩漏重試呼叫的 logLlmUsage 用量記錄失敗 | B(可以安靜) | — | 同上,用量記錄非關鍵 best-effort |
| 329 | CJK 洩漏偵測後的重試翻譯 LLM 呼叫失敗 | B(可以安靜) | — | 刻意設計的加強重試,失敗則沿用先前已產出的翻譯文字,fail-open 不影響主流程完成 |
| 339 | translateText 整體翻譯流程(含 LLM 呼叫)發生任何例外 | C(爭議,交指揮裁決) | — | catch-all 吞下所有翻譯錯誤並靜默回退原文,LLM 若長期故障會大量靜默降級且無人知曉,但也可視為合理 graceful degrade,難判斷業務重要性 |
| 422 | safeComplete 呼叫 logAgentComplete 寫入翻譯任務完成狀態失敗 | B(可以安靜) | — | 活動紀錄寫入的 best-effort 保護層,不影響翻譯本身結果 |
| 599 | 行程 hotels JSON 翻譯過程失敗(parse 或呼叫 translateText) | B(可以安靜) | — | 單一欄位翻譯降級,continue 迴圈繼續處理其他欄位,不影響整體行程資料 |
| 635 | 行程 meals JSON 翻譯過程失敗 | B(可以安靜) | — | 同 599,單一欄位翻譯降級不影響主流程 |
| 642 | 翻譯行程到某語言的整體流程失敗 | B(可以安靜) | — | 已 push 進 errors 陣列並透過 safeComplete 寫入 activity log 的 resultSummary/errorMessage,已用活動紀錄浮出 |
| 663 | translateTour 最外層例外(如 DB 或未預期錯誤) | B(可以安靜) | — | 已透過 safeComplete 寫入失敗狀態並回傳 success:false + errors,呼叫端可得知 |
| 676 | finally 區塊中補寫 logAgentComplete 失敗(最後防線的活動紀錄寫入) | B(可以安靜) | — | best-effort 補寫日誌,非主流程 |
| 788 | translateEntity 中某 JSON 欄位原始資料解析失敗(壞資料) | B(可以安靜) | — | 跳過該欄位繼續處理其他欄位,屬既有壞資料的靜默略過,不影響其他欄位 |
| 818 | translateEntity 對某語言的整體翻譯失敗 | B(可以安靜) | — | 已 push 進 errors 陣列並隨函式回傳供呼叫端判斷,已用回傳值浮出 |
| 894 | saveTranslation 寫入 translations 表失敗 | B(可以安靜) | — | 翻譯內容快取寫入失敗,下次呼叫會重新翻譯,不影響核心行程資料,僅快取未命中 |
| 926 | getBatchTourTranslations 查詢翻譯資料失敗 | B(可以安靜) | — | 讀取失敗回傳空物件,頁面退化成顯示原文,不影響核心資料 |
| 956 | getTourTranslations 查詢單一行程翻譯失敗 | B(可以安靜) | — | 同上,讀取降級不影響核心資料 |
| 988 | getAllTourTranslations 查詢行程所有語言翻譯失敗 | B(可以安靜) | — | 同上,讀取降級不影響核心資料 |
| 1213 | getTranslationsSummary 統計翻譯覆蓋率查詢失敗 | B(可以安靜) | — | admin 儀表板統計顯示用,失敗回傳空陣列不影響核心資料 |

### `server/tripReminderWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 30 | 行後評價信排程(post-trip review scan)失敗 | A(必須浮出) | ③cron/部署可見性 | 不 rethrow 導致外層 catch 與 wireWorkerFunnel 監控都看不到這次失敗,只留在 console log |
| 42 | 30 天 winback 挽回信排程失敗 | A(必須浮出) | ③cron/部署可見性 | 同上,子掃描失敗被吞,job 仍回報成功,wireWorkerFunnel 監控不到 |
| 53 | 90 天 check-in 信排程失敗 | A(必須浮出) | ③cron/部署可見性 | 同上,子掃描失敗被吞,job 仍回報成功,監控機制看不到 |
| 62 | 主要 trip-reminder scan job 整體失敗 | B(可以安靜) | — | 有 rethrow(throw error),交由 BullMQ failed 事件 + notifyOwner 處理 |
| 84 | job failed 時的 notifyOwner 通知本身又失敗 | B(可以安靜) | — | 同檔案已用 wireWorkerFunnel 獨立監控此 worker,非唯一浮出管道 |

### `server/trustRecognitionWorker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 109 | worker job 失敗後呼叫 notifyOwner 通知 Jeff,這個通知呼叫本身又失敗,只 console.error,無備援 | A(必須浮出) | ②錢 | Trust 認列 worker 是錢的敏感流程(CST §17550),若 job 失敗+失敗通知又失敗,Jeff 對這筆信託認列問題完全零可見度 |

### `server/worker.ts`

| line | 吞了什麼 | 分類 | 高風險類型 | 理由 |
|---|---|---|---|---|
| 106 | tour 生成 job processor 整體例外,更新 progress 後 throw error | B(可以安靜) | — | 已用 rethrow 方式浮出,交給 BullMQ failed 事件驅動 Sentry+notifyOwner |
| 185 | tour 生成 job failed 事件中 notifyOwner 寄送本身失敗,只 console.error | B(可以安靜) | — | 同一 handler 前面已先呼叫 captureException(Sentry)浮出過,這裡只是 belt-and-suspenders 的第二層通知失敗 |
| 253 | 翻譯 job failed 事件中 notifyOwner 寄送本身失敗,只 console.error | B(可以安靜) | — | 同上,captureException(Sentry)已先浮出,notifyOwner 是額外保險層 |

