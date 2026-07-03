# Sonnet 5 交接 Prompt — 客戶頁衝 100 分收官批次

> 使用方式:開新 session(Sonnet 5),把下面「=== PROMPT 開始 ===」到「=== PROMPT 結束 ===」整段貼進去。
> 前置狀態:批 1-5 已上線(v780,commit 63f889e/2969bd7/06545c7),基準分 ~75/100。剩餘工程分約 20 分 + 營運分 5 分(那 5 分靠連續一個月零事故,不是工程)。
> 批 5 已解決、不要重做:回信按 thread 所屬 Gmail 帳號路由(多帳號)+ 送信失敗 UI 報錯;同 email 訪客卡自動併入會員卡(進信 heal,server/_core/customerMerge.ts);草稿 U+FFFD 擋;摘要日期 grounding(todayLA)。

=== PROMPT 開始 ===

## 你是誰、在做什麼

你在 PACK&GO 旅行社(一人公司,老闆 Jeff)的 repo `/Users/jeff/Desktop/網站` 工作。目標:把客戶頁駕駛艙(/ops/customers)從現在的 ~75 分推到工程上限 95 分。100 分的定義寫在 `docs/features/customer-cockpit/roadmap-100.md`,先讀它,再讀 `CLAUDE.md`(全部)、`docs/features/customer-cockpit/scorecard-20260701.md`、記憶檔 `project_customer_cockpit`。

## 開工前:一次問完四個裁示(用 AskUserQuestion,不准腦補)

1. 14 個微信/iMessage 存量案批次進場,現在跑還是 Jeff 先手拖 1-2 案驗流程?
2. Plaid 收款建議(碰錢邊界:AI 只出黃卡建議、標記永遠 Jeff 點)做不做?
3. 今日清單放左欄頂部還是中欄空狀態?
4. 「報價出手前案子必須在系統裡」立不立規矩(這條不用寫 code,只是確認)?

問完按答案裁剪工作清單。Jeff 沒點頭的碰錢項目一律跳過。

## 鐵律(違反任何一條 = 整批作廢)

- AI 永遠不自動寄任何東西給客人;不自動產對外報價;不碰錢;付款狀態只有 Jeff 手動標。
- supplierCost / 同業價 / 成本絕不出現在任何客人可見面。
- 部署只走 `pnpm ship`,你絕不代跑、絕不碰 DEPLOY_TOKEN、絕不 `flyctl deploy`。每批 commit 完給 Jeff 貼終端機的 code block(git push → 放 token → pnpm ship)。
- 本機無 DATABASE_URL:DB 探針用 `flyctl ssh sftp put xxx.mjs` + `flyctl ssh console -C "node /tmp/xxx.mjs"`(mysql2 從 /app/node_modules 拿,輸出用 ===JSON_START===/END 包)。唯讀探針隨便跑;任何 prod 寫入只准走網站 UI(browser MCP,Jeff 的 admin session)且只碰測試客人。
- tsc 一律 `NODE_OPTIONS="--max-old-space-size=6144" npx tsc --noEmit` 用 Bash run_in_background 跑再輪詢輸出檔,前景跑會靜默 2-4 分鐘卡死 agent。
- server/_core 與 server/agents/autonomous 禁 console.*(用 createChildLogger);client 禁硬編碼中文(t('key') + zh-TW/en 兩份);新行為必有 vitest;圓角/極簡黑白照 CLAUDE.md §2。
- git:tsc+測試綠就 commit,不問;逐檔 git add,絕不 git add -A(背景可能有並行編輯);commit 訊息繁中、結尾 Co-Authored-By: Claude(對應你的模型名)。
- 給 Jeff 的文字:不用破折號、不用 markdown 粗體、口語簡短繁中。

## 品質紀律(「0 錯誤」的實作方式,不是口號)

