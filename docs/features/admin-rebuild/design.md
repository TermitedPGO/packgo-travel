# PACK&GO 後台系統重建 - 詳細設計

> Stage 2 — 基於 proposal.md + 現有 codebase inventory

---

## 一、系統總覽

```
┌─────────────────────────────────────────────────┐
│  /  (AdminShell)                                │
│  ┌──────┐  ┌──────────────────────────────────┐ │
│  │ 首頁 │  │                                  │ │
│  │ 客人 │  │  <Route Content>                 │ │
│  │      │  │                                  │ │
│  │      │  │                                  │ │
│  │  ⚙️  │  │                                  │ │
│  └──────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
   sidebar        main area
   (56px)
```

### 路由表

| 路徑 | 元件 | 說明 |
|------|------|------|
| `/` | `HomePage` | AI 對話 + Dashboard 卡片（需 admin 登入） |
| `/customers` | `CustomerListPage` | 客人列表（過濾系統帳號） |
| `/customers/:id` | `CustomerDetailPage` | 客人詳情（時間軸 + 側欄） |
| `/settings` | `SettingsPage` | 系統設定（清理、agent、供應商、帳號） |
| `/workspace` | redirect → `/` | 舊路徑相容 |
| `/admin` | redirect → `/` | 舊路徑相容 |
| `/tours`, `/tour/:id`, ... | 不動 | 前台公開頁面維持現狀 |

### Auth 邏輯

- `/` `/customers` `/settings` 需要 `role === 'admin'`，未登入跳 `/login`
- 前台頁面（`/tours` 等）維持現狀，不受影響

---

## 二、模組拆分

### 2.1 新建檔案

```
client/src/
  layouts/
    AdminShell.tsx          ← 新 layout：sidebar + main slot
  pages/
    HomePage.tsx            ← 首頁：AI + Dashboard
    CustomerListPage.tsx    ← 客人列表
    CustomerDetailPage.tsx  ← 客人詳情
    SettingsPage.tsx        ← 設定頁
  components/
    home/
      OpsChat.tsx           ← OpsAgent 對話介面（含 file drag-drop）
      DashboardCards.tsx    ← 四個摘要卡片容器
      TodoCard.tsx          ← 今日待辦卡片
      FinanceCard.tsx       ← 財務摘要卡片
      ToursOverviewCard.tsx ← 行程總覽卡片
      AgentStatusCard.tsx   ← Agent 狀態卡片
    customers/
      CustomerRow.tsx       ← 列表中每一列
      CustomerTimeline.tsx  ← 時間軸（左側）
      TimelineEvent.tsx     ← 時間軸上每個事件
      OrdersPanel.tsx       ← 訂單+付款（右側上）
      FilesPanel.tsx        ← 檔案區（右側中）
      CustomerAiChat.tsx    ← 客人專屬 AI 聊天（右側下）
    settings/
      CleanupSection.tsx    ← 系統清理
      AgentSettings.tsx     ← Agent 設定
      SupplierSettings.tsx  ← 供應商設定
      AccountSettings.tsx   ← 帳號設定（Gmail 連線等）

server/
  routers/
    dashboard.ts            ← 新 router：Dashboard 聚合查詢
    customerTimeline.ts     ← 新 router：統一時間軸查詢
  agents/autonomous/
    opsTools.ts             ← 擴展：9 → ~25 工具
    opsConfirmation.ts      ← 新：mutation 確認機制
```

### 2.2 複用現有

| 現有檔案 | 複用方式 |
|----------|----------|
| `WorkspaceToday.tsx` 的 today query 邏輯 | 搬進 `TodoCard.tsx`，簡化 UI |
| `CustomerChat.tsx` | 加 file drag-drop 後複用到 `CustomerAiChat.tsx` 和 `OpsChat.tsx` |
| `AgentChatPage.tsx` 的 OpsAgent 對話邏輯 | 搬進 `OpsChat.tsx` |
| `WorkspaceSidebar.tsx` 的客人列表 query | 搬進 `CustomerListPage.tsx` |
| 所有 tRPC routers | 後端不重寫，新增 2 支 router（dashboard + customerTimeline） |
| `opsTools.ts` | 在現有 9 個工具基礎上擴展 |

