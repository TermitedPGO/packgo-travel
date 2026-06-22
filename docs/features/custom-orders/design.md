# 訂製單 (Custom Orders) — Stage 2 設計

> 狀態:Stage 2 設計,待 Jeff 點頭後才進 Stage 4 寫 code(CLAUDE.md §9.1)。
> 接續:proposal.md(Stage 1 已鎖)。本份只做設計,不動 schema、不寫 code。
> 日期:2026-06-21

---

## 〇、Stage 2 開工前確認的決策(2026-06-21,補 proposal §六 末尾未定 + 一項修正)

| # | 問題 | Jeff 拍板 | 對設計的影響 |
|---|------|-----------|--------------|
| A | 訂金固定 % 還每單自訂 | **預設 30% 可覆寫** | schema 存「絕對金額」`depositAmount`;UI 用 `總價×30%` 算建議值,Jeff 可改。% 只是輸入便利,DB 不存百分比。 |
| B | 確認書用哪支 skill | **兩者皆可,開單時上傳/選** | 系統不綁死 skill。`confirmationPdfUrl` 只是「引用一個 PDF URL」。Jeff 用 `packgo-quote`(行程表)或 `packgo-deposit-receipt` 出 PDF 後上傳/貼 URL。系統不排版、不生成。 |
| C | customOrders vs bookings | **獨立,留 nullable bookingId 備用** | 全新獨立表 + 乾淨狀態機;不放 tourId/departureId。只留一個 `bookingId INT NULL`(預設 null,邏輯不耦合),日後訂製單若也開套裝可掛。 |
| D | Square 用哪個產品 | **先抽介面、暫不接真 Square** | 修正 proposal §六.2(原寫「這批要做」)。本批做 `PaymentProvider` 介面 + `ManualPaymentProvider`(Jeff 手貼 Square 連結)。真 Square 串接留在介面後面,日後 drop-in。 |

> 修正記錄:proposal §六.2 寫「接 Square API 自動產生(這批要做)」。Jeff 於 Stage 2 改為「先抽介面、暫不接真 Square」。本設計以此為準;§六.2 視為被本表 D 取代。

---

## 一、概要設計 (High-level)

一筆訂製單 = `customOrders` 一列。客戶頁(`CustomerDetail`)的三顆 header 按鈕(報價/催款/確認書)落在這一列上。送出一律 Jeff 親自按(confirm gate),系統不自動發。

```
客戶頁 header [報價] [催款] [確認書]
        │
        ▼
  CustomOrderSheet(右側 Sheet)── 一筆訂製單的全貌
        │  ├─ 金額摘要(總價 / 訂金 / 尾款 / 已收)
        │  ├─ 狀態時間軸
        │  ├─ 報價區:掛報價 PDF → [送出報價](confirm gate)
        │  ├─ 催款區:訂金/尾款 → 貼 Square 連結 → [寄催款](gate) + [標記已收]
        │  └─ 確認書區:掛確認書 PDF → [送出確認書](gate)
        ▼
  adminCustomerOrders router(全 adminProcedure)
        │  ├─ create / update / listForCustomer / get / cancel / updateStatus
        │  ├─ attachQuote / sendQuote
        │  ├─ sendCollection / recordPayment
        │  └─ attachConfirmation / sendConfirmation
        ▼
  server/db/customOrder.ts(domain split)  +  migration 0099
  server/_core/paymentProvider.ts(Manual 預設,Square seam)
  server/email/templates/customOrder.ts(三封信,Jeff 口語,confirm gate)
```

與既有資料的關係:

- 報價 PDF:`customOrders.quotePdfUrl`(主,Jeff 上傳/貼)+ `quoteId INT NULL`(選,連 `aiQuotes` funnel 紀錄)。
- 發票:`invoices.customOrderId`(反向 FK,本批新增欄位)。一筆訂單可有訂金發票 + 尾款發票兩張。
- 確認書 PDF:`customOrders.confirmationPdfUrl`(引用,Jeff 上傳/貼)。
- 套裝 bookings:`customOrders.bookingId INT NULL`(備用橋接,預設 null)。