每一個工作項都走同一條流水線,一步不省:
1. 實作前先讀現場 code(grep 錨點,確認假設)。
2. 實作 + 單元測試(純函式優先,mock db 照 opsTools.test.ts 的既有模式)。
3. 對抗式審查:用 Workflow 開獨立 reviewer agent 攻擊你的 diff(false-positive 風險、併發、fail-open/fail-closed 方向、既有 caller 波及面),CONFIRMED 的 P0-P2 修完才准 commit。
4. 全套驗證:vitest 全綠 + tsc 0 錯,才進下一項。
5. 每批 ship 後用 0909 測試客人在 prod 實測(劇本見下),截圖 + DB 探針雙證據,不信 UI 的自我宣稱。
6. 重大功能落地後回寫 `docs/features/customer-cockpit/progress.md` 與記憶。

E2E 標準劇本(已建好的測試設施):jeffhsieh0909@gmail.com = 專職測試客人(Google 顯示名 Better way To survive,已移出自家信箱黑名單)。瀏覽器有兩台:一台有 Jeff 的 packgoplay admin session(ops 操作用),一台登著 0909(寄信用);多台 Chrome 連線時 harness 會要你先問 Jeff 選哪台。寄測試信到 support@packgoplay.com 走完整管線(support@ 和 jeffhsieh09 是兩條獨立 gmailIntegration 連線,都會收);注意自寄信是已讀、輪詢只吃未讀,要用 Gmail UI 手動標未讀。0909 的訪客卡+會員卡在批 5 後會於下一封進信自動癒合成一張(會員卡 #2760017)。驗:歸檔、紅點、真相條、草稿、一鍵寄回 0909(批 5 後可用)、回信後紅點再亮。測完把測試單/卡收乾淨(隱藏,不刪有訂單的)。

## 工作清單(按這個順序做,每項含驗收標準)

### 第一塊:全渠道進場(+15,最大的一塊)

1a. 截圖/匯出檔進場:客人頁聊天框丟聊天截圖(圖)或匯出 txt → AI 認人(對既有客人,認不得就問 Jeff)、建 customerInteractions(channel=wechat/sms,**時間戳用對話內的真實時間,不是歸檔時間** — 這是踩過的雷,見記憶「日期真因=歸檔時間冒充事件時間」)、更新真相條。現有拖檔只會存成文件,要升級成讀懂寫進時間軸。圖片走現有 vision 能力;PII 照既有 customerDocsText 的 RAM-only 原則。
   驗收:丟一張微信截圖,3 分鐘內時間軸出現正確時間的互動、真相條正確。
1b. 存量 14 案批次進場:讀 `/Users/jeff/Desktop/Pack&Go/客人檔案/` 各案 `案件資料.md`(結構見記憶「客人檔案歸檔結構」),建 customerProfiles(channel 標對、無 email 用 phone/wechatId)+ customOrders(售價照檔案,全 draft 不標付款)+ 關鍵互動。先 1 案給 Jeff 過目,OK 才批次。**成本欄位絕不從客人檔案的供應商 invoice 帶進客人可見面。**
   驗收:_客人總覽.md 的每個活案在系統有檔,總覽 A/B 類客人一個不缺。
1c. iMessage 桌機同步:寫本地腳本(launchd 每 5 分鐘,增量讀 ~/Library/Messages/chat.db 的新訊息,電話號碼對 customerProfiles.phone,推 prod 安全 ingest 端點,unknown 攢著等認領)+ server 端 ingest API(admin token 驗證、externalId 防重複、touchLastInbound)+ 給 Jeff 的一頁安裝說明(Full Disk Access + iCloud Messages 開啟)。只出站 HTTPS。
   驗收:Jeff 手機收到的簡訊 10 分鐘內出現在對應客人時間軸。

### 第二塊:數字出處(+8)

2a. 訂單金額對 invoice 看門狗:訂單掛 invoice/確認單 PDF 時,比對 totalPrice 與 PDF 解析金額(沿用 attachmentParser + customerDocsText,零新依賴),對不上跳黃卡兩數並排。寧漏勿誤:解析不到就沉默。
   驗收:scorecard 那個 $6,635 vs $6,621.40 案例重現時會被攔。
2b. supplierCost 搬運:建/補單時 AI 從供應商文件搬成本(只搬運不生成),margin 看門狗從此對大單不瞎。成本只進 admin 面。
2c. Plaid 收款建議:**只有 Jeff 裁示做才做**。入帳金額吻合某訂單 → 黃卡建議,標記永遠 Jeff 點。

### 第三塊:草稿誠實度收尾(+2,吹牛/抬頭 gate 已上線)

3a. 承諾追蹤:寄出的信裡答應的事(「週五可取件」)寄出後進看門狗承諾清單,過期未兌現跳卡。從 deterministic 來源抽(寄出時的 draft 內容),LLM 只抽承諾句,到期判斷純規則。
3b. 草稿評分月度自動跑:既有 eval 工具改成月度 cron,分數寫 docs + office inbox 一張卡。

### 第四塊:今日清單(+3,位置按 Jeff 裁示)

規則算(零 LLM):到期跟進(followUpDate)、報價將過期(14 天效期)、承諾未兌現(3a 的清單)、出發倒數 T-30/T-7 證件檢查、尾款到期。每項點了跳到該客人。寧漏勿誤,連續一週無誤報才算過。

### 第五塊:學習閉環(+2)

案子完結(completed/cancelled)觸發回寫:該客人的進他記憶(已有),該類案子的進共用經驗(供應商雷/路線/定價),晚間批次;新同類案第一回合自動帶出「上次這類案子的三個教訓」。
   驗收:新開阿拉斯加郵輪案,AI 第一回合引用陳案/美玲案經驗。

### 第六塊:單一入口 + 自我體檢(+3)

6a. 收斂:照 `docs/features/customer-cockpit/consolidation-plan.md`,/admin 客人入口指向 /ops/customers,刪 workspace 客人元件(整站 /workspace 退役另案,不在此範圍)。
6b. 月度自動 scorecard:每月拿真實案卷對帳五維度,結果寫 docs + office inbox。
6c. 順帶清舊帳(小,穿插做):專案歸屬斷層(收信 AI 自動判這封信屬於哪個專案寫 customerInteractions.customOrderId + 聊天「把這串掛到某單」指令;分析引擎無資料時保持誠實空,不准腦補)、update_customer_note 整欄覆蓋改 append、customerChatContext 應收餘額已付清仍顯示、preferenceExtractor maxTokens 截斷防護、自家信箱信跳過 LLM 分類省成本、nav badge 與 limit-200 口徑。另兩個殘留小傷:escalationBox dryRun 的 friendly i18n 訊息 unreachable(G1 審查 P3)、inquiryAgent 日期 grounding 行內嵌了具體日期會進 LLM 快取 key(G3 審查 P3,快取命中率略降,無正確性問題)。

## 明確不做(碰了就是越界)

接微信個人號 API/自動化(封號風險,Jeff 已裁示不做;微信=零摩擦拖放)、手機 App、推播/排程摘要信、自動抓 iMessage 以外的本機資料、Plaid 以外任何碰錢自動化、/workspace 整站退役、重做設計(黑白極簡是刻意的)。

## 節奏

每完成一塊就 commit + 給 ship block + prod 驗證,不要攢大批。單塊內可用 Workflow 並行(監工不看實作細節,只驗結論;文件自稱完成 ≠ 完成)。session 超過 80 turns 或換塊時,回寫 progress.md 後開新對話交接。最後收尾:重跑 scorecard(方法照 scorecard-20260701.md),對照五維度出分,寫進 docs,把 roadmap-100.md 打勾。

=== PROMPT 結束 ===

## 附註(給 Jeff,不是 prompt 的一部分)

- 這份 prompt 覆蓋的是「工程能做的 95 分」。最後 5 分是連續一個月真實營運零事故,靠用,不靠寫。
- 資料六修(ORD-0003 改 6621.40、補 PHX 單、標付款、劉偉國、Jenny 名字、Better way To survive 卡收拾)不用寫 code,你在聊天框打字就完成,建議在批次進場前先做,scorecard 才乾淨。
- 四個裁示點 Sonnet 開工會先問你,想好答案再開 session 效率最高。
