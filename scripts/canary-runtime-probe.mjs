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
 *      所以 schema 名必須「完全等於 canary」,比 9b 的模糊比對更嚴,避免打到
 *      canary_backup 之類的近似名,更避免打到正式 test schema。
 *   2. TLS 必須真的加密且憑證驗得過(簽發鏈 + 主機名兩者)。驗不過就停,
 *      絕不退回 rejectUnauthorized:false。這條連線會送出 app_runtime 的密碼。
 *   3. 寫入只用保留區間的 id(1.9e9 起跳),且每一筆都登記進 createdIds,
 *      結束時逐筆清掉並與開跑前的列數對帳。任何 UPDATE/DELETE 都必須帶
 *      WHERE id = ?,本檔不得出現無 WHERE 的版本,也不得用 TRUNCATE。
 *   4. advisory lock 一律用 canary 專屬鎖名,絕不可用正式的 audit:tip:lock。
 *      GET_LOCK 的命名空間是整個叢集共用,靶場與正式站同叢集;探測只要搶走
 *      3 秒,同時間正式站的稽核寫入就會 timeout 走「無鏈孤列」路徑,等於為了
 *      驗證製造一筆事故。權限檢查跟鎖名無關,換名零損失。
 *   5. 連線字串與密碼絕不印出。錯誤一律只取白名單欄位。
 *
 * 用法(Jeff,canary 佈置完成後):
 *   CANARY_APP_RUNTIME_DATABASE_URL='mysql://<prefix>.app_runtime:<pw>@<canary-host>:4000/canary' \
 *     node scripts/canary-runtime-probe.mjs
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

/** 把 scheme://user:password@host 這種憑證從任何字串裡遮掉。 */
export const redact = (s) =>
  String(s ?? "").replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s/@]*@/gi,
    "$1***:***@",
  );

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
 */