「錢的真相」放在 order 本身(`depositAmount` / `balanceAmount` / `depositPaidAt` / `balancePaidAt` / 已收金額)。invoices 是文件、不是真相;Trust 對帳走銀行 + 會計(proposal §六.1),本系統只記「已收訂金 / 已收全款」金額與時間。

---

## 二、資料模型 (Schema)

### 2.1 新表 `customOrders`(migration 0099)

```ts
// drizzle/schema.ts ── 訂製單 (custom-orders, 2026-06-21)
export const customOrders = mysqlTable("customOrders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("orderNumber", { length: 32 }).notNull().unique(), // ORD-2026-0001

  // ── 歸戶(客戶頁身分解析)──
  // customerProfileId 是 canonical anchor:guest 本來就有一列;registered 帳號
  // 在 createOrder 時 find-or-create 一列(uq_cp_user)。userId 是去正規化的方便欄。
  customerProfileId: int("customerProfileId").notNull(),
  userId: int("userId"),                 // 會員(可 null = 純訪客)
  // 快照(invoices 同款做法):訂單自述,profile 之後改名也不影響歷史單。
  customerName: varchar("customerName", { length: 200 }).notNull(),
  customerEmail: varchar("customerEmail", { length: 320 }),

  // ── 行程 ──
  title: varchar("title", { length: 200 }).notNull(),      // 例「台灣12天+越南5天」
  destination: varchar("destination", { length: 200 }),
  departureDate: date("departureDate"),
  returnDate: date("returnDate"),

  // ── 狀態機 ──
  status: mysqlEnum("status", [
    "draft", "quoted", "arranged",
    "deposit_paid", "paid", "confirmed",
    "departed", "completed", "cancelled",
  ]).default("draft").notNull(),
  // 報價是「可選步驟」(proposal §六.4)。needsQuote=0 的單直接 draft→arranged。
  needsQuote: int("needsQuote").default(1).notNull(),

  // ── 報價 ──
  quotePdfUrl: varchar("quotePdfUrl", { length: 1024 }), // 引用 skill 出的 PDF(主)
  quoteId: int("quoteId"),                               // 選:連 aiQuotes funnel 紀錄
  quoteSentAt: timestamp("quoteSentAt"),

  // ── 金額(售價,直客價;decimal 與 invoices 同精度)──
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }),
  depositAmount: decimal("depositAmount", { precision: 12, scale: 2 }),  // 絕對金額(UI 建議=總價×30%)
  balanceAmount: decimal("balanceAmount", { precision: 12, scale: 2 }),  // = total - deposit(存著好讀)
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),

  // ── 成本(手動、絕不自動、絕不上客人文件;David 案紅線)──
  // 只在 admin 算 margin 用。任何 customer-facing payload / email 都不得帶此欄。
  supplierCost: decimal("supplierCost", { precision: 12, scale: 2 }),

  // ── 收款(本系統只記「已收」金額 + 時間,不做 Trust 分錄;proposal §六.1)──
  // 注意:這些時間戳「不是」營收認列(CA B&P §17550 訂金≠營收)。認列走會計,
  // 本批只存 recognizedAt 佔位,不寫 accountingEntries。
  depositPaidAt: timestamp("depositPaidAt"),
  balancePaidAt: timestamp("balancePaidAt"),
  depositPaymentLink: varchar("depositPaymentLink", { length: 2048 }),   // Square 連結(本批手貼)
  balancePaymentLink: varchar("balancePaymentLink", { length: 2048 }),
  collectionSentAt: timestamp("collectionSentAt"),                       // 最近一次催款寄出
  paymentMethod: varchar("paymentMethod", { length: 20 }),              // 'square' 等

  // ── 確認書 ──
  confirmationPdfUrl: varchar("confirmationPdfUrl", { length: 1024 }),  // 引用 PDF(Jeff 上傳/貼)
  confirmedAt: timestamp("confirmedAt"),

  // ── 出發 / 認列(留下一段;本批只存,不接會計)──
  recognizedAt: timestamp("recognizedAt"),

  // ── 橋接 / 雜項 ──
  bookingId: int("bookingId"),           // nullable 備用(決策 C),預設 null
  notes: text("notes"),

  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  profileIdx: index("idx_co_profile").on(t.customerProfileId, t.createdAt),
  userIdx: index("idx_co_user").on(t.userId),
  statusIdx: index("idx_co_status").on(t.status, t.createdAt),
}));
export type CustomOrder = typeof customOrders.$inferSelect;
export type InsertCustomOrder = typeof customOrders.$inferInsert;
```

