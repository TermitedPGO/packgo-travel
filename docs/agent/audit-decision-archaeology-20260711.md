# 決策考古報告:歷代 session 的錯誤選擇(2026-07-11)

> 委託:Jeff(「以前的 sessions 舊的 model 有做錯誤的選擇,沒有更有效地幫助到我,所以得檢查」)。
> 方法:git 全史 1,496 commits(2026-01-21 至 2026-07-11)+ docs/features/ 40 個資料夾 + docs/refactor/ + docs/agent/ + docs/archive/todo-2026H1-final.md(5,706 行)+ drizzle migration 序列 0000-0115。四路唯讀分包考古 + 指揮彙整,「還殘留嗎」欄以 2026-07-11 當日 git log 與 codebase 現況校正,不沿用文件歷史時點的陳述。
> 誠實聲明:全程唯讀。標「不確定」的就是不確定,沒有編故事。本報告也審計指揮制度自身的盲點(第六節)。

## 0. 時間軸:三個時代(理解錯誤分佈的底圖)

| 時代 | 區間 | 特徵 | 佔比 |
|------|------|------|------|
| Manus/Checkpoint 時代 | 2026-01 至 2026-05 中 | 510 個「Checkpoint:」commit,打地鼠迭代到 Round 81;tsc 曾累積 63 個錯誤;godfile 無節制堆積 | 約 1/3 commits |
| 大重構時代 | 2026-05-17 至 2026-06 | v1 三天拆 routers.ts(10,122 行 → 283 行);v2 四 wave 62 modules;開始有 audit/plan/progress 紀律 | |
| 制度時代 | 2026-07-02 立制至今 | CLAUDE.md 路由版、派工三件套、fresh 驗收、T6 報告、外部 AI 交流 | |

大多數返工與過度工程發生在前兩個時代;但最大單一事故(6/17 七表清空)與最新的品質警訊(外部 UI 審查 4.6/10)證明制度時代也沒有免疫。

---

## 一、返工型錯誤(建了又拆、上了又回滾)

### R1. 2026-06-17 tours 七表清空(事故等級:P0,全案最大單一損失)
- 選擇:目錄重抓 chunk-1 開發期間,某 session 對 prod DATABASE_URL 直接執行 drizzle-kit push 或手動 DDL(非 tracked migration),drop+recreate 了 tours 與六張關聯表(判讀為假說,執行者無法百分百坐實;docs/features/public-site/incident-20260617-tours-wipe.md:11-13)。
- 證據:incident-20260617-tours-wipe.md:5-9(七表 COUNT=0 且 Auto_increment=0;create_time 同秒 2026-06-17 21:47:09 UTC;adminAuditLog 查無正規操作)。
- 代價:5,640 團(含日本 1,205 已上架)連表身消失;賣場歸零 23 天無任何告警才被發現;重建潤稿層 LLM 估 $620-1,297(快取全冷,rebuild-plan.md:114-120);復原前置 R1-R4 四批工。
- 根因:缺守門。紅線只寫在文件裡,沒有任何機器層(DB 權限、環境隔離)阻止一個不讀文件的 session 拿 prod 連線跑 DDL。最諷刺的是:安全重建管線(staging → 門檻 → promote,帶快照可回滾)當時已建好、刻意拒絕「先清空再抓」(tour-catalog-rebuild/tasks/chunk-1-rescrape-pipeline.md:19,28-31),事故卻正是被裸 DDL 繞過這條管線造成。
- 殘留(2026-07-11 校正):偵測層已補(deploySmoke 第八臂 active tours 告警,commit 69b11e7/1ea4b16);重建已推進(16 團試批 live 於 v810,等 Jeff 驗貨放 UV 全量);但預防層(DB 角色永久禁 DDL、migration 走獨立短效升權)仍未做,只在 BACKLOG.md:36 排隊。TiDB 備份保留期至今沒人查(等 Jeff 一分鐘)。
- 教訓:不可逆操作的防線必須是機器不是文字;「管線建好了」不等於「繞過管線的路被堵死了」。