### 2.3 淘汰

| 淘汰檔案 | 原因 |
|----------|------|
| `Workspace.tsx` | 被 `AdminShell.tsx` + `HomePage.tsx` 取代 |
| `AdminV2.tsx` | 已 archive，正式移除 |
| `WorkspaceSidebar.tsx` | 被 `AdminShell.tsx` sidebar 取代 |
| `WorkspaceCompany.tsx` + 子 views | 功能拆到 settings 和 dashboard cards |
| `GuestCustomerPane.tsx` | 訪客不再進列表，概念移除 |
| `components/admin/*.tsx` (44 檔) | 已 archive，不再載入 |

---

## 三、首頁設計

### 3.1 OpsChat（對話框）

```
┌──────────────────────────────────────┐
│  OpsAgent                            │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 今天有 3 件事要處理：         │    │
│  │ 1. David Chen 的報價還沒回覆  │    │
│  │ 2. 日本 7 天團明天出發        │    │
│  │ 3. UV 同步昨晚失敗            │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ Jeff: 幫 David 報價日本 7 天  │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 找到 3 個符合的行程：         │    │
│  │ 1. 東京+箱根 7天 $2,890/人   │    │
│  │ 2. 大阪+京都 7天 $2,650/人   │    │
│  │ ...                           │    │
│  │ 要幫你出報價單嗎？            │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌────────────────────────┐ 📎 ▶    │
│  │ 輸入訊息...             │         │
│  └────────────────────────┘         │
│  拖拉 PDF/圖片到這裡上傳            │
└──────────────────────────────────────┘
```

**技術規格：**

- 對話歷史存 `agentMessages` table（agentName = 'ops'）
- 輸入框支援文字 + file drag-drop（上傳到 R2，返回 fileUrl）
- AI 回覆使用 `<Streamdown>` 元件渲染 markdown
- 佔頁面上半部，高度約 60vh，可拖拉調整

**File drag-drop 實作：**

```
用戶拖檔案到輸入區
  → 前端 onDrop 攔截
  → 調用 trpc.storage.getPresignedUrl（取 R2 上傳 URL）
  → fetch PUT 上傳檔案到 R2
  → 將 { fileUrl, fileName, mimeType } 附加到 message
  → OpsAgent 收到帶附件的訊息
  → 若為 PDF：server 端用 pdf-parse 讀內容，加入 context
```

### 3.2 Dashboard 卡片

對話框下方，2x2 grid：

```
┌─────────────────┐  ┌─────────────────┐
│  今日待辦 (5)    │  │  財務摘要        │
│                  │  │                  │
│  🔴 David 報價   │  │  本月營收 $12,450│
│  🟡 日本團出發   │  │  待收款 $8,200   │
│  🟡 UV 同步失敗  │  │  Trust  $45,000  │
│  ⚪ 2 封新詢問   │  │  Oper.  $12,300  │
│                  │  │                  │
│  [查看全部]      │  │                  │
└─────────────────┘  └─────────────────┘
┌─────────────────┐  ┌─────────────────┐
│  行程總覽        │  │  Agent 狀態      │
│                  │  │                  │
│  上架 1,205 條   │  │  Inquiry: 今3封  │
│  日本 580 | 歐洲 │  │  Ops: 昨12對話   │
│  東南亞 320 | ...│  │  Sync: 6hr 前 ✓  │
│                  │  │  失敗: 0         │
│                  │  │                  │
└─────────────────┘  └─────────────────┘
```

**今日待辦分類（優先度排序）：**

1. 🔴 緊急：未回覆超過 24hr 的詢問、今日出發但未確認
2. 🟡 重要：待回覆報價、待收款（超過 7 天）、系統錯誤
3. ⚪ 一般：新詢問、新註冊、出發前提醒

**每個待辦 item 可點擊：**
- 客人相關 → 跳到 `/customers/:id`
- 系統相關 → 跳到 `/settings` 或在 AI 對話中處理

