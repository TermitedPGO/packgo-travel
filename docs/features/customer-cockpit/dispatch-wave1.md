# 派工單:硬化 Wave 1 — 觀測神經(讓所有壞都會叫)

> 指揮(Fable)2026-07-08 簽發。母計畫 `hardening-plan.md` Wave 1。目標:殺掉「靜默失敗」這一整類 — 之後任何 prod 壞掉,Jeff 一定在部署當下或 inbox 看得到,不再靠客人來信才發現(Ann 事故的根)。所有 file:line 錨點來自 2026-07-08 六路唯讀偵察,動手前 Read 確認,對不上以現場為準並在 T6 偏離申報。

## 建議模型

- 執行:sonnet(規格明確施工,落點已全部釘好)。
- 對抗審查:sonnet fresh context,每塊 ≥3 路;高風險點(塊A 的 SQL 搬移、塊B 的噪音閘)必有一路專審。
- 塊D 內部的機械掃描可自派 haiku 批次,分類判斷留 sonnet。
- 同一塊回爐第 2 次、或 prod 實機疑難:停,整理失敗軌跡升 opus(`docs/agent/10-dispatch.md` §6),不准第 3 次原樣重試。

## 必讀

`CLAUDE.md`、`docs/agent/30-templates.md`(T2 通用地雷五條 + T6 + 數字紀律)、`docs/features/customer-cockpit/hardening-plan.md`、`docs/standards/backend.md`。

## 紀律

- main 上工作;四塊依序 A→B→C→D(D 的接線依賴 B 的漏斗);每塊獨立 workflow 四階段(實作→對抗審查≥3路→修復→驗收),獨立 commit。
- 全套 vitest + tsc 綠才 commit;push;**不 ship**(`pnpm ship` 只有 Jeff 能跑;需要 ship 就停下回報)。
- 全批零 schema migration 授權。做到一半發現非要 migration 不可,停下回報,不夾帶。
- 全批零 LLM 呼叫(觀測系統本身純 code;`llm.ts` 只讀統計不碰呼叫路徑)。
- T6 報告 `docs/features/customer-cockpit/t6-report-20260708-wave1.md`,vitest/tsc 總結行從終端原樣貼。progress.md 隨塊回寫。
- 不確定就停下來回報,不要猜。你看不到 Jeff 的 memory 和主對話歷史,本派工單已含全部 context,缺什麼在回報中說明。

## 本批點名的通用地雷(五條全文見 30-templates.md T2,對抗審查每路必驗)

1. **噪音閘(第五條,塊B 的命)**:每一個新告警入口都要回答「這條會放進哪些非目標事件?」。v801 洪水教訓:放寬進口不帶閘 = 隔天 99+ 徽章回爐兩輪。本批的具體閘見塊B。
2. **TiDB raw SQL 元規則(塊A)**:customerList/guestList 的查詢體是 v794→v799 連環 500 的案發現場(GREATEST 關聯子查詢 ORDER BY)。抽函式 = 純搬移,SQL 表達式一個字元都不准動;搬移後用 `QueryBuilder` 的 `.toSQL().sql` 斷言渲染形狀不變(GREATEST 只一份、別名 `as`、關聯 WHERE 全限定)。
3. **秒級截斷 / 時區(塊C)**:計數器只做整數差,不做時間戳比較;`llm:stats:YYYY-MM-DD` 的日期 key 生成必須沿用 `bumpStat`(llm.ts:682-693)同款,不自創時區換算。
4. 業主聯絡方式排除、todayLA 曆日兩端換算:本批不直接涉及,審查掃到就報。

## 塊A:ship 後自動煙霧

部署成功 ≠ 端點活著(v794 徽章 500 掛兩天)。ship 完當場知道六個核心查詢死活。

1. **抽函式重構(行為不變,T3 紀律)**:三個查詢體目前內嵌沒 export,抽成可獨立呼叫的 exported 函式,procedure 與煙霧共用**同一支**(禁止複製第二份,否則煙霧測的不是真查詢):
   - customerList 查詢體:`server/routers/adminCustomers.ts:230-`(procedure :228)
   - guestList 查詢體:`server/routers/adminCustomers.ts:996-1146`(procedure :994)⚠ v799 雷區,SQL 一字不動
   - `loadTodayListItems`:`server/routers/adminCustomerOrders.ts:342`(private → export;procedure :683)
   - 三者查詢體都不讀 ctx(偵察已核),抽出無 ctx 依賴。重構前先跑既有相關測試記基線,重構後同批綠。
