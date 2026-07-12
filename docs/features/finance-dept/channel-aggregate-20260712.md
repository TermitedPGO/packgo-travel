# 五通道財務盤點（去識別聚合）2026-07-12

> 目的：Stripe / Square / Zelle / Venmo / PayPal 五個收款通道在同一起訖期間的去識別聚合盤點，
> 供決定共同帳本接入序，並作為信託事件重建的通道範圍證據。
> 模式：全程 prod 唯讀 `SELECT`，零寫入。本檔去識別——只有通道 / 筆數 / 金額 / 退款 / 爭議 /
> 撥款 / 已配對 / 未配對 / 涵蓋率，無客人姓名、信箱、單筆交易明細。
> 對接文件：`evidence-preservation-manifest-20260711.md`（同源快照的完整表列與 SHA256）、
> `trust-drift-audit-20260711.md`（信託三筆遞延的逐筆歸因）、`finance-page-checkup-20260711.md`。

---

## 0. 一句話結論

DB 側只有一個通道有實質收款交易資料——**BofA 銀行流水（bankTransactions，經 Plaid）**，
它捕捉的是「錢落地」而非「通道原生交易」。五個處理商平台（Stripe / Square / Venmo / PayPal
的 merchant 帳，以及 Zelle 的原生紀錄）在 DB 幾乎沒有第一手資料：`payments`、
`stripeWebhookEvents`、`accountingEntries` 全表 0 筆。因此**本盤點基於 DB 側（銀行流水 + 訂單表），
處理商側缺口需 Jeff 平台導出補齊正本**。銀行流水裡以關鍵字可歸因到五通道的進帳只佔 29.1%
金額（204/400 筆），其餘 71% 是支票 / 手機拍存 / 電匯 / 內部轉帳 / 未標——換言之，五通道的框架
本身漏掉了實際收款的一大半。

---

## 1. 方法（資料來源、期間、查詢方式、去識別）

### 1.1 查詢方式（唯讀零寫入）

- 通道：`flyctl ssh console -a packgo-travel`（app **v811**、region sjc）進容器，`NODE_PATH=/app/node_modules node` 跑 `mysql2/promise.createConnection(DATABASE_URL)`。
- 全程僅 `SELECT`（`COUNT` / `SUM` / `GROUP BY` / `LEFT JOIN`），**零寫入、零 DDL**。單一連線、批次聚合、分兩次打點（節制機器負載）。
- 探針原文（off-git，scratchpad 暫存，node --check 0 err）：`channel-probe.cjs`（表列計數 + 通道關鍵字歸因 + 涵蓋率）、`channel-probe2.cjs`（退款 / 爭議 / 撥款關鍵字 + counterpartyType / agentCategory 分佈）。
- 去識別：只輸出聚合計數與金額，探針不 SELECT 任何客人姓名 / 信箱 / 單筆明細；本報告不含任何個資。帳戶一律以角色（Trust / Operating / 信用卡）稱呼，不列帳號末四碼。

### 1.2 五通道的資料落點（先探清楚每個通道的資料落在 DB 哪）

| 通道 | DB 第一手落點 | 銀行側（BofA×Plaid）落點 | DB 現況 |
|------|--------------|--------------------------|---------|
| **Stripe** | `payments.paymentMethod='stripe'`、`stripeWebhookEvents`、`accountingEntries.category='stripe_fee'`、`bankTransactionLinks.categoryCode='stripe_payout'`、`customOrders.paymentMethod` | 撥款落地會進 `bankTransactions`（memo 含 Stripe） | **三處全 0；銀行流水亦 0 個 stripe 關鍵字** → DB 完全無 Stripe |
| **Square** | `customOrders.paymentMethod='square'`（schema `payments` enum 無 square，Square 無第一手表） | 撥款 / 交易落地進 `bankTransactions`（memo 含 Square） | 訂單側 2 筆 tag；銀行側 23 筆 |
| **Zelle** | 無專表（Zelle 是銀行內建轉帳，非獨立處理商） | `bankTransactions.originalDescription` / `paymentMeta.reason` / `paymentChannel` | 銀行側 423 筆——DB 唯一有量的通道 |
| **Venmo** | 無專表 | `bankTransactions`（memo 含 Venmo） | **銀行側 0 筆關鍵字** → DB 無 Venmo |
| **PayPal** | `payments.paymentMethod='paypal'`（enum 有，但 0 筆）、`customOrders.paymentMethod` | `bankTransactions`（memo 含 PayPal） | 訂單側 0；銀行側僅 6 筆小額出帳 |

