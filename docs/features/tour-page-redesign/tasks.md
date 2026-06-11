# Tour 詳情頁行動區重設計 — Tasks（Stage 3 任務拆解）

> 依 [design.md](./design.md)。每個 stage 做完打勾並更新 [progress.md](./progress.md)。
> **Stage 1（後端/migration）與任何部署需 Jeff 點頭後才執行。**

---

## Stage 1 — Spec 條（純展示，零後端）

純函式 + 展示元件，先做沒有 DB 依賴的部分。**✅ 完成 2026-06-07。**

- [x] `actionArea.helpers.ts`：`deriveNextDeparture`、`deriveFlightInclusion`、`deriveStartingUsd`、`deriveGroupSize`（純函式，型別齊全）。
- [x] `actionArea.helpers.test.ts`：上述四個函式的 Vitest（含邊界：空陣列/全取消/unknown/USD vs TWD）。
- [x] `TourSpecBar.tsx`：吃 tour + departures，只 render 有值的 chip；圓角 `rounded-xl`/`rounded-lg`；等高對齊。
- [x] i18n：`tourDetail.action.specBar.*` 補進 zh-TW.ts + en.ts（對稱）。
- [x] `tsc --noEmit` 過。

## Stage 2 — 小精靈（state，零後端）　**✅ 完成 2026-06-07**

- [x] `TourFitWizard.tsx`：受控，三題 segmented；`grid-cols-3` 等寬等高；選中態 themeColor；`aria-pressed`。
- [x] `WizardAnswers` 型別 + `buildInquiryInput`（純函式）放 helpers。
- [x] `actionArea.helpers.test.ts` 補 `buildInquiryInput` 測試（quote/custom、message 摘要無破折號、缺選項省略 key、relatedTourId 帶入）。
- [x] i18n：`tourDetail.action.wizard.*`（+ `summary.*`，供 Stage 3 的 buildInquiryInput labels）。
- [x] `tsc --noEmit` 過。

## Stage 3 — CTA 區 + Dialogs + 後端接線　**✅ 完成（commit 78d64fa，2026-06-08；2026-06-11 獨立複核）**

**後端（Jeff 已點頭放行）：**
- [x] migration：`0088_inquiry_tour_context.sql`（idempotent INFORMATION_SCHEMA guard，仿 0085-0087 手寫慣例）+ `.down.sql` + journal 同步。**尚未在 prod 跑**（部署時隨 `pnpm ship` 上）。
- [x] `drizzle/schema.ts`：inquiries 加 `relatedTourId` + `wizardAnswers`（json `$type` 收斂三鍵 union）+ 型別 export 不破。
- [x] `server/routers/inquiries.ts`：`create` zod 擴充（relatedTourId/wizardAnswers/inquiryType enum ["general","custom_tour"] default general，name+email 仍必填，限速 5/10min 不動）。
- [x] `db.createInquiry`：已 Read 確認 — insert 整個 `InsertInquiry` 物件，新欄位自動 forward，無需改。
- [x] 後端測試：`server/routers/inquiries.test.ts` +4（forward 新欄位 / 預設 inquiryType + 省略 context / 限速拒絕不寫入 / name+email 必填）。

**前端：**
- [x] `TourInquiryDialog.tsx`（265 行）：shadcn Dialog `rounded-xl`（靠 primitive `p-6`，caller 只給 `max-w-md`）；name+email 必填、phone/note 選填；wizard 唯讀 chips；`inquiries.create` mutation；成功/錯誤態；i18n 全覆蓋。
- [x] `WeChatDialog.tsx`（53 行）：`/images/qrcode-wechat.png`（`rounded-xl` + alt）+ 掃碼說明。
- [x] `TourActionArea.tsx`（123 行）：SpecBar + Wizard + CTA 列（要報價 filled 主 / 客製 outline / 加微信+打電話輔 / 線上預訂文字鈕次要）。
- [x] i18n：`tourDetail.action.cta.*` / `dialog.*` / `wechat.*` / `summary.*` zh-TW + en 對稱（套件內 i18n parity 測試守住）。
- [x] `tsc --noEmit` 過。

## Stage 4 — 整合進 TourDetailPeony，線上預訂降次要　**✅ 完成（commit 78d64fa，2026-06-08；2026-06-11 獨立複核）**

- [x] `index.tsx`：`wizard/inquiryOpen/inquiryMode/wechatOpen` state + `openInquiry` handler（單一來源）；`TourActionArea` 置於 Hero 後、Overview 前；兩個 Dialog render 一次。
- [x] `BottomCTA.tsx`：主鈕 = 要報價（`onInquire('quote')`）；「線上預訂」降為文字連結；電話 `tel:` 保留；props 加 `onInquire`。
- [x] `PricingSection.tsx`：要報價升主（filled）、線上預訂降 outline 次要；props 加 `onInquire`。
- [x] `/book/:id` 線上預訂路徑保留（TourActionArea / BottomCTA / PricingSection / 團期日曆都仍可達，金流零改動）。
- [x] `tsc --noEmit` 過。

## Stage 5 — 驗收　**自動化部分 ✅（2026-06-11）；視覺驗收留 Jeff**

- [x] Vitest 全綠：全套 1613 passed / 91 skipped（186 檔 passed / 11 skipped），0 fail。其中 `actionArea.helpers.test.ts` 30/30、`inquiries.test.ts` 9/9（含 4 筆 create 結構化 context）、`i18n.test.ts` parity 2/2。
- [x] `tsc --noEmit` 0 error（`NODE_OPTIONS=--max-old-space-size=6144`）。
- [ ] preview：手機（375）+ 桌機（1440）截圖；行動區、Dialog、QR 彈窗、降次要的線上預訂都對。（**留 Jeff 瀏覽器驗收**）
- [x] 自查紅線：圓角（卡 `rounded-xl`/鈕 `rounded-lg`/輸入 `rounded-lg`/QR 圖 `rounded-xl`）、i18n（zh-TW + en 對稱，無硬編碼中文）、action 區 i18n 文案無破折號、新檔皆 ≤300 行、object-cover 無漏圓角。
- [x] 更新 progress.md；commit 完成，**部署（含 migration 0088 上 prod）等 Jeff 走 `pnpm ship`**。

---

## 依賴順序
Stage 1、2 可平行（都零後端）。Stage 3 後端部分卡 Jeff 點頭；前端 Dialog/CTA 可先寫好接口、最後接真 mutation。Stage 4 依賴 1-3。Stage 5 最後。
