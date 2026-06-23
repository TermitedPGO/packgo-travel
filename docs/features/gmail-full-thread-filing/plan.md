# 客戶對話收齊 — 總計畫(Plan）

> 來源:2026-06-22 多代理設計(4 個子設計 + 1 個對抗審查,wf_1c14c2cc-ea0)。
> 這份是「整合 + 審查修正後」的權威計畫;細節設計見 design.md,本檔是實作主線 + 順序 + 決策。

## 一、目標(白話)

讓系統忠實反映「每位客人完整的真實對話」,雙向、含 Jeff 純文字回覆、用真實時間,
而且 scale 到未來更多客人。這樣 AI 才能正確判斷「球在誰手上」,不會叫 Jeff 去追他早就回過的事。
實證症狀:Jenny 6/15 純文字回的英文導遊報價($174/$2,260/$226)系統 0 筆;她 3 封寄件時間全標成今天;
Emerald(eyoung@axt.com)4 個月 15+ 封但系統 0 profile。

## 二、架構總覽(四子設計整合)

1. **一條共用 sync 路徑**:`server/_core/threadFiling.ts` 的 `syncThreadToInteractions(profileId, threadId, integration)`。
   poll 收件 + backfill 都走它,不再有第二條歧異路徑。
2. **thread 驅動,不是 profile 驅動**:走 Gmail thread → 認出對方真人 email → ensure-or-create profile → file 整條。
   (profile 驅動會跳過沒建檔的活躍客戶如 Emerald。)
3. **冪等鍵 = RFC822 Message-ID**(見 §三.1):`customerInteractions.externalId` + `UNIQUE(customerProfileId, externalId)`。
4. **claim-or-insert** 對齊既有 453 列:認領 legacy 列(補 externalId + 修 createdAt),認不到才 INSERT。零刪除零重複。
5. **拿掉 has:attachment gate**:純文字回覆改由 thread sync 一併收齊;`sentMailFiling` 降級為「只把附件存 R2 進文件 tab」。
6. **senderClassifier(純規則 no-LLM)**:在 Gmail query 端 + hydrate 後過濾,把 17k 雜訊擋在 LLM 之外;
   machine/supplier 不建 profile,customer/unknown 才建。
7. **身分層(第二批)**:`canonicalProfileId` 自我參照把「同人多 email」併成一人(系統只建議、Jeff 一鍵、不搬資料、可逆);
   `orgKey`/`contactRole` 把「同案多人」(AXT)群組但不併。

## 三、三個必須先解決的坑(對抗審查抓到,HIGH)

1. **externalId 的 key 要用 RFC822 Message-ID,但 `parseMessage`(gmail.ts:298)現在根本沒抽這個 header。**
   同一封信進兩個信箱(jeffhsieh09 + support@)Gmail 內部 id 不同、RFC822 Message-ID 相同。
   不先統一成 Message-ID,跨帳號去重是空話、migration 0101 的 UNIQUE 語意就是錯的。
   → 修:`parseMessage` + `listThreadMessagesForFiling` 抽 `headerMap['message-id']`;缺失才 fallback Gmail id。**最先做。**

2. **AI 摘要的二階燒錢(最被低估)。** backfill 補資料會推進 `lastInteractionAt` → `isSummaryStale` 回 true →
   `customerSummaryQueue` 對全部 backfill 客戶重跑 LLM 摘要。四子設計都說「純搬運不燒 LLM」卻沒擋這條。
   → 修:backfill 期間暫停 `customerSummaryQueue` repeatable,補完 + 驗收後一次性可控重算,再恢復 cron。Jeff 要知道這代價。

3. **Emerald 隱形的真因可能搞錯。** inbound(gmailPipeline:297)其實對任何非 noise 寄件人都建 profile,
   不是「只在分類成詢問才建」。她 0 profile 更可能是:(a)多半是 Jeff 寄「給」她(outbound),而 sentMailFiling 只在
   profile 已存在時才記、不建檔;或(b)被 noise 域誤殺;或(c)走了 receipt 分支。
   → 修:**上線前先 prod 拉 Emerald 原始信頭,確認她卡在哪個 gate**,否則 thread 驅動 backfill 可能照樣漏她。

