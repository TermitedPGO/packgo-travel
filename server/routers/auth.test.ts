/**
 * Smoke test for Phase 4E · auth sub-router extraction.
 * Verifies 9 procedures from the pre-split source.
 */
import { describe, it, expect } from "vitest";
import { authRouter } from "./auth";

describe("authRouter (Phase 4E extraction)", () => {
  it("exposes 9 procedures from the pre-split source", () => {
    const procs = Object.keys((authRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "me",
        "register",
        "login",
        "requestPasswordReset",
        "resetPassword",
        "logout",
        "updateProfile",
        "uploadAvatar",
        "deleteAvatar",
      ].sort(),
    );
  });
});
