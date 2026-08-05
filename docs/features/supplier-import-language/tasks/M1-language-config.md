# M1 · 語言設定源

> 檔案:`server/_core/featureFlags.ts` | 預估 +35 行 | 相依:無(本批第一個做)

## 目標

在 `featureFlags.ts` 新增 `uvImportLanguage()`,成為 UV 匯入語言的唯一設定源。呼叫點不得裸讀 `process.env`。

## 輸入

- 既有檔案 `server/_core/featureFlags.ts`。檔頭已載明本檔規範:集中管理、禁止呼叫點裸讀、boot 時讀取無快取、改動需重新部署。
- 既有非布林設定先例:`trustRecognitionOffsetDays`、`trustAutomatchMinConfidence`。照同樣風格寫。
- UV 語言碼對映(來源:`server/suppliers/uvClient.ts` L49 原註解):`1=zh-CN`、`2=zh-TW`、`3=en`。

## 輸出

```ts
export type UvLanguage = {
  code: "1" | "2" | "3";        // header languageCode
  num: 1 | 2 | 3;               // body productLanguage
  tag: "zh-CN" | "zh-TW" | "en";
  acceptLanguage: string;       // HTTP Accept-Language
};

export const uvImportLanguage = (): UvLanguage => { ... };
```

環境變數:`UV_IMPORT_LANGUAGE`,值為 `zh-TW` / `zh-CN` / `en`,預設 `zh-TW`。

## 步驟

- [ ] 定義 `UvLanguage` 型別與三個語言的常數表(單一事實源,`code` 與 `num` 由同一筆資料衍生,不各自手打)。
- [ ] 實作 `uvImportLanguage()`:讀 `process.env.UV_IMPORT_LANGUAGE` → trim → 小寫正規化 → 查表 → 命中回傳,未命中回傳 `zh-TW`。
- [ ] 寫 JSDoc,必須寫明三件事:
  - 為什麼預設繁中(`translations.sourceLanguage` 預設 `zh-TW`,系統設計就是 tours 存中文)
  - 為什麼非法值退回繁中而非英文(退回英文 = 靜默重蹈覆轍,正是本 feature 要根除的失敗模式)
  - 用可讀語言標籤而非 UV 數字碼的理由(數字碼是供應商內部約定,寫在 Fly secret 沒人看得懂)
- [ ] 不要用 `parseInt(v) || fallback` 這類寫法。本檔已記錄過 falsy-zero 陷阱,同一個坑不踩第二次。

## 不確定就問,不要猜

- 若發現 `featureFlags.ts` 已有語言相關設定(本批盤點時無),先停手回報,不要重複定義。
- 若 UV 語言碼與 L49 註解不符(例如實測 `2` 拿到簡體),停手回報,不要自行猜測對映。

## 完成判準

- [ ] `tsc --noEmit` 0 錯
- [ ] M3 中對應測試全綠
- [ ] 全 repo `grep -rn "productLanguage\|languageCode"` 除本函式與 uvClient 呼叫點外無其他寫死點
