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
- **批1 m2 完成(同日)**:抽共用 ReviewTaskDialog(全文過目 + hard_gate 逐筆 confirm),ApprovalInbox 與 今日待辦 同一條核准路徑;today 卡「審核」鈕開 dialog;誠實 toast 抽 approveToast.ts(cs=已送出/他 lane=已記錄/failed=帶因)+4 測試;failed 卡顯示 errorMessage。workspaceI18n 掃描補 ws-ui/ 子目錄(拆檔後漏掃)。終點 10 頁對照(44584f3)印證方向:command-center 任務=今日待辦卡片。
- **批1 m2 已上線 v686(同日,Jeff token,DNS 失敗重試一次成功)**:bundle 驗證 `review:"審核"` + `jumpTo:"去{name}"` 都在。
- **批1 m3a spam 匣完成(同日,Jeff 拍板救回=建詢問+跑 agent)**:migration 0090 spamVerdict + spamBox.ts(rescue 先建 inquiry 再標 rescued 才跑 LLM,防重複;agent 失敗誠實回報)+ commandCenter 三 procedure + 今日待辦疑似垃圾匣(確認垃圾淡化保留,永不刪)。+8 測試,全綠待 ship。
- **批1 m3b escalation 進今日待辦完成(2026-06-10)**:escalationBox.ts(unread 不設日期窗永不靜默消失 + 已讀近 10 淡化留底;who 走 relatedCustomerProfileId→profiles→users 批量)+ commandCenter escalationList/escalationAck + stats 加 escalationUnread(additive,sidebar badge 含 escalation)。「需要你決定」桶 task+escalation 合併時間軸;**處理好了=readByJeff**(與 agent 對話未讀同一狀態,兩面同步,雙向可反悔);**無新送出路徑**(建議回覆只能看,動作仍在 Gmail/agent 對話)。退款卡 lock+黑 badge 照 full-pages mockup。拆檔還債:WorkspaceToday 363→282 行,抽 TodayTaskCard/TodayEscalationCard/TodaySpamBox。+12 測試;tsc 0;全套 vitest 1525 passed / 0 failed(91 skipped)。m3a+m3b 同船,見下行 v687。
- **v687 shipped(2026-06-10,Jeff token,帶 m3a+m3b)**:七 gate 全過、migration 0090 隨 release 套用、/health 全綠(db 37ms / redis 16ms / stripe 212ms / llm 405ms)、token 用完即焚。線上 bundle 驗證:entry 有 escClsRefund/看全文/「其實是客人,救回」,Workspace chunk 有 escalationList/escalationAck/escalationUnread/spamRescue/spamConfirm;curl `commandCenter.escalationList` 回 FORBIDDEN(路由在、admin 鎖正常)。**Jeff 親驗項:今日待辦 escalation 卡(退款卡有鎖)、勾處理好了後 agent 對話未讀同步減、看全文展開收起、sidebar 今日待辦數字含 escalation、疑似垃圾匣兩鍵、英文模式全英文。**(先 hard refresh 清舊 SW cache 再看)
- 批1 剩 B2 eval(要 Jeff 真信件 gold set),見 tasks/batch-1-today.md。

