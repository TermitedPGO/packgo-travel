# DB 硬化批 progress

> 批次:DB 硬化批(P0)。分支:`db-hardening`(worktree,不合 main)。日期:2026-07-12。
> 目標:把「runtime 用 root、有 DROP 權限」這個 2026-06-17 tours 清空的結構成因,做成權限隔離 + schema 契約觀測 + 還原演練 runbook。

## 交付清單

1. **prod 唯讀探真**:runtime = `JgQYPzTFfGurZh9.root@%`,`*.*` 全 DDL + `CREATE USER` + `WITH GRANT OPTION`。app schema = `test`(93 表),TiDB v8.5.3-serverless,叢集前綴 `JgQYPzTFfGurZh9.`。全文 + `SHOW GRANTS` 原文:`docs/infra/db-role-hardening.md` §1。
2. **權限隔離方案 + Jeff 腳本**:`app_runtime`(CRUD `test.*`)+ `migrator`(DDL 收斂 `test.*`,僅 release_command)。含 canary schema 建置、Fly secrets 兩步切換、回滾。密碼全佔位符,未建真使用者、未碰真憑證。`docs/infra/db-role-hardening.md` §2。
3. **程式接線(紅綠齊)**:
   - `scripts/migrate.mjs`:優先 `MIGRATION_DATABASE_URL`,`??` 回退 `DATABASE_URL`(byte-identical);印憑證來源不印 URL。
   - `server/_core/schemaContract.ts`(新):`REQUIRED_TABLES`(16)+ `assertSchemaContract(db)`,查 `information_schema.tables`,純讀。
   - `server/_core/healthCheck.ts`:新增 `schema` 子檢查 → 缺表 `/health` 降級 503。orchestrator 改成「getDb 只解一次、傳進 checkDb/checkSchema」(見下方地雷)。
   - `server/_core/index.ts`:啟動一次性 schema 斷言,缺表走 errorFunnel 大聲 + log.error,不 crash。
   - `server/_core/deploySmoke.ts`:第九臂 `schemaContract`。
   - `sqlRehearsal/registryWhitelist.ts`:schemaContract 的 information_schema 探測 + healthCheck SELECT 1 行號漂移同步。
