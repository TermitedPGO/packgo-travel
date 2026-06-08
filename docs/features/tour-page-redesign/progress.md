# Tour 詳情頁行動區重設計 — Progress（總覽 / Gate）

> 給監工看的總覽。**監工不信文件自我宣稱，結論獨立驗證**（CLAUDE.md §9.4）。

## 狀態

| Stage | 內容 | 狀態 |
|-------|------|------|
| 0 | 文件（proposal/design/tasks/progress） | ✅ 完成（2026-06-07） |
| 1 | Spec 條（純函式 + 展示元件 + 測試） | ✅ 完成（2026-06-07） |
| 2 | 小精靈（受控元件 + payload 純函式 + 測試） | ✅ 完成（2026-06-07） |
| 3 | CTA + Dialogs + 後端接線（migration 卡 gate） | ⬜ 未開始（等 Jeff 點頭） |
| 4 | 整合 + 線上預訂降次要 | ⬜ 未開始 |
| 5 | Vitest + tsc + 手機/桌機視覺驗收 | ⬜ 未開始 |

### Stage 1+2 交付物（2026-06-07）
- 新檔：`actionArea.helpers.ts`（5 純函式）、`actionArea.helpers.test.ts`、`TourSpecBar.tsx`、`TourFitWizard.tsx`。
- i18n：`tourDetail.action.{specBar,wizard,summary}.*` 加進 zh-TW + en（37/37 對稱）。
- 驗證：helper 測試 30/30 綠；專案 `tsc --noEmit` 0 error；全測試 1448 passed。
- **未動**：後端、migration、`inquiries.create`、index/BottomCTA/PricingSection 整合（皆 Stage 3/4）。元件尚未掛到頁面，故無瀏覽器可見變化（視覺驗收留 Stage 5）。
- 觀察（與本任務無關）：`server/routers/bookings.test.ts` 1 筆紅，是既有 supplier-cost WIP 讓 bookings router 多了 `getOrderPacket`/`setSupplierCost`/`setSupplierStatus`，測試的程序清單沒同步。非本次改動造成。

## ⛔ Gate — 需 Jeff 點頭才動的事

1. **任何 code 實作**（Stage 1 起）：proposal/design 確認後才開寫。
2. **DB migration**（Stage 3）：`inquiries` 加 `relatedTourId` + `wizardAnswers` 兩個可空欄位。Additive 低風險，但屬部署動作。
3. **commit / 部署**：Stage 5 驗收後再談。

## 關鍵決策（已拍板 2026-06-07）
- 儲存：結構化 + `relatedTourId`（誠實型別 → 加 `relatedTourId INT NULL` + `wizardAnswers JSON NULL`，message 雙寫）。
- 聯絡門檻：維持 name + email 必填。
- 加微信：彈窗顯示現有 QR 圖。

## 接線盤點（用現有，不新造）
- 詢問/報價/客製 → `trpc.inquiries.create`（publicProcedure，限速 5/10min）+ InquiryAgent 讀 message。
- 報價 PDF → 非公開頁職責；Jeff 後續用 `generateQuote`/`generateDeposit`（adminProcedure）或 packgo-quote 桌面 skill。
- 微信/電話 → `lib/brand.ts` 的 `CONTACT` + `/images/qrcode-wechat.png`（Footer 既有）。
- 線上預訂 → 保留 `navigate('/book/:id')`，視覺降次要，不刪、不碰金流。

## 風險追蹤
- spec 條資料不全 → 「有資料才顯示」策略。
- 元件耦合 → index.tsx 單一 state 來源。
- migration → gate 卡住，Jeff 點頭才跑。

## Next action
Stage 1 + 2 完成並驗證。Stage 3 含 **DB migration（gate 2）+ 後端 procedure 改動**，等 Jeff 另外點頭才動。前端 Dialog/CTA 可先寫接口、最後接真 mutation。
