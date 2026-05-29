/**
 * Unit tests for foldEvalRows / evalOneRow / toEvalMarkdown — the
 * real-transaction eval core (記帳 agent 實測單, 2026-05-28).
 *
 * Each synthetic row is crafted to land in exactly one verdict bucket by
 * exercising the REAL preClassify rules (owner / WF card / memo / silent),
 * then comparing against a ground-truth jeffOverrideCategory. This both
 * documents the verdict taxonomy and guards the scoring math.
 *
 * Plaid sign: amount > 0 = outflow, amount < 0 = inflow.
 */
import { describe, it, expect } from "vitest";
import {
  foldEvalRows,
  evalOneRow,
  toEvalMarkdown,
  type EvalRowLike,
} from "./accountingEvalService";

// A representative exam covering all seven verdicts, one row each.
const rows: EvalRowLike[] = [
  // 1) owner self-transfer OUTFLOW → preClassify transfer conf95, truth transfer.
  //    Owner rule is OUTFLOW-ONLY after the 2026-05-29 fix: owner-name INFLOWS are
  //    real tour income (客人用業主個人戶付團費), so they no longer auto-assert
  //    transfer. Money going OUT to the owner = 業主提取/墊款 = internal transfer.
  {
    id: 1,
    date: "2026-01-05",
    amount: "5000",
    merchantName: null,
    description: "Zelle payment to CHUNFU HSIEH",
    originalDescription: null,
    paymentMeta: { payee: "CHUNFU HSIEH" },
    accountName: "BofA Checking",
    accountType: "depository",
    agentCategory: "transfer",
    jeffOverrideCategory: "transfer",
  },
  // 2) WF card OUTFLOW → rule fires cogs_tour conf90, but Jeff said office.
  //    Realistic over-fire: not every WF charge is client airfare.
  {
    id: 2,
    date: "2026-01-06",
    amount: "250",
    merchantName: "Office Depot",
    description: "card purchase",
    originalDescription: null,
    paymentMeta: null,
    accountName: "Wells Fargo Business Card",
    accountType: "credit",
    agentCategory: "cogs_tour",
    jeffOverrideCategory: "expense_office",
  },
  // 3) memo hint inflow, matches truth → hint_correct
  {
    id: 3,
    date: "2026-01-07",
    amount: "-1200",
    merchantName: null,
    description: "ZELLE tour deposit from guest",
    originalDescription: null,
    paymentMeta: null,
    accountName: "BofA Checking",
    accountType: "depository",
    agentCategory: "income_booking",
    jeffOverrideCategory: "income_booking",
  },
  // 4) memo hint inflow, contradicts truth → hint_wrong
  {
    id: 4,
    date: "2026-01-08",
    amount: "-300",
    merchantName: null,
    description: "visa fee reimbursement",
    originalDescription: null,
    paymentMeta: null,
    accountName: "BofA Checking",
    accountType: "depository",
    agentCategory: "other_review",
    jeffOverrideCategory: "other_review",
  },
  // 5) silent inflow, agent was right → llm_only_agent_ok
  {
    id: 5,
    date: "2026-01-09",
    amount: "-800",
    merchantName: "Lin Family",
    description: "ACH CREDIT",
    originalDescription: null,
    paymentMeta: null,
    accountName: "BofA Checking",
    accountType: "depository",
    agentCategory: "income_booking",
    jeffOverrideCategory: "income_booking",
  },
  // 6) silent inflow, agent guessed income but Jeff flagged review → llm_only_agent_wrong
  {
    id: 6,
    date: "2026-01-10",
    amount: "-450",
    merchantName: "Unknown LLC",
    description: "WIRE IN",
    originalDescription: null,
    paymentMeta: null,
    accountName: "BofA Checking",
    accountType: "depository",
    agentCategory: "income_booking",
    jeffOverrideCategory: "other_review",
  },
  // 7) silent, no agent record → llm_only_no_agent
  {
    id: 7,
    date: "2026-01-11",
    amount: "-100",
    merchantName: "Mystery",
    description: "DEPOSIT",
    originalDescription: null,
    paymentMeta: null,
    accountName: "BofA Checking",
    accountType: "depository",
    agentCategory: null,
    jeffOverrideCategory: "other_review",
  },
];