要點：五通道中，**只有 Zelle 與 Square 在 DB 有可盤的交易列**，且都只在「銀行落地」這一側；
Stripe / Venmo 在 DB 完全查不到；PayPal 僅有零星出帳。所有處理商原生的 gross / fee / refund /
dispute / payout 明細都不在 DB。

### 1.3 統一期間（不為方便截短）

- 取信託三筆遞延最早存入日（2026-04-13）與掃款 / 受影響交易期間，回溯至銀行流水最早一筆，涵蓋至今天。
- **盤點窗口：2025-01-01 → 2026-07-12（查詢上界 exclusive 2026-07-13）**，五通道同期。
- 實際資料最早 `bankTransactions` = 2025-01-14，最晚 = 2026-07-12。信託帳 #5442 交易窗口 2026-01-23 → 2026-06-27。窗口已完整覆蓋 `trust-drift-audit` 所述全部疑似掃款與受影響交易期間。

### 1.4 關鍵字歸因法與其限制（誠實標明）

- `bankTransactions` 以 `LOWER(CONCAT_WS(' ', merchantName, description, originalDescription, counterparty, paymentChannel, CAST(paymentMeta AS CHAR)))` 組 blob，對每個通道字串做 `LIKE`。
- 限制一：memo 為自由文字，Zelle / 電匯備註靠 Jeff 在 BofA 手打，**漏標即漏抓**（低估），非通道無交易即為 0。
- 限制二：桶與桶「非互斥」，同一列 blob 可同時命中多個關鍵字（如 transfer 內部掃款 vs zelle）。但實測五通道的**進帳**列無重疊（square 17 + zelle 187 = 涵蓋率 204，分毫對上），故五通道進帳歸因不重複計。
- 限制三：金額 sign 沿用 Plaid（負=進帳/收款，正=出帳）。本報告一律轉正號呈現。

---

## 2. 處理商 / 訂單側 DB 表列計數（2026-07-12 現值）

| 表 | 筆數 | 備註 |
|----|-----:|------|
| `payments` | **0** | 無任何 booking 付款列（含 stripe / paypal） |
| `stripeWebhookEvents` | **0** | Stripe webhook 從未落列 |
| `accountingEntries` | **0** | 無任何分錄（含 stripe_fee / bank_fee） |
| `checkoutDisclosures` | **0** | 無結帳前揭露列 |
| `invoices` | 1 | 唯一一張，狀態 cancelled，$100 |
| `customOrders` | 11 | 2026-07-01 → 07-07；paymentMethod：null×9（totalPrice 合 $38,638.03）、**square×2**（已收訂 $490＋尾 $490、契約價合 $1,270）；狀態 draft×9 / deposit_paid×1 / completed×1 |
| `trustDeferredIncome` | 3 | $15,422，**全 unmatched**、0 認列 / 0 撤銷 / 0 轉出、bookingId 全 NULL |
| `bankTransactionLinks` | 16 | **全 targetType=category、categoryCode=small_inflow**、合 $433.86、auto:small_inflow/system。**0 筆連到 custom_order / invoice / booking** |

> 與昨日 legal-hold 快照一致（payments / accountingEntries / stripeWebhookEvents 皆 0）。
> 唯一「已配對」機制（bankTransactionLinks）只自動 tag 了 16 筆微額進帳為 small_inflow，
> **無任何一筆銀行進帳被配對到訂單**。

---

## 3. 銀行側總覽（bankTransactions，4 帳戶）

