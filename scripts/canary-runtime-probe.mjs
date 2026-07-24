#!/usr/bin/env node
/**
 * canary-runtime-probe.mjs — DB 硬化批第九件(9a):正向驗證。
 *
 * 這支跟 canary-ddl-rejection.mjs(9b)是一對:
 *   9b 驗「不該做到的事,真的做不到」(四類 DDL 被權限層拒絕)。
 *   9a(本檔)驗「該做到的事,真的做得到」(app_runtime 的 CRUD、資訊查詢、
 *      稽核鏈那三句 advisory lock / session 指令,全部跑得動)。
 * 只有兩支都過,才算「窄鑰匙帳號換上去不會把網站弄壞」。
 *
 * 安全鐵律(讀懂再跑):
 *   1. 只准對隔離 canary schema 跑。這支【會寫資料】(INSERT/UPDATE/DELETE),
 *      所以 schema 名必須「完全等於 canary」,避免打到 canary_backup 之類的近似名,
 *      更避免打到正式 test schema。這道檢查發生在【連線之前】(preflight(),9a/9b
 *      共用同一份實作),貼錯字串時密碼連送都不會送出去;連上之後再用伺服器回報的
 *      DATABASE() 複核一次。
 *   2. TLS 必須真的加密且憑證驗得過(簽發鏈 + 主機名兩者)。驗不過就停,
 *      絕不退回 rejectUnauthorized:false。這條連線會送出 app_runtime 的密碼。
 *   3. 寫入只用保留區間的 id(1.9e9 起跳),且每一筆都登記進 createdIds,
 *      結束時逐筆清掉並與開跑前的列數對帳。任何 UPDATE/DELETE 都必須帶
 *      WHERE id = ?,本檔不得出現無 WHERE 的版本,也不得用 TRUNCATE。
 *   4. advisory lock 一律用 canary 專屬鎖名,絕不可用正式的 audit:tip:lock。
 *      GET_LOCK 的命名空間是整個叢集共用,靶場與正式站同叢集;探測只要搶走
 *      3 秒,同時間正式站的稽核寫入就會 timeout 走「無鏈孤列」路徑,等於為了
 *      驗證製造一筆事故。權限檢查跟鎖名無關,換名零損失。
 *   5. 【零回吐】所有輸出一律不得把使用者貼進來的連線字串內插進去 —— 一個片段都不行。
 *      拒絕與錯誤訊息只能是「固定字串 + 穩定代碼」。這條是 2026-07-23 對抗審查抓到的
 *      critical 的根治做法:當時 SCHEMA_MISMATCH 把算出來的 schema 名回吐,而少一條
 *      斜線的連線字串(mysql:user:pw@host:4000/canary)會讓整串憑證掉進 pathname,
 *      於是「schema 名」等於整串憑證,密碼就這樣印在畫面上。逐條補洞補不完,
 *      所以改成整類禁止:輸出裡的動態值只允許三種白名單化的來源(見 safeHost /
 *      safeIdent / safeNum),其餘一律固定字串。
 *
 * 人工驗證不走這支腳本(2026-07-23 Jeff 裁定)。canary 的人工驗證一律走桌面指南
 *   步驟 9(標準 mysql 客戶端):
 *   ~/Desktop/PACKGO_AI交流/網站專案/DB加固_後台操作指南.md 步驟 9。
 *   不要手動貼含密碼的連線字串來跑這支腳本 —— 這正是多輪對抗審查要根治的外洩來源。
 *
 * 本腳本僅保留供【未來自動化】使用:屆時 CANARY_APP_RUNTIME_DATABASE_URL 由設定檔 /
 *   密鑰庫供給給自動化流程(非人手輸入),自動化流程再執行 `node scripts/canary-runtime-probe.mjs`。
 *   設計與退出碼見 docs/infra/canary-verification.md。
 *
 * 退出碼:0 = 全項通過;1 = 有任何一項沒過或不成立(fail-closed);
 *          2 = 未設 env(canary 尚未佈置,無害跳過)。
 */
import mysql from "mysql2/promise";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 常量(全部寫死,永不從 env 插值)
// ---------------------------------------------------------------------------

/** 探測靶表。由 migrator 角色在手冊步驟 8 佈好。 */
export const TARGET = "canary_probe_target";

/**
 * 唯一允許的 schema 名。9a 與 9b 共用同一個常量,完全比對,不做「含有」比對。
 */
export const SCHEMA = "canary";

/**
 * 成績單應該有幾項(01 到 14)。比照 9b 的 `results.length === PROBES.length`:
 * 「每一項都 PASS」不等於「該跑的都跑了」—— 少跑幾項時 every() 照樣回 true。
 * 權威清單見 docs/infra/canary-verification.md。
 */
export const EXPECTED_ITEMS = 14;

/**
 * createConnection 的自家逾時。
 *
 * mysql2 3.16.1 的 connectTimeout 是在 socket 收到【第一個 data 事件】那一刻就被
 * clearTimeout 掉的(lib/base/connection.js:95-100),不是等 handshake 完成。
 * 所以對方只要吐出任何一個位元組再沉默(port 打成 443 指到 HTTP/TLS 服務就是
 * 這樣:它會先回一段 HTTP 或 TLS alert),connectTimeout 就永遠不會觸發,
 * 連線 promise 無限掛著。實測過:沒有這層 race 會卡到被外部砍掉為止。
 * (完全不回位元組的沉默 port 反而是 connectTimeout 管得到的,15 秒會 ETIMEDOUT。)
 */
export const HANDSHAKE_TIMEOUT_MS = 20_000;

/**
 * canary 專屬 advisory lock 名。刻意【不是】正式的 audit:tip:lock(安全鐵律 4)。
 * 正式鎖名逐字出現在 server/_core/auditLog.ts,本檔絕不碰它。
 */
export const LOCK_NAME = "canary:probe:tip:lock";

/** 只有這些 errno 算「因權限被拒」。KILL 那項用來分辨「權限不足」與「其它錯」。 */
const PRIVILEGE_DENIED_ERRNOS = new Set([
  1095, // ER_KILL_DENIED_ERROR      不准 KILL 別人(或這裡:不准 KILL)
  1227, // ER_SPECIFIC_ACCESS_DENIED 需要特定權限(如 SUPER/CONNECTION_ADMIN)
  1142, // ER_TABLEACCESS_DENIED     表層級命令權限不足
  1044, // ER_DBACCESS_DENIED        對該 database 無權
]);

/** 連線被自己切斷時會看到的 code(KILL CONNECTION_ID() 的預期結果)。 */
const DISCONNECT_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "ECONNRESET",
  "EPIPE",
  "PROTOCOL_SEQUENCE_TIMEOUT",
]);

// ---------------------------------------------------------------------------
// 純函式(可單測,不連任何 DB)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 白名單化(零回吐政策的唯一例外:只有通過嚴格格式檢查的值才准出現在輸出裡)
// ---------------------------------------------------------------------------

/** 通不過白名單時印這個。固定字串,不含任何輸入。 */
export const UNSAFE_PLACEHOLDER = "(格式不合,不顯示)";

/** 主機名長度上限(DNS 全名上限)。 */
export const HOSTNAME_MAX = 253;

/**
 * 主機名嚴格格式檢查:只准 [A-Za-z0-9.-],長度 1..253。
 * 底線、冒號、斜線、空白、中括號(IPv6 的 [::1])一律不過 —— 通不過就不印。
 */
export const isSafeHostname = (h) =>
  typeof h === "string" &&
  h.length >= 1 &&
  h.length <= HOSTNAME_MAX &&
  /^[A-Za-z0-9.-]+$/.test(h);

/** 識別字長度上限(MySQL 識別字 64 + 帳號@主機 的餘裕)。 */
export const IDENT_MAX = 128;

/**
 * 伺服器回報識別字(CURRENT_USER() / DATABASE())的嚴格格式檢查。
 *
 * 誠實的界線:這只擋【形狀】。冒號與斜線都不在白名單裡,所以任何連線字串形狀
 * (scheme://user:pw@host/db、或少斜線那種 user:pw@host:port/db)一個字元都過不了。
 * 而且這兩個值只有在【資料庫接受連線之後】才存在,那時它們是伺服器自己回報的帳號名
 * 與 schema 名,不是 Jeff 貼的那串字。
 */