設計取捨記錄:

- 為什麼 `quotePdfUrl` 是主、`quoteId` 是選:真正的客製報價是 Jeff 用 skill 離線出 PDF,多半沒有 `aiQuotes` 列(proposal §二)。所以引用 URL 是主路徑;`aiQuotes` 連結只在剛好有 funnel 紀錄時補上。決策 B 同理用在確認書。
- 為什麼 deposit/balance 存絕對金額不存 %:決策 A。`balanceAmount` 存著(= total − deposit)讓催款/顯示不必每次重算,且容許「訂金 + 尾款 ≠ 總價」的真實情況(例如改價、加購)由 Jeff 自填,不被百分比綁死。
- 為什麼錢的真相在 order 不在 invoices:proposal §六.1。invoices 是寄給客人的文件(可有兩張:訂金、尾款);訂單列才是狀態機判斷「收到沒」的依據。
- 不放 FK constraint:沿用 repo 慣例(schema 全靠 index 不靠 DB FK),migration 手寫。

### 2.2 既有表加欄:`invoices.customOrderId`

```sql
ALTER TABLE `invoices` ADD COLUMN `customOrderId` INT NULL;  -- 反向 FK:一單可多張發票
```

讓催款動作建立的發票連回訂單,且既有 customerDocs 的 `inv:` 文件能歸到正確訂單。Additive、nullable、無 backfill。

### 2.3 Migration `0099_custom_orders.sql`

- 手寫、idempotent(INFORMATION_SCHEMA guards,mirror 0098)。
- 兩步:① `CREATE TABLE IF NOT EXISTS customOrders (...)` ② `invoices.customOrderId`(僅缺才加)。
- `drizzle/meta/_journal.json` 補 idx 99,tag `0099_custom_orders`。
- 本機無 DATABASE_URL(memory),migration 只在 prod/Fly 跑;本批產出 SQL 檔,不在本機 push。

### 2.4 訂單編號 `ORD-YYYY-NNNN`

`server/db/customOrder.ts` 的 `generateOrderNumber()`,mirror `generateQuoteNumber()`(aiQuoteService.ts:291):當年 `COUNT(*)` + 1,`padStart(4,"0")`。無 DB 時退回 `ORD-YYYY-<ts4>`。

---

## 三、狀態機 (State Machine)

### 3.1 狀態與意義

| status | 意義 | 進入方式 |
|--------|------|----------|
| `draft` | 剛建單 | createOrder |
| `quoted` | 報價已送(僅 needsQuote=1) | sendQuote |
| `arranged` | 行程已安排、待收款(匯流點) | markArranged(needsQuote=0)或 quoted 後客人接受 |
| `deposit_paid` | 已收訂金 | recordPayment(deposit) |
| `paid` | 已收全款 | recordPayment(balance / full) |
| `confirmed` | 確認書已送 | sendConfirmation |
| `departed` | 已出發(認列觸發點,本批僅手動可設) | updateStatus |
| `completed` | 結案 | updateStatus |
| `cancelled` | 取消 | cancel |

### 3.2 允許轉移(`canTransition(from,to)`,純函式、可測)