## 2026-06-10 批2 動工(客戶 + 銷售動作)
- **實況調查 + Stage 3 文件**(tasks/batch-2-customers.md):關鍵發現 = 銷售 5 畫面全是 per-customer 對話的輸出形態(sales mockup sidebar active 都是客人),客戶頁與銷售頁同一個面。GAP:per-customer 對話不存在(chat 全域)、機票無資料線、wechatMessages 無歸戶欄位。
- **批2 m1 完成(同日,零新 schema)**:customerDetail 加 totalSpend(additive)+ commandCenter.get(by id 餵 dialog)+ header 照 mockup(PackPoint · 總消費 · 訂單 + 看完整資料)+ task 卡「審核」走共用 ReviewTaskDialog(同一條 gated 核准路)+ 詢問卡「起草回覆」(produceInquiryReply,審核後才送)+ 已結留底(completed/cancelled 近 5 筆,locked 無 toggle)+ 已收款 open 訂單帶 trust 註記(鐵律可見化)。抽 CustomerDetailSheet 獨立檔(CustomersTabV2 530→268 行,還 300 行債);helpers i18n 還債(titleKey fallback,.ts 零硬編碼中文)。+13 測試;tsc 0;全套 vitest 1538 passed / 0 failed。**待 ship(Jeff token)**。
- **m3-m5 已拍板(同日,Jeff)**:m3 對話=新 customerChatSessions 表;m4 機票=建最小 flightOrders 狀態機(系統永不碰卡號/付款);m5 微信=加歸戶欄 + wechatId 配對。記於 batch-2-customers.md。
- **批2 m2 完成(同日)**:quote 卡上過目層(quoteTask.ts pure parse + QuoteTaskBody,finalPrice 優先/直客價 fallback/客製遊手動註記/來源 src 行,今日待辦+客戶 inbox 共用,解析不出退 summary)+ customerOpenItems.pendingTasks 加 payload(additive)+ customerDetail.recentQuotes(aiQuotes by userId OR email)→ 客戶 inbox「報價記錄」唯讀段(開 PDF)。誠實 gap 記錄:佔床表/旺季 warn 需 producer 加欄、tool-quote 無持久化,都不虛構(見 batch-2 文件)。+6 測試;tsc 0;全套 vitest 1550 passed / 0 failed。
- **批2 m3 v1 完成(同日,Jeff 拍板續做不先 ship)**:migration 0091 `customerChatMessages`(獨立新表拍板)+ ask-ops-stream 加選用 customerId(同一條 hardened SSE,歷史/持久化分流,auth/CSRF/限流/逾時全繼承)+ customerChatContext(pure 格式化 +6 測試,cap 5/2400,db 掛降級不釘人)+ runOpsAgentStream 加 extraSystem + CustomerChat.tsx(thread+composer 照 mockup,Stop,Streamdown)+ admin.customerChatList。**v1 純文字:actions/cards 持久化但不渲染不可觸發(零新送出路徑),m3b 經 gated chips 渲染輸出卡**。tsc 0;全套 vitest 1560 passed / 0 failed。
- **v689 shipped(同日,Jeff token,批2 m1+m2+m3 + migration 0091)**:過程曲折誠實記錄 — 第一跑 v688 在 flyctl 部署後驗證階段斷線(機器已更新、程式實際已上線、bundle 標誌全中,但 release 標 interrupted、token 未燒);重跑被 Jeff 誤暫停凍結,解凍後自己跑完 = **v689 complete**,token 用完即焚,/health 全綠(db 49ms / redis 18ms / stripe 296ms / llm 322ms)。線上驗證:entry 有 跟Agent聊/報價記錄/直客價/總消費,CustomerInbox chunk 有 customerChatList/chatPlaceholder/quoteRecords,curl `admin.customerChatList` 回 FORBIDDEN(admin 鎖正常)。**Jeff 親驗項(hard refresh 後):客戶 inbox header(總消費+看完整資料)、task 卡審核/詢問卡起草、報價卡價格塊+來源行、已結留底、報價記錄段、底部 composer 跟 agent 聊該客人(串流+Stop)、英文模式全英。**
- **MCP 瀏覽器驗收(同日,Claude in Chrome 對 prod /workspace,唯讀安全模式)**:✅ 今日待辦(greeting/計數、escalation 卡含 🔒退款 黑 badge、看全文展開含附件狀態+未送草稿、處理好了雙向 toggle 含 sidebar badge 2↔1 同步、已讀淡化下沉、誠實空桶)✅ 疑似垃圾匣(29 筆、兩鍵在、已確認垃圾淡化保留)✅ 客戶 inbox header(PackPoint·總消費·訂單+看完整資料 Sheet)✅ per-customer 對話(Jeff 實際已用:找台灣團 15 團 + 「新客 0 筆訂單」= context 注入生效、台南高雄真實班次餘位 = 唯讀工具生效、歷史跨 reload 保存 = 0091 表生效)✅ 英文模式全英(DB 內容豁免正確)。**沒資料測不到**:審核 dialog、報價卡價格塊、已結留底/報價記錄段(單元測試有蓋,真資料出現看一眼即可)。**刻意不按**:救回/確定垃圾/起草/核准。觀察 3 件:① 舊 escalation 理由行是 B1 前的 log 話(舊資料,自然淘汰)② 垃圾匣多為自家 support@ 系統監控信 → 已開 task 在 gmailPipeline 入口擋自家寄件人 ③ 詳情 Sheet 詢問數 3 vs 詢問紀錄空(users.inquiryCount 快取與 userId-link 口徑差,小資料債)。
- **批2 m3b 完成(同日)**:客戶對話 agent turn 渲染 OpsCards(重用,AgentChatPage 只加 export)+ action chips(歷史 context JSON 復原 + 串流 done 事件);chips 點擊一律開確認 dialog(sensitive 打 CONFIRM、警告粗黑非紅)→ 既有 agent.executeOpsAction,零新執行路徑;customerChatList 加 context 欄;context 注入改真實機制說明(撤 v1 無按鈕止血)。+3 測試;tsc 0;全套 vitest 1563 passed / 0 failed。**待 ship**。
- **批2 m4 完成(同日)**:migration 0092 flightOrders(表上無護照號/卡號欄位,結構性守鐵則)+ flightOrderBox 狀態機(備訂→待你刷卡→TICKETED;ticketed 永不可 cancel;+10 測試)+ flightOrders router + 客戶 inbox 機票區(黑鎖條、我來刷卡只開外部頁、出票純記錄、TICKETED 黑卡)。報價記錄抽檔還行數債。tsc 0;全套 vitest 1597 passed / 0 failed。**待 ship(與 m3b 同船,含 migration 0091+0092)**。
- **批2 m5 完成(同日)= 批2 全 milestone 完成**:migration 0093 wechatMessages.customerUserId + 自動歸戶(wechatCustomerMatch,openId↔wechatId,+3 測試)+ listForCustomer/assignCustomer + 客戶 inbox 微信區(核實:approve 本來就只記錄不發送,UI 照實 = 複製→你微信親貼→回來記錄)。tsc 0;全套 vitest 1613 passed / 0 failed。
- **批2 待 ship 一覽(4 commit + migration 0092/0093)**:db19477 止血、52c3997 m3b、0805f67 m4、(m5 commit)。卡點:mobile 並行 session 未收檔(gate 2)。
- 批2 後續(非阻擋):agent 機票選項卡/確認單 PDF 接 skill/出票短訊、客製卡型(找團列帶動作鈕/比較表/客製逐日)、微信未歸戶池 UI。

