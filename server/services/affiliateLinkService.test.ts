import { describe, it, expect } from "vitest";
import {
  generateFlightLink,
  generateHotelLink,
  generateHomepageLink,
  TRIP_COM_CONFIG,
} from "./affiliateLinkService";

describe("AffiliateLinkService", () => {
  describe("generateFlightLink", () => {
    it("includes allianceId=7896974 and sid=296102808", () => {
      const url = generateFlightLink();
      expect(url).toContain("allianceId=7896974");
      expect(url).toContain("sid=296102808");
    });

    it("includes deep link ID D13390057", () => {
      const url = generateFlightLink();
      expect(url).toContain("/D13390057");
    });

    it("includes origin and destination when provided", () => {
      const url = generateFlightLink({ origin: "SFO", destination: "NRT" });
      expect(url).toContain("dcity=SFO");
      expect(url).toContain("acity=NRT");
    });

    it("includes dates when provided", () => {
      const url = generateFlightLink({
        departDate: "2026-06-01",
        returnDate: "2026-06-10",
      });
      expect(url).toContain("ddate=2026-06-01");
      expect(url).toContain("rdate=2026-06-10");
    });

    it("returns valid URL without optional params", () => {
      const url = generateFlightLink();
      expect(() => new URL(url)).not.toThrow();
      expect(url).toMatch(/^https:\/\/www\.trip\.com\/t\//);
    });

    it("includes ouid when provided", () => {
      const url = generateFlightLink({ ouid: "user123" });
      expect(url).toContain("ouid=user123");
    });

    it("does not include optional params when not provided", () => {
      const url = generateFlightLink();
      expect(url).not.toContain("dcity=");
      expect(url).not.toContain("acity=");
      expect(url).not.toContain("ddate=");
    });
  });

  describe("generateHotelLink", () => {
    it("includes deep link ID D15196722", () => {
      const url = generateHotelLink();
      expect(url).toContain("/D15196722");
    });

    it("includes allianceId and sid", () => {
      const url = generateHotelLink();
      expect(url).toContain("allianceId=7896974");
      expect(url).toContain("sid=296102808");
    });

    it("includes city when provided", () => {
      const url = generateHotelLink({ city: "Tokyo" });
      expect(url).toContain("city=Tokyo");
    });

    it("includes check-in/check-out dates when provided", () => {
      const url = generateHotelLink({
        checkIn: "2026-07-01",
        checkOut: "2026-07-05",
      });
      expect(url).toContain("checkin=2026-07-01");
      expect(url).toContain("checkout=2026-07-05");
    });

    it("returns valid URL without optional params", () => {
      const url = generateHotelLink();
      expect(() => new URL(url)).not.toThrow();
    });
  });

  describe("generateHomepageLink", () => {
    it("includes deep link ID D13390050", () => {
      const url = generateHomepageLink();
      expect(url).toContain("/D13390050");
    });

    it("includes allianceId and sid", () => {
      const url = generateHomepageLink();
      expect(url).toContain("allianceId=7896974");
      expect(url).toContain("sid=296102808");
    });

    it("includes ouid when provided", () => {
      const url = generateHomepageLink("tour_456");
      expect(url).toContain("ouid=tour_456");
    });

    it("does not include ouid when not provided", () => {
      const url = generateHomepageLink();
      expect(url).not.toContain("ouid=");
    });

    it("returns valid URL", () => {
      const url = generateHomepageLink();
      expect(() => new URL(url)).not.toThrow();
    });
  });

  describe("TRIP_COM_CONFIG", () => {
    it("has correct allianceId", () => {
      expect(TRIP_COM_CONFIG.allianceId).toBe("7896974");
    });

    it("has correct sid", () => {
      expect(TRIP_COM_CONFIG.sid).toBe("296102808");
    });

    it("has correct deep link IDs", () => {
      expect(TRIP_COM_CONFIG.deepLinks.flights).toBe("D13390057");
      expect(TRIP_COM_CONFIG.deepLinks.hotels).toBe("D15196722");
      expect(TRIP_COM_CONFIG.deepLinks.homepage).toBe("D13390050");
    });
  });
});
