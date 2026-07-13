/**
 * B1 信託認列 fail-closed 測試(2026-07-13,Codex 第6輪裁定)。
 *
 * design.md「測試釘死」五條:
 *   1. 到期+已配對+未取消 → scanRecognitionDue 後 recognizedAt 不被寫入、
 *      dueForReview 計數正確(2a)。
 *   2. PLAID/STRIPE 四種旗標組合下,掃描零 recognizedAt 寫入(2b)。
 *   3. 守門:讀產線原始碼,`recognizedAt: new Date` / `set({ recognizedAt`
 *      0 命中(排除 *.test.ts)(2c)。
 *   4. dueForReview > 0 → agentMessages 待審卡;同集合第二次跑不重複出卡;
 *      Redis 讀失敗照出卡(2d)。
 *   5. 既有「到期會認列」行為改遷為「不認列 + 進待審」(2e)。
 *
 * 手法:照 trustDeferralService.sentinel.test.ts(vi.mock ../db + chain)與
 * trustInvariantWatchdog.test.ts(fake db insert 捕捉 + mock ../redis)慣例。
 * 全部直接 await 被測函式,無 fire-and-forget,故不需 vi.waitFor。合成資料。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// ── DB / Redis mock ─────────────────────────────────────────────────────────
const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));

const redisGet = vi.fn();
const redisSet = vi.fn().mockResolvedValue("OK");
const redisDel = vi.fn().mockResolvedValue(1);
vi.mock("../redis", () => ({
  redis: {
    get: (...a: unknown[]) => redisGet(...a),
    set: (...a: unknown[]) => redisSet(...a),
    del: (...a: unknown[]) => redisDel(...a),
  },
}));

import {
  scanRecognitionDue,
  maybePostRecognitionDueCard,
  TRUST_RECOGNITION_DUE_ALERT_KEY,
  type ScanRecognitionDueResult,
} from "./trustDeferralService";

/** 順序 select 的 thenable(照 sentinel.test.ts 的 chain 形狀)。 */
function chain(result: unknown) {
  const p = Promise.resolve(result);
  const o: any = { then: p.then.bind(p), catch: p.catch.bind(p) };
  o.where = () => o;
  o.leftJoin = () => o;
  return o;
}

/**
 * scanRecognitionDue 的假 db:兩次 select(candidates → bookings)+ update/insert
 * 捕捉。update 一旦被呼叫即代表寫入認列 —— fail-closed 下必須恆為 0 次。
 */
function makeScanDb(candidates: unknown[], bookingRows: unknown[]) {
  const selectResults = [candidates, bookingRows];
  let i = 0;
  const updateCalls: any[] = [];
  const insertCalls: any[] = [];
  const db = {
    select: () => ({ from: () => chain(selectResults[i++]) }),
    update: (...a: unknown[]) => {
      updateCalls.push(a);
      return { set: () => ({ where: () => Promise.resolve(undefined) }) };
    },
    insert: () => ({
      values: (v: any) => {
        insertCalls.push(v);
        return Promise.resolve(undefined);
      },
    }),
  } as any;
  return { db, updateCalls, insertCalls };
}

const ORIGINAL_PLAID = process.env.PLAID_TRUST_DEFERRAL_ENABLED;
const ORIGINAL_STRIPE = process.env.STRIPE_TRUST_DEFERRAL_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  redisGet.mockResolvedValue(null);
  // 預設 PLAID on(掃描路徑作用中);個別測試自行覆寫旗標組合。
  process.env.PLAID_TRUST_DEFERRAL_ENABLED = "true";
  delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
});
afterEach(() => {
  if (ORIGINAL_PLAID === undefined) delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
  else process.env.PLAID_TRUST_DEFERRAL_ENABLED = ORIGINAL_PLAID;
  if (ORIGINAL_STRIPE === undefined) delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
  else process.env.STRIPE_TRUST_DEFERRAL_ENABLED = ORIGINAL_STRIPE;
});

