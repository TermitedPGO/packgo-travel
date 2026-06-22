# 訂製單 (Custom Orders) — Stage 1 Proposal

> 狀態:Stage 1 草案,待 Jeff 補齊「待你拍板的決策」後進 Stage 2 設計。
> 緣起:客戶頁(/ops/customers)報價/催款/確認書三顆按鈕要能動,前提是訂製單得在系統裡有一筆真正的訂單。Jeff 拍板走「完整:訂製單做成系統真正一筆訂單,客戶頁當真相來源」。
> 日期:2026-06-21

---

## 一、問題 (Problem)

PACK&GO 的生意是訂製單(bespoke),不是套裝跟團。但系統目前沒有「訂製單」這個實體:

- 報價 散在 `aiQuotes`(且主要是公開表單自動產生的 funnel 紀錄;真正的客製報價是 Jeff 用 `packgo-quote` skill 離線出 PDF,DB 多半沒紀錄)。
- 收款 散在 `invoices`(有 `invoices.create` admin 能建,但沒有「寄 invoice」或產生付款連結;Square 連結是 Jeff 在 Square 後台手動建、手動貼)。
- 確認書 完全不存在 —— 系統唯一的確認信 `sendBookingConfirmationEmail` 綁死套裝 `bookings`(需 tourId/departureId),不適用訂製單。
- 沒有任何 `customOrders` / `orders` 表把「一筆訂製單」串起來。

結果:客戶頁的報價/催款/確認書按鈕沒有可驅動的資料;訂製單的真相只存在 Jeff 桌面的 PDF + Square 後台,跨裝置看不到、無法追蹤、無法自動提醒。

---

## 二、現況盤點 (Investigation,2026-06-21)

| 環節 | 現有 | 缺口 |
|------|------|------|
| 報價 | `aiQuotes`(drizzle/schema.ts:2327):quoteNumber, estimatedTotal, currency, pdfUrl, pdfHtml, customerEmail/userId, status[generated/sent/viewed/converted/expired], bookingId, validUntil。router:`generate`(public)、`adminList`、`adminMarkConverted` | 無 admin「為某客戶建/寄報價」;報價 PDF 仍離線靠 skill 產 |
| 收款 | `invoices`(schema.ts:2118):invoiceNumber, customerEmail/userId, bookingId/visaApplicationId, subtotal/taxAmount/totalAmount, currency, lineItems, status[draft/sent/paid/overdue/cancelled], dueDate, paidAt, sentAt, pdfUrl/pdfHtml。router:`create`、`list`、`get`、`updateStatus`、`delete`、`forBooking` | 無「寄 invoice」、無付款連結產生(Square/Stripe 連結手動貼,`toolsRouter.generateDeposit` 吃一個 `paymentLink` 字串) |
| 確認書 | 無 | 訂製單確認書完全沒有(table、template、寄送皆無) |
| 訂單實體 | 無 `customOrders`/`orders`;訂製單 = aiQuotes(+ 選擇性 invoices + 選擇性 bookings)散落 | 沒有單一「訂製單」實體把報價→收款→確認串起來 |
| 客戶頁已顯示 | `customerDocs` 已撈 aiQuotes(q:)、invoices(inv:)、flightOrders(fo:)、customerDocuments(cd:) | 只是唯讀清單,沒有「一筆訂單」的狀態機 |

---

## 三、錢與法遵(設計時絕不能違反)

訂製單碰錢碰法律,model 必須正確編碼以下既有鐵律(見 memory / CLAUDE.md):

- Trust account 規則(CA B&P §17550):訂金進 Trust #5442,**不是營收**;出發後才 recognize、才轉 Operating #2174。訂單 model 必須能分辨:訂金(Trust)/ 尾款 / 已收總額 / 出發日(觸發 recognition)。
- 兩本帳:Plaid `bankTransactions` = 權威 P&L;`accountingEntries` = 次要手動。訂製單收款要能對得上、不重複計。
- Square 是金流(手續費率表、退款不退手續費規則見 memory);目前付款連結手動。
- 客戶文件只放直客售價,絕不放供應商成本(David 案踩雷);訂單 model 區分售價 vs 成本(`bookings.supplierCost` 是手動填、絕不自動)。
- 報價/求證留人力:AI 只搬運不生成價格;報價 PDF 文案是 Jeff 的聲音。
- 退款全額 + goodwill 上限規則(見 memory)。

---

## 四、目標 (Goals)

1. 一筆訂製單 = 系統裡一個 order 記錄,串起 報價 → 收款(訂金/尾款)→ 確認 → (出發/recognition)。
2. 客戶頁是真相來源:Jeff 從客戶頁開單、看狀態、推進。
3. 三顆按鈕落在這個 model 上:
   - 報價:把(離線 skill 出的)報價 PDF 掛到訂單、寄給客人、狀態→已報價。
   - 催款:寄 invoice + 付款連結(Square),狀態→已寄款/已收訂金/已收全款。
   - 確認書:訂製單確認書(新做),狀態→已確認。
4. 與既有 `aiQuotes`/`invoices` 整合,不重造輪子(訂單引用 quote/invoice,不取代)。
5. 不破壞既有 Trust / 會計紅線。

---

## 五、提案 model(待 Stage 2 細化)