## 2026-06-11 批4 + 批5 完成(同 session)
- **批4 行銷全 5 milestone 完成 + commit**(4861fc2 + aea6946):MarketingHub(campaigns/posters/newsletter/AI gen 4 sub-view)+ PosterDistribution(7 平台文案,approve/archive 🔒)+ PosterGenerator(cost gate 🔒)+ SixPlatformComposer(generate ≠ publish 鎖)。全套 vitest 抓到 2 個漏 i18n key 已補。批4 殘項:M5 價格驗證(海報價 vs 後台價)待接、手機截圖(Jeff 跳過)、Jeff 親驗。
- **批5 供應商全 5 milestone 完成 + 逐 milestone commit**(651bee7 m1 / 7238cca m2 / e1709e6 m3 / 60066fd m4 / m5 見下):
  - m1 同步:WorkspaceSuppliers 取代 SupplierEnrichmentTabV2;per-supplier 卡 + 最近 runs(failed 黑左條誠實帶 errorMessage)+ 立即同步 dialog
  - m2 監控:KPI 5 格 + 卡片分類(價格變動/新缺貨/變動/錯誤,ok 過濾)+ **碰錢:更新我的售價 = 🔒 checkbox confirm → 既有 tours.update**;維持原價 = workspaceDispositions("monitor_log" additive)淡化留底;getRecentMonitorLogs LEFT JOIN tours(additive)
  - m3 商品庫:enrichment 進度卡(吸收 SupplierEnrichmentTabV2)+ listProducts 篩選/分頁 + 單品/批量匯入 + 隱藏
  - m4 競品:縮編拍板執行 — 每週摘要卡(近 7 天分組)+ 告警列表(severity 左黑條)+ 最小管理;不重建 929 行 tab
  - m5 毛利:新唯讀 `suppliers.marginAudit`(sourceUrl SUBSTRING_INDEX 取碼 equi-join,幣別不同不換匯誠實標示)+ 毛利卡 <15% 黑框警告 + 同一條 🔒 改價路徑