export const isSafeIdent = (s) =>
  typeof s === "string" &&
  s.length >= 1 &&
  s.length <= IDENT_MAX &&
  /^[A-Za-z0-9._@%-]+$/.test(s);

/** 自由文字(憑證簽發者這類)的長度上限。 */
export const TEXT_MAX = 64;

/**
 * 自由文字的嚴格格式檢查:英數、空白、以及 . _ , ' ( ) - 。
 * 冒號、斜線、@ 一律不在裡面 —— 任何連線字串形狀都過不了。
 */
export const isSafeText = (s) =>
  typeof s === "string" &&
  s.length >= 1 &&
  s.length <= TEXT_MAX &&
  /^[A-Za-z0-9 ._,'()-]+$/.test(s);

/** 主機名:過白名單才印,否則印固定的佔位字串。 */
export const safeHost = (h) => (isSafeHostname(h) ? h : UNSAFE_PLACEHOLDER);

/** 自由文字:過白名單才印,否則印固定的佔位字串。 */
export const safeText = (s) => (isSafeText(s) ? s : UNSAFE_PLACEHOLDER);

/** 伺服器回報識別字:過白名單才印,否則印固定的佔位字串。 */
export const safeIdent = (s) => (isSafeIdent(s) ? s : UNSAFE_PLACEHOLDER);

/**
 * 數字:只有有限數才印,否則印 "?"。字串永遠不會從這裡漏出去。
 * null / undefined / 空字串一律 "?" —— 不准走 Number(null) === 0 那條路把
 * 「沒有值」印成「0」,那是誤導,不是遮蔽。
 */
export const safeNum = (n) => {
  if (n === null || n === undefined || n === "") return "?";
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? String(v) : "?";
};

/**
 * 遮掉字串裡的憑證。【這是第二道網,不是主要防線。】
 *
 * 主要防線是「零回吐」:所有輸出都不內插使用者輸入(見檔頭安全鐵律 5),
 * 以及 errSummary() 只取白名單欄位。redact() 存在的理由只有一個 —— 錯誤訊息
 * 是別人(Node / mysql2 / 作業系統)寫的,我們管不到它們往裡面塞什麼。
 *
 * 誠實的宣稱範圍(不是「任何字串都保證遮得掉」):
 *   1. 整個字串【就是】一條合法 URL 時 —— 交給 Node 的 URL 解析器,帳號密碼換成 ***。
 *   2. `scheme://user:pw@host` 夾在訊息中間 —— 同一行貪婪吃到最後一個 @;
 *      憑證跨行時再吃一次,那次只吃到第一個 @。
 *   3. 【沒有 :// 的 userinfo 形狀】(user:pw@host)—— 這是 2026-07-23 critical 的形狀:
 *      連線字串少一條斜線時漏出來的東西根本沒有 ://,舊版正規式完全吃不到。同一行
 *      與跨行各吃一次。
 * 已知吃不到的情況(照實說):密碼被拆進兩個變數再分別拼進訊息、密碼被百分比編碼
 * 或轉義成別的形狀、憑證被別人截斷成沒有 @ 的片段。這些只能靠零回吐擋在前面。
 */
// 有 scheme:同一行貪婪吃到最後一個 @。
const RE_URL_SAMELINE = /([a-z][a-z0-9+.-]*:\/\/)[^\r\n]*@/gi;
// 有 scheme:憑證被折行時吃到第一個 @。
const RE_URL_MULTILINE = /([a-z][a-z0-9+.-]*:\/\/)[^@]{1,512}@/gi;
// 沒有 :// 的 userinfo 形狀。前面那組是邊界字元(不吃 scheme 的 `:` 與 `/`,
// 這樣已經遮成 `mysql://***:***@` 的字串不會被再啃掉 scheme)。
const RE_BARE_SAMELINE =
  /(^|[^A-Za-z0-9._~%+\-:/])([A-Za-z0-9._~%+-]{1,64}):([^\s@/]{1,256})@/g;
// 同上,但憑證中間夾了換行(密碼被終端機或編輯器折行的情況)。
const RE_BARE_MULTILINE =
  /(^|[^A-Za-z0-9._~%+\-:/])([A-Za-z0-9._~%+-]{1,64}):([^@]{0,256}[\r\n][^@]{0,256})@/g;

export const redact = (s) => {
  const str = String(s ?? "");
  const trimmed = str.trim();
  if (trimmed) {
    try {
      const u = new URL(trimmed);
      if (u.username || u.password) {
        u.username = "***";
        u.password = "***";
        return u.toString();
      }
    } catch {
      /* 不是單獨一條 URL,往下走正規式 */
    }
  }
  return (
    str
      // 有 scheme,同一行:貪婪吃到最後一個 @(密碼含 @ 的情況)
      .replace(RE_URL_SAMELINE, "$1***:***@")
      // 有 scheme,憑證跨行:吃到第一個 @,長度設上限免得吃掉整篇
      .replace(RE_URL_MULTILINE, "$1***:***@")
      // 沒有 :// 的 userinfo 形狀,同一行($1 是前置邊界字元,原樣留著)
      .replace(RE_BARE_SAMELINE, "$1***:***@")
      // 沒有 :// 的 userinfo 形狀,而且憑證跨了行
      .replace(RE_BARE_MULTILINE, "$1***:***@")
  );
};

/**
 * 日誌安全的錯誤摘要。絕不印原始 error 物件:Node 與 mysql2 會把完整連線字串
 * 掛在 own enumerable 屬性上(例如 ERR_INVALID_URL 帶 `input`)。
 */
export const errSummary = (e) => {
  if (!e || typeof e !== "object") return "(non-Error thrown)";
  const parts = [];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.errno != null) parts.push(`errno=${e.errno}`);
  if (e.sqlState) parts.push(`sqlState=${e.sqlState}`);
  const msg = redact(String(e.message ?? "").split("\n")[0]).slice(0, 200);
  if (msg) parts.push(`msg=${msg}`);
  return parts.length ? parts.join(" ") : "(no code/message)";
};

// ---------------------------------------------------------------------------
// 連線前防呆(9a / 9b 共用同一份實作 —— 抄兩份就會有一天只修到一邊)
// ---------------------------------------------------------------------------

/**
 * 連線前防呆的拒絕代碼。測試斷言代碼,不斷言中文句子,句子改寫不會弄壞測試。
 */
export const PREFLIGHT = {
  OK: "OK",
  EMPTY_URL: "EMPTY_URL",
  TLS_DISABLED: "TLS_DISABLED",
  BAD_URL: "BAD_URL",
  MISSING_CREDENTIALS: "MISSING_CREDENTIALS",
  BAD_HOST: "BAD_HOST",
  BAD_ENCODING: "BAD_ENCODING",
  NO_SCHEMA: "NO_SCHEMA",
  PROD_SCHEMA: "PROD_SCHEMA",
  SCHEMA_MISMATCH: "SCHEMA_MISMATCH",
};

/** BAD_ENCODING 是哪一段出問題。固定枚舉,不是使用者輸入。 */
export const PREFLIGHT_FIELD = Object.freeze({
  USER: "USER",
  PASSWORD: "PASSWORD",
  SCHEMA: "SCHEMA",
});

/** 連線字串必須【字面】以這個開頭(兩條斜線一條都不能少)。 */
export const REQUIRED_SCHEME = "mysql://";

/**
 * 所有拒絕訊息的固定字串表。
 *
 * 零回吐政策的核心:這裡每一句都是寫死的常量,只內插我們自己的常量(SCHEMA、
 * REQUIRED_SCHEME),【永遠不內插使用者貼進來的任何片段】。preflight() 只回代碼
 * 加這張表裡的句子,呼叫端也只印這兩樣東西。
 */
