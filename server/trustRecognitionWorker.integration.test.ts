/**
 * trustRecognitionWorker 整合測試 — B1.1(Codex 6.5 P1.2)。
 *
 * 跑「實際的」daily processor(processTrustRecognitionJob),讓它經過真實的
 * runTrustTransferDetection(產線機械閘 —— 未 mock,硬回 false → 強制 dry-run)+
 * scanRecognitionDue + maybePostRecognitionDueCard 漏斗。B1.2(Codex 6.6 P1)真閘真
 * 漏斗:餵「可成功配對」的測資(已認列遞延列 + Operating 白名單帳戶 + 同額近日轉帳),
 * 斷言 pairsFound>=1(偵測真的配到)但 transferredAt/recognizedAt UPDATE 皆為 0(閘鎖住
 * 回填)、仍出待審卡。另含 processor 層 !db → job reject → failed 告警路徑覆蓋(P1.3)。
 *
 * bullmq / redis / notification / errorFunnel / db 全 mock;但 trustTransferWriteGate
 * 不 mock(跑產線閘)。匯入 worker 模組不會真的開 Redis 連線或建 Worker。processor 內
 * 全程 await(無 fire-and-forget 的被斷言路徑),故不需 vi.waitFor。合成資料。
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

// B1.2(Codex 6.6 P1):不再 mock trustTransferWriteGate —— 直接跑產線機械閘(硬回
// false),證明「即使測資可成功配對,真閘仍把整條回填漏斗鎖成零寫入」。

const getDb = vi.fn();
vi.mock("./db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));

import {
  processTrustRecognitionJob,
  handleTrustRecognitionJobFailed,
} from "./trustRecognitionWorker";
import { isTrustTransferWriteApproved } from "./services/trustTransferWriteGate";
import { runTrustTransferDetection } from "./services/trustTransferDetection";

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

// 可成功配對的測資(參照 trustTransferDetection 的配對條件):
//  - 已認列(recognizedAt 非空)、未撤銷、未轉出的遞延列 → transfer-backfill eligible;
//  - Trust 帳戶(isTrustAccount=1)+ Operating 白名單帳戶(accountMask 2174,預設白名單);
//  - 同額($1500)近日的 Trust 流出(amount>0)+ Operating 流入(amount<0)→ 恰一對。
const TRUST_ACCT = 3001;
const OP_ACCT = 3002;
const eligibleRow = {
  id: 501,
  linkedAccountId: TRUST_ACCT,
  amount: "1500.00",
  recognizedAt: new Date("2020-01-01T00:00:00Z"), // 遠古認列 → 早於任何轉帳曆日
  reversedAt: null,
  transferredAt: null,
  recognitionRunId: null,
};
const accounts = [
  { id: TRUST_ACCT, accountMask: "9001", isTrustAccount: 1 },
  { id: OP_ACCT, accountMask: "2174", isTrustAccount: 0 }, // Operating 白名單預設 2174
];
const pairableTxns = [
  { id: 900, linkedAccountId: TRUST_ACCT, amount: "1500.00", date: "2026-07-10" }, // Trust 流出(正)
  { id: 901, linkedAccountId: OP_ACCT, amount: "-1500.00", date: "2026-07-10" }, // Operating 流入(負)
];

describe("真閘真漏斗:可配對測資 → pairsFound>=1 但零寫入(B1.2 Codex 6.6 P1)", () => {
  it("產線機械閘未被 mock:isTrustTransferWriteApproved() === false", () => {
    expect(isTrustTransferWriteApproved()).toBe(false);
  });

  it("偵測層:呼叫端要求寫(dryRun:false)但真閘強制 dry-run → pairsFound=1、backfills=1、backfilled=0、零 UPDATE", async () => {
    // select 順序:eligibleRows → accounts → bankTransactions。
    const { db, updateCalls } = makeDb([[eligibleRow], accounts, pairableTxns]);
    getDb.mockResolvedValue(db);

    const report = await runTrustTransferDetection({ dryRun: false });

    expect(report.pairsFound).toBeGreaterThanOrEqual(1); // 偵測真的配到一對(真漏斗)
    expect(report.backfills.length).toBe(1); // 且對回一個「本應自動回填」的候選
    expect(report.backfilled).toBe(0); // 但機械閘鎖住 → 零實際寫入
    expect(updateCalls).toHaveLength(0); // 零 transferredAt UPDATE
  });

  it("processor 全漏斗:偵測配到一對 + 掃到一列到期 → 零 recognizedAt/transferredAt UPDATE + 出待審卡", async () => {
    const dueRow = {
      id: 401,
      amount: "800.00",
      bookingId: 41,
      expectedRecognitionDate: "2020-01-01", // 遠古到期日:LA 曆日必已過
      recognizedAt: null,
      reversedAt: null,
    };
    // select 順序:偵測(eligibleRows, accounts, txns)→ 掃描(candidates, bookings)。
    const { db, updateCalls, insertCalls } = makeDb([
      [eligibleRow],
      accounts,
      pairableTxns,
      [dueRow],
      [{ id: 41, bookingStatus: "confirmed" }],
    ]);
    getDb.mockResolvedValue(db);

    const result = await processTrustRecognitionJob({
      id: "itest-pair",
      data: { triggeredBy: "manual" },
    } as any);

    // 全程零認列(recognizedAt)+ 零轉出(transferredAt)寫入 —— 真閘鎖住整條回填。
    expect(updateCalls).toHaveLength(0);
    // 只出一張到期待審卡(偵測 dry-run 不出催轉卡)。
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

// ── processor 層 !db → job reject → failed 告警路徑(B1.1 P1.3,B1.2 補齊)────────
describe("processTrustRecognitionJob — DB 不可用時 job reject(走 failed 告警)", () => {
  it("getDb 回 null(旗標開)→ scanRecognitionDue throw → processor reject", async () => {
    getDb.mockResolvedValue(null); // PLAID flag 由 beforeEach 設 on
    await expect(
      processTrustRecognitionJob({ id: "itest-nodb", data: { triggeredBy: "manual" } } as any),
    ).rejects.toThrow(/database unavailable/i);
  });
});

describe("handleTrustRecognitionJobFailed — failed listener 告警路徑有覆蓋", () => {
  it("job reject 後 → notifyOwner 發告警(title 含 failed、content 帶錯誤訊息)", async () => {
    await handleTrustRecognitionJobFailed(
      { id: "job-x" } as any,
      new Error("scanRecognitionDue: database unavailable"),
    );
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    const arg = notifyOwner.mock.calls[0][0] as any;
    expect(String(arg.title)).toContain("failed");
    expect(String(arg.content)).toContain("database unavailable");
  });

  it("notifyOwner 本身炸 → 不外拋(降級到 errorFunnel,不拖垮 failed handler)", async () => {
    notifyOwner.mockRejectedValueOnce(new Error("notify boom"));
    await expect(
      handleTrustRecognitionJobFailed(undefined, new Error("boom")),
    ).resolves.toBeUndefined();
  });
});
