# 客人專案分層 — Stage 2 Design

> 來源:proposal.md(已鎖)+ Jeff 2026-06-30 拍板三題。本檔定資料模型 / UI / 對話 scope /
> 收齊引擎影響 / 測試。Jeff 點頭後才 tasks → code。本檔不寫 code。

---

## 0. Jeff 拍板的三題(2026-06-30,鎖定)

| 題 | 決定 | 對設計的影響 |
|----|------|------------|
| 一句註釋欄位 | **用現有 `customOrders.title`,且可自由改名(跟 Claude 改對話名一樣)** | 不加欄位、不用為此 migration。改名直接用既有 `customerOrders.update({ title })`。chip 上 inline rename。 |
| 真實對話要不要也分專案 | **兩條都分專案**(AI 工作台 + 真實往來)。新信預設「未分類」,Jeff 手動指派 | `customerInteractions` 也要加 `customOrderId`;歷史 tab 加指派 UI;Gmail filing 預設寫 NULL。 |
| 切換器位置 | **標題列下方一排 chips,全頁共用;詳情和聊天都跟著選** | `activeProjectId` 提升到 `AdminCustomers` page state,往下傳 `CustomerDetail` + `CustomerChat`。 |

---

## 1. 既有結構驗證(讀過 code,非假設)

| 事實 | 出處 | 結論 |
|------|------|------|
| `customOrders` 已有 `orderNumber`(ORD-2026-0001)、`departureDate`、`title`(notNull)、`status` 狀態機、`notes` | drizzle/schema.ts:2375 | **專案 = customOrder 本身**,不包第二層 |
| 訂單列表已用 `orderNumber + title + departureDate` 顯示 | DetailTabs.tsx:397 (`CustomOrdersSection`) | 「訂單號 + 日期 + 一句註釋」格式已經在跑 |
| `customerChatMessages`(Jeff↔AI 工作台)keyed on `customerUserId` / `customerProfileId`,無 orderId | drizzle/schema.ts:3691 | 加 `customOrderId` 維度 |
| 真實往來 = `customerConversationThread` query,合併 inquiries + inquiryMessages + `customerInteractions`(Gmail/email/多渠道) | adminCustomers.ts:1400 | Gmail/email 落在 `customerInteractions` → 它加 `customOrderId` |
| `customerInteractions` 已有 `gmailThreadId` | drizzle/schema.ts:2850 | 指派以「整串 thread」為單位最自然 |
| AI 端點已收 `customerId` / `customerProfileId`,並用 `draftProfileId` 套路釘 system prompt | _core/index.ts:684 | 加可選 `orderId`,同套路釘「這一單」脈絡 |
| `customerOrders.update` 已支援改 `title`(`assertNotTerminal` 擋已取消/完成單) | adminCustomerOrders.ts:231 | 改名複用它,不另開 mutation |
| Gmail filing claim-or-insert 寫 `customerInteractions`,只給 `customerProfileId` | _core/threadFiling.ts:264 | 不動它 → `customOrderId` 自然 NULL = 未分類 |
| 客人頁三欄:List 300 / Detail flex-1(header+真相條+tabs)/ Chat 340 | AdminCustomers.tsx:36 | chip 排放 Detail header 底下,state 提升到 page |
| migrations = 手寫 idempotent SQL,INFORMATION_SCHEMA guard,下一個 0103 | drizzle/0102_*.sql | 0103 一檔加兩欄 |

---

## 2. 選擇模型(Selection Model)

頁面新增一個 page-level state:

```ts
// AdminCustomers.tsx
const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
//   number → 某一筆 customOrder(一個專案)
//   null   → 「未分類」籃子(customOrderId IS NULL 的對話 / chat)
```

- ProjectBar chips:`[專案A][專案B]…[未分類]`,專案按 `departureDate ?? createdAt` **新到舊**,`未分類` 釘在最後。
- **預設選取**:開客人時 = 最新的專案(最左);客人無任何訂單 → 只有 `未分類` chip 且選中(= 今天的行為)。
- 切到客人(`customer.id`/`kind` 變)時重設 `activeProjectId` 為預設(複用 CustomOrderSheet「default to newest order」既有慣例)。
- 向後相容:舊客人所有既有 `customerChatMessages` / `customerInteractions` 的 `customOrderId` 全是 NULL → 自動進「未分類」,不強迫建專案。

---

## 3. 資料模型 + migration

**新增兩個 nullable 欄位,零新表,零 backfill。** honors 最精簡 + 長在既有系統。

