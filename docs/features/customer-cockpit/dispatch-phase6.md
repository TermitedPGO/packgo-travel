# 派工單:Phase 6 收官批(清舊帳 A + 專案歸屬 B + 收斂 C + 自我體檢 D)

> 監工(Fable)2026-07-03 簽發。開工前必讀:`CLAUDE.md`、`docs/agent/30-templates.md`(T6 報告格式 + 兩個 universal traps)、`docs/features/customer-cockpit/progress.md` 最後五節。本單所有 file:line 錨點來自 2026-07-03 偵察,動手前先 Read 確認現狀沒漂移。

## 紀律(每塊都一樣)

- 每塊獨立 Workflow 四階段:實作 → 對抗審查(至少 3 路)→ 修復 → 驗收。
- tsc 用 `NODE_OPTIONS="--max-old-space-size=6144"` 背景跑;每塊 commit 前全套 vitest 綠 + tsc 0 錯。
- commit 訊息前綴 `feat(customer-cockpit): 6X ...` 或 `fix(...)`;一塊一個(或少數幾個)commit。
- 不 ship。全部做完寫 T6 報告到 `docs/features/customer-cockpit/t6-report-<date>-phase6.md`,回寫 progress.md,最後給 Jeff ship 指令區塊。
- 遇到本單沒授權的範圍擴張:停下來回報,不自作主張。
- 在 main 上工作。若你在 worktree/side branch,收工前必須 merge 回 main 並確認 `git log main` 含你全部 commit(上一批的教訓)。

## 硬紅線(違反=立即停)

1. customerProfiles.email 永不加 UNIQUE 索引(0109 合併架構:被併走的卡保留 email 是合法狀態)。DB 層根治=虛擬欄位 canonicalEmail 方案,獨立任務,本批不碰。
2. AI 不自動寄客人信、不報價、不碰錢。本批新增的 cron 全部只讀+寫內部卡,零寄信路徑(對抗審查必驗這條)。
3. 供應商成本絕不投影到客人面。
4. i18n:JSX 禁硬編碼中文,zh-TW/en 同步;刪元件時兩邊 key 同步刪(parity hook 會擋)。
5. 時區:任何「今天」邊界計算,兩端都走 America/Los_Angeles 曆日換算。
6. 業主本人聯絡方式(jeffhsieh09/0909、support@、+1 510-634-2307)絕不當客人資料處理。

## 塊 A:清舊帳小修(7 小項,一個 workflow 打包)

A1 自家信跳過 LLM。`server/agents/autonomous/gmailPipeline.ts`:OWN_EMAILS 防火牆在 :700(isOwnEmail :362),目前命中只是不建卡,信照樣走到 :865 runInquiryAgent 燒 LLM 分類。改:防火牆命中直接短路跳過 inquiry 分類(比照 isKnownNoise :327 的處理),不建 inbox 卡不燒 LLM。注意:先查 receipt 偵測分支是否依賴自家信箱轉寄(Jeff 會轉發銀行收據);若依賴,只跳過 inquiry 分類、保留 receipt 路徑。對抗審查必驗這條分岔。

A2 列表日期口徑。左欄客人列表會員卡顯示註冊日(0909 顯示 5/13,實際最後往來 7/3)。偵察這路失敗沒有錨點:自行定位 client 列表元件(client/src/components/admin/customers/ 附近)+ `server/routers/adminCustomers.ts` customerList(:208 附近)回傳的日期欄位。口徑改成最後往來時間(lastInboundAt 與最後 outbound interaction 取大;若已有 lastInteractionAt 直接用),會員卡與訪客卡口徑一致。列表排序若跟著日期,一併確認排序合理。

A3 nav badge 口徑。`adminCustomers.ts` customerUnreadCount(:358-414)的 guest 子查詢沒有 guestList(:892)同款的 orderBy+limit(200),badge 可能計入列表看不到的卡。對齊兩者口徑。

A4 escalationBox 寄出後摘要刷新。`server/_core/escalationBox.ts` 寄出成功後(:679-693 記互動之後)fire-and-forget `enqueueCustomerSummaryRefresh(profileId)`(簽名 `server/queue.ts`:837,呼叫範例 gmailPipeline.ts:1603-1613,異常只 log 不拋)。修的是「回完信摘要還停在 21 小時前」。

