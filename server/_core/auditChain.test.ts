/**
 * audit-chain-repair 承重測試(design.md 測試七組)。
 *
 * 背景:2026-07-19 prod 唯讀查核證實鏈自 migration 0073 起天生驗不過 ——
 * hash 用毫秒級 Date、TIMESTAMP(0) 存儲丟失毫秒(四捨五入非截斷),重讀重算必不合(285/286 列
 * row-modified),另有 update 失敗孤列(630001)與其引發的 GENESIS 回退鏈斷
 * (660001)。本檔釘住四個修復面:D1 秒級正規化、D2 tip 跳 null、D3 update
 * 重試、D4 epoch 重錨語意、D5 一次性錨定。全 mock db,零真 DB。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("../redis", () => ({
  redis: {
    set: vi.fn().mockResolvedValue("OK"),
    eval: vi.fn().mockResolvedValue(1),
  },
}));

// ── 真 predicate 求值(沿用 clientBoot.test.ts 的 MySqlDialect 渲染模式)──
// 讓 isNotNull / eq 條件承重:拿掉 production 的 isNotNull(rowHash) 突變會紅,
// 而不是 mock 忽略條件照樣綠。沒教過的條件直接 throw(fail-closed)。
const dialect = new MySqlDialect();
type StoreRow = { id: number; action: string; rowHash: string | null };
function matchesPredicate(pred: SQL, row: StoreRow): boolean {
  const { sql, params } = dialect.sqlToQuery(pred);
  let text = sql.trim();
  if (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1);
  let pi = 0;
  for (const raw of text.split(/ and /i)) {
    const cond = raw.trim();
    const m = cond.match(/^`adminAuditLog`\.`(\w+)`\s+(is not null|=)\s*(\?)?$/i);
    if (!m) throw new Error(`predicate 條件無法評估(測試需擴充): ${cond}`);
    const col = m[1] as keyof StoreRow;
    const op = m[2].toLowerCase();
    const val = row[col];
    if (op === "is not null") {
      if (val === null || val === undefined) return false;
      continue;
    }
    const param = params[pi++];
    if (String(val) !== String(param)) return false;
  }
  return true;
}

import {
  audit,
  systemAudit,
  verifyAuditChain,
  ensureAuditChainEpoch,
  canonicalAuditRow,
  computeRowHash,
  AUDIT_CHAIN_EPOCH_ACTION,
  SYSTEM_ACTOR_USER_ID,
} from "./auditLog";

beforeEach(() => vi.clearAllMocks());


// R9-2 後所有走鏈式寫的假 db 都要有 transaction(DB advisory lock 層);
// 預設:GET_LOCK 成功、其他 tx.execute 空回。
function passthroughTx() {
  return async <R,>(f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<R>) =>
    f({
      execute: async (q: unknown) => {
        const text = String((q as { queryChunks?: unknown[] })?.queryChunks?.map?.((c: unknown) => (c as { value?: string[] })?.value ?? "").join("") ?? q);
        if (/GET_LOCK/i.test(text)) return [[{ l: 1 }]];
        if (/RELEASE_LOCK/i.test(text)) return [[{ r: 1 }]];
        return [[{}]];
      },
    });
}
// ── 假 db 工廠(writeAuditRow / ensure 路徑):store + 真 predicate 過濾 ──
// select().from().where(pred) 對 in-memory store 逐列以 MySqlDialect 求值;
// .orderBy(desc)…limit(1) = id 最大者;.limit(1) = 過濾後第一列(存在性查詢)。
function makeWriteDb(opts: {
  insertId?: number;
  store?: StoreRow[];
  updateFailTimes?: number;
  insertFails?: boolean;
  onInsert?: (row: Record<string, unknown>, insertId: number) => void;
} = {}) {
  const store: StoreRow[] = opts.store ?? [{ id: 1, action: "tour.update", rowHash: "PREVHASH" }];
  let idCounter = opts.insertId ?? 42; // 每次 insert 遞增(模擬 auto-increment)
  let lastInsertId = 0;
  const insertValues = opts.insertFails
    ? vi.fn().mockRejectedValue(new Error("insert blew up"))
    : vi.fn().mockImplementation((row: Record<string, unknown>) => {
        lastInsertId = idCounter++;
        opts.onInsert?.(row, lastInsertId);
        return Promise.resolve([{ insertId: lastInsertId }]);
      });
  let updateFails = opts.updateFailTimes ?? 0;
  const updateWhere = vi.fn().mockImplementation(() => {
    if (updateFails > 0) {
      updateFails--;
      return Promise.reject(new Error("update blew up"));
    }
    // Codex R5-3:套用 production 實際的 .set() payload(不得硬塞假值)——
    // 若 production 把 rowHash 從 .set() 拿掉,store 列就不會有 hash,
    // 「hash 持久化承重」測試會紅。
    const payload = updateSet.mock.calls.at(-1)?.[0] ?? {};
    const target = store.find((r) => r.id === lastInsertId);
    if (target) {
      if ("rowHash" in payload) target.rowHash = payload.rowHash;
      if ("previousHash" in payload) (target as StoreRow & { previousHash?: string }).previousHash = payload.previousHash;
    }
    return Promise.resolve(undefined);
  });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const tipWhere = vi.fn();
  const db = {
    select: () => ({
      from: () => ({
        where: (pred: SQL) => {
          tipWhere(pred);
          const filtered = store.filter((r) => matchesPredicate(pred, r));
          return {
            orderBy: () => ({
              limit: (n: number) => Promise.resolve([...filtered].sort((a, b) => b.id - a.id).slice(0, n)),
            }),
            limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          };
        },
        orderBy: () => ({
          limit: (n: number) => Promise.resolve([...store].sort((a, b) => b.id - a.id).slice(0, n)),
        }),
      }),
    }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
    transaction: passthroughTx(),
  };
  return { db, store, insertValues, updateSet, updateWhere, tipWhere };
}

// ── 造合法列鏈(用真 canonical/computeRowHash)──
type RowData = Parameters<typeof canonicalAuditRow>[0];
function makeRowData(id: number, over: Partial<RowData> = {}): RowData {
  return {
    id,
    userId: 1,
    userEmail: "jeff@packgoplay.com",
    userRole: "admin",
    action: "tour.update",
    targetType: null,
    targetId: null,
    changes: null,
    reason: null,
    ipAddress: null,
    userAgent: null,
    success: 1,
    errorMessage: null,
    createdAt: new Date("2026-07-19T00:00:00.000Z"),
    ...over,
  };
}
function chainRow(data: RowData, previousHash: string) {
  const rowHash = computeRowHash(previousHash, canonicalAuditRow(data));
  return { ...data, previousHash, rowHash };
}
function verifyDbWith(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({ orderBy: () => Promise.resolve(rows) }),
    }),
  };
}

describe("D1 canonical 秒級正規化", () => {
  it("毫秒級 Date 與 DB 重讀(ms=000)canonical 相同 → hash round-trip", () => {
    const withMs = makeRowData(1, { createdAt: new Date("2026-07-19T12:34:56.789Z") });
    const dbRead = makeRowData(1, { createdAt: new Date("2026-07-19T12:34:56.000Z") });
    expect(canonicalAuditRow(withMs)).toBe(canonicalAuditRow(dbRead));
    expect(computeRowHash("GENESIS", canonicalAuditRow(withMs))).toBe(
      computeRowHash("GENESIS", canonicalAuditRow(dbRead)),
    );
  });
  it("敏感度不損:差一秒 → 不同 hash", () => {
    const a = makeRowData(1, { createdAt: new Date("2026-07-19T12:34:56.000Z") });
    const b = makeRowData(1, { createdAt: new Date("2026-07-19T12:34:57.000Z") });
    expect(computeRowHash("GENESIS", canonicalAuditRow(a))).not.toBe(
      computeRowHash("GENESIS", canonicalAuditRow(b)),
    );
  });
  it("audit() 寫入的 createdAt 毫秒為 0(存的值與 hash 的值同源)", async () => {
    const { db, insertValues } = makeWriteDb();
    getDb.mockResolvedValue(db);
    await audit({
      ctx: { user: { id: 1, email: "jeff@packgoplay.com", role: "admin" } },
      action: "tour.update",
    });
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect((insertValues.mock.calls[0][0].createdAt as Date).getMilliseconds()).toBe(0);
  });
  it("systemAudit() 寫入的 createdAt 毫秒為 0", async () => {
    const { db, insertValues } = makeWriteDb();
    getDb.mockResolvedValue(db);
    await systemAudit("system:test", "test.action", null);
    expect((insertValues.mock.calls[0][0].createdAt as Date).getMilliseconds()).toBe(0);
  });
});

describe("D2 tip 跳過 null rowHash(孤列不再拉回 GENESIS)", () => {
  it("表尾是孤列(rowHash null)→ previousHash 用最後一個非 null hash(真 predicate 求值)", async () => {
    // store 尾列是孤列;isNotNull 過濾後 desc 取到 LASTGOODHASH。
    // 拿掉 production tip 的 isNotNull → 取到孤列 null → ?? GENESIS → 本斷言紅。
    const { db, updateSet, tipWhere } = makeWriteDb({
      store: [
        { id: 1, action: "a", rowHash: "OLDHASH" },
        { id: 2, action: "b", rowHash: "LASTGOODHASH" },
        { id: 3, action: "c", rowHash: null }, // 孤列(prod 630001 型)
      ],
    });
    getDb.mockResolvedValue(db);
    await systemAudit("system:test", "test.action", null);
    expect(tipWhere).toHaveBeenCalledTimes(1);
    expect(updateSet.mock.calls[0][0].previousHash).toBe("LASTGOODHASH");
  });
  it("全表無 hash 列(過濾後空)→ previousHash=GENESIS", async () => {
    const { db, updateSet } = makeWriteDb({ store: [{ id: 1, action: "a", rowHash: null }] });
    getDb.mockResolvedValue(db);
    await systemAudit("system:test", "test.action", null);
    expect(updateSet.mock.calls[0][0].previousHash).toBe("GENESIS");
  });
});

describe("R5-3 hash 持久化承重(update payload 必須真的寫 rowHash)", () => {
  it("寫入成功後,store 列 rowHash 等於以 INSERT payload 重算的 hash", async () => {
    const store: StoreRow[] = [{ id: 1, action: "a", rowHash: "PREVHASH" }];
    const { db, insertValues } = makeWriteDb({
      insertId: 42, store,
      onInsert: (row, id) => store.push({ id, action: String(row.action), rowHash: null }),
    });
    getDb.mockResolvedValue(db);
    await systemAudit("system:test", "test.action", null, { amount: 1 });
    const inserted = insertValues.mock.calls[0][0];
    const expected = computeRowHash("PREVHASH", canonicalAuditRow({ id: 42, ...inserted }));
    const persisted = store.find((r) => r.id === 42);
    // production .set() 若拿掉 rowHash(或塞錯值),此斷言紅
    expect(persisted?.rowHash).toBe(expected);
  });
});

describe("R5-2 鎖不可得:不進 critical section,改插無鏈孤列", () => {
  it("redis 五次搶鎖全失敗 → 不讀 tip、不 update,仍 insert 一列(稽核列不丟)", async () => {
    const { redis } = await import("../redis");
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue(null); // 鎖永遠拿不到
    const { db, insertValues, updateSet, tipWhere } = makeWriteDb();
    getDb.mockResolvedValue(db);
    await systemAudit("system:test", "test.action", null);
    expect((redis.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(5); // 五次重試(帶等待)
    expect(tipWhere).not.toHaveBeenCalled(); // 沒讀 tip(避免 Y 叉)
    expect(updateSet).not.toHaveBeenCalled(); // 沒算 hash
    expect(insertValues).toHaveBeenCalledTimes(1); // 列仍寫入(孤列,verifier 標)
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue("OK");
  });
});

describe("R8-2 app writer DB advisory lock(與 grant-admin 同鎖域)", () => {
  function makeTxDb(opts: { lockResult?: number; releaseResult?: number; releaseThrows?: boolean } = {}) {
    const base = makeWriteDb();
    const txCalls: string[] = [];
    const db = {
      ...base.db,
      transaction: async <R,>(f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<R>) =>
        f({
          execute: async (q: unknown) => {
            const text = String((q as { queryChunks?: unknown[] })?.queryChunks?.map?.((c: unknown) => (c as { value?: string[] })?.value ?? "").join("") ?? q);
            txCalls.push(text);
            if (/GET_LOCK/i.test(text)) return [[{ l: opts.lockResult ?? 1 }]];
            if (/RELEASE_LOCK/i.test(text)) {
              if (opts.releaseThrows) throw new Error("release blew up");
              return [[{ r: opts.releaseResult ?? 1 }]];
            }
            if (/KILL CONNECTION_ID/i.test(text)) return [[{}]];
            return [[{}]];
          },
        }),
    };
    return { ...base, db, txCalls };
  }
  it("鎖序:GET_LOCK 在 tip 讀之前、RELEASE_LOCK 在 hash update 之後(同一 tx session)", async () => {
    const made = makeTxDb();
    getDb.mockResolvedValue(made.db);
    await systemAudit("system:test", "test.action", null);
    expect(made.txCalls.some((t) => /GET_LOCK\('audit:tip:lock', 3\)/.test(t))).toBe(true);
    expect(made.txCalls.some((t) => /RELEASE_LOCK\('audit:tip:lock'\)/.test(t))).toBe(true);
    // GET_LOCK 先於 tip 讀(tipWhere),RELEASE 後於 hash update(updateWhere)
    expect(made.tipWhere).toHaveBeenCalledTimes(1);
    expect(made.updateWhere).toHaveBeenCalledTimes(1);
    const getIdx = made.txCalls.findIndex((t) => /GET_LOCK/.test(t));
    const relIdx = made.txCalls.findIndex((t) => /RELEASE_LOCK/.test(t));
    expect(getIdx).toBeLessThan(relIdx);
  });
  it("DB 鎖等 3s 未得(l=0)→ 不進 critical section,插無鏈孤列", async () => {
    const made = makeTxDb({ lockResult: 0 });
    getDb.mockResolvedValue(made.db);
    await systemAudit("system:test", "test.action", null);
    expect(made.tipWhere).not.toHaveBeenCalled(); // 沒讀 tip
    expect(made.updateSet).not.toHaveBeenCalled(); // 沒算 hash
    expect(made.insertValues).toHaveBeenCalledTimes(1); // 孤列仍寫入
  });
  it("R9-2:鎖層錯誤(BEGIN/GET_LOCK throw)→ fail-closed 拒絕鏈式寫,插無鏈孤列(絕不裸鎖重跑)", async () => {
    const base = makeWriteDb();
    let fnLayerRuns = 0;
    const db = {
      ...base.db,
      select: () => {
        fnLayerRuns++; // 鏈式寫的第一步是 tip select:被跑到就代表 fn 有執行
        return (base.db as unknown as { select: () => unknown }).select() as never;
      },
      transaction: async () => {
        throw new Error("GET_LOCK unsupported");
      },
    };
    getDb.mockResolvedValue(db);
    await systemAudit("system:test", "test.action", null);
    expect(fnLayerRuns).toBe(0); // 受保護 fn 一次都沒跑(不裸鎖重跑)
    expect(base.updateSet).not.toHaveBeenCalled(); // 沒算 hash
    expect(base.insertValues).toHaveBeenCalledTimes(1); // 孤列仍寫入,fail-visible
  });
  it("R9-2:transaction 缺失 → 同樣 fail-closed 走無鏈孤列", async () => {
    const base = makeWriteDb();
    const db = { ...base.db } as Record<string, unknown>;
    delete db.transaction;
    getDb.mockResolvedValue(db);
    await systemAudit("system:test", "test.action", null);
    expect(base.updateSet).not.toHaveBeenCalled();
    expect(base.insertValues).toHaveBeenCalledTimes(1);
  });
  it("R9-2:fn 完成後 COMMIT 才炸 → 回結果、fn 只跑一次(不重跑)", async () => {
    const base = makeWriteDb();
    let fnEntered = 0;
    const db = {
      ...base.db,
      select: () => {
        fnEntered++;
        return (base.db as unknown as { select: () => unknown }).select() as never;
      },
      transaction: async (f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>) => {
        await f({ execute: async (q: unknown) => { const t = String((q as { queryChunks?: unknown[] })?.queryChunks?.map?.((c: unknown) => (c as { value?: string[] })?.value ?? "").join("") ?? q); if (/GET_LOCK/i.test(t)) return [[{ l: 1 }]]; if (/RELEASE_LOCK/i.test(t)) return [[{ r: 1 }]]; return [[{}]]; } });
        throw new Error("commit blew up"); // fn 成功後 COMMIT 層才炸
      },
    };
    getDb.mockResolvedValue(db);
    await systemAudit("system:test", "test.action", null);
    expect(fnEntered).toBe(1); // 只跑一次
    expect(base.insertValues).toHaveBeenCalledTimes(1); // 寫入已落地(pool 上)
    expect(base.updateSet).toHaveBeenCalledTimes(1); // 鏈上了,結果被保留
  });
  it("R9-2:fn 自己 throw → 原樣上拋(strict caller 看得到),絕不重跑", async () => {
    const { systemAuditStrict } = await import("./auditLog");
    const base = makeWriteDb({ insertFails: true });
    let fnEntered = 0;
    const db = {
      ...base.db,
      select: () => {
        fnEntered++;
        return (base.db as unknown as { select: () => unknown }).select() as never;
      },
      transaction: async (f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>) =>
        f({ execute: async (q: unknown) => { const t = String((q as { queryChunks?: unknown[] })?.queryChunks?.map?.((c: unknown) => (c as { value?: string[] })?.value ?? "").join("") ?? q); if (/GET_LOCK/i.test(t)) return [[{ l: 1 }]]; if (/RELEASE_LOCK/i.test(t)) return [[{ r: 1 }]]; return [[{}]]; } }),
    };
    getDb.mockResolvedValue(db);
    await expect(systemAuditStrict("system:test", "test.action", null)).rejects.toThrow("insert blew up");
    expect(fnEntered).toBe(1); // fn 至多一次
  });
});

describe("R9-2 production app writer + grant 共用 deferred 鎖後端(真等待)", () => {
  it("app 於 grant 持鎖期間嘗試進場並等待;grant 釋放後 app 才寫;最終 verifyAuditChain 全綠無 Y 叉", async () => {
    const { writeChainedAuditRow } = await import("../../scripts/grant-admin.mjs");
    // ── 共享 advisory lock(deferred:被持有時 acquire 回 pending promise)──
    let held = false;
    let waitersPeak = 0;
    const waiters: Array<() => void> = [];
    const acquire = (): Promise<void> => {
      if (!held) {
        held = true;
        return Promise.resolve();
      }
      waitersPeak = Math.max(waitersPeak, waiters.length + 1);
      return new Promise<void>((res) => waiters.push(() => { held = true; res(); }));
    };
    const release = () => {
      held = false;
      waiters.shift()?.();
    };
    // ── 共享 store(完整列,可供 verifier 重算)──
    type FullRow = ReturnType<typeof makeRowData> & { previousHash: string | null; rowHash: string | null };
    const store: FullRow[] = [];
    let nextId = 101;
    const tipHash = () => [...store].filter((r) => r.rowHash).sort((a, b) => b.id - a.id)[0]?.rowHash ?? null;
    const events: string[] = [];
    let appPromise: Promise<void> | null = null;

    // ── app 側:真 systemAudit,db 的 transaction GET_LOCK 走共享鎖 ──
    const appDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve(tipHash() ? [{ rowHash: tipHash() }] : []) }),
            limit: () => Promise.resolve([]),
          }),
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          const id = nextId++;
          store.push({ ...(row as ReturnType<typeof makeRowData>), id, previousHash: null, rowHash: null });
          events.push(`app:insert:${id}`);
          return Promise.resolve([{ insertId: id }]);
        },
      }),
      update: () => ({
        set: (payload: { previousHash: string; rowHash: string }) => ({
          where: () => {
            const target = store[store.length - 1];
            target.previousHash = payload.previousHash;
            target.rowHash = payload.rowHash;
            events.push(`app:hash:${target.id}`);
            return Promise.resolve(undefined);
          },
        }),
      }),
      transaction: async (f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>) =>
        f({
          execute: async (q: unknown) => {
            const text = String((q as { queryChunks?: unknown[] })?.queryChunks?.map?.((c: unknown) => (c as { value?: string[] })?.value ?? "").join("") ?? q);
            if (/GET_LOCK/i.test(text)) {
              events.push("app:lock-attempt");
              await acquire();
              events.push("app:lock-acquired");
              return [[{ l: 1 }]];
            }
            if (/RELEASE_LOCK/i.test(text)) {
              release();
              return [[{ r: 1 }]];
            }
            return [[{}]];
          },
        }),
    };
    getDb.mockResolvedValue(appDb);

    // ── grant 側 conn:同一共享鎖 + 同一 store;INSERT 當下(仍持鎖)啟動 app ──
    const conn = {
      execute: async (sqlText: string, params: unknown[] = []) => {
        if (/GET_LOCK/i.test(sqlText)) {
          await acquire();
          events.push("grant:lock-acquired");
          return [[{ l: 1 }]];
        }
        if (/RELEASE_LOCK/i.test(sqlText)) {
          events.push("grant:release");
          release();
          return [[{ r: 1 }]];
        }
        if (/^SELECT COUNT\(\*\) AS n FROM adminAuditLog WHERE previousHash/i.test(sqlText)) {
          const n = store.filter((r) => r.previousHash === params[0] && r.id !== params[1]).length;
          return [[{ n }]];
        }
        if (/^SELECT rowHash FROM adminAuditLog WHERE id </i.test(sqlText)) {
          const prior = [...store].filter((r) => r.id < (params[0] as number) && r.rowHash).sort((a, b) => b.id - a.id)[0];
          return [prior ? [{ rowHash: prior.rowHash }] : []];
        }
        if (/^SELECT rowHash FROM adminAuditLog/i.test(sqlText)) {
          return [tipHash() ? [{ rowHash: tipHash() }] : []];
        }
        if (/^INSERT INTO adminAuditLog/i.test(sqlText)) {
          const id = nextId++;
          store.push({
            userId: params[0], userEmail: params[1], userRole: params[2], action: params[3],
            targetType: params[4], targetId: params[5], changes: params[6], reason: params[7],
            ipAddress: params[8], userAgent: params[9], success: params[10], errorMessage: params[11],
            createdAt: params[12], id, previousHash: null, rowHash: null,
          } as FullRow);
          events.push(`grant:insert:${id}`);
          // 仍持鎖:此刻啟動 production app writer → 它必須嘗試進場並「等待」
          appPromise = systemAudit("system:test", "test.concurrent", null, { n: 1 });
          await new Promise((r) => setTimeout(r, 30)); // 讓 app 走到 lock-attempt
          return [{ insertId: id }];
        }
        if (/^UPDATE adminAuditLog SET previousHash/i.test(sqlText)) {
          const row = store.find((r) => r.id === params[2]);
          if (row) {
            row.previousHash = params[0] as string;
            row.rowHash = params[1] as string;
          }
          events.push(`grant:hash:${params[2]}`);
          return [{}];
        }
        throw new Error(`unexpected sql: ${sqlText}`);
      },
    };

    const r = await writeChainedAuditRow(conn, {
      userId: 5, userEmail: "support@packgoplay.com", userRole: "admin",
      action: "manual_role_grant", targetType: "user", targetId: "5",
      changes: null, reason: null, ipAddress: null, userAgent: null, success: 1,
    });
    expect(appPromise).not.toBeNull();
    await appPromise;

    // app 在 grant 持鎖期間嘗試過(lock-attempt 在 grant:release 之前)且真的等待
    // (lock-acquired 在 grant:release 之後);waitersPeak 證明有人在鎖上排隊過。
    expect(events.indexOf("app:lock-attempt")).toBeGreaterThan(-1);
    expect(events.indexOf("app:lock-attempt")).toBeLessThan(events.indexOf("grant:release"));
    expect(events.indexOf("app:lock-acquired")).toBeGreaterThan(events.indexOf("grant:release"));
    expect(waitersPeak).toBeGreaterThan(0);
    expect(r.hashed).toBe(true);
    expect(r.forked).toBe(false);
    // 最終完整 verifier:兩列(grant→app)線性,ok 綠
    const sorted = [...store].sort((a, b) => a.id - b.id);
    getDb.mockResolvedValue(verifyDbWith(sorted));
    const v = await verifyAuditChain();
    expect(v.ok).toBe(true);
    expect(v.hashedRows).toBe(2);
    expect(v.anomalies).toEqual([]);
  });
});

describe("R10-2 RELEASE_LOCK fail-closed(污染 session 不得回 pool)", () => {
  function makeTxDbR10(opts: { releaseResult?: number; releaseThrows?: boolean } = {}) {
    const base = makeWriteDb();
    const txCalls: string[] = [];
    const db = {
      ...base.db,
      transaction: async <R,>(f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<R>) =>
        f({
          execute: async (q: unknown) => {
            const text = String((q as { queryChunks?: unknown[] })?.queryChunks?.map?.((c: unknown) => (c as { value?: string[] })?.value ?? "").join("") ?? q);
            txCalls.push(text);
            if (/GET_LOCK/i.test(text)) return [[{ l: 1 }]];
            if (/RELEASE_LOCK/i.test(text)) {
              if (opts.releaseThrows) throw new Error("release blew up");
              return [[{ r: opts.releaseResult ?? 1 }]];
            }
            if (/KILL CONNECTION_ID/i.test(text)) return [[{}]];
            return [[{}]];
          },
        }),
    };
    return { ...base, db, txCalls };
  }
  it("release 回 0 → KILL CONNECTION_ID 隔離污染 session;寫入結果保留", async () => {
    const made = makeTxDbR10({ releaseResult: 0 });
    getDb.mockResolvedValue(made.db);
    await systemAudit("system:test", "test.action", null);
    expect(made.txCalls.some((t) => /KILL CONNECTION_ID/i.test(t))).toBe(true);
    expect(made.updateSet).toHaveBeenCalledTimes(1); // 鏈式寫本身成功保留
  });
  it("release throw → KILL 隔離", async () => {
    const made = makeTxDbR10({ releaseThrows: true });
    getDb.mockResolvedValue(made.db);
    await systemAudit("system:test", "test.action", null);
    expect(made.txCalls.some((t) => /KILL CONNECTION_ID/i.test(t))).toBe(true);
  });
  it("release 正常回 1 → 不 KILL", async () => {
    const made = makeTxDbR10();
    getDb.mockResolvedValue(made.db);
    await systemAudit("system:test", "test.action", null);
    expect(made.txCalls.some((t) => /KILL CONNECTION_ID/i.test(t))).toBe(false);
  });
});

describe("R6-2 真雙 writer 競爭(NX 序列化)", () => {
  it("兩個併發 systemAudit:鎖序列化 → 兩列都鏈上(無 Y 叉,previousHash 各不同)", async () => {
    const { redis } = await import("../redis");
    // 真 NX 語意:鎖被持有時 set 回 null;eval 釋放。
    let held = false;
    (redis.set as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (held) return null;
      held = true;
      return "OK";
    });
    (redis.eval as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      held = false;
      return 1;
    });
    const store: StoreRow[] = [{ id: 1, action: "seed", rowHash: "SEED" }];
    const { db, updateSet } = makeWriteDb({
      insertId: 10, store,
      onInsert: (row, id) => store.push({ id, action: String(row.action), rowHash: null }),
    });
    getDb.mockResolvedValue(db);
    await Promise.all([
      systemAudit("system:a", "test.a", null),
      systemAudit("system:b", "test.b", null),
    ]);
    // 兩次寫入,previousHash 必須不同(第二筆鏈上第一筆的 hash,不是 Y 叉同鏈頭)
    const prevs = updateSet.mock.calls.map((c) => c[0].previousHash);
    expect(prevs).toHaveLength(2);
    expect(new Set(prevs).size).toBe(2);
    // 還原預設 mock
    (redis.set as ReturnType<typeof vi.fn>).mockResolvedValue("OK");
    (redis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });
});

describe("D3 hash UPDATE 失敗重試", () => {
  it("第一次失敗、重試成功 → update 跑兩次,不 throw", async () => {
    const { db, updateWhere } = makeWriteDb({ updateFailTimes: 1 });
    getDb.mockResolvedValue(db);
    await expect(systemAudit("system:test", "test.action", null)).resolves.toBeUndefined();
    expect(updateWhere).toHaveBeenCalledTimes(2);
  });
  it("連續兩次失敗 → 留孤列(insert 已成功)、resolve 不 throw", async () => {
    const { db, insertValues, updateWhere } = makeWriteDb({ updateFailTimes: 2 });
    getDb.mockResolvedValue(db);
    await expect(systemAudit("system:test", "test.action", null)).resolves.toBeUndefined();
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(updateWhere).toHaveBeenCalledTimes(2);
  });
});

describe("D4 verify epoch 語意", () => {
  // legacy 破列:hash 隨便塞(模擬毫秒時代驗不過的列)
  const legacy1 = { ...makeRowData(10), previousHash: "GENESIS", rowHash: "brokenhash-a" };
  const legacy2 = { ...makeRowData(11), previousHash: "brokenhash-a", rowHash: "brokenhash-b" };
  // epoch 列:修復後口徑寫,back-pointer 指 legacy 尾列 stored hash,自身 hash 正確
  const epochData = makeRowData(20, {
    userId: SYSTEM_ACTOR_USER_ID,
    userEmail: "system:auditChain",
    userRole: "system",
    action: AUDIT_CHAIN_EPOCH_ACTION,
  });
  const epoch = chainRow(epochData, "brokenhash-b");
  const post1 = chainRow(makeRowData(21), epoch.rowHash);
  const post2 = chainRow(makeRowData(22), post1.rowHash);

  it("無 epoch 列 → 舊行為:破列全表走查 ok=false", async () => {
    getDb.mockResolvedValue(verifyDbWith([legacy1, legacy2]));
    const r = await verifyAuditChain();
    expect(r.ok).toBe(false);
    expect(r.epochStartId).toBeNull();
    expect(r.legacyRows).toBe(0);
  });
  it("有 epoch → pre-epoch 全 legacy 不掀 ok;epoch 起全綠 → ok=true", async () => {
    getDb.mockResolvedValue(verifyDbWith([legacy1, legacy2, epoch, post1, post2]));
    const r = await verifyAuditChain();
    expect(r.ok).toBe(true);
    expect(r.epochStartId).toBe(20);
    expect(r.legacyRows).toBe(2);
    expect(r.hashedRows).toBe(3); // epoch + post1 + post2
    expect(r.anomalies).toEqual([]);
  });
  it("epoch 後竄改(row-modified)→ ok=false(真訊號)", async () => {
    const tampered = { ...post1, changes: '{"amount":999}' }; // 內容改了,hash 沒改
    getDb.mockResolvedValue(verifyDbWith([legacy1, epoch, tampered, post2]));
    const r = await verifyAuditChain();
    expect(r.ok).toBe(false);
    expect(r.anomalies.some((a) => a.kind === "row-modified" && a.rowId === 21)).toBe(true);
  });
  it("epoch 後孤列(missing-hash)→ ok=false,且後續列鏈自最後好 hash 仍綠", async () => {
    const orphan = { ...makeRowData(21), previousHash: null, rowHash: null };
    const after = chainRow(makeRowData(22), epoch.rowHash); // D2:鏈自最後非 null hash
    getDb.mockResolvedValue(verifyDbWith([epoch, orphan, after]));
    const r = await verifyAuditChain();
    expect(r.ok).toBe(false);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]).toMatchObject({ kind: "missing-hash", rowId: 21 });
  });
  it("epoch 列自身被竄改(內容改、hash 未改)→ row-modified、ok=false", async () => {
    const tamperedEpoch = { ...epoch, changes: '{"reason":"whitewash"}' };
    getDb.mockResolvedValue(verifyDbWith([legacy1, tamperedEpoch, post1]));
    const r = await verifyAuditChain();
    expect(r.ok).toBe(false);
    expect(r.anomalies.some((a) => a.kind === "row-modified" && a.rowId === 20)).toBe(true);
  });
  it("孤 epoch 列(action 對但 rowHash null)→ verifier 不認錨(epochStartId null,全表走查)", async () => {
    const orphanEpoch = { ...epochData, previousHash: null, rowHash: null };
    getDb.mockResolvedValue(verifyDbWith([legacy1, orphanEpoch]));
    const r = await verifyAuditChain();
    expect(r.epochStartId).toBeNull();
    expect(r.ok).toBe(false); // legacy1 破列照舊掀紅,誠實不掩蓋
  });
  it("epoch 後刪列(chain-broken)→ ok=false", async () => {
    // post1 被刪:post2 的 previousHash 指向 post1.rowHash,但走查上一筆是 epoch
    getDb.mockResolvedValue(verifyDbWith([epoch, post2]));
    const r = await verifyAuditChain();
    expect(r.ok).toBe(false);
    expect(r.anomalies.some((a) => a.kind === "chain-broken" && a.rowId === 22)).toBe(true);
  });
  it("epochCount:單錨=1;兩錨=2(P1c 重錨警訊資料源)", async () => {
    getDb.mockResolvedValue(verifyDbWith([epoch, post1]));
    expect((await verifyAuditChain()).epochCount).toBe(1);
    const epoch2 = chainRow(
      makeRowData(30, { userId: SYSTEM_ACTOR_USER_ID, userEmail: "system:auditChain", userRole: "system", action: AUDIT_CHAIN_EPOCH_ACTION }),
      post1.rowHash,
    );
    getDb.mockResolvedValue(verifyDbWith([epoch, post1, epoch2]));
    expect((await verifyAuditChain()).epochCount).toBe(2);
  });
  it("兩筆 epoch → 取最後一筆為錨", async () => {
    const epoch2Data = makeRowData(30, {
      userId: SYSTEM_ACTOR_USER_ID,
      userEmail: "system:auditChain",
      userRole: "system",
      action: AUDIT_CHAIN_EPOCH_ACTION,
    });
    const epoch2 = chainRow(epoch2Data, post2.rowHash);
    const post3 = chainRow(makeRowData(31), epoch2.rowHash);
    getDb.mockResolvedValue(verifyDbWith([legacy1, epoch, post1, post2, epoch2, post3]));
    const r = await verifyAuditChain();
    expect(r.epochStartId).toBe(30);
    expect(r.legacyRows).toBe(4); // legacy1 + 第一段(epoch, post1, post2)全計 legacy
    expect(r.ok).toBe(true);
  });
});

describe("D5 ensureAuditChainEpoch 一次性錨定(store+真 predicate 求值)", () => {
  // systemAudit 寫入會把新列推進 store(rowHash 先 null,hash update 成功後補上),
  // ensure 的 existence/persisted 查詢對同一個 store 以真 predicate 過濾 ——
  // 拿掉 production 的 isNotNull(rowHash) 或 re-query,對應測試會紅。
  const pushInserted = (store: StoreRow[]) => (row: Record<string, unknown>, id: number) => {
    store.push({ id, action: String(row.action), rowHash: null });
  };
  function makeEnsureDb(initial: StoreRow[], opts: { insertFails?: boolean; updateFailTimes?: number } = {}) {
    const store = [...initial];
    const made = makeWriteDb({ insertId: 99, store, insertFails: opts.insertFails, updateFailTimes: opts.updateFailTimes, onInsert: pushInserted(store) });
    return made;
  }
  it("無錨列 → 寫一筆(action=epochStart)且寫後 re-query 證實才回 written", async () => {
    const { db, insertValues } = makeEnsureDb([{ id: 1, action: "tour.update", rowHash: "H1" }]);
    getDb.mockResolvedValue(db);
    const r = await ensureAuditChainEpoch();
    expect(r).toBe("written");
    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls[0][0];
    expect(row.action).toBe(AUDIT_CHAIN_EPOCH_ACTION);
    expect(row.userId).toBe(SYSTEM_ACTOR_USER_ID);
    expect(row.changes).toContain("evidenceRef");
  });
  it("已存在有 hash 的錨列 → no-op(冪等,重啟不重寫)", async () => {
    const { db, insertValues } = makeEnsureDb([{ id: 7, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: "EH" }]);
    getDb.mockResolvedValue(db);
    const r = await ensureAuditChainEpoch();
    expect(r).toBe("exists");
    expect(insertValues).not.toHaveBeenCalled();
  });
  it("P1a 孤錨死鎖排除:store 只有孤 epoch 列(rowHash null)→ 不算 exists,重寫", async () => {
    // 拿掉 existence 查詢的 isNotNull(rowHash) → 孤錨被誤認 exists → 本測試紅
    const { db, insertValues } = makeEnsureDb([{ id: 7, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: null }]);
    getDb.mockResolvedValue(db);
    const r = await ensureAuditChainEpoch();
    expect(r).toBe("written");
    expect(insertValues).toHaveBeenCalledTimes(1);
  });
  it("P1b written 假陽性排除:insert 炸(systemAudit 吞錯)→ persisted 查空 → failed", async () => {
    const { db } = makeEnsureDb([], { insertFails: true });
    getDb.mockResolvedValue(db);
    await expect(ensureAuditChainEpoch()).resolves.toBe("failed");
  });
  it("P1b 孤錨寫入(insert 成功、hash update 雙敗)→ failed 非 written;下次 boot 重寫", async () => {
    const { db } = makeEnsureDb([], { updateFailTimes: 2 });
    getDb.mockResolvedValue(db);
    // 寫入踩 D3 失敗模式 → 新列 rowHash null → persisted(isNotNull)查不到 → failed
    await expect(ensureAuditChainEpoch()).resolves.toBe("failed");
    // 同一個 store 再跑一次(模擬下次 boot,這次 update 正常)→ written 自癒
    await expect(ensureAuditChainEpoch()).resolves.toBe("written");
  });
  it("db 不可用 → skipped,不 throw", async () => {
    getDb.mockResolvedValue(null);
    await expect(ensureAuditChainEpoch()).resolves.toBe("skipped");
  });
  it("R5-1 組合反例 valid→orphan→restart:有效錨 A 之後孤錨 B → 判準看最後 attempt,補寫非 exists", async () => {
    // Codex R5 可重現反例:A(id 7)有效錨;B(id 8)epoch insert 成功但 hash 雙敗
    // 成孤錨。舊語意查「任意有效錨」→ 看見 A 回 exists,永不自癒。
    // 新語意查「最後一次 attempt」= B(rowHash null)→ 無效 → 補寫。
    const { db, insertValues } = makeEnsureDb([
      { id: 7, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: "VALID_A" },
      { id: 8, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: null },
    ]);
    getDb.mockResolvedValue(db);
    const r = await ensureAuditChainEpoch();
    expect(r).toBe("written");
    expect(insertValues).toHaveBeenCalledTimes(1);
  });
  it("R6-1 競爭 regression:before/after 之間孤錨被別 writer 補 hash + 本次 INSERT 失敗 → failed 非 written", async () => {
    // Codex R6-1 反例:before 看見孤錨 id 8(null)→ 走補寫;INSERT 失敗且同時
    // 另一個 writer 把 id 8 補上 hash。「重查最後 attempt」語意會看見 id 8 已
    // truthy 而誤回 written;「本次確切 insertId」語意下 insert 失敗 → failed。
    const store: StoreRow[] = [
      { id: 7, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: "VALID_A" },
      { id: 8, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: null },
    ];
    const insertValues = vi.fn().mockImplementation(() => {
      // 併發 writer 在我們 INSERT 失敗的同一窗口把孤錨補上 hash
      const orphan = store.find((r) => r.id === 8);
      if (orphan) orphan.rowHash = "FILLED_BY_OTHER_WRITER";
      return Promise.reject(new Error("insert blew up"));
    });
    const db = {
      select: () => ({
        from: () => ({
          where: (pred: SQL) => {
            const filtered = store.filter((r) => matchesPredicate(pred, r));
            return {
              orderBy: () => ({
                limit: (n: number) => Promise.resolve([...filtered].sort((a, b) => b.id - a.id).slice(0, n)),
              }),
              limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
            };
          },
          orderBy: () => ({ limit: (n: number) => Promise.resolve([...store].sort((a, b) => b.id - a.id).slice(0, n)) }),
        }),
      }),
      insert: () => ({ values: insertValues }),
      update: () => ({ set: () => ({ where: vi.fn() }) }),
      transaction: passthroughTx(),
    };
    getDb.mockResolvedValue(db);
    await expect(ensureAuditChainEpoch()).resolves.toBe("failed");
  });
  it("R5-1 written 不得拿舊錨充數:寫入炸掉時,即使存在有效舊錨也回 failed", async () => {
    // A 有效錨在前、最後 attempt 是孤錨 → 走補寫;補寫 insert 炸 →
    // 基準 id 之後沒有新的有效 attempt → failed(舊錨 A 不能充 written)。
    const { db } = makeEnsureDb(
      [
        { id: 7, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: "VALID_A" },
        { id: 8, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: null },
      ],
      { insertFails: true },
    );
    getDb.mockResolvedValue(db);
    await expect(ensureAuditChainEpoch()).resolves.toBe("failed");
  });
  it("R5-1 空字串 hash regression:ensure 與 verifier 同判準(空字串≠有效錨)", async () => {
    // ensure:最後 attempt hash 為空字串 → 無效 → 補寫(非 exists)
    const { db, insertValues } = makeEnsureDb([
      { id: 7, action: AUDIT_CHAIN_EPOCH_ACTION, rowHash: "" },
    ]);
    getDb.mockResolvedValue(db);
    await expect(ensureAuditChainEpoch()).resolves.toBe("written");
    expect(insertValues).toHaveBeenCalledTimes(1);
    // verifier:空字串 epoch 列不被認錨(epochStartId null)
    const emptyEpoch = { ...makeRowData(7, { action: AUDIT_CHAIN_EPOCH_ACTION }), previousHash: "GENESIS", rowHash: "" };
    getDb.mockResolvedValue(verifyDbWith([emptyEpoch]));
    const v = await verifyAuditChain();
    expect(v.epochStartId).toBeNull();
    expect(v.epochCount).toBe(0);
  });
  it("R5-1 連續兩次呼叫:第一次 written 後,第二次回 exists(不重複錨定)", async () => {
    const { db } = makeEnsureDb([]);
    getDb.mockResolvedValue(db);
    await expect(ensureAuditChainEpoch()).resolves.toBe("written");
    await expect(ensureAuditChainEpoch()).resolves.toBe("exists");
  });
});

describe("R13 adminAuditLog 直接寫入者 guard(TypeChecker+lexical 求值+SQL tokenizer)", () => {
  async function makeCheckerScanner() {
    const ts = (await import("typescript")).default;
    type Node = import("typescript").Node;
    type Checker = import("typescript").TypeChecker;

    function unwrap(n: Node): Node {
      let cur = n;
      for (;;) {
        if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
        else if (ts.isAsExpression(cur)) cur = cur.expression;
        else if (ts.isNonNullExpression(cur)) cur = cur.expression;
        // R15-3:satisfies 是純 type-only wrapper(非 runtime 邊界),一併剝除
        else if (ts.isSatisfiesExpression?.(cur)) cur = (cur as import("typescript").SatisfiesExpression).expression;
        else return cur;
      }
    }

    // ── R13-3a:SQL tokenizer(quote/comment-aware;取代 regex)──
    // 規則:' " ` 引號內容為單一 identifier/string token(內含 #/--// 不當註解);
    // -- 與 # 為行註解;/* */ 跳過;/*! ... */ 是 MySQL executable comment,
    // **內容展開為 SQL**(server 會執行);token = [\w$-]+ 或引號 token。
    function tokenizeSql(value: string): string[] {
      const tokens: string[] = [];
      let i = 0;
      const n = value.length;
      let cur = "";
      const flush = () => {
        if (cur) {
          tokens.push(cur.toLowerCase());
          cur = "";
        }
      };
      while (i < n) {
        const c = value[i];
        const two = value.slice(i, i + 2);
        if (c === "'" || c === '"' || c === "`") {
          flush();
          const q = c;
          let j = i + 1;
          let s = "";
          while (j < n && value[j] !== q) {
            s += value[j];
            j++;
          }
          tokens.push("\u0000q:" + s.toLowerCase()); // 引號 token(帶前綴,與裸字區分)
          i = j + 1;
          continue;
        }
        if (two === "--" || c === "#") {
          flush();
          while (i < n && value[i] !== "\n") i++;
          continue;
        }
        if (value.slice(i, i + 3) === "/*!") {
          flush();
          i += 3; // executable comment:標記剝掉,內容照常掃(server 會執行)
          // R14-2:版本號 metadata(/*!50000 …/六位)不是 SQL token,一併剝除
          while (i < n && /[0-9]/.test(value[i])) i++;
          continue;
        }
        if (two === "/*") {
          flush();
          const end = value.indexOf("*/", i + 2);
          i = end === -1 ? n : end + 2;
          continue;
        }
        if (two === "*/") {
          flush();
          i += 2; // executable comment 的收尾標記
          continue;
        }
        if (/[\w$-]/.test(c)) {
          cur += c;
          i++;
          continue;
        }
        flush();
        if (c === ".") tokens.push(".");
        i++;
      }
      flush();
      return tokens;
    }
    /** token 流判定:insert [modifiers] into [qualifier .] adminauditlog(精確 table token)。 */
    function sqlHitsAdminAuditLog(value: string): boolean {
      const toks = tokenizeSql(value);
      const MODS = new Set(["ignore", "low_priority", "high_priority", "delayed"]);
      const isTable = (t: string) => t === "adminauditlog" || t === "\u0000q:adminauditlog";
      for (let i = 0; i < toks.length; i++) {
        if (toks[i] !== "insert") continue;
        let j = i + 1;
        while (j < toks.length && MODS.has(toks[j])) j++;
        if (toks[j] !== "into") continue;
        j++;
        if (j >= toks.length) continue;
        // 可選 qualifier:token "." token
        if (toks[j + 1] === ".") {
          if (isTable(toks[j + 2] ?? "")) return true;
          continue; // qualifier 存在但 table 不是目標(decoy 不誤報)
        }
        if (isTable(toks[j])) return true;
      }
      return false;
    }

    // ── R13-3b:lexical 靜態字串求值(mini-Program checker;visited-set 防循環,
    // 不設武斷深度上限 —— 有限靜態 const 鏈全可解;同名遮蔽由 checker 語彙域解析)──
    function makeEvaluator(checker: Checker) {
      const evalStatic = (n: Node, visited: Set<unknown>, budget: { n: number }): string | null => {
        if (budget.n-- <= 0) return null; // 節點預算(防病態,非鏈長上限)
        const node = unwrap(n);
        if (ts.isStringLiteralLike(node)) return node.text;
        // R14-2:tagged static template(sql`…`/SQL`…`)—— tag 函式忽略,
        // 求值其 template 本體(靜態可判的 SQL 載體)
        if (ts.isTaggedTemplateExpression(node)) {
          return evalStatic(node.template, visited, budget);
        }
        if (ts.isNoSubstitutionTemplateLiteral?.(node)) return (node as import("typescript").NoSubstitutionTemplateLiteral).text;
        if (ts.isTemplateExpression(node)) {
          let out = node.head.text;
          for (const span of node.templateSpans) {
            const v = evalStatic(span.expression, visited, budget);
            if (v === null) return null;
            out += v + span.literal.text;
          }
          return out;
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
          const l = evalStatic(node.left, visited, budget);
          if (l === null) return null;
          const r = evalStatic(node.right, visited, budget);
          return r === null ? null : l + r;
        }
        if (ts.isIdentifier(node)) {
          const sym = checker.getSymbolAtLocation(node);
          if (!sym) return null;
          // R14-3:recursion-stack + 完成值 memo —— visited 只在「本條解析路徑」
          // 上防真循環(進入 push、離開 pop);已完成的 symbol 值進 memo,
          // 同一 const 在同一運算式重用兩次不再被誤判為 cycle(有限 DAG 全可解)。
          if (memo.has(sym)) return memo.get(sym) as string | null;
          if (visited.has(sym)) return null; // 真循環
          visited.add(sym);
          let out: string | null = null;
          const decl = sym.valueDeclaration;
          if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
            out = evalStatic(decl.initializer, visited, budget);
          }
          visited.delete(sym); // unwind
          memo.set(sym, out);
          return out;
        }
        return null;
      };
      const memo = new Map<unknown, string | null>();
      return (n: Node) => evalStatic(n, new Set(), { n: 4096 });
    }
    /** 檔級 raw SQL writer 判定:僅 execute/query 呼叫的引數做靜態求值再 token 判定
     *  (logger/文件字串不誤報 —— 誠實邊界:非 execute/query 名稱的執行通道不在
     *  靜態可判範圍,design.md 記載)。單檔 mini-Program 取得 lexical checker。 */
    /** R18-1:per-content 結果記憶化(純函式 of source → 可跨 union 重用;
     *  等價性由 differential 測試證明)。 */
    const rawResultMemo = new Map<string, boolean>();
    function isRawSqlWriterSource(source: string, fileName = "/scan/file.tsx", optimized = true): boolean {
      if (optimized && rawResultMemo.has(source)) return rawResultMemo.get(source)!;
      const result = isRawSqlWriterSourceCore(source, fileName, optimized);
      if (optimized) rawResultMemo.set(source, result);
      return result;
    }
    function isRawSqlWriterSourceCore(source: string, fileName: string, optimized: boolean): boolean {
      // R18-1 結構性 sound 預過濾(取代被推翻的 substring 剪枝):本函式只在
      // 「callee 名為 execute/query 的 CallExpression 引數」上回報命中,故命中
      // 檔的原始碼必然含 execute 或 query 識別字文字 —— 唯一例外是識別字用
      // \u unicode escape 書寫(此時原始碼必含反斜線 u)。三條件皆無 → 不可能
      // 命中,直接 false。這是 AST 結構性質(非值域啟發式);拆字串串接/模板
      // 片段/字串值內 unicode escape 都不影響此論證(那些只影響「值」,不影響
      // callee 識別字的原始碼書寫)。等價性另由 differential 測試全庫實證。
      if (optimized && !/execute|query/i.test(source) && !source.includes("\\u")) return false;
      const options: import("typescript").CompilerOptions = {
        allowJs: true, noLib: true, noEmit: true,
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.Latest,
      };
      const host: import("typescript").CompilerHost = {
        getSourceFile: (name) =>
          name === fileName ? ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) : undefined,
        writeFile: () => {},
        getDefaultLibFileName: () => "lib.d.ts",
        useCaseSensitiveFileNames: () => true,
        getCanonicalFileName: (n) => n,
        getCurrentDirectory: () => "/",
        getNewLine: () => "\n",
        fileExists: (name) => name === fileName,
        readFile: () => source,
      };
      const program = ts.createProgram([fileName], options, host);
      const sf = program.getSourceFile(fileName);
      if (!sf) return false;
      const evalStatic = makeEvaluator(program.getTypeChecker());
      let hit = false;
      const visit = (node: Node): void => {
        if (hit) return;
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const calleeName = ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : ts.isIdentifier(callee)
              ? callee.text
              : "";
          if (calleeName === "execute" || calleeName === "query") {
            for (const arg of node.arguments) {
              const v = evalStatic(arg);
              if (v !== null && sqlHitsAdminAuditLog(v)) {
                hit = true;
                return;
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return hit;
    }

    // ── drizzle writer 判定(TypeChecker)──(R12 版 + R13-2 補強)
    function findDrizzleWriters(program: import("typescript").Program, schemaFileName: string): string[] {
      const checker: Checker = program.getTypeChecker();
      const schemaSf = program.getSourceFile(schemaFileName);
      if (!schemaSf) throw new Error(`schema source file not in program: ${schemaFileName}`);
      const moduleSym = checker.getSymbolAtLocation(schemaSf);
      if (!moduleSym) throw new Error("schema module symbol unresolved");
      const target = checker.getExportsOfModule(moduleSym).find((s) => s.name === "adminAuditLog");
      if (!target) throw new Error("adminAuditLog export not found in schema");
      const targetResolved = target.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(target) : target;
      const targetDecls = new Set(targetResolved.declarations ?? []);

      const propNameOf = (el: { propertyName?: Node; name?: Node }): string | null => {
        const pn = el.propertyName;
        if (pn) {
          if (ts.isIdentifier(pn)) return pn.text;
          if (ts.isStringLiteralLike(pn)) return pn.text;
          if (ts.isComputedPropertyName(pn) && ts.isStringLiteralLike(pn.expression)) return pn.expression.text;
          return null;
        }
        const nm = el.name;
        return nm && ts.isIdentifier(nm) ? nm.text : null;
      };
      const typePropIsTarget = (objExpr: Node, propName: string): boolean => {
        const objType = checker.getTypeAtLocation(objExpr);
        let psym = objType.getProperty(propName);
        let g = 0;
        while (psym && psym.flags & ts.SymbolFlags.Alias && g++ < 20) {
          const nx = checker.getAliasedSymbol(psym);
          if (!nx || nx === psym) break;
          psym = nx;
        }
        if (psym === targetResolved) return true;
        return !!psym && (psym.declarations ?? []).some((d) => targetDecls.has(d));
      };

      const resolvesToTarget = (n: Node, depth = 0): boolean => {
        if (depth > 8) return false;
        const a = unwrap(n);
        let sym = checker.getSymbolAtLocation(a);
        if (!sym && ts.isElementAccessExpression(a) && ts.isStringLiteralLike(a.argumentExpression)) {
          const objType = checker.getTypeAtLocation(a.expression);
          sym = objType.getProperty(a.argumentExpression.text);
        }
        if (!sym) return false;
        let guard = 0;
        while (sym.flags & ts.SymbolFlags.Alias && guard++ < 20) {
          const next = checker.getAliasedSymbol(sym);
          if (!next || next === sym) break;
          sym = next;
        }
        if (sym === targetResolved) return true;
        if ((sym.declarations ?? []).some((d) => targetDecls.has(d))) return true;
        const bdecl = sym.valueDeclaration;
        if (bdecl && ts.isBindingElement(bdecl)) {
          const propName = propNameOf(bdecl as { propertyName?: Node; name?: Node });
          const vd = bdecl.parent?.parent;
          if (propName && vd && ts.isVariableDeclaration(vd) && vd.initializer && typePropIsTarget(vd.initializer, propName)) return true;
        }
        // R13-2:local object alias(const local = { tbl: adminAuditLog };insert(local.tbl))
        if (bdecl && ts.isPropertyAssignment(bdecl) && resolvesToTarget(bdecl.initializer, depth + 1)) return true;
        if (bdecl && ts.isShorthandPropertyAssignment(bdecl)) {
          const vs = checker.getShorthandAssignmentValueSymbol(bdecl);
          if (vs === targetResolved || (vs?.declarations ?? []).some((d) => targetDecls.has(d))) return true;
        }
        const decl = sym.valueDeclaration;
        if (decl && ts.isVariableDeclaration(decl)) {
          if (decl.initializer && resolvesToTarget(decl.initializer, depth + 1)) return true;
          const sf = decl.getSourceFile();
          let assigned = false;
          const scan = (node: Node): void => {
            if (assigned) return;
            if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
              if (ts.isIdentifier(node.left) && checker.getSymbolAtLocation(node.left) === sym && resolvesToTarget(node.right, depth + 1)) {
                assigned = true;
                return;
              }
              const left = unwrap(node.left);
              if (ts.isObjectLiteralExpression(left)) {
                for (const prop of left.properties) {
                  if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer) && checker.getSymbolAtLocation(prop.initializer) === sym) {
                    const pName = propNameOf(prop as { propertyName?: Node; name?: Node }) ?? (ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteralLike(prop.name) ? prop.name.text : null);
                    if (pName && typePropIsTarget(node.right, pName)) {
                      assigned = true;
                      return;
                    }
                  }
                  // R13-2:shorthand assignment(({ auditTbl } = bundle))
                  if (ts.isShorthandPropertyAssignment(prop) && checker.getShorthandAssignmentValueSymbol(prop) === sym) {
                    if (typePropIsTarget(node.right, prop.name.text)) {
                      assigned = true;
                      return;
                    }
                  }
                }
              }
            }
            ts.forEachChild(node, scan);
          };
          scan(sf);
          if (assigned) return true;
        }
        return false;
      };

      const hits: string[] = [];
      for (const sf of program.getSourceFiles()) {
        if (sf.fileName.includes("node_modules")) continue;
        if (/\.test\.(ts|tsx|js|jsx|mjs|cjs)$/.test(sf.fileName)) continue;
        if (sf.fileName === schemaFileName) continue;
        let hit = false;
        const visit = (node: Node): void => {
          if (hit) return;
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "insert" &&
            node.arguments.length > 0 &&
            resolvesToTarget(node.arguments[0])
          )
            hit = true;
          ts.forEachChild(node, visit);
        };
        visit(sf);
        if (hit) hits.push(sf.fileName);
      }
      return hits;
    }

    // ── 共用 roots 政策(production 與虛擬同一條路;無過濾)──
    function selectRoots(input: { schemaPath: string; fileNames: string[] }): string[] {
      return [...new Set([input.schemaPath, ...input.fileNames])];
    }
    /** R17-2:canonical path predicate(磁碟與 overlay 同源同規則):
     *  root 內、任何路徑段不 hidden、不落 SKIP 目錄、六副檔名、非 .test.。 */
    const CANON_SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git", ".cache"]);
    function isCanonicalPath(root: string, p: string): boolean {
      if (!p.startsWith(root + "/")) return false;
      const rel = p.slice(root.length + 1);
      const segs = rel.split("/");
      const base = segs[segs.length - 1];
      if (segs.some((seg) => CANON_SKIP.has(seg) || seg.startsWith("."))) return false;
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base)) return false;
      if (/\.test\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base)) return false;
      return true;
    }
    /** R17-1:canonical file set 單一來源(呼叫次數由 counter 釘死=每 flow 一次)。
     *  磁碟遞迴與 overlay 過濾共用 isCanonicalPath;結果去重。 */
    let walkCallCount = 0;
    function walkCanonicalFiles(root: string, overlayPaths: string[] = []): string[] {
      walkCallCount++;
      const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
      const { join } = require("node:path") as typeof import("node:path");
      const out = new Set<string>();
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          if (CANON_SKIP.has(name) || name.startsWith(".")) continue;
          const p = join(dir, name);
          const st = statSync(p);
          if (st.isDirectory()) walk(p);
          else if (isCanonicalPath(root, p)) out.add(p);
        }
      };
      walk(root);
      for (const p of overlayPaths) {
        if (isCanonicalPath(root, p)) out.add(p);
      }
      return [...out];
    }
    function buildGuardProgram(
      opts:
        | { virtualFiles: Record<string, string> }
        | { realRoot: string; canonical: string[]; overlay?: Record<string, string> },
    ): { program: import("typescript").Program; schemaPath: string; rootFileNames: string[] } {
      if ("virtualFiles" in opts) {
        const files = opts.virtualFiles;
        const schemaPath = "/proj/schema.ts";
        const roots = selectRoots({ schemaPath, fileNames: Object.keys(files).filter((f) => f !== schemaPath) });
        const options: import("typescript").CompilerOptions = {
          allowJs: true, noLib: true, noEmit: true,
          module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10,
          target: ts.ScriptTarget.Latest,
        };
        const host: import("typescript").CompilerHost = {
          getSourceFile: (name) =>
            files[name] !== undefined ? ts.createSourceFile(name, files[name], ts.ScriptTarget.Latest, true) : undefined,
          writeFile: () => {},
          getDefaultLibFileName: () => "lib.d.ts",
          useCaseSensitiveFileNames: () => true,
          getCanonicalFileName: (n) => n,
          getCurrentDirectory: () => "/",
          getNewLine: () => "\n",
          fileExists: (name) => files[name] !== undefined,
          readFile: (name) => files[name],
        };
        return { program: ts.createProgram(roots, options, host), schemaPath, rootFileNames: roots, canonicalRef: undefined as string[] | undefined };
      }
      const root = opts.realRoot;
      const cfgFile = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
      const cfg = ts.readConfigFile(cfgFile!, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
      const schemaPath = root + "/drizzle/schema.ts";
      // Codex R14-1:roots 不再只取 tsconfig fileNames —— 改用與 raw walk 一致的
      // canonical file set(repo root 遞迴、六副檔名、SKIP node_modules/dist 等、
      // 排除 .test.)。tsconfig 沒收的 standalone scripts/*.ts drizzle writer 也進
      // Program;overlay 供正向控制測試(虛擬注入 writer 必被抓)。
      // R17-1:builder 不內部 walk —— canonical 由呼叫端傳入(單一 discovery 結果)
      const overlay = opts.overlay ?? {};
      const roots = selectRoots({ schemaPath, fileNames: opts.canonical });
      const baseHost = ts.createCompilerHost({ ...parsed.options, noEmit: true, skipLibCheck: true, allowJs: true });
      const host: import("typescript").CompilerHost = {
        ...baseHost,
        getSourceFile: (name, lang) =>
          overlay[name] !== undefined
            ? ts.createSourceFile(name, overlay[name], ts.ScriptTarget.Latest, true)
            : baseHost.getSourceFile(name, lang),
        fileExists: (name) => overlay[name] !== undefined || baseHost.fileExists(name),
        readFile: (name) => (overlay[name] !== undefined ? overlay[name] : baseHost.readFile(name)),
      };
      return {
        program: ts.createProgram(roots, { ...parsed.options, noEmit: true, skipLibCheck: true, allowJs: true, checkJs: false }, host),
        schemaPath,
        rootFileNames: roots,
        canonicalRef: opts.canonical, // R18-2:回傳收到的同一參照,供 Object.is 證明
      };
    }

    return {
      ts, findDrizzleWriters, buildGuardProgram, selectRoots, isRawSqlWriterSource,
      sqlHitsAdminAuditLog, walkCanonicalFiles, isCanonicalPath,
      getWalkCallCount: () => walkCallCount,
      getRawMemoSize: () => rawResultMemo.size,
    };
  }

  const SCHEMA_SRC = "export const adminAuditLog = { table: true } as const;\nexport const otherTable = { table: true } as const;";

  it("R12-2 selectRoots 結構釘:全檔集無過濾", async () => {
    const { selectRoots } = await makeCheckerScanner();
    const roots = selectRoots({ schemaPath: "/proj/schema.ts", fileNames: ["/proj/no-literals-here.ts", "/proj/other.ts"] });
    expect(roots).toContain("/proj/no-literals-here.ts");
    expect(roots).toHaveLength(3);
  });

  it("R15-1 canonical completeness:六副檔名 oracle 與 roots exact set equality;每檔 getSourceFile 存在(副檔名縮水突變必紅)", async () => {
    const { buildGuardProgram, walkCanonicalFiles } = await makeCheckerScanner();
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = process.cwd();
    // R17-1:呼叫端做唯一一次 discovery,builder 不內部 walk
    const canonicalOnce = walkCanonicalFiles(root);
    const { program, schemaPath, rootFileNames } = buildGuardProgram({ realRoot: root, canonical: canonicalOnce });
    // 獨立 oracle:完整六副檔名 canonical walk(與 production 同排除規則)
    const SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git", ".cache"]);
    const oracle: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (SKIP.has(name) || name.startsWith(".")) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.test\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) oracle.push(p);
      }
    };
    walk(root);
    expect(oracle.length).toBeGreaterThan(1000);
    // exact set equality:roots = {schemaPath} ∪ oracle(production 副檔名縮水
    // 成 .ts/.tsx 之類的突變 → 集合不相等 → 紅)
    expect(new Set(rootFileNames)).toEqual(new Set([schemaPath, ...oracle]));
    // 每檔必須真的載入為 SourceFile(無 rootFileNames.includes fallback)
    for (const f of oracle) {
      expect(program.getSourceFile(f), `SourceFile not loaded: ${f}`).toBeTruthy();
    }
  }, 240000);

  it("對抗案(TypeChecker):全部變體", async () => {
    const { findDrizzleWriters, buildGuardProgram } = await makeCheckerScanner();
    const run = (consumerSrc: string, extra: Record<string, string> = {}) => {
      const { program, schemaPath } = buildGuardProgram({
        virtualFiles: { "/proj/schema.ts": SCHEMA_SRC, "/proj/consumer.ts": consumerSrc, ...extra },
      });
      return findDrizzleWriters(program, schemaPath);
    };
    const HIT = ["/proj/consumer.ts"];
    const BARREL = { "/proj/barrel.ts": 'export { adminAuditLog as auditTbl } from "./schema";' };
    expect(run('import { adminAuditLog } from "./schema";\ndeclare const db: any;\ndb.insert(adminAuditLog).values({})')).toEqual(HIT);
    expect(run('import { adminAuditLog } from "./schema";\ndeclare const db: any;\ndb.insert((adminAuditLog)).values({})')).toEqual(HIT);
    expect(run('import { adminAuditLog } from "./schema";\ndeclare const db: any;\ndb.insert(adminAuditLog as any).values({})')).toEqual(HIT);
    expect(run('import * as schema from "./schema";\ndeclare const db: any;\ndb.insert(schema["adminAuditLog"]).values({})')).toEqual(HIT);
    expect(run('import { adminAuditLog } from "./schema";\ndeclare const db: any;\nlet a;\na = adminAuditLog;\ndb.insert(a).values({})')).toEqual(HIT);
    expect(run('import * as bundle from "./barrel";\ndeclare const db: any;\ndb.insert(bundle.auditTbl).values({})', BARREL)).toEqual(HIT);
    expect(
      run('import tbl from "./dbarrel";\ndeclare const db: any;\ndb.insert(tbl).values({})', {
        "/proj/dbarrel.ts": 'import { adminAuditLog } from "./schema";\nexport default adminAuditLog;',
      }),
    ).toEqual(HIT);
    expect(run('import * as bundle from "./barrel";\ndeclare const db: any;\ndb.insert(bundle["auditTbl"]).values({})', BARREL)).toEqual(HIT);
    expect(
      run('import { secondHop } from "./hop2";\ndeclare const db: any;\ndb.insert(secondHop).values({})', {
        "/proj/hop1.ts": 'export { adminAuditLog as auditTbl } from "./schema";\nexport { secondHop as loop } from "./hop2";',
        "/proj/hop2.ts": 'export { auditTbl as secondHop } from "./hop1";',
      }),
    ).toEqual(HIT);
    expect(run('import * as bundle from "./barrel";\ndeclare const db: any;\nconst { auditTbl } = bundle;\ndb.insert(auditTbl).values({})', BARREL)).toEqual(HIT);
    expect(run('import * as bundle from "./barrel";\ndeclare const db: any;\nconst { auditTbl: t } = bundle;\ndb.insert(t).values({})', BARREL)).toEqual(HIT);
    expect(run('import * as bundle from "./barrel";\ndeclare const db: any;\nconst { "auditTbl": t } = bundle;\ndb.insert(t).values({})', BARREL)).toEqual(HIT);
    expect(run('import * as bundle from "./barrel";\ndeclare const db: any;\nconst { ["auditTbl"]: t } = bundle;\ndb.insert(t).values({})', BARREL)).toEqual(HIT);
    expect(run('import * as bundle from "./barrel";\ndeclare const db: any;\nlet t;\n({ auditTbl: t } = bundle);\ndb.insert(t).values({})', BARREL)).toEqual(HIT);
    expect(run('import * as bundle from "./barrel";\ndeclare const db: any;\nlet auditTbl;\n(({ auditTbl } = bundle));\ndb.insert(auditTbl).values({})', BARREL)).toEqual(HIT);
    expect(run('import { adminAuditLog } from "./schema";\ndeclare const db: any;\nconst local = { tbl: adminAuditLog };\ndb.insert(local.tbl).values({})')).toEqual(HIT);
    expect(run('import { auditTbl } from "./barrel";\ndeclare const db: any;\ndb.insert(auditTbl).values({})', BARREL)).toEqual(HIT);
    expect(run('const adminAuditLog = { fake: true };\ndeclare const db: any;\ndb.insert(adminAuditLog).values({})')).toEqual([]);
    expect(
      run('import { auditTbl } from "./decoy";\ndeclare const db: any;\ndb.insert(auditTbl).values({})', {
        "/proj/decoy.ts": "export const auditTbl = { decoy: true };",
      }),
    ).toEqual([]);
    expect(run('import { adminAuditLog } from "./schema";\ndeclare const db: any;\ndb.select().from(adminAuditLog)')).toEqual([]);
  });

  it("R13-3 SQL tokenizer+lexical 求值:全部案例(含 R14/R15 反例)", async () => {
    const { isRawSqlWriterSource, sqlHitsAdminAuditLog } = await makeCheckerScanner();
    expect(sqlHitsAdminAuditLog("INSERT INTO adminAuditLog (a) VALUES (?)")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT IGNORE INTO packgo.adminAuditLog (a) VALUES (?)")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT INTO `pack-go` . `adminAuditLog` (a) VALUES (?)")).toBe(true);
    expect(sqlHitsAdminAuditLog("/*! INSERT INTO adminAuditLog (a) VALUES (?) */")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT INTO `pack#prod`.`adminAuditLog` (a) VALUES (?)")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT /*hint*/ INTO adminAuditLog (a)")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT -- c\nINTO adminAuditLog (a)")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT INTO `adminAuditLog-shadow` (a)")).toBe(false);
    expect(sqlHitsAdminAuditLog("INSERT INTO adminAuditLogArchive (a)")).toBe(false);
    expect(sqlHitsAdminAuditLog("/* INSERT INTO adminAuditLog */ SELECT 1")).toBe(false);
    expect(sqlHitsAdminAuditLog("SELECT * FROM adminAuditLog")).toBe(false);
    expect(isRawSqlWriterSource('conn.execute("INSERT INTO adminAuditLog (a) VALUES (?)")')).toBe(true);
    expect(isRawSqlWriterSource('pool.query("INSERT INTO adminAuditLog (a) VALUES (?)")')).toBe(true);
    expect(isRawSqlWriterSource('logger.info("INSERT INTO adminAuditLog failed")')).toBe(false);
    expect(isRawSqlWriterSource('const doc = "INSERT INTO adminAuditLog";\nconsole.log(doc)')).toBe(false);
    expect(
      isRawSqlWriterSource(
        'const t = "adminAuditLog";\nfunction g(){ const t = process.env.X; conn.execute("SELECT 1 -- " + t) }\nconn.execute("INSERT INTO " + t)',
      ),
    ).toBe(true);
    expect(
      isRawSqlWriterSource(
        'const t = process.env.X;\nfunction g(){ const t = "adminAuditLog"; conn.execute("INSERT INTO " + t) }',
      ),
    ).toBe(true);
    expect(isRawSqlWriterSource('const t = process.env.X;\nconn.execute("INSERT INTO " + t)')).toBe(false);
    const chain = Array.from({ length: 12 }, (_, i) => `const c${i + 1} = c${i};`).join("\n");
    expect(
      isRawSqlWriterSource(`const c0 = "adminAuditLog";\n${chain}\nconn.execute("INSERT INTO " + c12)`),
    ).toBe(true);
    expect(isRawSqlWriterSource('const sep = "--";\nconn.execute("INSERT INTO adminAuditLog (a)")')).toBe(true);
    // R14-2:tagged static templates
    expect(isRawSqlWriterSource("db.execute(sql`INSERT INTO adminAuditLog (a) VALUES (1)`)")).toBe(true);
    expect(isRawSqlWriterSource("conn.query(SQL`INSERT INTO adminAuditLog (a) VALUES (1)`)")).toBe(true);
    expect(isRawSqlWriterSource("db.execute(sql`SELECT * FROM adminAuditLog`)")).toBe(false);
    // R14-2:versioned executable comments
    expect(sqlHitsAdminAuditLog("/*!50000 INSERT INTO adminAuditLog (a) VALUES (?) */")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT /*!50000 IGNORE */ INTO adminAuditLog (a)")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT /*!50000 */ INTO adminAuditLog (a)")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT /*!50000 IGNORE */ INTO otherTable (a)")).toBe(false);
    // R14-3:同一 const 重用(有限 DAG)與真循環
    expect(
      isRawSqlWriterSource('const t = "adminAuditLog";\nconn.execute("INSERT INTO " + t + " SELECT * FROM " + t)'),
    ).toBe(true);
    expect(
      isRawSqlWriterSource('const a: string = b;\nconst b: string = a;\nconn.execute("INSERT INTO " + a)'),
    ).toBe(false);
    // R15-3:satisfies 純 type wrapper(直接與 const 重用兩型)
    expect(
      isRawSqlWriterSource("db.execute(sql`INSERT INTO adminAuditLog (a) VALUES (1)` satisfies unknown)"),
    ).toBe(true);
    expect(
      isRawSqlWriterSource('const q = sql`INSERT INTO adminAuditLog (a) VALUES (1)` satisfies unknown;\ndb.execute(q)'),
    ).toBe(true);
    // R16-3:tagged carrier 全變體(括號/as/non-null/property tag/nested tag/const tag)
    expect(isRawSqlWriterSource("db.execute((sql`INSERT INTO adminAuditLog (a) VALUES (1)`))")).toBe(true);
    expect(isRawSqlWriterSource("db.execute(sql`INSERT INTO adminAuditLog (a) VALUES (1)` as unknown)")).toBe(true);
    expect(isRawSqlWriterSource("db.execute(sql`INSERT INTO adminAuditLog (a) VALUES (1)`!)")).toBe(true);
    expect(isRawSqlWriterSource("db.execute(orm.sql`INSERT INTO adminAuditLog (a) VALUES (1)`)")).toBe(true);
    expect(isRawSqlWriterSource("db.execute(orm.dialect.sql`INSERT INTO adminAuditLog (a) VALUES (1)`)")).toBe(true);
    expect(isRawSqlWriterSource('const t = sql;\ndb.execute(t`INSERT INTO adminAuditLog (a) VALUES (1)`)')).toBe(true);
    // R16-3:六位 version metadata
    expect(sqlHitsAdminAuditLog("/*!123456 INSERT INTO adminAuditLog (a) VALUES (?) */")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT /*!123456 IGNORE */ INTO adminAuditLog (a)")).toBe(true);
    expect(sqlHitsAdminAuditLog("INSERT /*!123456 */ INTO otherTable (a)")).toBe(false);
  });

  /** R17-1:union gate —— walkCanonicalFiles 恰呼叫一次,同一份結果進 raw 半邊
   *  與 TypeChecker builder(builder 不內部 walk)。 */
  let scannerMemo: Awaited<ReturnType<typeof makeCheckerScanner>> | null = null;
  async function getScanner() {
    if (!scannerMemo) scannerMemo = await makeCheckerScanner();
    return scannerMemo;
  }
  // R18-2:unionMemo 已刪除 —— 每次呼叫都是 uncached flow(walkCalls 不可能
  // 由快取充數);唯一快取是 per-content 的 rawResultMemo(純函式,differential
  // 測試證明等價)。
  async function computeWriterUnionFull(overlay: Record<string, string> = {}) {
    const scanner = await getScanner();
    const { findDrizzleWriters, buildGuardProgram, isRawSqlWriterSource, walkCanonicalFiles, getWalkCallCount } = scanner;
    const { readFileSync } = await import("node:fs");
    const { relative } = await import("node:path");
    const root = process.cwd();
    const before = getWalkCallCount();
    const canonical = walkCanonicalFiles(root, Object.keys(overlay)); // 唯一一次 discovery
    const rawHits: string[] = [];
    const rawScannedPaths: string[] = [];
    let yieldCounter = 0;
    for (const p of canonical) {
      rawScannedPaths.push(p);
      const src = overlay[p] !== undefined ? overlay[p] : readFileSync(p, "utf8");
      if (isRawSqlWriterSource(src, "/scan/" + p.split("/").pop())) rawHits.push(relative(root, p));
      // 長同步掃描會餓死 vitest worker IPC 心跳(onTaskUpdate timeout)→ 定期讓出
      if (++yieldCounter % 25 === 0) await new Promise((r) => setImmediate(r));
    }
    const built = buildGuardProgram({ realRoot: root, canonical, overlay });
    const drizzleHits = findDrizzleWriters(built.program, built.schemaPath).map((p) => relative(root, p));
    return {
      union: [...new Set([...drizzleHits, ...rawHits])].sort(),
      canonical,
      rawScannedPaths,
      rootFileNames: built.rootFileNames,
      builderCanonicalRef: built.canonicalRef,
      schemaPath: built.schemaPath,
      walkCalls: getWalkCallCount() - before,
    };
  }
  async function computeWriterUnion(overlay: Record<string, string> = {}) {
    return (await computeWriterUnionFull(overlay)).union;
  }

  it("R18-2 單路徑防退(uncached):walker 恰一次;raw 實掃 path set === canonical exact set;builder 收到同一陣列參照", async () => {
    const r = await computeWriterUnionFull(); // unionMemo 已刪,必為 uncached flow
    expect(r.walkCalls).toBe(1);
    expect(r.rawScannedPaths).toEqual(r.canonical); // raw 半縮副檔名 → 不等 → 紅
    expect(new Set(r.rootFileNames)).toEqual(new Set([r.schemaPath, ...r.canonical]));
    expect(Object.is(r.builderCanonicalRef, r.canonical)).toBe(true); // 同一參照
  }, 240000);

  it("R17-3 overlay 規則同源:SKIP/hidden/test/非法副檔名四錯收案全拒;合法 .mjs 綠案通過", async () => {
    const { isCanonicalPath } = await makeCheckerScanner();
    const root = process.cwd();
    // 四紅案(Codex 錯收反例):即使內容是 writer,也不得進 canonical → 不進 union
    const RED = [
      root + "/node_modules/pkg/evil.mjs",
      root + "/dist/evil.ts",
      root + "/.secret/evil.js",
      root + "/scripts/.evil.cjs",
    ];
    for (const p of RED) expect(isCanonicalPath(root, p), p).toBe(false);
    expect(isCanonicalPath(root, root + "/scripts/ok.mjs")).toBe(true);
    expect(isCanonicalPath(root, root + "/scripts/x.test.mjs")).toBe(false);
    expect(isCanonicalPath(root, "/elsewhere/evil.ts")).toBe(false);
    // 端到端:紅案 overlay 帶 writer 內容也不改變 union;綠案會
    const writer = 'const conn = { execute: async () => {} };\nawait conn.execute("INSERT INTO adminAuditLog (a) VALUES (1)");\n';
    const redOverlay: Record<string, string> = {};
    for (const p of RED) redOverlay[p] = writer;
    expect(await computeWriterUnion(redOverlay)).toEqual(["scripts/grant-admin.mjs", "server/_core/auditLog.ts"].sort());
    const green = await computeWriterUnion({ [root + "/scripts/__ok__.mjs"]: writer });
    expect(green).toContain("scripts/__ok__.mjs");
  }, 480000);

  it("R18-1 sound 反例三案:拆字串串接/模板片段/字串值內 unicode escape 全數命中(prefilter 不可剪掉)", async () => {
    const { isRawSqlWriterSource } = await getScanner();
    expect(
      isRawSqlWriterSource('const a = "adminAudit";\nconst b = "Log";\nconn.execute("INSERT INTO " + a + b + " (x) VALUES (1)")'),
    ).toBe(true);
    expect(
      isRawSqlWriterSource('const t = `adminAudit${"Log"}`;\nconn.execute(`INSERT INTO ${t} (x) VALUES (1)`)'),
    ).toBe(true);
    expect(
      isRawSqlWriterSource('conn.execute("INSERT INTO adminAudit\\u004Cog (x) VALUES (1)")'),
    ).toBe(true);
  });

  it("R18-3 四副檔名 raw overlay 承重(.js/.jsx/.cjs/.tsx 一次注入,全數進 union)", async () => {
    const root = process.cwd();
    const writer = 'const conn = { execute: async () => {} };\nconn.execute("INSERT INTO adminAuditLog (a) VALUES (1)");\n';
    const union = await computeWriterUnion({
      [root + "/scripts/__m__.js"]: writer,
      [root + "/scripts/__m__.jsx"]: writer,
      [root + "/scripts/__m__.cjs"]: writer,
      [root + "/scripts/__m__.tsx"]: writer,
    });
    for (const ext of ["js", "jsx", "cjs", "tsx"]) expect(union).toContain(`scripts/__m__.${ext}`);
    expect(union).not.toEqual(["scripts/grant-admin.mjs", "server/_core/auditLog.ts"].sort());
  }, 480000);

  it("R19-1 三反例各自過完整 union:拆字串串接/模板片段/字串值內 unicode escape", async () => {
    const { isRawSqlWriterSource } = await getScanner();
    const root = process.cwd();
    const CASES: Array<[string, string]> = [
      [root + "/scripts/__r19_concat__.mjs", 'const a = "adminAudit";\nconst b = "Log";\nconst conn = { execute: async () => {} };\nawait conn.execute("INSERT INTO " + a + b + " (x) VALUES (1)");\n'],
      [root + "/scripts/__r19_tpl__.mjs", 'const t = `adminAudit${"Log"}`;\nconst conn = { execute: async () => {} };\nawait conn.execute(`INSERT INTO ${t} (x) VALUES (1)`);\n'],
      [root + "/scripts/__r19_uni__.mjs", 'const conn = { execute: async () => {} };\nawait conn.execute("INSERT INTO adminAudit\\u004Cog (x) VALUES (1)");\n'],
    ];
    for (const [p, src] of CASES) {
      expect(isRawSqlWriterSource(src, "/scan/" + p.split("/").pop()), p).toBe(true); // helper
      const union = await computeWriterUnion({ [p]: src }); // 完整 union
      expect(union, p).toContain(p.slice(root.length + 1));
      expect(union, p).not.toEqual(["scripts/grant-admin.mjs", "server/_core/auditLog.ts"].sort());
    }
  }, 900000);

  it("R19-2 escaped callee(conn.\\u0065xecute):helper+完整 union 承重;刪 \\u 例外分支必紅", async () => {
    const { isRawSqlWriterSource } = await getScanner();
    const root = process.cwd();
    // 原始碼刻意不含明文 execute/query:唯一能過預過濾的路徑是 \u 例外分支,
    // 刪掉該分支 → 預過濾剪掉 → helper false → 本測試紅(mutation-killer)。
    const src = 'const conn = { ["\\u0065xecute"]: async () => {} };\nawait conn.\\u0065xecute("INSERT INTO adminAuditLog (x) VALUES (1)");\n';
    expect(/execute|query/i.test(src)).toBe(false); // 前提自檢:無明文 callee
    expect(isRawSqlWriterSource(src, "/scan/__r19_esc__.mjs")).toBe(true);
    const p = root + "/scripts/__r19_esc__.mjs";
    const union = await computeWriterUnion({ [p]: src });
    expect(union).toContain("scripts/__r19_esc__.mjs");
  }, 480000);

  it("R18-1 differential proof:全庫 raw 掃描「有/無優化」結果完全等價(R19-3:fresh scanner,雙掃可機械驗證)", async () => {
    // fresh scanner:rawResultMemo 必為空 —— optimized 半邊不可能吃到其他測試
    // 預熱的快取;unoptimized 半邊(optimized=false)完全繞過 memo 讀寫。
    const { isRawSqlWriterSource, walkCanonicalFiles, getRawMemoSize } = await makeCheckerScanner();
    expect(getRawMemoSize()).toBe(0);
    const { readFileSync } = await import("node:fs");
    const root = process.cwd();
    const canonical = walkCanonicalFiles(root);
    const optimized: string[] = [];
    const unoptimized: string[] = [];
    let yc = 0;
    for (const p of canonical) {
      const src = readFileSync(p, "utf8");
      const name = "/scan/" + p.split("/").pop();
      if (isRawSqlWriterSource(src, name, true)) optimized.push(p);
      if (isRawSqlWriterSource(src, name, false)) unoptimized.push(p);
      // unoptimized 半邊每檔都建 mini-Program,同步塊過長會餓死 worker IPC → 讓出
      if (++yc % 10 === 0) await new Promise((r) => setImmediate(r));
    }
    expect(optimized).toEqual(unoptimized); // 剪枝不可靠 → 兩邊不等 → 紅
  }, 900000);

  it("R16-2 端到端突變(.ts Drizzle):經 discovery seam → 同一 exact-two gate 轉紅", async () => {
    const root = process.cwd();
    const union = await computeWriterUnion({
      [root + "/scripts/__mutant__.ts"]:
        'import { adminAuditLog } from "../drizzle/schema";\ndeclare const db: { insert: (t: unknown) => { values: (v: unknown) => void } };\ndb.insert(adminAuditLog).values({});\n',
    });
    expect(union).toContain("scripts/__mutant__.ts");
    expect(union).not.toEqual(["scripts/grant-admin.mjs", "server/_core/auditLog.ts"].sort());
  }, 240000);

  it("R16-2 端到端突變(.mjs Drizzle):TypeChecker discovery 必收 .mjs(raw 旁路不得代打)→ gate 轉紅", async () => {
    const root = process.cwd();
    const union = await computeWriterUnion({
      [root + "/scripts/__mutant__.mjs"]:
        'import { adminAuditLog } from "../drizzle/schema.js";\nconst db = { insert: (t) => ({ values: () => {} }) };\ndb.insert(adminAuditLog).values({});\n',
    });
    expect(union).toContain("scripts/__mutant__.mjs");
    expect(union).not.toEqual(["scripts/grant-admin.mjs", "server/_core/auditLog.ts"].sort());
  }, 240000);

  it("R16-2 端到端突變(combined:.ts+.mjs Drizzle+.mjs raw SQL)→ 全數被抓,gate 轉紅", async () => {
    const root = process.cwd();
    const union = await computeWriterUnion({
      [root + "/scripts/__mutant__.ts"]:
        'import { adminAuditLog } from "../drizzle/schema";\ndeclare const db: { insert: (t: unknown) => { values: (v: unknown) => void } };\ndb.insert(adminAuditLog).values({});\n',
      [root + "/scripts/__mutant__.mjs"]:
        'import { adminAuditLog } from "../drizzle/schema.js";\nconst db = { insert: (t) => ({ values: () => {} }) };\ndb.insert(adminAuditLog).values({});\n',
      [root + "/scripts/__mutant_raw__.mjs"]:
        'const conn = { execute: async () => {} };\nawait conn.execute("INSERT INTO adminAuditLog (a) VALUES (1)");\n',
    });
    expect(union).toContain("scripts/__mutant__.ts");
    expect(union).toContain("scripts/__mutant__.mjs");
    expect(union).toContain("scripts/__mutant_raw__.mjs");
    expect(union).not.toEqual(["scripts/grant-admin.mjs", "server/_core/auditLog.ts"].sort());
  }, 240000);

});