export const PREFLIGHT_REASON = Object.freeze({
  EMPTY_URL: "連線字串是空的(env 沒設到,或設成了空字串)。回手冊重設一次 env。",
  TLS_DISABLED:
    "連線字串裡想把憑證驗證關掉(rejectUnauthorized=false)。這條連線會送出密碼,不准不驗。" +
    "把那一段拿掉再跑。",
  BAD_SCHEME:
    `連線字串必須以 ${REQUIRED_SCHEME} 開頭,兩條斜線一條都不能少。` +
    "少一條斜線時 Node 仍然解析得過,但整串帳號密碼會被當成路徑,所以這裡直接擋掉。" +
    "照手冊第四段的格式整條重貼一次。",
  BAD_URL:
    "連線字串解析不了。常見原因:port 打錯(例如超過 65535)、密碼裡有斜線或空白、" +
    "整條字串貼漏了一段。port 用 4000,密碼改純英數 32 位,照手冊第四段整條重貼一次。",
  MISSING_CREDENTIALS:
    "連線字串缺了帳號或密碼(錯位形狀)。app_runtime 的連線字串一定同時有帳號與密碼," +
    "長得像 mysql://<帳號>:<密碼>@<主機>:4000/canary。缺 @ 前那一段時,一串純英數的" +
    "密碼會被 URL 解析器誤當成主機名,舊版會照樣拿去連、還把它印在畫面上。這裡在連線前" +
    "直接擋掉,絕不印出那個被誤放的值。照手冊第四段的格式整條重貼一次。",
  BAD_HOST:
    "連線字串裡的主機名格式不合(只接受英數、點、減號)。回手冊第四段確認主機名," +
    "再重設一次 env。",
  BAD_ENCODING_USER:
    "帳號裡有 % 這個編碼字元(Node 會回 URI malformed)。回手冊把帳號照抄一次,不要有 %," +
    "再重設一次 env。",
  BAD_ENCODING_PASSWORD:
    "密碼裡有 % 這個編碼字元(Node 會回 URI malformed)。" +
    "回手冊把密碼改成純英數 32 位,不要有 % 也不要有其它符號,再重設一次 env。",
  BAD_ENCODING_SCHEMA:
    "schema 名裡有 % 這個編碼字元(Node 會回 URI malformed)。" +
    `結尾必須剛好是 /${SCHEMA}。`,
  NO_SCHEMA:
    "連線字串沒有指定 schema(結尾的 /canary 那一段漏了)。" + `結尾必須是 /${SCHEMA}。`,
  PROD_SCHEMA:
    "連線字串指向正式 schema 'test'。這兩支只准打隔離靶場 canary," +
    "絕不准對正式站跑。請改用 canary 的連線字串。",
  SCHEMA_MISMATCH:
    `連線字串的 schema 不是 ${SCHEMA}。必須剛好是 '${SCHEMA}',` +
    "不接受近似名(canary_backup 之類),也不接受大小寫不同,更不接受留空。" +
    "(這裡刻意不告訴你「目前是什麼」:那個值可能就是你整串連線字串,印出來等於印密碼。)",
});

const deny = (code, reason, extra) => ({ ok: false, code, reason, ...extra });

/**
 * 【連線之前】就把貼錯的連線字串擋掉。兩支腳本都必須在印出「連線中」之前呼叫,
 * 這樣貼錯字串時密碼連送都不會送出去 —— 尤其 9a 是會寫資料的那一支。
 *
 * 純函式:不連線、不讀 env、不印任何東西,回傳判定讓呼叫端自己印。
 *
 * 回傳的 reason 一定是 PREFLIGHT_REASON 裡的固定字串,【絕不含使用者輸入的任何片段】。
 *
 * @param {unknown} rawUrl 連線字串(通常是 CANARY_APP_RUNTIME_DATABASE_URL)
 * @returns {{ok:true, code:"OK", u:URL, host:string, schema:string}
 *          |{ok:false, code:string, reason:string, field?:string}}
 */
export function preflight(rawUrl) {
  const raw = typeof rawUrl === "string" ? rawUrl : "";
  const trimmed = raw.trim();
  if (!trimmed) {
    return deny(PREFLIGHT.EMPTY_URL, PREFLIGHT_REASON.EMPTY_URL);
  }

  // 有人想從連線字串把憑證驗證關掉:擋下來並提醒。真正的保護不是這道字串檢查,
  // 是下面 connOptionsFor() 把 TLS 選項寫死、完全不讀連線字串裡的 ssl 參數。
  if (/rejectUnauthorized"?\s*[:=]\s*(?:false|0)/i.test(raw)) {
    return deny(PREFLIGHT.TLS_DISABLED, PREFLIGHT_REASON.TLS_DISABLED);
  }

  // ---- scheme 前置檢查:必須【在 new URL() 之前】 --------------------------
  // 2026-07-23 critical 的成因:mysql 不是 URL 規範認定的 special scheme,所以
  // `mysql:user:pw@host:4000/canary`(少一條斜線)new URL() 照樣解析成功,只是
  // username/password 是空的、整串憑證掉進 pathname。任何在 new URL() 之後才做的
  // 檢查都已經拿到一個「看起來合法、內容卻完全錯位」的物件。所以這道檢查必須前置,
  // 而且是對【原始字串】做字面比對,不是問解析器。
  if (!trimmed.toLowerCase().startsWith(REQUIRED_SCHEME)) {
    return deny(PREFLIGHT.BAD_URL, PREFLIGHT_REASON.BAD_SCHEME);
  }

  let u;
  try {
    u = new URL(trimmed);
  } catch {
    // catch 刻意【不接參數】:ERR_INVALID_URL 會把完整連線字串(含密碼)掛在
    // error 的 `input` own enumerable 屬性上。
    return deny(PREFLIGHT.BAD_URL, PREFLIGHT_REASON.BAD_URL);
  }
  // 解析完再確認一次解析器也同意 scheme(字面比對 + 解析器兩邊都要過)。
  if (u.protocol !== "mysql:") {
    return deny(PREFLIGHT.BAD_URL, PREFLIGHT_REASON.BAD_SCHEME);
  }

  // 主機名白名單化。這是輸出裡唯一允許出現的「來自連線字串的值」,所以在這裡就
  // 把不合格的擋掉:過不了白名單的主機名連印都不該印,更不該拿去連線。
  // (空主機名 —— 例如 mysql:///canary —— 長度為 0,過不了白名單,這裡就擋成 BAD_HOST。)
  if (!isSafeHostname(u.hostname)) {
    return deny(PREFLIGHT.BAD_HOST, PREFLIGHT_REASON.BAD_HOST);
  }

  // 錯位形狀:連線字串缺了 username 或 password。
  // 2026-07-24 對抗審查實測:把純英數 secret 誤貼到主機名位置(例如整條只寫成
  // `mysql://ZQX9SENTINEL:4000/canary`,忘了 `<帳號>:<密碼>@`)時,URL 解析器會把
  // ZQX9SENTINEL 當成【主機名】、username/password 都是空字串;secret 是純英數,又剛好
  // 過得了上面那道主機名白名單、schema 也剛好等於 canary,於是舊版 preflight 一路放行,
  // 呼叫端接著印「連線中:ZQX9SENTINEL」並拿它去 DNS 解析 —— 等於把誤放的 secret 印出來
  // 又送上網。app_runtime 的正常連線字串一定同時帶帳號與密碼,所以缺任一段一律當錯位
  // 擋掉,在連線之前中止;deny 的 reason 是固定字串,【絕不】內插那個被誤放的值。
  // 擺在主機名白名單【之後】:純英數 secret 那種會過白名單的錯位,精準判成缺帳密;而
  // 空主機名(mysql:///canary)這種本來就該是 BAD_HOST 的,維持原判、不被這道改寫。
  if (u.username === "" || u.password === "") {
    return deny(
      PREFLIGHT.MISSING_CREDENTIALS,
      PREFLIGHT_REASON.MISSING_CREDENTIALS,
    );
  }

  // 密碼裡有裸的 % (例如 pa%ss):new URL 收得下,但 connOptionsFor 的
  // decodeURIComponent 會丟 URIError「URI malformed」。在這裡先試一次,
  // 給出看得懂的診斷,而不是讓 Jeff 對著 msg=URI malformed 猜。
  // field 是固定枚舉(我們自己定義的代碼),訊息也是固定字串表查出來的。
  for (const [field, value] of [
    [PREFLIGHT_FIELD.USER, u.username],
    [PREFLIGHT_FIELD.PASSWORD, u.password],
    [PREFLIGHT_FIELD.SCHEMA, u.pathname],
  ]) {
    try {
      decodeURIComponent(value);
    } catch {
      return deny(
        PREFLIGHT.BAD_ENCODING,
        PREFLIGHT_REASON[`BAD_ENCODING_${field}`],
        { field },
      );
    }
  }

  const dbFromUrl = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!dbFromUrl) {
    return deny(PREFLIGHT.NO_SCHEMA, PREFLIGHT_REASON.NO_SCHEMA);
  }
  if (/^test$/i.test(dbFromUrl)) {
    return deny(PREFLIGHT.PROD_SCHEMA, PREFLIGHT_REASON.PROD_SCHEMA);
  }
  if (dbFromUrl !== SCHEMA) {
    return deny(PREFLIGHT.SCHEMA_MISMATCH, PREFLIGHT_REASON.SCHEMA_MISMATCH);
  }
  return { ok: true, code: PREFLIGHT.OK, u, host: u.hostname, schema: dbFromUrl };
}

