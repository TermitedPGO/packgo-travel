# 整合工作台 — 全 39 分頁重設計計畫

> 決策(2026-06-09,Jeff):**全部 39 個 AdminV2 分頁照 mockup 卡片設計重做完,才把 /admin 切過去**。期間 /admin 維持完整舊 AdminV2(保護日常 訂單/財務/agents),新設計在 **/workspace** 逐批預覽。一個都不漏、不留 /admin-legacy crutch。
>
> 執行順序(2026-06-09 Jeff 拍板):**1 → 2 → 6 → 4 → 5 → 7 → 3 → 8**。安全批次連續做;每批 tsc 0 + 測試綠 + Jeff 握 token 才 ship。批3 屆時可動工(只重排版,版面先親驗才接動作線);批4 含 §4.5 海報生成一起做(不拆)。

## 基礎(已完成)
- **ws-ui.tsx** 卡片文法 + 狀態語言(左黑條/badge/badgeK/whoChip/lock/warn/src/btnB/btnO/狀態 chip/處理好了 toggle/Greeting/GroupHeader)— 後台_11_卡片狀態總表.html 的 React 版。
- **WorkspaceSidebar.tsx** navTop 殼(與AI對話/今日待辦/全公司+子項/客戶逐列/搜尋/收合/footer)。
- **WorkspaceToday**(3 桶骨架)、**CustomerInbox**(時間軸 未處理/已處理)、**與AI對話**(AgentChatPage)。

## 設計治理
- 有 mockup 的頁 → 照 mockup 卡片重做。
- 沒 mockup 的冷門頁(報表/儀表板/設定/log)→ 不硬塞 worklist 卡片,改用**乾淨黑白**(圓角/line icon/等高/對齊),沿用既有資料與 mutation。
- **碰錢一律不新增自動流程**:認列/退款/催款/報價送出,只重排版面,動作仍走既有 gated mutation + confirm。
- 不破壞既有功能:每批保留現有 tab 的真實資料/動作,只換外觀。

## 39 分頁 → 7 批(依日常價值排序)

| 批 | 區 | 涵蓋 AdminV2 分頁 | mockup | 狀態 |
|----|----|------------------|--------|------|
| **0** | 殼 + 卡片系統 | (基礎) | 後台_11_卡片狀態總表 | ✓ done |
| **1** | 今日待辦完整化 | today/收件匣 · command-center/指揮中心 · inquiries/詢問 | 後台_01_今日待辦 | 部分(只需要你決定桶) |
| **2** | 客戶 + 銷售動作 | customers-crm · customers-landing · ai-quotes · tool-quote · wechat-assist | 後台_04_銷售(找團/報價/機票/客製/比較)· 後台_03_客戶 | 部分(inbox 殼) |
| **3** | 全公司·財務 | bank-ledger · finance-reports · finance-landing(P&L/信託/退款/催款) | 後台_06_財務 | 待(碰錢,reuse mutation) |
| **4** | 全公司·行銷 | newsletter · marketing · marketing-content · posters · marketing-landing | 後台_07_行銷 + 後台_08_一稿出6平台 · 含 §4.5 海報生成(Jeff 2026-06-09:不拆,一起做) | 待 |
| **5** | 全公司·供應商 | suppliers · supplier-enrichment · tour-monitor · competitor-monitor | 後台_07_行銷(供應商畫面) | 待 |
| **6** | 營運 | bookings/訂單 · departures-calendar · visa/簽證 · reviews · packpoint · vouchers · **ops-landing/營運總覽**(2026-06-09 健檢補:原版漏列) | 後台_05_營運(訂單/出團/簽證/客服/新客spam) | 待 |
| **7** | 行程管理頁 | tours/行程 | 後台_09_行程管理(圖/地圖/itinerary/cost/calibration)— mockup 檔案存在(2026-06-09 健檢確認,原「缺檔」卡點不成立) | 待 |
| **8** | 冷門 power(乾淨黑白,非卡片) | analytics · affiliate · ai-hub · llm-cost · audit-log · calibration-review · autonomous-agents · skills · cleanup · task-history(原列 "monitor" 為幽靈 id,AdminV2 無此 tab,已刪) | (無 mockup) | 待 |

## 切換條件(全綠才 flip /admin)
1. 8 批全部在 /workspace 可用、外觀照設計。
2. 功能 1:1 對得上舊 AdminV2(無漏功能)。
3. tsc 0 + Vitest 綠 + Jeff 在 /workspace 親驗一輪。
4. 才把 App.tsx `/admin` → Workspace(一次切換),AdminV2 留檔。

## 執行原則
- 每批獨立 ship 到 /workspace,Jeff 可逐批預覽喊停/改方向。
- 監工原則(§9.4):不信文件自稱完成,每批 tsc + 親驗。
- 碰錢頁(批 3)做好先給 Jeff 看一眼再接動作線。

