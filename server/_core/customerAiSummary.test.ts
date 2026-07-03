/**
 * M3 tests (customer-ai-sessions) — customerAiSummary.
 *
 * LLM + context + db are mocked: no Anthropic call, no DB. Covers the pure
 * parse + staleness rules and the generate path (context → LLM → 4 fields).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./customerChatContext", () => ({
  buildCustomerChatContext: vi.fn(),
  buildGuestChatContext: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { invokeLLM } from "./llm";
import { getDb } from "../db";
import {
  buildCustomerChatContext,
  buildGuestChatContext,
} from "./customerChatContext";
import {
  parseSummaryResult,
  isSummaryStale,
  generateCustomerAiSummary,
  buildSummaryUserPrompt,
  pickStaleProfiles,
  resolveSummaryScope,
  ensureProfileId,
  SUMMARY_TTL_MS,
  type ScanRow,
} from "./customerAiSummary";

const invokeLLMMock = vi.mocked(invokeLLM);
const getDbMock = vi.mocked(getDb);

/** Minimal drizzle chain whose terminal .limit() resolves to `rows`. */
function fakeDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

/**
 * Sequenced fake db for ensureProfileId (audit fix, 2026-06-30): each call
 * issues several SELECTs in order (existing-by-userId, then users.email, then
 * guest-by-email), so a single fixed `rows` isn't enough — this pops the next
 * queued result on each terminal `.limit()`/`.where()` call, and records any
 * `.update()`/`.insert()` so the test can assert what was written.
 */
function fakeSequencedDb(selectQueue: unknown[][]) {
  let i = 0;
  const updates: Array<{ table: string; set: unknown }> = [];
  const inserts: Array<{ table: string; values: unknown }> = [];
  // Records which queue index, if any, was reached via .orderBy() — so a test
  // can assert the guest-claim lookup specifically used it (audit fix,
  // 2026-06-30), catching a regression that quietly drops .orderBy() and goes
  // back to non-deterministic ordering (the .limit() path alone would still
  // "work" in this fake, masking exactly that regression).
  const orderedCallIndexes: number[] = [];
  const selectChain: Record<string, unknown> = {};
  selectChain.select = () => selectChain;
  selectChain.from = () => selectChain;
  selectChain.where = () => {
    const idx = i;
    const next = () => Promise.resolve(selectQueue[idx] ?? []);
    return {
      limit: () => {
        i++;
        return next();
      },
      orderBy: () => ({
        limit: () => {
          orderedCallIndexes.push(idx);
          i++;
          return next();
        },
      }),
    };
  };
  return {
    select: () => selectChain,
    update: (table: { _: { name?: string } } | unknown) => ({
      set: (set: unknown) => ({
        where: () => {
          updates.push({ table: String(table), set });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table: String(table), values });
        return Promise.resolve([{ insertId: 9001 }]);
      },
    }),
    __updates: updates,
    __inserts: inserts,
    __orderedCallIndexes: orderedCallIndexes,
  } as any;
}
const buildCustomerChatContextMock = vi.mocked(buildCustomerChatContext);
const buildGuestChatContextMock = vi.mocked(buildGuestChatContext);

