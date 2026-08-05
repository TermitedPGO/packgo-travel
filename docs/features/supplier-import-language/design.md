# Stage 2 · 設計:供應商匯入語言

> feature: `supplier-import-language` | 前置:`proposal.md` | 開立 2026-08-04

## 1. 設計原則

**只改最上游一個點,下游全部不動。**

語言是「跟供應商要什麼」的問題,不是「拿到之後怎麼處理」的問題。`uvDetail.ts` 的解析、`hydration.ts` 的轉換、`catalogRebuild` 的 staging / promote 都與語言無關 —— 它們處理的是結構,不是語意。所以正確的改法是把語言收斂到請求層一個設定源,下游一行都不碰。

反面設計(明確拒絕):在 `hydration` 或 `staging` 加翻譯步驟。那是在下游補上游的洞,會引入 LLM 成本、翻譯腔,而且供應商原本就有現成的官方繁中。

## 2. 資料流(改動前後對照)

```
                    ┌─ 語言在此決定 ─┐
                    ↓                 ↓
  uvClient.ts ──→ SOA2 API ──→ 原始 JSON
      │                              │
      │ (改動點:僅此一處)            ↓
      │                       uvDetail.ts  解析(結構,與語言無關)
      │                              ↓
      │                    supplierProductDetails  *Parsed 欄位
      │                              ↓
      │                       hydration.ts  純轉換,零 LLM ← 供應商的字原封落地
      │                              ↓
      │                    catalogRebuild/staging.ts  組對客 fields
      │                              ↓  assertRetailOnly ①
      │                       完整度閘 completeness.ts
      │                              ↓
      │                    catalogRebuild/promote.ts  原子換批 + 快照
      │                              ↓  assertRetailOnly ②
      └───────────────────────→  tours(對客)
```

改動前:語言 = `3`(英文)→ tours 存英文 → 與 `translations.sourceLanguage="zh-TW"` 方向相反。

改動後:語言 = `zh-TW`(預設)→ tours 存繁中 → 英文由 `translations` 管線輸出,方向一致。

`assertRetailOnly` 兩道出口不受本批影響,但屬回歸範圍(語言改動不得鬆動成本價紅線)。

## 3. 模組劃分

| 模組 | 檔案 | 動作 | 預估行數 |
|---|---|---|---|
| M1 語言設定源 | `server/_core/featureFlags.ts` | 新增 `uvImportLanguage()`,回傳正規化語言碼 | +35 |
| M2 請求層接線 | `server/suppliers/uvClient.ts` | 四個寫死點改讀 M1;header 與 body 同源 | ~15 修改 |
| M3 測試 | `server/suppliers/uvClient.lang.test.ts`、`server/_core/featureFlags.test.ts`(增段) | 預設 / 覆寫 / 非法值 / header-body 一致 | +90 |

總計約 140 行(新增 + 修改),超過 30 行門檻,故走完整 feature 流程。

### M1 為何放 featureFlags.ts

`featureFlags.ts` 檔頭明訂:「Add new flags here, never inline `process.env.*_ENABLED === "true"` at call sites」,理由是拼錯環境變數名會靜默 false、悄悄關掉安全閘。同一理由適用於語言:拼錯就靜默退回英文,正是本次要根除的失敗模式。

該檔已有非布林設定的先例(`trustRecognitionOffsetDays`、`trustAutomatchMinConfidence`),所以放這裡符合既有結構,不是硬塞。

該檔另載明:flag 於 boot 讀取、無快取、改動需重新部署,不會 mid-run 翻轉。這正是我們要的語義 —— 語言不該在一次 sync 跑到一半時改變。

## 4. 介面設計

### 環境變數

```
UV_IMPORT_LANGUAGE = zh-TW | zh-CN | en     (預設 zh-TW)
```

用可讀語言標籤而非 UV 的數字碼(`1` / `2` / `3`),理由:數字碼是供應商內部約定,寫在 Fly secret 裡沒有人看得懂,且與我們自己 i18n 的 `zh-TW` / `en` 命名衝突。數字碼的對映收在 M1 內部。

### 函式契約

