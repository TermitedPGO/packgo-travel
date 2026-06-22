# M3 — router + 金流介面

依賴:M1, M2。對應 design.md §4.1-4.3。

## Checklist

- [ ] server/_core/paymentProvider.ts:`PaymentProvider` 介面 + `ManualPaymentProvider`(回 null) + `getPaymentProvider()`(本批回 Manual)
- [ ] server/_core/paymentProvider.test.ts
- [ ] server/routers/adminCustomerOrders.ts(全 adminProcedure):
  - [ ] listForCustomer({userId?}|{profileId?}) / get / create / update / cancel / updateStatus
  - [ ] attachQuote / sendQuote(confirm gate + quotePdfUrl 必填)
  - [ ] sendCollection(kind, paymentLink, createInvoice?) / recordPayment(kind, amount, paidAt?)
  - [ ] attachConfirmation / sendConfirmation(confirm gate + confirmationPdfUrl 必填)
  - [ ] send*/recordPayment/cancel/updateStatus 寫 audit()
  - [ ] 狀態轉移過 assertTransition
- [ ] server/routers.ts:appRouter 加 `customerOrders: adminCustomerOrdersRouter`
- [ ] server/routers/adminCustomerOrders.test.ts:confirm gate、缺 PDF reject、recordPayment 推狀態+時間戳、**supplierCost 不在 listForCustomer 客人面欄位**、audit 有寫

## 紅線

- send* 帶 `confirm: z.literal(true)`,少了 reject(雙保險:UI 按鈕 + flag)。
- 排程/agent 不得呼叫 send*。
- sendCollection 先試 getPaymentProvider().createPaymentLink(本批必 null)→ 用手貼 paymentLink。
