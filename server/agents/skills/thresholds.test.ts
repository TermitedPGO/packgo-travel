/**
 * Vitest cases for module 3.12 — agent threshold env config.
 *
 * Asserts the two getters round-trip env values, clamp out-of-range,
 * fall back on missing/garbage, and return current values each call
 * (no module-load caching).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getConfidenceThreshold,
  getAutoSendThreshold,
  getCurrentThresholds,
} from "./thresholds";

describe("agent threshold env config (module 3.12)", () => {
  let originalConfidence: string | undefined;
  let originalAutoSend: string | undefined;

  beforeEach(() => {
    originalConfidence = process.env.AGENT_CONFIDENCE_THRESHOLD;
    originalAutoSend = process.env.AGENT_AUTO_SEND_THRESHOLD;
    delete process.env.AGENT_CONFIDENCE_THRESHOLD;
    delete process.env.AGENT_AUTO_SEND_THRESHOLD;
  });

  afterEach(() => {
    if (originalConfidence !== undefined) {
      process.env.AGENT_CONFIDENCE_THRESHOLD = originalConfidence;
    } else {
      delete process.env.AGENT_CONFIDENCE_THRESHOLD;
    }
    if (originalAutoSend !== undefined) {
      process.env.AGENT_AUTO_SEND_THRESHOLD = originalAutoSend;
    } else {
      delete process.env.AGENT_AUTO_SEND_THRESHOLD;
    }
  });

  describe("getConfidenceThreshold", () => {
    it("defaults to 80 when env unset", () => {
      expect(getConfidenceThreshold()).toBe(80);
    });

    it("returns the parsed env value when set", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "95";
      expect(getConfidenceThreshold()).toBe(95);
    });

    it("accepts 0 (boundary — minimum)", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "0";
      expect(getConfidenceThreshold()).toBe(0);
    });

    it("accepts 100 (boundary — maximum)", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "100";
      expect(getConfidenceThreshold()).toBe(100);
    });

    it("falls back to 80 when value is non-numeric", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "not-a-number";
      expect(getConfidenceThreshold()).toBe(80);
    });

    it("falls back to 80 when value is negative", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "-5";
      expect(getConfidenceThreshold()).toBe(80);
    });

    it("falls back to 80 when value exceeds 100", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "150";
      expect(getConfidenceThreshold()).toBe(80);
    });

    it("falls back to 80 when value is empty string", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "";
      expect(getConfidenceThreshold()).toBe(80);
    });

    it("reads env each call (no module-load caching) — change takes effect mid-process", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "70";
      expect(getConfidenceThreshold()).toBe(70);
      process.env.AGENT_CONFIDENCE_THRESHOLD = "85";
      expect(getConfidenceThreshold()).toBe(85);
    });
  });

  describe("getAutoSendThreshold", () => {
    it("defaults to 90 when env unset", () => {
      expect(getAutoSendThreshold()).toBe(90);
    });

    it("returns the parsed env value when set", () => {
      process.env.AGENT_AUTO_SEND_THRESHOLD = "95";
      expect(getAutoSendThreshold()).toBe(95);
    });

    it("falls back to 90 on garbage", () => {
      process.env.AGENT_AUTO_SEND_THRESHOLD = "abc";
      expect(getAutoSendThreshold()).toBe(90);
    });

    it("falls back to 90 on out-of-range", () => {
      process.env.AGENT_AUTO_SEND_THRESHOLD = "200";
      expect(getAutoSendThreshold()).toBe(90);
    });
  });

  describe("getCurrentThresholds", () => {
    it("returns both values defaulted", () => {
      expect(getCurrentThresholds()).toEqual({
        confidence: 80,
        autoSend: 90,
      });
    });

    it("returns both values set by env", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "75";
      process.env.AGENT_AUTO_SEND_THRESHOLD = "92";
      expect(getCurrentThresholds()).toEqual({
        confidence: 75,
        autoSend: 92,
      });
    });

    it("returns defaults for invalid + valid mix", () => {
      process.env.AGENT_CONFIDENCE_THRESHOLD = "garbage";
      process.env.AGENT_AUTO_SEND_THRESHOLD = "92";
      expect(getCurrentThresholds()).toEqual({
        confidence: 80,
        autoSend: 92,
      });
    });
  });
});