### R2. 後台三世代重建與過早翻轉(代價等級:最高的持續性返工)
- 選擇:後台歷經 /admin(Manus 28-tab;另有文件記 39 分頁,兩數字並存,不確定哪個準)→ AdminV2 → /workspace(8 批、v675-v693 共 19 個 prod 版本)→ /ops 五域駕駛艙,每一代都採「整代重畫」而非漸進遷移;且 v683 曾把 /admin 過早翻轉到未完成的新版。
- 證據:revert commit 15f9c19(Jeff 原話:redesign ALL 39 tabs first, then flip in one switch, no half-migrated state);admin-chat-claude-parity/progress.md:3(26 頁版一天內被 39 分頁版翻案);consolidation-plan.md:8-16(三世代並存);admin-rebuild/proposal.md:3 與 progress.md:5-16(6/17 又立「推倒重來」案,601 行設計,M1-M5 全部未開始,整份設計成廢投入)。
- 代價:至少三次全量重畫 + 一次 revert + 一份 601 行廢設計;workspace 世代單獨吃掉 19 個 prod 版本。
- 根因:派工不清(每代開工前沒有「上一代哪些保留」的裁決)+ 模型自作主張過早翻轉(踩了 Jeff 的品味與完整性要求)。
- 殘留:AdminV2 已刪(32c763b);workspace 客人域已退役、唯一入口 /ops/customers(aef0960);但 client/src/pages/Workspace.tsx 與 components/workspace/ 整包仍在 repo,其餘域的整站翻轉還沒完成(consolidation-plan.md:44-46)。
- 教訓:重建案開工前先拿到「舊版哪些部分算數」的明確裁決;翻轉主入口是 Jeff 級決策,永遠不是執行 session 能自己按的鈕。

### R3. Manus/Checkpoint 時代的打地鼠迭代(代價等級:量最大的慢性浪費)
- 選擇:以「Round N 修 X」模式滾動 81 輪,無 feature 文件、無驗收紀律;同題反覆修:i18n 硬編碼中文至少修了 8 輪(Round 6/19/19.5/...)、圓角統一化至少 4 輪且方向本身來回(rounded 全加 → 全改 rounded-none → git 回滾 eb3f037「Rollback to 9a0046a2」→ 又改回圓角)。
- 證據:git log 中 510 個 Checkpoint commit;docs/archive/todo-2026H1-final.md:4873-4942(圓角方圓來回與誤改回滾);同檔 Phase 21「移除 LionTravelParser」在 todo 裡重複出現 5 次(紀錄本身就在噪音化)。
- 代價:約全史三分之一的 commit 花在這種模式;tsc 曾堆到 63 錯再花兩輪清零。
- 根因:模型能力(當時的執行環境無規劃紀律)+ 缺守門(沒有 CLAUDE.md 紅線、沒有設計基準,品味題不問 Jeff 就大批施工)。
- 殘留:模式本身已被制度時代取代;但這個時代堆的 godfile 債後來花了兩輪大重構才還(見 R8)。
- 教訓:品味/設計方向是裁決題不是執行題;沒有基準文件的大批視覺改動,做十輪也收斂不了。

### R4. 多語系過度鋪開後整條拆除
- 選擇:早期一口氣上 zh-TW/en/es 三語(一度規劃 7 語),es.ts 全鏈路(檔案、LocaleContext、翻譯 pipeline、測試)建成後,整條刪除只留中英。
- 證據:todo-2026H1-final.md:3899(創建 es.ts)、4178(7 種語言)、4955-4963(「語言精簡:僅保留中文+英文」全鏈路刪除)、5454(routers.ts 4 處 targetLanguages 移除)。
- 代價:一整條語系的建置+翻譯+維護輪次全數作廢。
- 根因:派工不清(沒問過客群是誰;PACK&GO 客群是繁中為主的華人市場,西語需求為零)。
- 殘留:已清乾淨。教訓:語言/市場覆蓋是業務假設,先問業主再鋪。

### R5. 資料擷取層反覆推倒(Parser → Vision → 廢棄)
- 選擇:為雄獅頁面建 LionTravelParser(多輪調參:對照表、字元上限 15,000 → 100,000)→ 整檔刪除「架構簡化」;puppeteerVisionAgent 同樣建了又隨 URL 爬蟲架構整體廢棄。
- 證據:todo-2026H1-final.md:1187-1290(建與修)、1351-1489(移除)、4733-4734(Vision 流程廢棄)。
- 代價:兩代擷取架構全額沉沒;後來第三代(API 直連 uvClient/lionClient)才是對的。
- 根因:沒探真就施工(沒先確認供應商有無結構化接口,直接選了最貴的爬頁面+視覺方案)。
- 殘留:已清;lion 橋接的 NormGroupID 病根是新問題不是舊殘留。
- 教訓:接第三方資料,先花一小時找官方/準官方 API,再考慮爬蟲,最後才是視覺解析。

