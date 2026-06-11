# PACK&GO 手機化 + 客人端 Roadmap (proposal)

> 起因:Jeff 要「把後台變成手機 App 方便自己使用」,延伸出「客人也要能更好地找團」。
> 結論:這是**兩個獨立產品**,分兩軌做,**不混進同一個 App**。
> 2026-06-01 立。每塊實作前各自再開 design.md。

> **狀態指針(2026-06-10)**:本檔保留為兩軌總綱,§0 鐵則 + §0.5 UI/UX 鐵則是全軌憲法,被兩個子計畫引用不複製。
> - Track A 後台 → `docs/features/admin-pwa/`(本檔 §7 Slice 3 = 該計畫 P3;A5 Capacitor = P5)
> - Track B 客人端 → `docs/features/customer-mobile/`(25 張示意圖全對齊,B1-B4 全數吸收)

## 0. 鐵則
- **後台 App(給 Jeff,要登入)** 與 **客人端(公開站)** 是兩個入口,不可合併。客人不該下載裝著財務後台的 App。
- 不重排每張桌面密集表格(工大又撞「整齊密度」原則);只做手機上真的會用到的事。
- App 外殼(Capacitor)是**最後一步**,先把畫面做好再包,否則只是把難用的桌面版裝進 App。
- 每個 slice:自己分支、tsc + Vitest、圓角 + i18n、本地 commit 不 push(CLAUDE.md §9)。
- 一人公司,**一次只專心一條軌**,平行只會互相打架。

## 0.5 UI/UX 鐵則(全軌適用,跟圓角同級,不是「盡量」)
> Jeff 2026-06-01 定:UI/UX 要**很簡單用** + **符合每個人的手機 size**。翻成可檢查規則:

**A. 簡單用**
- 一頁一個主要動作,一眼看到。常用任務最少點:搜尋 → 點卡片 → 看詳情。
- 大按鈕大字,不放密集控制項;細節「點開才看」(漸進揭露)。
- 沿用黑白極簡風,不加裝飾。不靠手勢密技,所有動作都是看得到的按鈕。

**B. 符合每個人的手機 size**
- 全部流動寬度,**絕不寫死 px**;`w-full` + `flex` + `min-w-0` 防爆版。
- 點擊區 ≥ 44×44px(大拇指友善)。輸入框字 ≥ 16px(`text-base`,iOS 對焦不自動放大)。
- 尊重安全區 `env(safe-area-inset-*)`(瀏海 / Dynamic Island / home 條)。
- **單欄卡片,絕無橫向捲動**(桌面表格的原罪)。長名字 / email 用 `truncate` + `min-w-0`。
- 不用 hover-only(觸控沒有 hover)。

**C. 驗證(不是嘴上說)**
- 每個手機頁在 **360 / 390 / 430px** 三種寬度截圖驗收(舊 iPhone SE / 一般 / Pro Max),確認不爆版、不裁切、好點。

## 1. 現況(已經有,別重做)
**後台手機原生:** MobileShell(底部 5 鍵)、今日(DailyCheckMobile)、收件(Agent Chat 全螢幕 + composer)、銀行滑動 AI 分類(BankTriagePage)、拍收據(ReceiptCameraFAB)、全螢幕搜尋。
**後台手機仍 fallback 桌面:** 銀行帳本完整檢視、客戶 / 訂單頁、更多 / AI Hub。
**客人端:** 首頁搜尋(出發地 / 關鍵字 / 時間)、`/tours` 目錄、行程詳情、客製團申請;整站已是 PWA(可加到主畫面)。

## 2. Track A — 後台 App(給 Jeff,原始目標)
| Slice | 內容 | 現況 | 工 | 備註 |
|------|------|------|----|------|
| **A1** | 客戶 / 訂單 / 報價 手機頁(查) | 桌面硬塞 | ~1d | 重用 `admin.customerList` / `bookings.adminList`;卡片列表 + 全螢幕詳情;接底部「客戶」鍵 |
| A2 | 回客人 / 詢問 手機順手 | 聊天已手機版 | 0.5d | 回覆流程細節 |
| A3 | 今日出團 / 行程 補資訊 | 已手機版 | 0.5d | 補 Jeff 要看的欄位 |
| A4 | 拍收據 / 分類銀行 微調 | 已手機版 | 小 | |
| A5 | Capacitor 外殼 + FaceID | 無 | 1-2d | **依賴:Apple 開發者帳號 $99/yr + Xcode**;載入 packgoplay.com(server.url),一份 code 兩用 |

