/**
 * trustRecognitionWorker 整合測試 — B1.1(Codex 6.5 P1.2)。
 *
 * 跑「實際的」daily processor(processTrustRecognitionJob),讓它經過真實的
 * runTrustTransferDetection(機械閘 false → 強制 dry-run)+ scanRecognitionDue +
 * maybePostRecognitionDueCard 漏斗。旗標 ON + 有一列到期 → 斷言:
 *   - 全程零 UPDATE(零 recognizedAt 寫入、零 transferredAt 寫入);
 *   - 出一張 agentMessages 待審卡(trust-recognition);
 *   - dueForReview 計數正確、notifyOwner 待審摘要有發。
 *
 * bullmq / redis / notification / errorFunnel / db / 寫入閘全 mock,匯入 worker
 * 模組不會真的開 Redis 連線或建 Worker。processor 內全程 await(無 fire-and-forget
 * 的被斷言路徑),故不需 vi.waitFor。合成資料。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// bullmq:Worker/Queue/Job 全 no-op,匯入 worker 模組不建真 Worker、不連 Redis。
vi.mock("bullmq", () => ({
  Worker: class {
    on() {
      return this;
    }
  },
  Queue: class {
    on() {
      return this;
    }
    add() {}
  },
  Job: class {},
}));

// redis:worker 的 redisBullMQ + service 卡去重用的 redis。
const redisGet = vi.fn().mockResolvedValue(null);
const redisSet = vi.fn().mockResolvedValue("OK");
const redisDel = vi.fn().mockResolvedValue(1);
vi.mock("./redis", () => ({
  redisBullMQ: {},
  redis: {
    get: (...a: unknown[]) => redisGet(...a),
    set: (...a: unknown[]) => redisSet(...a),
    del: (...a: unknown[]) => redisDel(...a),
  },
}));

const notifyOwner = vi.fn().mockResolvedValue(undefined);
vi.mock("./_core/notification", () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }));

vi.mock("./_core/errorFunnel", () => ({
  wireWorkerFunnel: vi.fn(),
  reportFunnelError: vi.fn().mockResolvedValue(undefined),
}));

// 機械閘硬 false:轉帳偵測被強制 dry-run(不寫 transferredAt、不出催轉卡)。
vi.mock("./services/trustTransferWriteGate", () => ({ isTrustTransferWriteApproved: () => false }));

const getDb = vi.fn();
vi.mock("./db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));

import { processTrustRecognitionJob } from "./trustRecognitionWorker";

/** 順序 select 的 thenable(涵蓋 where/leftJoin/limit/orderBy)。 */
function chain(result: unknown) {
  const p = Promise.resolve(result);
  const o: any = { then: p.then.bind(p), catch: p.catch.bind(p) };
  o.where = () => o;
  o.leftJoin = () => o;
  o.limit = () => o;
  o.orderBy = () => o;
  return o;
}

/** 共用一個 select 計數器的假 db;捕捉 update(認列/轉出寫入)與 insert(卡)。 */
function makeDb(selectResults: unknown[]) {
  let i = 0;
  const updateCalls: any[] = [];
  const insertCalls: any[] = [];
  const db = {
    select: () => ({ from: () => chain(selectResults[i++]) }),
    update: (...a: unknown[]) => {
      updateCalls.push(a);
      return { set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) };
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
  process.env.PLAID_TRUST_DEFERRAL_ENABLED = "true";
  delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
});
afterEach(() => {
  if (ORIGINAL_PLAID === undefined) delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
  else process.env.PLAID_TRUST_DEFERRAL_ENABLED = ORIGINAL_PLAID;
  if (ORIGINAL_STRIPE === undefined) delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
  else process.env.STRIPE_TRUST_DEFERRAL_ENABLED = ORIGINAL_STRIPE;
});

describe("processTrustRecognitionJob — 旗標 ON + 到期列 → 零寫入 + 出待審卡", () => {
  it("實際漏斗:零 update(認列/轉出)、出一張 trust-recognition 待審卡、notifyOwner 有發", async () => {
    const dueRow = {
      id: 401,
      amount: "1500.00",
      bookingId: 41,
      // 遠古到期日:無論測試何時跑,LA 曆日都已過。
      expectedRecognitionDate: "2020-01-01",
      recognizedAt: null,
      reversedAt: null,
    };
    // select 順序:
    //  1) runTrustTransferDetection 的 eligibleRows → [] → 便宜早退(零轉出寫入)
    //  2) scanRecognitionDue candidates → [dueRow]
    //  3) scanRecognitionDue bookings → [confirmed]
    const { db, updateCalls, insertCalls } = makeDb([
      [],
      [dueRow],
      [{ id: 41, bookingStatus: "confirmed" }],
    ]);
    getDb.mockResolvedValue(db);

    const result = await processTrustRecognitionJob({
      id: "itest-1",
      data: { triggeredBy: "manual" },
    } as any);

    // 全程零認列/零轉出寫入。
    expect(updateCalls).toHaveLength(0);
    // 出一張待審卡(agentMessages),且是到期待審卡。
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].agentName).toBe("trust-recognition");
    expect(insertCalls[0].title).toContain("待審");
    expect(insertCalls[0].body).not.toContain("已認列");
    // 掃描結果與通知。
    expect(result.dueForReview).toBe(1);
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(String(notifyOwner.mock.calls[0][0].title)).toContain("到期待審");
  });
});
