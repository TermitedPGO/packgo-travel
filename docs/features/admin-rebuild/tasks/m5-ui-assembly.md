# M5: UI 組裝

> 最後階段。m1-m4 全部完成+測試通過後才開始。

## 前置條件（全部 green 才開始）

- [ ] m1 dashboard API：4 個 query 有 test 且通過
- [ ] m2 timeline API：getTimeline + getCustomerOrders + getCustomerFiles 有 test 且通過
- [ ] m3 ops tools：25 個工具全部定義，確認機制有 test
- [ ] m4 skill port：至少 packgo-quote 已 isPorted + 從 OpsAgent 調用成功

## Checklist

### 骨架

- [ ] `AdminShell.tsx` — 2 入口 sidebar（首頁、客人）+ 齒輪 icon + main slot
- [ ] `App.tsx` 路由更新 — `/` `/customers` `/customers/:id` `/settings`
- [ ] `/admin` `/workspace` redirect → `/`
- [ ] Auth guard（admin only）

### 首頁

- [ ] `HomePage.tsx` — 上半 OpsChat + 下半 DashboardCards
- [ ] `OpsChat.tsx` — 對話 UI + file drag-drop（從 AgentChatPage 遷移改造）
- [ ] `DashboardCards.tsx` — 2x2 grid
- [ ] `TodoCard.tsx` — 接 m1 getTodayActions
- [ ] `FinanceCard.tsx` — 接 m1 getFinanceSummary
- [ ] `ToursOverviewCard.tsx` — 接 m1 getToursOverview
- [ ] `AgentStatusCard.tsx` — 接 m1 getAgentStatus

### 客人列表

- [ ] `CustomerListPage.tsx` — 搜尋 + 過濾 + 列表
- [ ] `CustomerRow.tsx` — 每列
- [ ] 過濾系統帳號邏輯

### 客人詳情

- [ ] `CustomerDetailPage.tsx` — 左右分欄 layout
- [ ] `CustomerTimeline.tsx` — 接 m2 getTimeline
- [ ] `TimelineEvent.tsx` — 9 種事件類型渲染
- [ ] `OrdersPanel.tsx` — 接 m2 getCustomerOrders + 付款進度條
- [ ] `FilesPanel.tsx` — 接 m2 getCustomerFiles + 上傳
- [ ] `CustomerAiChat.tsx` — 帶 profileId 的 AI 聊天

### 設定

- [ ] `SettingsPage.tsx` — 4 section
- [ ] `CleanupSection.tsx` — 接 adminCleanup router
- [ ] `AgentSettings.tsx`
- [ ] `SupplierSettings.tsx`
- [ ] `AccountSettings.tsx`

### 清理

- [ ] 移除 Workspace.tsx
- [ ] 移除 WorkspaceSidebar.tsx
- [ ] 移除 AdminV2.tsx
- [ ] 清理未使用 imports
- [ ] i18n keys 同步（zh-TW + en）

### 驗收

- [ ] tsc --noEmit 0 errors
- [ ] 全部 Vitest 通過
- [ ] 開 dev server 手動測試每個頁面
- [ ] OpsAgent 對話測試（查/做/生成各一）
- [ ] 客人詳情頁時間軸顯示正確
- [ ] 舊路由 redirect 正常
- [ ] 前台頁面不受影響