### 3.1 schema 變更(drizzle/schema.ts)

```ts
// customerChatMessages 加:
customOrderId: int("customOrderId"),            // NULL = 未分類籃子
// + index: idx_ccm_order on (customOrderId, createdAt)

// customerInteractions 加:
customOrderId: int("customOrderId"),            // NULL = 未分類(Gmail 預設)
// + index: idx_int_order on (customOrderId, createdAt)
```

不加 FK(與專案既有慣例一致:`bookingId` / `quoteId` 等都是 soft ref)。應用層保證 `customOrderId` 一定屬於同一個客人(見 §5 cross-customer guard)。

### 3.2 migration:`drizzle/0104_customer_projects.sql`(+ `.down.sql`)

手寫、idempotent(mirror 0102 的 INFORMATION_SCHEMA guard):
1. `ALTER TABLE customerChatMessages ADD COLUMN customOrderId INT NULL`(僅缺時加)
2. `ALTER TABLE customerInteractions ADD COLUMN customOrderId INT NULL`
3. 兩個 index(INFORMATION_SCHEMA.STATISTICS guard)

Additive、nullable、no backfill。既有列維持 NULL,語意即「未分類」。

---

## 4. AI 工作台對話 scope(customerChatMessages)

### 4.1 `/api/agent/ask-ops-stream`(server/_core/index.ts)

加一個可選 `orderId`(POST body + GET query),跟現有 `customerId`/`customerProfileId` 並存:

1. **解析 + 驗證**:`orderId` 存在時,讀該 order,assert 它的 `customerProfileId` == 本次 resolved 客人的 profileId(cross-customer guard,§5)。不符 → 400,SSE header 前擋掉(同現有 validation 位置)。
2. **history 取讀**(三分支擴充):
   - `customerId`/`profileId` + `orderId` 有 → `WHERE 客人 AND customOrderId = orderId`
   - `customerId`/`profileId` + `orderId` 無 → `WHERE 客人 AND customOrderId IS NULL`(未分類籃子)
   - 都無 → 全域 #ops(`agentMessages`),不動
3. **寫入**:Jeff 的提問 + agent 回答兩筆 insert 都帶 `customOrderId = orderId ?? null`。
4. **system prompt**:`orderId` 有 → 在既有 `buildCustomerChatContext` / `buildGuestChatContext` 之後,append 一個 `buildOrderContextBlock(orderId)`(新 helper,單列讀:號/標題/日期/狀態/應收已收/destination/notes + 已指派對話則數)。同 `extraSystem` append 的既有套路。`orderId` 無 → 維持原樣(客人層脈絡)。

> 設計理由:`draftProfileId` 維持 profile 層(草稿仍是寄給「這個客人」,不是「這一單」),不動。order 脈絡只進 system prompt,不改草稿目標。

### 4.2 `customerChatList` query(adminCustomers.ts:1135)

加可選 `orderId`:
- 有 → `customOrderId = orderId`
- 無 → `customOrderId IS NULL`(未分類)

只有 `useCustomerData` 一個 caller,行為改動可控。

### 4.3 client(CustomerChat.tsx + useCustomerData.ts)

- `CustomerChat` 多收 `activeProjectId` prop;send 時把 `orderId` 一起塞進 POST body / GET query(`activeProjectId` 為 null 時不送)。
- reset/hydrate 的 key 從 `(customer.id, customer.kind)` 擴成 `(customer.id, customer.kind, activeProjectId)` — 換專案 = 換對話線、清空 + 重新 hydrate。
- `useCustomerData` 的 `customerChatList` query 帶上 `orderId`(activeProjectId)。

---

## 5. 真實對話 scope + 手動指派(customerInteractions)

### 5.1 `customerConversationThread` query(adminCustomers.ts)— 三態合約

實作為三態(避免「無 orderId = IS NULL」誤殺客人層視圖):
- `orderId` 有 → `customerInteractions AND customOrderId = orderId`;**inquiries / inquiryMessages 在專案視圖隱藏**(下單前首次接觸,不屬某單)。
- `unfiledOnly: true` → `customerInteractions AND customOrderId IS NULL` + inquiries(歷史 tab 的「未分類」視圖)。
- **兩者皆無 → 不加 customOrderId filter(客人層全部)+ inquiries**。`useCustomerData` 的 Overview / 真相條 / followup 走這條,維持完整 — 信被指派到專案後也不會漏。

語意:**首次詢問永遠在未分類;成交後的 Gmail 往來可被指派到專案;Overview 仍看得到全部。** 跨客人 leakage 規則(verified-email / profileId resolution)完全不放鬆。