新增 `customOrders` 表(草案欄位):

- id, customerProfileId(訪客)/ userId(會員)— 沿用客戶頁身分解析
- orderNumber(e.g. ORD-2026-0001)
- title / destination(訂製行程名)
- status enum(報價為「可選」步驟,見下):
  - 有報價:`draft → quoted → arranged → deposit_paid → paid → confirmed → departed → completed / cancelled`
  - 不需報價(只安排行程):`draft → arranged → deposit_paid → paid → confirmed → ...`
  - 報價是 optional 分支,不是必經;核心路徑是 安排行程(itinerary)→ 收款 → 確認。
- quoteId(→ aiQuotes,引用報價 PDF;可為 null = 此單不需報價)
- depositAmount / balanceAmount / totalPrice / currency(售價,直客價)
- supplierCost(手動、絕不自動;算 margin 用)
- depositPaidAt / balancePaidAt / paymentMethod(Square)
- trustHeld(布林或金額:錢還在 Trust #5442)/ recognizedAt(出發後轉 Operating #2174)
- departureDate / returnDate
- confirmationPdfUrl / confirmedAt
- createdBy(admin)、createdAt / updatedAt

> 取捨點:是否新表,還是擴 `aiQuotes`(加 order 生命週期欄位)?草案傾向新 `customOrders` 表(乾淨的狀態機),quote/invoice 用外鍵引用。Stage 2 定。

backend(草案):`adminCustomerOrders` sub-router —
- `createOrder`、`listForCustomer`、`getOrder`、`updateStatus`
- `attachQuote(orderId, pdf)`、`sendQuote(orderId)`
- `createInvoice(orderId, lineItems)`、`sendInvoice(orderId, paymentLink)`
- `sendConfirmation(orderId)`(新確認書 template + email)
- `recognizeRevenue(orderId)`(出發後,Trust→Operating;接會計)

UI(草案):客戶頁三顆按鈕 → 開「訂單」對話框/抽屜;訂單列表 + 狀態時間軸;送出一律 Jeff 按。

---

## 六、已拍板的決策(Jeff,2026-06-21)

1. 訂金 / Trust:這系統**只記**「已收訂金 / 已收全款」金額與時間;實際 Trust #5442 對帳仍走銀行 / 會計(Plaid + accountingEntries),不在這系統管。→ order model 不做 Trust 分錄,只存 depositPaidAt / balancePaidAt / 已收金額。
2. 付款連結:**接 Square API 自動產生**付款連結(試)。→ 需 Square 整合(checkout / payment link API)。`催款` 寄出時帶系統產生的 Square 連結,不再手貼。
3. 確認書:用 **Jeff 既有 skill** 產(Jeff:「我應該有 skill」— Stage 2 確認是 packgo-quote 行程表 / packgo-deposit-receipt 還是別支);系統**引用 PDF**,不自己排版。
4. 報價:**引用 skill 出好的 PDF**(Jeff 上傳 / 貼 URL)+ **過 Jeff 同意才送**(confirm gate)。重點:**報價是可選的** —— 不需報價的單只要「安排行程」(itinerary),直接走 arranged → 確認,不經 quoted。
5. 與 `bookings` 關係:Stage 2 定;傾向 customOrders 獨立,bookings 留給套裝(訂製單不硬塞 tourId/departureId)。
6. 範圍:這批 = **order 表 + 報價/催款/確認三動作的「送 + 狀態機」**;recognition / 會計整合**留下一段**。

> 仍待 Stage 2 細問:訂金固定 % 還是每單自訂(#1 未明說);確認書用哪支 skill(#3);customOrders vs bookings(#5)。

> Stage 2 解決(2026-06-21,見 design.md §〇):
> - 訂金:預設 30% 可覆寫,schema 存絕對金額。
> - 確認書:不綁 skill,系統只引用 Jeff 上傳/貼的 PDF URL(packgo-quote 或 packgo-deposit-receipt 皆可)。
> - customOrders 獨立,留 nullable bookingId 備用。
> - **修正 §六.2**:Square 改為「先抽介面、暫不接真」(PaymentProvider seam + 手貼連結),真 Square 串接留下一段。§六.2「這批要做」以此為準被取代。

---

## 七、非目標(這批不做)

- 自動對帳 / Trust 分錄(Trust 對帳走銀行+會計,系統只記已收金額)。
- 自動產生報價內容/價格(報價留人力,系統只引用 skill 出的 PDF)。
- 自動產生確認書排版(用 Jeff 既有 skill,系統只引用 PDF)。
- recognition→會計分錄自動化(列下一階段,先記 recognizedAt)。
- 套裝 bookings 流程重構。

> 註:Square API 自動付款連結這批**要做**(從非目標移除,見 §六.2)。

---

## 八、為什麼先寫這份(不直接寫 code)

CLAUDE.md §9.1:feature ≥30 行先把意圖拆清楚才讓 AI 寫。這是碰錢+法遵(Trust §17550)的核心 model,model 設計錯了後面全錯、且是財務/法律風險。§9.7:大新 feature + 本 session 已很長 → 開新 session 用文件交接。所以:這份 proposal 鎖共識 → 新 session 跑 Stage 2 設計 → Stage 3 拆模組 → Stage 4 寫。
