# M5 — 前端點亮(摘要/下一步/重算鈕)

目標:摘要區讀快取(秒開)、下一步 render 真 AI、加重算鈕 + stale 指示。依賴 M3。

輸入:`client/src/components/admin/customers/{types,useCustomerData,adapters}.ts`、`DetailTabs.tsx`(摘要 line 46-48、下一步 line 96-97)、`i18n/{zh-TW,en}.ts`。

步驟:
- [ ] `types.ts`:`aiSummary` 加 `nextStep`;加 `aiSummaryMeta?`(generatedAt/stale/generating)。
- [ ] `useCustomerData.ts`:加 `customerAiSummary` query;有快取用快取,stale/null 用規則 fallback + 背景觸發 refresh,算完 invalidate。
- [ ] `DetailTabs.tsx`:wants/actions/delivered 吃快取(fallback 規則版);下一步換 `nextStep`;加「重新整理」按鈕(rounded-lg)+ generatedAt 小字。
- [ ] i18n:refresh/generating/updatedAgo/stale 文案進 zh-TW+en,不硬編碼。
- [ ] 圓角/密度守 CLAUDE.md §2。

測試:`adapters.test.ts` 擴充(快取優先、fallback、nextStep)。

驗收:tsc 0 + 測試綠 → commit。