2. **smoke 核心 `server/_core/deploySmoke.ts`**:`runDeploySmoke()` 依序跑七臂,每臂 try/catch + 計時,回 `{ok, arms:[{name, ok, ms, rowCount?, error?}]}`:
   - customerList、guestList(抽出的函式,參數用 admin UI 首載同款預設)
   - customerUnreadCount:註冊臂 + guest 臂 `runGuestUnreadRankingQuery`(adminCustomers.ts:136,weeklyCanary.ts:276 已有直呼先例)
   - todayList(`loadTodayListItems`)
   - watchdogForCustomer:用 0909 測試客人,email 動態解析 profileId(db.findCustomerProfileId,server/db/customOrder.ts:77),不硬編 id;解析不到 = 該臂 fail
   - 命令中心兩臂:`listApprovalTasks`(server/_core/approvalTasks.ts:169)+ `listEscalations`(commandCenter.ts:294 → escalationBox.ts)
   - 回應絕不含客人資料:只回 ok/ms/rowCount/error(error 取 name+message 前 200 字,無 stack)。全程唯讀零寫入。
3. **端點 `POST /api/admin/deploy-smoke`**:照 `/api/admin/import-case-file` 範式(server/_core/index.ts:1322;verifyInternalAuth :1124,tokenEnvVar: LOCAL_SCRIPT_TOKEN + rate limit)。支援 `{simulate: "fail"}` 參數強制注入一臂假失敗(紅路演練用,不碰真查詢)。
4. **safe-deploy.mjs 接線**:`pnpm ship` = `node scripts/safe-deploy.mjs`(純 Node ESM、deps 注入、無外部依賴,風格照舊)。部署成功判定 = :185-188 的 run() 沒 throw;煙霧步驟插在現有 post-deploy health check(:204-215)之後、版本號列印(:218-224)之前,新增 `deps.smoke()` 照 health 的 try/catch 樣式:
   - `LOCAL_SCRIPT_TOKEN` 未設(process.env,腳本層目前完全沒讀過這個名字)→ 黃字「跳過煙霧」,不擋。
   - 任一臂 fail → **紅字逐臂列出 + rollback 提示(照 :212 慣例),不改 exit code**(部署已完成,失敗語意交給人)。
   - `scripts/safe-deploy.test.mjs`(node --test)補紅綠例。

## 塊B:錯誤漏斗 errorFunnel

三類錯誤(admin 路由 500、worker/cron 失敗、逐信處理失敗)→ 去重 → high 卡進 inbox。Sentry(server/_core/sentry.ts,SENTRY_DSN 未設即 no-op)留作堆疊細節,漏斗負責「Jeff 一定看得到」。

1. **核心 `server/_core/errorFunnel.ts`**:`reportFunnelError({source, err, context?})`:
   - 簽名 = source + error name + message 前綴(去掉動態片段);同簽名 30 分鐘一張卡,卡上帶累計次數。
   - 去重照抄 llmCreditAlert 兩層(in-memory 滾動視窗 + agentMessages DB 30min 查詢,llmCreditAlert.ts:22-24, 51-70, 81-108),零 Redis 零 migration。
   - 出卡走 `notifyAgentMessage`(server/_core/agentNotify.ts:59;它 insert 失敗只 log 不 throw,漏斗整體同語意:**漏斗本身絕不 throw**,單元測試釘死)。
   - agentName="error-funnel"、messageType="alert"、priority 封頂 "high"(critical 會觸發 notifyOwner 寄信,agentNotify.ts:101-109,漏斗不寄信)。