```
draft        → quoted | arranged | cancelled
quoted       → arranged | cancelled
arranged     → deposit_paid | paid | confirmed | cancelled
deposit_paid → paid | confirmed | cancelled
paid         → confirmed | cancelled
confirmed    → departed | cancelled
departed     → completed | cancelled
completed    → (terminal)
cancelled    → (terminal)
```

說明:

- 報價可選:`needsQuote=0` 時不經 `quoted`,走 `draft→arranged`。
- 確認書可在 `arranged`(尚未收款也能先發,少見)、`deposit_paid`、`paid` 觸發 → `confirmed`。實務多在收到訂金後發。
- 送出動作(sendQuote / sendConfirmation)= 狀態副作用,但都要 Jeff 按(confirm gate)。
- `recordPayment` 是「錢的真相」入口(手動,因真相在銀行/Square),設 `depositPaidAt`/`balancePaidAt` + 推狀態。
- `updateStatus` 提供 Jeff 手動覆寫,但一樣過 `canTransition` 守門(亂跳擋掉);跨越式合法跳轉允許(如 arranged→paid 一次付清)。
- 任何非 terminal → `cancelled` 都允許。

### 3.3 收款動作的兩段(催款 button 底下)

催款不是一鍵。拆兩個語意:

1. `sendCollection({orderId, kind, paymentLink, createInvoice?})` — 寄「請付訂金/尾款 $X,連結:…」給客人。**不改已收狀態**,只記 `collectionSentAt` + 存 `depositPaymentLink`/`balancePaymentLink`,可選一併開發票(invoices.create + customOrderId)。
2. `recordPayment({orderId, kind, amount, paidAt?, method?})` — Jeff 標記「已收」。設時間戳 + 推狀態(deposit→`deposit_paid`,balance/full→`paid`)。

這對應 proposal §六.1:系統只記已收金額與時間,Trust 對帳另走。

---

## 四、後端 (Backend)

### 4.1 Router:`server/routers/adminCustomerOrders.ts`

- 全部 `adminProcedure`(自動 60 req/min throttle + role check + 可 audit;CLAUDE.md §3.2)。
- 註冊:`server/routers.ts` appRouter 加 `customerOrders: adminCustomerOrdersRouter`(top-level sibling,自成 domain)。
- 碰錢/送信的 mutation 寫 `audit()`(server/_core/auditLog.ts):sendQuote / sendCollection / recordPayment / sendConfirmation / cancel / updateStatus,記 who-what-when。

| procedure | 種類 | 重點 |
|-----------|------|------|
| `listForCustomer({userId?} \| {profileId?})` | query | 同 customerDocs 雙模身分;解析成 customerProfileId 撈該客所有訂單(newest first) |
| `get({orderId})` | query | 單筆全欄(admin,含 supplierCost) |
| `create({selection, title, destination?, needsQuote, totalPrice?, depositAmount?, currency?, dates?, supplierCost?})` | mutation | 解析/find-or-create customerProfileId;快照 name/email;`generateOrderNumber()`;status=draft |
| `update({orderId, ...patch})` | mutation | 編輯 title/dates/金額/supplierCost/needsQuote;改 total 時建議重算 balance(server clamp) |
| `attachQuote({orderId, quotePdfUrl, quoteId?})` | mutation | 掛報價 PDF |
| `sendQuote({orderId, confirm:true})` | mutation | 前置:quotePdfUrl 必填,否則 PRECONDITION。寄報價信 → status=quoted, quoteSentAt |
| `sendCollection({orderId, kind, paymentLink, createInvoice?, confirm:true})` | mutation | 存連結 + collectionSentAt;可選開發票;寄催款信 |
| `recordPayment({orderId, kind, amount, paidAt?, method?})` | mutation | 設 paidAt + 推狀態(錢的真相) |
| `attachConfirmation({orderId, confirmationPdfUrl})` | mutation | 掛確認書 PDF |
| `sendConfirmation({orderId, confirm:true})` | mutation | 前置:confirmationPdfUrl 必填。寄確認信 → status=confirmed, confirmedAt |
| `updateStatus({orderId, status, reason?})` | mutation | 手動覆寫,過 canTransition 守門 |
| `cancel({orderId, reason})` | mutation | → cancelled |