4. **canary DDL 拒絕測試腳本**:`scripts/canary-ddl-rejection.mjs`。`node --check` 過。設計成「Jeff 建完 canary + app_runtime 後才實跑」,本批不實跑(prod 無 canary)。四類 DDL(CREATE/ALTER/TRUNCATE/DROP)以 app_runtime 對 canary 試,斷言全被拒 + 附真實 errno/sqlState;任一成功 = 立即停、印 P0、不續試。原文見附錄(地雷 #7 留檔)。
5. **還原演練 runbook**:`docs/infra/restore-drill.md`。TiDB Cloud 備份還原到隔離 cluster、勾稽 SQL、RPO/RTO 記錄表、部分刪除 + 單供應商停更兩情境。狀態:runbook已撰寫,待Jeff執行。

## 驗證鏈

- `NODE_OPTIONS="--max-old-space-size=6144" npx tsc --noEmit`:0 錯。
- 新/改測試:`schemaContract.test.ts`(9)、`healthCheck.test.ts`(6,含 case6 schema breach)、`deploySmoke.test.ts`(第九臂三情境)、`sqlRehearsal/coverage.test.ts`、`registry.test.ts` 全綠(兩輪)。
- `node --check scripts/canary-ddl-rejection.mjs` / `scripts/migrate.mjs`:過。

## 待 Jeff console 操作(等這幾件才能推進狀態階梯)

1. 建 app_runtime + migrator + canary(`db-role-hardening.md` §2.1/§2.2),貼回 `SHOW GRANTS`。
2. Fly secrets 兩步切換 + 部署(§2.3),回報 release 日誌 `credential source` 行與 `/health` `checks.schema`。
3. 設 `CANARY_APP_RUNTIME_DATABASE_URL` 跑 canary 拒絕測試,回報四類 DDL 的 errno/sqlState。
4. 還原演練(`restore-drill.md`)實跑,回填 RPO/RTO。

## 地雷紀錄

- **地雷 #7(scripts/ 或字串內嵌 code,tsc 非有效證據)**:本批 `scripts/canary-ddl-rejection.mjs`、`scripts/migrate.mjs` 都在 `scripts/`(不在 tsconfig include),故驗收附 `node --check` 而非只靠 tsc。canary 腳本原文落本檔附錄留檔。腳本 SQL 一律單引號字串常量、不插值。
- **Vitest 動態 import + mock 陷阱(本批踩到,記給後人)**:healthCheck 原本每個子檢查各自 `await import("../db")` 取 getDb。新增 `checkSchema` 後,同一次 run 裡 `checkDb` 拿到 mock 的 getDb、`checkSchema` 卻拿到**真** getDb(回 null,因測試環境無 DATABASE_URL)—— 同一 specifier、同一檔,兩個並發動態 import 竟解到不同模組實例(mock vs real)。修法:orchestrator 只解一次 getDb,把 db handle 傳進 checkDb / checkSchema,消掉重複動態 import。教訓:SUT 內對「被 mock 的模組」重複 `await import()`,在 Vitest forks pool 下會漂移,能傳值就別重解。

## 硬紅線遵守

不建真使用者、不碰真憑證(密碼全佔位符);prod 只做唯讀探真(SELECT/SHOW/information_schema,零 DDL、零寫入);canary 拒絕測試不實跑(prod 無 canary);還原演練最遠只到「runbook已撰寫」,未宣稱還原成功。

---

## 附錄:`scripts/canary-ddl-rejection.mjs` 原文(地雷 #7 留檔)

> 節錄自本批交付檔;`node --check` 通過。實跑證據待 Jeff 建 canary 後補(本批不實跑)。

```js
#!/usr/bin/env node
// canary-ddl-rejection.mjs — app_runtime 身分「不得跑 DDL」的實證測試。
// 安全鐵律:只對隔離 canary schema 跑(身分名須含 app_runtime、schema 名須含 canary,
//   否則中止);任一 DDL 成功 = P0 立即停不續試;每個拒絕附真實 errno/sqlState,只有
//   privilege-denied 類錯碼(1142/1044/1045/1227)才算合格拒絕。
// 四類 DDL 探測:CREATE / ALTER / TRUNCATE / DROP。SQL 一律單引號字串常量,不插值。
//
// 用法(Jeff,canary 佈置後):
//   CANARY_APP_RUNTIME_DATABASE_URL='mysql://<prefix>.app_runtime:<pw>@<host>:4000/canary' \
//     node scripts/canary-ddl-rejection.mjs
// 退出碼:0=四類全被合格拒絕;1=有 DDL 成功(P0)或 INCONCLUSIVE;2=未設 env(無害跳過)。
//
// 完整實作見 scripts/canary-ddl-rejection.mjs(此處為契約摘要,原始檔為單一事實來源):
//   - PRIVILEGE_DENIED_ERRNOS = {1142,1044,1045,1227}
//   - PROBES = [CREATE canary_ddl_probe..., ALTER canary_probe_target...,
//               TRUNCATE canary_probe_target, DROP canary_probe_target]
//   - 連線後先 SELECT CURRENT_USER()/DATABASE() 自證身分與 schema,防呆(名不含
//     app_runtime / canary 即中止)。
//   - 逐條試:query 成功 → P0 橫幅 + exit 1(不續試);throw 且 errno ∈ 允許集 →
//     REJECTED_OK;throw 但非權限錯 → INCONCLUSIVE(多半靶表沒佈好)。
//   - 全 REJECTED_OK → exit 0;否則 exit 1。
```

> 預期(Jeff 實跑時應見):四行皆 `✅ 合格拒絕`,各帶 errno(app_runtime 對 test/canary 只有 CRUD,CREATE/ALTER/TRUNCATE/DROP 應回 1142 ER_TABLEACCESS_DENIED_ERROR / sqlState 42000)。任一行成功或 INCONCLUSIVE 即未通過。