function llmResult(content: string) {
  return {
    id: "x",
    created: 0,
    model: "claude-haiku-4-5",
    choices: [{ index: 0, message: { role: "assistant" as const, content }, finish_reason: "stop" }],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("parseSummaryResult", () => {
  it("parses the four fields from JSON", () => {
    const r = parseSummaryResult(
      JSON.stringify({ wants: "12月台灣團", actions: "已報價", delivered: "報價單", nextStep: "補早鳥價" }),
    );
    expect(r).toEqual({
      wants: "12月台灣團",
      actions: "已報價",
      delivered: "報價單",
      nextStep: "補早鳥價",
    });
  });

  it("degrades to empty strings on bad JSON or missing fields", () => {
    expect(parseSummaryResult("not json")).toEqual({
      wants: "",
      actions: "",
      delivered: "",
      nextStep: "",
    });
    expect(parseSummaryResult(JSON.stringify({ wants: 123 }))).toEqual({
      wants: "",
      actions: "",
      delivered: "",
      nextStep: "",
    });
  });
});

describe("isSummaryStale", () => {
  const now = 1_000_000_000_000;
  it("is stale when never generated", () => {
    expect(isSummaryStale(null, null, now)).toBe(true);
  });
  it("is stale past the TTL", () => {
    expect(isSummaryStale(new Date(now - SUMMARY_TTL_MS - 1), null, now)).toBe(true);
  });
  it("is stale when there is newer activity than the summary", () => {
    const gen = new Date(now - 1000);
    const newerActivity = new Date(now - 500);
    expect(isSummaryStale(gen, newerActivity, now)).toBe(true);
  });
  it("is fresh when recent and no newer activity", () => {
    const gen = new Date(now - 1000);
    const olderActivity = new Date(now - 5000);
    expect(isSummaryStale(gen, olderActivity, now)).toBe(false);
  });
});

describe("pickStaleProfiles (cron selection)", () => {
  const now = 2_000_000_000_000;
  const fresh = new Date(now - 1000);
  const old = new Date(now - SUMMARY_TTL_MS - 1000);
  const rows: ScanRow[] = [
    // registered, never computed → stale → {userId}
    { id: 10, userId: 7, lastInteractionAt: fresh, aiSummaryAt: null },
    // guest, summary older than its activity → stale → {profileId}
    { id: 11, userId: null, lastInteractionAt: fresh, aiSummaryAt: old },
    // fresh summary, no newer activity → NOT stale → skipped
    { id: 12, userId: null, lastInteractionAt: old, aiSummaryAt: fresh },
  ];

  it("returns scopes only for stale rows, mapping userId vs profileId", () => {
    const scopes = pickStaleProfiles(rows, now, 50);
    expect(scopes).toEqual([{ userId: 7 }, { profileId: 11 }]);
  });

  it("caps at maxRefresh", () => {
    expect(pickStaleProfiles(rows, now, 1)).toEqual([{ userId: 7 }]);
  });
});

describe("generateCustomerAiSummary", () => {
  it("feeds the guest context to the LLM and returns the parsed summary", async () => {
    buildGuestChatContextMock.mockResolvedValue("【訪客】jenny… 文件:台灣報價");
    invokeLLMMock.mockResolvedValue(
      llmResult(
        JSON.stringify({
          wants: "想要12月台灣團",
          actions: "已寄兩份報價",
          delivered: "台灣12天報價單",
          nextStep: "跟進她對行程的回覆",
        }) as any,
      ) as any,
    );

    const r = await generateCustomerAiSummary({ profileId: 2550004 });
    expect(r.wants).toContain("台灣團");
    expect(r.nextStep).toContain("跟進");
    // context was actually passed into the prompt
    const arg = invokeLLMMock.mock.calls[0][0] as any;
    expect(JSON.stringify(arg.messages)).toContain("台灣報價");
    expect(arg.model).toBe("claude-haiku-4-5");
  });

  it("uses the registered builder for a userId scope", async () => {
    buildCustomerChatContextMock.mockResolvedValue("【客人】#7 …");
    invokeLLMMock.mockResolvedValue(
      llmResult(JSON.stringify({ wants: "a", actions: "b", delivered: "c", nextStep: "d" }) as any) as any,
    );
    await generateCustomerAiSummary({ userId: 7 });
    expect(buildCustomerChatContextMock).toHaveBeenCalledWith(7);
    expect(buildGuestChatContextMock).not.toHaveBeenCalled();
  });

  it("throws when no context (db down / customer gone)", async () => {
    buildGuestChatContextMock.mockResolvedValue(null);
    await expect(generateCustomerAiSummary({ profileId: 1 })).rejects.toThrow();
  });
});

describe("resolveSummaryScope (event-refresh scope)", () => {
  it("uses {userId} for a registered customer's profile (real bookings context)", async () => {
    getDbMock.mockResolvedValueOnce(fakeDb([{ userId: 7 }]) as any);
    expect(await resolveSummaryScope(2550004)).toEqual({ userId: 7 });
  });

  it("stays {profileId} for an email-only guest (no userId)", async () => {
    getDbMock.mockResolvedValueOnce(fakeDb([{ userId: null }]) as any);
    expect(await resolveSummaryScope(2550004)).toEqual({ profileId: 2550004 });
  });

  it("falls back to {profileId} when the DB is down", async () => {
    // default mock resolves null
    expect(await resolveSummaryScope(99)).toEqual({ profileId: 99 });
  });
});

/**
 * ensureProfileId — audit fix (2026-06-30, same bug class as the duplicate
 * Emerald Young customerProfiles row). Before this fix, a registered userId
 * with no profile row yet always INSERTed a fresh one, even when a guest
 * profile (userId IS NULL) already existed under that same email — creating a
 * second row for the same person. Covers all three branches: already has a
 * profile (no-op), claims a matching guest profile (UPDATE, no insert), and
 * truly nothing exists (INSERT).
 */
describe("ensureProfileId (duplicate-profile audit fix)", () => {
  it("a {profileId} scope passes through untouched (no select/update/insert)", async () => {
    const db = fakeSequencedDb([]);
    getDbMock.mockResolvedValueOnce(db as any);
    expect(await ensureProfileId({ profileId: 42 })).toBe(42);
    expect(db.__updates).toHaveLength(0);
    expect(db.__inserts).toHaveLength(0);
  });

  it("returns the existing profile when one is already linked to this userId", async () => {
    getDbMock.mockResolvedValueOnce(
      fakeSequencedDb([[{ id: 5 }]]) as any, // existing-by-userId hit
    );
    expect(await ensureProfileId({ userId: 7 })).toBe(5);
  });

  it("claims a pre-existing GUEST profile by email (UPDATE, never a duplicate INSERT)", async () => {
    const db = fakeSequencedDb([
      [], // no profile linked to userId yet
      [{ email: "mei@example.com" }], // users.email lookup
      [{ id: 88 }], // guest profile found by email, userId IS NULL
    ]);
    getDbMock.mockResolvedValueOnce(db as any);
    const id = await ensureProfileId({ userId: 7 });
    expect(id).toBe(88);
    expect(db.__updates).toHaveLength(1);
    expect(db.__updates[0].set).toEqual({ userId: 7 });
    expect(db.__inserts).toHaveLength(0); // the regression this fix prevents
    // the guest-claim lookup (3rd select, index 2) must go through .orderBy()
    // — catches a regression that quietly drops it (verification-pass catch,
    // 2026-06-30): without it, claiming among 2+ duplicate guest rows is
    // non-deterministic and can grab a thin new duplicate over the real one.
    expect(db.__orderedCallIndexes).toEqual([2]);
  });

  it("claims the OLDEST guest profile when several already share the email — the exact corrupted state this audit-fix family targets", async () => {
    // The fake can't re-sort for us (it just returns what's queued for that
    // call); this asserts the function (a) actually issues the lookup via
    // .orderBy() and (b) returns whatever that ordered query's first row is —
    // i.e. it trusts the DB's ORDER BY, not a hand-picked array index.
    const db = fakeSequencedDb([
      [], // no profile linked to userId
      [{ email: "dup@axt.com" }], // users.email lookup
      [{ id: 16016 }], // ORDER BY createdAt ASC LIMIT 1 → the oldest of several dup guest rows
    ]);
    getDbMock.mockResolvedValueOnce(db as any);
    const id = await ensureProfileId({ userId: 9 });
    expect(id).toBe(16016);
    expect(db.__orderedCallIndexes).toEqual([2]);
  });

  it("inserts a fresh profile only when no guest profile exists for the email either", async () => {
    const db = fakeSequencedDb([
      [], // no profile linked to userId
      [{ email: "new@example.com" }], // users.email lookup
      [], // no guest profile under that email
    ]);
    getDbMock.mockResolvedValueOnce(db as any);
    const id = await ensureProfileId({ userId: 7 });
    expect(id).toBe(9001);
    expect(db.__inserts).toHaveLength(1);
  });

  it("returns null when the DB is unavailable", async () => {
    // default beforeEach mock resolves null
    expect(await ensureProfileId({ userId: 7 })).toBeNull();
  });

  it("2026-07-03 任務7 對抗審查 P0 — a concurrent request wins the uq_cp_user insert race: recovers the winner's id instead of throwing or creating a duplicate row", async () => {
    let selectCall = 0;
    const selectResults: unknown[][] = [
      [], // 1. existing profile linked to userId → none
      [{ email: "race@example.com" }], // 2. users.email lookup
      [], // 3. guest-by-email claim lookup → none to claim
      [{ id: 555 }], // 4. insertCustomerProfileSafely's race-recovery re-select by userId
      [{ next: null }], // 5. followMergePointer's own select — no pointer, already canonical
    ];
    const dupErr = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    });
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectResults[selectCall++] ?? []),
            orderBy: () => ({
              limit: () => Promise.resolve(selectResults[selectCall++] ?? []),
            }),
          }),
        }),
      }),
      insert: () => ({
        values: () => Promise.reject(dupErr),
      }),
    };
    getDbMock.mockResolvedValueOnce(db as any);
    const id = await ensureProfileId({ userId: 42 });
    expect(id).toBe(555);
  });
});