---

## 四、客人列表頁

### 4.1 過濾規則

自動排除：
- `userId` 為 null 且 email 匹配系統模式（`*@uptimerobot.com`、`*@pingdom.com` 等）
- 或明確標記為 `isSystemAccount = true`（需加欄位，或用 tag）

只顯示：
- 有 email 且非系統帳號的 `customerProfiles`
- 有 `userId`（已註冊）的用戶也顯示

### 4.2 列表 UI

```
┌──────────────────────────────────────────────┐
│  🔍 搜尋客人（名字、email、電話）             │
├──────────────────────────────────────────────┤
│  David Chen        david@gmail.com    2hr 前 │
│  ├ 日本 7 天報價中                    🟡 報價 │
│                                              │
│  王小明            wang@qq.com        1 天前  │
│  ├ 歐洲 14 天已確認                   🟢 確認 │
│                                              │
│  Lisa Wu           lisa@outlook.com   3 天前  │
│  ├ 新詢問                            🔴 新   │
│                                              │
│  ...                                         │
└──────────────────────────────────────────────┘
```

**API：** 複用 `trpc.admin.listCustomerProfiles`，加 `excludeSystem: true` 參數

---

## 五、客人詳情頁

### 5.1 Layout

```
┌──────────────────────────────────┬──────────────────┐
│                                  │  訂單 + 付款      │
│  完整時間軸                       │  ┌──────────────┐│
│                                  │  │日本7天 $2,890 ││
│  ── 2026-06-17 ──                │  │已付 $870/2890 ││
│  📧 來信：請問日本行程...          │  │██░░░░░ 30%   ││
│                                  │  └──────────────┘│
│  ── 2026-06-16 ──                │                  │
│  📄 報價單已發送：東京7天.pdf      ├──────────────────┤
│                                  │  檔案             │
│  ── 2026-06-15 ──                │  📄 報價單.pdf    │
│  📧 回信：好的，以下是報價...      │  📄 護照副本.jpg  │
│                                  │  [拖拉上傳]       │
│  ── 2026-06-14 ──                ├──────────────────┤
│  🆕 新詢問建立                    │  AI 聊天          │
│                                  │  ┌──────────────┐│
│                                  │  │幫他查簽證進度 ││
│                                  │  └──────────────┘│
│                                  │  Agent: 查詢中...│
└──────────────────────────────────┴──────────────────┘
         ~65% width                    ~35% width
```

### 5.2 時間軸事件類型

| 事件 | 圖示 | 來源 table |
|------|------|-----------|
| Email 來信 | 📧↓ | `customerInteractions` (direction=inbound) |
| Email 回覆 | 📧↑ | `customerInteractions` (direction=outbound) |
| 詢問建立 | 🆕 | `inquiries` |
| 報價單發送 | 📄 | `customerDocuments` (type=quote) |
| 訂單建立 | 🛒 | `bookings` |
| 付款收到 | 💰 | `payments` |
| 出發前提醒 | ✈️ | `preDepartureNotifications` |
| AI 自動回覆 | 🤖 | `customerInteractions` (source=auto-reply) |
| 聊天訊息 | 💬 | `customerChatMessages` |

**API 設計（新 router `customerTimeline.ts`）：**

```typescript
// 單一 query 返回所有事件，前端按時間排序
customerTimeline.getTimeline
  input: { profileId: number, limit?: number, cursor?: string }
  output: {
    events: Array<{
      id: string           // "{type}-{id}" 避免衝突
      type: "email_in" | "email_out" | "inquiry" | "quote" | "booking" | "payment" | "reminder" | "auto_reply" | "chat"
      timestamp: Date
      title: string        // 一行摘要
      detail?: string      // 展開內容
      metadata?: Record<string, unknown>  // 原始資料（bookingId 等）
    }>
    nextCursor?: string
  }
```

**實作方式：** 6 個 SELECT UNION ALL，按 timestamp DESC 排序，cursor-based 分頁。不用 JOIN（各 table schema 不同），server 端 merge sort。

