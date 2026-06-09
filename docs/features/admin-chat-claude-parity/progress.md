# 整合工作台 — Progress(監工視角)

> 決策(2026-06-09,取代 06-08 的 26 頁版):Jeff 拍板**全 39 個 AdminV2 分頁重設計完才切 /admin**,計畫見 redesign-39.md(8 批);執行順序 1 → 2 → 6 → 4 → 5 → 7 → 3 → 8。
> 做法:建在**新路由(/workspace)跟現有後台並存**,分階段 ship + 切換,不打掉能跑的。每階段 tsc 0 + Vitest + guard ship,Jeff 握 token。

## 2026-06-09 健檢(新 session 交接核對)
- 屬實:v675-v684 工作、tsc 0、workspace 測試 24/24 綠、/admin=AdminV2(39 tab)、/admin-legacy 已移除、ws-ui 文法齊(jumpLabel/onJump 已預留未接)。
- 出入 1:**admin-pages-tour.html 存在且完整**(批7 原「缺檔」卡點不成立,以現檔為準)。
- 出入 2:redesign-39.md 漏 ops-landing、批8 有幽靈 "monitor"(已修文件:ops-landing 歸批6)。
- 出入 3:**行程 section 在 rebuild(0190735)中消失**:b6b076f 加的全公司第 5 子項(ToursTab)現已不在 WorkspaceCompany(只剩 記帳/月報/行銷/供應商 4 子項)。行程在 /workspace 暫無入口,批7 補回。
- 出入 4:**rebuild 系列元件硬編碼中文違反 §4.1**(ws-ui / WorkspaceToday / WorkspaceSidebar / relTime);audit-i18n.ts 只抓 key parity 抓不到 JSX 字面量。→ 還債列為批1 前置。
- 批1 payload 實測:cs payload 有 inquiryId(inquiries.userId nullable,guest 拿不到);quote 的 relatedId 指 tour,客人僅 optional name/email;方案 = 後端 enrich 加輕量 who 欄位(向後相容,5 個既有 list 消費者不動)。

## 2026-06-09 已做(同 session,Jeff 拍板順序後動工)
- **i18n 還債**:ws-ui / WorkspaceToday / WorkspaceSidebar / CustomerInbox 全部硬編碼中文 → t()(workspace.* 約 40 個新 key,zh-TW + en);relTime 抽共用 `relTime.ts`(+6 測試);新 guard `workspaceI18n.test.ts` 掃元件引用的 workspace.* key 必須存在兩語言(audit-i18n 抓不到 code→key 斷鏈,這測試補上,批2-8 自動受保護)。
- **批1 m1 完成**:`server/_core/approvalTaskWho.ts`(extractCustomerRef + enrichTasksWithWho,批量 inArray 零 N+1,guest/壞 payload 誠實降級 userId=null)+ commandCenter.list 回傳加 who(只加欄位,5 個消費者相容)+ WorkspaceToday @客戶 chip + 「去X」跳轉(Workspace.setView → customer inbox)。+8 測試。
- 驗證:tsc 0;全套 vitest 1433 passed / 0 failed(91 skipped);workspace 相關 90/90。
- **本機視覺驗證限制(誠實記錄)**:本機無 .env / DB,/workspace 有登入牆,視覺只能 ship 後在 prod 親驗。
- **v685 shipped(2026-06-09,Jeff go + token)**:七 gate 全過、/health 全綠(db 36ms / redis 17ms / stripe 235ms / llm 397ms)、token 用完即焚;線上 bundle grep 到「去{name}」+「timeJustNow」確認帶批1 m1 程式碼。**Jeff 親驗項:今日待辦卡 @客戶 chip、去X 跳轉切 inbox、英文模式全英文。**
- m2(卡上 approve/reject)、m3(詢問視圖)見 tasks/batch-1-today.md;新 session 從這裡接。

## 文件
- proposal.md(Stage 1)✓
- design.md(Stage 2 定案:設計系統 + 9 鐵律 + shell + 18 項目矩陣 + §4.5 行銷 6 平台 + 後端接點)✓
- redesign-39.md(8 批計畫 + 順序決策)✓
- 視覺:桌面 `PackGo_示意圖/admin-INDEX.html` 入口(admin-pages-tour.html 在,2026-06-09 確認)✓
- tasks/batch-1-today.md(Stage 3,批1)✓;批2+ 動工前逐批補