// ---------------------------------------------------------------------------
// 連線選項(9a / 9b 共用同一份 —— schema 的解碼標準只有一個來源)
// ---------------------------------------------------------------------------

/**
 * TLS 硬設定。rejectUnauthorized 與 verifyIdentity 兩個都要:
 * mysql2 3.16.1 的 lib/base/connection.js 會把 checkServerIdentity 換成永遠回
 * undefined 的空函式,除非傳 verifyIdentity,也就是只寫 rejectUnauthorized
 * 只驗簽發鏈、不核對主機名。
 */
export const TLS = {
  rejectUnauthorized: true,
  verifyIdentity: true,
  minVersion: "TLSv1.2",
};

/**
 * 從 preflight 的通過結果組出連線選項。兩支共用,不各抄一份。
 *
 * database 直接用 pre.schema:那是 preflight 用 decodeURIComponent 解過、而且已經
 * 確認【完全等於 SCHEMA】的值,所以 preflight 與連線選項對 schema 的解碼標準是
 * 同一個(舊版 preflight 有解碼、connOptions 沒解碼,兩邊標準不一致)。
 */
export function connOptionsFor(pre) {
  const u = pre.u;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 4000,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: pre.schema,
    ssl: TLS,
    multipleStatements: false,
    connectTimeout: 15000,
  };
}

// ---------------------------------------------------------------------------
// 連線逾時與 process 級外洩防線(9a / 9b 共用)
// ---------------------------------------------------------------------------

/**
 * 自己做的逾時。mysql2 的 connectTimeout 在 socket 收到第一個位元組那刻就被清掉,
 * 對方吐一個位元組再沉默(port 打成 443 指到 HTTP 服務就是這樣)會無限卡死。
 *
 * 逾時之後才回來的連線會被 destroy 掉,不然行程會抓著一條活連線不肯結束;
 * 逾時之後才回來的錯誤會被吞掉,不然它會變成沒人接的 rejection。
 */
export async function raceWithTimeout(factory, ms, label) {
  const pending = Promise.resolve().then(factory);
  let timer = null;
  let timedOut = false;
  try {
    return await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          const e = new Error(label);
          e.code = "CANARY_HANDSHAKE_TIMEOUT";
          reject(e);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (timedOut) {
      pending.then(
        (c) => {
          try {
            c?.destroy?.();
          } catch {
            /* noop */
          }
        },
        () => {
          /* 逾時之後才回來的錯誤已經沒人要了,吞掉,不讓它變成 unhandledRejection */
        },
      );
    }
  }
}

/**
 * process 級的最後防線。
 *
 * main().catch() 只攔得到主 promise 鏈。uncaughtException(例如 timer callback
 * 裡丟出來的錯)與 unhandledRejection(沒人接的 promise)這兩條會繞過它,
 * 一繞過去,Node 預設處理器就會 util.inspect 整個 error 物件,把掛在上面的
 * own enumerable 屬性(ERR_INVALID_URL 的 `input`、mysql2 的連線資訊)整串印出來,
 * 密碼就在裡面。這裡把兩條都接住,只印遮蔽摘要然後 exit 1。
 *
 * @param {string} tag 印在行首的腳本標籤,例如 "[canary-probe]"
 */
export function installProcessGuards(tag, opts = {}) {
  const {
    proc = process,
    log = console.error,
    exit = (code) => process.exit(code),
  } = opts;
  const bar = "=".repeat(72);
  const report = (kind, e) => {
    log(bar);
    log(`${tag} ${kind}:${errSummary(e)}`);
    log(`${tag} 這一行只印錯誤碼與遮蔽後的訊息,設計上不含你的連線字串。`);
    log(`${tag} 萬一你看到任何像是你密碼的東西,立刻停手告訴 Claude,不要貼出去。`);
    log(bar);
    exit(1);
  };
  proc.on("uncaughtException", (e) => report("未捕捉的例外(已遮蔽)", e));
  proc.on("unhandledRejection", (e) => report("沒人接的 rejection(已遮蔽)", e));
  return report;
}

/**
 * 連線物件的 error 事件是第三條繞過通道:EventEmitter 沒掛 'error' 監聽時,
 * emit('error', err) 會把那個 err 直接丟出去,含密碼的屬性照樣被印。
 *
 * @param {object} conn mysql2 連線(PromiseConnection 會把 error 事件轉發上來)
 * @param {string} tag  印在行首的腳本標籤
 * @param {{tolerateDisconnect?:boolean}} opts
 *   tolerateDisconnect:9a 的第 12 / 14 項會故意把自己的連線切斷,那是預期結果,
 *   不能因此中止流程(不然成績單印不出來)。9b 不切自己的連線,一律當錯誤。
 */
export function attachConnErrorGuard(conn, tag, opts = {}) {
  const {
    log = console.error,
    exit = (code) => process.exit(code),
    tolerateDisconnect = false,
  } = opts;
  if (!conn || typeof conn.on !== "function") return false;
  conn.on("error", (e) => {
    const code = e && e.code ? String(e.code) : "";
    if (tolerateDisconnect && DISCONNECT_CODES.has(code)) {
      log(`${tag} 連線被切斷(這一支預期得到,不是錯誤):${errSummary(e)}`);
      return;
    }
    const bar = "=".repeat(72);
    log(bar);
    log(`${tag} 連線層錯誤(已遮蔽):${errSummary(e)}`);
    log(`${tag} 這一行只印錯誤碼與遮蔽後的訊息,設計上不含你的連線字串。`);
    log(`${tag} 萬一你看到任何像是你密碼的東西,立刻停手告訴 Claude,不要貼出去。`);
    log(bar);
    exit(1);
  });
  return true;
}

/**
 * GET_LOCK 的回傳三分法。
 *   1    = 搶到鎖,通過
 *   0    = 3 秒內沒搶到(八成有殘留鎖),不成立
 *   NULL = 出錯,沒過
 */
export function classifyLockResult(v) {
  if (v === null || v === undefined) return "FAIL";
  const n = Number(v);
  if (Number.isNaN(n)) return "FAIL";
  if (n === 1) return "PASS";
  if (n === 0) return "INCONCLUSIVE";
  return "FAIL";
}

/**
 * KILL CONNECTION_ID() 的三分法。
 *   沒丟錯            = 通過
 *   斷線類 code       = 通過(連線如預期被自己切斷,這是正常的)
 *   權限類 errno      = 沒過(窄鑰匙帳號沒有終結自己連線的能力)
 *   其它              = 不成立(TiDB 回了我們沒預期的錯碼,不准自作主張判成通過)
 */
export function classifyKillOutcome(err) {
  if (!err) {
    return { status: "PASS", note: "指令被接受,連線沒有立刻斷開。" };
  }
  const code = err.code ?? null;
  const errno = typeof err.errno === "number" ? err.errno : null;
  if (code && DISCONNECT_CODES.has(code)) {
    return {
      status: "PASS",
      note: "連線如預期被自己切斷,這是正常的,不是錯誤。",
    };
  }
  if (errno == null && err.fatal === true) {
    return {
      status: "PASS",
      note: "連線如預期被自己切斷,這是正常的,不是錯誤。",
    };
  }
  if (errno != null && PRIVILEGE_DENIED_ERRNOS.has(errno)) {
    return {
      status: "FAIL",
      note: "窄鑰匙帳號沒有終結自己連線的能力,稽核鏈的污染連線逃生口是死的。",
    };
  }
  return {
    status: "INCONCLUSIVE",
    note: "資料庫回了預期外的錯碼,無法判定。把整個畫面貼給 Claude。",
  };
}

