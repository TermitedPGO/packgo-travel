# Canary 驗證雙腳本(9a / 9b)— 自動化參考檔

> 重要(2026-07-23 Jeff 裁定,2026-07-24 補齊內文):本文件描述的兩支腳本
> **已退出人工驗證流程**,不再要任何人手動貼含密碼的連線字串去跑它們。
>
> 經多輪對抗審查,自寫腳本在「人為貼錯連線字串」時反覆出現把明文密碼印到畫面的
> 問題(最後兩次:少一條斜線時整串憑證掉進 pathname 被印出來;純英數密碼誤落主機名
> 位置時被當 host 印出來並送 DNS)。Jeff 已裁定人工驗證一律改用系統內建的標準
> **mysql 客戶端**搭配一份 SQL 檢核清單,密碼由客戶端當場以隱藏方式詢問,從頭到尾
> 不經過任何自寫程式。
>
> **人工驗證請一律走桌面指南步驟 9:**
> `~/Desktop/PACKGO_AI交流/網站專案/DB加固_後台操作指南.md` 步驟 9(標準 mysql 客戶端)。
> 那份是人工驗證的唯一權威做法。
>
> **本文件的定位**:僅供【未來自動化】參考 —— 屆時連線字串由設定檔 / 密鑰庫供給給
> 自動化流程(環境變數 `CANARY_APP_RUNTIME_DATABASE_URL`),**不是人手輸入**。
> 本檔記錄這兩支腳本在自動化情境下驗什麼、退出碼、外洩防線與行為測試,方便日後接自動化
> 的人讀懂契約。**本檔沒有、也不該有任何「請你手動貼連線字串執行腳本」的步驟。**

---

## 這兩支腳本(自動化時)在驗什麼

DB 硬化批要把網站的長駐連線從 root 換成窄鑰匙帳號 `app_runtime`(只能增刪改查,
不能建表刪表)。換之前要在一個【隔離靶場】上證明兩件事:

- 9a 正向:該做到的事真的做得到 —— `scripts/canary-runtime-probe.mjs`
- 9b 反向:不該做到的事真的做不到 —— `scripts/canary-ddl-rejection.mjs`

兩支都過,才算「窄鑰匙換上去不會把網站弄壞,也真的擋得住誤刪」。
角色與 grant 的建立步驟見 `docs/infra/db-role-hardening.md`。

> **權威分工(2026-07-24 更正)**:人工驗證以【桌面指南步驟 9】為準(標準 mysql 客戶端,
> 三組檢核:正向 CRUD 五行、反向 DDL 四行、migrator 建表兩行)。本檔裡 9a 的「01 到 14
> 項」是【自動化腳本內部的檢查契約】,不是給人照著跑的清單,也不凌駕桌面指南 —— 兩者
> 各司其職,不再有「以本文件為準、桌面手冊要服從」那種宣稱(那與退場裁定自相矛盾,已刪)。

---

## 安全前提(自動化跑這兩支時共通,設計說明)

以下是這兩支腳本的安全設計,說明「就算未來接了自動化,連線字串貼錯也不會外洩密碼」
的機制。這些不是人工操作步驟。

1. **只准打隔離靶場 `canary`**。那個 schema 裡零客戶、零財務、零商品資料,
   只有一張探測靶表 `canary_probe_target`。兩支腳本都要求 schema 名【完全等於 `canary`】:
   - 近似名(`canary_backup`、`canary2`…)一律中止。
   - 正式 schema 名 `test` 另外硬擋。
   - 連線字串必須【字面】以 `mysql://` 開頭,兩條斜線一條都不能少。少一條時
     Node 的 URL 解析器【照樣解析得過】,只是會把整串帳號密碼當成路徑,所以這道檢查
     排在解析【之前】,直接擋掉。
   - **缺帳號或密碼一律中止**(錯位形狀):純英數密碼誤落主機名位置
     (`mysql://<密碼>:4000/canary`,忘了 `<帳號>:<密碼>@`)時,URL 解析器會把密碼
     當成主機名,舊版會拿它去連還印在畫面上。preflight 看到 username 或 password 為空
     就中止,連線前擋掉,**絕不印出那個被誤放的值**(代碼 `MISSING_CREDENTIALS`)。
   - 主機名只接受英數、點、減號,其它形狀一律中止。
   - **兩支都在【連線之前】**就先擋一次,不符就中止,密碼不會送出去;
     連上之後再用伺服器回報的 `DATABASE()` 複核一次。這道連線前防呆是同一個共用函式
     `preflight()`(實作在 9a,9b `import` 過去),不是兩份各自抄的程式碼,所以不會有
     「只修到一邊」的情況。連線選項 `connOptionsFor()` 也是共用的。