### 5.3 訂單面板

```typescript
// 複用現有 trpc.bookings.* 查詢
customerTimeline.getCustomerOrders
  input: { profileId: number }
  output: {
    orders: Array<{
      id: number
      tourTitle: string
      departureDate: string
      pax: number
      totalPrice: number
      paidAmount: number
      status: string
    }>
  }
```

### 5.4 檔案面板

```typescript
// 複用現有 customerDocuments table
customerTimeline.getCustomerFiles
  input: { profileId: number }
  output: {
    files: Array<{
      id: number
      fileName: string
      fileType: string    // quote, passport, visa, ticket, other
      fileUrl: string
      uploadedAt: Date
    }>
  }
```

**上傳流程：** 拖拉或點擊 → presigned URL → R2 上傳 → 寫 `customerDocuments` row

### 5.5 專屬 AI 聊天

複用 `CustomerChat.tsx`，帶入 `customerProfileId`。OpsAgent 收到訊息時自動帶入該客人的 context（最近訂單、最近互動、檔案列表），不需用戶重複說明。

---

## 六、OpsAgent 工具擴展

### 6.1 現有 9 個工具（保留）

全部保留，不改：
- `count_records`, `aggregate_departures`, `search_tours`, `search_departures`
- `search_bookings`, `search_customers`, `get_finance_summary`
- `list_missing_receipts`, `search_supplier_inventory`

### 6.2 新增查詢工具（直接執行，不需確認）

| 工具名 | 功能 | 資料來源 |
|--------|------|---------|
| `get_customer_timeline` | 取得客人完整時間軸 | customerTimeline router |
| `get_customer_orders` | 取得客人訂單+付款 | bookings + payments |
| `get_tour_availability` | 查即時餘位 | UV/Lion API (uvClient/lionClient) |
| `get_tour_pricing` | 查供應商直客價 | UV/Lion API |
| `get_dashboard_summary` | 今日待辦+財務+行程+agent 狀態 | dashboard router |
| `get_departure_details` | 出發團詳情（旅客名單、付款） | departures + bookings |

### 6.3 新增操作工具（需確認）

| 工具名 | 功能 | 確認方式 |
|--------|------|---------|
| `update_tour_status` | 上架/下架行程 | 顯示「要把 X 行程下架嗎？」等 Jeff 說好 |
| `delete_test_data` | 刪除假資料 | 顯示影響範圍，等確認 |
| `trigger_supplier_sync` | 手動觸發供應商同步 | 顯示「要重新抓 UV/Lion 行程嗎？」 |
| `confirm_payment` | 確認收款 | 顯示金額+客人，等確認 |
| `send_departure_reminder` | 發出發前提醒 | 顯示內容，等確認 |
| `archive_customer` | 歸檔客人 | 顯示客人資訊，等確認 |

### 6.4 新增文件生成工具（需確認）

| 工具名 | 功能 | 對應 skill |
|--------|------|-----------|
| `generate_quote` | 生成報價單 PDF | `packgo-quote` |
| `generate_flight_ticket` | 生成機票確認單 | `packgo-flight-ticket` |
| `generate_visa_doc` | 生成簽證申請文件 | `packgo-china-visa` |
| `compare_tours` | 行程比較表 | `packgo-tour-comparison` |
| `draft_reply` | 草擬回覆（email/微信） | 無 skill，直接 LLM |

### 6.5 確認機制設計

```
Jeff: 幫我把日本富士山 5 天下架

OpsAgent 內部:
  1. 調用 search_tours("日本富士山 5 天") → 找到 tour #1234
  2. 判斷 update_tour_status 需要確認
  3. 回覆：「找到『日本富士山經典 5 天』(ID: 1234)，目前有 2 個即將出發的團。要下架嗎？」

Jeff: 好

OpsAgent 內部:
  4. 調用 update_tour_status({ tourId: 1234, status: "inactive" })
  5. 回覆：「已下架。2 個即將出發的團不受影響。」
```

**技術實作：**