## 3. Track B — 客人端(成長)
| Slice | 內容 | 現況 | 工 | 備註 |
|------|------|------|----|------|
| B1 | 找團搜尋 / 篩選 手機更順 | 有基本搜尋 | 0.5-1d | |
| **B2** | AI 找團(客人講需求 → 推薦團) | 無 | 2-3d | 用既有 LLM stack;差異化最高、減少 Jeff 被問 |
| B3 | 會員專區(客人查自己訂單 / 報價 / 付款) | 部分 | 1-2d | 減少「我的狀態?」詢問 |
| B4 | 客人 App 包裝 | PWA 已覆蓋 | - | 最低優先;PWA 加主畫面通常就夠 |

## 4. 建議順序
1. **A1**(你原本最痛的,最快見效)
2. A2-A4(順現有手機頁)
3. **B2 AI 找團** 或 **B3 會員專區**(看要先衝成長還是先減詢問)
4. A5 Capacitor + FaceID(Apple 帳號到位後)
5. B1 / B4 收尾

## 5. 下一步
先做 **A1**:客戶 / 訂單手機卡片列表 + 全螢幕詳情。自己分支、tsc + Vitest、不 push,Jeff 驗收。

## 6. A1 設計(可冷啟動執行)
**重用資料(不動後端):**
- `admin.customerList` → id / name / email / phone / tier / bookingCount / inquiryCount / totalSpend / lastSignedIn(已排序)
- `admin.customerDetail({ userId })` → 基本資料 + 最近訂單 / 詢問 / packpoint
- `bookings.adminList`(`getAllBookings`)→ status / payment / tourTitle / contact / departureDate / totalPax / totalAmount

**新檔:** `client/src/components/mobile/CustomersMobile.tsx` + `BookingsMobile.tsx`(各:列表 + 全螢幕詳情)。

**客戶卡(單欄,列高 ≥44px,全部 truncate + min-w-0):**
- 第一行:名字(粗體) + tier 小點
- 第二行:email 或 phone(灰)
- 第三行:訂單 N · 消費 $X · 詢問 N(小字)
- 點 → 全螢幕詳情(customerDetail)

**訂單卡:**
- 第一行:行程名 + 狀態點(StatusDot tone)
- 第二行:聯絡人 · 出發日
- 第三行:N 人 · $金額 · 付款狀態

**共用:** 頂部 sticky 搜尋框(`text-base` 防 iOS 放大);列表 `w-full` 單欄 `space-y-2`,無橫向捲動;空狀態用既有 `EmptyState`。

**接線:** MobileShell 底部「客戶」鍵 → `CustomersMobile`;在 `AdminV2` 的 `renderMobilePage` switch 加 case。

**驗證:** 360 / 390 / 430px 截圖 + tsc 0 + Vitest(搜尋 filter 純函式 + 列表 render)。

## 7. 方向更新(2026-06-01):chat-first(Claude Code 風)
Jeff 定:手機改成「主畫面就是大窗對話、減少選單」。所以 A1 的客戶 / 訂單**不再是分頁**,而是「Agent 在對話裡長出來的卡片」(= slice 3)。手機外型先 chat-first 化,再做最有價值的「資料長在對話裡」。

- **Slice 1 ✅**(commit `b60fb2f`)快捷 chip — composer 上方 4 個(今日出團 / 待審核 / 本月淨利 / 最近詢問),點一下送 prompt 給 OpsAgent。
- **Slice 2 ✅**(本 commit)chat-first shell:拿掉底部 5 鍵 nav → 對話全螢幕當主角;左上 ≡ 開「全部功能」抽屜(分組 + 搜尋,重用 `paletteActions`,零新硬編碼);非對話頁 ← 返回對話;P logo 改黑。`buildMenuGroups` 純函式 + 5 Vitest。
  - 註:抽屜暫用既有 3 個 domain 分組(Chat / 帳本 / 工作台),工作台清單較長;日後可重分成更細的桶(客戶&訂單 / 報價&行銷 / 財務…)。
- **Slice 3 ⏭**(核心、最有價值)讓資料在對話裡長出卡片(客戶 / 訂單 / 出團 / 財務)。要動 **OpsAgent 後端**回傳結構化區塊(非純 markdown)+ 前端 renderer 把區塊畫成卡片(重用 §6 的卡片設計)。
- **限制:** 真實後台是登入保護的,無法直接截圖驗證 → chat-first shell 以 v3 mockup 為視覺規格,程式以 tsc + i18n + 純函式 Vitest 把關;最終由 Jeff 在跑起來的 app 親眼驗收。