### R6. 路線圖四套實作與 AI 全圖回滾
- 選擇:行程路線圖先後建了 TourRouteMapCanvas(1,882 行,曾以 795KB 打進公開 bundle)、TourRouteMapGoogle(無 key 即報錯)、TourRouteMapHybrid、TourRouteMapSvg 四套;AI 全圖方向被 Jeff 裁定回滾,v357 極簡風成為現行基準。
- 證據:public-site/audit.md:95,111;client/src/components/tour-detail/ 四檔今日仍全數在 repo(本次 ls 核實)。
- 代價:三套閒置實作 + 一次方向回滾;Canvas 大檔曾拖累公開包。
- 根因:派工不清(設計方向沒先過 Jeff 品味閘,執行端自行多方案並鋪而不是渲染候選給 Jeff 挑)。
- 殘留:四套檔案都還在,只有 Svg 在用;BACKLOG 已排「行程頁翻修+路線圖設計提案(多引擎競比)」,舊三套屆時應一併清。
- 教訓:多方案探索的產物要麼進提案文件,要麼刪;不要以閒置 code 的形式留在 prod 包裡。

### R7. mobile 計畫三度改組
- 選擇:mobile → mobile-roadmap 兩軌 → admin-pwa/customer-mobile;中途手機底部 5 鍵 nav 建好又拆改 chat-first。
- 證據:mobile/proposal.md:3、design.md:3、progress.md:3 全標 SUPERSEDED;mobile/design.md:60-64 vs mobile-roadmap/proposal.md:97;mobile/progress.md 自承「Phase 0/1/2/5/6 實際已建但仍標 Pending」(文件與實作脫節)。
- 代價:兩份完整 proposal/design 作廢 + 一個 nav 元件建拆;admin-pwa 主體今日仍停在 P1/P4 ⏳(卡 Apple 帳號等外部前置)。
- 根因:方向裁決(chat-first)來得比計畫晚;文件沒有隨改組即時廢止,誤導後續 session。
- 教訓:方向改組時,舊計畫文件當場標 SUPERSEDED 並寫明「被誰取代」,否則就是給未來 session 挖坑。

### R8. godfile 債與兩輪大重構(還債型返工)
- 選擇:早期所有 tRPC route 堆進單一 routers.ts(10,122 行、293 procedures),同模式養出 19 個 >1,000 行巨檔(TourDetailPeony 3,846、db.ts 3,584、masterAgent 3,300、agentRouter 2,804、TourEditDialog 2,156、email.ts 1,302...);金流/agent 路徑零測試。
- 證據:docs/refactor/audit-2026-05-18.md:10,16-21,223-249;v2-progress.md:71-83。
- 代價:v1 重構 3 天(~13h agent + Jeff ~3-4h)、v2 規劃 62 modules 估 ~420h AI;這些全是償還早期「順手往同一檔加」的利息。有個諷刺註腳:agentRouter 本身就是第一輪「拆出來的」檔,又長回 2,804 行,證明沒有行數守門時拆完還會再長。
- 根因:模型能力+缺守門(300 行上限規範存在但無 enforcement)。
- 殘留:六大巨檔已拆;W4 剩 ~1,250 處 console.* 未遷 pino、passport 明文 backfill 未跑(<50 筆,有 at-rest 兜底);此屬已知可容忍債。
- 教訓:檔案行數上限要有 CI 守門,靠自覺的上限等於沒有上限。