- 全表 **1528 筆**，2025-01-14 → 2026-07-12（較 07-11 快照 1524 筆 +4，Plaid 增量同步；屬即時流水漂移）。
- 期間內：進帳 **400 筆 / $477,548.28**、出帳 1122 筆 / $503,166.89；pending 210、excluded 144。

| 帳戶（角色） | 筆數 | 進帳合計 | 出帳合計 | 窗口 |
|--------------|-----:|---------:|---------:|------|
| 30001 Operating 支票 | 728 | 382,806.46 | 384,017.30 | 2025-01-14 → 2026-07-12 |
| 30002 信用卡 | 617 | 26,780.77 | 38,586.92 | 2026-02-02 → 2026-07-11 |
| **30003 Trust #5442** | 40 | 63,971.20 | 63,297.20 | 2026-01-23 → 2026-06-27 |
| 30004 信用卡 | 143 | 3,989.85 | 17,265.47 | 2025-05-07 → 2026-07-02 |

進帳的 AI 收入分類（agentCategory，共 400 筆）：other_review 186 筆 /$240,500.54（未歸類，最大桶）、
income_booking 118 筆 /$95,874.21、transfer（內部轉帳，非營收）59 筆 /$105,222.46、null 24 筆 /$27,287.20、
refund 13 筆 /$8,663.87。counterpartyType='customer' 的進帳 124 筆（AI 判為客人款）。

---

## 4. 五通道聚合盤點（核心表，去識別）

期間 2025-01-01 → 2026-07-12，來源 `bankTransactions` 關鍵字歸因（收款＝進帳）。
「已配對到訂單」＝該通道命中列中連到 custom_order/invoice/booking 的筆數。

| 通道 | 命中筆數 | 進帳筆數 | 進帳 gross（收款） | 出帳筆數 | 出帳合計（付款/非收款） | fee | refund | dispute | payout | 已配對到訂單 | 未配對筆數 | 窗口 |
|------|-------:|-------:|-----------------:|-------:|----------------------:|-----|--------|---------|--------|-----------:|----------:|------|
| **Stripe** | 0 | 0 | 0.00 | 0 | 0.00 | DB 無 | DB 無 | DB 無 | 0 | 0 | 0 | — |
| **Square** | 23 | 17 | 17,786.82 | 6 | 6,447.09 | DB 無 | DB 無 | DB 無 | DB 無 | 0 | 23（全部） | 2025-04-28 → 2026-06-23 |
| **Zelle** | 423 | 187 | 121,174.03 | 236 | 224,866.22 | 不適用* | DB 無 | DB 無 | 不適用* | 2＊＊ | 421 | 2025-04-04 → 2026-07-10 |
| **Venmo** | 0 | 0 | 0.00 | 0 | 0.00 | DB 無 | DB 無 | DB 無 | DB 無 | 0 | 0 | — |
| **PayPal** | 6 | 0 | 0.00 | 6 | 183.98 | DB 無 | DB 無 | DB 無 | DB 無 | 0 | 6 | 2026-05-07 → 2026-06-15 |

\* Zelle 是銀行內建即時轉帳，無處理商 fee、無 payout（錢直接進 BofA），故 fee/payout「不適用」。
\*\* Zelle 那 2 筆「已配對」實為 bankTransactionLinks 的 auto small_inflow 類別 tag，**非**真正連到訂單；
嚴格看 Zelle 連到訂單者亦為 0。

補充（處理商概念的 DB 側證據，全帳關鍵字掃描，非分通道）：
- **refund**：banktx memo 含 refund 僅 1 筆進帳 $1,680（2026-03-16，係 PACK&GO 收到之退款，非退給客人）；counterpartyType='refund' 共 11 筆進帳；`payments.paymentStatus='refunded'` = 0。
- **dispute**：memo 含 dispute 10 筆（5 進 5 出各 $222.80，淨零，集中 2025-08-26，落在信用卡帳）；`checkoutDisclosures`（爭議存證用）= 0。
- **payout / chargeback / reversal**：memo 掃描全 0；`stripe_payout` link = 0。
- 換言之，**退款 / 爭議 / 撥款這三欄的正本都在處理商平台，DB 側幾乎為空**。

