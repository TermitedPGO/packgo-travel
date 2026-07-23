/**
 * clientBoot.report —— 1A0a boot telemetry server Interface(plan v4.3 §3.2.9)。
 *
 * 契約:admin-authenticated;closed payload(.strict():buildSha regex+clientKind
 * 二值 enum,拒自由文字/額外欄位/PII);同 (userId, buildSha, clientKind) 24h
 * best-effort 去重;寫既有 append-only adminAuditLog(audit());durable ack =
 * exact re-query 且 rowHash 非 null(hash-chain 完成)才回 reported。
 *
 * 真 predicate 評估(Codex 7-18 15:56 窄修 5):DB stub 不再無視 where —— 以
 * MySqlDialect 把 production code 實際組出的 predicate 渲染成 SQL+params,對
 * in-memory rows 逐條求值。因此:
 * - 移除 clientBoot.ts 的 isNotNull(rowHash) → 「rowHash-null 孤列」測試紅
 *   (dedup 誤中孤列 / re-query 誤認 hash 未完成的列)。
 * - 把 durable re-query 改 findRow(false) → 「insert 成功、hash update 失敗」
 *   測試紅(該列 rowHash 為 null,仍被回 reported)。
 * - eq/gte/like 條件也一併承重(不同 clientKind / 過期 24h / 不同 user 均不得
 *   dedup)。
 * audit() mock 真的往 store 插列(rowHash 可設 null 模擬 insert 成功但
 * hash-chain update 失敗 —— auditLog.ts 兩階段 insert→update 的失敗模式)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

type Row = {
  id: number;
  action: string;
  userId: number;
  createdAt: Date;
  changes: string;
  rowHash: string | null;
};

const h = vi.hoisted(() => ({
  store: [] as Array<{
    id: number; action: string; userId: number; createdAt: Date;
    changes: string; rowHash: string | null;
  }>,
  nextId: 1,
  /** audit() 行為:chained=insert+hash 完成;hash-update-failed=insert 成功但
   *  rowHash 留 null(update 被吞);swallowed=整個寫入被吞(無列)。 */
  auditMode: "chained" as "chained" | "hash-update-failed" | "swallowed",
}));

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../_core/auditLog", () => ({
  audit: vi.fn(async (input: { ctx: { user: { id: number } }; action: string; changes: unknown }) => {
    // setTimeout(macrotask):讓併發測試裡兩個 caller 的 dedup select(microtask)
    // 都先於任何 insert 完成 —— 決定性重現「select-then-audit 非原子」時序。
    await new Promise((r) => setTimeout(r, 0));
    if (h.auditMode === "swallowed") return; // audit 吞掉寫入失敗(既有語意)
    h.store.push({
      id: h.nextId++,
      action: input.action,
      userId: input.ctx.user.id,
      createdAt: new Date(),
      changes: JSON.stringify(input.changes),
      rowHash: h.auditMode === "hash-update-failed" ? null : "f".repeat(64),
    });
  }),
}));
vi.mock("../rateLimit", () => ({
  checkAdminMutationRateLimit: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 99, resetAt: 0 }),
  ),
}));

import { clientBootRouter } from "./clientBoot";
import { getDb } from "../db";
import { audit } from "../_core/auditLog";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const dialect = new MySqlDialect();

/**
 * 對 production 組出的 where predicate 真求值:渲染成 MySQL 文本+params,支援
 * 本 router 用到的 = / >= / like / is not null;遇到沒教過的條件直接 throw
 * (fail-closed:predicate 形狀變了測試要跟著擴充,不准靜默放行)。
 */
