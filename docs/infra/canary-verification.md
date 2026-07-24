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
   - 連線字串必須【字面】以 `mysql://` 開頭,兩條斜線一條都不能少。少一條時
     (`mysql:帳號:密碼@主機:4000/canary`)Node 的 URL 解析器【照樣解析得過】,
     只是會把整串帳號密碼當成路徑,所以這道檢查排在解析【之前】,直接擋掉。
   - 主機名只接受英數、點、減號,其它形狀一律中止。
   - **兩支都在【連線之前】**就先擋一次,不符就中止,密碼不會送出去;
     連上之後再用伺服器回報的 `DATABASE()` 複核一次。
     這道連線前防呆是同一個共用函式 `preflight()`(實作在 9a,9b `import` 過去),
     不是兩份各自抄的程式碼,所以不會有「只修到一邊」的情況。
     連線選項 `connOptionsFor()` 也是共用的,送給資料庫的 schema 名跟 `preflight()`
     核對過的是同一個值,不會出現兩邊解碼標準不一致的情況。
     9a 是【會寫資料】的那一支,這道防線對它更要緊。
2. **連線身分必須是 `app_runtime`**。`CURRENT_USER()` 不含 `app_runtime` 就中止。
3. **TLS 必須驗得過**。簽發鏈與主機名兩者都驗。
   真正的保護是:**兩支腳本把 TLS 選項寫死在程式裡**
   (`rejectUnauthorized: true` + `verifyIdentity: true` + `minVersion: TLSv1.2`),
   **完全不讀連線字串裡的 `ssl` 參數**。所以就算連線字串裡塞了什麼,也改不動 TLS 行為。
   另外 `preflight()` 看到字串裡出現 `rejectUnauthorized=false` 會中止,
   但那只是**提醒**,不是安全邊界:那道字串比對可以用百分比編碼之類的寫法繞過去,
   繞過去也沒有用,因為腳本根本不看那個參數。
4. **零回吐:輸出裡不會出現你貼進去的連線字串,一個片段都不會**。
   這是 2026-07-23 對抗審查之後改的做法,值得說清楚為什麼:

   舊版的做法是「印之前記得遮」。結果被實測打臉 —— 連線字串少一條斜線時,整串
   帳號密碼會掉進 URL 的路徑欄位,腳本以為那是「schema 名」,於是拒絕訊息裡的
   「目前是 …」就把整串憑證原封印出來,而且發生在連線之前。遮蔽函式也救不了,
   因為漏出來的形狀根本沒有 `://`。

   現在改成整類禁止,不再逐條補洞:

   - 所有拒絕與錯誤訊息都是【寫死的固定句子】加一個【穩定代碼】
     (例如 `代碼:SCHEMA_MISMATCH`)。句子後面不接任何來自你輸入的值,
     連「你剛剛貼的是什麼」都不告訴你 —— 那正是上次外洩的那一行。
   - 輸出裡唯一允許出現的動態值只有三類,而且都要先通過嚴格格式檢查:
     主機名(只准英數、點、減號)、資料庫回報的識別字與錯誤碼
     (只准英數與 `. _ @ % -`,冒號和斜線都不在裡面,所以任何連線字串形狀都過不了)、
     以及純數字。格式不合就印「(格式不合,不顯示)」,不印原值。
   - 錯誤一律只印白名單欄位的一行摘要(`code=… errno=… sqlState=… msg=…`),
     永遠不印原始 error 物件:Node 的 `ERR_INVALID_URL` 會把整條連線字串掛在
     error 的 `input` 屬性上,印物件等於把密碼印在畫面上。
   - 遮蔽函式 `redact()` 還在,但它是**第二道網**,不是主要防線。它負責的是
     「別人寫的錯誤訊息裡夾了憑證」這種我們管不到的情況,現在也吃得掉沒有 `://`
     的 `帳號:密碼@主機` 形狀與被折行的憑證。
   - 會繞過主流程的三條通道(`uncaughtException`、`unhandledRejection`、
     連線物件自己的 `error` 事件)兩支都各自接住,一律只印遮蔽摘要後結束。

   這些不是靠「掃原始碼有沒有那一行」在守。守它的是**行為測試**:測試會真的把
   十八種壞連線字串(每一條都夾著哨兵密碼)餵給真的腳本跑,然後斷言整個畫面
   一個哨兵字元都沒有。把任何一道防線註解掉或包進 `if (false)`,這些測試就轉紅。
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

### 設環境變數(兩支共用同一個)

連線字串裡有密碼,所以【不要】直接打 `export CANARY_APP_RUNTIME_DATABASE_URL='mysql://…'`。
那樣做有兩個問題:整條含密碼的指令會被寫進 shell 的歷史檔(`~/.zsh_history`),
而且環境變數同機任何行程都讀得到。下面兩種擇一。

**做法 A(推薦,最省事):打字時不回顯,用完就清掉**