2. **連線身分必須是 `app_runtime`**。`CURRENT_USER()` 不含 `app_runtime` 就中止。
3. **TLS 必須驗得過**。簽發鏈與主機名兩者都驗。真正的保護是:**兩支腳本把 TLS 選項
   寫死在程式裡**(`rejectUnauthorized: true` + `verifyIdentity: true` +
   `minVersion: TLSv1.2`),**完全不讀連線字串裡的 `ssl` 參數**。
4. **零回吐:輸出裡不會出現連線字串,一個片段都不會**。
   - 所有拒絕與錯誤訊息都是【寫死的固定句子】加一個【穩定代碼】
     (例如 `代碼:SCHEMA_MISMATCH`),句子後面不接任何來自輸入的值。
   - 輸出裡唯一允許出現的動態值只有三類,而且都要先通過嚴格格式檢查:
     主機名(只准英數、點、減號)、資料庫回報的識別字與錯誤碼、以及純數字。
     格式不合就印「(格式不合,不顯示)」,不印原值。
   - 錯誤一律只印白名單欄位的一行摘要(`code=… errno=… sqlState=… msg=…`),
     永遠不印原始 error 物件。
   - 遮蔽函式 `redact()` 是**第二道網**,吃得掉沒有 `://` 的 `帳號:密碼@主機` 形狀與
     被折行的憑證。
   - 會繞過主流程的三條通道(`uncaughtException`、`unhandledRejection`、連線物件自己的
     `error` 事件)兩支都各自接住,一律只印遮蔽摘要後結束。
   - 這些不是靠「掃原始碼有沒有那一行」在守,守它的是**行為測試**(見文末)。
5. **兩支都不碰正式站的 advisory lock 名**。9a 用 `canary:probe:tip:lock`,
   刻意不是正式的 `audit:tip:lock`。

---

## 未來自動化如何供給連線字串

> 這一節取代了舊版的「設環境變數(做法 A / B)」與「萬一把密碼打進指令列」等
> 人工操作段落 —— 那些是在教人手動貼含密碼的連線字串,已依 2026-07-23 裁定整段刪除。

未來若要把這兩支接成自動化(例如排程或 CI 對 canary 靶場定期複驗):

- 連線字串由【設定檔或密鑰庫】供給給自動化流程,設進環境變數
  `CANARY_APP_RUNTIME_DATABASE_URL`,**由機器供給、非人手鍵入**。
- 密碼一律純英數 32 位(含 `%` 會被 preflight 擋成 `BAD_ENCODING`,含斜線或空白會被擋成
  `BAD_URL`,腳本都會中止且【不會】把那一串印回畫面)。
- 未設該環境變數時,兩支都印 `SKIPPED` 並用退出碼 2 無害跳過(零自動觸發:沒有設定就
  什麼都不做,不會連任何資料庫)。

在那之前,**canary 的人工驗證一律走桌面指南步驟 9**,不碰這兩支腳本。

---

## 9a — `scripts/canary-runtime-probe.mjs`(正向驗證,自動化契約)

### 自動化呼叫方式

環境變數 `CANARY_APP_RUNTIME_DATABASE_URL` 由設定檔供給後,自動化流程執行:

```bash
node scripts/canary-runtime-probe.mjs
```

### 它做什麼

用 `app_runtime` 身分,在靶場上把「網站平常真的會做的事」跑一遍,逐項給成績。
會寫資料,但只寫保留區間的 id(19 億起跳),每一筆都登記、結束時逐筆刪掉,
並跟開跑前的列數對帳。任何 UPDATE / DELETE 都帶 `WHERE id = ?`,不存在無 WHERE 版本,
也不用 TRUNCATE。

### 檢查項次(腳本內部契約,01 到 14)

| 項次 | 名稱 | 在驗什麼 |
| --- | --- | --- |
| 01 | 連線有沒有加密、憑證驗不驗得過 | TLS 通道真的存在,且憑證驗得過 |
| 02 | 連線身分與靶場對不對 | `CURRENT_USER()` 含 app_runtime、`DATABASE()` 完全等於 canary |
| 03 | 靶表在不在、乾不乾淨 | 靶表存在、列數合理,記下開跑前的基準列數 |
| 04 | 網站的健康檢查心跳 | `SELECT 1` |
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

