# Backlog — Plaid 交易描述「千篇一律」(診斷完成,等 Jeff 拍板修法)

> 2026-06-12 Jeff 提問:「bofa 都寫得清清楚楚是買了什麼,但 plaid 顯示都千篇一律」。
> 診斷完成,Jeff 拍板「先不修,記 backlog」。

## 診斷(prod 真實資料驗證,非推測)

**不是系統 bug,是 BofA-via-Plaid 的資料源限制。**

prod 撈樣本對比(789 筆 Plaid / 多筆 CSV):
- CSV 來源(Jeff 上傳 BofA 對賬單):`Zelle payment to US LION TRAVEL for "Taiwan7days6night"; Conf# m8dyeux27` → 分類 cogs_tour ✅
- Plaid 來源(API 直連):`PURCHASE`×55、`MAIL/TELEPHONE ORDER`×30、`CLIPPER TRANSIT FARE`×45 → 泛詞,卡 other_review

**根因**:BofA 透過 Plaid 回傳時剝掉 Zelle memo / Conf# / payee / reason。驗證:
- Plaid 789 筆 `originalDescription` 填充率 = 0(全 null)
- `paymentMeta` 物件非 null 但內部 payee/payer/reason/reference_number 全 null
- 不是 plaidSyncService.ts 漏抓(它有抓 originalDescription/paymentMeta,行 99-115)— 是 BofA 端不回

**對 PACK&GO 衝擊大**:業務重度依賴 Zelle memo 判斷(收客款 vs 簽證成本 vs 退款);Plaid 剝掉後帳本看不出買什麼 + AccountingAgent 失去最強信號(accountingAgent.ts:251 系統提示明寫「Bank raw line / payment_meta reason 是最強信號」)。

## 修法選項(Jeff 未選,等拍板)

1. **兩條都留,CSV 覆蓋 Plaid(原推薦)**:Plaid 自動抓現金流 + 定期上傳 BofA CSV,系統做「Plaid↔CSV 去重 + CSV 描述優先覆蓋」。兼顧自動化(PACK&GO 核心原則)+ 描述完整。需開發去重邏輯(match by date+amount+account,CSV 的 description/merchantName 覆蓋 Plaid 泛詞)。
2. **CSV 為主,Plaid 降輔**:BofA CSV 當正本,Plaid 只即時參考不進正式帳。最可靠但 Jeff 要養成定期下載習慣(違反自動化優先)。
3. **先標記**:帳本把 Plaid 泛詞交易(description IN 黑名單 PURCHASE/MAIL ORDER/... 或 merchantName==description 且全大寫)標「描述不足,需補」,Jeff 看到再手動補。最小改動止血。

## 關聯檔案
- server/services/plaidSyncService.ts(sync,欄位映射齊全)
- server/services/bankCsvImportService.ts + server/routers/plaidRouter.ts:614(CSV import)
- drizzle/schema.ts:2782(bankTransactions;有 originalDescription/paymentMeta/paymentChannel 欄位待用)
- client/src/components/admin-v2/BankLedgerV2.tsx:416(UI 只顯 merchantName+description,沒曝露 originalDescription/channel/PFC)
- server/agents/autonomous/accountingAgent.ts:251(分類靠 raw line / memo,Plaid 缺料時降信心)

## 追問:為什麼 QuickBooks 拿得到完整描述?(2026-06-12 查證)

**不是 QuickBooks 有特權直連 — 連它的 BofA Direct Connect 都停了**(web 查證:
BofA no longer supports Direct Connect,連 Intuit 都沒有 2-way 直連)。

QB 看到完整 Zelle memo 只可能來自兩條管道,都不是 Plaid:
1. **最可能 — Web Connect**:從 BofA 網銀下載 .QBO/.QFX 檔匯進 QB。檔案 BofA 端
   產生,保留完整 raw descriptor。**= 等同我們系統的 CSV import 路徑**(prod 驗證
   CSV 那批描述完整,如本文上方)。
2. **也可能 — Intuit 自家 aggregation(Finicity,2020 Intuit 收購)**:對 BofA 的
   資料協議與 Plaid 不同,可能拿到較完整 descriptor。未當場查證 QB feed 具體用哪個。

**結論修正**:差異不在「QB vs 我們」,在「BofA 端檔案/特殊協議(完整)vs Plaid 受限
API(泛詞)」。我們的 CSV 路徑已與 QB 等價完整 → **不需為描述完整換 QuickBooks**。
修法選項不變(見上),只排除了「QB 比較強」這個誤判。
來源:quickbooks.intuit.com community(BofA Direct Connect 停用)+
bankofamerica.com/online-banking FAQ(Web Connect vs Direct Connect)。

## 順帶觀察(非本題)
- CSV 那批分類也不全對:「Zelle to Ann for China visa」→ other_review、「Zelle from LARRY for China VISA」→ income_booking。memo 有料但 Agent 沒穩定吃到方向(to=支出 / from=收入)。修 Plaid 描述時可一併看分類 prompt。