- 驗證:tsc 0;全套 vitest **2049 passed / 0 failed**(基線 1885 → +164);i18n 7149 keys 100% parity;300 行紅線 10 檔全守。
- **批5 待辦**:marginAudit SQL 對真 DB 驗證(本機無 .env)+ Jeff prod 親驗。

## 2026-06-11 批7 + 批3 + 批8 完成(同 session)= **8 批全部 built**
- **批7 行程管理全完成**(296620e m1+m2 / 0870cc0 m3+m4):行程庫進 workspace(公司第 6 sub-item,健檢出入 3 補回)+ 單一行程全貌(圖片/路線地圖卡含 fallback 警示/每日行程 timeline/價格毛利(marginAudit tourId 模式)/出發日庫存/內含不含)+ 動作列(編輯重用 TourEditDialog、上架 🔒、下架 confirm、featured、預覽)+ calibration 內嵌(5 分項展開 + pending approve 🔒/reject,吸收 calibration-review)。誠實 gaps:帶去報價/做文案/per-image 補圖/per-tour composer/per-tour 班次重整 — 不放死按鈕。
- **批3 財務全完成**(6f27337,碰錢批拍板:只重排版 reuse mutation):WorkspaceLedger 4 sub-views — 待分類卡(needsTriage + AI 建議信心 + canonical 10 分類,reuse transactionUpdate)/ 信託(餘額 drift 照實 + 認列卡 🔒 trustRecognizeNow + 在途明細)/ 催款唯讀(bookings 應收 + T-n 逾期排序;草稿送出無後端誠實標示)/ 全部交易 = BankLedgerV2 原樣。**版面待 Jeff 親驗後才接新動作線(催款送出等)。**
- **批8 系統全完成**(見本 commit):WorkspaceSystem 單頁 5 段(公司第 7 sub-item)— agent 7 天統計/技能列表/AI 成本 tiles + model 分布 + 快取命中/任務記錄/審計日誌(Jeff⚫ vs agent🤖)+ cleanup 降級 note。gaps:agent 開關、技能試跑(皆無後端)。
- 驗證:tsc 0;全套 vitest **2219 passed / 0 failed**;i18n 7296 keys 100% parity;300 行紅線全守;每批 Stage 3 文件(batch-3/7/8)。
- **8 批狀態:1 ✓ 2 ✓ 3 ✓(版面)4 ✓ 5 ✓ 6 ✓ 7 ✓ 8 ✓ — 全部 built。**