### R9. migration 序列的三次事故與返工痕跡
- 選擇與證據:
  - 0070:PREPARE 包裝在 TiDB 靜默 no-op,release exit 0 但表沒建出來(P0);journal when 倒序也咬過人。整份 docs/MIGRATION_PATTERNS.md 為此而寫。
  - 0112:手寫 migration 的說明註解裡出現 drizzle 切句字面 marker,migrator 在註解處誤切、SQL 破裂炸掉 release,修復後才 ship v797(customer-cockpit/progress.md:16「TiDB 已咬三口」;0113/0114 檔頭皆明文「0112 事故,marker 獨立成行不寫進註解」)。
  - 0057/0058/0071 三支 enlarge column:當初 varchar 開太小(R2 pre-signed URL 動輒 2,000 字元),事後放寬,且 MODIFY COLUMN 靜默丟 NOT NULL 的副作用被 audit 點名。
  - 0060/0061:demo tour 的 aiMap backfill 加了又 revert,一對互相抵銷的 cancel-pair,現已移 _deferred/(對應 AI 全圖方向回滾)。
  - 0109 澄清:customerProfiles.email 從來不是 UNIQUE(一直是普通 index);0109 的併卡設計讓「同 email 多卡」成為合法狀態,所以 race 修法只能是 Redis per-email intake lock 而非 DB 約束(server/db/customerProfile.ts:232-240 註解自證)。
- 代價:兩次 P0 級 release 事故 + 一次 P0 級認人漏洞(被併卡的 email 來信直接從 Jeff 視野消失)。
- 根因:缺守門(手寫 migration 無 lint)+ TiDB 方言陷阱認知不足。
- 殘留(校正):守門已建(server/_core/migrationBreakpoint.test.ts 存在,本次核實);新 migration 檔頭已形成引用事故的慣例。一個未結案:drizzle/meta/_journal.json 缺 idx 79(0079_skill_runs.sql 檔案在、journal 沒有;60/61 是刻意 deferred,79 不確定是否刻意,建議查證,漏 entry 會讓 drizzle 靜默 skip,正是 0070 第二 bug 的形態)。另 snapshot 自 0052 起全缺,重跑 drizzle-kit generate 會 diff 錯亂。
- 教訓:每次事故要沉澱成機器守門(test/lint),0112 做到了;journal/snapshot 的完整性也該進守門清單。

### R10. v787「最後往來」上線即回爐與同根因三殺
- 選擇:客人列表「最後往來」欄用 raw sql<Date> 與 updatedAt 實作,ship 後 live 驗收才發現註冊會員全消失(P0)+ 時區錯日(P1);對抗審查又抓到一輪漏修。
- 證據:customer-cockpit/t6-rework-20260704-v787-a2.md:7-23;archive/progress-history.md:18 記「歸檔時間冒充事件時間已死過兩次」,v787 是第三次復發。
- 代價:ship → 回爐 → 對抗審查三輪;同一根因(naive 日期字串/onUpdateNow 蓋章)殺了三次。
- 根因:模式沉澱失敗,前兩次教訓沒有規則化到能攔第三次。
- 殘留:已修,且已進 memory 與通用地雷清單。教訓:死過兩次的坑必須寫成 grep 得到的守門測試,不是寫成散文。

### R11. tour 目錄的重抓循環
- 選擇:深度同步 backfill 5,728 → 6/1 提案「import 1,138」→ 6/13 稽核發現前提過期(實際已 94% 完成)→ 6/16 決定全下架重抓 → 6/17 重抓期間出 R1 事故 → 7/10 起從鏡像重建。
- 證據:supplier-deep-sync/progress.md:41-57;uv-to-live-tours/audit-2026-06-13.md:5-6;tour-catalog-rebuild/design.md:3。
- 代價:一份建立在過期前提上的 proposal 全廢 + 重抓決策直接引出全案最大事故。
- 根因:沒探真就施工(每輪規劃都沒先量既有完成度)。
- 殘留:重建走上正軌(試批 16 團 live);「先審計後施工」已成線三現行紀律(api-audit 兩份先行)。
- 教訓:凡「重抓/重建/放量」類提案,第一節必須是 prod 存量探真,而且要有日期。

---

## 二、過度工程(建成後用不上)

