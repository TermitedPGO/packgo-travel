# Stage 1 · 需求:供應商匯入語言(縱橫 UV 繁中)

> feature: `supplier-import-language` | 開立 2026-08-04 | 起因:Jeff「之前 import 有些團只有純英文,那不是我想要的」

## 1. 要解什麼

站上部分行程的對客文字是英文原文,不是繁體中文。

這不是翻譯品質問題,也不是供應商沒有中文。是我們從第一次串接起就跟縱橫要英文版,而匯入管線又是零 LLM 的純轉換,所以供應商給的英文字被原封不動寫進 `tours` 的對客欄位。

### 因果鏈(三段,皆已用第一手證據坐實)

| # | 事實 | 證據 |
|---|------|------|
| 1 | UV client 四處把語言寫死成 `3`(英文) | `server/suppliers/uvClient.ts` L49 `COMMON_HEADERS.languageCode:"3"`、L165 `listProducts`、L204 `getProductMain`、L221 `getProductTravelDetail`。L49 原註解:「UV storefront defaults to English」 |
| 2 | 匯入是純轉換,零 LLM,供應商的字直接落地 | `server/services/supplierSync/hydration.ts` 檔頭:「Zero LLM cost — pure transformation」。同段記載當時 4057 個 active tour 靠這條路補齊對客欄位 |
| 3 | 系統設計本來就假設 `tours` 存繁中 | `drizzle/schema.ts` L1643 `translations.sourceLanguage` 預設 `"zh-TW"`,英文是從中文翻出去的目標語 |

第 3 點是關鍵:把英文灌進 `tours` 等於把翻譯方向搞反,不只是「少翻一層」。

### 縱橫本來就有繁中(已實測,非推論)

2026-08-04 Jeff 本機實跑 `scripts/uv-lang-compare.mjs --count=10`(只讀,不碰 DB):

| 指標 | 實測值 |
|---|---|
| 名錄總產品數 | 1,155 |
| 抽樣團數 / 可比欄位 | 10 / 46 |
| 繁中要到中文 | 93.5%(43 欄) |
| 仍是英文 | 0%(0 欄) |
| 中英混排 | 6.5%(3 欄,判讀為地名保留英文) |
| 空白 | 0% |
| 繁體字命中 / 簡體字命中 | 46 欄 / **0 欄** |
| en 與 zh-TW 欄位數不一致 | **0 / 10 團** |

最後一列是本次最重要的反例檢查:先前的疑慮是「中文版可能少回傳欄位,導致缺的內容從分母消失、分數虛高」。逐團逐區塊比對(團名 / 逐日行程 / 費用包含 / 注意事項)結果 en 與 zh-TW **完全一比一**,疑慮排除。

結論:改語言參數即可取得完整繁中,且是繁體不是簡體。這條路可行,不是白工。

## 2. 為誰解

- **客人**:繁中預設語言的使用者(北美華人 40+ 家庭,本站主要客群)看到的是供應商原生繁中,不是英文原文、也不是 LLM 翻譯腔。
- **Jeff**:行程重新對客上架前,語言這一項不再是阻礙。
- **系統**:`tours` 內容語言與 `translations.sourceLanguage="zh-TW"` 的設計前提一致,英文版走既有翻譯管線輸出,方向正確。

## 3. 範圍

### 做

1. 把 UV client 的語言從寫死改為可設定,預設繁中(`zh-TW`),集中在 `server/_core/featureFlags.ts` 管理(遵該檔既定規範:禁止在呼叫點裸讀 `process.env`)。
2. 對應 Vitest:語言預設值、覆寫、非法值退回、四個呼叫點確實帶到同一語言。
3. 語言實測工具(`scripts/uv-lang-compare.mjs`)已於前一批交付,本批列為驗收依據,不重做。

### 不做(明確排除,避免範圍蔓延)

