import { describe, it, expect } from "vitest";
import {
  INQUIRY_CLASSIFICATION_LABELS_ZH,
  inquiryClassificationLabelZh,
  escalationReasonZh,
} from "./inquiryLabels";

describe("inquiryLabels", () => {
  describe("inquiryClassificationLabelZh", () => {
    it("maps every known classification to a short plain-Chinese label", () => {
      expect(inquiryClassificationLabelZh("quote_request")).toBe("報價");
      expect(inquiryClassificationLabelZh("tour_comparison_request")).toBe("行程比較");
      expect(inquiryClassificationLabelZh("refund_request")).toBe("退款");
      expect(inquiryClassificationLabelZh("complaint")).toBe("客訴");
      expect(inquiryClassificationLabelZh("spam")).toBe("疑似垃圾");
    });

    it("falls back to the raw value for an unknown classification (never throws)", () => {
      expect(inquiryClassificationLabelZh("some_future_intent")).toBe(
        "some_future_intent",
      );
    });

    it("has no English or underscores leaking in the labels", () => {
      for (const label of Object.values(INQUIRY_CLASSIFICATION_LABELS_ZH)) {
        expect(label).not.toMatch(/[a-zA-Z_]/);
      }
    });
  });

  describe("escalationReasonZh", () => {
    it("never leaks enum/policy jargon (the old log-speak)", () => {
      for (const c of Object.keys(INQUIRY_CLASSIFICATION_LABELS_ZH)) {
        const reason = escalationReasonZh(c);
        expect(reason).not.toMatch(/classification=/);
        expect(reason).not.toMatch(/policy\.action/);
        expect(reason).not.toMatch(/minConfidence/);
        // Jeff's rule: no em dashes anywhere.
        expect(reason).not.toContain("—");
      }
    });

    it("gives refund / complaint / spam their own human reason", () => {
      expect(escalationReasonZh("refund_request")).toContain("退款");
      expect(escalationReasonZh("complaint")).toContain("抱怨");
      expect(escalationReasonZh("spam")).toContain("垃圾");
    });

    it("default reason embeds the plain label", () => {
      expect(escalationReasonZh("quote_request")).toContain("報價");
    });
  });
});
