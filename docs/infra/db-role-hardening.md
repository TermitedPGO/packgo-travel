# DB 角色權限硬化：探真報告 + 執行 runbook

> 批次：DB 硬化批（P0）。日期：2026-07-12。狀態：報告已完成、runbook 已撰寫、程式接線已就緒（紅綠齊）；**權限角色尚待 Jeff 在 TiDB Cloud console/SQL 建立**（本批不建真使用者、不碰真憑證）。
> 上游動機：`docs/features/public-site/incident-20260617-tours-wipe.md`（tours 等七表被非正規 DDL 清空）。

---

## 一、prod 唯讀探真（真實證據）

方法：唯讀。走既有已驗證通道 `flyctl ssh console -a packgo-travel`，在 prod 機上用機上自帶的 `DATABASE_URL` 直連 TiDB，只跑 `SELECT` / `SHOW` / `information_schema` 查詢，零寫入、零 DDL。連線字串絕不進命令列、不落地。

### 1.1 runtime 身分（這是核心發現）

```
CURRENT_USER()  = JgQYPzTFfGurZh9.root@%
USER()          = JgQYPzTFfGurZh9.root@204.93.239.18
```

app 進程用的是 TiDB Cloud 叢集的 **root** SQL 帳號。`SHOW GRANTS FOR CURRENT_USER()` 實測：

```
GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,DROP,PROCESS,REFERENCES,ALTER,SHOW DATABASES,
      SUPER,EXECUTE,INDEX,CREATE USER,CREATE TABLESPACE,TRIGGER,CREATE VIEW,SHOW VIEW,
      CREATE ROLE,DROP ROLE,CREATE TEMPORARY TABLES,LOCK TABLES,CREATE ROUTINE,ALTER ROUTINE,
      EVENT,RELOAD,FILE,REPLICATION CLIENT,REPLICATION SLAVE
  ON *.* TO 'JgQYPzTFfGurZh9.root'@'%' WITH GRANT OPTION
```

判讀：runtime 帳號握有 **CREATE / DROP / ALTER / TRUNCATE(隱含於 DROP)/ CREATE USER**，範圍是 `*.*`，還帶 **WITH GRANT OPTION**。也就是說：任何能碰到 `DATABASE_URL` 的程式碼路徑、或任何人拿這條連線字串直跑 `drizzle-kit push` / 手動 DDL，都能 DROP/TRUNCATE 任何一張表。**這正是 2026-06-17 tours 清空事故的結構成因** —— 不是「有人惡意」，而是「runtime 憑證本來就有 DROP 權限，沒有任何一層擋」。

`information_schema.SCHEMA_PRIVILEGES`（針對此 grantee）為空，代表所有權限都是全域 `*.*`，沒有任何 schema 級收斂。

### 1.2 環境事實

| 項目 | 值 |
|------|-----|
| 引擎 | `8.0.11-TiDB-v8.5.3-serverless`（TiDB Cloud Serverless / Starter，Community） |
| 叢集使用者前綴 | `JgQYPzTFfGurZh9.`（Serverless 強制：所有 SQL 使用者名稱必須帶此前綴） |
| app schema | `test`（`DATABASE()` = `test`，93 張表；唯一的使用者 schema） |
| 全部 schema | `INFORMATION_SCHEMA` / `PERFORMANCE_SCHEMA` / `mysql` / `test` |
| 叢集內 SQL 使用者（`mysql.user`） | `JgQYPzTFfGurZh9.{root, cloud_admin, jeffhs_Sv9LFdfa, G336LVR0_APIKEY, C336HCV0_APIKEY}` + `role_admin@%` |

必要表存在核對（16 張災難級表，2026-07-12 實測全數存在於 `test`）：`tours / bookings / payments / tourDepartures / tourReviews / catalogBatches / toursCatalogArchive / customerProfiles / customOrders / users / inquiries / trustDeferredIncome / bankTransactions / __drizzle_migrations / supplierProducts / supplierProductDetails`。

### 1.3 TiDB Cloud 使用者管理（查官方文件）

- **使用者前綴**：TiDB Cloud Starter/Serverless/Essential 的 SQL 使用者名稱與內建角色都必須以叢集前綴開頭（本叢集 = `JgQYPzTFfGurZh9.`）。用 SQL `CREATE USER` 時要自己帶前綴；用 console「SQL Users」頁建立時，console 會自動補前綴。來源：docs.pingcap.com/tidbcloud/configure-sql-users、terraform-use-sql-user-resource。
- **可用 SQL 或 console**：root（本 runtime 帳號)有 `CREATE USER`，可直接用 SQL `CREATE USER` + `GRANT`（TiDB 執行成功後對當前連線即時生效）。也可走 console 的 SQL Users 頁（GUI）。
- **內建角色**：TiDB Cloud 有 `role_admin` / `role_readwrite` / `role_readonly` 三個內建角色（本叢集 `mysql.user` 就有 `role_admin`）。官方文件未逐一列出 `role_readwrite` 是否含 DDL，**本方案刻意不倚賴內建角色**，改用明列權限的自建帳號，杜絕「以為 readwrite 沒 DDL、其實有」的盲區。