A5 create_customer 語境歸位。`server/agents/autonomous/opsAgentStream.ts`:277-280 工具清單組裝:釘住客人(draftProfileId != null)分支移除 CREATE_CUSTOMER_TOOL(opsTools.ts:530),office chat(未釘)保留。staticSystem :254-263 的語境提示同步改。先例=DRAFT_FOLLOWUP_TOOL 的清單級 gating(:138/:279)。動機:在某客人的 chat 裡新增別的客人是語境錯亂(Jeff 明確要求)。

A6 測試帳號排除 helper。建 `server/_core/testAccounts.ts`:`isTestOrOwnerAccount(email?, profileId?)` 涵蓋 OWN_EMAILS + jeffhsieh0909@gmail.com + profileId 2760017/2730002。列表/badge 已天然排除業主(role='user'/userId IS NULL 條件),不要動列表。接線兩處:draftEval 樣本排除、給塊 D 稽核/canary 用。

A7 update_customer_note 回歸測試。偵察確認已是 append 模式(opsTools.ts:1748 先讀現有 note,customerMerge.ts:66 mergeCustomerNote 帶日期戳)。不改 code,只確認有回歸測試鎖住 append 行為(有就在 T6 指出測試名,沒有補一條)。

## 塊 B:專案歸屬(6c 核心)

前提事實(偵察已確認,動手前 Read 再驗):customerInteractions.customOrderId 已存在(drizzle/schema.ts :2861 表 :2901 欄,soft ref 可 NULL);customerDocuments.customOrderId 已存在(migration 0106)。所以 schema 大概率不用動;若需補 index 才開 migration(照 INFORMATION_SCHEMA 冪等慣例+.down)。

B1 收信自動歸屬。`gmailPipeline.ts`:945 insert interaction 時 classification 已可用(:958)。歸屬規則優先 code 後 LLM:① 同 gmailThreadId 前信已掛單 → 繼承;② 客人只有一張進行中專案(listCustomOrdersByProfile,server/db/customOrder.ts:260,排除 completed/cancelled)→ 自動掛;③ 多張進行中 → LLM 從專案清單選(給單號+caseType+destination),不確定 → 留 NULL。鐵律:不確定=NULL,絕不猜。`server/_core/threadFiling.ts`:269 歷史同步只做①thread 繼承(純 code,無 LLM)。

B2 聊天手動掛單。新工具 attach_interaction_to_order(或擴充 update_custom_order,自行判斷哪個介面對 LLM 更不易誤用):把指定 interaction(s) 掛到指定單。跨客戶守門照抄 opsTools.ts:2059-2072(resolveCustomerProfileIds customOrder.ts:100 + orderBelongsToProfiles :145):interaction 和 order 都必須屬於當前釘住客人。只在釘住語境提供(A5 同款 gating)。

B3 chip scope。選了專案 chip(activeProjectId)後:時間軸/最近對話只顯示該單的 interactions(預設只看該單,另給「顯示未歸屬」開關把 customOrderId IS NULL 的灰階列出);AI chat context(`server/_core/customerChatContext.ts` buildCustomerChatContext)接受 activeProjectId,選中時互動/文件段只餵該單(客人層級記憶/身分段保留不動)。前端把 activeProjectId 傳進 chat stream 請求(找 ask-ops-stream 的現有參數形狀)。

B4 存量回填。一次性 admin 端點(照 import-case-file 的 dry_run/confirm 兩段式),對既有 interactions 跑 B1 的①+②規則(不跑 LLM,只做確定性歸屬),dry-run 回統計(多少筆可歸屬/多少留 NULL)。驗收案例:Emerald(多專案,4 張單)和 0909。

## 塊 C:收斂(6a)

目標:舊 workspace 客人 UI 退役,客人唯一入口=/ops/customers。

