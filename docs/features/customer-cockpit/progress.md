# 客戶頁衝 100 分 — 進度總覽

> 對應 `roadmap-100.md` 的九塊工作(Phase1-6 + 收尾)。監工看這份,不看實作細節;文件自稱完成不算數,以下每項都附驗證證據。

## 現況(2026-07-09,硬化戰役)

- Wave1(觀測神經:A ship 煙霧 / B 錯誤漏斗 / C D1 觀測計數器 / D fail-open 盤點):已上線 v805,post-ship 走查全過(紀錄 `archive/wave1-post-ship-walkthrough-20260709.md`,T6 報告 `archive/t6-report-20260708-wave1.md`)。
- Wave2(資料庫真實化,SQL 彩排閘):已併 main,未 ship。派工單 `dispatch-wave2.md`,T6 報告 `t6-report-20260709-wave2.md`,驗收 `wave2-acceptance-20260709.md`。
- Wave3-5:未動。母計畫 `hardening-plan.md`。
- 背景:客戶頁工程已收官進服役期(五大步 + 專案化 + 客人記憶 + 全渠道進場 + E2E 完單 + 兩收官批),歷史全文見 `archive/progress-history.md`。

---

## 硬化戰役 Wave2 — 資料庫真實化(殺 SQL 盲區)(2026-07-09,opus 4.8,branch `hardening-wave2`)

目標:本地無 DB、測試全 mock,raw SQL 的 parse/resolution 錯全是 prod 首演才爆(TiDB 已咬三口:LIKE ESCAPE 反斜線、migration 註解 `-->` 切壞 0112、ORDER BY 關聯子查詢)。這批把「這條 SQL 在 TiDB parse 不了」擋在 ship 前的部署閘。三塊 A(登記表)→ C(紀律測試)→ B(EXPLAIN 彩排閘)。

### 規模修正(重要偏離)

派工單量的「168 處 sql`` / 57 檔」是用 naive `grep 'sql\`'` 算的,漏掉 189 個泛型寫法 `sql<T>\`\``(型別參數夾在 sql 與反引號之間)—— 而 `sql<Date>` 正是 prod 已中招的 raw-sql-date naive 字串雷所在。廣義 regex `sql(<[^>]*>)?\`` 抓到真實 357 處、橫跨 78 檔;加 `db.execute(` 共 **356 個唯一 token**(排除註解行內假 token)。決策:擴到全覆蓋(不擴就在最該覆蓋的泛型處留洞),已顯著申報。

### 塊A — SQL 登記表(`server/_core/sqlRehearsal/`)

`registry.ts`(型別 + getRegistry + 檔頭邊界註解)、`registryEntries.ts`(**238 條** A/B 條目,逾 2000 行)、`registryWhitelist.ts`(**3 條** C 白名單:healthCheck SELECT 1、guestNoiseGate 兩個片段常量 covered-by 呼叫端)。全量盤點分 8 叢集派 subagent 編目(各回結論不貼內文),用組裝器萃取 + 校正(範圍→真 token 行展開、跨叢集去重、佔位符=sampleParams 自驗)。每條 sql 存裸語句(SELECT/... 開頭不含 EXPLAIN 前綴),sampleParams 無害假值。高危 ESCAPE 活體 `caseDocumentImport.ts:225` / `caseLessonHarvest.ts:180` 已收(LIKE ? ESCAPE ? 兩佔位)。旗艦 `adminCustomers.buildGuestListQuery` 用真 builder `.toSQL()` 逐字產(零漂移,handWritten:false)。`registry.test.ts` 自驗:佔位符數==sampleParams、key 唯一、無 EXPLAIN 前綴、無內嵌分號、裸語句開頭、source 格式。

### 塊C — 登記紀律 grep 守門(`coverage.test.ts`)

仿 migrationBreakpoint.test.ts:掃 server/ 非測試檔每一處 `sql(<...>)?\`` 與 `db.execute(`,每點必在 ENTRIES.sources 或 WHITELIST,否則紅(錯誤訊息教怎麼登記);反向也守 stale source(行號漂移)。跳過註解行假 token。紅路自證:臨時加未登記 sql`` → 紅並印教學訊息。

