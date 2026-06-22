# M2 — 狀態機(純函式)

依賴:無(可與 M1 並行)。對應 design.md §3。

## Checklist

- [ ] server/routers/customOrderStateMachine.ts
  - [ ] `CustomOrderStatus` union(與 schema enum 一致)
  - [ ] `TRANSITIONS` 表(design §3.2)
  - [ ] `canTransition(from, to): boolean`
  - [ ] `assertTransition(from, to)` throw TRPCError BAD_REQUEST 若非法
  - [ ] `nextStatusForPayment(kind)` deposit→deposit_paid / balance→paid
  - [ ] needsQuote 分支 helper(draft 後該去 quoted 還 arranged)
- [ ] server/routers/customOrderStateMachine.test.ts:全表、非法擋掉、跨越式合法、payment 推進

## 紅線

- 純函式、無 DB、無 side effect(好測)。