- **不在本批執行正式資料重抓**。改完只是「之後抓會拿到中文」,既有列不會自己變。重抓與 promote 是正式資料操作,需部署 + Jeff 放行,走 `catalogRebuild` 既有路徑另議。
- **不動 Lion(雄獅)**。Lion 是 TWD 台灣線、來源本就中文,且 `catalogRebuild` 對 Lion 路徑目前 gated(NormGroupID 橋接未解)。
- **不碰照片版權**(Jeff 2026-08-04 明示先不管)。
- **不碰線上收款 / IOLTA**(Jeff 2026-08-04 明示先不管;付款維持 fail-closed)。
- **不改 `hydration.ts` 的轉換邏輯**。它是純函式且行為正確,問題在餵給它的語言,不在它本身。
- **不新建重抓管線**。`server/services/catalogRebuild/` 已具備 batch / staging / 完整度閘 / 原子 promote / 快照回滾 / dryRun / limit,本批只改最上游語言。

## 4. 驗收長怎樣

### 程式面(本批必須全綠才算完成)

- [ ] `server/suppliers/uvClient.ts` 四個語言點全部改為讀同一設定源,無殘留字面量 `3`。
- [ ] 預設值為繁中;未設環境變數時取得的就是 `zh-TW`。
- [ ] 非法值(空字串、拼錯、不支援的語言)不靜默退回英文,而是明確退回預設繁中,且有測試。
- [ ] header `languageCode` 與 body `productLanguage` 永遠一致(不一致代表語言沒傳到底,是本類 bug 的形狀)。
- [ ] `tsc --noEmit` 0 錯;`pnpm test` 綠。

### 資料面(本批不執行,列為後續放行判準)

- [ ] `catalogRebuild` 以 `dryRun` + 小 `limit` 先跑,報告顯示取回內容為繁中。
- [ ] 抽驗數團的 `tours.description` / `dailyItinerary` 為繁體中文,無英文原文殘留、無簡體。
- [ ] `assertRetailOnly` 仍在 staging 與 promote 兩個出口生效(語言改動不得鬆動成本價紅線)。
- [ ] promote 前有快照,確認可回滾。

## 5. 風險與對策

| 風險 | 對策 |
|---|---|
| 改了預設語言,未來 sync 自動跑時把既有英文內容換掉,時機不受控 | `featureFlags.ts` 檔頭已載明:flag 於 boot 讀取,改動需重新部署,不會 mid-run 翻轉。且本批不觸發重抓;實際換內容一律走 `catalogRebuild` 手動觸發 + dryRun 先驗 |
| 英文站內容來源改變 | `tours` 轉為繁中後,英文由既有 `translations` 管線產出,方向與 `sourceLanguage="zh-TW"` 一致。可選增強(非本批):UV 同時供英文,未來可用供應商原生英文取代 LLM 英譯,見 design.md §5 |
| 抽樣 10 團不足以代表 1,155 個產品 | 承認為抽樣。放行前以 `dryRun` 跑較大批並看 `RebuildReport`,不以本次 10 團當全量結論。本文所有數字皆標註為抽樣 |
| 部分產品內容本就單薄(本次 10 團有 9 團逐日行程僅 1 天,en/zh 皆同) | 非語言問題,不在本批範圍。列入觀察:高號段新產品可能含非旅遊商品(機票代訂 / 簽證 / 門票),與 2026-06-13 稽核 B 桶一致,由完整度閘與既有 `isHiddenByAdmin` 機制處理 |

## 6. 相關文件

- `docs/features/uv-to-live-tours/audit-2026-06-13.md` — UV 全量盤點,含非旅遊商品桶
- `docs/features/tour-catalog-rebuild/design.md` — 重抓策略與四條紅線(成本價 / 餘位 / 照片 / SEO)
- `docs/features/supplier-api-plan/proposal-20260714.md` — 供應商 API 模式判定
- `docs/standards/backend.md` §8 — 部署紅線
