# Canary 驗證雙腳本(9a / 9b)

DB 硬化批要把網站的長駐連線從 root 換成窄鑰匙帳號 `app_runtime`(只能增刪改查,
不能建表刪表)。換之前要先在一個【隔離靶場】上證明兩件事:

- 9a 正向:該做到的事真的做得到 —— `scripts/canary-runtime-probe.mjs`
- 9b 反向:不該做到的事真的做不到 —— `scripts/canary-ddl-rejection.mjs`

兩支都過,才算「窄鑰匙換上去不會把網站弄壞,也真的擋得住誤刪」。
角色與 grant 的建立步驟見 `docs/infra/db-role-hardening.md`。

> **編號權威**:9a 的檢查項次是 **01 到 14**,共 14 項,以本文件的清單為準。
> 桌面手冊(Jeff 的紙本操作手冊)若寫的編號或項數與此不同,一律以本文件為準。

---

## 安全前提(兩支共通,不滿足就不要跑)

1. **只准打隔離靶場 `canary`**。那個 schema 裡零客戶、零財務、零商品資料,
   只有一張探測靶表 `canary_probe_target`。
   兩支腳本都要求 schema 名【完全等於 `canary`】:
   - 近似名(`canary_backup`、`canary2`…)一律中止。
   - 正式 schema 名 `test` 另外硬擋。
   - 9b 在【連線之前】就先用連線字串裡的 schema 名擋一次,不符就中止,密碼不會送出去;
     連上之後再用伺服器回報的 `DATABASE()` 複核一次。
2. **連線身分必須是 `app_runtime`**。`CURRENT_USER()` 不含 `app_runtime` 就中止。
3. **TLS 必須驗得過**。簽發鏈與主機名兩者都驗。連線字串裡想關掉憑證驗證
   (出現 `rejectUnauthorized=false`)會被直接擋下,沒有討價還價空間。
4. **連線字串與密碼絕不印出**。任何錯誤只印一行不含憑證的摘要
   (`code=… errno=… sqlState=… msg=…`),永遠不印原始 error 物件。
   這條是硬性的:Node 的 `ERR_INVALID_URL` 會把整條連線字串掛在 error 的 `input`
   屬性上,印物件等於把密碼印在畫面上,而這個畫面是要截圖貼給 AI 看的。
5. **兩支都不碰正式站的 advisory lock 名**。9a 用 `canary:probe:tip:lock`,
   刻意不是正式的 `audit:tip:lock` —— 鎖的命名空間整個叢集共用,搶正式鎖 3 秒
   就等於為了驗證製造一筆事故。

---

## 事前準備

依 `docs/infra/db-role-hardening.md` §2.1 / §2.2 完成:

- 建好 `app_runtime` 與 `migrator` 兩個帳號並授權。
- 建好 `canary` schema。
- 用 **migrator** 身分在 canary 建靶表:

```sql
CREATE TABLE `canary`.`canary_probe_target` (id INT PRIMARY KEY);
```

然後設環境變數(兩支共用同一個):

```bash
export CANARY_APP_RUNTIME_DATABASE_URL='mysql://<prefix>.app_runtime:<pw>@<canary-host>:4000/canary'
```

密碼請用純英數 32 位。有特殊符號時連線字串會解析不了,腳本會中止並提示重設。

---

## 9a — `scripts/canary-runtime-probe.mjs`(正向驗證)

### 怎麼跑

```bash
node scripts/canary-runtime-probe.mjs
```

### 它做什麼

用 `app_runtime` 身分,在靶場上把「網站平常真的會做的事」跑一遍,逐項給成績。
會寫資料,但只寫保留區間的 id(19 億起跳),每一筆都登記、結束時逐筆刪掉,
並跟開跑前的列數對帳。任何 UPDATE / DELETE 都帶 `WHERE id = ?`,不存在無 WHERE 版本,
也不用 TRUNCATE。

### 檢查項次(01 到 14,權威清單)

