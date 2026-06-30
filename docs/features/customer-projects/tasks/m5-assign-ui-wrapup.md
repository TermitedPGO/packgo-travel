# m5 — 歷史 tab 指派 UI + 各 tab 隨選 + 收尾

目標:歷史 tab 隨專案 filter + 手動指派;收尾全綠。依賴 m3/m4。

## Checklist
- [ ] DetailTabs.tsx `TimelineTab`:收 activeProjectId
  - [ ] 專案視圖只顯示該專案往來;未分類顯示未分類 + inquiries(query 已 m3 支援)
  - [ ] 每筆真實往來(grouped by thread)末尾「⋯」menu:未分類列→「歸到 {活躍專案}」一鍵 + 下拉其他;已指派列→「退回未分類」+ 改派
  - [ ] 呼 `customerOrders.assignConversation`;onSuccess invalidate customerConversationThread
- [ ] 訂單 tab:active 專案列高亮(點 chip ≈ 點該單)
- [ ] i18n:`指派到專案`、`退回未分類`、`歸到…` → zh-TW + en parity
- [ ] 文件/總覽維持客人層(本期不改,Phase 2)

## 收尾(監工獨立驗,不信自稱)
- [ ] tsc --noEmit 0 錯
- [ ] vitest 全綠
- [ ] i18n parity(pre-commit)
- [ ] 圓角 / Sheet padding / supplierCost 不外洩 紅線過
- [ ] 給 Jeff 看 → 同意才 pnpm ship(本期不部署)
