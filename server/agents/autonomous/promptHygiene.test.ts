/**
 * Prompt hygiene guard — no fabricatable concrete data in agent prompt examples.
 *
 * 起因(2026-06-25→26):opsAgent 的 SYSTEM_PROMPT 範例裡寫死「Air China $6635 /
 * 8 條 / 6/22」,連 Opus 都把它背出來當成真訂單回給客人(三度復發)。通則:
 * 凡是「把事實報給 Jeff / 客人」的 agent,其 prompt 範例只能用佔位符
 * (<訂單編號>、<客人>、<金額>、<M/D>),絕不可放看起來像真的具體
 * id / 金額 / 客名 / 日期 — 模型(連 Opus)會 parrot 成事實。
 *
 * 2026-06-26 sweep 在 refundAgent(PG-1234 / 8/15)、accountingAgent
 * (王先生團 Tokyo / CORP-9888 / 林小姐 (refund))各抓到同一地雷,已改佔位符。
 *
 * 這支測試 render 每個 fact-reporting agent「模型真正看到的全部」=
 * system prompt + tool schema(tool 的 description 也是 prompt 的一部分,
 * 兩筆 accounting 地雷就在 tool description 裡),斷言裡面沒有可被背成事實
 * 的具體 id 形狀,也沒有任何已移除的具體地雷字串。
 *
 * 要加新 agent:把它的 prompt builder / tool const export 出來,塞進 SURFACES。
 */
import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, ACTION_PROPOSAL_GUIDE } from "./opsAgent";
import {
  buildSystemPrompt,
  DEFAULT_INQUIRY_POLICY,
  STRUCTURED_TOOL,
} from "./inquiryAgent";
import {
  buildSystem as buildAccountingSystem,
  TOOL as ACCOUNTING_TOOL,
} from "./accountingAgent";
import {
  buildSystem as buildRefundSystem,
  TOOL as REFUND_TOOL,
} from "./refundAgent";

// Everything the model sees for each agent = system prompt + tool schema text.
const SURFACES: Record<string, string> = {
  opsAgent: SYSTEM_PROMPT + "\n" + ACTION_PROPOSAL_GUIDE,
  inquiryAgent:
    buildSystemPrompt(JSON.stringify(DEFAULT_INQUIRY_POLICY), "Jeff Hsieh") +
    "\n" +
    JSON.stringify(STRUCTURED_TOOL),
  accountingAgent: buildAccountingSystem() + "\n" + JSON.stringify(ACCOUNTING_TOOL),
  refundAgent: buildRefundSystem("(test policy text)") + "\n" + JSON.stringify(REFUND_TOOL),
};

// Fabricated identifier shape: 2-5 UPPERCASE letters + "-" + 3+ digits.
// e.g. PG-1234 (fake order), CORP-9888 (fake reference). Real ids are
// interpolated from data at runtime (`PG-${...}`), never literal in a prompt,
// so any literal match is a copyable plant the model can parrot as a real
// order/reference — the Air China $6635 class. Lowercase model names
// (claude-opus-4-6) and digit-dash-digit (Rev. Proc. 2017-30) do NOT match.
const FAKE_ID = /\b[A-Z]{2,5}-\d{3,}\b/;

// Concrete plants we removed; locked so they can't silently come back.
const DENYLIST = [
  "Air China",
  "$6635",
  "PG-1234",
  "CORP-9888",
  "王先生團",
  "林小姐 (refund)",
];

describe("agent prompt hygiene — no fabricatable concrete data in examples", () => {
  for (const [name, surface] of Object.entries(SURFACES)) {
    it(`${name}: no fabricated id-shape (PG-1234 / CORP-9888 class)`, () => {
      const m = surface.match(FAKE_ID);
      expect(
        m,
        m
          ? `${name} prompt embeds "${m[0]}" — use a placeholder like <訂單編號>, not a concrete id (the model parrots it as a real order)`
          : "ok",
      ).toBeNull();
    });

    it(`${name}: no known concrete plant string`, () => {
      const hit = DENYLIST.find((d) => surface.includes(d));
      expect(
        hit,
        hit
          ? `${name} prompt re-introduced a removed plant "${hit}" — examples must use placeholders`
          : "ok",
      ).toBeUndefined();
    });
  }

  it("all surfaces render non-empty (builders/tools wired)", () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      expect(surface.length, `${name} surface rendered empty`).toBeGreaterThan(100);
    }
  });
});