confirm gate 雙保險:① UI 按鈕是唯一入口(Jeff 手按);② send* mutation 帶 `confirm: z.literal(true)`,少了就 reject。系統任何排程/agent 都不得呼叫 send*。

### 4.2 DB 層:`server/db/customOrder.ts`(domain split,CLAUDE.md §六)

`createCustomOrder` / `getCustomOrderById` / `listCustomOrdersByProfile` / `updateCustomOrder` / `generateOrderNumber` / `ensureCustomerProfileId(selection)`(find-or-create,參考 adminCustomers markNotCustomer 的 upsert)。無護照欄,不需加密。decimal 進出轉 string(同 invoices.create)。

### 4.3 金流介面:`server/_core/paymentProvider.ts`(決策 D)

```ts
export interface PaymentProvider {
  // 回 null = 此 provider 不自動產生連結(由 Jeff 手貼)
  createPaymentLink(args: {
    amountCents: number; currency: string;
    orderNumber: string; description: string;
  }): Promise<{ url: string } | null>;
}
export class ManualPaymentProvider implements PaymentProvider { /* 一律回 null */ }
// 日後:SquarePaymentProvider(env SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID,
//   用 Payment Links API CreatePaymentLink),env 缺就退回 Manual。
export function getPaymentProvider(): PaymentProvider { /* 本批一律 Manual */ }
```

`sendCollection` 先 `getPaymentProvider().createPaymentLink(...)`;回 null(本批必為 null)就用 Jeff 手貼的 `paymentLink` 入參。如此真 Square 是日後 drop-in,呼叫端不用改。Square 收款回拋的 webhook idempotency,日後可 mirror 既有 `stripeWebhookEvents`(本批不做)。

### 4.4 Email:`server/email/templates/customOrder.ts`

三個 sender,皆走 `getTransporter()` + `EMAIL_FROM` + `BASE_URL`(email/_shared.ts),backup `notifyOwner`(mirror bookingConfirmation):

- `sendCustomOrderQuoteEmail(order)` — 報價:附 quotePdfUrl 連結。
- `sendCustomOrderCollectionEmail(order, {kind, amount, paymentLink})` — 催款:金額 + Square 連結。
- `sendCustomOrderConfirmationEmail(order)` — 確認書:附 confirmationPdfUrl 連結。

客人信規範(memory:packgo_customer_msg_style / no_em_dashes):

- 語言依 `customerProfiles.preferredLanguage`(zh-TW / en)挑文案。
- Jeff 的口語聲音:短、不官方、不用破折號、不用打勾符號。
- 幣別符號依 currency(USD=$,never 硬編 NT$;mirror bookingConfirmation 註解)。
- **絕不**帶 `supplierCost` 或任何成本字眼(紅線)。金額只出現直客售價。
- 信不自動發:只有 send* mutation(Jeff 按)會呼叫。

---

## 五、前端 (Customer Page UI)

遵守 admin 設計系統(memory:admin_design_system)+ CLAUDE.md §2(圓角)+ §2.5(Sheet padding,width 用 `xl:max-w-*` 不是 `2xl:`)。黑白極簡,高密度。i18n 100% parity(zh-TW + en),禁硬編中文。

### 5.1 三顆 header 按鈕接線(`CustomerDetail.tsx:78-98`)

現為 `alert()`。改為:

- 三顆都開 `CustomOrderSheet`。Sheet 自帶報價/催款/確認書三區,按哪顆就 scroll/focus 對應區。
- 開 Sheet 前先解析該客訂單:0 筆 → Sheet 進「新訂單」狀態(填 title 後 create draft);≥1 筆 → 預設開最近一筆,可在 Sheet 內切換或新建。

