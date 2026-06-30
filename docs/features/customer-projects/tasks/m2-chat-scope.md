# m2 — AI 工作台對話 scope(customerChatMessages)

目標:Jeff↔AI 工作台對話可按專案分線,AI 看得到「這一單」脈絡。依賴 m1。

## Checklist(server)
- [ ] server/_core/index.ts `/api/agent/ask-ops-stream`:
  - [ ] 解析可選 `orderId`(POST body + GET query),整數正數 validation
  - [ ] cross-customer guard:order.customerProfileId == 本次 resolved 客人 profileId,不符 400(SSE header 前)
  - [ ] history 三分支:有 orderId → customOrderId=orderId;客人但無 orderId → customOrderId IS NULL;無客人 → #ops 不變
  - [ ] 兩筆 insert(question + answer)帶 customOrderId
- [ ] server/_core/customerChatContext.ts:`buildOrderContextBlock(orderId)` — 單列 order facts(號/標題/日期/狀態/應收已收/destination/notes + 已指派對話則數),append 到 extraSystem
- [ ] server/routers/adminCustomers.ts `customerChatList`:加可選 `orderId`(有→=orderId;無→IS NULL)

## Checklist(client)
- [ ] CustomerChat.tsx:收 `activeProjectId` prop;send 帶 orderId;reset/hydrate key 擴成 (id, kind, activeProjectId)
- [ ] useCustomerData.ts:`customerChatList` query 帶 orderId

## test
- [ ] history filter 三分支;insert 帶 customOrderId;cross-customer orderId 被擋;buildOrderContextBlock 純函式輸出

## 驗收
- 換專案 = 換對話線,清空重 hydrate;未分類仍含舊全部歷史(NULL)。
