# 批2 — 客戶 + 銷售動作(customers-crm · packpoint · ai-quotes · tool-quote · wechat-assist)

> Stage 3 task 文件。設計依據:admin-inbox-per-customer.html + admin-pages-sales.html(5 畫面)+ design.md。
> customers-landing 已砍(2026-06-09 拍板,設計使其失業)。批1 已全上線(v687)。

## 實況調查(2026-06-10)

### 關鍵架構發現
**銷售 5 畫面不是獨立 tab,全是「客戶 inbox 裡的對話 + 卡片」**:sales mockup 每張 screen 的 sidebar active 都是某個客人;找團/報價/機票/客製/比較 = per-customer 對話的 5 種輸出形態。終點「客戶」頁與「銷售」頁是同一個面:客戶 header + 時間軸卡 + 底部 composer「跟 Agent 聊陳美玲的事…」。

### 現有資產(可重用)
- `CustomerInbox.tsx`(批0 P2/P3):header + open items(booking/inquiry/task)+ 處理好了 toggle ✓
- `admin.customerList / customerDetail`(read-only CRM)、`admin.customerOpenItems`(inbox 脊椎)✓
- `ReviewTaskDialog`(批1 m2 共用核准路)— 客戶頁 task 卡直接掛 ✓
- `commandCenter.produceInquiryReply`(起草)✓;quote/cs executors(送出走 gated approve)✓
- packpoint:餘額已在 header;`packpoint.adminAdjust`(碰錢)掛詳情抽屜
- ai-quotes(`aiQuotes.adminList/adminMarkConverted`)、tool-quote(`tools.generateQuote` PDF 管線)、wechat-assist(`wechatAssist.listPending/draftReply/approve`)

### 缺口(GAP)
1. **per-customer 對話不存在**:chat 全域(AgentChatPage/ops),無 customer 綁定欄位、無 per-customer context 注入。= 批2 最大新建項。
2. **機票無資料線**:訂位/待刷卡/TICKETED 無 schema(現況 = Jeff 手動 Trip.com + flight-ticket skill 出 PDF)。
3. **wechatMessages 無歸戶欄位**(無 userId/profileId/email)→ 訊息進不了客人時間軸。
4. helpers 有硬編碼中文 fallback(「行程」「詢問」),i18n guard 抓不到 .ts 字面量。

## Milestones

### m1 — 客戶 inbox 充實(零新 schema,2026-06-10 動工)
- [ ] `customerDetail.user` 加 `totalSpend`(additive,同 customerList 子查詢口徑:非 cancelled 加總)。
- [ ] header 照 mockup:`PackPoint X · 總消費 $Y · 訂單 N` + 「看完整資料」→ 抽 `CustomerDetailSheet` 成獨立檔(admin-v2 原檔內私有 → export,行為不動),CustomerInbox 開同一個 Sheet。
- [ ] task 卡(pending)加「審核」→ 共用 ReviewTaskDialog;新 `commandCenter.get`(by id,回完整 row)供 dialog 餵 task。同一條 gated 核准路,零新碰錢路徑。
- [ ] 詢問卡(open inquiry)加「起草回覆」→ `produceInquiryReply` → toast + invalidate(草稿 task 出現在同 inbox + 今日待辦)。
- [ ] done 留底:customerDetail.recentBookings 中 completed/cancelled → 時間軸 done 卡(淡化、無 toggle = locked 事實狀態),bounded 近 5 筆。
- [ ] paid 註記(鐵律可見化):open booking 卡 paymentStatus=paid 時加一行「訂金已收,出發後才認列營收」(policy line,i18n)。
- [ ] helpers i18n 還債:title fallback 改 key(零 .ts 硬編碼中文)。
- [ ] Vitest:helpers(closed merge + locked)、commandCenter.get。

### m2 — 報價深化(沿用 gated 路;2026-06-10 完成)
- [x] 報價 task 卡上過目層:`quoteTask.ts`(pure parse,+5 測試)+ `QuoteTaskBody`(價格 finalPrice 優先 / 直客價 fallback、客製遊需手動報價、來源 src 行「單價取自供應商後台直客價」)。今日待辦 + 客戶 inbox 兩處共用;解析不出退回 summary。動作仍走 ReviewTaskDialog(改金額 = editedPayload,核准 = 既有 approve)。
- [x] customerOpenItems pendingTasks 加 payload(additive);customerDetail 加 recentQuotes(aiQuotes by userId OR email,近 5 筆)→ 客戶 inbox「報價記錄」唯讀段(quoteNumber · 金額 · 狀態 · 開 PDF)。
- **誠實範圍記錄**:(a) mockup p2 的佔床編輯表**沒做**:quoteProducer payload 無大人/兒童/單房差欄位,卡上不虛構;要做需 producer 加欄(列 m3+ 或之後)。(b) **tool-quote PDF 不在時間軸**:`tools.generateQuote` 無持久化(只回 S3 URL 不落 DB),要列須先建表;先記 gap 不硬塞。(c) 旺季 warn 同理,payload 無季節欄位。

