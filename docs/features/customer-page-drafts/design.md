# Batch 2 — 客人頁 AI 草稿一鍵核准送出

## 目標
在 `/ops/customers` 客人頁,顯示該客人「待核准的 AI 回覆草稿」,Jeff 一鍵核准即送。
維持既有邊界:draft-by-default、碰錢碰法律硬閘(refund / complaint / quote / deposit /
visa)永不自動送 —— 這類在客人頁「顯示但要跳確認框」才送。

## Jeff 拍板 (2026-06-21)
- 兩個草稿來源都撈、統一顯示。
- 敏感(hard_gate / hard-excluded)草稿在客人頁也能送,但要跳確認框。

## 兩個既有草稿來源(重用,不重做)
1. 網站詢問草稿 — `approvalTasks`(lane=cs, taskType=inquiry_reply, status=pending),
   draft 在 `payload.draftBody`;keyed by relatedType=inquiry / relatedId=inquiryId。
   送出 = `commandCenter.approve({id, editedPayload?})`(approveAndExecute 跑 executor 真寄信);
   拒絕 = `commandCenter.reject({id, reason})`。
2. Gmail 升級草稿 — `agentMessages`(messageType=escalation),`context.draftReply` +
   gmailThreadId + customerEmail;keyed by relatedCustomerProfileId。
   送出 = `commandCenter.escalationReply({messageId, body, attachments?})`(寄回原 Gmail thread)。
   (autoReplyBox 的 auto_replied/would_auto_send 是「已送/影子」留底,不是待核准草稿 → 不撈。)

## 後端(新增只有「一條讀取 query」)
- `server/routers/adminCustomerDrafts.ts`(pure、DB-free、有 test):把兩種 row 正規化成
  `CustomerDraft`,`mergeDrafts` 由新到舊。`sensitive` = riskLevel==='hard_gate' 或
  classification ∈ `AUTO_SEND_HARD_EXCLUDED`(從 autoSendGate import,單一真相)。
  namespaced id(`task:` / `esc:`)避免跨表撞 key。
- `admin.customerDrafts` route(union `{userId}` | `{profileId}`):重用
  customerConversationThread 的身分解析(verified email + profileIds,email 比對加
  `userId IS NULL` guard,絕不靠 client free-text)。
  - inquiry:先撈這位客人的 inquiry ids(userId 或 userId IS NULL+verifiedEmail / guest email),
    再撈 approvalTasks pending cs inquiry_reply 且 relatedId ∈ 那些 id。
  - email:agentMessages escalation,relatedCustomerProfileId ∈ 這位客人的 profileIds,
    且 context 有 draftReply + gmailThreadId。
- 送出/拒絕「不新增 mutation」,前端直接打既有的 commandCenter.* (已審計、已 rate-limit)。

## 前端(接既有 scaffold,CustomerChat 已有草稿卡版面)
- `types.ts` `Draft` 加:`id, source:'inquiry'|'email', sensitive, taskId|messageId, payload?(inquiry), subject?`。
- `useCustomerData.ts`:加 `customerDraftsQ`(enabled-gated)→ detail.drafts(user + guest 兩支);
  approve/reject 用 commandCenter mutations;onSuccess invalidate drafts + thread。
- `CustomerChat.tsx`:用真 drafts;`確認發送` → sensitive 先跳確認框再送;`編輯` → inline 改後
  approve 帶 editedPayload(inquiry)/ edited body(email);`不送` → reject(inquiry)/ ack(email)。

## 邊界
- 永不自動送;hard-excluded 類顯示「敏感」並強制確認框。adminProcedure(自動 rate-limit)。
- 身分一律從 OUR DB 解析;送出 target 由 server 從 inquiryId / messageId 還原,不收 client 指定收件人。

## 測試
- `adminCustomerDrafts.test.ts`:正規化、sensitive flag、merge 排序、id namespacing、髒 JSON 容錯。
- adapters / useCustomerData 輕量更新。

## 驗收
- commit 前跑對抗 review workflow(data-sql / react / house-rules),照 Batch 1。
- 本機無 DB,SQL 只能 prod 驗;route 的 correlated/identity SQL 交給 review + prod 抽查。
