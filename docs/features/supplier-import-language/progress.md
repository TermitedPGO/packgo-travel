# Progress · 供應商匯入語言

> feature: `supplier-import-language` | 監工看這份
> 最後更新 2026-08-04 · 狀態:**Stage 1-3 完成並已提交。未部署、未重抓,線上行為零變化。**

## 一句話

站上部分行程是英文原文,因為我們從第一次串接就跟縱橫要英文版,而匯入是零 LLM 純轉換,供應商的字原封落地。改請求語言為繁中即可,縱橫的繁中已實測完整。

## 階段狀態

| 階段 | 產出 | 狀態 |
|---|---|---|
| Stage 1 需求 | `proposal.md` | ✅ 完成 2026-08-04 |
| Stage 2 設計 | `design.md` | ✅ 完成 2026-08-04 |
| Stage 3 施工 | `tasks/M1-M3` | ✅ 完成 2026-08-04 |
| 驗證 | tsc 0 錯 + 影響範圍 262 綠 | ✅ 見下方「驗證紀錄」 |
| commit | 分支 `claude/website-current-progress-lhvl3o` | ✅ 已提交已推送 |
| 部署 | `pnpm ship`(Jeff token) | ⬜ **未部署** |
| 正式資料重抓 | `catalogRebuild`(另議) | ⬜ 不在本 feature 範圍 |

## 模組

| 模組 | 檔案 | 狀態 | 實際做法 |
|---|---|---|---|
| M1 語言設定源 | `server/_core/featureFlags.ts` | ✅ | `uvImportLanguage()` + `UvLanguage` 型別。`num` 由 `code` 衍生(`Number(code)`),不各自手打,結構上不可能分家 |
| M2 請求層接線 | `server/suppliers/uvClient.ts` | ✅ | `COMMON_HEADERS` 常數 → `commonHeaders(lang)` 函式;**語言改由 `callSoa` 統一注入 header 與 body**,三個呼叫點不再各自帶 `productLanguage`(比原設計更強:呼叫點想帶也帶不進去) |
| M3 測試 | `uvClient.lang.test.ts`(新)+ `featureFlags.test.ts`(增段) | ✅ | 39 條;含反向驗證 |

### M2 實作與設計的差異(誠實記錄)

design.md 原本寫「三個 body 的 `productLanguage` 改讀同一次 `uvImportLanguage()`」。實作時改為**由 `callSoa` 注入,且置於 `...body` 之後**,呼叫點完全不碰語言。

理由:原設計仍依賴三個呼叫點各自正確引用同一個來源,是「靠自律」;現行做法讓語言成為傳輸層屬性,呼叫點在結構上沒有機會弄錯,新增端點也自動正確。代價是單次呼叫無法指定語言 —— 目前無此需求,若日後需要應加明確 opts 參數,不從 body 偷渡(已寫進 `callSoa` JSDoc)。

## 驗證紀錄

| 項目 | 結果 |
|---|---|
| `tsc --noEmit` | **0 錯**(`NODE_OPTIONS=--max-old-space-size=6144`) |
| 新增測試 | 39 綠(featureFlags 24 + uvClient.lang 15) |
| 影響範圍測試 | **262 綠 / 19 檔**:`supplierSync/`、`checkoutVerification/`、`catalogRebuild/`、`featureFlags`、`stripeWebhook`、`suppliers/` |
| 成本價紅線回歸 | `catalogRebuild/retailOnlyEndpoints.regression.test.ts` 5 綠(語言改動未鬆動 `assertRetailOnly`) |
| 反向驗證(真鎖確認) | 把 M1 預設值暫改 `en` → **11 條失敗**;還原 → 39 綠。證明測試鎖的是語義,不是恆真式 |
| 循環依賴檢查 | `featureFlags.ts` 零 `import`,uvClient 只出現在註解,非相依 |
| 殘留檢查 | `grep "productLanguage: 3\|languageCode: \"3\"" uvClient.ts` → 無;`COMMON_HEADERS` → 已移除 |