```bash
# 1. 先輸入密碼,畫面不會顯示,也不會進 history
read -rs -p 'app_runtime 密碼: ' CANARY_PW; echo

# 2. 用密碼組出連線字串(這一行沒有密碼字面,進 history 也無所謂)
export CANARY_APP_RUNTIME_DATABASE_URL="mysql://<prefix>.app_runtime:${CANARY_PW}@<canary-host>:4000/canary"
unset CANARY_PW

# 3. 跑腳本
node scripts/canary-runtime-probe.mjs
node scripts/canary-ddl-rejection.mjs

# 4. 跑完立刻清掉
unset CANARY_APP_RUNTIME_DATABASE_URL
```

**做法 B:放進只有自己讀得到的檔案,用完刪掉**

```bash
# 1. 先把權限鎖好,再寫內容(順序不能反,不然中間那一瞬間別人讀得到)
umask 077
touch ~/.canary-env && chmod 600 ~/.canary-env

# 2. 用編輯器把這一行填進去(不要用 echo,echo 會進 history)
#    export CANARY_APP_RUNTIME_DATABASE_URL='mysql://<prefix>.app_runtime:<pw>@<canary-host>:4000/canary'
nano ~/.canary-env

# 3. 載入、跑、清掉
source ~/.canary-env
node scripts/canary-runtime-probe.mjs
node scripts/canary-ddl-rejection.mjs
unset CANARY_APP_RUNTIME_DATABASE_URL
rm -P ~/.canary-env
```

**萬一還是不小心把密碼打進了指令列**,當場清掉那一行(macOS 的 zsh):

```bash
# 1. 先把還沒落地的記憶體歷史寫進檔案,免得等一下又被寫回去
fc -W
# 2. 把含 app_runtime 的行整行刪掉(-i '' 是 macOS 的 sed 寫法)
sed -i '' '/app_runtime:/d' ~/.zsh_history
# 3. 重新載入歷史檔
fc -R
# 4. 確認真的沒了(印出 0 才算清乾淨)
grep -c 'app_runtime:' ~/.zsh_history
```

然後把那個密碼視為已外洩,回 `docs/infra/db-role-hardening.md` 換一次 app_runtime 密碼。

密碼請用純英數 32 位。含 `%` 會被腳本擋下來報 `BAD_ENCODING`,含斜線或空白會報
`BAD_URL`,腳本都會中止並提示重設 —— 但它【不會】把你打錯的那一串印回畫面上。

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
主機、開跑與結束的列數。

**「全項 PASS」有兩個條件,缺一不可**(這條比照 9b 的做法):
每一項都 PASS,**而且**項數剛好是 14 項。少跑幾項時「每一項都通過」照樣成立,
所以成績單會另外核對項數;項數不對就印「項數不對,只有 N 項,應該有 14 項」,
退出碼 1,不管有沒有紅字都不算過。

### 退出碼

| 碼 | 意思 |
| --- | --- |
| 0 | 全項通過 |
| 1 | 有任何一項沒過或不成立(fail-closed),或中止 |
| 2 | 沒設 `CANARY_APP_RUNTIME_DATABASE_URL`,無害跳過 |

### 測試

完全不碰真資料庫。兩種測試都在同一個檔案裡:

- **單元測試**:純函式層(preflight、白名單化、redact、成績單排版、判定三分法)。
- **行為測試**:真的 `spawn` 子行程跑這支腳本,餵十八種夾著哨兵密碼的壞連線字串,
  斷言 stdout 加 stderr 完全不含哨兵、退出碼正確、印出預期的穩定代碼。
  這種測試無法被「把防線用行尾註解掉」或「包進 `if (false)`」繞過。

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

「乾淨」有兩個條件,缺一不可:**(1)** `information_schema` 查不到殘留,
**(2)** 本次的副作用全都還原得回來。TRUNCATE 成功是典型的第二條不成立:
表還在、欄位沒多,`information_schema` 查起來很乾淨,但內容已經被清空而且回不來。
這種情況腳本會明講「結構查起來是完整的,但本次有還原不了的副作用,不算清乾淨」,
**不會**印「副作用已清乾淨」。

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

### 測試

判定、清理與防呆邏輯用假連線測,完全不碰真資料庫;外洩防線則是真的 `spawn`
子行程跑這支腳本,用同一套十八條壞連線字串驗「畫面上零哨兵」:

```bash
node --test scripts/canary-ddl-rejection.test.mjs
# 等同 pnpm canary:test:ddl
```

---

## 出錯時要看什麼

腳本印出來的錯誤一律是這種一行摘要,設計上不含你的連線字串也不含密碼:

```
[canary-ddl] 中止:連不上或憑證驗不過。code=ETIMEDOUT errno=-60 msg=connect ETIMEDOUT
```

**看到疑似密碼的東西怎麼辦(重要,請照做)**