2. **掛鉤點**:
   - tRPC:目前零集中攔截(trpc.ts:9 無 errorFormatter;index.ts:1829 掛載無 onError)。在 createExpressMiddleware 加 onError,**噪音閘**:只收 INTERNAL_SERVER_ERROR;FORBIDDEN / UNAUTHORIZED / BAD_REQUEST / NOT_FOUND / TOO_MANY_REQUESTS / client abort / EPIPE(index.ts:2142 註解已知噪音)一律不進。排除清單寫進 code 註解 + T6 報告。
   - worker:共用 `wireWorkerFunnel(worker, queueName)` 掛 'failed'(+ 'error')事件,**加掛不取代**既有 handler。全部 worker 接上,特別是兩個目前裸奔的:`server/scalingGuardrailWorker.ts:26`、`server/supplierDetailEnrichmentWorker.ts:47`(全檔無 .on("failed"),BullMQ 失敗現在無人知)。順帶查證:skillLearningQueue(queue.ts:203)偵察找不到對應 worker — 確認後寫進 T6,不准擅自建 worker。
   - cron 黑洞:index.ts:1861-1862 zombie cleanup `setInterval` + `.catch(() => {})` 連 log 都沒有,改接漏斗(保持 continue 語意)。
   - gmail 逐信失敗:**保留現有逐信卡粒度**(buildIntakeFailureCard,gmailPipeline.ts:794-816;卡帶 relatedCustomerProfileId,客人可定位)。去重**不作用**在這裡 — Ann 教訓:可定位到客人的失敗絕不因去重消失。只加**洪水閘**:同一輪 totalFailed > 5 → 收斂成一張聚合卡逐一列 msgId,不逐張刷屏。紅綠例都要測(6 封失敗=1 張聚合卡;2 封失敗=2 張獨立卡)。
3. 單元測試:去重窗口、簽名分流、never-throw、tRPC 過濾表逐條、洪水閘紅綠例。

## 塊C:D1 週稽核加觀測計數器三行

讓「有人讀的計數器」成立:異常趨勢週一必經 Jeff 眼前,異常週醒目。

1. 落點:`formatAuditDigest`(weeklyCorrectnessAudit.ts:199-231)追加第三個 `---` 分隔段「觀測計數器」,照該檔 :191-198 的「不同信號分段」設計註解。三行:
   - **messagesFailed 週增量**:gmailIntegration.messagesFailed 是累積計數(schema.ts:3039;遞增點 gmailPipeline.ts:308, 772)。新 Redis snapshot key(照 lastWeeklyAuditAt 心跳模式,weeklyCorrectnessAudit.ts:371, 376-387)存上週累計值算差;首跑無基線 → 顯示「首次基線,下週起有增量」,不誤報。
   - **各 queue failed 數**:枚舉 `server/queue.ts` + `server/queues/*.ts` 全部 `new Queue(`(約 30 支,動手前 re-grep 定案),逐一 `getFailedCount()`(repo 首例,現只有 scripts/cleanup-redis.ts:13,42 用過);每支獨立 try/catch,單支失敗顯示 `?`,絕不炸稽核。只列非零 queue,全零就一句「全部 queue failed=0」。
   - **LLM circuit 統計**:讀 `llm:stats:YYYY-MM-DD` Redis hash(bumpStat,llm.ts:682-693)近 7 天聚合:circuit_opened / rate_limit_429 / calls_total。日期 key 生成沿用 bumpStat 同款。
2. 三行永遠出現(0 也顯示 0);任一非零行前加 ⚠。不動 D1 既有 priority 演算法(:237-239, 286-289)與零 LLM 性質。
3. 單元測試:三段結構、週增量含首跑分支、failed counts 部分失敗容錯。

## 塊D:fail-open 全面盤點(依賴塊B)

偵察體量:server/ 非測試檔 853 個 catch(含 .catch 鏈);top:_core/index.ts(50)、gmailPipeline.ts(25)、stripeWebhook.ts(22)、routers/bookings.ts(21)、translation.ts(18)。

1. **產出 `docs/features/customer-cockpit/fail-open-ledger.md`**:全枚舉,每條 = file:line + 吞了什麼(一句話)+ 分類 + 理由一句話。開頭寫 grep 指令與總數,**ledger 條目數與 grep 總數對帳**(數字紀律)。
2. 分類三檔:
   - **A 必須浮出**:失敗會讓客人資料流斷、錢對不上、或 Jeff 該知道而不知道。
   - **B 可以安靜**:刻意 fail-open 的設計(Redis 掛 fail-open、SSE 斷線、best-effort 快取之類),理由要寫。
   - **C 爭議**:拿不準的,列清單交指揮裁決,不要自己猜。
   - 機械預分類降人力:catch 內已有 rethrow / notify / Sentry / res.status(5xx) → 直接 B(已浮出);空 catch、只 console 的進人審。