export function renderReport(results, meta = {}) {
  const bar = "=".repeat(72);
  const out = [];
  out.push(bar);
  out.push("正向驗證:該成功的操作,是不是真的成功");
  out.push(
    `靶場 ${meta.schema ?? "?"}(零客戶資料) / 身分 ${meta.user ?? "?"} / 主機 ${meta.host ?? "?"}`,
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
      ? `靶場:開始 ${meta.baseline} 列,結束 ${meta.after} 列,本次殘留 ${meta.after - meta.baseline} 列。`
      : "靶場:列數未取得(前置檢查就中止了)。";

  if (bad.length === 0) {
    out.push(`結論:全部 ${results.length} 項通過。網站帳號該做的事都做得到。`);
    out.push(ledger);
  } else {
    out.push(`結論:${results.length} 項裡有 ${bad.length} 項沒過。`);
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

/** 前置檢查擋下來時丟這個,主流程會印 72 等號橫幅,跟「測試結果」區分開。 */
export class ProbeAbort extends Error {
  constructor(message) {
    super(message);
    this.name = "ProbeAbort";
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
  if (!tlsInfo || !tlsInfo.protocol) {
    add("01", "連線有沒有加密", "FAIL", "沒有 TLS 通道");
    throw new ProbeAbort(
      "中止:這條連線沒有加密。app_runtime 的密碼會以明文送出,拒絕繼續。",
    );
  }
  if (tlsInfo.authorized !== true) {
    add(
      "01",
      "連線有沒有加密",
      "FAIL",
      `憑證驗證失敗:${tlsInfo.authorizationError ?? "(未提供原因)"}`,
    );
    throw new ProbeAbort(
      "中止:伺服器憑證驗不過。不要改成不驗憑證,把這個畫面貼給 Claude。",
    );
  }
  add(
    "01",
    "連線有沒有加密、憑證驗不驗得過",
    "PASS",
    `${tlsInfo.protocol} / ${tlsInfo.cipher ?? "?"} / 簽發者 ${tlsInfo.issuer ?? "?"}`,
  );

  // --- 02 身分與靶場 -------------------------------------------------------
  const who = first(await query("SELECT CURRENT_USER() AS cu, DATABASE() AS db, VERSION() AS v"));
  const cu = String(pick(who, "cu") ?? "?");
  const dbName = String(pick(who, "db") ?? "?");
  const ver = String(pick(who, "v") ?? "?");
  meta.user = cu;
  meta.schema = dbName;

  if (!/app_runtime/i.test(cu)) {
    add("02", "連線身分與靶場對不對", "FAIL", `CURRENT_USER()=${cu}`);
    throw new ProbeAbort(
      `中止:連線身分不含 'app_runtime'(${cu})。只准用 app_runtime 對 canary 跑。`,
    );
  }
  if (/^test$/i.test(dbName)) {
    add("02", "連線身分與靶場對不對", "FAIL", `DATABASE()=${dbName}`);
    throw new ProbeAbort(
      "中止:你把正式 schema(test)貼進來了。這支會寫資料,絕不准對正式站跑。",
    );
  }
  if (dbName !== "canary") {
    add("02", "連線身分與靶場對不對", "FAIL", `DATABASE()=${dbName}`);
    throw new ProbeAbort(
      `中止:schema 名必須剛好是 'canary'(目前是 ${dbName})。這支會寫資料,不接受近似名。`,
    );
  }
  add(
    "02",
    "連線身分與靶場對不對",
    "PASS",
    `身分=${cu} 靶場=${dbName} 版本=${ver}`,
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
    add("03", "靶表在不在", "INCONCLUSIVE", `找到 ${tableCount} 張同名表`);
    throw new ProbeAbort(
      `中止:靶表 ${TARGET} 沒佈好(找到 ${tableCount} 張)。回手冊步驟 8 把它建起來再跑。`,
    );
  }

  const baseRow = first(await query(`SELECT COUNT(*) AS n FROM ${TARGET}`));
  const baseline = Number(pick(baseRow, "n") ?? 0);
  meta.baseline = baseline;
  if (baseline > 1000) {
    add("03", "靶表在不在", "FAIL", `靶表有 ${baseline} 列`);
    throw new ProbeAbort(
      `中止:靶表有 ${baseline} 列,不該有這麼多。這個數字不對就是指錯地方了。`,
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
  // 只允許來自 information_schema 的欄名,不接受任何外部輸入。
  const mutableCol = mutable ? String(pick(mutable, "COLUMN_NAME")) : null;
  add(
    "03",
    "靶表在不在、乾不乾淨",
    "PASS",
    `靶表存在,開跑前 ${baseline} 列,欄位 ${colList.length} 個` +
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
          `讀到 ${names.length} 張表,含 ${TARGET}`,
          "這只證明機制在窄鑰匙身分下可用,還沒證明正式 schema 的所有表都看得到。",
        );
      } else {
        add(
          "05",
          "網站確認資料表還在的那個查詢",
          "FAIL",
          `讀到 ${names.length} 張表,沒看到 ${TARGET}`,
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
        `affectedRows=${affected},用的 id=${A}`,
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
        `讀回 ${arr.length} 列`,
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
          `affectedRows=${affected},改完讀回的值=${val}`,
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
          `沒有被權限擋下(affectedRows=${affected})`,
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
        `affectedRows=${affected},刪完剩 ${remain} 列`,
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
          `GET_LOCK 回傳 ${raw}`,
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
            `RELEASE_LOCK 回傳 ${raw}`,
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
      `開始 ${baseline} 列,結束 ${after ?? "?"} 列` +
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

  const exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
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

/**
 * TLS 硬設定。rejectUnauthorized 與 verifyIdentity 兩個都要:
 * mysql2 3.16.1 的 lib/base/connection.js 會把 checkServerIdentity 換成永遠回
 * undefined 的空函式,除非傳 verifyIdentity,也就是只寫 rejectUnauthorized
 * 只驗簽發鏈、不核對主機名。
 */
const TLS = {
  rejectUnauthorized: true,
  verifyIdentity: true,
  minVersion: "TLSv1.2",
};

function connOptions(u) {
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 4000,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: TLS,
    multipleStatements: false,
    connectTimeout: 15000,
  };
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
        "  本批不實跑(prod 無 canary、app_runtime 角色未建)。\n" +
        "  Jeff 依 docs/infra/db-role-hardening.md 建好 canary schema + app_runtime 角色\n" +
        "  + 佈好 " + TARGET + " 後,設此 env 再跑。",
    );
    process.exit(2);
  }

  // 有人想從連線字串把憑證驗證關掉:直接擋,不給討價還價的空間。
  if (/rejectUnauthorized"?\s*[:=]\s*false/i.test(url)) {
    banner(
      "[canary-probe] 中止:連線字串裡把憑證驗證關掉了。這條連線會送出密碼,不准不驗。",
    );
    process.exit(1);
  }

  let u;
  try {
    u = new URL(url);
  } catch {
    banner(
      "[canary-probe] 中止:連線字串解析不了。\n" +
        "  這不是權限問題也不是主機打錯,是你的密碼裡有特殊符號。\n" +
        "  回手冊第四段,把密碼改成純英數 32 位,再重設一次 env。",
    );
    process.exit(1);
  }

  console.log(`[canary-probe] 連線中:${u.hostname}`);
  let conn;
  try {
    conn = await mysql.createConnection(connOptions(u));
  } catch (e) {
    banner(`[canary-probe] 中止:連不上或憑證驗不過。${errSummary(e)}`);
    process.exit(1);
  }

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
    const kc = await mysql.createConnection(connOptions(u));
    try {
      const [rows] = await kc.query(
        "SELECT CURRENT_USER() AS cu, DATABASE() AS db",
      );
      const row = first(rows);
      const cu = String(pick(row, "cu") ?? "?");
      const dbn = String(pick(row, "db") ?? "?");
      if (!/app_runtime/i.test(cu) || dbn !== "canary") {
        throw new ProbeAbort(
          `KILL 探測連線的身分/靶場不對(${cu} / ${dbn}),不執行。`,
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
  console.log(renderReport(outcome.results, { ...outcome.meta, host: u.hostname }));
  process.exit(outcome.exitCode);
}

// 只有被直接執行時才連線;被 import(測試)時只提供純函式。
// 用 resolve + fileURLToPath 比對(同 safe-deploy.mjs 的寫法):repo 路徑含中文,
// 手工拼 file:// URL 會因為百分號編碼差異比對不到。
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
