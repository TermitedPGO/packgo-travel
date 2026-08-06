# M2 · 請求層接線

> 檔案:`server/suppliers/uvClient.ts` | 預估 ~15 行修改 | 相依:M1 必須先完成

## 目標

把 `uvClient.ts` 四個寫死語言的地方,全部改為讀 M1 的 `uvImportLanguage()`。header 與 body 同源,結構上不可能不一致。

## 輸入

四個寫死點(2026-08-04 盤點,行號以當時為準,施工前重新確認):

| 位置 | 現況 |
|---|---|
| L49 | `COMMON_HEADERS.languageCode: "3"` |
| L165 | `listProducts` → `productLanguage: 3` |
| L204 | `getProductMain` → `productLanguage: 3` |
| L221 | `getProductTravelDetail` → `productLanguage: 3` |

另 L56 `"Accept-Language": "en-US,en;q=0.9,zh-TW;q=0.8"` 也偏英文,一併改為隨語言切換。

## 輸出

四處(含 Accept-Language 共五處)語言相關值全部由 `uvImportLanguage()` 供給,檔內無殘留字面量 `3` 或 `"3"` 作為語言用途。

## 步驟

- [ ] 先 `grep -n "productLanguage\|languageCode\|Accept-Language" server/suppliers/uvClient.ts` 重新確認行號與數量,不信本文的行號。
- [ ] `COMMON_HEADERS` 目前是模組層級常數。改成函式 `commonHeaders()` 或在 `callSoa` 內組裝 —— 因為語言要在請求時決定,而不是模組載入時凍結。
  - 注意:`featureFlags.ts` 語義是 boot 時讀 `process.env`,無快取。改成函式即可,不需要另加快取。
- [ ] 三個 body 的 `productLanguage` 改讀同一次 `uvImportLanguage()` 的結果。
- [ ] `Accept-Language` 隨語言切換。
- [ ] 保留 L49 那段歷史註解的資訊價值:改寫為「UV 前台預設英文,我們曾照抄成 `3`,導致 tours 落英文原文;現由 `uvImportLanguage()` 供給,預設繁中」。歷史裁定不美化,但要讓下一個人看得懂為什麼改。
- [ ] Edit 大改後 Read 驗證(workflow.md §4 紅線)。

## 已預先查清(2026-08-04,不必重查)

- `uvClient.ts` 的 `COMMON_HEADERS` 是模組內 `const`,**未 export**,全 repo 唯一使用點是同檔 L102 的 `callSoa`。改成函式不影響任何外部呼叫點。
- `lionClient.ts` 有同名但獨立的 `COMMON_HEADERS`(L34),兩者無共用。本批不動 Lion。
- UV 帶語言的位置就是盤點到的五處(L49 / L56 / L165 / L204 / L221),`grep` 全檔無遺漏。

## 不確定就問,不要猜

- 若施工時 `grep` 結果與上述不符(代表期間有人動過),停手回報並更新本任務單,不要憑本文行號硬改。
- 若發現 UV 還有其他未盤點的端點也帶語言參數,停手回報並更新本任務單。

## 完成判準

- [ ] `tsc --noEmit` 0 錯
- [ ] M3 中「四個呼叫點都帶到語言」與「header 與 body 一致」測試全綠
- [ ] `grep -n "productLanguage: 3\|languageCode: \"3\"" server/suppliers/uvClient.ts` 無結果