### 塊B — ship 前 EXPLAIN 彩排閘(`scripts/sqlRehearsalGate.ts` + `scripts/sqlRehearsal/rehearsalCore.mjs`)

通道甲案:orchestrator(tsx)讀登記表 → 把純邏輯核心 inline 進 CJS blob(去 export,遠端跑的守門邏輯與單測逐字同源)→ `flyctl ssh console -C "sh -lc 'node'"` 把 blob **走 stdin** 餵 prod node(base64 當 echo 參數會 argument list too long,stdin 無此限)→ 用機上 DATABASE_URL 連 TiDB,逐條 `EXPLAIN <裸語句>`。嵌進 safe-deploy.mjs 閘 **[6.5/7]**(vitest 之後、token 之前,不動既有七閘語義),`deps.rehearse()` 注入可測。fail-closed:EXPLAIN 錯 / 通道失敗 / 遠端條數對不上都擋部署,通道失敗附逃生口 `SKIP_SQL_REHEARSAL=1 pnpm ship`。

安全鐵則四條(每條單測):①正向白名單(只放行 SELECT/INSERT/UPDATE/DELETE/REPLACE/WITH 開頭 —— 同時擋 EXPLAIN 自帶前綴 **與 bare ANALYZE**,後者 `EXPLAIN `+`ANALYZE DELETE` 會真執行 DML);②單語句(內嵌分號擋,只驗原始 sql 不驗 format 後);③連線 SET SESSION TRANSACTION READ ONLY 先跑;④只回 key+pass/fail+error 不回結果行。

**TiDB 特性(記錄)**:`SET SESSION TRANSACTION READ ONLY` 在 TiDB 是 noop function,預設被 `tidb_enable_noop_functions` 擋(實測撞到)。已改先開 noop、兩者 best-effort、失敗不中斷 —— 真正的唯讀保證是「只送 EXPLAIN」(EXPLAIN 對 DML 不執行,guard 已擋 ANALYZE/多語句),READ ONLY 只是 belt-and-suspenders。彩排邊界寫進 registry.ts 檔頭:EXPLAIN 抓 parse/resolution,抓不到行為差異(ESCAPE 那口靠測試不靠彩排)。

**對 prod TiDB 真跑 238/238 全 pass**。首輪抓出 2 條手抄走樣(buildGuestListQuery→換真 toSQL;opsActions.doCancelBooking→日期戳 inline),正是彩排的價值。通道腳本一路 fresh 對抗審查(注入/寫繞過/多語句/ANALYZE/憑證洩漏視角):抓 1 阻塞(bare ANALYZE 縫)+ 2 低(channelError 可能夾 DATABASE_URL、空 payload soft fail-open),三條全修並複驗 PASS。

### 順手活

- **gmail-poll 36 筆歷史 failed**:flyctl ssh 唯讀 dry-run 列清單(3 筆 2026-05-27 + 33 筆 2026-06-17,全 `gmail-poll-tick`、同一 DB 查詢失敗、全 >7 天前)。**未 remove — 待 Jeff 點頭才清理**(本批唯一允許的 prod 寫操作)。
- **observabilityCounters.ts queue failed 改近 7 天口徑**:`getFailedCount()`(歷來累積 → 舊殘留成永久假警告)改成 `getFailed()` 取回按 `finishedOn >= now-7d` 過濾、單 queue 上限 500 防爆、讀不到照舊 "?"。gmail-poll 那 36 筆全 >7 天 → 假警告自然消。測試同步更新(21 綠含 7 天過濾/500 上限/null)。

### 驗證(獨立可稽核)

`tsc --noEmit` 0 錯。`pnpm exec vitest run` → 全套 `Test Files 321 passed | 11 skipped (332)` / `Tests 4728 passed | 90 skipped (4818)`;sqlRehearsal + observability 新測試單獨連跑 5 次全穩(每次 45 綠)。safe-deploy `node --test` 22/22。prod EXPLAIN 彩排 238/238 pass(真跑)。紅路演練 x2:壞 SQL 條目擋閘(prod EXPLAIN `Unknown column`)、未登記 sql`` 測試紅,均截輸出。