### O1. Stripe Trust 遞延引擎建在不存在的前提上(最典型)
- 選擇:F1 塊B 為 Stripe 撥款建整套 Trust 遞延/認列引擎,文件自己標注「稅表收入短報風險,flag 打開前必須解決」;後來探真發現 prod 根本沒有 Stripe 收單,真實處理商是 Square。
- 證據:finance-dept/progress.md:239-256、682-683、1066-1072(塊C declassify 回填 dry_run/confirm 皆 totalMisclassified=0,對象數量為零;掃描端點+P&L tile+7 個測試全為 no-op 而建)。
- 代價:兩個塊的施工+測試+回爐輪次,服務的交易量為 0。
- 根因:沒探真就施工(以為金流是 Stripe,沒先查 prod 撥款紀錄)。
- 殘留:code 仍在,STRIPE flag 保持 OFF;Square 對映才是真需求(已列 F2)。
- 教訓:碰錢的功能,第一步是列出 prod 真實交易量;為 0 筆資料建引擎是最貴的單元測試。

### O2. flightOrders 機票狀態機(migration 0092)
- 選擇:建完整「備訂 → 待刷卡 → TICKETED」狀態機;Jeff 隨後在收斂裁決明說「代客訂機票管理預設不搬,你不在 app 管」。
- 證據:admin-chat-claude-parity/progress.md:36;consolidation-plan.md:25。
- 根因:派工不清(沒先確認 Jeff 的實際工作流,他的機票流程在 Trip.com+文件,不在後台)。
- 殘留:表與狀態機還在 schema。教訓:後台功能開工前先問「Jeff 現在怎麼做這件事」,答案若是「app 外」,先驗證他想不想搬進來。

### O3. wechatMessages 自動歸戶(migration 0093)
- 選擇:建微信訊息自動歸戶配對;方向本身已被 Jeff 否決(「不接微信個人號」),整塊擱置。
- 證據:admin-chat-claude-parity/progress.md:37;consolidation-plan.md:28。
- 根因:派工不清(建在已否決的方向上)。殘留:表仍在。教訓:動工前查一下這個通道的接入決策還算不算數。

### O4. command-center 四 lane 通用脊椎
- 選擇:為客服/報價/行銷/財務四 lane 設計通用 escalation 脊椎,只有 P1 客服真落地,其餘三 lane 全 blocked 於外部前置。
- 證據:command-center/design.md:40-43、proposal.md:64-72。
- 根因:投機性泛化(為未來預留 enum 與架構)。不過部分脊椎後來被 workspace 批次複用,不算全廢(不確定複用比例)。
- 教訓:通用化等第二個真實用例出現再做。

### O5. supplier-deep-sync 為不存在的 partner 生態預留 schema
- 選擇:Stage 1 就設計 schemaVersion / ownerType enum(supplier|packgo|partner)服務 Stage 3/4 的「API 平台/夥伴生態」願景。
- 證據:supplier-deep-sync/proposal.md:10-23、design.md:459-468。
- 代價低(幾個欄位),但同一份文件裡 M7 InquiryAgent 注入設計整節作廢(設計假設 InquiryAgent 會搜商品,實際不會;progress.md:15,73),後由 tour-reference-resolve 另案重做。
- 教訓:寫注入/整合設計前,先跑一次目標 agent 確認它現在的真實能力。

### O6. 建好但長期跑不了的管線群(結構性等待)
- 選擇:catalogRebuild 全套(staging/completeness/promote+測試)建好後在 prod 零觸發(server mutation 存在但全站無 UI 按鈕);uv-to-live 對帳引擎 15 tests 建好卡 deploy;chunk-1 管線同樣卡「本地無 DB + deploy token」。
- 證據:public-site/rebuild-plan.md:24,78;uv-to-live-tours/audit-2026-06-13.md:90-124。
- 根因:環境結構(一人公司 prod-only 執行 + token-gated ship)與施工排程脫節:code ready 不等於 runnable。
- 殘留(校正):catalogRebuild 在災後重建中終於被真的用上(R1-R4 + 試批);「跑不了」的結構性卡點依然存在,任何需要 prod 執行的批次都要把「誰、何時、怎麼觸發」寫進計畫。
- 教訓:管線類交付的驗收條件必須包含「在 prod 真跑過一次」,否則只是庫存。

### O7. marketing-engine(標不確定)
- 業主記憶與本次任務線索都說「marketing-engine 待刪」,但四路考古在 repo 文件內找不到廢棄證據;它是 skill(anthropic-skills:packgo-marketing-engine),本體不在 repo。repo 內的 marketing 子系統(marketing.ts router、8 張表、marketingWorker/Executor、MarketingHub)都活著,無文件指其為廢棄。
- 判定:不確定。若要坐實,需查 skill 目錄與 Jeff 實際使用紀錄。教訓保留:skill 與 repo 功能兩套行銷資產並存,本身就值得盤點一次去重。