## 四、實作順序(每步可獨立 ship、各有 Vitest、tsc 綠才下一步)

### MVP — 根治「看不全」的最小集(先做,到 Jenny 驗收能看全純文字回覆)
- **[0]** prod 拉 Emerald 原始信頭,確認她卡哪個 gate(推翻或確認設計前提)。
- **[1]** migration 0101:`customerInteractions` 加 `externalId VARCHAR(255) NULL` + `gmailThreadId VARCHAR(255) NULL`
  + `UNIQUE(customerProfileId, externalId)`(hand-written idempotent,mirror 0100 的 INFORMATION_SCHEMA guard,idx=101/tag 0101)。
  一起加 gmailThreadId 省第二條 migration(身分層的 same_thread 信號要用)。
- **[2]** gmail.ts:`parseMessage` 抽 RFC822 Message-ID;新 `listThreadMessagesForFiling`(回 id/messageId/threadId/from/date/direction/body/inTrash,**不動** getThreadHistory)。
- **[3]** gmailPipeline inbound insert 補寫 `externalId=Message-ID` + `gmailThreadId`(createdAt 已是 msg.receivedAt)。讓新進信先帶 key,杜絕後續 sync 自我重複。
- **[4]** `threadFiling.ts`:`syncThreadToInteractions`(claim-or-insert,純函式可單測;INSERT 用 onDuplicateKeyUpdate;認領**只補 NULL 欄 + 修 createdAt,絕不改 content**)+ test(冪等跑兩次列數不變 / 認領 legacy / 方向判斷 / Trash 排除)。
- **[5]** poll hook:`processOneEmail` 末尾呼 syncThreadToInteractions(同 threadId 本 cycle 記憶體去重)。**用 Jenny 驗收。**
- **[6]** `sentMailFiling` 降級:移除其 outbound interaction insert,只留附件→R2 pass(避免雙寫)。

### 延後(MVP 後分批)
- **[7]** senderClassifier(純規則)+ Gmail query 端過濾;讓 backfill 安全面對 17k 雜訊。
- **[8]** gmail-backfill BullMQ worker(thread 驅動、concurrency 1、sleep 150-250ms、per-tick≤30-50 thread、label cursor、**dry-run 報告先給 Jeff**)。先跑 support@,再 jeffhsieh09。**backfill 前暫停 customerSummaryQueue。**
- **[9]** 既有 459 spam 列純規則 reclassify(machine/supplier→confirmed_spam、真人留 spamBox;WHERE spamVerdict IS NULL;dry-run 先看)。
- **[10]** 明文卡號獨立一次性 scrub backfill(containsPaymentCard 掃全表,與 claim-or-insert 解耦,延續 a9139f1)。
- **[11]** 讀取側 cap:`customerConversationThread` 的 `lim ?? 50`(adminCustomers.ts:1163)提高 / 改游標分頁。**否則 ingestion 補齊但 UI 仍砍半(原症狀復發)。**
- **[12]** 身分層:`resolveProfileFamily` + `canonicalProfileId` + `customerMergeSuggestions` + 四個 query 換解析 + merge/unmerge mutation。**必接在 [8] 之後**(same_thread 信號要整串已落地)。orgKey 第二批。
- **[13]** daily 切 Gmail History API(`lastHistoryId` 增量),客量大才需要。

## 五、各子設計要點(濃縮)

### A. ingestion-mechanics
- listThreadMessagesForFiling:`threads.get(format:full)` 抓整條,per-thread cap 200、body 截 20000、排除 Trash。
- 方向判斷:per-integration selfEmail,用 `parseEmailAddress` 抽 email 後 `===`(不用 includes)。
- 兩帳號各自跑、互不污染;跨帳號同一封靠 Message-ID + unique 去重。

