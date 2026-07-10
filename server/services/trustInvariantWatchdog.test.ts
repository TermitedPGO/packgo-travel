/**
 * trustInvariantWatchdog 測試 — F2 塊B(2026-07-10)。
 *
 * 不變式:Trust 餘額 vs 遞延帳(未認列 + 已認列未轉出)。覆蓋:
 *   - 等式口徑:哨兵列(linkedAccountId=0)與非 trust 帳列不入等式;
 *     recognizedAt 有無決定進哪一段。
 *   - 絕不 throw(observabilityCounters 合約):DB 炸 → kind:"error"。
 *   - $1 容差邊界與 ⚠ 行。
 *   - high 卡「同 drift 值持續期間去重」:同值不重發、回容差內清記憶、
 *     出卡失敗不外拋。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  gatherTrustInvariant,
  formatTrustInvariantLine,
  maybePostTrustDriftCard,
  TRUST_DRIFT_ALERT_KEY,
  type TrustInvariantReading,
} from "./trustInvariantWatchdog";

beforeEach(() => {
  vi.clearAllMocks();
  redisGet.mockResolvedValue(null);
});

/** 兩次順序 select(帳戶 → 遞延列)的假 db + insert 捕捉。 */
function makeDb(accounts: unknown[], deferralRows: unknown[]) {
  const selectResults = [accounts, deferralRows];
  let i = 0;
  const inserted: any[] = [];
  return {
    db: {
      select: () => ({ from: () => ({ where: () => Promise.resolve(selectResults[i++]) }) }),
      insert: () => ({
        values: (v: any) => {
          inserted.push(v);
          return Promise.resolve(undefined);
        },
      }),
    } as any,
    inserted,
  };
}

function reading(o: Partial<TrustInvariantReading> = {}): TrustInvariantReading {
  return {
    kind: "ok",
    balance: 4980,
    unrecognized: 15422,
    recognizedNotTransferred: 0,
    ledgerSum: 15422,
    drift: -10442,
    sentinelCount: 0,
    ...o,
  };
}

describe("gatherTrustInvariant — 等式口徑", () => {
  it("未認列 + 已認列未轉出分段加總;哨兵列(acct 0)與非 trust 帳列不入等式", async () => {
    const { db } = makeDb(
      [{ id: 10, currentBalance: "4980.00" }],
      [
        // 未認列(trust 帳)
        { amount: "8908.00", recognizedAt: null, linkedAccountId: 10 },
        { amount: "2916.00", recognizedAt: null, linkedAccountId: 10 },
        // 已認列未轉出(trust 帳)
        { amount: "500.00", recognizedAt: new Date("2026-07-01"), linkedAccountId: 10 },
        // 哨兵列(Stripe-direct)→ 只計數不入等式
        { amount: "999.00", recognizedAt: null, linkedAccountId: 0 },
        // 非 trust 非哨兵(理論殘留)→ 不入等式也不計哨兵
        { amount: "777.00", recognizedAt: null, linkedAccountId: 99 },
      ],
    );
    const r = await gatherTrustInvariant(db);
    expect(r.kind).toBe("ok");
    expect(r.balance).toBe(4980);
    expect(r.unrecognized).toBe(11824); // 8908 + 2916
    expect(r.recognizedNotTransferred).toBe(500);
    expect(r.ledgerSum).toBe(12324);
    expect(r.drift).toBeCloseTo(4980 - 12324, 2);
    expect(r.sentinelCount).toBe(1);
  });

  it("無 active trust 帳戶 → kind no-trust-account", async () => {
    const { db } = makeDb([], []);
    const r = await gatherTrustInvariant(db);
    expect(r.kind).toBe("no-trust-account");
  });

  it("絕不 throw:DB select 炸 → kind error", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.reject(new Error("TiDB exploded")),
        }),
      }),
    } as any;
    await expect(gatherTrustInvariant(db)).resolves.toMatchObject({ kind: "error" });
  });
});

describe("formatTrustInvariantLine — $1 容差邊界", () => {
  it("|drift| <= $1 → 無 ⚠;> $1 → ⚠ 前綴", () => {
    expect(
      formatTrustInvariantLine(reading({ drift: 1.0, balance: 100, ledgerSum: 99 })),
    ).not.toContain("⚠");
    expect(
      formatTrustInvariantLine(reading({ drift: -1.01, balance: 100, ledgerSum: 101.01 })),
    ).toContain("⚠");
  });

  it("error / no-trust-account 各有明確一行,不假裝健康", () => {
    expect(formatTrustInvariantLine(reading({ kind: "error" }))).toContain("讀取失敗");
    expect(formatTrustInvariantLine(reading({ kind: "no-trust-account" }))).toContain(
      "無 active trust 帳戶",
    );
  });

  it("哨兵列非零時行內註明", () => {
    expect(formatTrustInvariantLine(reading({ sentinelCount: 2 }))).toContain("2 筆 Stripe-direct");
  });
});

describe("maybePostTrustDriftCard — high 卡與同值去重", () => {
  it("漂移超容差且無去重記憶 → 出 high 卡(方向文案+指向駕駛艙/F3 驗收紀錄),寫 Redis", async () => {
    const { db, inserted } = makeDb([], []);
    const posted = await maybePostTrustDriftCard(db, reading({ drift: -10442.33 }));
    expect(posted).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].priority).toBe("high");
    expect(inserted[0].agentName).toBe("trust-watchdog");
    expect(inserted[0].title).toContain("漂移");
    expect(inserted[0].body).toContain("f3-acceptance-20260710.md");
    expect(inserted[0].body).toContain("駕駛艙");
    expect(inserted[0].body).toContain("低於"); // 負向方向感知文案
    expect(redisSet).toHaveBeenCalledWith(TRUST_DRIFT_ALERT_KEY, "-10442.33");
  });

  it("同 drift 值已提醒過 → 不重發(Jeff 已知事實不轟炸)", async () => {
    redisGet.mockResolvedValue("-10442.33");
    const { db, inserted } = makeDb([], []);
    const posted = await maybePostTrustDriftCard(db, reading({ drift: -10442.33 }));
    expect(posted).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("drift 值變化 → 再出卡(去重是同值期間,不是永遠)", async () => {
    redisGet.mockResolvedValue("-10442.33");
    const { db, inserted } = makeDb([], []);
    const posted = await maybePostTrustDriftCard(db, reading({ drift: -9000.0 }));
    expect(posted).toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it("回到容差內 → 清去重記憶、不出卡(未來同值再漂移要重新叫)", async () => {
    const { db, inserted } = makeDb([], []);
    const posted = await maybePostTrustDriftCard(db, reading({ drift: 0.5 }));
    expect(posted).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(redisDel).toHaveBeenCalledWith(TRUST_DRIFT_ALERT_KEY);
  });

  it("kind 非 ok → 不出卡;insert 炸 → 不外拋(絕不拖垮週稽核)", async () => {
    const { db } = makeDb([], []);
    expect(await maybePostTrustDriftCard(db, reading({ kind: "error" }))).toBe(false);

    const throwingDb = {
      insert: () => ({
        values: () => Promise.reject(new Error("insert blew up")),
      }),
    } as any;
    await expect(
      maybePostTrustDriftCard(throwingDb, reading({ drift: -5000 })),
    ).resolves.toBe(false);
  });
});