3. **接線 cap(守範圍)**:分類 A 且屬四類高風險路徑 — ①客人資料流(收信/歸檔/互動寫入)②錢(stripe/plaid/invoice)③cron 與部署可見性 ④客人可見輸出 — 本批接 `reportFunnelError`;其餘 A 記帳掛 Wave 4,不本批擴散。每處接線 = catch 內加一行,**行為不變仍 continue**;抽代表性 3-5 處補測試。
4. 已知樣例供校準(偵察抽樣):tourGenerator.ts:487-489(空 catch 吞出發日插入失敗)、agentActivityService.ts:70-72(吞 DB insert 失敗繼續發 SSE)、progressRouter.ts:38-40(SSE 斷線,典型 B 類)。

## 驗收條件(每塊 commit 前,逐條附證據)

1. `tsc --noEmit` 0 錯(OOM 用 NODE_OPTIONS="--max-old-space-size=6144")。
2. 全套 vitest 綠,總結行(Test Files / Tests 兩行)終端原樣貼。
3. 塊A:重構基線對照(前 N 綠 → 後 N 綠);`.toSQL()` 形狀斷言測試綠;grep 確認三個查詢體無第二份複製;`node --test scripts/safe-deploy.test.mjs` 綠。
4. 塊B:噪音閘過濾表逐條測試;never-throw 測試;洪水閘紅綠例;`grep -rn "\.catch(() => {})" server/_core/index.ts` 對 zombie cleanup 那條已消失。
5. 塊C:三段結構測試;首跑分支測試。
6. 塊D:ledger 條目數 = grep 總數(兩個數字都貼);C 類清單完整列出。
7. i18n:本批預期零 client JSX 變更;若有,zh-TW/en 同步。

## 驗收走查清單(ship 後,執行者自跑,逐項附證據進 T6 附錄;指揮只讀報告 + 唯讀探針抽查)

1. Jeff `pnpm ship` 後,貼 ship 輸出末尾煙霧段原樣文字:七臂全綠。
2. `curl -X POST .../api/admin/deploy-smoke`(帶 token)貼 JSON:全 ok、各臂 ms。
3. 紅路演練:`{simulate:"fail"}` 再打一次 → 貼紅字輸出,確認部署腳本語意(紅字 + exit code 不變)與端點回應一致。
4. 手動觸發 D1 一次(prod 慣例:node require bullmq CJS),貼 inbox 卡截圖:三行計數器在、數字合理(messagesFailed 首跑基線行、queue failed、circuit)。
5. 漏斗 48h soak:ship 後 48 小時查 agentMessages(agentName="error-funnel" 唯讀探針)。零卡(無錯)或逐卡核真;**同簽名 >3 張/日 = 去重失敗,回爐**;非錯誤事件成卡(噪音)= 噪音閘漏,回爐。
6. 兩個原裸奔 worker:確認 wireWorkerFunnel 已掛(grep 證據),等自然失敗事件驗實彈(不人工製造 prod 失敗)。
7. fail-open ledger:交指揮抽查 5 條真偽(file:line 對得上、分類站得住)。

## 監工已代答的裁示(不用再問)

1. 煙霧失敗不改 ship exit code:部署已完成,紅字告知即可,語意與現有 health check 一致。
2. 漏斗 priority 封頂 high、絕不 critical(critical 寄信;寄信留給真正的人命關天,現在沒有)。
3. gmail 逐信卡保留粒度,去重只作用在基礎設施類錯誤;寧可多卡不准吞卡(Ann 教訓高於洪水教訓,洪水用聚合卡解)。
4. fail-open 接線本批只做 A 類 × 四高風險路徑;其餘記帳 Wave 4。853 條全枚舉但不全接。
5. LOCAL_SCRIPT_TOKEN 由 Jeff 本機 shell 提供(fly secrets 那把同值);腳本讀不到就黃字跳過,不擋 ship。
6. 命令中心 inbox 雙臂都煙霧(approvalTasks + escalations),偵察發現兩表分工,都是 Jeff 每天看的。

## T6 完工報告

照 `30-templates.md` T6 六欄:交付清單(commit hash)、自測證據(數字原樣貼)、對抗審查(幾路幾 P0-P2 怎麼修)、偏離申報、已知限制、給指揮的審查建議(自曝 2-3 個最可能有問題的點)、待 Jeff 手動。回報超過 30 行落檔傳路徑。
