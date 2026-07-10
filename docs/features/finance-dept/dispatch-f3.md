# 派工單:F3 — 財務駕駛艙落地 /ops(2026-07-09 夜間衝刺,指揮簽發)

> 執行模型:opus 4.8。閉環模式:指揮直接派 agent,一塊一驗,夜間自轉。branch finance-f3,worktree ../網站-f3。
> Jeff 裁示:本時段全 repo 只准修改財務頁面相關檔案;用真實資料跑與對比;目標是「完美財務頁」,明早 Jeff 親自驗收。
> 藍本:design-proposals/B-final-駕駛艙合成版.html(像素級驗收基準)+ D-細節層_月年稅.html(第二層)。設計裁決全在 f1-acceptance 與 memory:狀態色 dot+文字、serif 只准 H1、4px 網格、Trust 三段勾稽、老化 chip、空狀態。

## 錨點

- 掛載:/ops/finance 現指向 AdminFinance placeholder(App.tsx ~:208);knownRoutes 已含 /ops(/.*)?。舊入口 /workspace 全公司事務→月報 tab(WorkspaceCompany.tsx:78 render FinanceReports)。
- 現成元件:admin-v2/{FinanceReports,ProfitLossV2,TrustComplianceV2,BankLedgerV2}.tsx、admin/PendingClaimsTab.tsx;primitives KPIStrip/DataTable/PageHeader(serif 規則在 PageHeader.tsx:7)。
- 資料源:bankPLService(P&L+transfer/stripePayout 中性 tiles+SCHEDULE_C_MAP)、bankTransactionLinks router(claim/pending,F1)、plaidRouter trustDeferredList(~:1956)、backfill-bank-transaction-links dry_run(統計)。
- 真實數(2026-07-09 探真,驗收對比基準):待認領 320 筆/$447,732;small_inflow 可自動掛 53;Trust 未歸戶三筆 $8,908/$2,916/$3,598=$15,422;bankTransactionLinks total=0(存量 confirm 未跑)。
- token:index.css:45-46 字體;色值/間距照 B-final(emerald #007a55、amber-700 #bb4d00、4px 網格)。

## 塊 A — 駕駛艙殼與真相列

1. 新元件 admin-v2/FinanceCockpit/(結構你定),掛上 /ops/finance 取代 placeholder。
2. 真相列四格(現金部位/本月損益/待認領/Trust 未認列)接真資料源;hint 副行照 B-final。
3. 雙欄骨架 + 第二層入口列(完整損益表/發票/對帳明細/報表與稅務/報稅匯出 CSV — 先掛連結,目標可暫指舊元件)。
4. /workspace 月報 tab 過渡:改 render 新 FinanceCockpit(舊 FinanceReports 檔案保留不刪,發票等未遷功能經第二層入口仍可達)。

## 塊 B — 工作區(左欄)

1. 待認領表:日期/金額/aging chip(>30 天紅字天數)/候選 chip/認領按鈕;資料接 pending 清單。
2. 認領對話框:候選確認 + 訂單/客人搜尋逃生口(F3 輸入需求①,可複用 globalSearch 或訂單查詢)+ 內部分類下拉(選項鎖 SCHEDULE_C_MAP 枚舉,禁自由文字)+ 備註欄(輸入需求②的標記能力)。
3. 待認列確認卡(出發了·訂金可認列)+ 認列動作接現有 recognize 路徑(若無現成 mutation,可新增 —— 寫路徑必接 auditLog/audit,AI 不自動認列)。
4. 已自動處理卡 + 「引擎已自動對上 N 筆」摘要;撤銷改掛入口(輸入需求③)進對帳明細層,本塊先留按鈕與 tRPC(unlink 需 audit)。

## 塊 C — 兩本帳(右欄)+ 空狀態

1. 損益卡:營收/成本行/成分條(灰階分段)/淨利/中性列(內部轉帳、Stripe 撥款落地,bankPLService tiles)/退款列(0 摺疊)/口徑 note 照 B-final 修訂版文案。
2. 客人訂金卡:餘額三段勾稽(已對應未認列+未對應+待認列)、逐團列表、未對應列、footer 等式;數字全部由查詢算出,禁寫死。
3. 空狀態雙態(今天沒有等你的事 / $0 月)+ loading/error 態(fail-open:查詢失敗顯示「讀取失敗」不白屏)。

## 塊 D — 細節層與收尾

1. 報表與稅務頁(D 藍本):期間切換/月度趨勢/Schedule C 對照/Trust 對稅時點/已排除/1099 卡(1040-ES 維持「待建」標)/匯出給會計師入口(CSV 端點有就接,沒有掛 disabled+待建標,不本批造)。
2. 全頁 i18n:zh-TW + en 全 key(紅線 7,JSX 零硬編碼中文),i18n parity hook 過。
3. 真實資料對比驗收(本批核心):flyctl ssh 唯讀探 prod 取本月真數(P&L 各行、pending 統計、trust 遞延各段),寫成對比表進 T6 —— 頁面顯示數必須等於 prod 探真數,逐格打勾;元件測試用真形狀 fixture 斷言計算正確。
4. 視覺對比:起本地 dev server 截圖與 B-final 並排(本機中文路徑起不來就 jsdom + 樣式斷言 fallback,誠實申報);圓角/serif/4px 網格/狀態色抽查。

## 紅線(本時段特別版)

- 只准動:client/src 財務相關(新 FinanceCockpit、掛載兩點、i18n 兩檔新 key)+ server 端「唯讀查詢」procedure 新增(缺才加);任何寫路徑新增必接 audit 且是 Jeff 按的動作。禁動:其他頁面、schema(零 migration)、featureFlags、webhook、worker。
- prod 唯讀;不 ship;pnpm dev 本地測試可。commit 帶 pathspec,push finance-f3。
- 分類鎖 IRS 枚舉;AI 不動錢不自動認列;設計不自作主張改(B-final 是 Jeff 點頭的定稿,偏離要申報)。
- T2 地雷七條;tsc 0 + vitest 全綠 + i18n parity 每塊 commit 前過。

## 驗收(每塊 T6-lite 回報指揮;塊D 後總 T6)

改動檔案清單、測試數字原樣、真數對比表(塊D)、截圖或 fallback 證據、偏離申報。指揮逐塊對抗驗收(審查路全 opus),過了才續派。
