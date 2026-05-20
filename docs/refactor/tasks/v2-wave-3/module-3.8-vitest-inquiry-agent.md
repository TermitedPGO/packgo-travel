# v2 · Wave 3 · Module 3.8 — Vitest smoke test for InquiryAgent

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.7 line 313, 15-agent Vitest mandate)
**Audit ref:** v2-audit-2026-05-19.md §A line 80 + §I line 519 (ALL 15 autonomous agents have ZERO tests)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 3h AI + 0min Jeff

## Goal

Ensure `server/agents/autonomous/inquiryAgent.ts` has comprehensive Vitest coverage. Module 3.1 already created `inquiryAgent.test.ts` with 5 cases (one per new sub-intent). This module **extends** that test file with the remaining cases needed to satisfy §九 hard requirement for autonomous agents:

1. The 5 sub-intent classification cases (from module 3.1)
2. Plus 5 more added here:
   - `refund_request` → returns `shouldEscalate: true`
   - `complaint` → returns `shouldEscalate: true`
   - LLM returns malformed tool_call JSON → throws cleanly
   - Confidence below threshold → `shouldEscalate: true`
   - Critical urgency + non-escalate classification → still escalates via `alwaysEscalate: critical_urgency`

Final test file: **10 cases total** covering classification + escalation + failure modes.

## Pre-requisites

- **Module 3.1 must land first** — creates `inquiryAgent.test.ts` + `inquiryAgent.fixtures.ts`.
- Tested file: `server/agents/autonomous/inquiryAgent.ts` (391 LOC, with 5 sub-intents added by 3.1).

## Inputs (read these before executing)

1. Post-3.1 `server/agents/autonomous/inquiryAgent.ts` (full).
2. Post-3.1 `server/agents/autonomous/inquiryAgent.test.ts` (the 5 cases from 3.1 — read to confirm test setup pattern).
3. Post-3.1 `server/agents/autonomous/inquiryAgent.fixtures.ts`.
4. `server/_core/llm.ts` — `invokeLLM` signature + `InvokeResult` shape (so mocks return the right type).
5. `server/_core/stripeWebhookIdempotency.test.ts` — reference for `vi.mock` patterns (mock-DB style).

## Scope (what this module owns)

- Extended: `server/agents/autonomous/inquiryAgent.test.ts` (+ 5 cases)
- Extended: `server/agents/autonomous/inquiryAgent.fixtures.ts` (+ 5 fixtures for escalation paths)
- No source-code changes to `inquiryAgent.ts` (read-only test addition)

Does NOT:
- Touch any other autonomous agent (module 3.10 owns those batch tests)
- Modify `inquiryAgent.ts` source

## Mock strategy (locked: `vi.mock("../../_core/llm")`)

Per **D4** (Stage 2 entry decision, locked) — use `vi.mock` for the LLM module returning deterministic fixtures. Mock signature pinned to `InvokeResult` shape so tsc catches drift. No `msw` / `nock` needed (LLM is the only network surface InquiryAgent hits).

Mock template:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "../../_core/llm";
import { runInquiryAgent } from "./inquiryAgent";