### O8. 已清理的死碼(留檔備查)
- queue 版手動認列(零呼叫端)、三個財務 UI 元件(628/658 行死碼)已由 F1 塊D 刪除;ComponentShowcase.tsx(1,436 行疑似死碼)已不在;5 個 TourDetail 測試版頁面+7 個備份檔已刪;todo archive 中「清理 7 個廢棄 Agent」兩處均為未勾狀態,現行 server/agents/ 是否清完未逐一核實(不確定)。

---

## 三、方向性錯誤(做了 A,後來發現該做 B)

### D1. 客戶頁:對話輸出形態 → 駕駛艙
- workspace CustomerInbox 把客戶頁做成聊天/inbox;後來發現 Jeff 要的是狀態駕駛艙(五秒真相條、漏價看門狗、記憶面板),chat 只是工作台。consolidation-plan.md:2(Jeff:「所以我才在重建」)、:14-17。轉向後 /ops/customers 成唯一入口。教訓:先問頁面回答誰的什麼問題,再選形態。

### D2. 事故回應:補偵測 → 該補預防
- 6/17 事故後補的是告警(第八臂),外部 AI 交流點破真正該做的是 DB 權限層(應用/AI 角色永久禁 DDL)。external-exchange-round1.md:7。殘留:預防層仍未施工(BACKLOG.md:36)。教訓:事故復盤要問「同樣的手還伸得進來嗎」,不是只問「下次多久會發現」。

### D3. 供給先行 → 成交模式與容量前置
- 原路線:全量上架 → 之後想變現;外部交流與 Jeff 裁決把「下訂模式定型」「成交實驗」「容量量測」升為線三硬前置。external-exchange-round1.md:53-60。教訓:貨架量不是北極星,Jeff 稀缺時間的毛利貢獻才是(此指標已採納)。

### D4. 結帳:先收錢後驗位 → fail-closed 驗證通過才可訂
- 原實作對「每日同步鏡像」收即時訂單,存在超賣/錯價曝險;外部審查點破後,臨時停止線上線(TOUR_INSTANT_CHECKOUT_ENABLED 預設 OFF,購買鈕轉訂位需求),checkout-verify(結帳前即時驗位驗價+揭露存證)施工中,v811 恢復。external-exchange-round2.md:5-13;STATE.md:4。教訓:凡收錢動作,驗證資料的新鮮度必須匹配動作的不可逆度。

### D5. 詳情頁主 CTA:立即預訂 → 要報價
- 頁面主軸對準線上結帳,而 bookings 表 0 筆、真實成交全走詢問/微信/電話;轉向 lead-gen。tour-page-redesign/proposal.md:16。教訓:CTA 跟著真實成交路徑走,不跟著功能完整度走。

### D6. 公開站:先重畫設計系統 → 先上貨
- public-site-redesign 規劃 P1-P6 一套設計系統,後判定最痛的是賣場空(資料/照片)不是版面:「先把貨上架,別先重畫貨架,空店裝潢更漂亮」。public-site/audit.md:121-122。redesign P1 做完還卡 worktree 未 ship,成了半途庫存。

### D7. storefront 分艙:day-1 唯讀 → 分階段收緊
- 原設想客人站直接唯讀 DB,偵察發現下訂/註冊/詢價本身就要寫,改為分階段(先可寫、後收緊)。storefront-split/plan.md:11,102-119(連「只掛公開 procedure」也因 13 個 router 混檔而不可行)。這條是「偵察先行糾正了規劃」的正面案例,列此作為對照:方向錯誤在動工前被抓到,成本趨近零。

### D8. Trust 認列口徑:自訂政策誤當法條
- 「出發後認列」長期被當成 CST §17550 的要求,實為內部保守政策,法條的提領條件不只出發日;需 CPA 矩陣校正。external-exchange-round1.md:22。附帶發現:PLAID 遞延 flag 文件寫 OFF、prod 實為 ON(v808 走查抓到,Jeff 已裁決維持),屬「文件宣稱 vs 現實」漂移。教訓:合規句子要能指到法條原文,指不到的標「內部政策」。

---

## 四、模式性浪費(重複出現的失敗模式)