### B. identity-resolution(第二批)
- `customerProfiles` 加 `canonicalProfileId`(自我參照,alias 指向主檔)、`identityStatus`、`mergedAt/By`、`orgKey`、`contactRole`。
- 新表 `customerMergeSuggestions`(系統建議佇列,Jeff 審核;reject 永久壓住)。
- 合併=改指標+改 status,**不搬資料**,unmerge 純還原 → 完全落實「併錯比不併更慘」(一鍵可逆)。
- 讀側只改一處:`resolveProfileFamily()` 展開 canonical 家族,四個 query 共用。
- 共用信箱:`identityStatus='shared_mailbox'` 封鎖自動歸戶到單一會員帳號。

### C. noise-and-scale
- senderClassifier:self / machine(noreply、List-Id、ESP 域)/ supplier(Lion/UV/航空/訂房域)/ customer / unknown。
- Gmail query 端先擋:`-in:spam -in:promotions -in:social -list:* -from:noreply`,17k → 幾百候選 thread,LLM 永不碰被擋的信。
- spam 不再用 LLM 一封封判;既有 459 純規則 reclassify。
- support@ 乾淨可寬收;jeffhsieh09 嚴格過濾。

### D. migration-and-safety
- claim-or-insert 三重比對:direction 同 + createdAt **±1 天**寬窗(不是 design 舊寫的 ±2 分鐘)+ content 前綴 64 字相符;不確定就 INSERT。
- 修時間內建在認領:認領時 createdAt=Gmail internalDate。
- `filingBatch` 欄標每輪,給 rollback/稽核。
- 卡號遮罩走**獨立**一次性腳本(不混進 claim-or-insert,保「不改 content」的安全保證)。
- 全 prod 走 Fly;backfill/reconcile 一律先 dry-run 報告再實寫;Jenny + Emerald 當驗收。

## 六、Jeff 要拍板的決策

1. **externalId 用 RFC822 Message-ID**(跨帳號去重對,但要先改 parseMessage)還是 Gmail 內部 id(簡單但兩帳號同一封雙列)?建議 Message-ID。
2. **既有 453 列對齊 = claim-or-insert(A)**,且認領時間窗 = ±1 天。建議 A。
3. **backfill 回溯範圍**:support@ 全收;jeffhsieh09 回溯多久(建議 120-180 天)、第一批先只補「曾有 profile 或曾收過 PDF 報價」的對象,其餘第二批?
4. **backfill 期間暫停 AI 摘要 cron + 補完一次性重算**(避免二階燒錢 + 半補齊時摘要更偏)。建議暫停,你需知道摘要會短暫標「資料補齊中」。
5. **身分層第一版範圍**:只做「同人多 email 合併 + shared_mailbox 封鎖」,orgKey(AXT 同案多窗口)第二批?建議是。
6. **供應商/航空 thread**(Lion/UV/United 訂位往來)要不要 file 進系統當「非客戶訂位脈絡」(未來代訂機票查得到),還是完全不收?
7. 合併審核 UI 放哪、score 門檻 70 → 等 prod 拉 Jenny+AXT 真資料跑出 candidate 再校準,不先定死。

## 七、殘留風險(明列,本批接受)

- PII:scrubPii 只遮卡號(Luhn PAN)。到期/CVV/持卡人姓名/護照在自由文字裡仍明文落地 → 護照遮罩列 fast-follow;backfill dry-run 報告標出「哪些 thread 含卡號」讓 Jeff 知情。
- race:backfill worker vs poll hook 撞同 thread → INSERT 一律 onDuplicateKeyUpdate / catch duplicate-key 當 skip;concurrency 1。
- 總評(審查者原話):方向對、能根治,但四份設計是「各自正確、合起來有縫」,直接照單做會踩 §三 三個坑。先做 MVP [0]-[6] 到 Jenny 驗收,再分批推 backfill / identity,不要一次上全套。