| 項次 | 名稱 | 在驗什麼 |
| --- | --- | --- |
| 01 | 連線有沒有加密、憑證驗不驗得過 | TLS 通道真的存在,且憑證驗得過 |
| 02 | 連線身分與靶場對不對 | `CURRENT_USER()` 含 app_runtime、`DATABASE()` 完全等於 canary |
| 03 | 靶表在不在、乾不乾淨 | 靶表存在、列數合理,記下開跑前的基準列數 |
| 04 | 網站的健康檢查心跳 | `SELECT 1`,正式站每分鐘都在跑這句 |
| 05 | 網站確認資料表還在的那個查詢 | 讀 information_schema 列表 |
| 06 | 新增一筆資料 | INSERT |
| 07 | 剛剛那筆真的存進去了 | 讀回來核對 |
| 08 | 修改一筆資料 | UPDATE(帶 WHERE id = ?) |
| 09 | 刪掉一筆資料 | DELETE(帶 WHERE id = ?) |
| 10 | 交易 | BEGIN / COMMIT 走得通 |
| 11 | 稽核鏈的排隊鎖,拿得到嗎 | GET_LOCK(canary 專屬鎖名) |
| 12 | 稽核鏈的排隊鎖,放得掉嗎 | RELEASE_LOCK |
| 13 | 靶場有沒有清乾淨 | 清掉自己寫的列,並跟第 03 項的基準列數對帳 |
| 14 | 終結自己的連線(稽核鏈的逃生口) | KILL CONNECTION_ID(),另開拋棄式連線跑 |

### 預期輸出

每一項印一列成績(PASS / FAIL / INCONCLUSIVE),最後印一張成績單,含靶場、身分、
主機、開跑與結束的列數。全項 PASS 才算過。

### 退出碼

| 碼 | 意思 |
| --- | --- |
| 0 | 全項通過 |
| 1 | 有任何一項沒過或不成立(fail-closed),或中止 |
| 2 | 沒設 `CANARY_APP_RUNTIME_DATABASE_URL`,無害跳過 |

### 單元測試

純函式層有測,完全不碰真資料庫:

```bash
node --test scripts/canary-runtime-probe.test.mjs
# 等同 pnpm canary:test
```

---

## 9b — `scripts/canary-ddl-rejection.mjs`(反向驗證)

### 怎麼跑

```bash
node scripts/canary-ddl-rejection.mjs
```

### 它做什麼

用同一個 `app_runtime` 身分,對靶場依序丟四類 DDL,每一類都【必須被資料庫的權限層拒絕】:

| 順序 | DDL | 送出的語句 |
| --- | --- | --- |
| 1 | CREATE | `CREATE TABLE canary_ddl_probe_should_not_exist (id INT PRIMARY KEY)` |
| 2 | ALTER | `ALTER TABLE canary_probe_target ADD COLUMN canary_added_col INT NULL` |
| 3 | TRUNCATE | `TRUNCATE TABLE canary_probe_target` |
| 4 | DROP | `DROP TABLE canary_probe_target` |

只有 privilege-denied 類錯誤碼才算合格拒絕:**1142 / 1044 / 1045 / 1227**。
其它錯(例如 1146 表不存在)代表靶場沒佈好,標 INCONCLUSIVE,要先修佈置再重跑,
不算過。腳本不接受自報「預期被拒」,每一筆都必須附資料庫真實回報的 errno 與 sqlState。

### 任一 DDL 竟然成功 = P0

代表 `app_runtime` 還留著 DDL 權限,權限隔離根本沒生效 —— 這正是 2026-06-17
tours 被清空的結構成因。腳本會:

1. 立刻印 P0 橫幅,**停測,不再試其餘 DDL**。
2. 只做一件事:把剛剛那個 DDL 造成的副作用收回來(這不算續試,是還原自己弄髒的東西)。

### 清理(每次都會交代)

不論通過與否,結尾一定印一段「靶場清理」:

- 沒有任何 DDL 成功 → 印「本次沒建出也沒改動任何東西,無需清理」。
- CREATE 竟然成功 → 自動 `DROP TABLE IF EXISTS canary_ddl_probe_should_not_exist`。
- ALTER 竟然成功 → 自動 `ALTER TABLE canary_probe_target DROP COLUMN canary_added_col`。
- TRUNCATE / DROP 竟然成功 → 還原不了,直接告訴你怎麼手動重佈。