### m3 — per-customer 對話(LARGE;**2026-06-10 Jeff 拍板:新表,同日完成 v1**)
- [x] 新表 `customerChatMessages`(拍板「獨立新表不混 agentMessages」的實作名;一客一線程存訊息,無 session 分段)+ migration 0091(冪等 CREATE TABLE IF NOT EXISTS + journal idx 91)。
- [x] **共用既有 hardened SSE 管線**:`/api/agent/ask-ops-stream` 加選用 `customerId`(SSE 前驗證回 JSON 錯誤;歷史/提問/回答持久化分流到新表;auth/CSRF/30 每小時限流/心跳/90s 逾時全繼承,不開第二條管線)。
- [x] context 注入:`server/_core/customerChatContext.ts`(pure `formatCustomerContext` +6 測試:客人 profile + 進行中訂單 + 開著詢問 + 近期報價,各 cap 5、全塊 cap 2400 字;db 掛了誠實降級成不釘人的對話)→ `runOpsAgentStream` 加 `extraSystem` 參數(ops 行為不變)。agent 原有唯讀查詢工具(search_tours 等)照用 = 找團能力天然存在。
- [x] UI:`CustomerChat.tsx`(thread + composer 照 mockup 黑框文法;fetch-stream + Stop;Streamdown 渲染 agent turn)掛在 CustomerInbox 底部;`admin.customerChatList` 供歷史。
- ~~v1 誠實範圍:純文字對話~~ → **m3b 完成(2026-06-10 同日)**:
  - [x] agent turn 渲染 data cards(重用 AgentChatPage 的 OpsCards,只加 export 兩字,4 型:departures/bookings/customers/finance)+ suggested-action chips(歷史從 context JSON 復原 `customerChatExtras.ts` +2 測試;串流從 done 事件)。
  - [x] **chips 全 gated**:點擊永不直接執行 → `CustomerChatActions.tsx` 確認 dialog(args 全文過目;sensitive 要打 CONFIRM;警告粗黑非紅守黑白鐵則)→ 走既有 `agent.executeOpsAction`(admin 鎖 + server audit),零新執行路徑。執行後 invalidate 對話/openItems/今日待辦。
  - [x] customerChatList 加 context 欄(additive);context 注入改為真實機制說明(點了還要確認才執行,確認前不得假設已完成),撤 v1 無按鈕止血行。
  - 誠實範圍:渲染的卡 = agent 既有 4 型;sales p1/p4/p5 的「找團結果列每列帶報價/傳客人鈕、比較表、客製逐日」客製卡型要 agent 端新 card type + producer 接線,歸 m4/批2 後續,不虛構。

### m4 — 機票面(**2026-06-10 Jeff 拍板:建最小 flightOrders 狀態機;同日完成 v1**)
- [x] migration 0092 `flightOrders` + schema:**表上刻意沒有護照號欄位**(只存護照拼音姓名,passport 加密鐵則從結構上不可能違反)、沒有任何卡號/付款欄位。
- [x] `flightOrderBox.ts` 狀態機(+10 測試):prepared → awaiting_payment → ticketed;create 帶 bookingUrl 直接落 awaiting(真實入口);markTicketed 允許從 prepared/awaiting(一人公司先付後記)、永不從 ticketed/cancelled;**ticketed 永不可 cancel**(退票=真退款流程,不在 v1);每個 mutation audit。
- [x] tRPC `flightOrders.*`(list/create/markAwaitingPayment/markTicketed/cancel,adminProcedure)。
- [x] 客戶 inbox 機票區(照 sales p3):有未結單時顯示**不可關閉黑鎖條**「付款由你本人刷卡…」;待刷卡卡帶黑底提醒 +「我來刷卡」**只開外部訂購頁**;出票 = 純記錄表單(PNR/票號/訂單編號);TICKETED 黑卡留底。建立/出票 dialog 拆 `FlightOrderDialogs.tsx`;報價記錄抽 `CustomerQuoteRecords.tsx`(行數債);零待辦客人也看得到機票區(空狀態外)。
- 後續(不在 v1):agent 出機票選項卡(sales p3 上半)+ suggest_action 建備訂、確認單 PDF 接 flight-ticket skill、出票後客人短訊草稿。

### m5 — wechat-assist 歸戶(**2026-06-10 Jeff 拍板:加歸戶欄 + 配對**)
- 拍板:wechatMessages 加 userId(nullable)+ 用 customerProfiles.wechatId 配對 + 人工補配;訊息進客人時間軸。
- approve(真送微信)維持逐筆 gated。

## 驗證(每 milestone,同批1)
- tsc 0;vitest 綠(workspace + 相關 router);新元件零 JSX/TS 硬編碼中文;Sheet padding 守 §2.5。
- ship 後 curl bundle 標誌字串;Jeff prod 親驗。