/** 終端顯示寬度(中日韓全形字算 2 欄),用來把點線對齊。 */
export function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    const wide =
      c >= 0x1100 &&
      (c <= 0x115f ||
        c === 0x2329 ||
        c === 0x232a ||
        (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe6f) ||
        (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6));
    w += wide ? 2 : 1;
  }
  return w;
}

const MARK = {
  PASS: "[通過]",
  FAIL: "[沒過]",
  INCONCLUSIVE: "[不成立]",
};

/** 把一項結果排成「[通過] 04. 標題 ......」的一行。 */
export function renderRow(r, width = 52) {
  const head = `${MARK[r.status] ?? "[?]"} ${r.no}. ${r.label} `;
  const pad = Math.max(1, width - dispWidth(head));
  return head + ".".repeat(pad);
}

/**
 * 白話成績單。給不讀 code 的人看,所以:三種 ASCII 標記、無 emoji、無破折號,
 * 項次編號跟手冊的回報清單對得起來(Jeff 可以直接截圖回報)。
 *
 * 成績單也吃零回吐政策:抬頭那三個值(靶場 / 身分 / 主機)一律再過一次白名單,
 * 呼叫端已經過濾過也不例外 —— 這個函式是 export 的,不能假設呼叫端做對了。
 */
export function renderReport(results, meta = {}) {
  const bar = "=".repeat(72);
  const out = [];
  out.push(bar);
  out.push("正向驗證:該成功的操作,是不是真的成功");
  out.push(
    `靶場 ${meta.schema == null ? "?" : safeIdent(String(meta.schema))}(零客戶資料)` +
      ` / 身分 ${meta.user == null ? "?" : safeIdent(String(meta.user))}` +
      ` / 主機 ${meta.host == null ? "?" : safeHost(String(meta.host))}`,
  );
  out.push(bar);
  // 一律照項次排序再印。交易那項(10)是在 11、12 跑完 COMMIT 後才登記結果的,
  // 不排序的話畫面會出現 09、11、12、10,Jeff 會以為程式壞了。
  const ordered = [...results].sort((a, b) => String(a.no).localeCompare(String(b.no)));
  for (const r of ordered) {
    out.push(renderRow(r));
    if (r.evidence) out.push(`        ${r.evidence}`);
    if (r.note) out.push(`        說明:${r.note}`);
  }
  out.push(bar);

  const bad = ordered.filter((r) => r.status !== "PASS");
  const ledger =
    meta.baseline != null && meta.after != null
      ? `靶場:開始 ${safeNum(meta.baseline)} 列,結束 ${safeNum(meta.after)} 列,` +
        `本次殘留 ${safeNum(meta.after - meta.baseline)} 列。`
      : "靶場:列數未取得(前置檢查就中止了)。";

  // 比照 9b 的 results.length === PROBES.length:「每一項都 PASS」不等於「該跑的
  // 都跑了」。少跑幾項時 every() 照樣回 true,成績單不准因此印「全部通過」。
  const countOk = results.length === EXPECTED_ITEMS;

  if (bad.length === 0 && countOk) {
    out.push(
      `結論:全部 ${safeNum(results.length)} 項通過(應有 ${safeNum(EXPECTED_ITEMS)} 項)。` +
        "網站帳號該做的事都做得到。",
    );
    out.push(ledger);
  } else {
    if (!countOk) {
      out.push(
        `結論:項數不對,只有 ${safeNum(results.length)} 項,應該有 ${safeNum(EXPECTED_ITEMS)} 項。` +
          "這代表流程中途被截斷,不管有沒有紅字都不算過。",
      );
    }
    if (bad.length > 0) {
      out.push(`結論:${safeNum(results.length)} 項裡有 ${safeNum(bad.length)} 項沒過。`);
    }
    for (const r of bad) {
      out.push(`  沒過的是:第 ${r.no} 項 ${r.label}`);
      if (r.evidence) out.push(`    資料庫回的:${r.evidence}`);
      if (r.note) out.push(`    白話:${r.note}`);
    }
    out.push(ledger);
    out.push(
      "下一步:把這整個畫面貼給 Claude。不要自己加權限,更不要給全部權限。",
    );
  }
  out.push(bar);
  return out.join("\n");
}

/**
 * 連上之後的中止代碼。跟 PREFLIGHT 一樣是穩定代碼:訊息可以改寫,代碼不會變,
 * 文件與測試都認代碼。
 */
export const ABORT = Object.freeze({
  NO_TLS: "ABORT_NO_TLS",
  TLS_UNVERIFIED: "ABORT_TLS_UNVERIFIED",
  IDENTITY: "ABORT_IDENTITY",
  PROD_SCHEMA: "ABORT_PROD_SCHEMA",
  SCHEMA_MISMATCH: "ABORT_SCHEMA_MISMATCH",
  TARGET_MISSING: "ABORT_TARGET_MISSING",
  TARGET_TOO_BIG: "ABORT_TARGET_TOO_BIG",
  KILL_PROBE_IDENTITY: "ABORT_KILL_PROBE_IDENTITY",
});

/** 前置檢查擋下來時丟這個,主流程會印 72 等號橫幅,跟「測試結果」區分開。 */
export class ProbeAbort extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "ProbeAbort";
    this.abortCode = code;
  }
}

// ---------------------------------------------------------------------------
// 協調層(依賴注入,測試餵假的 query/tx/killProbe,不連任何 DB)
// ---------------------------------------------------------------------------

const first = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : null);
const pick = (row, ...names) => {
  if (!row) return undefined;
  for (const n of names) {
    if (row[n] !== undefined) return row[n];
    const lower = n.toLowerCase();
    if (row[lower] !== undefined) return row[lower];
    const upper = n.toUpperCase();
    if (row[upper] !== undefined) return row[upper];
  }
  return undefined;
};

/**
 * 主協調函式。
 *
 * @param {object} deps
 *   query(sql, params?) => rows            單一查詢入口(DML 回 ResultSetHeader)
 *   tx: { begin(), commit(), rollback() }  交易控制
 *   tlsInfo: { protocol, authorized, cipher, issuer, authorizationError }
 *   killProbe() => Promise<void>           在另一條拋棄式連線上跑 KILL CONNECTION_ID()
 *   log(line)                              進度輸出
 *   rand() => number                       取 [0,1) 亂數(測試可注入固定值)
 * @returns {{ results: Array, exitCode: number, meta: object }}
 */
