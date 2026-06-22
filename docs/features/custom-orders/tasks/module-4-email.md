# M4 — email templates

依賴:M1。對應 design.md §4.4。

## Checklist

- [ ] server/email/templates/types.ts:加 `CustomOrderEmailData`
- [ ] server/email/templates/customOrder.ts:
  - [ ] sendCustomOrderQuoteEmail(附 quotePdfUrl)
  - [ ] sendCustomOrderCollectionEmail(kind, amount, paymentLink)
  - [ ] sendCustomOrderConfirmationEmail(附 confirmationPdfUrl)
  - [ ] getTransporter() + EMAIL_FROM + BASE_URL + notifyOwner backup
  - [ ] 語言依 preferredLanguage(zh-TW/en)
- [ ] server/email/customOrderEmail.test.ts:語言挑選、**無破折號**、**無 supplierCost/成本字眼**、幣別符號、金額格式

## 紅線(memory: customer_msg_style / no_em_dashes / no_cost_on_customer_docs)

- Jeff 口語:短、不官腔、不破折號、不打勾。
- 幣別符號依 currency,never 硬編 NT$。
- 信內絕不出現成本。只出現直客售價。
- 信不自動發(只 send* mutation 呼叫)。