全套 `vitest run` 在本容器逾 10 分鐘上限被切斷,故以「影響範圍 19 檔」代替。全套綠與否屬 `pnpm ship` 第 ⑥ 道門的職責,部署前由該閘把關。

## 生效條件(全部未達成,務必不要誤讀成「已修好」)

改語言只影響**之後抓的**內容。既有 `tours` 列不會自己變繁中。實際讓客人看到繁中,還需要:

1. 部署(`pnpm ship`,Jeff token)
2. `catalogRebuild` 以 `dryRun` + 小 `limit` 試跑,確認取回繁中
3. 抽驗數團 `tours.description` / `dailyItinerary` 為繁體、無英文殘留、無簡體
4. 放大批次 → `promote`(有快照可回滾)

第 2-4 步動正式資料,需 Jeff 放行,不在本 feature 範圍。

## 已握有的證據(Stage 1 產出,非推論)

### 根因三段,皆第一手

1. `server/suppliers/uvClient.ts` L49 / L165 / L204 / L221 四處語言寫死 `3`(英文)。L49 原註解:「UV storefront defaults to English」。
2. `server/services/supplierSync/hydration.ts` 檔頭:「Zero LLM cost — pure transformation」。供應商的字直接進 `tours` 對客欄位。
3. `drizzle/schema.ts` L1643:`translations.sourceLanguage` 預設 `"zh-TW"`。系統設計本就假設 tours 存中文,英文是翻出去的目標語 —— 我們把方向做反了。

### 縱橫繁中實測(Jeff 本機,2026-08-04,只讀)

`node scripts/uv-lang-compare.mjs --count=10`

```
名錄共 1155 個產品,本次取 10 個
可比欄位總數      46
繁中要到中文      93.5%  (43 欄)
仍是英文          0%     (0 欄)
中英混排          6.5%   (3 欄)
空白              0%
簡體字命中        0 欄
繁體字命中        46 欄
```

反例檢查(en 與 zh-TW 逐團逐區塊欄位數比對):**0 / 10 團不一致**。團名、逐日行程、費用包含、注意事項全部一比一。原先「中文版少回傳欄位導致分數虛高」的疑慮排除。

evidence_reference:Jeff 終端輸出(2026-08-04);工具 `scripts/uv-lang-compare.mjs`(commit f764f6c、8857b14);原始資料 `uv-lang-compare-out/uv-lang-compare.json`(Jeff 本機,未進 repo)。

## 觀察(不在本批範圍,列入後續)

- 本次 10 團有 9 團逐日行程僅 1 天,且 en / zh 皆同 —— 非語言問題。高號段新產品(P00008819~P00008866)可能含非旅遊商品,與 2026-06-13 稽核 B 桶(留學生套餐 / Notary / 機票代訂 / 門票)一致。由完整度閘與 `isHiddenByAdmin` 處理。
- 抽樣 10 團不足以代表 1,155 產品。放行前應以 `catalogRebuild` dryRun 較大批複驗,不以本次結論當全量事實。

## 明確不做

- 正式資料重抓 / promote(需部署 + Jeff 放行,走 `catalogRebuild` 既有路徑)
- Lion(來源本就中文;`catalogRebuild` Lion 路徑因 NormGroupID 橋接未解而 gated)
- 照片版權(Jeff 2026-08-04 明示先不管)
- 線上收款 / IOLTA(Jeff 2026-08-04 明示先不管;付款維持 fail-closed)
- 英文站改用供應商原生英文(需 `supplierProductDetails` 帶語言維度 = schema 變更,列 Phase 2)

## 狀態語言

本檔任何「完成」僅指該格所述之事已提交,不等於已合併 / 已部署 / 已生效。實際生效需:部署 + `catalogRebuild` 重抓 + promote,三者皆未執行。