### 5.2 `CustomOrderSheet`(新元件,`components/admin/customers/CustomOrderSheet.tsx`)

右側 `<SheetContent className="w-full xl:max-w-2xl xl:rounded-l-xl overflow-y-auto">`。區塊:

1. Header:orderNumber + status pill(`rounded-md` badge)+ 客名 + 訂單切換/新建。
2. 金額摘要卡(`rounded-xl`):總價 / 訂金 / 尾款 / 已收;admin-only 顯示 supplierCost + margin(明確標「成本，不上客人文件」)。
3. 狀態時間軸(沿用 timeline 視覺)。
4. 報價區:顯示/貼 quotePdfUrl + `[送出報價]`(confirm dialog gate)。
5. 催款區:訂金/尾款 toggle;貼 Square 連結;`[寄催款]`(gate)+ `[標記已收]`(amount + 日期)。
6. 確認書區:顯示/貼 confirmationPdfUrl + `[送出確認書]`(gate)。

送出類動作前一律彈 confirm dialog(碰錢碰客;memory admin_ai_boundary「AI 停在哪等 Jeff」)。所有 mutation 走 `trpc.customerOrders.*`。

### 5.3 OrdersTab 整合(`DetailTabs.tsx` OrdersTab)

OrdersTab 目前只顯示 bookings(`c.orders`)。加一個「訂製單」section(在 bookings 表上方),直接 `trpc.customerOrders.listForCustomer` 撈,列出每筆:orderNumber、title、status pill、總價/已收、出發日。點列開 `CustomOrderSheet`。bookings 表保留原樣。新訂單按鈕同開 Sheet。

> 為什麼不塞進大 adapter(useCustomerData):訂製單自成查詢、loosely coupled、好測,不汙染既有 customerDetail 適配器。

### 5.4 文件 tab 整合(`adminCustomersDocs.ts`)

加 `customOrderDocs(order)` normalizer,產出該訂單的:

- 確認書 PDF(新 doc kind `confirmation`,`co-confirm:<id>`)。
- 報價 PDF(若非 aiQuotes 列才補,`co-quote:<id>`,避免與既有 `q:` 重複)。

`CustomerDoc["kind"]` 加 `"confirmation"`;client `types.ts` Doc.kind 同步加;i18n `admin.customers.docKind.confirmation` 兩語都加。invoices 的 `inv:` 已涵蓋催款發票,不另做。

---

## 六、測試 (Vitest,每模組對應)

| 測試檔 | 蓋什麼 |
|--------|--------|
| `server/db/customOrder.test.ts` | generateOrderNumber 格式/遞增、create/get/list、ensureCustomerProfileId find-or-create、decimal 進出 |
| `server/routers/customOrderStateMachine.test.ts` | canTransition 全表、非法轉移擋掉、needsQuote 分支、跨越式合法跳轉 |
| `server/routers/adminCustomerOrders.test.ts` | 三送出動作 confirm gate(缺 confirm/缺 PDF → reject)、recordPayment 設時間戳 + 推狀態、**supplierCost 不出現在 listForCustomer 給客人面的欄位**、audit 有寫 |
| `server/email/customOrderEmail.test.ts` | 語言挑選、**信內無破折號、無 supplierCost/成本字眼**、幣別符號、金額格式 |
| `server/routers/adminCustomersDocs.test.ts`(擴) | customOrderDocs:confirmation/quote kind 正規化、id 命名空間不撞 |
| `server/_core/paymentProvider.test.ts` | ManualProvider 回 null;getPaymentProvider 本批回 Manual;介面形狀 |

i18n parity:新增 key 兩檔都加,跑既有 i18n parity 測試確認無漏。

碰錢/法律的紅線(supplierCost 不外洩、信無破折號、Trust 時間戳≠認列、confirm gate)在 commit 前另跑 adversarial review(packgo-code-reviewer)。

---

## 七、模組劃分 (給 Stage 3 拆 tasks/)

