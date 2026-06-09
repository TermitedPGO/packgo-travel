# 整合工作台 — Progress(監工視角)

> 決策(2026-06-08):Jeff 拍板**全建 26 頁**,agent 品質**同步補**。
> 做法:建在**新路由(/workspace)跟現有後台並存**,分階段 ship + 切換,不打掉能跑的。每階段 tsc 0 + Vitest + guard ship,Jeff 握 token。

## 文件
- proposal.md(Stage 1)✓
- design.md(Stage 2 定案:設計系統 + 9 鐵律 + shell + 18 項目矩陣 + §4.5 行銷 6 平台 + 後端接點)✓
- 視覺:26 個完整頁 mockup(桌面 `PackGo_示意圖/admin-INDEX.html` 入口)✓
- tasks/(Stage 3)— 待寫

## Track A — 工作台 UI

| 階段 | 內容 | 狀態 |
|------|------|------|
| P1 地基 | 新路由 /workspace + 4 區殼(重用 DomainSidebar)+ 今日待辦接 commandCenter 真資料(KPIStrip + ApprovalInbox)+ AI對話掛 AgentChatPage + 客戶清單 CustomersTabV2 + 全公司 placeholder | ✓ built(tsc 0 + i18n 綠),待 ship |
| P2 客戶 inbox | per-customer 聚合(adminCustomers.customerOpenItems:開放訂單/詢問/待審 task)+ CustomerInbox/WorkspaceCustomers master-detail + 修 /workspace 404(vite.ts route 登記)。tsc 0 + helper 5 測試綠 | ✓ built,待 ship |
| P3 勾選持久化 | disposition 層(migration 0089 workspaceDispositions,有 row=處理好了)+ workspace.setDisposition + customerOpenItems 帶 handled + CustomerInbox 勾選 → 寫 DB + 淡化下沉。tsc 0 + helper 7 測試綠 | ✓ built,待 ship | 各 card 完整內容/per-item 動作(報價確認等)= P4 |
| P4 全公司事務 | 記帳/月報/行銷/供應商 + 行程管理頁 | 待 |
| P5 對話升級 | slash/@ + 消閃爍/Stop/步驟列 | 待 |
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
