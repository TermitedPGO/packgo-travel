/**
 * Phase-1 homepage-only affiliate service tests.
 *
 * The dynamic deep-link builders (and their env flag) were REMOVED per the Codex
 * batch-3 verdict — these tests pin the surviving surface: the byte-exact approved
 * entry, the hardened outbound allowlist, and the anonymous telemetry writer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createAffiliateClick = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({ createAffiliateClick }));

import {
  APPROVED_HOMEPAGE_ENTRY,
  isAllowedTripUrl,
  recordRedirectTelemetry,
  TRIP_COM_CONFIG,
} from "./affiliateLinkService";

describe("TRIP_COM_CONFIG", () => {
  it("carries the alliance id and SID Jeff issued", () => {
    expect(TRIP_COM_CONFIG.allianceId).toBe("7896974");
    expect(TRIP_COM_CONFIG.sid).toBe("296102808");
  });
});

describe("APPROVED_HOMEPAGE_ENTRY", () => {
  it("is byte-for-byte the entry Jeff approved", () => {
    // Trip.com's FAQ says not to modify platform-generated links, so this must not
    // drift (no re-encoding, no reordering) even by accident.
    expect(APPROVED_HOMEPAGE_ENTRY).toBe(
      "https://hk.trip.com/?Allianceid=7896974&SID=296102808&trip_sub1=&trip_sub3=D13390050",
    );
  });

  it("passes the outbound allowlist", () => {
    expect(isAllowedTripUrl(APPROVED_HOMEPAGE_ENTRY)).toBe(true);
  });
});

describe("no deep-link surface remains", () => {
  it("exports no link builders and no env flag can revive them", async () => {
    const mod = await import("./affiliateLinkService");
    expect((mod as Record<string, unknown>).generateFlightLink).toBeUndefined();
    expect((mod as Record<string, unknown>).generateHotelLink).toBeUndefined();
    expect((mod as Record<string, unknown>).generateHomepageLink).toBeUndefined();
    expect((mod as Record<string, unknown>).deepLinkEnabled).toBeUndefined();
  });
});

describe("isAllowedTripUrl", () => {
  it.each([
    "https://trip.com/",
    "https://www.trip.com/flights",
    "https://hk.trip.com/?Allianceid=7896974",
    "https://us.trip.com/?locale=en-us",
    "https://www.trip.com:443/", // explicit default port is still the default port
  ])("accepts official Trip.com HTTPS host: %s", (url) => {
    expect(isAllowedTripUrl(url)).toBe(true);
  });

  it.each([
    ["non-Trip.com host", "https://example.com/"],
    ["lookalike suffix", "https://nottrip.com/"],
    ["attacker subdomain", "https://trip.com.evil.com/"],
    ["plain http", "http://www.trip.com/"],
    ["javascript scheme", "javascript:alert(1)"],
    ["protocol-relative", "//www.trip.com/"],
    ["empty", ""],
    ["garbage", "not a url"],
    // Codex P2: credentials and non-default ports must be rejected.
    ["embedded credentials", "https://user:pass@www.trip.com/"],
    ["username only", "https://user@www.trip.com/"],
    ["userinfo trick", "https://www.trip.com@evil.com/"],
    ["non-default port 444", "https://www.trip.com:444/"],
    ["non-default port 8443", "https://hk.trip.com:8443/"],
  ])("rejects %s", (_label, url) => {
    expect(isAllowedTripUrl(url)).toBe(false);
  });
});

describe("recordRedirectTelemetry", () => {
  beforeEach(() => {
    createAffiliateClick.mockReset();
    createAffiliateClick.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each(["flight_search", "hotel_search", "tour_flight", "tour_hotel"] as const)(
    "writes one anonymous trip_homepage row for %s",
    async (source) => {
      await recordRedirectTelemetry(source);
      expect(createAffiliateClick).toHaveBeenCalledTimes(1);
      expect(createAffiliateClick.mock.calls[0][0]).toEqual({
        userId: null,
        platform: "trip_homepage",
        targetUrl: APPROVED_HOMEPAGE_ENTRY,
        referrerPage: source,
        tourId: null,
        ipAddress: null,
        userAgent: null,
      });
    },
  );

  it("is structurally anonymous — the row never carries user id, IP or UA", async () => {
    await recordRedirectTelemetry("flight_search");
    const row = createAffiliateClick.mock.calls[0][0];
    expect(row.userId).toBeNull();
    expect(row.ipAddress).toBeNull();
    expect(row.userAgent).toBeNull();
  });

  it("stores only the closed enum in referrerPage — no free text path exists", async () => {
    await recordRedirectTelemetry("tour_hotel");
    expect(createAffiliateClick.mock.calls[0][0].referrerPage).toBe("tour_hotel");
  });

  it("swallows a DB failure so it can never block the redirect", async () => {
    createAffiliateClick.mockRejectedValue(new Error("db down"));
    await expect(recordRedirectTelemetry("hotel_search")).resolves.toBeUndefined();
  });
});
