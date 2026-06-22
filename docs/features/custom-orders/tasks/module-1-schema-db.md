# M1 — schema + migration + db 層

依賴:無(先做)。對應 design.md §2。

## Checklist

- [ ] drizzle/schema.ts 加 `customOrders` 表(design §2.1 全欄)
- [ ] drizzle/schema.ts 加 `invoices.customOrderId INT NULL`
- [ ] export type `CustomOrder` / `InsertCustomOrder`
- [ ] drizzle/0099_custom_orders.sql:idempotent(INFORMATION_SCHEMA guards,mirror 0098)
  - [ ] CREATE TABLE customOrders(僅缺才建)
  - [ ] invoices.customOrderId(僅缺才加)
  - [ ] index idx_co_profile / idx_co_user / idx_co_status + unique orderNumber
- [ ] drizzle/meta/_journal.json 加 idx 99 tag `0099_custom_orders`
- [ ] server/db/customOrder.ts:
  - [ ] `generateOrderNumber()` ORD-YYYY-NNNN(mirror generateQuoteNumber,COUNT+1)
  - [ ] `createCustomOrder` / `getCustomOrderById` / `listCustomOrdersByProfile` / `updateCustomOrder`
  - [ ] `ensureCustomerProfileId({userId?|profileId?})` find-or-create(參考 adminCustomers upsert)
  - [ ] decimal 進出轉 string(同 invoices.create)
- [ ] server/db.ts 加 `export * from "./db/customOrder"`
- [ ] server/db/customOrder.test.ts:number 格式/遞增、CRUD、ensureProfile 分支、decimal

## 紅線

- supplierCost 是欄位,但 db 層不做任何「自動填」邏輯(手動)。
- 收款時間戳註解清楚標「≠營收認列(§17550)」。