### 非五通道的收款（框架外，但屬受影響期間，必須揭露）

信託三筆客人訂金正是走「手機拍照存款」進來的，不在五通道內。銀行側同期：

| 落地形態 | 筆數 | 進帳合計 | 出帳合計 |
|----------|-----:|---------:|---------:|
| 手機拍存（mobile deposit，支票影像） | 29（全進帳） | **64,598.89** | 0.00 |
| 支票（check） | 52 | 20,888.55（12 筆） | 61,675.40（40 筆） |
| 電匯（wire） | 24 | 4,712.00（12 筆） | 180.00（12 筆） |
| 內部轉帳（transfer，含 Trust→Operating 掃款，非收款） | 92 | 107,568.20（38 筆） | 128,473.20（54 筆） |
| Cash App / Apple Pay / Google Pay | 0 | — | — |

---

## 5. 涵蓋率與未配對量

### 5.1 五通道對進帳的涵蓋率（DB 有 vs 平台才有）

- 期間進帳合計 **400 筆 / $477,548.28**。
- 可歸因到五通道之一者 **204 筆 / $138,960.85** → **筆數涵蓋 51.0%、金額涵蓋 29.1%**。
- 未歸因到五通道 **196 筆 / $338,587.43（70.9% 金額）**——即支票 / 手機拍存 / 電匯 / 內部轉帳 / 未標。
- 若剔除內部轉帳（$105,222.46，非真收款），五通道占「非轉帳進帳 $372,325.82」的 **37.3%**。
- 五通道進帳金額幾乎全由 **Zelle（$121,174，87%）+ Square（$17,787，13%）** 構成；Stripe / Venmo / PayPal 的收款貢獻為 **0**。

### 5.2 未配對量（配對到訂單者近乎全無）

- 全銀行進帳 400 筆，連到訂單（custom_order/invoice/booking）者 **0 筆**；唯一 16 筆 link 全是 small_inflow 類別 tag（$433.86）。
- 五通道命中的進帳列，**未配對到訂單 = 100%**。
- 信託三筆遞延 $15,422 亦 **全 unmatched**、bookingId 全 NULL。
- 結論：不論哪個通道，收款「已配對到訂單」在 DB 側實質為 **0**——共同帳本要解的第一個問題就是配對，不是接資料源。

### 5.3 各通道資料完整度（DB 側可盤 vs 需平台導出）

| 通道 | DB 側有什麼 | 缺什麼（只在平台 / 需 Jeff 導出） | DB 涵蓋度 |
|------|------------|-----------------------------------|-----------|
| Stripe | 完全空白 | gross / fee / refund / dispute / payout 全部，charges、checkout sessions | **0%** |
| Square | 銀行落地 17 進帳 + 2 訂單 tag | 逐筆 gross、手續費、退款、爭議、payout 明細 | 低（僅淨落地額） |
| Zelle | 銀行流水 187 進帳（$121k） | 官方 BofA 月結單為正本；漏標 memo、對應訂單 | 中高（金額流已在，配對缺） |
| Venmo | 完全空白 | 全部（若有使用） | **0%** |
| PayPal | 6 筆小額出帳 | 客人側收款、fee、refund | 極低 |

---

## 6. 結論與共同帳本接入序建議

### 6.1 哪些通道 DB 可直接盤 / 哪些必須等 Jeff 導出

- **DB 可直接盤（有資料）**：Zelle（銀行側 187 進帳）、Square（銀行側 17 進帳 + 2 訂單）。
- **必須等 Jeff 平台導出才完整**：
  - **Stripe** — DB 三處全 0，任何 Stripe 活動只存在 Stripe 平台；需導出 charges / payouts / disputes / fees（並確認 checkout 這條 coded rail 究竟有沒有被用過）。
  - **Venmo** — DB 0，需 Jeff 確認是否有在用；若有，導出交易史。
  - **PayPal** — DB 僅零星出帳，客人側收款 / fee / refund 需平台導出。
  - **所有通道的 refund / dispute / fee / payout 正本** 一律在處理商平台；BofA 官方月結單為 Zelle / 支票 / 電匯的正本（見 legal-hold §6）。

