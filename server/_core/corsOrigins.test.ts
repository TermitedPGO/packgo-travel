import { describe, it, expect } from "vitest";
import {
  buildAllowedOrigins,
  isOriginAllowed,
  allowedOriginPatterns,
} from "./corsOrigins";

describe("buildAllowedOrigins", () => {
  it("includes the loopback render origin for the prod PORT (bot-prerender asset-500 fix)", () => {
    const origins = buildAllowedOrigins({ PORT: "8080" } as NodeJS.ProcessEnv);
    expect(origins).toContain("http://127.0.0.1:8080");
    expect(origins).toContain("http://localhost:8080");
  });

  it("still covers 127.0.0.1:8080 when PORT is unset (renderForBot fallback)", () => {
    const origins = buildAllowedOrigins({} as NodeJS.ProcessEnv);
    expect(origins).toContain("http://127.0.0.1:8080");
    expect(origins).toContain("http://localhost:8080");
  });

  it("covers a non-8080 PORT too", () => {
    const origins = buildAllowedOrigins({ PORT: "3001" } as NodeJS.ProcessEnv);
    expect(origins).toContain("http://127.0.0.1:3001");
    expect(origins).toContain("http://localhost:3001");
  });

  it("keeps the canonical production origin", () => {
    expect(buildAllowedOrigins({} as NodeJS.ProcessEnv)).toContain(
      "https://packgoplay.com",
    );
  });

  it("appends BASE_URL when set", () => {
    const origins = buildAllowedOrigins({
      BASE_URL: "https://preview.example.com",
    } as NodeJS.ProcessEnv);
    expect(origins).toContain("https://preview.example.com");
  });
});

describe("isOriginAllowed", () => {
  const allow = buildAllowedOrigins({ PORT: "8080" } as NodeJS.ProcessEnv);

  it("allows the loopback render origin (the regression this fixes)", () => {
    expect(isOriginAllowed("http://127.0.0.1:8080", allow)).toBe(true);
  });

  it("allows an undefined origin (curl / server-to-server / same-origin)", () => {
    expect(isOriginAllowed(undefined, allow)).toBe(true);
  });

  it("allows the canonical production origin", () => {
    expect(isOriginAllowed("https://packgoplay.com", allow)).toBe(true);
  });

  it("rejects an unknown cross-origin", () => {
    expect(isOriginAllowed("https://evil-prankster.fly.dev", allow)).toBe(false);
  });

  it("rejects a look-alike host (no substring/wildcard match)", () => {
    expect(isOriginAllowed("https://packgoplay.com.evil.com", allow)).toBe(false);
  });

  it("has no wildcard patterns (red-team round 1 hardening preserved)", () => {
    expect(allowedOriginPatterns).toHaveLength(0);
  });
});
