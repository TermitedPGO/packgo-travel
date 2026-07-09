# 完工報告:硬化戰役 Wave2 — 資料庫真實化(殺 SQL 盲區)

> 執行:opus 4.8 / 2026-07-09 / branch `hardening-wave2`(worktree `../網站-wave2`,主 checkout 設計線並行)。
> 目標:raw SQL 的 parse/resolution 錯全是 prod 首演才爆(TiDB 已咬三口),這批讓它們 ship 前就死在部署閘。

## 1. 交付清單

commit `d6fc35d`(13 檔,+2993 / -31):

- 塊A `server/_core/sqlRehearsal/`:登記表 registry.ts(型別+邊界註解)、registryEntries.ts(238 條)、registryWhitelist.ts(3 條)、registry.test.ts(自驗)。
- 塊C `server/_core/sqlRehearsal/coverage.test.ts`:登記紀律 grep 守門。
- 塊B `scripts/sqlRehearsalGate.ts`(orchestrator)+ `scripts/sqlRehearsal/rehearsalCore.mjs`(純邏輯核心)+ `rehearsalCore.test.ts`(安全鐵則四條單測);嵌進 `scripts/safe-deploy.mjs` 閘 [6.5/7] + `safe-deploy.test.mjs` 閘測試。
- 順手活 `server/_core/observabilityCounters.ts` + `.test.ts`:queue failed 改近 7 天口徑。
- `docs/features/customer-cockpit/progress.md`:Wave2 回寫。

## 2. 自測證據(逐條可稽核)

**tsc**:`pnpm exec tsc --noEmit` → exit 0、0 error(NODE_OPTIONS=--max-old-space-size=6144)。

**vitest 全套**(終端原樣貼):
```
 Test Files  321 passed | 11 skipped (332)
      Tests  4728 passed | 90 skipped (4818)
```
- sqlRehearsal 三檔 `Test Files 3 passed (3) / Tests 24 passed (24)`。
- 新測試單獨連跑 5 次證穩(sqlRehearsal + observability,每次 `Tests 45 passed (45)`,零間歇)。
- safe-deploy `node --test scripts/safe-deploy.test.mjs` → `# tests 22 # pass 22 # fail 0`(原 17 + 新閘 5)。