export async function runProbe(deps) {
  const {
    query,
    tx,
    tlsInfo,
    killProbe,
    log = () => {},
    rand = Math.random,
  } = deps;

  const results = [];
  const meta = {};
  const createdIds = [];
  const add = (no, label, status, evidence, note) => {
    results.push({ no, label, status, evidence, note });
    log(`  ${MARK[status]} ${no}. ${label}`);
  };

  // --- 01 TLS -------------------------------------------------------------
  // 這一段的證據值全部走白名單(safeIdent):TLS 層回報的協定/加密套件/簽發者
  // 雖然不是 Jeff 貼的字串,但也是外部來源,一樣不無條件相信。
  if (!tlsInfo || !tlsInfo.protocol) {
    add("01", "連線有沒有加密", "FAIL", "沒有 TLS 通道");
    throw new ProbeAbort(
      "中止:這條連線沒有加密。app_runtime 的密碼會以明文送出,拒絕繼續。" +
        `代碼 ${ABORT.NO_TLS}。`,
      ABORT.NO_TLS,
    );
  }
  if (tlsInfo.authorized !== true) {
    add(
      "01",
      "連線有沒有加密",
      "FAIL",
      `憑證驗證失敗:${tlsInfo.authorizationError ? safeIdent(String(tlsInfo.authorizationError)) : "(未提供原因)"}`,
    );
    throw new ProbeAbort(
      "中止:伺服器憑證驗不過。不要改成不驗憑證,把這個畫面貼給 Claude。" +
        `代碼 ${ABORT.TLS_UNVERIFIED}。`,
      ABORT.TLS_UNVERIFIED,
    );
  }
  add(
    "01",
    "連線有沒有加密、憑證驗不驗得過",
    "PASS",
    `${safeIdent(String(tlsInfo.protocol))} / ${tlsInfo.cipher ? safeIdent(String(tlsInfo.cipher)) : "?"} / 簽發者 ${tlsInfo.issuer ? safeText(String(tlsInfo.issuer)) : "?"}`,
  );

  // --- 02 身分與靶場 -------------------------------------------------------
  const who = first(await query("SELECT CURRENT_USER() AS cu, DATABASE() AS db, VERSION() AS v"));
  const cu = String(pick(who, "cu") ?? "?");
  const dbName = String(pick(who, "db") ?? "?");
  const ver = String(pick(who, "v") ?? "?");
  // 印出去的一律是白名單化過的版本。cu / dbName 是【連上之後】伺服器自己回報的值,
  // 不是 Jeff 貼的那串字(database 連 connOptionsFor 送出去的都是常量 SCHEMA),
  // 而 safeIdent 的字元集不含冒號與斜線,任何連線字串形狀都過不了。
  const cuShown = safeIdent(cu);
  const dbShown = safeIdent(dbName);
  meta.user = cuShown;
  meta.schema = dbShown;

  if (!/app_runtime/i.test(cu)) {
    add("02", "連線身分與靶場對不對", "FAIL", `CURRENT_USER()=${cuShown}`);
    throw new ProbeAbort(
      `中止:連線身分不含 'app_runtime'(${cuShown})。只准用 app_runtime 對 canary 跑。` +
        `代碼 ${ABORT.IDENTITY}。`,
      ABORT.IDENTITY,
    );
  }
  if (/^test$/i.test(dbName)) {
    add("02", "連線身分與靶場對不對", "FAIL", `DATABASE()=${dbShown}`);
    throw new ProbeAbort(
      "中止:你把正式 schema(test)貼進來了。這支會寫資料,絕不准對正式站跑。" +
        `代碼 ${ABORT.PROD_SCHEMA}。`,
      ABORT.PROD_SCHEMA,
    );
  }
  if (dbName !== SCHEMA) {
    add("02", "連線身分與靶場對不對", "FAIL", `DATABASE()=${dbShown}`);
    throw new ProbeAbort(
      `中止:schema 名必須剛好是 '${SCHEMA}'(目前是 ${dbShown})。這支會寫資料,不接受近似名。` +
        `代碼 ${ABORT.SCHEMA_MISMATCH}。`,
      ABORT.SCHEMA_MISMATCH,
    );
  }
  add(
    "02",
    "連線身分與靶場對不對",
    "PASS",
    `身分=${cuShown} 靶場=${dbShown} 版本=${safeIdent(ver)}`,
  );

  // --- 03 靶表 -------------------------------------------------------------
  const cnt = first(
    await query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [TARGET],
    ),
  );
  const tableCount = Number(pick(cnt, "n") ?? 0);
  if (tableCount !== 1) {
    add("03", "靶表在不在", "INCONCLUSIVE", `找到 ${safeNum(tableCount)} 張同名表`);
    throw new ProbeAbort(
      `中止:靶表 ${TARGET} 沒佈好(找到 ${safeNum(tableCount)} 張)。回手冊步驟 8 把它建起來再跑。` +
        `代碼 ${ABORT.TARGET_MISSING}。`,
      ABORT.TARGET_MISSING,
    );
  }

  const baseRow = first(await query(`SELECT COUNT(*) AS n FROM ${TARGET}`));
  const baseline = Number(pick(baseRow, "n") ?? 0);
  meta.baseline = baseline;
  if (baseline > 1000) {
    add("03", "靶表在不在", "FAIL", `靶表有 ${safeNum(baseline)} 列`);
    throw new ProbeAbort(
      `中止:靶表有 ${safeNum(baseline)} 列,不該有這麼多。這個數字不對就是指錯地方了。` +
        `代碼 ${ABORT.TARGET_TOO_BIG}。`,
      ABORT.TARGET_TOO_BIG,
    );
  }

  const cols = await query(
    "SELECT COLUMN_NAME, COLUMN_KEY FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [TARGET],
  );
  const colList = Array.isArray(cols) ? cols : [];
  const mutable = colList.find(
    (c) => String(pick(c, "COLUMN_KEY") ?? "").toUpperCase() !== "PRI",
  );
  // 只允許來自 information_schema 的欄名,不接受任何外部輸入;而且欄名要自己再過一次
  // 格式檢查(只認英數與底線)才准拼進 SQL 或印出來,形狀不對就當作「沒有可改欄位」,
  // 走下面的降級判定。
  const mutableRaw = mutable ? String(pick(mutable, "COLUMN_NAME")) : null;
  const mutableCol =
    mutableRaw && /^[A-Za-z0-9_]{1,64}$/.test(mutableRaw) ? mutableRaw : null;
  add(
    "03",
    "靶表在不在、乾不乾淨",
    "PASS",
    `靶表存在,開跑前 ${safeNum(baseline)} 列,欄位 ${safeNum(colList.length)} 個` +
      (mutableCol ? `,可改欄位 ${mutableCol}` : ",只有主鍵一欄"),
  );

  // 保留區間 id:遠離任何真實自增 id,且小於 INT 上限 2147483647。
  const A = 1_900_000_000 + Math.floor(rand() * 10_000_000);
  const B = A + 1;
  meta.ids = [A, B];

  // 宣告在 try 外面:帶鎖沒放掉時要終結主連線,但那件事必須排在清理【之後】,
  // 不然主連線一斷,finally 裡的清理與對帳就跑不動,會留下真的垃圾又誤報。
  let lockHeld = false;

  try {
    // --- 04 SELECT 1 ------------------------------------------------------
    try {
      await query("SELECT 1");
      add(
        "04",
        "網站的健康檢查心跳",
        "PASS",
        "SELECT 1 正常回應(正式站每分鐘都在跑這句)",
      );
    } catch (e) {
      add("04", "網站的健康檢查心跳", "FAIL", errSummary(e),
        "連最基本的一句都不通,代表這不是權限問題,是連線或帳號本身有問題。");
    }

    // --- 05 information_schema --------------------------------------------
    try {
      const rows = await query(
        "SELECT TABLE_NAME AS t FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()",
      );
      const names = (Array.isArray(rows) ? rows : []).map((r) =>
        String(pick(r, "t") ?? ""),
      );
      if (names.length >= 1 && names.includes(TARGET)) {
        add(
          "05",
          "網站確認資料表還在的那個查詢",
          "PASS",
          `讀到 ${safeNum(names.length)} 張表,含 ${TARGET}`,
          "這只證明機制在窄鑰匙身分下可用,還沒證明正式 schema 的所有表都看得到。",
        );
      } else {
        add(
          "05",
          "網站確認資料表還在的那個查詢",
          "FAIL",
          `讀到 ${safeNum(names.length)} 張表,沒看到 ${TARGET}`,
        );
      }
    } catch (e) {
      add("05", "網站確認資料表還在的那個查詢", "FAIL", errSummary(e));
    }

    // --- 06 INSERT --------------------------------------------------------
    // 前置自清:只清自己這兩個保留 id,不碰任何別的列。
    try {
      await query(`DELETE FROM ${TARGET} WHERE id IN (?, ?)`, [A, B]);
    } catch {
      /* 清不掉就讓後面的 INSERT 自己報錯,這裡不判定 */
    }
    let insertOk = false;
    try {
      const res = await query(`INSERT INTO ${TARGET} (id) VALUES (?)`, [A]);
      createdIds.push(A);
      const affected = Number(pick(res, "affectedRows") ?? 0);
      insertOk = affected === 1;
      add(
        "06",
        "新增一筆資料",
        insertOk ? "PASS" : "FAIL",
        `affectedRows=${safeNum(affected)},用的 id=${safeNum(A)}`,
      );
    } catch (e) {
      add("06", "新增一筆資料", "FAIL", errSummary(e),
        "窄鑰匙帳號沒有寫入權限,網站會無法建立訂單或客戶。");
    }

    // --- 07 回讀 ----------------------------------------------------------
    try {
      const sel = await query(`SELECT id FROM ${TARGET} WHERE id = ?`, [A]);
      const arr = Array.isArray(sel) ? sel : [];
      const ok = arr.length === 1 && Number(pick(arr[0], "id")) === A;
      add(
        "07",
        "剛剛那筆真的存進去了",
        ok ? "PASS" : "FAIL",
        `讀回 ${safeNum(arr.length)} 列`,
        ok ? undefined : "新增沒報錯但資料沒落地,屬於靜默失敗,要查。",
      );
    } catch (e) {
      add("07", "剛剛那筆真的存進去了", "FAIL", errSummary(e));
    }

    // --- 08 UPDATE --------------------------------------------------------
    if (mutableCol) {
      try {
        const res = await query(
          `UPDATE ${TARGET} SET \`${mutableCol}\` = ? WHERE id = ?`,
          ["canary-probe", A],
        );
        const affected = Number(pick(res, "affectedRows") ?? 0);
        const back = await query(
          `SELECT \`${mutableCol}\` AS v FROM ${TARGET} WHERE id = ?`,
          [A],
        );
        const arr = Array.isArray(back) ? back : [];
        const val = arr.length ? String(pick(arr[0], "v")) : null;
        const ok = affected === 1 && val === "canary-probe";
        add(
          "08",
          "修改一筆資料",
          ok ? "PASS" : "FAIL",
          `affectedRows=${safeNum(affected)},改完讀回的值=${val === null ? "(沒有值)" : safeText(String(val))}`,
        );
      } catch (e) {
        add("08", "修改一筆資料", "FAIL", errSummary(e),
          "窄鑰匙帳號沒有修改權限,網站會無法更新訂單狀態。");
      }
    } else {
      // 靶表只有主鍵一欄:TiDB 的 clustered 主鍵改不動是引擎限制,不是權限問題。
      // 所以判準改成「沒有丟出權限類錯碼」,權限檢查發生在配對列之前,仍能證明
      // UPDATE 權限存在。affectedRows 可能是 0,絕不能拿它當判準。
      try {
        const res = await query(`UPDATE ${TARGET} SET id = id WHERE id = ?`, [A]);
        const affected = Number(pick(res, "affectedRows") ?? 0);
        add(
          "08",
          "修改一筆資料",
          "PASS",
          `沒有被權限擋下(affectedRows=${safeNum(affected)})`,
          "只驗到權限,沒驗到資料真的被改(靶表只有一個欄位)。這一項是降級判定。",
        );
      } catch (e) {
        const errno = typeof e.errno === "number" ? e.errno : null;
        const denied = errno === 1142 || errno === 1044;
        add(
          "08",
          "修改一筆資料",
          denied ? "FAIL" : "INCONCLUSIVE",
          errSummary(e),
          denied
            ? "窄鑰匙帳號沒有修改權限,網站會無法更新訂單狀態。"
            : "不是權限錯,多半是靶表只有主鍵欄位造成的引擎限制。建議請 Claude 幫靶表補一個欄位再跑。",
        );
      }
    }

    // --- 09 DELETE --------------------------------------------------------
    try {
      const res = await query(`DELETE FROM ${TARGET} WHERE id = ?`, [A]);
      const affected = Number(pick(res, "affectedRows") ?? 0);
      const back = await query(`SELECT id FROM ${TARGET} WHERE id = ?`, [A]);
      const remain = Array.isArray(back) ? back.length : -1;
      const ok = affected === 1 && remain === 0;
      add(
        "09",
        "刪掉一筆資料",
        ok ? "PASS" : "FAIL",
        `affectedRows=${safeNum(affected)},刪完剩 ${safeNum(remain)} 列`,
      );
    } catch (e) {
      add("09", "刪掉一筆資料", "FAIL", errSummary(e),
        "窄鑰匙帳號沒有刪除權限。");
    }

    // --- 10 / 11 / 12 交易 + 稽核鏈的兩句 lock ------------------------------
    // 逐字複製正式站 withDbTipLock 的執行形狀(auditLog.ts 的 tdb.transaction
    // 包住 GET_LOCK / RELEASE_LOCK),不然驗過了也不代表正式路徑會過。
    // acquire 與 release 必須同一條連線,所以這裡不准換連線、不准用連線池。
    let txOpen = false;
    try {
      await tx.begin();
      txOpen = true;

      // 11 GET_LOCK
      try {
        const g = first(
          await query(`SELECT GET_LOCK('${LOCK_NAME}', 3) AS l`),
        );
        const raw = pick(g, "l");
        const verdict = classifyLockResult(raw);
        if (verdict === "PASS") lockHeld = true;
        add(
          "11",
          "稽核鏈的排隊鎖,拿得到嗎",
          verdict,
          `GET_LOCK 回傳 ${safeNum(raw)}`,
          verdict === "PASS"
            ? undefined
            : verdict === "INCONCLUSIVE"
              ? "3 秒內沒搶到鎖,八成是上一次跑完留下的殘留鎖。等一分鐘再跑一次。"
              : "拿不到稽核鏈的鎖,網站每寫一筆稽核紀錄都會受影響。",
        );
      } catch (e) {
        add("11", "稽核鏈的排隊鎖,拿得到嗎", "FAIL", errSummary(e));
      }

      // 12 RELEASE_LOCK
      if (lockHeld) {
        try {
          const r = first(
            await query(`SELECT RELEASE_LOCK('${LOCK_NAME}') AS r`),
          );
          const raw = pick(r, "r");
          const ok = Number(raw) === 1;
          if (ok) lockHeld = false;
          add(
            "12",
            "稽核鏈的排隊鎖,放得掉嗎",
            ok ? "PASS" : "FAIL",
            `RELEASE_LOCK 回傳 ${safeNum(raw)}`,
            ok
              ? undefined
              : "鎖放不掉。這條連線會帶著鎖直到逾時,下次重跑第 11 項會等 3 秒。因為用的是 canary 專屬鎖名,正式站不受影響。",
          );
        } catch (e) {
          add("12", "稽核鏈的排隊鎖,放得掉嗎", "FAIL", errSummary(e));
        }
      } else {
        add("12", "稽核鏈的排隊鎖,放得掉嗎", "INCONCLUSIVE", "沒拿到鎖,無從釋放");
      }

      await tx.commit();
      txOpen = false;
      add("10", "交易(一組動作要嘛全成功要嘛全取消)", "PASS", "BEGIN 與 COMMIT 都正常");
    } catch (e) {
      if (txOpen) {
        try {
          await tx.rollback();
        } catch {
          /* rollback 也失敗就算了,下面照樣報 */
        }
      }
      add("10", "交易(一組動作要嘛全成功要嘛全取消)", "FAIL", errSummary(e));
    }

  } finally {
    // --- 13 清理與收支核對 -------------------------------------------------
    let after = null;
    let cleanupErr = null;
    if (createdIds.length) {
      try {
        const marks = createdIds.map(() => "?").join(", ");
        await query(`DELETE FROM ${TARGET} WHERE id IN (${marks})`, createdIds);
      } catch (e) {
        cleanupErr = e;
      }
    }
    try {
      const row = first(await query(`SELECT COUNT(*) AS n FROM ${TARGET}`));
      after = Number(pick(row, "n") ?? NaN);
    } catch (e) {
      cleanupErr = cleanupErr ?? e;
    }
    meta.after = after;

    const balanced = after != null && Number.isFinite(after) && after === baseline;
    add(
      "13",
      "靶場有沒有清乾淨",
      balanced ? "PASS" : "FAIL",
      `開始 ${safeNum(baseline)} 列,結束 ${safeNum(after)} 列` +
        (cleanupErr ? `,清理時出錯:${errSummary(cleanupErr)}` : ""),
      balanced
        ? undefined
        : "有殘留。把下面這句整段複製,貼進 TiDB 的 SQL 編輯器執行:\n" +
          `        DELETE FROM \`canary\`.\`${TARGET}\` WHERE id IN (${createdIds.join(", ") || `${A}, ${B}`});`,
    );
  }

  // 帶鎖沒放掉:照 auditLog.ts 的 R10-2 紀律,把這條污染連線終結掉,不留殘鎖 session。
  // 刻意排在清理與對帳【之後】:先斷主連線的話,上面的 DELETE 與 COUNT 會跑不動,
  // 結果是真的留下垃圾、成績單還誤報「沒清乾淨」。
  if (lockHeld) {
    try {
      await query("KILL CONNECTION_ID()");
    } catch {
      /* 預期會斷線,忽略 */
    }
  }

  // --- 14 KILL CONNECTION_ID()(獨立連線,最後才跑) -------------------------
  // 排在清理之後,而且另開一條拋棄式連線,這樣主連線不會被切斷,
  // 清理與成績單一定印得出來。
  let killErr = null;
  try {
    await killProbe();
  } catch (e) {
    killErr = e;
  }
  const kill = classifyKillOutcome(killErr);
  add(
    "14",
    "終結自己的連線(稽核鏈的逃生口)",
    kill.status,
    killErr ? errSummary(killErr) : "指令沒有回報錯誤",
    kill.note,
  );

  // fail-closed 兩條件:每一項都 PASS,【而且】項數剛好是應有的項數(比照 9b)。
  const exitCode =
    results.length === EXPECTED_ITEMS && results.every((r) => r.status === "PASS")
      ? 0
      : 1;
  return { results, exitCode, meta };
}

