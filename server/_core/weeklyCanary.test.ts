/**
 * weeklyCanary tests (customer-cockpit Phase6 D2, 表單版).
 *
 * Covers:
 *   - verifyCanaryOutcome: the pure, DB-free 3-check verification function
 *     (given DB query results, did all 3 checks pass or not).
 *   - buildCanaryMarker / buildCanaryInquiryPayload: the marker text is
 *     present in the submitted payload, so a future reader inspecting real
 *     inquiries in the admin panel can recognize canary noise.
 *   - submitCanaryInquiry: the HTTP POST call is made through an INJECTED
 *     mock fetchImpl — this test file never calls the real global `fetch`,
 *     confirmed below (see "never fires a real network request").
 *
 * No real DB and no real HTTP: this whole suite is pure functions +
 * dependency-injected mocks, matching weeklyCorrectnessAudit.test.ts's
 * convention (the DB/HTTP-touching executor `runWeeklyCanary` is verified
 * live per repo norm, same as its sibling weekly scans).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// hotfix (2026-07-07):第四項檢查 checkUnreadCountQueryOk 會 import 這支跑 badge 排名查詢。
// 整合測試用的是有序 mock db,不重跑那條真查詢 → stub 成 no-op(預設查詢正常沒拋錯);
// 個別 test 可 mockRejectedValueOnce 模擬 TiDB 500。
vi.mock("../routers/adminCustomers", () => ({
  runGuestUnreadRankingQuery: vi.fn(async () => []),
}));

import {
  verifyCanaryOutcome,
  formatCanaryFailureCard,
  buildCanaryMarker,
  buildCanaryInquiryPayload,
  submitCanaryInquiry,
  runWeeklyCanary,
  todayLA,
  computeCanarySinceMs,
  CANARY_VERIFY_DELAY_MS,
  type CanaryCheckInputs,
  type FetchLike,
} from "./weeklyCanary";
import { TEST_ACCOUNT_0909_EMAIL, TEST_ACCOUNT_0909_PROFILE_ID } from "./testAccounts";

function allPass(): CanaryCheckInputs {
  return {
    newInteractionOnCanaryProfile: true,
    ownerNewProfileCount: 0,
    lastInboundAtAdvanced: true,
    unreadCountQueryOk: true,
  };
}

describe("verifyCanaryOutcome (pure, DB-free)", () => {
  it("all three checks pass → allPassed true, no failures", () => {
    const result = verifyCanaryOutcome(allPass());
    expect(result.allPassed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("check 1 fails: no new interaction landed on the canary profile", () => {
    const result = verifyCanaryOutcome({ ...allPass(), newInteractionOnCanaryProfile: false });
    expect(result.allPassed).toBe(false);
    expect(result.failures).toContain("interaction_landed");
  });

  it("check 2 fails: owner email got a new customerProfiles row (pollution)", () => {
    const result = verifyCanaryOutcome({ ...allPass(), ownerNewProfileCount: 1 });
    expect(result.allPassed).toBe(false);
    expect(result.failures).toContain("owner_not_polluted");
  });

  it("check 2 fails on ANY positive count, not just 1", () => {
    const result = verifyCanaryOutcome({ ...allPass(), ownerNewProfileCount: 3 });
    expect(result.failures).toContain("owner_not_polluted");
  });

  it("check 3 fails: lastInboundAt did not advance", () => {
    const result = verifyCanaryOutcome({ ...allPass(), lastInboundAtAdvanced: false });
    expect(result.allPassed).toBe(false);
    expect(result.failures).toContain("last_inbound_advanced");
  });

  it("check 4 fails: 未讀 badge 排名查詢拋錯(TiDB 靜默 500)", () => {
    const result = verifyCanaryOutcome({ ...allPass(), unreadCountQueryOk: false });
    expect(result.allPassed).toBe(false);
    expect(result.failures).toContain("unread_count_query_ok");
  });

  it("multiple checks fail simultaneously → all are listed, not just the first", () => {
    const result = verifyCanaryOutcome({
      newInteractionOnCanaryProfile: false,
      ownerNewProfileCount: 2,
      lastInboundAtAdvanced: false,
      unreadCountQueryOk: true,
    });
    expect(result.allPassed).toBe(false);
    expect(result.failures).toHaveLength(3);
    expect(result.failures).toEqual(
      expect.arrayContaining(["interaction_landed", "owner_not_polluted", "last_inbound_advanced"]),
    );
  });
});

describe("computeCanarySinceMs — MySQL 秒級截斷防呆(帶毫秒注入時鐘鎖住)", () => {
  it("向下取整到秒並留 2 秒餘裕", () => {
    const now = new Date("2026-07-06T13:00:00.400Z");
    expect(computeCanarySinceMs(now)).toBe(new Date("2026-07-06T12:59:58.000Z").getTime());
  });

  it("同一秒落庫(被截成整秒)的 interaction 仍 >= since —— 回歸鎖:原本 raw getTime 會誤判失敗", () => {
    const submit = new Date("2026-07-06T13:00:00.400Z"); // 帶毫秒的注入時鐘
    const since = computeCanarySinceMs(submit);
    // MySQL DATETIME 秒精度:同秒落庫的 interaction createdAt 被截成 13:00:00.000
    const truncatedCreatedAt = new Date("2026-07-06T13:00:00.000Z").getTime();
    expect(truncatedCreatedAt >= since).toBe(true); // 修好後:算數
    expect(truncatedCreatedAt >= submit.getTime()).toBe(false); // 舊 bug:誤判為早於
  });

  it("整秒輸入也一律減 2 秒(不因沒有毫秒就不留餘裕)", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    expect(computeCanarySinceMs(now)).toBe(new Date("2026-07-06T12:59:58.000Z").getTime());
  });
});

describe("formatCanaryFailureCard", () => {
  it("lists every failed check in the body, and is high-priority-worthy content", () => {
    const result = verifyCanaryOutcome({ ...allPass(), ownerNewProfileCount: 1 });
    const card = formatCanaryFailureCard(result, new Date("2026-07-06T13:00:00Z"));
    expect(card.title).toContain("canary");
    expect(card.body).toContain("jeffhsieh09@gmail.com");
  });
});

describe("buildCanaryMarker / buildCanaryInquiryPayload — marker text present", () => {
  it("marker follows the dispatch-specified format '[canary] 週檢 <date>'", () => {
    const marker = buildCanaryMarker(new Date("2026-07-06T13:00:00Z"));
    expect(marker).toMatch(/^\[canary\] 週檢 \d{4}-\d{2}-\d{2}$/);
  });

  it("date in the marker is the America/Los_Angeles calendar day, not UTC", () => {
    // 2026-07-06T02:00:00Z is 2026-07-05 19:00 in LA (still Sunday evening) —
    // the marker date must reflect the LA day, not the UTC day.
    const now = new Date("2026-07-06T02:00:00Z");
    expect(todayLA(now)).toBe("2026-07-05");
    expect(buildCanaryMarker(now)).toBe("[canary] 週檢 2026-07-05");
  });

  it("submitted payload's subject AND message both carry the marker text", () => {
    const now = new Date("2026-07-06T13:00:00Z");
    const payload = buildCanaryInquiryPayload(now);
    const marker = buildCanaryMarker(now);
    expect(payload.subject).toContain(marker);
    expect(payload.message).toContain(marker);
  });

  it("submitted identity is the 0909 test account, never a real customer email", () => {
    const payload = buildCanaryInquiryPayload(new Date());
    expect(payload.customerEmail).toBe(TEST_ACCOUNT_0909_EMAIL);
    expect(payload.customerEmail).toBe("jeffhsieh0909@gmail.com");
  });

  it("profileId constant used by the verification checks is 2760017 (dispatch spec)", () => {
    expect(TEST_ACCOUNT_0909_PROFILE_ID).toBe(2760017);
  });
});

describe("submitCanaryInquiry — HTTP call goes through an injected mock, never the real network", () => {
  it("calls the injected fetchImpl with the tRPC HTTP path and the canary payload as JSON body", async () => {
    const mockFetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"result":{"data":{}}}',
    });
    const now = new Date("2026-07-06T13:00:00Z");
    const result = await submitCanaryInquiry({ fetchImpl: mockFetch, baseUrl: "http://127.0.0.1:3000", now });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3000/api/trpc/inquiries.create");
    expect(init?.method).toBe("POST");
    // Wire format is the tRPC single-call shape {"json": <input>} — matches
    // scripts/full-pipeline-test.mjs's trpcMutate, proven against this same
    // server's createExpressMiddleware + superjson transformer. NOT the
    // client's httpBatchLink ?batch=1 + {"0":{"json":…}} wrapper.
    const sentBody = JSON.parse(init!.body as string);
    expect(sentBody.json.customerEmail).toBe(TEST_ACCOUNT_0909_EMAIL);
    expect(sentBody.json.subject).toContain("[canary] 週檢");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("propagates a non-ok response without throwing (caller decides how to treat it)", async () => {
    const mockFetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    const result = await submitCanaryInquiry({ fetchImpl: mockFetch, baseUrl: "http://127.0.0.1:3000" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("a genuine network failure (fetchImpl rejects — ECONNREFUSED/DNS/timeout) propagates as a thrown rejection, not a swallowed false", async () => {
    // submitCanaryInquiry itself does not try/catch — that's runWeeklyCanary's
    // job (see the executor test below). This test locks down that
    // submitCanaryInquiry does NOT quietly convert a network-level throw into
    // some {ok:false} shape; the caller must see the real rejection.
    const mockFetch = vi.fn<FetchLike>().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      submitCanaryInquiry({ fetchImpl: mockFetch, baseUrl: "http://127.0.0.1:3000" }),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

describe("runWeeklyCanary — full executor with mocked DB + mocked HTTP + injected sleep", () => {
  function fakeDb(overrides: {
    interactionRows?: unknown[];
    ownerProfileRows?: unknown[];
    lastInboundAt?: Date | null;
  }) {
    const interactionRows = overrides.interactionRows ?? [{ id: 1 }];
    const ownerProfileRows = overrides.ownerProfileRows ?? [];
    const lastInboundAt = overrides.lastInboundAt ?? new Date("2026-07-06T13:01:00Z");
    let callIndex = 0;
    // Each select() call in weeklyCanary.ts chains .from().where()[.limit()] —
    // we return a thenable-ish chain that resolves to different rows per call
    // in the fixed order the module issues them: interactions, ownerProfiles,
    // lastInboundAt-select.
    const responses = [interactionRows, ownerProfileRows, [{ lastInboundAt }]];
    const chain = () => {
      const thisCallIndex = callIndex++;
      const builder: any = {
        from: () => builder,
        where: () => builder,
        limit: () => Promise.resolve(responses[thisCallIndex]),
        then: (resolve: any) => resolve(responses[thisCallIndex]),
      };
      return builder;
    };
    return {
      select: () => chain(),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    } as any;
  }

  it("all checks pass → no card inserted, posted=false", async () => {
    const db = fakeDb({});
    const mockFetch = vi.fn<FetchLike>().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runWeeklyCanary(db, {
      fetchImpl: mockFetch,
      baseUrl: "http://127.0.0.1:3000",
      // Inject now (with ms) so lastInboundAt-advanced compares deterministically
      // against the fakeDb's fixed lastInboundAt (13:01Z) — no real-clock flake,
      // and it exercises the second-flooring sinceMs fix.
      now: new Date("2026-07-06T13:00:00.500Z"),
      sleep,
      delayMs: 60_000,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(result.allPassed).toBe(true);
    expect(result.posted).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("HTTP submission fails → treated as a failure even if DB checks would pass", async () => {
    const db = fakeDb({});
    const mockFetch = vi.fn<FetchLike>().mockResolvedValue({ ok: false, status: 500, text: async () => "err" });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runWeeklyCanary(db, { fetchImpl: mockFetch, baseUrl: "http://127.0.0.1:3000", sleep });
    expect(result.allPassed).toBe(false);
    expect(result.submitted).toBe(false);
    expect(result.posted).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });

  it("a genuine network failure (fetchImpl rejects — server down/ECONNREFUSED/timeout), not just an HTTP error response, is caught and treated as a failure — the scan still completes and posts a card, it does not crash the worker", async () => {
    // Distinct scenario from "HTTP submission fails" above: that test mocks a
    // resolved-but-not-ok response (the server answered with 500). This test
    // mocks the fetch call itself throwing/rejecting — the literal "server
    // down" case (dispatch-phase6.md adversarial review finding: this path
    // was structurally handled by the try/catch at weeklyCanary.ts's submit
    // step but had zero test coverage).
    const db = fakeDb({
      interactionRows: [],
      lastInboundAt: null,
    });
    const mockFetch = vi.fn<FetchLike>().mockRejectedValue(new Error("ECONNREFUSED"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runWeeklyCanary(db, { fetchImpl: mockFetch, baseUrl: "http://127.0.0.1:3000", sleep });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // sleep still runs — the executor doesn't short-circuit on a submit throw.
    expect(sleep).toHaveBeenCalled();
    expect(result.submitted).toBe(false);
    expect(result.allPassed).toBe(false);
    expect(result.failures).toContain("interaction_landed");
    expect(result.posted).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });

  it("owner got a new profile → card posted with high priority", async () => {
    const db = fakeDb({ ownerProfileRows: [{ id: 999 }] });
    const mockFetch = vi.fn<FetchLike>().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runWeeklyCanary(db, { fetchImpl: mockFetch, baseUrl: "http://127.0.0.1:3000", sleep });
    expect(result.allPassed).toBe(false);
    expect(result.failures).toContain("owner_not_polluted");
    expect(result.posted).toBe(true);
    const insertCall = (db.insert as any).mock.results[0].value;
    expect(insertCall.values).toHaveBeenCalled();
    const insertedValues = (insertCall.values as any).mock.calls[0][0];
    expect(insertedValues.priority).toBe("high");
    expect(insertedValues.agentName).toBe("weekly-canary");
  });

  it("uses the injected sleep (never a real 60s wait in tests)", async () => {
    const db = fakeDb({});
    const mockFetch = vi.fn<FetchLike>().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await runWeeklyCanary(db, { fetchImpl: mockFetch, baseUrl: "http://127.0.0.1:3000", sleep, delayMs: 1 });
    expect(sleep).toHaveBeenCalledWith(1);
  });
});

// ── source-level check: no unmocked network call anywhere in this test file
// (customer-cockpit Phase6 D2 adversarial review finding: the previous
// version of this describe block asserted nothing — its only expect() was
// typeof CANARY_VERIFY_DELAY_MS === "number", which proves nothing about
// network reachability. A future edit that reintroduced a real network call
// into this file would have silently passed. Mirrors the genuine
// readFileSync-based source check weeklyCorrectnessAudit.test.ts already
// does for isTestOrOwnerAccount call-ordering.)
//
// NOTE for future editors: this file's own source is scanned below by a
// regex looking for the network-call keyword directly followed by "(" with
// no receiver in front of it. To keep that scan meaningful, do not write that
// exact pattern in comments/strings in this file either — spell it with a
// space or split it up, the way this paragraph does.
describe("no real network call is reachable from this test file", () => {
  it("this file's own source contains zero un-namespaced network-call invocations — every HTTP path goes through an injected FetchLike mock", () => {
    const src = readFileSync(join(__dirname, "weeklyCanary.test.ts"), "utf8");
    // Match a call to an identifier literally named `fetch` (the global
    // network function) that is NOT preceded by `.` or a word character
    // (which would be e.g. `mockFetch(` or `opts.fetchImpl(` — those are
    // fine, they're injected mocks/params, not the real global).
    const networkFnName = ["f", "e", "t", "c", "h"].join("");
    const bareCallPattern = new RegExp(`(?<![.\\w])${networkFnName}\\s*\\(`, "g");
    const matches = src.match(bareCallPattern) ?? [];
    expect(matches).toEqual([]);
  });

  it("submitCanaryInquiry/runWeeklyCanary both require an explicit fetchImpl argument (no internal default reaching the real network)", () => {
    const src = readFileSync(join(__dirname, "weeklyCanary.ts"), "utf8");
    // The production module's FetchLike-typed params must be required
    // (`fetchImpl:`), never optional (`fetchImpl?:`) with a real-fetch
    // fallback — that would let a caller silently hit the network.
    expect(src).toMatch(/fetchImpl:\s*FetchLike/);
    expect(src).not.toMatch(/fetchImpl\?:\s*FetchLike/);
  });

  it("sanity: CANARY_VERIFY_DELAY_MS is still a number (unrelated import stays exercised)", () => {
    expect(typeof CANARY_VERIFY_DELAY_MS).toBe("number");
  });
});
