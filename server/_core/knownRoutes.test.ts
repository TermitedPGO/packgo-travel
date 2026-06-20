import { describe, it, expect } from "vitest";
import { isKnownRoute, normalizeUrlForMatch } from "./knownRoutes";

describe("knownRoutes — SPA fallback 200 vs 404", () => {
  it("treats the new /ops admin section as a known route (regression: direct hit/refresh 404'd)", () => {
    for (const p of [
      "/ops",
      "/ops/customers",
      "/ops/tours",
      "/ops/finance",
      "/ops/marketing",
      "/ops/settings",
    ]) {
      expect(isKnownRoute(p)).toBe(true);
    }
  });

  it("keeps the other private app sections known", () => {
    for (const p of ["/admin", "/admin/tours", "/workspace", "/workspace/inbox", "/profile"]) {
      expect(isKnownRoute(p)).toBe(true);
    }
  });

  it("keeps real public routes known", () => {
    for (const p of ["/", "/tours", "/tours/abc123", "/faq", "/visa-services"]) {
      expect(isKnownRoute(p)).toBe(true);
    }
  });

  it("returns 404 for genuinely unknown URLs", () => {
    for (const p of ["/totally-made-up", "/ops-not-really", "/opsx", "/admins"]) {
      expect(isKnownRoute(p)).toBe(false);
    }
  });

  it("ignores query string and trailing slash when matching", () => {
    expect(isKnownRoute("/ops/customers?selected=5")).toBe(true);
    expect(isKnownRoute("/ops/customers/")).toBe(true);
    expect(normalizeUrlForMatch("/ops/customers/?q=1")).toBe("/ops/customers");
    expect(normalizeUrlForMatch("/")).toBe("/");
  });
});
