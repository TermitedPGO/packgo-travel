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

## 順帶觀察(非本題)
- CSV 那批分類也不全對:「Zelle to Ann for China visa」→ other_review、「Zelle from LARRY for China VISA」→ income_booking。memo 有料但 Agent 沒穩定吃到方向(to=支出 / from=收入)。修 Plaid 描述時可一併看分類 prompt。