// ── 2a:到期+已配對+未取消 → 不認列、dueForReview 正確 ────────────────────────
describe("scanRecognitionDue — 到期列進待審,recognizedAt 不被寫入(2a)", () => {
  it("到期+已配對+未取消 → dueForReview 計數正確、零 update、五類 skip 正確", async () => {
    const dueMatched = {
      id: 101, amount: "1500.00", bookingId: 55,
      expectedRecognitionDate: "2026-07-01", recognizedAt: null, reversedAt: null,
    };
    const dueCancelled = {
      id: 102, amount: "800.00", bookingId: 66,
      expectedRecognitionDate: "2026-07-02", recognizedAt: null, reversedAt: null,
    };
    const unmatched = {
      id: 103, amount: "400.00", bookingId: null,
      expectedRecognitionDate: "2026-07-01", recognizedAt: null, reversedAt: null,
    };
    const noDate = {
      id: 104, amount: "300.00", bookingId: 77,
      expectedRecognitionDate: null, recognizedAt: null, reversedAt: null,
    };
    const future = {
      id: 105, amount: "900.00", bookingId: 88,
      expectedRecognitionDate: "2026-09-01", recognizedAt: null, reversedAt: null,
    };
    const { db, updateCalls, insertCalls } = makeScanDb(
      [dueMatched, dueCancelled, unmatched, noDate, future],
      [
        { id: 55, bookingStatus: "confirmed" },
        { id: 66, bookingStatus: "cancelled" },
      ],
    );
    getDb.mockResolvedValue(db);

    const r = await scanRecognitionDue({ today: "2026-07-20" });

    // fail-closed 核心:全程零認列寫入。
    expect(updateCalls).toHaveLength(0);
    // 掃描函式本來就不該 insert 任何表(agentMessages 卡在 maybePostRecognitionDueCard,不在本函式範圍內)。
    expect(insertCalls).toHaveLength(0);
    // 到期列的 recognizedAt 仍 NULL(函式不觸碰輸入列)。
    expect(dueMatched.recognizedAt).toBeNull();

    expect(r.scanned).toBe(5);
    expect(r.dueForReview).toBe(1);
    expect(r.dueRows).toEqual([
      { id: 101, amount: 1500, bookingId: 55, expectedRecognitionDate: "2026-07-01" },
    ]);
    expect(r.skippedNotMatched).toBe(1);
    expect(r.skippedNoDepartureDate).toBe(1);
    expect(r.skippedCancelledBooking).toBe(1);
  });
});

// ── 2b:旗標矩陣 → 掃描零 recognizedAt 寫入 ───────────────────────────────────
describe("scanRecognitionDue — PLAID/STRIPE 四組合皆零寫入(2b)", () => {
  const combos: Array<{ plaid: boolean; stripe: boolean; expectDue: number }> = [
    { plaid: false, stripe: false, expectDue: 0 },
    { plaid: true, stripe: false, expectDue: 1 },
    { plaid: false, stripe: true, expectDue: 1 },
    { plaid: true, stripe: true, expectDue: 1 },
  ];

  for (const c of combos) {
    it(`PLAID=${c.plaid} STRIPE=${c.stripe} → 零 update、dueForReview=${c.expectDue}`, async () => {
      if (c.plaid) process.env.PLAID_TRUST_DEFERRAL_ENABLED = "true";
      else delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
      if (c.stripe) process.env.STRIPE_TRUST_DEFERRAL_ENABLED = "true";
      else delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;

      const dueMatched = {
        id: 201, amount: "1000.00", bookingId: 42,
        expectedRecognitionDate: "2026-07-01", recognizedAt: null, reversedAt: null,
      };
      const { db, updateCalls, insertCalls } = makeScanDb(
        [dueMatched],
        [{ id: 42, bookingStatus: "confirmed" }],
      );
      getDb.mockResolvedValue(db);

      const r = await scanRecognitionDue({ today: "2026-07-20" });

      expect(updateCalls).toHaveLength(0); // 任何旗標組合皆不寫 recognizedAt
      expect(insertCalls).toHaveLength(0); // 任何旗標組合皆零 insert
      expect(r.dueForReview).toBe(c.expectDue);
    });
  }
});

