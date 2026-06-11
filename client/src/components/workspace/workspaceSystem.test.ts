/**
 * Tests for workspaceSystem.helpers (批8) — real implementations.
 */
import { describe, it, expect } from "vitest";
import {
  todaySpend,
  modelShares,
  taskStateOf,
  auditActorKind,
} from "./workspaceSystem.helpers";

const day = (date: string, models: [string, number][]) => ({
  date,
  totalUSD: models.reduce((s, [, c]) => s + c, 0),
  perModel: models.map(([model, costUSD]) => ({ model, costUSD })),
});

describe("todaySpend (批8)", () => {
  const days = [
    day("2026-06-10", [["claude", 2.5]]),
    day("2026-06-11", [["claude", 3.2]]),
  ];
  it("finds today's entry", () => {
    expect(todaySpend(days, "2026-06-11")).toBe(3.2);
  });
  it("no entry yet → 0", () => {
    expect(todaySpend(days, "2026-06-12")).toBe(0);
  });
});

describe("modelShares (批8)", () => {
  it("aggregates across days, sorts desc, rounds pct", () => {
    const shares = modelShares([
      day("2026-06-10", [
        ["claude", 71],
        ["gpt", 22],
        ["gemini", 7],
      ]),
    ]);
    expect(shares).toEqual([
      { model: "claude", pct: 71 },
      { model: "gpt", pct: 22 },
      { model: "gemini", pct: 7 },
    ]);
  });

  it("caps at topN", () => {
    const shares = modelShares(
      [
        day("2026-06-10", [
          ["a", 40],
          ["b", 30],
          ["c", 20],
          ["d", 10],
        ]),
      ],
      2,
    );
    expect(shares).toHaveLength(2);
    expect(shares[0].model).toBe("a");
  });

  it("zero total → [] (no fake percentages)", () => {
    expect(modelShares([day("2026-06-10", [["claude", 0]])])).toEqual([]);
    expect(modelShares([])).toEqual([]);
  });
});

describe("taskStateOf (批8)", () => {
  it("started → running", () => expect(taskStateOf("started")).toBe("running"));
  it("completed → done", () => expect(taskStateOf("completed")).toBe("done"));
  it("failed → err", () => expect(taskStateOf("failed")).toBe("err"));
  it("idle/unknown → none", () => expect(taskStateOf("idle")).toBe("none"));
});

describe("auditActorKind (批8)", () => {
  it("role=agent → agent", () => {
    expect(auditActorKind({ userRole: "agent", userEmail: "x@y.z" })).toBe(
      "agent",
    );
  });
  it("agent@ email → agent", () => {
    expect(
      auditActorKind({ userRole: "admin", userEmail: "agent@packgo.local" }),
    ).toBe("agent");
  });
  it("normal admin → human", () => {
    expect(
      auditActorKind({ userRole: "admin", userEmail: "jeff@packgo.com" }),
    ).toBe("human");
  });
  it("missing fields → human (default to accountable)", () => {
    expect(auditActorKind({})).toBe("human");
  });
});