## 已上線 (2026-06-08) — 可用 v1

`packgoplay.com/workspace` 是真的能用的工作台地基,跟 `/admin` 並存。
- v675 P1 殼 + B1 講人話 · v676 P2 客戶 inbox · v677 P3 勾選持久化(migration 0089) · v678 P4 全公司事務 + P5 對話消閃爍/Stop
- 1418 測試全過;每批 tsc 0 + guard ship + Jeff token。
- **剩下都是 LARGE / 碰錢 / 要外部設定的,等 Jeff 指,不自動硬上**:slash/@ 指令、6 平台海報 gen(gpt-image+成本)、per-item 碰錢動作(報價確認等)、InquiryAgent 評測(要真信件 gold set)、後台行程管理頁。

## Track A — 工作台 UI

| 階段 | 內容 | 狀態 |
|------|------|------|
| P1 地基 | 新路由 /workspace + 4 區殼(重用 DomainSidebar)+ 今日待辦接 commandCenter 真資料(KPIStrip + ApprovalInbox)+ AI對話掛 AgentChatPage + 客戶清單 CustomersTabV2 + 全公司 placeholder | ✓ built(tsc 0 + i18n 綠),待 ship |
| P2 客戶 inbox | per-customer 聚合(adminCustomers.customerOpenItems:開放訂單/詢問/待審 task)+ CustomerInbox/WorkspaceCustomers master-detail + 修 /workspace 404(vite.ts route 登記)。tsc 0 + helper 5 測試綠 | ✓ built,待 ship |
| P3 勾選持久化 | disposition 層(migration 0089 workspaceDispositions,有 row=處理好了)+ workspace.setDisposition + customerOpenItems 帶 handled + CustomerInbox 勾選 → 寫 DB + 淡化下沉。tsc 0 + helper 7 測試綠 | ✓ built,待 ship | 各 card 完整內容/per-item 動作(報價確認等)= P4 |
| P4 全公司事務 + 行程 | WorkspaceCompany 4 子分頁(記帳→BankLedgerV2 / 月報→FinanceReports / 行銷→NewsletterTabV2 / 供應商→SupplierEnrichmentTabV2)+ 第 5 個 section 行程(ToursTab),全接現有元件,零新後端。tsc 0 | ✓ shipped | workspace 5 section 補齊。richer 單行程詳情頁(圖/地圖/calibration 合一)= 之後 |
| P5 對話順化 | 消閃爍(awaited invalidate 取代 racing setTimeout)+ Stop 鈕(AbortController,串流時顯示)。改共用 AgentChatPage,/admin 也受惠。tsc 0 | ✓ built(部分),待 ship | 工具步驟持續列 = P5.1;slash/@ = LARGE 留給 Jeff |
| P6 一稿出 6 平台 | 海報 gen | 待 |

## Track B — Agent 品質(同步)

| 編號 | 內容 | 狀態 |
|------|------|------|
| B1 | inbox 講人話(escalation/retro/calibration 卡 + executor 誠實 toast) | ✓ built(inquiryLabels.ts + 19 測試綠),隨 P1 commit ship |
| B2 | InquiryAgent 評測 + spam 防呆(task #93) | 待 |
| B3 | executor 誠實(已送出→已記錄) | 部分(toast 已改) |
| B4 | 半成品補:skill registry ports(報價/機票/簽證/訂金)、wip 兩條(accounting/landmark)搬回 main | 待 |

## 鐵律(每階段守)
碰錢先確認 · 機票你刷卡 · 永不自動送客人 · spam 不靜默丟 · 護照末四碼 · trust 不混淨利 · 純黑白圓角 · 無破折號 · 給客人口語短。

## 監工原則(§9.4)
- 不信文件自稱「完成」,每階段獨立驗(tsc/vitest/prod 視覺)。
- UI 不能跑在 agent 品質前面:每個 card 接真資料前,確認對應 agent 可信。