「全項 PASS」有兩個條件:每一項都 PASS,**而且**項數剛好是 14 項;項數不對就退出碼 1。

### 退出碼

| 碼 | 意思 |
| --- | --- |
| 0 | 全項通過 |
| 1 | 有任何一項沒過或不成立(fail-closed),或中止 |
| 2 | 沒設 `CANARY_APP_RUNTIME_DATABASE_URL`,無害跳過 |

### 測試(完全不碰真資料庫)

```bash
node --test scripts/canary-runtime-probe.test.mjs
# 等同 pnpm canary:test
```

- **單元測試**:純函式層(preflight、白名單化、redact、成績單排版、判定三分法)。
- **行為測試**:真的 `spawn` 子行程跑這支腳本,餵二十二種夾著哨兵密碼的壞連線字串,
  斷言 stdout 加 stderr 完全不含哨兵、退出碼正確、印出預期的穩定代碼。這種測試無法被
  「把防線用行尾註解掉」或「包進 `if (false)`」繞過。

---

## 9b — `scripts/canary-ddl-rejection.mjs`(反向驗證,自動化契約)

### 自動化呼叫方式

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
其它錯(例如 1146 表不存在)代表靶場沒佈好,標 INCONCLUSIVE。

### 任一 DDL 竟然成功 = P0

代表 `app_runtime` 還留著 DDL 權限。腳本會立刻印 P0 橫幅、停測、只把剛剛那個 DDL 的副作用
收回來,並回頭查 `information_schema` 複核靶場是否乾淨(不自報,一律用查詢證明)。

### 退出碼

| 碼 | 意思 |
| --- | --- |
| 0 | 四類 DDL 全被合格拒絕,且靶場零殘留 |
| 1 | 有 DDL 成功(P0)、有 INCONCLUSIVE、有殘留,或任何中止 |
| 2 | 沒設 `CANARY_APP_RUNTIME_DATABASE_URL`,無害跳過 |

### 測試

```bash
node --test scripts/canary-ddl-rejection.test.mjs
# 等同 pnpm canary:test:ddl
```

判定、清理與防呆邏輯用假連線測;外洩防線則是真的 `spawn` 子行程跑這支腳本,用同一套
二十二條壞連線字串驗「畫面上零哨兵」。

---

## 穩定代碼對照表(自動化除錯用)

腳本的拒絕 / 中止訊息最後一行都附一個【代碼】。每個代碼對應的句子是固定的,不會因為
輸入內容而變(這正是零回吐)。

| 代碼 | 意思 |
| --- | --- |
| `EMPTY_URL` | 連線字串是空的(環境變數沒設到或設成空字串) |
| `BAD_URL` | 開頭不是 `mysql://`、少一條斜線、port 打錯、密碼含斜線/空白等,解析不了 |
| `MISSING_CREDENTIALS` | 連線字串缺帳號或密碼(錯位形狀,例如純英數密碼誤落主機名位置) |
| `BAD_HOST` | 主機名格式不合(只接受英數、點、減號) |
| `BAD_ENCODING` | 帳號 / 密碼 / schema 裡有 `%` 這類編碼字元 |
| `NO_SCHEMA` | 連線字串結尾的 `/canary` 漏掉了 |
| `PROD_SCHEMA` | 指向正式 schema `test` |
| `SCHEMA_MISMATCH` | schema 不是 `canary`(近似名、大小寫不同、留空都算) |
| `TLS_DISABLED` | 連線字串裡想把憑證驗證關掉(`rejectUnauthorized=false`) |
| `ABORT_IDENTITY` | 連上後伺服器回報的身分不含 `app_runtime` |
| `ABORT_PROD_SCHEMA` / `ABORT_SCHEMA_MISMATCH` | 連上後伺服器回報的 schema 不是 canary |
| `ABORT_NO_TLS` / `ABORT_TLS_UNVERIFIED` | 連線沒加密或憑證驗不過 |
| `ABORT_TARGET_MISSING` / `ABORT_TARGET_TOO_BIG` | 靶表沒佈好或指錯地方 |

「`EMPTY_URL`」與「沒設環境變數」是兩件事:完全沒設時腳本印 `SKIPPED` 並用退出碼 2
無害跳過,不算失敗。