### 6.2 建議接入序（按真實交易量 + 未配對風險 + API 可取得程度，非平行）

1. **Zelle（第一，量與風險都最大）** — 收款金額最大（$121k，占五通道 87%），未配對風險最高（187 進帳幾乎全未連訂單），且**資料已在**（BofA×Plaid 已接、bankTransactions 已同步）。此階段工作是「在既有資料上建配對 / 歸因規則」而非接新源。取捨：Zelle 無結構化處理商 API，倚賴 BofA 月結單 + memo 規則，人工成分高。
2. **Square（第二，API 乾淨、性價比最高）** — 第二大收款（$17.8k），Square REST API 完整（charges/refunds/disputes/payouts/fees），且已出現在 2 張訂單。可最快把「處理商→帳本」pipeline 自動化跑通，順帶把退款/爭議/撥款語義帶進帳本。（若團隊想先要一個乾淨的 API 熱身樣本再啃 Zelle memo，Square 可與 Zelle 對調為第一。）
3. **Stripe（第三，API 最強但目前 0 資料）** — webhook handler 已在 code（`stripeWebhook.ts`），自動化上限最高；但當期 DB 零資料。接入以「捕捉未來 + 核實是否真未使用 + 補回可能的歷史」為目的，封閉這條內建 checkout rail。
4. **PayPal（第四，量微）** — API 可取得，但當期收款貢獻 $0、僅 $184 出帳，低優先。
5. **Venmo（第五，先確認是否使用）** — DB 零足跡、商用 API 弱，建議先向 Jeff 確認有無在用再決定是否接。

### 6.3 明確缺口聲明

**本盤點基於 DB 側（BofA×Plaid 銀行流水 + customOrders / trustDeferredIncome / bankTransactionLinks 訂單與對帳表）。**
處理商側（Stripe / Square / Venmo / PayPal merchant 帳，以及 Zelle 的官方 BofA 月結單）的 gross、
手續費、退款、爭議、撥款正本**不在 DB，需 Jeff 平台導出補齊正本**。在補齊前，第 4 節五通道表的
fee / refund / dispute / payout 欄凡標「DB 無」者，一律不得當作「金額為 0」解讀，只能解讀為
「DB 側無此資料」。

---

## 7. 證據索引（evidence_reference）

- **查詢來源**：prod app `packgo-travel` v811（sjc），`flyctl ssh console` + `mysql2` 唯讀 SELECT，2026-07-12。
- **探針（off-git，scratchpad）**：`channel-probe.cjs`（本檔 §2 表列計數、§3 銀行總覽、§4 通道歸因、§5 涵蓋率）、`channel-probe2.cjs`（§4 退款/爭議/撥款關鍵字、§3 counterpartyType/agentCategory 分佈）。兩者 node --check 0 err、零寫入。
- **同源快照與逐筆佐證（含 SHA256）**：`evidence-preservation-manifest-20260711.md`（bankTransactions 1524 / trustDeferredIncome 3 / links 16 / payments 0 / stripeWebhookEvents 0 / accountingEntries 0 — 與本檔一致，僅銀行流水 +4 增量漂移）。
- **信託事件通道範圍**：`trust-drift-audit-20260711.md`（三筆客人訂金 $15,422 走手機拍存進 Trust #5442、再掃往 Operating；印證五通道框架外的「手機拍存」是信託事件主要落地形態）。
- **不確定標記**：關鍵字歸因會低估（漏標 memo）；「非五通道進帳 $338,587」中含內部轉帳 $105,222（非收款）；Zelle 出帳 $224,866 為 Jeff 對外付款（供應商等），非收款，不計入通道收款量。

---

*本檔為去識別聚合，無客人姓名 / 信箱 / 單筆交易明細，可進 git。敏感個資與完整快照留 off-git（見 evidence-preservation-manifest §資料位置）。*