OpsAgent system prompt 裡定義兩類工具：
- `directTools`：查詢類，AI 自行調用
- `confirmTools`：操作類，AI 必須先描述將要做什麼、等用戶明確同意後才調用

這不需要額外的 confirmation middleware。OpsAgent 的 system prompt 已有「先問再做」原則，只要在工具 description 裡標明 `[REQUIRES_CONFIRMATION]` 即可。

### 6.6 Skill 接入方式

```typescript
// opsTools.ts 新增
{
  name: "generate_quote",
  description: "[REQUIRES_CONFIRMATION] 生成報價單 PDF。需要：客人名、行程、價格、人數。",
  parameters: { customerName, tourId, pax, ... },
  execute: async (params) => {
    const { dispatchSkill } = await import("../skills/dispatcher");
    return dispatchSkill("packgo-quote", params);
  }
}
```

現有 `skills/dispatcher.ts` 已有調用邏輯，只需從 OpsAgent 側調用。前提：skill 必須 `isPorted: true`。目前只有 `packgo-tour-comparison` 已 port，其他需要依序 port。

**Port 優先順序：**
1. `packgo-quote`（報價單，Jeff 最常用）
2. `packgo-flight-ticket`（機票確認單）
3. `packgo-deposit-receipt`（收據）
4. `packgo-china-visa`（簽證）
5. `packgo-tour-confirmation`（行程確認單）

---

## 七、設定頁

四個 section，accordion 或 tab 切換：

### 7.1 系統清理
- 刪除假資料（複用 `adminCleanup` router 現有功能）
- Purge 供應商行程（複用 `purgeSupplierTours`）
- 清理 agent 訊息

### 7.2 Agent 設定
- 自動回覆開關 + 信任階梯
- InquiryAgent 分類規則
- OpsAgent 行為偏好

### 7.3 供應商設定
- 同步頻率（目前手動，改為自動 cron）
- 供應商列表（UV、Lion）
- 最後同步時間 + 狀態

### 7.4 帳號設定
- Gmail 連線狀態（OAuth reconnect）
- Stripe 狀態
- R2 儲存用量

---

## 八、資料流

```
                    ┌─────────────┐
                    │  AdminShell │
                    │  (layout)   │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
      ┌─────┴─────┐  ┌────┴────┐  ┌──────┴──────┐
      │  HomePage  │  │Customer │  │  Settings   │
      │            │  │  List   │  │             │
      └─────┬──────┘  └────┬────┘  └─────────────┘
            │              │
    ┌───────┼───────┐      │
    │       │       │      │
 OpsChat  Cards  Today   Detail
    │       │       │      │
    │       │       │   ┌──┼──┬──────┐
    │       │       │   │  │  │      │
    │       │       │ Time Orders Files AiChat
    │       │       │ line
    │       │       │
    ▼       ▼       ▼
  ┌─────────────────────────┐
  │  tRPC Layer             │
  │  dashboard.ts (new)     │
  │  customerTimeline.ts    │
  │  ops.ts (existing)      │
  │  adminCleanup.ts (exist)│
  │  bookings.ts (existing) │
  │  ... (53 routers)       │
  └────────────┬────────────┘
               │
  ┌────────────┴────────────┐
  │  OpsAgent               │
  │  opsTools.ts (expanded) │
  │  skills/dispatcher.ts   │
  │  uvClient / lionClient  │
  └─────────────────────────┘
```

---

## 九、實作階段

### Phase 1: 骨架 + 路由（~2 天）

**目標：** 新 layout 跑起來，舊路由 redirect

- [ ] `AdminShell.tsx`：2 入口 sidebar + gear icon + main slot
- [ ] `HomePage.tsx`：placeholder（先放文字）
- [ ] `CustomerListPage.tsx`：placeholder
- [ ] `SettingsPage.tsx`：placeholder
- [ ] `App.tsx`：新路由 + redirect `/admin` `/workspace` → `/`
- [ ] Auth guard（admin only）

**驗收：** 打開 `/` 看到新 layout，sidebar 可切換，舊路徑自動跳轉

### Phase 2: Dashboard 卡片（~2 天）