// ── 2c:守門 —— 產線碼無自動認列寫入(B1.1:掃描面擴 .mjs/.js/.cjs/.sql + scripts/)──
describe("mode 復活防護:產線碼零 recognizedAt 寫入(2c)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverDir = resolve(here, ".."); // server/services → server
  const repoScriptsDir = resolve(here, "..", "..", "scripts"); // repo 根 scripts/
  const drizzleDir = resolve(here, "..", "..", "drizzle"); // repo 根 drizzle/(140+ migration SQL)

  // B1.1(Codex 6.5 P1.2):掃描副檔名擴到 .ts/.mjs/.js/.cjs/.sql;排除任何
  // *.test.*(含 .test.mjs 等);node_modules 跳過。根 scripts/ 也套同一副檔名
  // 過濾(避免讀進 .png 等二進位)。
  const CODE_EXT = /\.(ts|mjs|js|cjs|sql)$/;
  const isScannable = (name: string) => CODE_EXT.test(name) && !name.includes(".test.");

  function walkCode(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walkCode(full, out);
      else if (isScannable(name)) out.push(full);
    }
    return out;
  }

  /**
   * 區塊掃描:對每個 `.set(` 出現點,截到對應閉括號(或往後 300 字元),
   * 內含 `recognizedAt` 即列為 offender。select 欄位映射(`recognizedAt:
   * trustDeferredIncome.recognizedAt`)不在 `.set(...)` 呼叫內,不會誤報。
   */
  function scanSetBlocks(src: string): string[] {
    const hits: string[] = [];
    let searchFrom = 0;
    let setIdx: number;
    while ((setIdx = src.indexOf(".set(", searchFrom)) !== -1) {
      const openParenIdx = setIdx + 4; // ".set(" 的 "(" 位置
      let depth = 0;
      let closeIdx = -1;
      const limit = Math.min(src.length, openParenIdx + 300);
      for (let i = openParenIdx; i < limit; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) {
            closeIdx = i;
            break;
          }
        }
      }
      const blockEnd = closeIdx !== -1 ? closeIdx : limit;
      const block = src.slice(setIdx, blockEnd);
      if (/recognizedAt/.test(block)) {
        const lineNum = src.slice(0, setIdx).split("\n").length;
        hits.push(`${lineNum}: [.set 區塊] ${block.replace(/\s+/g, " ").trim().slice(0, 160)}`);
      }
      searchFrom = setIdx + 5;
    }
    return hits;
  }

  /**
   * 單一原始碼字串 → offender 行清單(三層:字面量 recognizedAt:new Date /
   * .set({ recognizedAt / raw SQL 賦值 recognizedAt =,加 .set 區塊掃描)。
   * 抽出以便 fs 掃描與合成紅綠自證共用同一套判定邏輯。
   */
  function scanSource(src: string): string[] {
    const offenders: string[] = [];
    src.split("\n").forEach((ln, idx) => {
      // B1.2(Codex 6.6 P1):守門納入 drizzle/**/*.sql。SQL 註解行(-- 開頭)略過 ——
      // 既有歷史 migration 的說明註解(如 0072 的「mark recognizedAt = NOW().」)是
      // 文件不是寫入,不得誤判;真正的 raw-SQL 賦值(非註解)仍被下面三條抓。
      if (ln.trim().startsWith("--")) return;
      if (
        /recognizedAt:\s*new Date/.test(ln) ||
        /set\(\{\s*recognizedAt/.test(ln) ||
        // raw SQL 賦值 `recognizedAt = NOW()`,含 MySQL/TiDB 反引號欄名(`recognizedAt` = )。
        // 負向斷言排除:`==`/`===` 比較,及 JS 模板字串內插 `recognizedAt=${...}`(debug
        // 字串,非寫入)—— 賦值等號後(略過空白)的第一個非空白字元不得是 `=` 或 `$`。
        /recognizedAt`?\s*=\s*(?![$=])/.test(ln)
      ) {
        offenders.push(`${idx + 1}: ${ln.trim()}`);
      }
    });
    offenders.push(...scanSetBlocks(src));
    return offenders;
  }

  it("合成紅綠自證:三種 offender 寫法被抓,讀取/比較/select 映射放行", () => {
    // 紅:三種寫入寫法各自被抓。
    expect(scanSource("await db.update(x).set({ recognizedAt: new Date() })").length).toBeGreaterThan(0);
    expect(scanSource("UPDATE trustDeferredIncome SET recognizedAt = NOW()").length).toBeGreaterThan(0);
    expect(scanSource(".set({\n  recognizedAt,\n  recognitionRunId,\n})").length).toBeGreaterThan(0);
    // 綠:讀取/比較/select 欄位映射/debug 內插字串不誤報。
    expect(scanSource("recognizedAt: trustDeferredIncome.recognizedAt,")).toEqual([]);
    expect(scanSource("if (row.recognizedAt === null) return;")).toEqual([]);
    expect(scanSource("WHERE recognizedAt IS NULL AND reversedAt IS NULL")).toEqual([]);
    expect(scanSource("`recognizedAt=${row.recognizedAt} reversedAt=${row.reversedAt}`")).toEqual([]);

    // B1.2(Codex 6.6 P1):drizzle SQL 面 —— 反引號欄名賦值被抓,SQL 註解與欄位/索引
    // 定義放行(這正是 drizzle 歷史 migration 的既有形狀,不得誤判)。
    expect(scanSource("UPDATE trustDeferredIncome SET `recognizedAt` = NOW();").length).toBeGreaterThan(0);
    expect(scanSource("--   AND reversedAt IS NULL → mark recognizedAt = NOW(). bankPLService")).toEqual([]);
    expect(scanSource("  `recognizedAt` TIMESTAMP NULL DEFAULT NULL,")).toEqual([]);
    expect(scanSource("  KEY `idx_recognition_ready` (`recognizedAt`, `expectedRecognitionDate`, `reversedAt`),")).toEqual([]);
  });

  it("drizzle/ SQL 守門紅綠自證:植入反引號 `recognizedAt` = NOW() 假檔轉紅、刪除復綠", () => {
    // 用獨立 temp 目錄(不污染 repo 的 drizzle/,也不觸 clean-tree gate)驗證整條
    // walk + scan + .sql 副檔名 + 反引號賦值偵測。finally 清目錄,單檔連跑多次互不殘留。
    const tmp = mkdtempSync(join(tmpdir(), "trust-drizzle-guard-"));
    try {
      // 空目錄:綠。
      expect(walkCode(tmp)).toEqual([]);
      // 植入含反引號欄名賦值的假 migration → 轉紅。
      const planted = join(tmp, "9999_planted_recognize_writeback.sql");
      writeFileSync(
        planted,
        "-- 這行是註解,不該被抓:mark recognizedAt = NOW()\n" +
          "UPDATE `trustDeferredIncome` SET `recognizedAt` = NOW() WHERE id = 1;\n",
      );
      const filesRed = walkCode(tmp);
      expect(filesRed).toContain(planted);
      const offendersRed: string[] = [];
      for (const f of filesRed) for (const h of scanSource(readFileSync(f, "utf8"))) offendersRed.push(h);
      expect(offendersRed.length).toBeGreaterThan(0); // 反引號賦值被抓(註解那行不算)
      // 刪除假檔 → 復綠。
      unlinkSync(planted);
      const offendersGreen: string[] = [];
      for (const f of walkCode(tmp)) for (const h of scanSource(readFileSync(f, "utf8"))) offendersGreen.push(h);
      expect(offendersGreen).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("server/ + scripts/ + drizzle/(排除 *.test.*)無 recognizedAt 寫入痕跡(.ts/.mjs/.js/.cjs/.sql)", () => {
    // 效能:walkCode 只列路徑,下面單一迴圈每檔 readFileSync 一次(drizzle 有 140+
    // migration SQL,一次列出、一次讀取,不重複掃)。
    const files = [...walkCode(serverDir), ...walkCode(repoScriptsDir), ...walkCode(drizzleDir)];
    // sanity:確實掃到產線檔,且擴充副檔名真的生效(有掃到 .mjs),drizzle 的 .sql 也在。
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(".mjs"))).toBe(true);
    // 守門確實把 drizzle/ 的 .sql 掃進來(否則歷史/未來 migration 的 raw-SQL 認列寫入漏網)。
    expect(files.some((f) => f.endsWith(".sql") && f.includes("drizzle"))).toBe(true);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const hit of scanSource(src)) offenders.push(`${f}:${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});

// ── 2d:待審卡產出 + 同集合去重 + Redis 讀失敗照出卡 ──────────────────────────
describe("maybePostRecognitionDueCard — 待審卡與同集合去重(2d)", () => {
  function makeCardDb() {
    const inserted: any[] = [];
    const db = {
      insert: () => ({
        values: (v: any) => {
          inserted.push(v);
          return Promise.resolve(undefined);
        },
      }),
    } as any;
    return { db, inserted };
  }

  function result(dueRows: ScanRecognitionDueResult["dueRows"]): ScanRecognitionDueResult {
    return {
      runId: "scan-test",
      scanned: dueRows.length,
      dueForReview: dueRows.length,
      dueRows,
      skippedNoDepartureDate: 0,
      skippedNotMatched: 0,
      skippedCancelledBooking: 0,
    };
  }

  const DUE = [
    { id: 101, amount: 1500, bookingId: 55, expectedRecognitionDate: "2026-07-01" },
    { id: 102, amount: 800, bookingId: 66, expectedRecognitionDate: "2026-07-02" },
  ];

  it("dueForReview > 0 且無去重記憶 → 出 high 卡(待審文案,無「已認列/該轉了」),寫 Redis", async () => {
    const { db, inserted } = makeCardDb();
    const posted = await maybePostRecognitionDueCard(db, result(DUE));
    expect(posted).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].priority).toBe("high");
    expect(inserted[0].agentName).toBe("trust-recognition");
    expect(inserted[0].title).toContain("待審");
    expect(inserted[0].body).toContain("逐筆核");
    expect(inserted[0].body).not.toContain("已認列");
    expect(inserted[0].body).not.toContain("該轉了");
    expect(redisSet).toHaveBeenCalledWith(TRUST_RECOGNITION_DUE_ALERT_KEY, expect.any(String));
  });

  it("同一 due 集合第二次跑 → 不重複出卡", async () => {
    // 第一次跑,捕捉存進 Redis 的集合雜湊。
    const first = makeCardDb();
    await maybePostRecognitionDueCard(first.db, result(DUE));
    const storedHash = redisSet.mock.calls.at(-1)?.[1];
    expect(storedHash).toBeTruthy();

    // 第二次:Redis 已有同一雜湊 → 不出卡。
    redisGet.mockResolvedValue(storedHash);
    const second = makeCardDb();
    const posted = await maybePostRecognitionDueCard(second.db, result(DUE));
    expect(posted).toBe(false);
    expect(second.inserted).toHaveLength(0);
  });

  it("集合變化(金額或成員不同)→ 再出卡", async () => {
    const first = makeCardDb();
    await maybePostRecognitionDueCard(first.db, result(DUE));
    const storedHash = redisSet.mock.calls.at(-1)?.[1];
    redisGet.mockResolvedValue(storedHash);

    const changed = [...DUE, { id: 103, amount: 250, bookingId: 77, expectedRecognitionDate: "2026-07-03" }];
    const second = makeCardDb();
    const posted = await maybePostRecognitionDueCard(second.db, result(changed));
    expect(posted).toBe(true);
    expect(second.inserted).toHaveLength(1);
  });

  it("Redis 讀失敗 → 照出卡(合規寧可偏吵)", async () => {
    redisGet.mockRejectedValue(new Error("redis down"));
    const { db, inserted } = makeCardDb();
    const posted = await maybePostRecognitionDueCard(db, result(DUE));
    expect(posted).toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it("dueForReview 歸零 → 清去重記憶、不出卡", async () => {
    const { db, inserted } = makeCardDb();
    const posted = await maybePostRecognitionDueCard(db, result([]));
    expect(posted).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(redisDel).toHaveBeenCalledWith(TRUST_RECOGNITION_DUE_ALERT_KEY);
  });

  it("insert 炸 → 不外拋(絕不拖垮掃描主流程)", async () => {
    const throwingDb = {
      insert: () => ({ values: () => Promise.reject(new Error("insert blew up")) }),
    } as any;
    await expect(maybePostRecognitionDueCard(throwingDb, result(DUE))).resolves.toBe(false);
  });
});

// ── 2f:today 預設走 LA 曆日(UTC 前一晚不提早到期)(B1.1 P1.1)──────────────────
describe("scanRecognitionDue — today 預設 America/Los_Angeles 曆日(2f)", () => {
  it("UTC 已跨到隔天、LA 仍是前一天 → 用 LA 曆日,隔天到期的列尚未到期", async () => {
    // 2026-07-21T05:30:00Z:LA(PDT, UTC-7)= 2026-07-20 22:30 → LA 曆日 2026-07-20。
    // UTC slice 會誤取 2026-07-21,讓「07-21 到期」的列提早一天被列入待審。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T05:30:00Z"));
    try {
      const dueLA = {
        id: 701, amount: "1000.00", bookingId: 71,
        expectedRecognitionDate: "2026-07-20", recognizedAt: null, reversedAt: null,
      };
      const notDueUntilUtcTomorrow = {
        id: 702, amount: "2000.00", bookingId: 72,
        expectedRecognitionDate: "2026-07-21", recognizedAt: null, reversedAt: null,
      };
      // LA today = 07-20 → readyBookingIds 只含 71(07-21 列尚未到期,不進 bookings 查詢)。
      const { db, updateCalls } = makeScanDb(
        [dueLA, notDueUntilUtcTomorrow],
        [{ id: 71, bookingStatus: "confirmed" }],
      );
      getDb.mockResolvedValue(db);

      const r = await scanRecognitionDue(); // 不給 today → 走 LA 曆日預設

      expect(updateCalls).toHaveLength(0);
      // LA 口徑只 1 筆到期;UTC 口徑會誤判 2 筆。
      expect(r.dueForReview).toBe(1);
      expect(r.dueRows).toEqual([
        { id: 701, amount: 1000, bookingId: 71, expectedRecognitionDate: "2026-07-20" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 2g:DB 不可用 → throw(不再偽裝零筆);旗標關才回空 ────────────────────────────
describe("scanRecognitionDue — DB 不可用丟錯(2g)", () => {
  it("getDb 回 null(旗標開啟)→ throw,不靜默回全零(job 走 failed 告警)", async () => {
    getDb.mockResolvedValue(null); // PLAID flag 由 beforeEach 設為 on
    await expect(scanRecognitionDue({ today: "2026-07-20" })).rejects.toThrow(/database unavailable/i);
  });

  it("旗標全關 → 仍回空(旗標關不是錯誤,不 throw)——與『庫掛了』可區分", async () => {
    delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
    delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
    getDb.mockResolvedValue(null);
    const r = await scanRecognitionDue({ today: "2026-07-20" });
    expect(r.dueForReview).toBe(0);
    expect(r.scanned).toBe(0);
  });
});

// ── 2e:既有「到期會認列」行為改遷為「不認列 + 進待審」 ────────────────────────
describe("行為改遷:到期列不再自動認列,改列入待審(2e)", () => {
  it("舊路徑會寫 recognizedAt 的那一列,新路徑改成 dueRows、零寫入", async () => {
    const departed = {
      id: 301, amount: "2000.00", bookingId: 90,
      expectedRecognitionDate: "2026-06-30", recognizedAt: null, reversedAt: null,
    };
    const { db, updateCalls } = makeScanDb(
      [departed],
      [{ id: 90, bookingStatus: "confirmed" }],
    );
    getDb.mockResolvedValue(db);

    const r = await scanRecognitionDue({ today: "2026-07-20" });

    // 改遷斷言:過去這一列會被認列(update set recognizedAt);現在只進待審。
    expect(updateCalls).toHaveLength(0);
    expect(departed.recognizedAt).toBeNull();
    expect(r.dueForReview).toBe(1);
    expect(r.dueRows[0]).toMatchObject({ id: 301, bookingId: 90 });
  });
});