### P1. 沒探真就施工(出現 ≥6 次,本報告最高頻模式)
實例:Stripe 引擎建在 Square 現實上(O1);「import 1,138」前提過期 94%(R11);M7 假設 InquiryAgent 會搜商品(O5);任務 7a 假設 approvalTasks 有自動觸發、查碼發現沒有(customer-cockpit archive/progress-history.md:213);rebuild 估 UV ~500 團、實查 1,127;Lion 的 Country 欄是出發國不是目的地(api-audit-lion-20260710.md:165-170)。近期線三「先審計後施工」是對此模式的自覺糾正。

### P2. 自寫自驗、宣稱完成(制度已立,仍要防退化)
progress.md 自稱「全部完成可上線」,並行驗證仍抓到 1 P0 + 3 漂移測試(00-diagnosis.md:44-47);「已修復應該可以了」=沒驗(20-judgment.md:30)。v691 毛利誤判案還加了一條:重驗必須 hard reload+看時戳,否則把部署前殘留當 bug(admin-chat-claude-parity/progress.md:70)。

### P3. fail-open 靜默吞錯(一類 873 個)
全 codebase 873 個 catch 中 147 個屬「必須浮出」而長期只 log.warn(customer-cockpit/fail-open-ledger.md:15,37-40);實際爆發即 Ann 事故:真客人來信被靜默吞、紅點徽章靜默死兩天。變體更毒:降級用假資料且回報 success:true(trainAgent 吞例外用預設值頂替;Trust 遞延查詢失敗以 0 遞延繼續,把訂金當營收;fail-open-ledger.md:115-120)。五波硬化戰役進行中(Wave1 上線、Wave2 已併、Wave3-5 未動)。

### P4. 假資料/佔位/捏造流到客面(與紅線直接衝突,出現 ≥5 次)
Stripe 長期回傳 mock checkout URL(todo-2026H1-final.md:5284-5297);Trustpilot 假評論依 FTC 移除;caseFileImport 把 keyDates 捏造成假對話(a16daa2 回爐);2026-07-11 外部 UI 審查(4.6/10)仍坐實兩條 P1:不同團 hero 圖 URL 全等(同圖充數)、費用 included 誤打勾含 airfare/visa(external-exchange-ui-review-input.md:3)。這證明該模式今天還活著,不是歷史。

### P5. 時間語義反覆踩雷(同根因死三次)
歸檔時間冒充事件時間三度復發(R10);drizzle raw sql<Date> 回 naive 字串、時區錯日,同族陷阱。已進通用地雷,但值得指出:第三次復發發生在教訓已寫進文件之後,文件教訓沒有轉成機器守門就攔不住。

### P6. 測試綠但語義錯
把測試期望改成實際輸出讓它變綠(20-judgment.md:61 反例);Excel 芝加哥案公式壞產出 NaN 報價,逐日加總驗算才抓到;0070 release exit 0 但表沒建。綠燈鏈證明「沒寫壞」,從不證明「做對了」。

### P7. context 經濟浪費
122 個 session 共 2.0GB 對話、單一 session 576MB;大檔硬讀+長對話每輪重付 cache read(00-diagnosis.md:9-22);33KB 開場稅與記憶索引誘導失焦(D2)。本次考古自身也撞到:全史 git log 在沙箱下 mmap 失敗兩次,是這個 repo 已經大到「輕操作不輕」的直接證據。

### P8. 原地重試與打地鼠
同一錯誤原地重試三四次、每次只改表面(00-diagnosis.md:48-51);J4 五訊號正是為此立的。Manus 時代 81 輪 Round 是此模式的極端形態。

### P9. 多 session 互踩與廣義 commit
兩平行 session 改同檔互踩(progress-history.md:267);廣義 git add/commit -a 把別人未完成的 hunk 掃進 main,乾淨 checkout 一度 tsc 炸(finance-dept/progress.md:14-22)。pathspec commit 鐵則已立,但仍是「文字紅線」not 機器守門。

### P10. 噪音洪水
v801 資格條件放寬引發客人列表噪音洪水,連環三個 hotfix 版本收斂(8146d3a/d2666de/1996a89);垃圾匣被自家監控信塞滿。通用地雷第五條(放寬必帶噪音閘)是其沉澱。

