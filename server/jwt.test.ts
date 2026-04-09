import { describe, expect, it, beforeAll } from "vitest";
import { createToken, verifyToken } from "./jwt";
import type { JWTPayload } from "./jwt";

const samplePayload: JWTPayload = {
  userId: 42,
  email: "test@example.com",
  name: "Test User",
  role: "user",
};

describe("createToken", () => {
  it("returns a non-empty string token", () => {
    const token = createToken(samplePayload);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  it("creates a token with three JWT segments (header.payload.signature)", () => {
    const token = createToken(samplePayload);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  it("creates different tokens for different payloads", () => {
    const token1 = createToken({ userId: 1, email: "a@test.com" });
    const token2 = createToken({ userId: 2, email: "b@test.com" });
    expect(token1).not.toBe(token2);
  });
});

describe("verifyToken", () => {
  it("returns the original payload for a valid token", () => {
    const token = createToken(samplePayload);
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe(samplePayload.userId);
    expect(decoded?.email).toBe(samplePayload.email);
    expect(decoded?.name).toBe(samplePayload.name);
    expect(decoded?.role).toBe(samplePayload.role);
  });

  it("returns null for a tampered token", () => {
    const token = createToken(samplePayload);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(verifyToken(tampered)).toBeNull();
  });

  it("returns null for a completely invalid string", () => {
    expect(verifyToken("not.a.jwt")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(verifyToken("")).toBeNull();
  });

  it("returns null for a token with wrong signature", () => {
    // Manually construct a token with wrong signature
    const token = createToken(samplePayload);
    const [header, payload] = token.split(".");
    const fakeToken = `${header}.${payload}.invalidsignature`;
    expect(verifyToken(fakeToken)).toBeNull();
  });

  it("round-trips userId correctly", () => {
    const payload: JWTPayload = { userId: 999, email: "admin@packgo.com", role: "admin" };
    const token = createToken(payload);
    const decoded = verifyToken(token);
    expect(decoded?.userId).toBe(999);
    expect(decoded?.role).toBe("admin");
  });
});
