# Tour 詳情頁行動區重設計 — Proposal（Stage 1 需求文件）

> Feature: `tour-page-redesign`
> 建立：2026-06-07
> 狀態：Stage 1（需求）。Stage 4（coding）需 Jeff 點頭才動 code/部署。

---

## 1. 背景與問題

`client/src/pages/TourDetailPeony/` 行程詳情頁目前的「行動區」只有兩個入口，主軸都是「立即預訂」走線上結帳：

- `BottomCTA.tsx`：固定底部條（價格 + 電話 + 「立即預訂」→ `navigate('/book/:id')`）。
- `PricingSection.tsx`：團期日曆下方雙鈕（「立即預訂」→ `/book/:id`、「聯絡我們」→ `/contact`）。

**真實成交不是這樣發生的。** `bookings` 表 0 筆佐證：客人靠詢問、微信、電話成交，不靠線上結帳。把「立即預訂」當主角，等於把頁面的行動主軸對準一個沒人走的路徑。

## 2. 目標

把行動區從「單一立即預訂」改成「決策 + 行動」區，主角是**詢問**，貼近真實成交路徑。三個方向合成一個連貫區塊：

1. **一目了然（Spec 條）**：純事實。起價 USD、天數、出發城市、含/不含機票、小團人數、下個團期。無行銷詞。
2. **選項式小精靈（Wizard）**：人數 `1-2 / 3-5 / 6+`、時間 `近期 / 寒暑假 / 再討論`、預算 `經濟 / 舒適 / 奢華`。答案進 inquiry。
3. **直白 CTA**：要報價 / 客製這團 / 加微信 / 打電話。線上預訂保留為**次要**按鈕，不刪。

## 3. 非目標（Scope Out）

- 不碰金流／結帳邏輯（`/book/:id`、Stripe、deposit、trust accounting 一律不動）。
- 不新建 agent、不新建 inquiry 以外的表、不自動產 PDF。`generateQuote`/`generateDeposit` 是後台 `adminProcedure`，公開頁不呼叫，PDF 是 Jeff 後續步驟。
- 不改 `packgo-quote` 桌面 skill（與網站 runtime 無關）。
- 不重寫整頁，只動行動區相關元件與接線。

## 4. 使用者故事

- 作為一個在手機上看行程的潛在客人，我能在一眼內看到「這團大概多少 USD、幾天、含不含機票、下一團何時走」，不用滑到價格區。
- 作為一個還沒決定細節的客人，我能用三個快速選項表達「我們 3-5 人、想暑假走、要舒適等級」，然後一鍵送出詢問，不用自己打一段話。
- 作為一個偏好微信/電話的客人，我能直接點「加微信」（看 QR）或「打電話」，不被逼填表。
- 作為 Jeff，我收到的 inquiry 帶著「哪一團 + 人數/時間/預算」的結構化情境，不用回頭追問就能報價。

## 5. 成功標準

- Spec 條只顯示有資料來源的事實；任何欄位無資料就**省略**該 chip，不腦補、不留空殼。
- 小精靈答案 + `relatedTourId` 確實寫進 `inquiries`（結構化 + message 摘要雙寫），Jeff 在指揮中心讀得到。
- 「要報價 / 客製這團」走現有 `trpc.inquiries.create`，不繞過限速與既有驗證。
- 「加微信 / 打電話」重用現有資產（Footer QR 圖、`lib/brand.ts` 的 `CONTACT`），零新資產。
- 線上預訂仍可用，只是視覺上降為次要。
- 紅線全過：圓角（卡 `rounded-xl`／鈕 `rounded-lg`／輸入 `rounded-lg`）、i18n（zh-TW + en，無硬編碼中文）、整齊（對齊/等高/密度）、手機優先、不用破折號。

## 6. 已確認決策（2026-06-07 Jeff 拍板）

| # | 問題 | 決策 |
|---|------|------|
| Q1 | 小精靈答案 + 行程關聯怎麼存 | **結構化 + 加 `relatedTourId`**。見 design.md §3 的誠實型別對映（既有 int/timestamp 欄位放不下質化選項，改用 `relatedTourId INT NULL` + `wizardAnswers JSON NULL`，並把摘要寫進 `message`）。 |
| Q2 | 報價/客製送出前最少填什麼 | **維持姓名 + email 必填**。不動 `inquiries.create` 的聯絡門檻。微信/電話走免表單直接聯絡路徑。 |
| Q3 | 「加微信」點下去顯示什麼 | **彈窗顯示現有 QR 圖**（`/images/qrcode-wechat.png`），`rounded-xl` Dialog，不需新資產／微信 ID 字串。 |

## 7. 紅線與風險

- **紅線**：見 §5 末。最高優先級是圓角與整齊（CLAUDE.md §2.1 / 整齊鐵律）。
- **風險：DB migration**。Q1 需要對 `inquiries` 加兩個可空欄位（additive、低風險），但屬部署動作 → **Jeff 點頭才跑**。
- **風險：spec 條資料不全**。部分 tour 缺團期/機票資訊 → 用「有資料才顯示」策略化解（成功標準第 1 條）。
- **風險：元件耦合**。詢問 Dialog 需同時被 Spec/Wizard 區與底部固定條觸發 → design.md §6 用 index.tsx 單一 state 來源解決。

## 8. 交接

Stage 2 設計見 [design.md](./design.md)。Stage 3 任務拆解見 [tasks.md](./tasks.md)。總覽與 gate 見 [progress.md](./progress.md)。