| 模組 | 檔案 | 依賴 |
|------|------|------|
| M1 schema + migration | drizzle/schema.ts、0099_custom_orders.sql、_journal.json、server/db/customOrder.ts | 無(先做) |
| M2 state machine | server/routers/customOrderStateMachine.ts(純函式) | 無(可與 M1 並行) |
| M3 router + 金流 seam | server/routers/adminCustomerOrders.ts、server/_core/paymentProvider.ts、routers.ts 註冊 | M1, M2 |
| M4 email templates | server/email/templates/customOrder.ts、templates/types.ts | M1 |
| M5 客戶頁 UI | CustomOrderSheet.tsx、CustomerDetail.tsx 接線、DetailTabs OrdersTab、i18n 兩檔 | M3 |
| M6 文件整合 | adminCustomersDocs.ts(+test 擴)、client types.ts、i18n docKind | M1, M5 |

依賴:M1/M2 先 → M3/M4 → M5/M6。M3 與 M4 可並行;M5 與 M6 可並行。

---

## 八、非目標(這批不做,延續 proposal §七)

- 真 Square 串接(本批只抽介面 + 手貼連結;決策 D)。
- 自動對帳 / Trust 分錄 / 認列→accountingEntries(只存 recognizedAt 佔位)。
- 自動產生報價/確認書內容(系統只引用 Jeff skill 出的 PDF)。
- 套裝 bookings 流程改動(只留 nullable bookingId 橋接)。
- Square webhook 收款回拋(日後 mirror stripeWebhookEvents)。

---

## 九、Stage 4 開工前(待 Jeff 點頭)

本份設計需 Jeff 點頭(CLAUDE.md §9.1:Stage 1-3 跑完才進 Stage 4)。點頭後:
1. 產 Stage 3:`tasks/module-1..6.md` + `progress.md`。
2. 依模組寫 code(tsc 0 err、每模組 vitest、i18n parity、green 即 commit)。
3. 碰錢/法律紅線跑 adversarial review 再 commit。
4. 部署只能 `pnpm ship`(Jeff 親自跑;Claude 不碰 flyctl,CLAUDE.md §4.3)。

## 十、Stage 4 實作 + adversarial review 修正(2026-06-21)

實作完成,tsc 0 err、110 vitest green、i18n parity。7 維度並行對抗式 review 跑完
(0 P0),確認的 P1/P2 + 紅線 nit 全修,主要 schema/邏輯調整:

- **(P1)recordPayment 不再覆蓋應收欄**:新增 `depositPaidAmount` / `balancePaidAmount`
  兩欄(已收金額),與 `depositAmount`/`balanceAmount`(契約應收價,決策 A)分開存。
  錢的真相與應收價不共用欄位。`received` 顯示改讀 *PaidAmount。
- **(P1)sendCollection 加付款連結前置**:無連結不寄(信會說「用下面連結付」,不能無連結)。
- **(P1)sendQuote 加 assertNotTerminal**:cancelled/completed 單不寄報價信。
- **(P2)三送出動作 audit 先於 DB 寫入**:寄信後 DB blip 仍留稽核軌跡。
- **(P2)sendConfirmation re-send 修正**:departed/confirmed 可重寄(不撞非法轉移);
  draft/quoted 仍擋(須先 arrange/收款)。
- **(P2)recordPayment 日期 UTC off-by-one**:前端用 local 日期 + local noon 解析 paidAt。
- **(P2)swallowed error 記 log**:createPaymentLink / createOrderInvoice 失敗寫 console.warn。
- **(nit)** 幣別符號大小寫正規化;updateStatus 同狀態 no-op 不寫稽核;`needEmail` badge
  `rounded`→`rounded-md`(§2.1);`invoices.customOrderId` 加 index;移除 dead code
  `arrangedTargetForCreate`(arranged 經 updateStatus / 收款推進可達,不需該 helper)。
- 跳過(純 taste,Jeff 可定):確認信 departureDate 顯示維持 ISO `YYYY-MM-DD`。