腳本在設計上完全不回吐你的連線字串:拒絕訊息是寫死的句子加一個代碼,不會把你貼的
內容印回來。但「設計上不會」不等於「數學上證明不可能」,所以規則是這樣:

- 萬一你在畫面上看到任何**像是你密碼的東西**,或任何一段看起來像你連線字串的內容,
  **立刻停手,告訴 Claude 你看到了什麼種類的東西(不要把畫面貼出來、不要把那段字貼出來)**,
  並把那個密碼視為已外洩,回 `docs/infra/db-role-hardening.md` 換一次 app_runtime 密碼。
- 不要用「開頭有沒有 `mysql://`」來判斷有沒有漏。2026-07-23 那次外洩的形狀就【沒有】
  `mysql://` —— 少一條斜線的連線字串漏出來時長得像 `帳號:密碼@主機:4000/canary`。
  判準只有一個:**畫面上有沒有出現你自己知道的那串密碼**。
- 貼給 Claude 之前,自己先掃一遍畫面。這是最後一道把關,由你來做。

常見中止訊息:

中止訊息最後一行會附一個【代碼】(例如 `代碼:SCHEMA_MISMATCH`),照代碼查下表最快。
每個代碼對應的句子是固定的,不會因為你貼了什麼而變。

| 訊息 / 代碼 | 意思 | 怎麼辦 |
| --- | --- | --- |
| 代碼 `SCHEMA_MISMATCH`(schema 不是 canary) | 連線字串指到別的 schema,或大小寫不同 | 換成 canary 的連線字串 |
| 代碼 `PROD_SCHEMA`(指向正式 schema 'test') | 貼成正式站的連線字串了 | 絕對不要對正式站跑,換掉 |
| 代碼 `NO_SCHEMA`(沒有指定 schema) | 連線字串結尾的 `/canary` 漏掉了 | 補上 `/canary` |
| 代碼 `EMPTY_URL`(連線字串是空的) | env 設成了空白字串 | 重設一次 env |
| 代碼 `BAD_URL`(開頭不是 `mysql://`) | 少了一條斜線、少了 scheme、或 scheme 打錯 | 開頭一定要是 `mysql://`,整條重貼 |
| 代碼 `BAD_URL`(連線字串解析不了) | port 打錯(例如超過 65535)、密碼裡有斜線或空白、整條貼漏了 | port 用 4000,密碼改純英數 32 位,整條重貼 |
| 代碼 `BAD_HOST`(主機名格式不合) | 主機名有底線、空白之類不該有的字元 | 回手冊確認主機名 |
| 代碼 `BAD_ENCODING`(帳號/密碼/schema 裡有 %) | 含 `%` 這類編碼字元 | 密碼改純英數 32 位 |
| 代碼 `TLS_DISABLED`(把憑證驗證關掉了) | 連線字串裡有 rejectUnauthorized=false | 拿掉,不准不驗憑證 |
| `msg=URI malformed` | 密碼(或帳號)裡有 `%` 之類的編碼字元,Node 解不開 | 回去把密碼改成純英數 32 位。正常情況下 `preflight()` 會先攔下來報 `BAD_ENCODING`,看到這行原始訊息代表是別的地方解碼失敗,把整個畫面貼給 Claude |
| `code=CANARY_HANDSHAKE_TIMEOUT` | 對方接了 TCP、也吐了東西,但不是 MySQL 交握。通常是 port 打錯(例如打成 443 指到 HTTP 服務)。20 秒後由腳本自己中止 | port 改回 4000 |
| `code=ETIMEDOUT msg=connect ETIMEDOUT` | 主機或 port 根本沒回應(15 秒,mysql2 自己的逾時) | 確認主機名與 port,確認網路通 |
| 代碼 `ABORT_IDENTITY`(連線身分不含 'app_runtime') | 用錯帳號(例如 root 或 migrator) | 換成 app_runtime 的連線字串 |
| 代碼 `ABORT_PROD_SCHEMA` / `ABORT_SCHEMA_MISMATCH` | 連上之後伺服器回報的 schema 不是 canary | 換成 canary 的連線字串 |
| 代碼 `ABORT_NO_TLS` / `ABORT_TLS_UNVERIFIED` | 連線沒加密,或憑證驗不過 | 不要改成不驗憑證,把情況告訴 Claude |
| 代碼 `ABORT_TARGET_MISSING` / `ABORT_TARGET_TOO_BIG` | 靶表沒佈好,或指錯地方 | 回手冊步驟 8 重建靶表 |
| 未通過:有 DDL 非因權限被拒 | 靶場沒佈好(多半靶表不存在) | 用 migrator 重建靶表再跑 |

「代碼 `EMPTY_URL`」與「沒設 env」是兩件事:完全沒設 env 時腳本印 `SKIPPED` 並用
退出碼 2 無害跳過,不算失敗。
