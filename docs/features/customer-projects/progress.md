# 客人專案分層 — 實作總覽(progress)

> 監工視角。子 agent 只回報結論。文件自稱完成 ≠ 真完成,以 tsc + vitest 綠為準。
> design 見 design.md(已 Jeff 點頭,三題拍板於 §12)。

## 模組與依賴

```
m1 schema+migration ──┬──> m2 chat scope ──┐
                      └──> m3 convo scope ──┴──> m4 ProjectBar UI ──> m5 指派UI+收尾
```

| 模組 | 範圍 | 狀態 |
|------|------|------|
| m1 | schema 兩欄 + 0104 migration + 型別 | ✅ done |
| m2 | ask-ops-stream orderId + buildOrderContextBlock + customerChatList orderId + test | ✅ done |
| m3 | customerConversationThread orderId + assignConversation mutation + test | ✅ done |
| m4 | ProjectBar.tsx + AdminCustomers state 提升 + Detail/Chat 接線 + 改名 + i18n | ✅ done |
| m5 | 歷史 tab 指派 UI + 各 tab 隨選 + i18n parity + 收尾驗證 | ✅ done |

分支:`feat/customer-projects`(5 commits)。本地無 DATABASE_URL → 客人頁 preview 驗不了真資料,走 tsc + vitest + 給 Jeff 看。

## 收尾紅線(全綠)
- [x] `tsc --noEmit` 0 錯(OOM 用 NODE_OPTIONS=--max-old-space-size=6144)
- [x] vitest 綠(customerChatContext / adminCustomersThread / customOrder / adapters / adminCustomerOrders;server/_core 594 + server/routers 246 全過)
- [x] i18n zh-TW + en parity(pre-commit clean)
- [x] 圓角(chip rounded-md、改名 input rounded-lg)/ supplierCost 不外洩(order block 只售價已收;list 投影不含成本)
- [ ] 給 Jeff 看 → 同意才 pnpm ship(本期不部署)

---
## 2026-07-01 部署查證(Claude)
「本期不部署」已過期:m1-m5 + 0106 全部隨 v766/v767 上線,Emerald 實測通過(AI 建 4 張單、邊界全守住)。摘要三行/客人理解跟專案走隨 v770 上線。prod = v771。
