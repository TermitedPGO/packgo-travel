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

## Stage 3 — CTA 區 + Dialogs + 後端接線

**後端（需 Jeff 點頭）：**
- [ ] migration：`inquiries` 加 `relatedTourId INT NULL` + `wizardAnswers JSON NULL`（確認下一個 migration 編號）。
- [ ] `drizzle/schema.ts`：inquiries 加兩欄位 + 型別 export 不破。
- [ ] `server/routers/inquiries.ts`：`create` zod 擴充（relatedTourId/wizardAnswers/inquiryType，name+email 仍必填）。
- [ ] `db.createInquiry`：Read 確認 forward 新欄位，必要時補。
- [ ] 後端測試：`inquiries.create` 接受新欄位、預設 inquiryType、限速不變。

**前端：**
- [ ] `TourInquiryDialog.tsx`：shadcn Dialog（`rounded-xl`，靠 primitive `p-6`）；name+email 必填、phone/note 選填；wizard 唯讀 chips；`inquiries.create` mutation；成功/錯誤態；i18n。
- [ ] `WeChatDialog.tsx`：顯示 `/images/qrcode-wechat.png`（`rounded-xl`）+ 說明。
- [ ] `TourActionArea.tsx`：組 SpecBar + Wizard + CTA 列（要報價/客製主、加微信/打電話輔、線上預訂次要）。
- [ ] i18n：`tourDetail.action.cta.*` / `dialog.*` / `wechat.*`。
- [ ] `tsc --noEmit` 過。

## Stage 4 — 整合進 TourDetailPeony，線上預訂降次要

- [ ] `index.tsx`：加 `inquiryOpen/inquiryMode/wechatOpen/wizard` state + handlers；render `TourActionArea` + 兩個 Dialog。
- [ ] `BottomCTA.tsx`：主鈕改開詢問 Dialog（`onInquire`）；加最低權重「線上預訂」次要連結；電話保留；props 加 `onInquire`。
- [ ] `PricingSection.tsx`：CTA 列詢問升主、線上預訂降次要；props 加 `onInquire`。
- [ ] 確認 `/book/:id` 線上預訂路徑仍可用（不刪、不碰金流）。
- [ ] `tsc --noEmit` 過。

## Stage 5 — 驗收

- [ ] Vitest 全綠（helpers + 後端 + 選配元件）。
- [ ] `tsc --noEmit` 0 error（OOM → `NODE_OPTIONS=--max-old-space-size=6144`）。
- [ ] preview：手機（375）+ 桌機（1440）截圖；行動區、Dialog、QR 彈窗、降次要的線上預訂都對。
- [ ] 自查紅線：圓角（卡/鈕/輸入/圖）、整齊（對齊/等高/密度）、i18n（en 切換無中文殘留）、無破折號、手機優先。
- [ ] 更新 progress.md，請 Jeff 驗收後再談 commit/部署。

---

## 依賴順序
Stage 1、2 可平行（都零後端）。Stage 3 後端部分卡 Jeff 點頭；前端 Dialog/CTA 可先寫好接口、最後接真 mutation。Stage 4 依賴 1-3。Stage 5 最後。
