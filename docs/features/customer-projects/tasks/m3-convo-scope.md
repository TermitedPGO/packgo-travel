# m3 — 真實對話 scope + 指派(customerInteractions)

目標:真實 Gmail/email 往來可指派到專案;新信預設未分類。依賴 m1。

## Checklist(server)
- [ ] server/routers/adminCustomers.ts `customerConversationThread`:加可選 `orderId`
  - [ ] 有 orderId → customerInteractions AND customOrderId=orderId;**隱 inquiries/inquiryMessages**
  - [ ] 無 orderId(未分類)→ customerInteractions AND customOrderId IS NULL;inquiries 照舊全顯示
  - [ ] 既有跨客人 leakage 規則(verified-email/profileId)完全不放鬆
- [ ] server/routers/adminCustomerOrders.ts `assignConversation` 新 mutation
  - [ ] input: { selection, orderId: number|null, gmailThreadId?, interactionId? }
  - [ ] resolve profileIds;set customOrderId WHERE customerProfileId IN 該客人(絕不跨客人)
  - [ ] gmailThreadId 有 → 整串;無 → 單列退路
  - [ ] orderId 非 null assert order 屬該客人;audit() 寫入

## test
- [ ] orderId filter(專案隱 inquiries / 未分類含 inquiries);assign 整串 thread;單列退路;跨客人擋下;退回未分類(null);audit 寫入

## 驗收
- threadFiling.ts 不動,新信 customOrderId 自然 NULL;指派只動本客人列。
