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
import { readFileSync, readdirSync, statSync } from "node:fs";
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

// ── 2c:守門 —— 產線碼無自動認列寫入 ─────────────────────────────────────────
describe("mode 復活防護:產線碼零 recognizedAt 寫入(2c)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverDir = resolve(here, ".."); // server/services → server

  function walkTs(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walkTs(full, out);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
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

  it("server/**/*.ts(排除 *.test.ts)無 recognizedAt 寫入痕跡(字面量/raw SQL 賦值/.set 區塊)", () => {
    const files = walkTs(serverDir);
    // sanity:確實掃到了產線檔(避免 walk 壞掉導致假綠)。
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const lines = src.split("\n");
      lines.forEach((ln, idx) => {
        if (
          /recognizedAt:\s*new Date/.test(ln) ||
          /set\(\{\s*recognizedAt/.test(ln) ||
          // raw SQL 模板字串裡的 `recognizedAt = NOW()` 類賦值;負向斷言排除
          // `==`/`===` 比較(`(?!=)` 確保緊接的下一字元不是另一個 `=`)。
          /recognizedAt\s*=(?!=)/.test(ln)
        ) {
          offenders.push(`${f}:${idx + 1}: ${ln.trim()}`);
        }
      });
      for (const hit of scanSetBlocks(src)) {
        offenders.push(`${f}:${hit}`);
      }
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
