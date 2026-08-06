# M3 · 測試

> 檔案:`server/suppliers/uvClient.lang.test.ts`(新)+ `server/_core/featureFlags.test.ts`(增段,若不存在則新建) | 預估 +90 行 | 相依:M1、M2

## 目標

鎖住本 feature 的核心語義:**預設繁中、非法值不退英文、語言一路傳到底**。

## 輸入

- `docs/features/supplier-import-language/design.md` §6 測試策略表。
- 慣例:Vitest;後端測試放 `server/*.test.ts`;禁止測試插真實資料進 DB;禁止依賴外部網路。

## 輸出

### 設定源測試(M1)

- [ ] 未設 `UV_IMPORT_LANGUAGE` → `tag === "zh-TW"`、`code === "2"`、`num === 2`
- [ ] `zh-TW` / `zh-CN` / `en` 三個合法值各自對映正確的 `code` 與 `num`
- [ ] `code` 與 `num` 恆為同一語言(不變量測試,不是逐值硬寫)
- [ ] 正規化:`"zh-tw"`、`" zh-TW "`、`"ZH-TW"` 皆命中繁中
- [ ] 非法值(`""`、`"zh"`、`"japanese"`、`"2"`、`"true"`)→ 一律 `zh-TW`,**斷言不等於 `en`**(這條是本 feature 的核心語義,要獨立成一條測試並在測試名寫明理由)

### 請求層測試(M2)

用 stub `fetch` 攔請求,檢查實際送出的 header 與 body:

- [ ] `listProducts` / `getProductMain` / `getProductTravelDetail` 三者:header `languageCode` === body `productLanguage` 的字串形式
- [ ] 三者送出的語言 === `uvImportLanguage()` 的值
- [ ] 設 `UV_IMPORT_LANGUAGE=en` 時三者確實送英文(證明可切換,不是寫死成繁中)
- [ ] `Accept-Language` 隨語言切換

環境變數用 `vi.stubEnv`(既有慣例,見 `server/routers/bookings.test.ts` 的 `__vi.stubEnv("TOURS_PUBLIC_ENABLED", "true")`),測試後還原。

## 步驟

- [ ] 先確認 `server/_core/featureFlags.test.ts` 是否存在,存在就增段,不要另開重複檔案。
- [ ] stub `fetch` 只在本測試檔生效,不污染其他測試。
- [ ] 測試名稱寫清楚「為什麼測這條」,尤其非法值那條 —— 半年後看到的人要知道退回英文是失敗不是選項。

## 不確定就問,不要猜

- 若既有測試已 stub 過 global fetch 且有衝突,停手回報,不要在共用 setup 動手腳。

## 完成判準

- [ ] `pnpm test` 全綠(不只新測試,全套)
- [ ] `tsc --noEmit` 0 錯
- [ ] 反向驗證:把 M1 的預設值暫時改成 `en`,新測試必須失敗。確認是真鎖不是恆真式,驗完改回。