---

## 二、權限隔離方案

把「一個 root 幹全部」拆成兩個最小權限身分：

| 身分 | 用途 | 權限 | 連線來源 |
|------|------|------|----------|
| `app_runtime` | 長跑的 app 進程（讀寫業務資料） | **CRUD only**：`SELECT, INSERT, UPDATE, DELETE ON test.*`。無 CREATE/DROP/ALTER/INDEX/TRUNCATE、無 CREATE USER、無 `*.*`、無 GRANT OPTION | `DATABASE_URL`（Fly secret） |
| `migrator` | 只在 `release_command`（`scripts/migrate.mjs`）跑 migration | **DDL + DML,收斂到 test schema**：`SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES, CREATE VIEW, CREATE TEMPORARY TABLES, LOCK TABLES ON test.*`。無 `*.*`、無 CREATE USER、無 SUPER、無 GRANT OPTION | `MIGRATION_DATABASE_URL`（Fly secret） |

為什麼 app_runtime 給純 CRUD 就夠：已掃過 `server/`，無任何 runtime 路徑跑 DDL（`grep -rIE "execute\(sql\`\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)"` 零命中）、無 `CREATE TEMPORARY` / `LOCK TABLES`。schema 契約探測查的是 `information_schema.tables`（metadata，CRUD 帳號可讀自己有權的表）。若日後某條 runtime query 真的需要額外權限，**明列補上該一項**，絕不因此回退成給 DDL/`*.*`。

root 帳號保留（TiDB Cloud console 管理與緊急回滾用),但不再當 runtime/migration 的日常憑證。

### 2.1 Jeff 執行腳本（在 TiDB Cloud console SQL 編輯器 / chat2query，或 mysql client，以 root 身分執行）

> 密碼一律佔位符 `<<...>>`，Jeff 自填強密碼。本批不生成真憑證。

```sql
-- ===== migrator（DDL,僅 release_command 用）=====
CREATE USER 'JgQYPzTFfGurZh9.migrator'@'%' IDENTIFIED BY '<<MIGRATOR_PASSWORD>>';
GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, DROP, ALTER, INDEX, REFERENCES,
      CREATE VIEW, CREATE TEMPORARY TABLES, LOCK TABLES
  ON `test`.* TO 'JgQYPzTFfGurZh9.migrator'@'%';

-- ===== app_runtime（CRUD,無 DDL）=====
CREATE USER 'JgQYPzTFfGurZh9.app_runtime'@'%' IDENTIFIED BY '<<APP_RUNTIME_PASSWORD>>';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `test`.* TO 'JgQYPzTFfGurZh9.app_runtime'@'%';

-- ===== 驗證（貼回結果核對:app_runtime 不得出現 CREATE/DROP/ALTER）=====
SHOW GRANTS FOR 'JgQYPzTFfGurZh9.migrator'@'%';
SHOW GRANTS FOR 'JgQYPzTFfGurZh9.app_runtime'@'%';
```

### 2.2 canary 隔離靶（給第四件 DDL 拒絕測試用；完全無客戶資料）

```sql
-- 獨立 schema,零業務資料。app_runtime 只給 CRUD;探測靶表由 migrator 建。
CREATE DATABASE IF NOT EXISTS `canary`;
GRANT SELECT, INSERT, UPDATE, DELETE ON `canary`.* TO 'JgQYPzTFfGurZh9.app_runtime'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, DROP, ALTER, INDEX, REFERENCES,
      CREATE VIEW, CREATE TEMPORARY TABLES, LOCK TABLES
  ON `canary`.* TO 'JgQYPzTFfGurZh9.migrator'@'%';

-- 用 migrator 身分（另開連線）在 canary 建一張探測靶表,給 ALTER/TRUNCATE/DROP 探測打:
--   CREATE TABLE `canary`.`canary_probe_target` (id INT PRIMARY KEY);
```

### 2.3 Fly secrets 設定、切換、回滾

先把現行 root 連線字串**存起來**（回滾用）：`flyctl secrets list -a packgo-travel` 看得到 key,值要從 Jeff 自己的保管處取。

切換分兩步,每步一次部署,先動 migration 憑證（風險低、絞殺式,不先動唯一活著的 runtime 連線）：

