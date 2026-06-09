# 整合工作台 — 全 39 分頁重設計計畫

> 決策(2026-06-09,Jeff):**全部 39 個 AdminV2 分頁照 mockup 卡片設計重做完,才把 /admin 切過去**。期間 /admin 維持完整舊 AdminV2(保護日常 訂單/財務/agents),新設計在 **/workspace** 逐批預覽。一個都不漏、不留 /admin-legacy crutch。
>
> 執行順序(2026-06-09 Jeff 拍板):**1 → 2 → 6 → 4 → 5 → 7 → 3 → 8**。安全批次連續做;每批 tsc 0 + 測試綠 + Jeff 握 token 才 ship。批3 屆時可動工(只重排版,版面先親驗才接動作線);批4 含 §4.5 海報生成一起做(不拆)。

## 基礎(已完成)
- **ws-ui.tsx** 卡片文法 + 狀態語言(左黑條/badge/badgeK/whoChip/lock/warn/src/btnB/btnO/狀態 chip/處理好了 toggle/Greeting/GroupHeader)— admin-cards-states.html 的 React 版。
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
| **0** | 殼 + 卡片系統 | (基礎) | cards-states | ✓ done |
| **1** | 今日待辦完整化 | today/收件匣 · command-center/指揮中心 · inquiries/詢問 | inbox-integrated | 部分(只需要你決定桶) |
| **2** | 客戶 + 銷售動作 | customers-crm · customers-landing · ai-quotes · tool-quote · wechat-assist | sales(找團/報價/機票/客製/比較)· inbox-per-customer | 部分(inbox 殼) |
| **3** | 全公司·財務 | bank-ledger · finance-reports · finance-landing(P&L/信託/退款/催款) | pages-finance | 待(碰錢,reuse mutation) |
| **4** | 全公司·行銷 | newsletter · marketing · marketing-content · posters · marketing-landing | marketing-shell + poster(6平台)· 含 §4.5 海報生成(Jeff 2026-06-09:不拆,一起做) | 待 |
| **5** | 全公司·供應商 | suppliers · supplier-enrichment · tour-monitor · competitor-monitor | marketing-shell(供應商) | 待 |
| **6** | 營運 | bookings/訂單 · departures-calendar · visa/簽證 · reviews · packpoint · vouchers · **ops-landing/營運總覽**(2026-06-09 健檢補:原版漏列) | pages-ops(訂單/出團/簽證/客服/新客spam) | 待 |
| **7** | 行程管理頁 | tours/行程 | pages-tour(圖/地圖/itinerary/cost/calibration)— mockup 檔案存在(2026-06-09 健檢確認,原「缺檔」卡點不成立) | 待 |
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