**prod EXPLAIN 彩排真跑**:`pnpm exec tsx scripts/sqlRehearsalGate.ts` 對 prod TiDB → **ok:true, passed 238/238, failures 0**。首輪(硬化前)抓出 2 條,triage:
- `adminCustomers.buildGuestListQuery`:手抄版 `Unknown column 'customerprofiles.id'` → 換成真 builder `buildGuestListQuery(...).toSQL()` 逐字輸出(零漂移,handWritten:false)。真版 SELECT 子查詢用 bare `id`(T2 地雷#4 掉表前綴)—— parse 得過,語意由 adminCustomers.test.ts 形狀斷言守,非彩排。
- `opsActions.doCancelBooking.updateBookingMessage`:手抄版語法錯(`?` 卡字串字面內)→ 登記表把日期戳 inline 成字面以便 EXPLAIN 驗結構(見「已知限制」的 latent bug 申報)。
- 其餘 TiDB 特性 triage:`SET SESSION TRANSACTION READ ONLY` 在 TiDB 是 noop function、預設被擋 → 先開 `tidb_enable_noop_functions`、best-effort、失敗不中斷(真正唯讀保證是「只送 EXPLAIN」)。已記進 registry.ts 檔頭 + orchestrator 註解。

**對抗審查**:一路 fresh(opus,注入/寫繞過/多語句/ANALYZE/憑證洩漏視角)。首判 FAIL,抓 1 阻塞 + 2 低:
- P0 阻塞:鐵則 1 只擋 `EXPLAIN` 前綴,不擋 bare `ANALYZE`(`EXPLAIN `+`ANALYZE DELETE` = EXPLAIN ANALYZE 對 DML 真執行)→ 改正向白名單 `assertLeadingVerbAllowed`(只放行 SELECT/INSERT/UPDATE/DELETE/REPLACE/WITH），一併關掉 EXPLAIN、bare ANALYZE、前導區塊註解、非 DML 動詞。
- P2:遠端 channelError 可能夾 e.message → DB connect / `new URL(raw)` 失敗會露 DATABASE_URL(含密碼)→ 明細只寫遠端 stderr,回本地用固定字串。
- P2:orchestrator 未交叉比對 `res.total === entries.length`,payload 截斷會 0/0 soft fail-open → 補斷言,不符當通道失敗擋部署。
- 三條全修,同一審查者 fresh 複驗 **PASS**(親自重跑 prod 238/238、tsc 0、vitest 24/24、確認舊函式名無殘留)。

**行為驗證(紅路演練 x2)**:
- 壞 SQL 擋閘:臨時加 `SELECT this_column_does_not_exist ...` 條目 → prod EXPLAIN 回 `Unknown column 'this_column_does_not_exist' in 'field list'` → orchestrator ok:false → 閘 fail-closed 擋部署。移除還原。
- 未登記 sql`` 測試紅:臨時加 `server/_core/_redpath_demo.ts` 一個 sql`` 點 → coverage.test.ts 紅,印教學訊息「以下 raw SQL 出現點沒登記(共 1 處)... 加一條 { key, sources, cls, sql, sampleParams }」。移除。
- 通道 fail-closed 實地演示:一次 flyctl ssh 通道 transient 失敗,閘正確回 channelError 擋部署並印逃生口(重試即 238/238)。

## 3. 偏離申報

- **規模**:派工單「168 處 / 57 檔」是 naive `grep 'sql\`'` 算的,漏掉 189 個泛型 `sql<T>\`\``(`sql<Date>` 正是 raw-sql-date naive 字串雷所在)。廣義 regex 抓到真實 357 處 / 78 檔,共 356 唯一 token。我擴到全覆蓋(不擴就在最該覆蓋的泛型處留洞),未回來問,理由:目標與方向不變、只是量的前提錯,且泛型正是高危類。
- **條目產法**:派工單「優先用真 builder .toSQL()」。除旗艦 buildGuestListQuery 用真 toSQL 外,其餘 237 條走「手抄裸語句 + prod 真 EXPLAIN 驗證」路線(handWritten:true)。理由:357 處逐條 QueryBuilder 重建工程量與出錯面都大,而 prod 真 EXPLAIN 是比 offline toSQL 更硬的 parse 保證(238/238 已跑過)。fidelity 由「prod EXPLAIN 全過」兜底,不是靠 offline 渲染。
- **通道實作**:派工單原文寫 base64 餵 node;實測 238 條 blob 破百 KB,當 echo 參數 `argument list too long`,改走 stdin(免 arg 限、免 base64/shell 轉義)。語義不變(仍 flyctl ssh + 機上 DATABASE_URL + 唯讀)。

## 4. 已知限制(誠實列)

- **opsActions.ts:390 疑似 latent bug(非本批修)**:真碼 `sql\`...OpsAgent ${new Date()...}] ...\`` 把日期戳內插進未關閉的字串字面 → drizzle 渲成 `'...OpsAgent ?] '`(`?` 卡引號裡)。這是 drizzle footgun,執行期行為可疑(取決於 driver 是 text 還是 prepared 協定)。屬 prod 產品碼、非本任務(建閘)範圍,未改,flag 給 Jeff。登記表已 inline 日期讓它 EXPLAIN-able。
- **scheduledLearningService.ts:519 既有邏輯 bug(編目時發現,非本批修)**:`sql\`${tours.id} IN (${tourIds.join(',')})\`` 渲成 `id IN (?)` 綁 '1,2,3' 單一字串,無法 match 任何列。照實登記(EXPLAIN parse 得過),flag 給 Jeff。
- **手抄條目的漂移風險**:237 條 handWritten 的裸語句若與真實 query 有出入,prod EXPLAIN 只驗「我登記的形狀 parse 得過」,不保證逐字等於 prod 跑的。首輪已用真 EXPLAIN 抓出 2 條走樣並修;殘餘風險是「手抄剛好 parse 得過但與真 query 有微差」—— 靠走查抽查(handWritten 標記已備)。
- **500 筆掃描上限(observability)**:單 queue failed 超過 500 筆時只掃前 500(防爆安全界);週報是信號非精確稽核。gmail-poll 實際 36 筆遠低於此。
- **coverage 攻擊面**:coverage.test.ts 只認 `sql(<...>)?\`` 與 `db.execute(` 兩種 pattern。若未來用別的方式建 raw SQL(sql.raw( 動態拼、其他 execute 包裝),不在守門範圍。目前 repo 這兩種涵蓋主要面。

## 5. 給指揮的審查建議(自曝最可能有問題的點)

1. **手抄 SQL 的語意保真**:238 條裡只有 1 條是真 toSQL,其餘手抄。prod EXPLAIN 全過只證明「parse 得過」。建議抽查 5-10 條 handWritten(尤其動態分支多的 suppliersRouter/opsTools),比對真實 query 形狀是否等價。抽查名單可挑 note 標 `<90%` 信心的。
2. **span 展開的歸屬粒度**:coverage 用「entry 的 source 行 min-max span 展開成該範圍內的真 token」。若某 subagent 漏編一整條 query,其 token 可能被鄰居 entry 的 span 吞掉(coverage 綠但那條 query 沒被 EXPLAIN)。238 條 + 45 個 overlap 我判定都是動態分支共用行(正確),但這是理論盲點,值得抽一個 overlap 檔核對。
3. **opsActions:390 / scheduledLearningService:519 兩個 latent bug**:是否本 Wave 修、或另立卡。

## 6. 待 Jeff 手動

1. `pnpm ship`(閘 6.5 會在 ship 與 `--dry-run` 時對 prod 唯讀跑一輪彩排;想略過用 `SKIP_SQL_REHEARSAL=1 pnpm ship`,會印警語)。ship 前這批仍在 branch `hardening-wave2`,需先併回 main。
2. **gmail-poll 36 筆歷史 failed 清理點頭**:dry-run 清單見下節。點頭後我用 flyctl ssh 唯讀確認 + `job.remove()`,不點頭不動。

---

## 附:gmail-poll failed dry-run(唯讀,未 remove)

`getFailedCount=36 | fetched=36`,全部 `gmail-poll-tick` 重複 job、attempts=2、同一失敗原因
`Failed query: select id, userId, emailAddress, accessToken, refreshToken, scope, tokenExpiresAt, lastPollAt, lastHistoryId`(gmailIntegrations poll 查詢當時失敗):

- 3 筆:2026-05-27(finishedOn 18:50 / 19:00 / 19:10 UTC)
- 33 筆:2026-06-17(finishedOn 16:10 → 21:30 UTC,約每 10 分一筆連續失敗一段)

全部 finishedOn > 7 天前(距今 22 天)。observability 近 7 天口徑上線後,這 36 筆已不再產生假警告;是否 `job.remove()` 清掉殘留由 Jeff 裁決。