### 5.2 指派 mutation:`customerOrders.assignConversation`(新,adminCustomerOrders.ts)

```ts
input: {
  selection: { userId } | { profileId },     // 跨客人 guard 的 anchor
  orderId: number | null,                     // null = 退回未分類
  gmailThreadId?: string,                     // 有 → 整串一起指派(優先)
  interactionId?: number,                     // 無 thread id 時的單列退路
}
```

- resolve `selection` → profileId(s);把 `customOrderId` set 到符合的 `customerInteractions` 列,**WHERE 限定 `customerProfileId IN 該客人 profileIds`**(絕不跨客人)。
- `orderId` 非 null 時 assert order.customerProfileId 屬於該客人。
- 寫 `audit()`(`customOrder.assignConversation`)。
- 指派單位 = `gmailThreadId`(整串),沒有 thread id 才退單列。

### 5.3 歷史 tab UI(DetailTabs.tsx `TimelineTab`)

- 收 `activeProjectId`。專案視圖只顯示該專案的往來;未分類視圖顯示未分類 + inquiries。
- 每筆真實往來列(grouped by thread)末尾一個極簡「⋯」menu:
  - 未分類列 → `歸到 {活躍專案}`(一鍵,當前選了專案時)+ 下拉選其他專案。
  - 已指派列 → `退回未分類` + 改派其他專案。
- AI 工作台 chat 也能驅動指派(opsAgent 既有 tool 模式,Phase 2 再加,不擋本期)。

### 5.4 Gmail 收齊引擎影響(proposal §4 的開放題)

- `threadFiling.ts` claim-or-insert **不改**:新信寫 `customerInteractions` 時 `customOrderId` 自然 NULL → 落「未分類」。
- **零自動歸屬、零誤判風險**;Jeff 在歷史 tab 手動指派(§5.3)。blast radius 僅一個 nullable 欄。
- 既有 idempotent dedup(`uq_ci_profile_external`)不受影響。

---

## 6. UI:ProjectBar(標題列下方一排)

### 6.1 放哪 + 資料流

- state `activeProjectId` 在 `AdminCustomers`;傳 `CustomerDetail`(`activeProjectId` + `onSelectProject` + `onRenameProject`)與 `CustomerChat`(`activeProjectId`)。
- ProjectBar 渲染在 `CustomerDetail` header「真相條」之下(schema.ts 對應 CustomerDetail.tsx:157 之後),視覺上「標題列下方一排」,但 state 在 page → 同時驅動右欄 chat。
- 新元件 `client/src/components/admin/customers/ProjectBar.tsx`。

### 6.2 樣式(A+B 高密度極簡 + 圓角紅線)

- 一排可橫向捲動的 chips:`rounded-md`(Badge/Tag 級,CLAUDE.md §2.1),`text-[11px]`,active = `bg-gray-900 text-white`,其餘 `border-gray-300 text-gray-600`。
- chip 內容:`{title}` 為主,`{orderNumber}` 灰、小、前綴;hover 顯示日期。維持黑白(極簡是刻意的)。
- `未分類` chip:固定文案、不可改名。
- **無原生下拉**(Jeff:不要 default ui/ux)。

### 6.3 改名(跟 Claude 一樣)

- 雙擊 active 專案 chip → 變 inline `<input>`(`rounded-lg`,§2.1 輸入框級)→ Enter/blur 呼叫 `customerOrders.update({ orderId, title })` → onSuccess invalidate `listForCustomer` + `customerDetail`。
- 空字串擋下(title `min(1)`,沿用 server 既有 validation);Esc 取消。
- `未分類` 不可改名。

### 6.4 各 tab 隨選行為(本期範圍界定)

| Tab | 本期行為 |
|-----|---------|
| 總覽 Overview | **維持客人層**(AI 摘要 / 看門狗是 per-customer)。本期不改。 |
| 訂單 Orders | active 專案列高亮;點 chip ≈ 點該單。仍是完整管理面。 |
| 文件 Docs | **維持客人層**(`customerDocuments` 無 orderId)。列 Phase 2。 |
| 歷史 History | **隨專案 filter**(§5.3)+ 指派 UI。對話 scope 的主要落點。 |

---

## 7. tRPC / 端點變更清單