**目標：** 首頁下半部有真實數據

- [ ] `dashboard.ts` tRPC router（聚合查詢）
- [ ] `TodoCard.tsx`：今日待辦（從 `WorkspaceToday` 邏輯遷移）
- [ ] `FinanceCard.tsx`：財務摘要
- [ ] `ToursOverviewCard.tsx`：行程統計
- [ ] `AgentStatusCard.tsx`：agent 活動
- [ ] `DashboardCards.tsx`：2x2 grid 容器

**驗收：** 首頁下半部顯示 4 張卡片，數據從 DB 即時拉取

### Phase 3: OpsAgent 對話（~3 天）

**目標：** 首頁上半部 AI 對話可用

- [ ] `OpsChat.tsx`：對話 UI（從 `AgentChatPage` 遷移 + 改造）
- [ ] File drag-drop 到對話框
- [ ] 擴展 `opsTools.ts`（新增 6 查詢工具）
- [ ] `opsConfirmation.ts`：mutation 確認機制
- [ ] 擴展 `opsTools.ts`（新增 6 操作工具 + 5 文件工具）
- [ ] OpsAgent system prompt 更新

**驗收：** 跟 AI 說「今天有什麼事」「查 David 的訂單」能正確回應。操作類會先問。

### Phase 4: 客人列表（~1 天）

**目標：** 客人列表頁可用

- [ ] `CustomerListPage.tsx`：搜尋 + 過濾 + 列表
- [ ] `CustomerRow.tsx`：每列渲染
- [ ] 修改 `listCustomerProfiles` 加 `excludeSystem` 參數
- [ ] 排序邏輯（最近互動優先）

**驗收：** `/customers` 顯示真客人（不含 UptimeRobot），可搜尋，點擊進詳情

### Phase 5: 客人詳情頁（~3 天）

**目標：** 客人詳情一頁看完

- [ ] `customerTimeline.ts` tRPC router
- [ ] `CustomerDetailPage.tsx`：左右 layout
- [ ] `CustomerTimeline.tsx` + `TimelineEvent.tsx`：時間軸
- [ ] `OrdersPanel.tsx`：訂單+付款進度
- [ ] `FilesPanel.tsx`：檔案區 + 上傳
- [ ] `CustomerAiChat.tsx`：專屬 AI 聊天

**驗收：** 點進客人看到完整時間軸，右側有訂單/檔案/AI 聊天

### Phase 6: 設定頁 + 收尾（~2 天）

**目標：** 設定功能遷移 + 清理舊代碼

- [ ] `SettingsPage.tsx`：4 個 section 完成
- [ ] 供應商自動同步 cron 設定 UI
- [ ] 移除舊 Workspace.tsx / AdminV2.tsx / WorkspaceSidebar.tsx
- [ ] 清理未使用的 imports 和 components
- [ ] 全站測試

**驗收：** 設定頁所有功能可用，舊頁面已移除，無殘留路由

---

## 十、風險 + 降低策略

| 風險 | 影響 | 降低策略 |
|------|------|---------|
| 客人時間軸 query 太慢（6 table UNION） | 頁面卡頓 | cursor 分頁，每次只拉 20 筆；加 composite index |
| OpsAgent 操作工具出錯（刪錯資料） | 數據丟失 | 確認機制 + audit log + dryRun 預覽 |
| Skill port 進度卡住 | 文件生成不能用 | Phase 3 先接已 port 的 `tour-comparison`，其他逐步 port |
| 舊路由 redirect 影響前台 | 客人端壞掉 | 只 redirect `/admin` `/workspace`，前台路由完全不動 |
| 8GB Mac tsc OOM | 開發卡住 | 繼續用 `SKIP_TSC=1`，CI 做完整 check |

---

## 待 Jeff 確認

1. 這個實作順序（Phase 1-6）你同意嗎？還是要調整優先級？
2. Phase 3（OpsAgent 對話）和 Phase 5（客人詳情）是最重的兩塊，各估 3 天。可以接受嗎？
3. 供應商自動同步的頻率：每天一次？每 6 小時？
