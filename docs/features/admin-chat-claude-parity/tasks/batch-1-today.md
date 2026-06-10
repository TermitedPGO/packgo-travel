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

### m3 — 詢問(inquiries)workspace 視圖
- [ ] InquiriesTab 功能 1:1:清單、AI 草稿狀態、spam 匣(救回鐵律)、緊急置頂。
- [ ] 卡片文法 + 未處理/處理好了 disposition。

## 驗證(每模組)
- tsc 0;`npx vitest run client/src/components/workspace server/_core/approvalTaskWho.test.ts server/routers/commandCenter.test.ts` 綠。
- 新元件零 JSX 硬編碼中文(CJK 掃描)。
- ship 後 curl 線上 bundle grep 標誌字串。