清理完之後,腳本會**回頭查 `information_schema` 複核**:測試表在不在、靶表還在不在、
靶表有沒有多出欄位。腳本不自報清乾淨,一律用查詢證明。有殘留就逐項列出,
並附上可以直接複製貼進 TiDB SQL 編輯器(用 migrator 身分)執行的清除語句。

### 預期輸出(靶場佈置正確、權限隔離已生效時)

```
[canary-ddl] 連線中:<host>
[canary-ddl] 連線身分 CURRENT_USER()=<prefix>.app_runtime@%  schema=canary
[canary-ddl] CREATE  ✅ 合格拒絕  errno=1142 sqlState=42000 code=ER_TABLEACCESS_DENIED_ERROR
[canary-ddl] ALTER   ✅ 合格拒絕  errno=1142 sqlState=42000 code=ER_TABLEACCESS_DENIED_ERROR
[canary-ddl] TRUNCATE✅ 合格拒絕  errno=1142 sqlState=42000 code=ER_TABLEACCESS_DENIED_ERROR
[canary-ddl] DROP    ✅ 合格拒絕  errno=1142 sqlState=42000 code=ER_TABLEACCESS_DENIED_ERROR

[canary-ddl] ---- 靶場清理 ----
[canary-ddl] 本次沒有任何 DDL 成功,腳本沒建出也沒改動任何東西,無需清理。
[canary-ddl] 清理複核:靶場乾淨(沒有 canary_ddl_probe_should_not_exist、靶表 canary_probe_target 在、沒有多出 canary_added_col 欄)。

[canary-ddl] 通過:四類 DDL 全被權限層拒絕(各附 SQLSTATE),靶場零殘留。權限隔離已驗。
```

errno 實際值視 TiDB 回報而定,四個都落在 1142 / 1044 / 1045 / 1227 之內即可。

### 退出碼

| 碼 | 意思 |
| --- | --- |
| 0 | 四類 DDL 全被合格拒絕,且靶場零殘留 |
| 1 | 有 DDL 成功(P0)、有 INCONCLUSIVE、有殘留,或任何中止 |
| 2 | 沒設 `CANARY_APP_RUNTIME_DATABASE_URL`,無害跳過 |

### 單元測試

判定、清理與防呆邏輯有測,用假連線,完全不碰真資料庫:

```bash
node --test scripts/canary-ddl-rejection.test.mjs
# 等同 pnpm canary:test:ddl
```

---

## 出錯時要看什麼

腳本印出來的錯誤一律是這種一行摘要,不含連線字串也不含密碼:

```
[canary-ddl] 中止:連不上或憑證驗不過。code=ETIMEDOUT errno=-60 msg=connect ETIMEDOUT
```

把整個畫面截圖貼出來是安全的 —— 這正是設計目的。
若哪天在輸出裡看到 `mysql://` 開頭的字串,那就是漏洞,請立刻回報,不要貼出去。

常見中止訊息:

| 訊息 | 意思 | 怎麼辦 |
| --- | --- | --- |
| 中止(未連線):schema 必須剛好是 'canary' | 連線字串指到別的 schema | 換成 canary 的連線字串 |
| 中止(未連線):指向正式 schema 'test' | 貼成正式站的連線字串了 | 絕對不要對正式站跑,換掉 |
| 中止:連線字串解析不了 | 密碼有特殊符號,或 port 超過 65535 | 密碼改純英數 32 位,port 用 4000 |
| 中止:連線身分不含 'app_runtime' | 用錯帳號(例如 root 或 migrator) | 換成 app_runtime 的連線字串 |
| 中止:把憑證驗證關掉了 | 連線字串裡有 rejectUnauthorized=false | 拿掉,不准不驗憑證 |
| 未通過:有 DDL 非因權限被拒 | 靶場沒佈好(多半靶表不存在) | 用 migrator 重建靶表再跑 |