## 手機驗收規則(2026-06-10 加,源自 admin-pwa P2)

> 背景:workspace 元件原本零 responsive 斷點。手機適配拍板做在元件層本身(見 `docs/features/admin-pwa/proposal.md` §2),批3-8 從源頭內建,不留 retrofit 債。完整 UI/UX 鐵則見 `docs/features/mobile-roadmap/proposal.md` §0.5。

每批 DoD 追加:
- 360 / 390 / 430px 三寬截圖:無爆版、無橫向捲動(登入牆限制 → 截圖盡力 + Jeff prod 親驗雙層)。
- 卡片/列 `w-full min-w-0` 流動寬度,絕不寫死 px;長字 truncate。
- 點擊區 ≥ 44×44px;輸入框字 ≥ 16px(`text-base`,iOS 對焦不放大)。
- 桌面密集表格類(批3 帳本、批6 訂單)靠既有「卡片化」治理吸收,不另做手機版表格。
- 既有手機元件 **re-home 不重寫**:BankTriagePage → 批3 記帳手機卡片視圖;ReceiptCameraFAB → 批3 掛 workspace 殼;GlobalSearchSheet → P1 或批6 頂部搜尋入口。

## 39 tab → 終點頁對照(2026-06-09,全套 PackGo_示意圖 掃描;縮編提案,不動上方已拍板批次順序)

> 終點不是「39 個 tab 各自重畫」,是 **10 個整頁**:9 頁已有完整示意圖,「系統」1 頁無圖(= 批 8,乾淨黑白)。39 tab 中 21 個在示意圖裡已有家。

| 終點頁 | 示意圖檔(PackGo_示意圖/網站/) | 吸收的 AdminV2 tab |
|---|---|---|
| 今日待辦(首頁) | 後台_01_今日待辦 · 後台_13_完整頁面參考 ① | today · command-center(任務=卡片) · inquiries(roll-up) |
| 與 AI 對話 | 後台_02_與AI對話 · 後台_12_業務示範卡 · 後台_13_完整頁面參考 ③ | agent-chat |
| 客戶(每客人一個 inbox) | 後台_03_客戶 · 後台_13_完整頁面參考 ② | customers-crm · packpoint |
| 銷售(5 畫面) | 後台_04_銷售 | tool-quote · ai-quotes · wechat-assist |
| 營運(5 畫面) | 後台_05_營運 | bookings · departures-calendar · visa(+客服/新客 spam,新增能力) |
| 財務(4 畫面) | 後台_06_財務 | bank-ledger · finance-reports · finance-landing |
| 行銷 | 後台_07_行銷 + 後台_08_一稿出6平台 | marketing-content · posters · newsletter · marketing |
| 供應商 | 後台_07_行銷(供應商畫面) | suppliers · supplier-enrichment · tour-monitor |
| 行程管理 | 後台_09_行程管理 | tours · calibration-review(分數內嵌) |
| 系統(乾淨黑白) | 後台_10_系統(2026-06-09 補圖完成) | autonomous-agents · skills · llm-cost · task-history · audit-log · ai-hub |

### 沒入圖的 tab 處置(2026-06-09 Jeff 拍板,採預設判決)
- **砍(設計使其失業)**:ops-landing · customers-landing · marketing-landing(今日待辦 + 客戶 inbox 取代「總覽」)
- **拍板 6 件**:reviews=自動草稿變待辦卡片 · competitor-monitor=每週摘要卡 · vouchers=訂單卡內發 · affiliate=行銷 tile · analytics=砍,外連 PostHog · cleanup=砍,降為對話指令
- **實質已有家**:command-center→今日待辦 · marketing→行銷 shell · supplier-enrichment→供應商
- 示意圖資料夾已重整:admin-INDEX.html 重建為終點藍圖(10 頁 + 拍板記錄),舊版迭代與 customer 舊圖搬到 PackGo_示意圖/_archive/。
- 2026-06-10 再整理:全部改名繁體編號,頂層按裝置分兩資料夾。`網站/` = 後台_00~13 桌面藍圖(總目錄 後台_00_總目錄.html,原 admin-INDEX);`手機/` = 客人_00~05(自 _archive 升為現役藍圖,計畫見 docs/features/customer-mobile/)。本檔表格已同步新名;舊名只存在歷史記錄(_archive 舊版迭代 6 檔同日清理,Jeff 拍板不留)。

### 縮編生效影響(批次順序不變)
- 批 2 少 customers-landing;批 6 少 reviews/vouchers/ops-landing(變卡片或併入);批 5 競品監控變卡片;批 8 由 10 tab 縮為 6 tab 合一「系統」頁。
- 驗收清單直接採 admin-INDEX.html footer 鐵則:純黑白 · 圓角 · line icon · 整齊對齊 · 碰錢先確認 · 機票你親自刷卡 · 客人訂金不算營收 · 護照末四碼 · 給客人訊息短而口語 · 無破折號。