```ts
uvImportLanguage(): { code: "1"|"2"|"3"; num: 1|2|3; tag: "zh-CN"|"zh-TW"|"en"; acceptLanguage: string }
```

回傳結構而非單一值,因為呼叫點需要三種形式:header 的 `languageCode`(字串)、body 的 `productLanguage`(數字)、HTTP `Accept-Language`。**由同一個函式一次給齊,是 header 與 body 不可能不一致的結構性保證**,不靠呼叫點自律。

### 非法值處理(關鍵決策)

未設 / 空字串 / 拼錯 / 不支援的語言 → 一律退回預設 `zh-TW`,不退回英文、不拋錯。

理由:
- 退回英文 = 重蹈覆轍,而且是靜默的。
- 拋錯 = 一個環境變數打錯就讓整條 sync 掛掉,對只影響顯示語言的設定過當。
- 退回預設繁中 = 失敗時落在「我們要的語言」而非「我們不要的語言」,方向安全。

大小寫與前後空白正規化(`zh-tw`、` zh-TW ` 皆可),因為 Fly secret 是手打的。

## 5. 已知後續(非本批,不在此實作)

### 5.1 英文站的內容來源

`tours` 轉繁中後,英文版由既有 `translations` 管線(LLM)產出。但 UV 同時供應官方英文 —— 未來可抓兩語言,用供應商原生英文取代 LLM 英譯,兩邊都是官方文案。

不在本批的理由:需要 `supplierProductDetails` 帶語言維度(目前無語言欄),等於 schema 變更,規模與風險都跳一級。列為 Phase 2。

### 5.2 Lion(雄獅)

Lion 是 TWD 台灣線、來源本就中文,無此問題。且 `catalogRebuild` 的 Lion 路徑因 NormGroupID 橋接未解而 gated。本批不動。

### 5.3 既有列的內容置換

改語言只影響「之後抓的」。既有 `tours` 列要變繁中,必須跑 `catalogRebuild`。該模組已具備 batch / staging / 完整度閘 / 原子 promote / 快照回滾 / dryRun / limit,且檔頭明訂「預設不自己跑,由 admin mutation 手動觸發,promote 前一定先跟 Jeff 確認」。

放行順序建議:`dryRun` 小 `limit` → 看 `RebuildReport` → 抽驗繁中 → 放大批次 → promote(有快照可退)。

## 6. 測試策略

| 測項 | 為什麼要測 |
|---|---|
| 未設環境變數 → `zh-TW` | 預設值就是本 feature 的主要交付物 |
| 三個合法值各自正確對映 UV 數字碼 | 對映錯 = 拿到別的語言,且不會報錯 |
| 大小寫 / 空白正規化 | Fly secret 手打 |
| 非法值 → 退回 `zh-TW` 而非 `en` | 這條是本 feature 的核心語義,退回英文即失敗 |
| header `languageCode` === body `productLanguage` | 兩者不一致正是「語言沒傳到底」的形狀 |
| 四個呼叫點都帶到語言,無殘留字面量 | 漏一個就是漏一種內容(例:名錄中文但明細英文) |

`uvClient.ts` 的呼叫點測試用 stub `fetch` 攔請求檢查 header 與 body,不打真實 API(測試禁止依賴外部網路,亦禁止插真實資料進 DB)。

## 7. 驗證工具(前批已交付,本批複用)

`scripts/uv-lang-compare.mjs` —— 同一批團各抓一次英文與繁中,逐欄位並排,量測「實際拿到什麼」而非「要了什麼」,並偵測簡繁。

本批不修改該腳本。部署後可用它對 prod 實際生效的語言做事後複驗。

## 8. 紅線對照

| 紅線 | 本批影響 | 處置 |
|---|---|---|
| 1 部署只能 `pnpm ship` | 無 | 本批不部署,交付 code |
| 2 成本價不上客面 | 間接 | `assertRetailOnly` 兩道出口不動,列回歸 |
| 6 圓角 / 設計 | 無 | 純後端 |
| 7 i18n 禁硬編碼中文 | 無 | 無 JSX 改動 |
| 9 正式 DB | 無 | 本批不碰正式資料;重抓另議 |