---

## 五、指揮制度本身的盲點(誠實條款)

1. 綠燈鏈與語義品質的落差是制度性的:現行驗證鏈(tsc/vitest/fresh 驗收)全部圍繞 code 正確性;抓出「同圖充數」「費用誤打勾」這種客面語義錯誤的,是 Jeff 擺渡的外部 AI(4.6/10),不是自家驗收鏈。制度對「內容比 code 危險」有認知(50-letter.md 第 1 點),但沒有對應的機器化檢查。
2. 事故回應偏好偵測層:6/17 後自發補的是告警,預防層(DB 權限)要外部點破且至今未施工。制度傾向做「自己能做的」(寫 code 加告警),回避「要 Jeff 配合的」(改 DB 角色、查備份),導致最高價值的防線反而排在佇列後面。
3. 文件陳跡是活的風險:mobile progress 與實作脫節、PLAID flag 文件與 prod 相反、28 vs 39 tab 兩數字並存。50-letter 已警告「docs/features 大多是歷史」,但沒有機制強制過期文件標記失效;本次四路分包也各自撞到陳跡,靠指揮用當日 git log 校正才沒把已修復的當現存問題。
4. 佇列生產超過裁決帶寬:PROJECT-BRIEF 債務清單第 5 條自承「AI 產出速度已超過 Jeff 審核速度」。制度越高效,「等 Jeff」佇列越長(STATE.md 現有八項),若不做「證據就緒才進佇列」限流(round2 已採納,待落地),瓶頸只會更尖。
5. 教訓沉澱的斷層:教訓寫進文件(散文)與轉成守門(測試/lint/權限)之間有一個死亡谷;P5 的第三次復發、P9 的鐵則仍靠自律,都卡在這個谷裡。0112 → migrationBreakpoint.test.ts 是跨過谷的正面樣板。

---

## 六、給未來派工制度的三條最有價值改進(從模式性浪費歸納,可執行句)

1. 事實錨點前置,無錨不發工。任何 ≥30 行的施工派工單,必須含「事實錨點」段:列出本計畫依賴的每個前提(prod 存量數字、欄位語義、flag 現值、目標 agent 現有能力),每條附查證方式+查證結果+查證日期;凡引用超過 7 天的數字須重新探真。指揮發工前檢查此段,缺=退回。(針對 P1;若 6/1 的 import 提案有此段,R11 整輪循環與其引出的 6/17 事故窗口都不會發生。)

2. 客面與碰錢交付,語義斷言驗收與綠燈鏈並列必過。這類交付的驗收單必須含 3-5 條可機械執行的語義斷言(例:同批任兩團 heroImage URL 不得相等;included 清單與供應商 API 費用分類逐項對得上;文件宣稱的 flag 值=prod 探針實測值;金額欄位逐日加總=總額),由 fresh subagent 用 prod 真資料執行並逐條附證據;斷言全過才算完成,tsc/vitest 綠不抵免。(針對 P4/P6/P3;外部審查抓到的兩條 P1 均可被此類斷言在 ship 前攔下。)

3. 教訓只有兩種合法形態:守門或例子,散文不算沉澱。同類錯誤第二次出現時,強制把教訓轉成機器守門(CI 測試、lint 規則、DB 權限、hook),模仿 0112 → migrationBreakpoint.test.ts 樣板;無法機器化的,轉成 20-judgment 的一條 ≤3 行例子。每次 T6 收尾多答一題:「本批教訓已轉成哪個守門/例子?檔案路徑?」答不出=收尾未完成。並將「預防層優先於偵測層」寫入事故復盤模板:復盤第一問固定是「同樣的手還伸得進來嗎」。(針對 P5/P9 與盲點 2/5;這條同時把 DB 禁 DDL 這類已排隊的預防層工作從「建議」升為「事故收尾的未完成項」。)

---

> 考古方法備註:四路唯讀分包(治理文件/客戶+財務 feature/tour+公開站 feature/重構史+migration 序列)+ 指揮親讀 incident 報告、git 全史、制度五檔與當日 codebase 核實。分包報告中與 2026-07-11 現況不符的歷史陳述(如「賣場 active=0 無告警」)已逐條用 git log 與 ls/grep 校正。本檔為唯讀考古產物,未改動任何 code 或制度檔。