// ---------------------------------------------------------------------------
// 真連線層(main)
// ---------------------------------------------------------------------------

function banner(line) {
  const bar = "=".repeat(72);
  console.error(bar);
  console.error(line);
  console.error(bar);
}

/** 從活著的連線上取真實 TLS 證據(不是我們送進去的設定值)。 */
function readTlsInfo(conn) {
  const sock = conn?.connection?.stream;
  if (!sock || typeof sock.getProtocol !== "function") return null;
  const protocol = sock.getProtocol();
  if (!protocol) return null;
  let cipher = null;
  let issuer = null;
  try {
    cipher = sock.getCipher()?.name ?? null;
  } catch {
    /* 取不到就算了,protocol 與 authorized 才是判準 */
  }
  try {
    const cert = sock.getPeerCertificate();
    issuer = cert?.issuer?.O ?? cert?.issuer?.CN ?? null;
  } catch {
    /* 同上 */
  }
  return {
    protocol,
    authorized: sock.authorized,
    authorizationError: sock.authorizationError
      ? String(sock.authorizationError)
      : null,
    cipher,
    issuer,
  };
}

async function main() {
  const url = process.env.CANARY_APP_RUNTIME_DATABASE_URL;
  if (!url) {
    console.log(
      "[canary-probe] SKIPPED:未設 CANARY_APP_RUNTIME_DATABASE_URL。\n" +
        "  人工驗證不走這支腳本(2026-07-23 裁定):canary 的人工驗證一律走桌面指南步驟 9\n" +
        "  (標準 mysql 客戶端)~/Desktop/PACKGO_AI交流/網站專案/DB加固_後台操作指南.md。\n" +
        "  本腳本僅供未來自動化,屆時此 env 由設定檔供給、非人手輸入。無 env 即無害跳過。",
    );
    process.exit(2);
  }

  // 連線前防呆(跟 9b 共用同一份 preflight)。這支【會寫資料】,所以更不能等連上
  // 才檢查:連線字串貼錯時,密碼在這裡就被擋住,連送都不會送出去。
  const pre = preflight(url);
  if (!pre.ok) {
    // pre.reason 一定是 PREFLIGHT_REASON 裡的固定字串,pre.code 是穩定代碼。
    // 這兩樣以外什麼都不印 —— 尤其不印「你貼的是什麼」(那正是 critical 的成因)。
    banner(
      `[canary-probe] 中止(還沒連線,密碼沒有送出去):${pre.reason}\n` +
        `  代碼:${pre.code}`,
    );
    process.exit(1);
  }
  const connOpts = connOptionsFor(pre);

  // 主機名已經在 preflight 過了白名單;這裡再套一次 safeHost,單純是不想讓
  // 「輸出點有沒有白名單」這件事依賴呼叫順序。
  console.log(`[canary-probe] 連線中:${safeHost(pre.host)}`);
  let conn;
  try {
    conn = await raceWithTimeout(
      () => mysql.createConnection(connOpts),
      HANDSHAKE_TIMEOUT_MS,
      `連了 ${HANDSHAKE_TIMEOUT_MS / 1000} 秒還沒完成 MySQL 交握(對方接了 TCP 卻不講 MySQL,多半是 port 打錯)`,
    );
  } catch (e) {
    banner(`[canary-probe] 中止:連不上或憑證驗不過。${errSummary(e)}`);
    process.exit(1);
  }
  // 第三條繞過通道:連線物件自己的 error 事件。
  // 這支第 12 / 14 項會故意切斷自己的連線,所以斷線類 code 只記一行、不中止。
  attachConnErrorGuard(conn, "[canary-probe]", { tolerateDisconnect: true });

  const tlsInfo = readTlsInfo(conn);

  const query = async (sql, params) => {
    const [rows] = params ? await conn.execute(sql, params) : await conn.query(sql);
    return rows;
  };
  const tx = {
    begin: () => conn.beginTransaction(),
    commit: () => conn.commit(),
    rollback: () => conn.rollback(),
  };

  // KILL 用的拋棄式連線:同一組 TLS 設定,並重跑身分/靶場防呆。
  const killProbe = async () => {
    const kc = await raceWithTimeout(
      () => mysql.createConnection(connOpts),
      HANDSHAKE_TIMEOUT_MS,
      `KILL 探測連線 ${HANDSHAKE_TIMEOUT_MS / 1000} 秒還沒完成 MySQL 交握`,
    );
    // 這條連線本來就要被自己 KILL 掉,斷線是預期結果。
    attachConnErrorGuard(kc, "[canary-probe]", { tolerateDisconnect: true });
    try {
      const [rows] = await kc.query(
        "SELECT CURRENT_USER() AS cu, DATABASE() AS db",
      );
      const row = first(rows);
      const cu = String(pick(row, "cu") ?? "?");
      const dbn = String(pick(row, "db") ?? "?");
      if (!/app_runtime/i.test(cu) || dbn !== SCHEMA) {
        throw new ProbeAbort(
          `KILL 探測連線的身分/靶場不對(${safeIdent(cu)} / ${safeIdent(dbn)}),不執行。` +
            `代碼 ${ABORT.KILL_PROBE_IDENTITY}。`,
          ABORT.KILL_PROBE_IDENTITY,
        );
      }
      await kc.query("KILL CONNECTION_ID()");
    } finally {
      try {
        await kc.end();
      } catch {
        /* 連線本來就預期被切斷 */
      }
    }
  };

  let outcome;
  try {
    outcome = await runProbe({
      query,
      tx,
      tlsInfo,
      killProbe,
      log: (line) => console.log(line),
    });
  } catch (e) {
    try {
      await conn.end();
    } catch {
      /* noop */
    }
    if (e instanceof ProbeAbort) {
      banner(`[canary-probe] ${e.message}`);
      process.exit(1);
    }
    banner(`[canary-probe] 執行錯誤(非探測結果):${errSummary(e)}`);
    process.exit(1);
  }

  try {
    await conn.end();
  } catch {
    /* noop */
  }

  console.log("");
  console.log(renderReport(outcome.results, { ...outcome.meta, host: pre.host }));
  process.exit(outcome.exitCode);
}

// 只有被直接執行時才連線;被 import(測試)時只提供純函式。
// 用 resolve + fileURLToPath 比對(同 safe-deploy.mjs 的寫法):repo 路徑含中文,
// 手工拼 file:// URL 會因為百分號編碼差異比對不到。
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  // 三條會繞過 main().catch() 的通道,兩條在這裡接住(第三條 conn 的 error 事件
  // 在 main() 裡對每條連線各掛一次)。任何一條漏掉,Node 預設處理器就會把整個
  // error 物件印出來 —— 密碼就掛在它的 own enumerable 屬性上。
  installProcessGuards("[canary-probe]");
  main().catch((e) => {
    banner(`[canary-probe] 未預期錯誤:${errSummary(e)}`);
    process.exit(1);
  });
}
