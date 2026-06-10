# 批1 — 今日待辦完整化(today · command-center · inquiries)

> Stage 3 task 文件。設計依據:design.md §3.2(三桶)+ admin-inbox-integrated.html。
> 2026-06-09 Jeff 拍板順序 1 → 2 → 6 → 4 → 5 → 7 → 3 → 8,批1 先行。

## 模組

### m1 — @客戶 chip + 「去X」跳轉(2026-06-09 動工)
- [x] `server/_core/approvalTaskWho.ts`:
  - `extractCustomerRef(lane, payload)` 純函式:cs → inquiryId;quote → customerEmail/customerName;marketing/finance → null。壞 JSON / 缺欄位回 null,不丟錯。
  - `enrichTasksWithWho(tasks)`:批量 `inArray` 查 inquiries(拿 userId + customerName)與 users(by email),零 N+1。回 `who: { label, userId | null } | null`。
- [x] `commandCenter.list` 回傳 enriched rows(只加欄位,5 個既有消費者不動)。
- [x] WorkspaceToday:cs/quote 卡顯示 `@客戶名`;`who.userId` 存在才顯示「去X」跳轉(guest 詢問誠實降級:有名無跳轉);marketing/finance 顯示 🏢 全公司。
- [x] Workspace.tsx 傳 `onJumpToCustomer` → `setView({ type: "customer", userId })`。
- [x] Vitest:extractCustomerRef 全 lane + 壞 payload 案例。
- 資料形狀依據(2026-06-09 實測):cs payload 有 `inquiryId`(inquiries.userId nullable,guest);quote payload 的 relatedId 指 tour,客人只有 optional `customerName`/`customerEmail`。

### m2 — 卡片動作層(2026-06-09 完成)
- [x] 抽共用 `ReviewTaskDialog`(admin-v2/CommandCenter):全文過目(LanePayloadBody,cs 草稿可編輯)+ hard_gate 逐筆 confirm + reject reason。ApprovalInbox 與 今日待辦 共用同一條核准路徑(UI 上只有一種核准方式)。
- [x] 今日待辦「等你決定」卡(pending 且未勾)帶「審核」主動作,開 shared dialog;沿用 commandCenter.approve / reject,零新碰錢路徑。
- [x] executor 結果誠實回報抽純函式 `approveToast.ts`(cs sent=已送出、其他 lane=已記錄、failed=帶 errorMessage)+ 4 測試;兩處共用。
- [x] failed 卡直接顯示 errorMessage(粗黑非紅)。
- 設計取捨(對照 mockup):cards-states 的「動作直接在卡上」前提是過目內容已在卡上;today 卡目前只有 title+summary,直接「核准」= 沒過目就送(違鐵律 2),故動作開 dialog 過目。批2+ 把 per-lane 豐富內容上卡後,動作才照 mockup 直接上卡。

### m3 — 詢問 roll-up + spam 匣(2026-06-09 實況調查完,動工前要 Jeff 拍板)

終點藍圖:inquiries 不做獨立視圖,roll-up 進今日待辦。實測詢問有**三個資料源**:
1. `inquiries` 表(網站表單)→ 已在客戶 inbox(customerOpenItems);有 AI 草稿的會變 cs approval task → 今日待辦卡(m1+m2 已蓋)。
2. `customerInteractions`(Gmail inbound,含 classification="spam")→ 每封都留底(原始記錄不丟)但**不進今日待辦**;spam 只發 observation 到 #inquiry 頻道。
3. `agentMessages`(escalation,B1 已講人話)→ 顯示在 agent 對話,不在今日待辦。

**2026-06-09 Jeff 拍板:救回 = (a) 建正式 inquiry + 跑 InquiryAgent 出草稿(同正常 inbound 一條路)。**

- [x] **m3a spam 匣(同日完成)**:migration 0090 `customerInteractions.spamVerdict`(NULL=待判 / rescued / confirmed_spam,確認垃圾保留不刪)+ `server/_core/spamBox.ts`(listSpam / rescue / confirm,rescue 先建 inquiry 再標 rescued 才跑 LLM,重按不會重複建;agent 掛了誠實回 agentError)+ commandCenter spamList/spamRescue/spamConfirm + 今日待辦疑似垃圾匣 UI(兩鍵 BtnO 照 cards-states,判決後淡化留底)。+8 測試。
- [x] **m3b escalation 進今日待辦(2026-06-10 完成)**:`server/_core/escalationBox.ts`(listEscalations:unread 全列不設日期窗 + 已讀近 10 筆淡化留底;who 由 relatedCustomerProfileId → customerProfiles → users 兩段批量 inArray,guest 誠實降級 userId=null;classification 從 context JSON 容錯 parse)+ commandCenter `escalationList`/`escalationAck` + stats 加 `escalationUnread`(additive,sidebar 今日待辦 badge 含 escalation)。今日待辦「需要你決定」桶合併 approval task + escalation 同一時間軸(未處理在前、新的在前)。+11 測試(escalationBox)+1(stats additive)。
  - **處理好了 = readByJeff**:跟 agent 對話未讀 badge 同一個狀態(單一事實源,勾這邊那邊也清),雙向 toggle 可反悔;卡片淡化下沉不消失。
  - **無新送出路徑(鐵律)**:escalation 的「建議回覆」不是 approval task,卡上只有 看全文/處理好了/去X,動作仍走 Gmail / agent 對話。
  - badge:refund(agentName 或 classification)→退款+lock(碰錢);complaint→客訴;spam→疑似垃圾;其他→詢問(laneCs)。title/body 是 DB 內容(B1 已講人話),i18n 豁免。
  - 拆檔還債(§9.6 300 行):WorkspaceToday 363→282,抽 TodayTaskCard / TodayEscalationCard / TodaySpamBox。
- [ ] B2 配套(task #93):InquiryAgent spam 辨識 eval,要 Jeff 給真信件 gold set。

## 驗證(每模組)
- tsc 0;`npx vitest run client/src/components/workspace server/_core/approvalTaskWho.test.ts server/routers/commandCenter.test.ts` 綠。
- 新元件零 JSX 硬編碼中文(CJK 掃描)。
- ship 後 curl 線上 bundle grep 標誌字串。