| 介面 | 變更 | 檔案 |
|------|------|------|
| `ask-ops-stream` | 加可選 `orderId`:驗證 + history filter + insert + system prompt | server/_core/index.ts |
| `buildOrderContextBlock(orderId)` | 新 helper(單列 order facts → prompt block) | server/_core/customerChatContext.ts |
| `admin.customerChatList` | 加可選 `orderId`(無 → IS NULL) | server/routers/adminCustomers.ts |
| `admin.customerConversationThread` | 加可選 `orderId`(專案視圖隱 inquiries) | server/routers/adminCustomers.ts |
| `customerOrders.assignConversation` | 新 mutation(thread/單列指派,跨客人 guard,audit) | server/routers/adminCustomerOrders.ts |
| `customerOrders.update` | 不變(改名複用) | — |

---

## 8. 測試計畫(每模組對應 vitest,§9.5 強制)

| 模組 | 測試重點 | 檔 |
|------|---------|----|
| chat scope | history filter(orderId / IS NULL 三分支)、insert 帶 customOrderId、cross-customer orderId 被擋 | server/_core 或 routers 的 ask-ops/chat test |
| conversationThread | orderId filter、專案視圖隱 inquiries、未分類含 inquiries、leakage 規則不破 | adminCustomers test |
| assignConversation | gmailThreadId 整串指派、單列退路、跨客人擋下、退回未分類、audit 寫入 | adminCustomerOrders test |
| rename | update title min(1) 擋空、terminal 單擋改 | 既有 customOrder test 擴充 |
| ProjectBar / adapters | chip 排序(新到舊)、預設選最新、無單 → 未分類、reset on customer 切換 | adapters.test.ts 擴充 |

`tsc --noEmit` 必過(OOM 用 `NODE_OPTIONS=--max-old-space-size=6144`)。

---

## 9. 模組拆分(tasks 預覽 — 點頭後才建 tasks/*.md)

1. **m1 schema + migration**:schema 兩欄 + 0103 SQL + 型別。
2. **m2 chat scope**:ask-ops-stream `orderId` + `buildOrderContextBlock` + `customerChatList` orderId + test。
3. **m3 conversation scope + 指派**:`customerConversationThread` orderId + `assignConversation` mutation + test。
4. **m4 ProjectBar UI**:`ProjectBar.tsx` + AdminCustomers state 提升 + CustomerDetail/CustomerChat 接線 + 改名 + i18n。
5. **m5 歷史 tab 指派 UI + 各 tab 隨選** + i18n parity + 收尾驗證。

依賴:m1 → (m2, m3 並行) → m4 → m5。

---

## 10. 紅線合規 checklist(CLAUDE.md)

- 圓角:chip `rounded-md`、rename input `rounded-lg`、卡片 `rounded-xl`(§2.1)。
- i18n:所有新文案(未分類 / 改名 / 指派到專案 / 退回未分類 / 新專案…)進 zh-TW + en,pre-commit parity 會擋(§4.1)。
- tRPC-only:client 一律 `trpc.*`;chat stream 沿用既有 fetch SSE(既有例外,不新增 axios/fetch)。
- console.* 禁區:`_core/*` 用 `logger`(§4.2)。
- 成本紅線:`assignConversation` 與列表投影絕不吐 `supplierCost`(沿用 `toListItem` 既有投影)。
- 部署:本期不部署;分支開發 → tsc + vitest 綠 → 給 Jeff 看 → 同意才 `pnpm ship`(§4.3)。

---

## 11. 不納入本期(Phase 2,避免過度設計)

- inquiries / inquiryMessages 指派到專案(本期首次詢問固定在未分類)。
- 文件 Docs / 總覽 Overview 依專案 filter。
- opsAgent 用對話 tool 自動指派 / 自動建專案。
- 跨專案搜尋、專案層級的彙總統計。

---

## 12. 開放問題 — 已拍板(Jeff 2026-06-30)

1. ✅ ProjectBar chip 排序:專案新到舊在左,`未分類` 釘**最右**(虛線 chip)。
2. ✅ 預設選取 = **最新專案**(有單時),無單 → 未分類。
   理由:左欄客人清單已有未讀 badge,新信在開客人前就看得到;開進來落在正在跑的那單最順,
   看新信點一下未分類即可。與 CustomOrderSheet「default to newest order」一致。
   取捨(誠實記):新到的未分類信不會被預設落點自動帶出 — 若日後嫌不順,Phase 2 改「落在最新有動靜那條」。
3. ✅ 改名:**雙擊 active 專案 chip → inline input**(跟 Claude 改對話名一樣,無鉛筆 icon)。

scope:第一階段全做(m1→m5),按模組順序;m2(AI 工作台 scope)最先可見,真實對話指派(m3/m5)隨後。