程序(嚴格照做,S7 偵察圖只當提示不當真相,已知它有標錯案例:AutoSendPolicyCard 被標可刪,實際掛在 WorkspaceSystem 公司層級必留):
1. 先改入口:`client/src/pages/Workspace.tsx` 移除 CustomerInbox(:30-31)+ GuestCustomerPane(:33-34)的 lazy import 與對應 tab/路由,客人入口導向 /ops/customers。
2. 再自建 import graph:從被移除的 import 出發,葉子向上逐層確認「只被即將刪除的鏈引用」才刪;每刪一層跑 tsc。admin-v2/CustomerDetailSheet 偵察顯示只剩 CustomerInbox 引用,應隨鏈退役。
3. 三個陷阱:EscalationReplyDialog(workspace/ 內但被 TodayEscalationCard/TodayAutoReplyBox 用,留);AutoSendPolicyCard(WorkspaceSystem 公司設定,留);workspace/CustomerChat.tsx 與 client/src/components/admin/customers/ 下的 CustomerChat 同名不同檔,別刪錯。
4. 判定不了的元件:留下,列入 T6 已知限制,不硬刪。
5. 路由白名單:client/src 下沒找到 knownRoutes.ts,先定位真檔(SPA route whitelist 確實存在,搜 knownRoutes);路由有任何變動必須同步,否則直開 URL 404。
6. i18n:刪元件後 zh-TW/en 同步清 key。

## 塊 D:自我體檢(6b)

D1 每週正確性稽核 cron。照 queue.ts:812(daily)/:1404(monthly)+ `server/_core/index.ts`:1655-1677 的註冊模式,排每週一 12:00 UTC(美西週日晚)。逐活躍客人(排除 isTestOrOwnerAccount):重算 gatherCustomerFacts 的確定性欄位 vs 已存 aiSummary 對應欄位,材料性差異(交付清單不符/球在誰不符/金額不符)彙總成一張 agentMessages 卡(shape 照 followupScan.ts:254,messageType=proposal,priority 按差異數)。零差異不發卡只 log。LLM 用量:零(全部確定性比對)。

D2 每週 0909 canary(表單版)。cron 對真公開路徑 POST inquiries.create(HTTP 打 localhost 的 tRPC 端點,inquiries.ts:162;不准直呼內部函式,要測的就是完整真路徑)帶標記文字「[canary] 週檢 <date>」;60 秒後驗三件:interaction 落卡 #2760017、jeffhsieh0909@gmail.com 零新卡、lastInboundAt 有更新。失敗 → 高優先 agentMessages 卡;成功 → 只 log。canary 資料落在 0909 測試卡上,已被 A6 排除稽核。email 寄送版 canary(真寄信測收信管線)需要 0909 OAuth + gmailIntegration 只寄不收旗標(migration),列 T6 follow-up,本批不做。

D3 月度 scorecard 桌機腳本。`scripts/monthly-scorecard.mjs` 照 imessage-sync.mjs 模式(TOKEN_PATH ~/.packgo/local-script-token :96;server 端新唯讀端點照 `server/_core/index.ts`:1356 的 imessage-check-known-phones 範本,verifyInternalAuth :1117 帶 tokenEnvVar LOCAL_SCRIPT_TOKEN)。端點回 per-customer 確定性快照(排除測試帳號;不含成本、不含 PII 明細,只回單號/狀態/金額/最後往來);腳本讀桌面 `Pack&Go/客人檔案/總覽_客人總覽.md` 比對出「系統缺席案件」報告 md 存本機(不堆桌面,寫進 客人檔案/_scorecard/)。launchd 每月 1 號。安裝說明照 imessage-sync-setup.md 樣式寫 `docs/features/customer-cockpit/monthly-scorecard-setup.md`。時間吃緊時 D3 可整塊順延下批,在 T6 明說即可。

## 監工已代答的裁示(不用停下來問)

1. B3 chip 預設只看該單,「顯示未歸屬」為開關。
2. D1 零差異不發卡;排程週一 12:00 UTC。
3. D2 先做表單版;email 版列 follow-up 等 Jeff 裁示。
4. C 不確定的元件一律留,不硬刪。
5. A1 若 receipt 依賴自家轉寄,保留 receipt 只跳過 inquiry LLM。
6. 順序 A→B→C→D;A+B commit 完先報告一次(Jeff 可選擇先 ship),C+D 接著做。

## T6 報告額外要求

- 每塊列對抗審查抓到的真缺陷數與分類(prompt 可防/不可預知/執行者失誤)。
- 自曝弱點至少 3 條,標明哪些只能 prod 驗。
- 「待 Jeff 手動」清單(預期至少:ship、D3 桌機 launchd 安裝、canary 首跑觀察)。
