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
| m1 | schema 兩欄 + 0103 migration + 型別 | ☐ todo |
| m2 | ask-ops-stream orderId + buildOrderContextBlock + customerChatList orderId + test | ☐ todo |
| m3 | customerConversationThread orderId + assignConversation mutation + test | ☐ todo |
| m4 | ProjectBar.tsx + AdminCustomers state 提升 + Detail/Chat 接線 + 改名 + i18n | ☐ todo |
| m5 | 歷史 tab 指派 UI + 各 tab 隨選 + i18n parity + 收尾驗證 | ☐ todo |

## 收尾紅線(全綠才算完)
- [ ] `tsc --noEmit` 0 錯(OOM 用 NODE_OPTIONS=--max-old-space-size=6144)
- [ ] vitest 綠(每模組對應 test)
- [ ] i18n zh-TW + en parity(pre-commit 會擋)
- [ ] 圓角 / Sheet padding 紅線
- [ ] supplierCost 不外洩到任何客戶面投影
- [ ] 不部署(分支開發 → 給 Jeff 看 → 同意才 pnpm ship)