describe("buildSummaryUserPrompt — 日期 grounding(2026-07-02 年份幻覺)", () => {
  // 真實案例:2026-07-02 收到講「12/19-12/26」的來信(客人沒寫年份),
  // 摘要寫成「2024/12/19-12/26」— 模型自己編了一個過去年份。prompt 開頭
  // 必須先給今天日期 + 「推最近的未來年份」指示。
  it("開頭帶入今天日期與未來年份指示", () => {
    const p = buildSummaryUserPrompt("【系統事實】...", "【對話】...", "2026-07-02");
    expect(p.startsWith("今天日期(美西):2026-07-02。")).toBe(true);
    expect(p).toContain("最近的未來年份");
    expect(p).toContain("不要編成過去的年份");
  });

  it("ledger 與 context 原樣墊在後面(grounding 不動素材)", () => {
    const p = buildSummaryUserPrompt("LEDGER-X", "CONTEXT-Y", "2026-07-02");
    expect(p).toContain("LEDGER-X");
    expect(p).toContain("CONTEXT-Y");
    expect(p).toContain("nextStep 必須跟「系統事實」一致");
  });

  it("today 不傳時用美西當日(YYYY-MM-DD 形狀)", () => {
    const p = buildSummaryUserPrompt("l", "c");
    expect(p).toMatch(/^今天日期\(美西\):\d{4}-\d{2}-\d{2}。/);
  });
});
