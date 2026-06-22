# M6 — 文件 tab 整合

依賴:M1(server 部分);UI 連動等 M5。對應 design.md §5.4。

## Checklist

- [ ] server/routers/adminCustomersDocs.ts:
  - [ ] `CustomerDoc["kind"]` 加 `"confirmation"`
  - [ ] `customOrderDocs(order)` → confirmation(`co-confirm:<id>`)+ quote(`co-quote:<id>`,僅非 aiQuotes 時)
- [ ] 接到 customerDetail docs 撈取(server)
- [ ] client types.ts:Doc.kind 加 `"confirmation"`
- [ ] i18n zh-TW.ts + en.ts:`admin.customers.docKind.confirmation`
- [ ] adminCustomersDocs.test.ts:customOrderDocs 正規化、id 命名空間不撞、kind 正確

## 紅線

- confirmation/quote PDF 是引用 URL,純展示;不洩成本。
- inv: 已涵蓋催款發票,不重做。