## v690 shipped(2026-06-11,Jeff 親自跑 `DEPLOY_TOKEN=… pnpm ship`)
- 七 gate 全過:main ✓ tree 乾淨 ✓ origin 同步 ✓ migration 列表(0091-0093 隨 release 套用,含批2 待 ship 的 0092 flightOrders + 0093 wechatCustomer)✓ tsc 0 ✓ vitest 2219 passed ✓ token 核對 ✓(用完即焚)。
- 過程記錄:第一跑被 gate 7 擋(env DEPLOY_TOKEN 不在 session shell — 設計如此),Jeff 在自己 terminal 帶 env 跑成功。
- /health 全綠:db 41ms / redis 15ms / stripe 253ms / llm 442ms。release_command migrate 成功。
- 線上 bundle 驗證(index-CgsaKXz2.js):supSyncNow / trsBack / ldgTriage / sysAgents / companyTours / companySystem 全部 grep 到 — 批5/7/3/8 代碼確認在線上。
- **Jeff 親驗項(hard refresh 清 SW cache 後看 /workspace 全公司事務)**:① 行程庫(列表+點進全貌:圖/地圖/每日行程/毛利/庫存/品質;上架鎖)② 記帳四區(待分類卡/信託認列鎖/催款唯讀/全部交易)— **碰錢批,版面點頭後才接催款送出等新動作線** ③ 供應商四區(同步/監控含改價鎖/商品庫/競品摘要)+ 毛利卡對一筆真資料(marginAudit SQL 首次見真 DB)④ 行銷四區(批4 一併看)⑤ 系統頁五段 ⑥ 英文模式全英。
- 全看過沒問題 → 切換條件達成,下一步 = App.tsx `/admin` → Workspace 一次 flip(AdminV2 留檔)。

## v691 + v692 shipped(2026-06-11 晚,UAT 修復輪)
- **深度 UAT(獨立 session,Claude in Chrome 對 prod)**:報告 verify-v690.md(17 節 + 結論三檔)。客人端/批3/批8/批2/6 全 Pass;email 全鏈 end-to-end 過(分類「行程比較」正確、草稿品質過鐵律、Jeff 測試信 47 分鐘進待辦);AI 海報真生成 1 張($0.07,費用追蹤一致)。抓到 P1×1 + P2×3。
- **v691(P1+P2 三修)**:B-01 marginAudit CASE-in-JOIN → derived table + 前端 retry:false/誠實錯誤行;B-02 AI 對話歷史 — 根因是 listMessages 的 AGENT_NAMES enum 沒有 "ops"(client `as any` 蓋住),歷史資料一直都在 DB;B-04 newsletter raw JSON 雙端容錯。
- **v691 重驗(獨立 session)**:歷史 ✅;毛利 ❌ 判定為誤判(flyctl ssh 直跑 SQL 794ms 5 筆真資料;重驗分頁 console 是部署前殘留)— **教訓:重驗必須先 hard reload + 看時戳**;newsletter ❌ 為真 — 第三種 LLM 形狀(巢狀 content 物件)。
- **v692**:normalizePlatformCopy + posterProcessor 擴充 shape 3(subject_line/body 等欄位組合,bullet array 逐行;真不認識才保 raw)。/health 全綠,token 用完即焚。
- **毛利真資料觀察**:Lion 成本 TWD vs 售價 USD → 照設計顯示「幣別不同」;真毛利要接 exchangeRate 換算(已有 router),列下批。
- **下批 backlog(UAT 產出)**:B-03 海報 price-in-image guard(P2)、毛利匯率換算、行程庫 pageSize 1000 cap(2,635 筆只顯示 1000 + 8-10s 載入 → server 分頁/virtual scroll)、B-05 淨利 alert 雙桶重複、B-06 EN 模式 AI 分類標籤、批3 匯出稽核 §17550 鈕 + 「全部接受 AI 建議」鈕(mockup 缺項)、cost gate dialog a11y description×3。
- **flip /admin 條件**:UAT 結論 = 修完 P1+P2(已完成並上線)→ 條件達成,等 Jeff 一聲令下把 /admin 指向 Workspace(AdminV2 留檔)。順帶:舊 /admin 工作台→行程已壞(badge 2635/列表 0),flip 後自然解決。

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