function matchesPredicate(pred: SQL, row: Row): boolean {
  const { sql, params } = dialect.sqlToQuery(pred);
  let text = sql.trim();
  if (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1);
  let pi = 0;
  for (const raw of text.split(/ and /i)) {
    const cond = raw.trim();
    const m = cond.match(/^`adminAuditLog`\.`(\w+)`\s+(is not null|>=|=|like)\s*(\?)?$/i);
    if (!m) throw new Error(`predicate 條件無法評估(測試需擴充): ${cond}`);
    const col = m[1] as keyof Row;
    const op = m[2].toLowerCase();
    const val = row[col];
    if (op === "is not null") {
      if (val === null || val === undefined) return false;
      continue;
    }
    const param = params[pi++];
    if (op === "=") {
      if (String(val) !== String(param)) return false;
    } else if (op === ">=") {
      // drizzle MySQL driver 對 timestamp param 給的是 UTC wall-clock 字串
      // ("YYYY-MM-DD HH:MM:SS.mmm",無時區標記);裸 new Date() 會被 V8 當本地
      // 時間解析,在非 UTC 時區把 24h 視窗平移 —— 必須明確補 Z 以 UTC 解析,
      // 測試才可跨時區移植(TZ=UTC / Asia/Taipei / PDT 皆準確)。
      const asUtc = (v: unknown): number => {
        if (v instanceof Date) return v.getTime();
        const s = String(v);
        return new Date(/^\d{4}-\d{2}-\d{2} /.test(s) ? s.replace(" ", "T") + "Z" : s).getTime();
      };
      if (!(asUtc(val) >= asUtc(param))) return false;
    } else if (op === "like") {
      const reStr =
        "^" +
        String(param)
          .split("")
          .map((ch) => (ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
          .join("") +
        "$";
      if (!new RegExp(reStr, "s").test(String(val ?? ""))) return false;
    }
  }
  return true;
}

/** drizzle select 鏈 stub:where 的 predicate 真的過濾 in-memory store。 */
function makeDb() {
  return {
    select: () => ({
      from: () => ({
        where: (pred: SQL) => ({
          limit: (n: number) =>
            Promise.resolve(
              h.store.filter((r) => matchesPredicate(pred, r)).slice(0, n).map((r) => ({ id: r.id })),
            ),
        }),
      }),
    }),
  };
}

function makeAdminContext(userId = 1) {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: { id: userId, role: "admin", email: "admin@test" },
    ip: "127.0.0.1",
  };
}

const seed = (over: Partial<Row> = {}) => {
  h.store.push({
    id: h.nextId++,
    action: "clientBoot.report",
    userId: 1,
    createdAt: new Date(),
    changes: JSON.stringify({ buildSha: SHA, clientKind: "desktop-browser" }),
    rowHash: "a".repeat(64),
    ...over,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.store.length = 0;
  h.nextId = 1;
  h.auditMode = "chained";
  (getDb as any).mockResolvedValue(makeDb());
});

describe("clientBoot.report — closed payload", () => {
  it("非法 buildSha(自由文字)拒", async () => {
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    await expect(
      caller.report({ buildSha: "not-a-sha!", clientKind: "desktop-browser" }),
    ).rejects.toThrow();
    expect(audit).not.toHaveBeenCalled();
  });

  it("非法 clientKind 拒(closed enum 二值)", async () => {
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    await expect(
      caller.report({ buildSha: SHA, clientKind: "smart-fridge" }),
    ).rejects.toThrow();
  });

  it("額外欄位拒(.strict(),防 PII 夾帶)", async () => {
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    await expect(
      caller.report({ buildSha: SHA, clientKind: "desktop-browser", email: "x@y.z" }),
    ).rejects.toThrow();
  });
});

describe("clientBoot.report — 寫入與 durable ack(真 predicate 評估)", () => {
  it("首報:audit 插列(hash 完成)→ re-query 命中 → reported", async () => {
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "pwa-standalone" });
    expect(r.status).toBe("reported");
    expect(audit).toHaveBeenCalledTimes(1);
    const arg = (audit as any).mock.calls[0][0];
    expect(arg.action).toBe("clientBoot.report");
    expect(arg.changes).toEqual({ buildSha: SHA, clientKind: "pwa-standalone" });
    expect(h.store).toHaveLength(1);
  });

  it("audit 整筆吞錯(無列落盤)→ failed,client 可重試(P2-1)", async () => {
    h.auditMode = "swallowed";
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "pwa-standalone" });
    expect(r.status).toBe("failed");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("insert 成功但 hash-chain update 失敗(列在、rowHash=null)→ failed,不得回 reported(15:56 窄修5)", async () => {
    // 真模擬兩階段失敗:audit 真的插了一列,但 rowHash 留 null。
    // re-query 若不要求 isNotNull(rowHash)(findRow(false))就會命中此列而誤回
    // reported —— 該突變會讓本測試紅。
    h.auditMode = "hash-update-failed";
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("failed");
    expect(h.store).toHaveLength(1); // 列確實存在 —— failed 是因 hash 未完成,不是沒插列
    expect(h.store[0].rowHash).toBeNull();
  });

  it("重試補救:前次 hash-update 失敗的 rowHash-null 孤列不得擋 dedup;重試插好列 → reported", async () => {
    // 移除 dedup 查詢的 isNotNull(rowHash) → 孤列被誤當 existing → deduped → 紅。
    seed({ rowHash: null });
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("reported");
    expect(audit).toHaveBeenCalledTimes(1);
    expect(h.store).toHaveLength(2);
  });

  it("24h 內同 (user, sha, kind) 已有 hash 完成列 → deduped,不重寫", async () => {
    seed();
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("deduped");
    expect(audit).not.toHaveBeenCalled();
  });

  it("dedup 條件真承重:不同 clientKind 不 dedup(like %kind% 生效)", async () => {
    seed({ changes: JSON.stringify({ buildSha: SHA, clientKind: "pwa-standalone" }) });
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("reported");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("dedup 條件真承重:超過 24h 的舊列不 dedup(gte createdAt 生效)", async () => {
    seed({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("reported");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("dedup 視窗下界:23h 前的列仍 dedup(視窗縮短型突變會紅)", async () => {
    seed({ createdAt: new Date(Date.now() - 23 * 60 * 60 * 1000) });
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("deduped");
    expect(audit).not.toHaveBeenCalled();
  });

  it("dedup 條件真承重:同 user/sha/kind 但不同 action 的 audit 列不得 dedup(eq action 生效)", async () => {
    // 其他 admin 操作的 changes JSON 若碰巧含同樣 sha+kind 字串,不得壓掉 boot 上報
    // —— 整條移除 eq(action) 會使本測試紅。
    seed({ action: "tour.update" });
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("reported");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("dedup 條件真承重:別的 user 的列不 dedup(eq userId 生效)", async () => {
    seed({ userId: 99 });
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("reported");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("dedup 條件真承重:不同 buildSha 不 dedup(like %sha% 生效)", async () => {
    seed({ changes: JSON.stringify({ buildSha: "9".repeat(40), clientKind: "desktop-browser" }) });
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("reported");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("best-effort dedup:併發兩報都先查到空 → 各寫一列,兩列無害(P2-2 誠實降級)", async () => {
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const [a, b] = await Promise.all([
      caller.report({ buildSha: SHA, clientKind: "desktop-browser" }),
      caller.report({ buildSha: SHA, clientKind: "desktop-browser" }),
    ]);
    expect(a.status).toBe("reported");
    expect(b.status).toBe("reported");
    // 非原子:允許兩列 —— 換版證據判準是「每 clientKind ≥1 列」,重複列不影響
    expect(audit).toHaveBeenCalledTimes(2);
    expect(h.store).toHaveLength(2);
  });

  it("rate limit denied → throw(adminProcedure 既有 limiter,regression)", async () => {
    const { checkAdminMutationRateLimit } = await import("../rateLimit");
    (checkAdminMutationRateLimit as any).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    await expect(
      caller.report({ buildSha: SHA, clientKind: "desktop-browser" }),
    ).rejects.toThrow();
    expect(audit).not.toHaveBeenCalled();
  });

  it("DB 不可用 → skipped(不偽裝成功、不 throw 阻塞 admin 頁;client 不寫 guard 可重試)", async () => {
    (getDb as any).mockResolvedValue(null);
    const caller = (clientBootRouter as any).createCaller(makeAdminContext());
    const r = await caller.report({ buildSha: SHA, clientKind: "desktop-browser" });
    expect(r.status).toBe("skipped");
    expect(audit).not.toHaveBeenCalled();
  });

  it("非 admin 拒(adminProcedure)", async () => {
    const caller = (clientBootRouter as any).createCaller({
      ...makeAdminContext(),
      user: { id: 2, role: "user" },
    });
    await expect(
      caller.report({ buildSha: SHA, clientKind: "desktop-browser" }),
    ).rejects.toThrow();
  });
});
