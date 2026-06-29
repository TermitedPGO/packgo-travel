# 客戶駕駛艙 — header / 新增客人 / 回信即時 / 跟進日(決策已鎖)

> Stage 1 提案。範圍:客戶頁那排動作按鈕、新增客人流程、客人回信通知、跟進日+日曆。
> 來源:2026-06-29 本 session 直接讀 live 檔盤點 + 兩個 Explore agent 審計(駕駛艙現況 + /workspace 落差)。
> 狀態:四題方向 + 報價邊界已由 Jeff 2026-06-29 拍板鎖定。合併另見 consolidation-plan.md。本檔不寫 code。

## 一、現況盤點(client/src/components/admin/customers/)

Live 頁面 = `/ops/customers` → `pages/AdminCustomers.tsx`,三欄式:左 CustomerList、中 CustomerDetail(動作按鈕列)、右 CustomerChat(AI 工作台)。審計結論:駕駛艙的「腦」已做完,五個按鈕、四 tab、AI 串流、草稿核可、五秒真相條、漏價看門狗、客人記憶面板全部 wired 且能用,無 TODO/佔位。唯一垃圾 = 孤兒 `AddCustomerDialog.tsx`(沒人 import)。

注意:客人頁有三個世代並存 —— `/admin-v2-archive`(舊 28-tab,已封存)、`/workspace` CustomerInbox(整合工作台,/admin 與 /admin/v2 都 redirect 來這,目前實際在用)、`/ops/customers`(v4 重建,駕駛艙)。合併 = 讓 /ops 變唯一,退掉另兩個。詳見 consolidation-plan.md。

## 二、報價邊界(這串對話釐清,鎖為通則)

分界線 = 搬運 vs 生成。
- 可以(搬已驗證售價):引用你已做好核對過的報價單售價;搬「現成團 / 目錄團」已發佈、markup 已內含的對客售價(原樣、附來源、不重算);把後台 API 原始料(團期/base/服務費/燃油/必付/餘位)附來源攤平給你當求證材料。
- 不可以(生成/碰錢/越界):把客制團的費用現組成報價(markup 是客制團才加,這段留人力);拿 flyer/web 聚合站/官網公開價直接報;碰成本/同業價/折扣或讓它上客人文件;自動定 markup、自動送客人、自動開票付款;把推論結構(含/不含飯店、出團日)當已確認。
- 硬 gate(連先生/Wu 案補):團期先對後台班期;機票上登入 Trip.com 看真價、你親刷;AI/workflow 算的總數分段再加驗算;日期星期自核;內部備註與客人訊息實體分框。

一旦要為某客人的日期/人數/必付去動那個價,就從「現成搬運」變「客制組價」,立刻停、回到你。

## 三、四題決策(鎖定)

### Q1 動作按鈕 — 移除報價/催款/確認書三顆,留電話/email

決策:移除那三顆 header 按鈕,保留電話/email。訂單能力不刪除,退到既有「訂單」tab(它本來就有建單/收款/確認);漏價看門狗(Step 5)保留待命。理由:報價/催款/確認對應的是客制訂單管理,而客制團是「留人力」那條 —— 這三顆是人工工具不是 AI 能代;但日常不該佔 header,退到訂單 tab 更合理。header 變乾淨。

### Q2 新增客人 — 維持 AI 對話建,講清楚 + 刪孤兒

決策:+ 按鈕維持聚焦 AI 對話(讓你打字叫 AI 建),但改提示/label 讓人一眼看出是「叫 AI 新增」,聚焦時可預填一句模板。刪掉孤兒 `AddCustomerDialog.tsx`。不接彈窗表單。

### Q3 回信通知 — 後台紅點刷快,不推手機

決策:真因是 `gmailPollQueue` 每 10 分才 ingest(queue.ts:660,681),不是 UI。把 cadence 縮到 2-3 分(一人量級 Gmail quota 無虞)+ UI 視窗聚焦時刷未讀。不推手機/簡訊。客人回信本來就即時進你 Gmail。改 cadence 須 prod 生效。

### Q4 跟進日 + Google 日曆 — 分兩段

決策:
- Phase A(這個月):customerProfiles 加 `followUpDate` 欄 + migration;客戶頁可設/清跟進日;到日在真相條/inbox 浮出。deterministic,不碰 LLM/客人。
- Phase B(排後):設跟進日時同步寫一筆到你的 Google 日曆。前置:prod app 要加 Calendar write scope(現有 Google OAuth 只有 Gmail scope;本 session 的 Calendar MCP 不能用在 prod app)。

## 四、燈號 / 工量(打磨四題)

| 題 | 決策 | 燈號 | 工量 |
|----|------|------|------|
| Q1 | 移除 header 三顆,訂單退 tab,看門狗留 | 綠 | 小 |
| Q2 | + 按鈕講清楚 + 刪孤兒 | 綠 | 小 |
| Q3 | 縮 poll 10→2-3 分 + focus 刷 | 綠 | 小,須 ship |
| Q4-A | followUpDate 欄 + 設定 + 浮出 | 綠 | 小-中,migration |
| Q4-B | 同步 Google 日曆 | 黃 | 中,OAuth 前置 |

## 五、下一步

四題打磨都已拍板,可進 design → tasks → code。各題互不依賴。部署照 Jeff 規矩:分支開發 → 測試 → 給 Jeff 看 → 他同意才 `pnpm ship`(CLAUDE.md §4.3,session 不自行部署)。合併的範圍與順序見 consolidation-plan.md。