describe("evalOneRow — verdict bucketing via real preClassify", () => {
  it("owner self-transfer is a deterministic rule_correct", () => {
    const r = evalOneRow(rows[0]);
    expect(r.preCategory).toBe("transfer");
    expect(r.preConfidence).toBe(95);
    expect(r.preSource).toBe("owner");
    expect(r.verdict).toBe("rule_correct");
  });

  it("WF-card office charge is rule_wrong (rule over-fires cogs_tour)", () => {
    const r = evalOneRow(rows[1]);
    expect(r.preCategory).toBe("cogs_tour");
    expect(r.preConfidence).toBe(90);
    expect(r.preSource).toBe("wf_card");
    expect(r.truth).toBe("expense_office");
    expect(r.verdict).toBe("rule_wrong");
  });

  it("memo hints are advisory (conf < 90), scored as hint_correct / hint_wrong", () => {
    expect(evalOneRow(rows[2]).verdict).toBe("hint_correct");
    const wrong = evalOneRow(rows[3]);
    expect(wrong.preConfidence).toBeLessThan(90);
    expect(wrong.preSource).toBe("memo");
    expect(wrong.verdict).toBe("hint_wrong");
  });

  it("silent rows fall back to comparing agentCategory vs truth", () => {
    expect(evalOneRow(rows[4]).verdict).toBe("llm_only_agent_ok");
    expect(evalOneRow(rows[5]).verdict).toBe("llm_only_agent_wrong");
    const noAgent = evalOneRow(rows[6]);
    expect(noAgent.preCategory).toBeNull();
    expect(noAgent.verdict).toBe("llm_only_no_agent");
  });

  it("derives counterparty from paymentMeta payee→payer (same as runtime)", () => {
    expect(evalOneRow(rows[0]).counterparty).toBe("CHUNFU HSIEH");
  });
});

describe("foldEvalRows — scoring summary", () => {
  it("counts each verdict bucket exactly once for the 7-row exam", () => {
    const { summary: s } = foldEvalRows(rows);
    expect(s.total).toBe(7);
    expect(s.ruleCorrect).toBe(1);
    expect(s.ruleWrong).toBe(1);
    expect(s.hintCorrect).toBe(1);
    expect(s.hintWrong).toBe(1);
    expect(s.llmOnlyAgentOk).toBe(1);
    expect(s.llmOnlyAgentWrong).toBe(1);
    expect(s.llmOnlyNoAgent).toBe(1);
  });

  it("deterministic accuracy = ruleCorrect / (ruleCorrect+ruleWrong)", () => {
    const { summary: s } = foldEvalRows(rows);
    expect(s.deterministicAccuracy).toBeCloseTo(0.5, 5); // 1 of 2
    expect(s.deterministicCoverage).toBeCloseTo(2 / 7, 5);
  });

  it("actionableWrong = ruleWrong + llmOnlyAgentWrong (what to fix)", () => {
    const { summary: s } = foldEvalRows(rows);
    expect(s.actionableWrong).toBe(2);
  });

  it("empty exam yields zeros and null accuracy (no false 100%)", () => {
    const { summary: s } = foldEvalRows([]);
    expect(s.total).toBe(0);
    expect(s.deterministicAccuracy).toBeNull();
    expect(s.deterministicCoverage).toBe(0);
    expect(s.actionableWrong).toBe(0);
  });
});

describe("toEvalMarkdown — report rendering", () => {
  it("surfaces the rule_wrong row in the 最該修 section", () => {
    const md = toEvalMarkdown(foldEvalRows(rows));
    expect(md).toContain("🔴 規則判錯");
    expect(md).toContain("Office Depot"); // the over-fired row
    expect(md).toContain("expense_office"); // Jeff's truth
  });

  it("shows a clean note when there are no rule_wrong rows", () => {
    const clean = foldEvalRows([rows[0]]); // only the rule_correct owner row
    const md = toEvalMarkdown(clean);
    expect(md).toContain("沒有規則在真實交易上判錯");
  });
});