function mockLLMToolCall(toolArgs: Record<string, unknown>) {
  (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    choices: [{
      message: {
        tool_calls: [{
          function: {
            name: "submit_inquiry_analysis",
            arguments: JSON.stringify(toolArgs),
          },
        }],
      },
    }],
  });
}
```

## Procedure

1. **Read post-3.1 test file** to understand structure + helpers already in place.

2. **Add escalation-path fixtures** to `inquiryAgent.fixtures.ts`:
   ```ts
   export const FIXTURE_REFUND_REQUEST = {
     from: "angry@example.com",
     subject: "退款請求",
     body: "我要退款,行程太爛了。",
   };
   export const FIXTURE_COMPLAINT = {
     from: "upset@example.com",
     subject: "投訴",
     body: "服務態度有問題,請給我交代。",
   };
   export const FIXTURE_CRITICAL_URGENCY = {
     from: "emergency@example.com",
     subject: "緊急狀況",
     body: "在芝加哥機場錯過接機,身上沒有現金。",
   };
   export const FIXTURE_LOW_CONFIDENCE = {
     from: "vague@example.com",
     subject: "?",
     body: "嗨。",
   };
   ```

3. **Append 5 cases to `inquiryAgent.test.ts`**:
   ```ts
   describe("InquiryAgent escalation paths", () => {
     beforeEach(() => {
       (invokeLLM as ReturnType<typeof vi.fn>).mockReset();
     });

     it("escalates refund_request even at high confidence", async () => {
       mockLLMToolCall({
         classification: "refund_request",
         intent: "Customer wants refund",
         urgency: "normal",
         sentiment: "negative",
         draftReply: "您的退款請求 …",
         draftLanguage: "zh-TW",
         extractedCustomer: { senderEmail: "x@y.com" },
         confidence: 92,
         reasoning: "explicit refund request",
       });
       const result = await runInquiryAgent({
         rawMessage: FIXTURE_REFUND_REQUEST.body,
         channel: "email",
       });
       expect(result.shouldEscalate).toBe(true);
       expect(result.classification).toBe("refund_request");
     });

     it("escalates complaint regardless of confidence", async () => {
       mockLLMToolCall({
         classification: "complaint",
         intent: "Customer complaining about service",
         urgency: "high",
         sentiment: "negative",
         draftReply: "對於您遇到的狀況 …",
         draftLanguage: "zh-TW",
         extractedCustomer: {},
         confidence: 85,
         reasoning: "service complaint",
       });
       const result = await runInquiryAgent({
         rawMessage: FIXTURE_COMPLAINT.body,
         channel: "email",
       });
       expect(result.shouldEscalate).toBe(true);
     });

     it("escalates critical urgency even on auto-draftable classification", async () => {
       mockLLMToolCall({
         classification: "new_inquiry",
         intent: "Customer needs help urgently",
         urgency: "critical",
         sentiment: "negative",
         draftReply: "我們立刻處理 …",
         draftLanguage: "zh-TW",
         extractedCustomer: {},
         confidence: 88,
         reasoning: "emergency situation",
       });
       const result = await runInquiryAgent({
         rawMessage: FIXTURE_CRITICAL_URGENCY.body,
         channel: "email",
       });
       expect(result.shouldEscalate).toBe(true);
       expect(result.escalationReason).toMatch(/critical_urgency/);
     });

     it("escalates when confidence < threshold", async () => {
       mockLLMToolCall({
         classification: "general_info",
         intent: "Unclear",
         urgency: "low",
         sentiment: "neutral",
         draftReply: "您好 …",
         draftLanguage: "zh-TW",
         extractedCustomer: {},
         confidence: 30,           // below general_info minConfidence (60)
         reasoning: "very unclear intent",
       });
       const result = await runInquiryAgent({
         rawMessage: FIXTURE_LOW_CONFIDENCE.body,
         channel: "email",
       });
       expect(result.shouldEscalate).toBe(true);
     });

     it("throws on malformed LLM tool_call JSON", async () => {
       (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
         choices: [{
           message: {
             tool_calls: [{
               function: {
                 name: "submit_inquiry_analysis",
                 arguments: "{ not-valid-json",
               },
             }],
           },
         }],
       });
       await expect(
         runInquiryAgent({
           rawMessage: FIXTURE_LOW_CONFIDENCE.body,
           channel: "email",
         })
       ).rejects.toThrow(/not valid JSON/);
     });
   });
   ```

4. **Verify the final test count**: `pnpm test inquiryAgent --reporter=verbose | grep -c "✓\|✗"` should show **10 cases** (5 from module 3.1 + 5 from this module).

## Acceptance Criteria

- [ ] `inquiryAgent.test.ts` now contains 10 total cases (5 classification + 5 escalation/failure)
- [ ] All 10 cases pass via `pnpm test inquiryAgent`
- [ ] `inquiryAgent.fixtures.ts` extended with 4 new fixtures
- [ ] All mocks use `vi.mock("../../_core/llm")` pattern (per D4 lock)
- [ ] No real LLM call attempted in tests (verify via test isolation — `(invokeLLM as Mock).mock.calls.length` per case)
- [ ] `pnpm tsc --noEmit` exits 0 (mock types align with `InvokeResult` shape)
- [ ] Covers all 4 `alwaysEscalate` items: `refund_request`, `complaint`, `critical_urgency`, low-confidence
- [ ] Covers malformed-LLM-response failure mode — **§九 hard requirement satisfied**

## Deliverable

- Extended: `server/agents/autonomous/inquiryAgent.test.ts` (+ ~120 LOC, 5 new cases)
- Extended: `server/agents/autonomous/inquiryAgent.fixtures.ts` (+ ~40 LOC, 4 new fixtures)

Commit message:
```
test(agents): Wave 3 Module 3.8 — extend InquiryAgent Vitest coverage

Adds 5 cases to inquiryAgent.test.ts covering escalation paths and
failure modes (modules 3.1 already added 5 sub-intent cases). Total: 10
cases.

Coverage:
- refund_request → shouldEscalate=true (regardless of confidence)
- complaint → shouldEscalate=true
- critical_urgency → shouldEscalate=true even on draft-eligible class
- confidence < minConfidence → shouldEscalate=true
- malformed LLM tool_call JSON → throws cleanly

Per CLAUDE.md §九 hard requirement: every autonomous agent file MUST
have Vitest coverage. InquiryAgent now does (10 cases).

Mocks via vi.mock("../../_core/llm") per D4 lock.

Refs: docs/refactor/tasks/v2-wave-3/module-3.8-vitest-inquiry-agent.md
```

## Rollback

- Single revert. Tests are additive; no source-code change.

## Manual intervention

- **None.** Fully autonomous.

## Test plan

- 5 new Vitest cases as enumerated above.

## Decisions needed (Jeff)

- **None.** Mock strategy locked at D4. Test count target (10) is from the §九 hard requirement + audit gap (zero tests → comprehensive).

(Module proceeds without Jeff input.)
