/**
 * Vitest cases for the skill registry (module 3.2).
 *
 * Asserts:
 *   - Each new sub-intent (module 3.1) maps to the expected SkillId
 *   - lookupSkill returns null for unregistered AND unported intents
 *   - refund_request / complaint deliberately NOT registered
 *   - listRegisteredIntents() exposes every entry (ported or not)
 *   - Adding a new intent without adding a registry entry would surface
 *     in `listRegisteredIntents().length` — covered indirectly
 */

import { describe, it, expect } from "vitest";
import {
  lookupSkill,
  listRegisteredIntents,
  skillRegistry,
} from "./registry";

describe("skill registry (module 3.2)", () => {
  describe("lookupSkill — happy path on ported skills", () => {
    it("tour_comparison_request → packgo-tour-comparison", () => {
      const entry = lookupSkill("tour_comparison_request");
      expect(entry).not.toBeNull();
      expect(entry?.skillId).toBe("packgo-tour-comparison");
      expect(entry?.isPorted).toBe(true);
      expect(typeof entry?.orchestrator.run).toBe("function");
    });

    it("new_inquiry falls back to packgo-tour-comparison", () => {
      const entry = lookupSkill("new_inquiry");
      expect(entry?.skillId).toBe("packgo-tour-comparison");
      expect(entry?.isPorted).toBe(true);
    });
  });

  describe("lookupSkill — unported skills return null (dispatcher escalates)", () => {
    it("quote_request → null (pending port)", () => {
      expect(lookupSkill("quote_request")).toBeNull();
    });

    it("flight_inquiry → null (pending port)", () => {
      expect(lookupSkill("flight_inquiry")).toBeNull();
    });

    it("visa_inquiry → null (pending module 3.6 port)", () => {
      expect(lookupSkill("visa_inquiry")).toBeNull();
    });

    it("deposit_inquiry → null (pending port)", () => {
      expect(lookupSkill("deposit_inquiry")).toBeNull();
    });
  });

  describe("lookupSkill — legacy intents", () => {
    it("refund_request → null (deliberately not registered; always escalates)", () => {
      expect(lookupSkill("refund_request")).toBeNull();
    });

    it("complaint → null (deliberately not registered; always escalates)", () => {
      expect(lookupSkill("complaint")).toBeNull();
    });

    it("spam → null (not registered)", () => {
      expect(lookupSkill("spam")).toBeNull();
    });

    it("other → null (not registered)", () => {
      expect(lookupSkill("other")).toBeNull();
    });

    it("general_info → null (not registered; legacy draft-only path)", () => {
      expect(lookupSkill("general_info")).toBeNull();
    });

    it("booking_question → null (not registered; legacy draft-only path)", () => {
      expect(lookupSkill("booking_question")).toBeNull();
    });
  });

  describe("listRegisteredIntents() — observability", () => {
    it("returns every registered intent (ported + unported)", () => {
      const list = listRegisteredIntents();
      // 6 entries: tour_comparison_request, new_inquiry, quote_request,
      // flight_inquiry, visa_inquiry, deposit_inquiry
      expect(list.length).toBe(6);
    });

    it("flags ported vs not", () => {
      const list = listRegisteredIntents();
      const ported = list.filter((e) => e.ported).map((e) => e.intent);
      const unported = list.filter((e) => !e.ported).map((e) => e.intent);
      expect(ported.sort()).toEqual(
        ["new_inquiry", "tour_comparison_request"].sort(),
      );
      expect(unported.sort()).toEqual(
        [
          "deposit_inquiry",
          "flight_inquiry",
          "quote_request",
          "visa_inquiry",
        ].sort(),
      );
    });

    it("every registered entry has a non-empty displayName", () => {
      for (const [intent, entry] of skillRegistry.entries()) {
        expect(
          entry.displayName.length,
          `displayName missing for ${intent}`,
        ).toBeGreaterThan(0);
      }
    });
  });

  describe("registry shape", () => {
    it("placeholder orchestrator returns ok=false if ever called (defense in depth)", async () => {
      // Pluck the visa_inquiry entry (currently unported) and call its
      // orchestrator directly — should NOT throw, should return ok=false.
      const visa = skillRegistry.get("visa_inquiry");
      expect(visa).toBeDefined();
      const result = await visa!.orchestrator.run({
        inquiry: {
          classification: "visa_inquiry",
          intent: "stub",
          urgency: "normal",
          sentiment: "neutral",
          shouldAutoReply: false,
          shouldEscalate: false,
          draftReply: "",
          draftLanguage: "zh-TW",
          extractedCustomer: {},
          confidence: 50,
          reasoning: "stub",
        },
        rawMessage: "stub",
        language: "zh-TW",
        correlationId: "test",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.needsJeff).toBe(true);
    });
  });
});
