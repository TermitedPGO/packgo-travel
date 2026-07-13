/**
 * gmail-intake-ledger Task 02 — mock dry-run tests for the two READ-ONLY tools.
 * Imports the pure cores from the .mjs files (importing does NOT run main() —
 * the `process.argv[1] === import.meta.url` guard is false under vitest), so
 * these exercise the report logic with fake data and NEVER touch Gmail/DB.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs has no type declarations; runtime import is fine.
import { buildBackfillReport, senderDomain } from "./gmail-backfill-dryrun.mjs";
// @ts-expect-error — .mjs has no type declarations.
import { classifyFailed } from "./gmail-failed-classify.mjs";

const NOW = 1_780_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("gmail-backfill-dryrun — buildBackfillReport (de-identified, read-only)", () => {
  it("de-identifies sender to domain only + flags 14-day priority + thread-level alreadyFiled", () => {
    const messages = [
      { id: "mEmerald", threadId: "tEmerald", from: "Emerald Wu <emerald@icloud.com>", internalDateMs: NOW - 3 * DAY },
      { id: "mOld", threadId: "tOld", from: "old@example.com", internalDateMs: NOW - 25 * DAY },
      { id: "mFiled", threadId: "tFiled", from: "known@company.com", internalDateMs: NOW - 2 * DAY },
    ];
    const report = buildBackfillReport({
      messages,
      knownThreadIds: new Set(["tFiled"]),
      nowMs: NOW,
    });

    expect(report.total).toBe(3);
    // Emerald 信必須命中 the report (it is unprocessed + in-window).
    const emerald = report.rows.find((r: any) => r.id === "mEmerald");
    expect(emerald).toBeDefined();
    // sender is domain-only — the local part never appears.
    expect(emerald.fromDomain).toBe("icloud.com");
    expect(JSON.stringify(report)).not.toContain("emerald@");
    // 3 days old → priority; 25 days old → not.
    expect(emerald.priority).toBe(true);
    expect(report.rows.find((r: any) => r.id === "mOld").priority).toBe(false);
    expect(report.priorityCount).toBe(2); // mEmerald + mFiled
    // thread-level filed proxy.
    expect(report.rows.find((r: any) => r.id === "mFiled").alreadyFiled).toBe(true);
    expect(report.notYetFiledCount).toBe(2);
  });

  it("senderDomain handles bare + angle-bracket + malformed", () => {
    expect(senderDomain("a@b.com")).toBe("b.com");
    expect(senderDomain("Name <x@sub.domain.org>")).toBe("sub.domain.org");
    expect(senderDomain("garbage")).toBe("(unknown)");
  });
});

describe("gmail-failed-classify — classifyFailed (honest, read-only)", () => {
  it("pre-ledger: reports the counter dimension + marks finer dims as unavailable, never fabricates", () => {
    const report = classifyFailed({
      integrations: [
        { emailAddress: "jeffhsieh09@gmail.com", messagesFailed: 136 },
        { emailAddress: "support@packgoplay.com", messagesFailed: 0 },
      ],
      ledgerRows: [],
    });
    expect(report.availableNow.totalFailedCounter).toBe(136);
    expect(report.availableNow.perMailbox[0].mailboxDomain).toBe("gmail.com");
    expect(report.ledgerDerived).toBeNull();
    // honestly flags what it cannot derive yet.
    expect(report.unavailableDimensions.join(" ")).toContain("需 ledger 上線後累積");
    expect(report.unavailableDimensions.some((d: string) => d.includes("永久漏接"))).toBe(true);
  });

  it("post-ledger: classifies by failureKind / httpStatus / day + retried-then-processed", () => {
    const report = classifyFailed({
      integrations: [{ emailAddress: "jeffhsieh09@gmail.com", messagesFailed: 136 }],
      ledgerRows: [
        { status: "failed", failureKind: "gmail_api", httpStatus: 429, internalDateMs: NOW },
        { status: "failed", failureKind: "auth", httpStatus: 401, internalDateMs: NOW },
        { status: "processed", failureKind: "llm", httpStatus: null, internalDateMs: NOW }, // retried→ok
      ],
    });
    expect(report.ledgerDerived.terminalFailed).toBe(2);
    expect(report.ledgerDerived.retriedThenProcessed).toBe(1);
    expect(report.ledgerDerived.byFailureKind).toEqual({ gmail_api: 1, auth: 1 });
    expect(report.ledgerDerived.byHttpStatus).toEqual({ "429": 1, "401": 1 });
    expect(report.ledgerDerived.permanentMissApprox).toBe(2);
    expect(report.unavailableDimensions).toEqual([]);
  });
});
