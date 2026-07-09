# 派工單:硬化戰役 Wave 2 — 資料庫真實化(殺 SQL 盲區)

> 指揮:Fable(2026-07-09)。執行模型:sonnet 5。上游:`hardening-plan.md` Wave 2。
> 背景:本地無 DATABASE_URL、測試全 mock,raw SQL 的 parse/resolution 錯誤全是 prod 首演才爆。TiDB 已咬三口(LIKE ESCAPE 反斜線、migration 註解 `-->` 切壞 0112、ORDER BY 關聯子查詢)。目標:ship 前把這一整類擋在部署閘。
> 注意:指揮的四路偵察還在背景跑,若本檔底部出現「偵察補遺」章節,以補遺為準。開工前 `git pull`。

## 規模事實(指揮已量)

- `sql\`` 在 server/ 非測試檔共約 168 處、57 個檔案。另有 `db.execute(` 直呼待你盤點。
- 既有守門先例:`server/_core/migrationBreakpoint.test.ts`(grep 守門測試寫法)、`scripts/safe-deploy.mjs`(七道閘)、`server/_core/deploySmoke.ts`(LOCAL_SCRIPT_TOKEN 端點模式)、flyctl ssh + base64 node 腳本探針(Wave 1 走查全程用過,`wave1-post-ship-walkthrough-20260709.md` 有實例)。

## 塊 A — SQL 登記表(sonnet)

1. 全量盤點 server/ 的 `sql\`` 與 `db.execute(`,逐處分三類:
   - A 獨立完整語句(可直接 EXPLAIN)
   - B 片段(在 drizzle builder 的 .where()/.orderBy()/select 表達式內,要包住它的整條 query 才能 EXPLAIN)
   - C 非查詢(sql.raw 常量、identifier、DDL)→ 白名單,逐條寫理由
2. 建 `server/_core/sqlRehearsal/registry.ts`(或等價結構,你定):每個 A/B 類點一個條目 `{ key, source: "file:line", sql, sampleParams }`。
   - sql 是可執行形:B 類片段登記「包住它的整條 query」的形。優先用真 builder 的 `.toSQL()` 產生(drizzle 不連線也能 toSQL);嵌太深拿不出來的允許手抄等價形,條目標 `handWritten: true`,走查會抽查比對。
   - sampleParams 數量必須等於佔位符數,登記表單測驗算(數量不符=紅)。
3. 佔位符處理:MySQL/TiDB 的 EXPLAIN 不吃 `?`。彩排腳本用 mysql2 的 escape/format 在客戶端把 sampleParams 代入成完整語句再 EXPLAIN。sampleParams 用無害假值(id=1、email='x@x.com'、日期 '2026-01-01')。

## 塊 B — ship 前 EXPLAIN 彩排閘(sonnet;通道腳本需一路對抗審查)

1. 通道採甲案:flyctl ssh console 進 prod 機,以 base64 餵 node 腳本,用機上 DATABASE_URL 對 TiDB 跑 EXPLAIN。不新增 HTTP 端點(不開新攻擊面)。ship 腳本本來就在用 flyctl ssh 拿 LOCAL_SCRIPT_TOKEN,通道成本已付。
2. 安全鐵則(缺一不收):
   - 每條語句強制以 `EXPLAIN ` 開頭(腳本端加,不信登記表)。
   - 單語句檢查:語句內不得含分號(尾隨除外)。
   - 連線 `SET SESSION TRANSACTION READ ONLY` 後才跑。
   - 只回 pass/fail + 錯誤訊息,不回 EXPLAIN 結果行(避免 schema 細節進 log)。
3. 嵌進 `scripts/safe-deploy.mjs`:新閘排在 vitest(現閘 6)之後、token 閘之前,顯示為 [6.5/7] 或重編號,不得弱化任何既有閘。
4. 失敗語義:任一 EXPLAIN 報 parse/resolution 錯 → 紅字列出 key + source + 錯誤,擋部署(fail-closed)。通道本身失敗(flyctl 連不上)也擋,但紅字附逃生口說明:`SKIP_SQL_REHEARSAL=1 pnpm ship`(印出警語,Jeff 自行決定)。
5. 效能:168 條逐條 EXPLAIN 應在秒級;一次 ssh 會話內全跑完,不要 168 次 ssh。

## 塊 C — 登記紀律 grep 測試(sonnet)

1. 仿 migrationBreakpoint.test.ts:枚舉 server/ 所有 `sql\`` 與 `db.execute(` 出現點,每一點必須「在登記表有條目」或「在 C 類白名單」,否則測試紅,錯誤訊息教人怎麼登記。
2. 紅路自證:臨時加一個未登記的 sql`` 點,跑測試確認會紅,再移除(證據進 T6)。

## 紅線

- `pnpm ship` 只有 Jeff 跑;你絕不跑 flyctl deploy。修改 safe-deploy.mjs 只准加閘,不准動既有七閘語義。
- prod 一切互動唯讀;彩排腳本連寫入語句的能力都不該有(READ ONLY session)。
- 本批用 git worktree 隔離開發(主 checkout 有設計線並行),commit 只 add 自己的檔案。
- 測試禁插真實資料進 DB;新增非同步斷言遵守 T2 地雷 #6(vi.waitFor,單檔連跑 5 次)。

## 預答裁決(不用回來問)

1. 彩排「抓不到」的類型要寫進文件:EXPLAIN 抓 parse/resolution,抓不到行為差異(ESCAPE 那口是行為差異,靠測試不靠彩排)。在 registry.ts 檔頭註解寫明邊界,避免後人誤信彩排=全保險。
2. EXPLAIN 對 UPDATE/INSERT/DELETE 語句合法且不執行,DML 條目照登記照 EXPLAIN。
3. 登記表允許同 key 多形(動態拼接的分支各登一形),key 命名 `file佚名.函式.分支` 風格,你定但要一致。
4. migration 檔(drizzle/*.sql)不進本登記表,已有 migrationBreakpoint.test.ts 守;不重複建設。
5. 走查發現的 gmail-poll 36 筆歷史 failed(2026-06-17 殘留)在本批順手清:flyctl ssh 唯讀確認後,出 dry-run 清單給 Jeff 過目,他點頭才 obliterate;同時 D1 的 queue failed 行改「近 7 天」口徑(observabilityCounters.ts),消掉永久假警告。

## 驗收(T6 交付)

1. tsc 0 錯 + vitest 全綠;新測試含登記表驗算、彩排腳本安全鐵則單測(EXPLAIN 前綴強制、分號攔截、READ ONLY)。
2. 對 prod 真跑一輪彩排:全部條目 pass 或逐條 triage(真錯就修,TiDB 特性就記錄)。輸出貼 T6。
3. 紅路演練 x2:壞 SQL 條目擋閘(截輸出)、未登記 sql`` 測試紅(截輸出)。
4. 通道腳本一路 fresh 對抗審查(安全視角:注入、寫繞過、多語句),PASS 才收。
5. 回寫 progress.md + 本檔補實際數字。commit 訊息 `feat(hardening): wave2 <塊>`。