**待 Jeff**:①`pnpm ship`(閘 6.5 會在 ship/dry-run 時對 prod 唯讀跑一輪彩排)。②gmail-poll 36 筆清理點頭。詳見 T6 報告。

### Wave2 收尾(2026-07-09,指揮驗收 PASS 後兩件指派)

**gmail-poll 清理(Jeff 授權「清」)**:flyctl ssh + stdin node,單一腳本內建硬性守門 —— 重跑 getFailed() 驗證(36 筆、全 gmail-poll-tick、finishedOn 全為 5/27×3 + 6/17×33,與 dry-run 逐一相符),全部相符才逐筆 job.remove(),只動 gmail-poll failed 集合。before/after:**36 → 0**(removedN=36,failedRemove=0)。獨立唯讀複查 failedCount=0,queue 健康(completed 100/delayed 1 排程 tick)。

**opsActions.ts:390 latent bug 修正(指揮驗收升 P1)**:
- 修法:日期戳 + reason 整條在 JS 組好、當「單一」綁定參數傳給 CONCAT(抽出 exported `buildCancelAuditNote` / `cancelMessageSql`,同 doUpdateInternalNote 的正確寫法)。渲染後 SQL 只有一個 `?` 且不在任何字串字面內(舊寫法渲成 `'...OpsAgent ?] '`,? 卡引號裡)。同檔同款寫法掃過:只 390 一處中招(293/439 本就正確)。
- 併修「無條件 ok:true 假成功」的另一半:transitioned=false(條件式更新沒命中)時回誠實摘要「本次未變更,未釋座」且不釋座,不再宣稱「已取消·釋出座位」。
- 紅綠測試(server/agents/autonomous/opsActions.test.ts):佔位符 regression(渲染真表達式,斷言無 `?` 落在字串字面內 + 佔位==綁定)—— 已證舊寫法會紅(`?`-in-literal 命中)、新寫法綠;加 4 條 path 測試(正常釋座 / 沒命中不釋座 / 已取消早退 / 不存在)。doCancelBooking 全程 await 無 fire-and-forget,不需 vi.waitFor;單檔連跑 5 次全穩(每次 32 綠)。
- registry 同步:三個 opsActions 條目 source 隨行號更新(293/382/439);updateBookingMessage 換成修後真實乾淨形(移除 inline 日期的暫用形)。coverage/registry 綠、prod EXPLAIN 238/238。
- 歷史盤查(唯讀,三重訊號互證):agentMessages context `executedAction=cancelBooking` → 0;jeff-role 純字串 body `Action type: cancelBooking%` → 0;最寬網 body∪context '%cancelBooking%' → 0(時間覆蓋 2026-05-11~今,橫跨 Module 2.10 抽離前後);bookings 總數 0、各狀態皆空。結論分兩層(對抗驗證 P1 修正):①資料面零受害、無列需清;②程式碼面 latent bug 尚未修也尚未觸發 → **第一筆真訂單取消就會踩到,補救=把本波修法 ship 上 prod(不是關單)**。未代改任何列。

**P3 順手九條**(驗收判定檔清單):①minPrice 條目 sources 移除錯吞的 1164/1165(deactivateZeroPriceTours 條目已覆蓋);②marginAudit 兩條補 '?'→'Q' 說明 note;③rehearsalCore.test 補 `--`/`#` 前導註解 expect;④gate sentinel END 解析改 lastIndexOf;⑤gate:73 stderr 轉發本地的註解改準確 + Node 升版複驗提醒;⑥safe-deploy docstring 補 6.5 閘 + SKIP_SQL_REHEARSAL、改 all-7-gates 字樣;⑦progress 行數改非脆性描述;⑧weeklyCorrectnessAudit 傳入 now;⑨T6 §5.2 純澄清(歷史檔不改)。

驗證:tsc 0 錯;targeted vitest(sqlRehearsal/opsActions/observability/weeklyCorrectnessAudit)122 綠;safe-deploy 22/22;prod EXPLAIN 238/238;三路 fresh 對抗驗證(修法正確性/registry 同步/盤查推理)。

**待 Jeff**:opsActions 修正併回 main 後隨下批 ship(gate 6.5 本機即生效)。

---

> 舊批次全文(Phase 1a 至 Wave1 收官)已歸檔至 `archive/progress-history.md`。