```bash
# 步驟 1:先給 migrator。release_command / scripts/migrate.mjs 會優先讀 MIGRATION_DATABASE_URL。
#   此時 app runtime 仍用舊 root DATABASE_URL(不受影響)。
flyctl secrets set \
  MIGRATION_DATABASE_URL='mysql://JgQYPzTFfGurZh9.migrator:<<PW>>@<HOST>:4000/test?ssl={"rejectUnauthorized":true}' \
  -a packgo-travel
# → 觸發部署。看 release 日誌應出現:
#   [migrate] credential source: MIGRATION_DATABASE_URL (migrator)
#   [migrate] ✅ Complete
# 確認 migration 在 migrator 身分下成功後,再進步驟 2。

# 步驟 2:把 runtime 換成 app_runtime(CRUD only)。
flyctl secrets set \
  DATABASE_URL='mysql://JgQYPzTFfGurZh9.app_runtime:<<PW>>@<HOST>:4000/test?ssl={"rejectUnauthorized":true}' \
  -a packgo-travel
# → 觸發部署。上線後驗:
#   curl -s https://packgoplay.com/health | jq '.checks.schema'   # 應 status:"ok"
#   後台各頁 CRUD 正常(deploySmoke 第九臂 schemaContract 綠)。
```

回滾（app_runtime 若卡到某條需要額外權限的 runtime query）：

```bash
# 立即把 runtime 換回 root 連線字串(從保管處取),恢復服務:
flyctl secrets set DATABASE_URL='<<SAVED_ROOT_URL>>' -a packgo-travel
# migration 憑證要回退成舊行為(byte-identical):unset 後 scripts/migrate.mjs 自動回退讀 DATABASE_URL:
flyctl secrets unset MIGRATION_DATABASE_URL -a packgo-travel
# 然後在 console 給 app_runtime 明列補上缺的那一項權限,重走步驟 2。切勿因此回頭給 DDL/*.*。
```

---

## 三、程式接線（本批已完成，紅綠齊）

1. `scripts/migrate.mjs`：優先讀 `MIGRATION_DATABASE_URL`,未設回退 `DATABASE_URL`(用 `??`,行為 byte-identical);印出用的是哪個憑證來源(絕不印 URL)。
2. `server/_core/schemaContract.ts`(新):`REQUIRED_TABLES`(16 張災難級表)+ `assertSchemaContract(db)`,查 `information_schema.tables` 比對,回傳缺失清單。純讀。
3. `server/_core/healthCheck.ts`:新增 `schema` 子檢查。必要表缺失 → `/health` 降級 503,UptimeRobot 告警(不再靜默)。
4. `server/_core/index.ts`:啟動時跑一次 schema 契約斷言,缺表用 errorFunnel 大聲(直達 Jeff)+ log.error;刻意不 crash 進程。
5. `server/_core/deploySmoke.ts`:第九臂 `schemaContract`,ship 後煙霧缺表即標紅並列出缺哪張。
6. 測試:`schemaContract.test.ts`(新,9)、`healthCheck.test.ts`(+case6)、`deploySmoke.test.ts`(第九臂三情境)、`sqlRehearsal/coverage.test.ts`(白名單同步)全綠。`tsc --noEmit` 0 錯。

---

## 四、狀態階梯（誠實標示）

- [x] runbook 已撰寫（本檔）
- [x] 程式接線已就緒（migrate.mjs 憑證優先序、schema 契約三處觀測、紅綠齊）
- [ ] 環境已準備（Jeff 在 console/SQL 建 app_runtime + migrator + canary）← **下一步在 Jeff**
- [ ] 角色已套用（Fly secrets 切換 + 兩步部署驗證）
- [ ] DDL 拒絕已驗（`scripts/canary-ddl-rejection.mjs` 對 canary 實跑,四類全被拒 + SQLSTATE）

本批最遠只到「runbook 已撰寫 + 程式已接線」。**未宣稱**權限隔離已生效（那要 Jeff 建角色 + 實跑 canary 測試後才算）。

## 五、等 Jeff 的 console 操作清單

1. 在 TiDB Cloud（SQL 或 console SQL Users 頁,以 root）跑 §2.1 建 app_runtime + migrator,貼回兩份 `SHOW GRANTS` 供核對。
2. 跑 §2.2 建 canary schema + 授權 + 由 migrator 建 `canary_probe_target`。
3. 依 §2.3 兩步設 Fly secrets 並部署,回報 release 日誌的 `credential source` 行與 `/health` 的 `checks.schema`。
4. 設 `CANARY_APP_RUNTIME_DATABASE_URL` 跑 `node scripts/canary-ddl-rejection.mjs`,回報四類 DDL 是否全被拒 + 各自 errno/sqlState。
