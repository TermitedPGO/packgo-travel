/**
 * Tests for gmailAuthFailure.ts — the token-revocation detector + throttled
 * owner alert. Pure logic only (no Redis / BullMQ), so we exercise it directly
 * with injected I/O spies.
 */

import { describe, it, expect, vi } from "vitest";
import {
  isAuthRevocationError,
  formatRevocationReason,
  buildTokenRevocationAlert,
  handleIntegrationPollError,
  REVOCATION_REASON_PREFIX,
  type PollErrorIo,
} from "./gmailAuthFailure";

describe("isAuthRevocationError", () => {
  it("matches invalid_grant (any casing)", () => {
    expect(isAuthRevocationError(new Error("invalid_grant"))).toBe(true);
    expect(
      isAuthRevocationError(new Error("Error: INVALID_GRANT (Bad Request)")),
    ).toBe(true);
  });

  it("matches Google's 'token has been expired or revoked' wording", () => {
    expect(
      isAuthRevocationError(
        new Error("Token has been expired or revoked."),
      ),
    ).toBe(true);
  });

  it("accepts non-Error values", () => {
    expect(isAuthRevocationError("invalid_grant")).toBe(true);
  });

  it("does NOT match transient / network / 5xx errors", () => {
    expect(isAuthRevocationError(new Error("ECONNRESET"))).toBe(false);
    expect(isAuthRevocationError(new Error("getaddrinfo ENOTFOUND"))).toBe(false);
    expect(
      isAuthRevocationError(new Error("The service is currently unavailable (503)")),
    ).toBe(false);
    expect(isAuthRevocationError(new Error("rate limit exceeded"))).toBe(false);
  });
});

describe("formatRevocationReason", () => {
  it("prefixes with the dedup sentinel", () => {
    expect(formatRevocationReason(new Error("invalid_grant"))).toBe(
      `${REVOCATION_REASON_PREFIX}: invalid_grant`,
    );
  });

  it("caps length so a huge message can't bloat the column", () => {
    const huge = "x".repeat(2000);
    const out = formatRevocationReason(new Error(huge));
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.startsWith(`${REVOCATION_REASON_PREFIX}:`)).toBe(true);
  });
});

describe("buildTokenRevocationAlert", () => {
  it("includes the re-auth URL and the exact account to pick", () => {
    const { title, content } = buildTokenRevocationAlert(
      "support@packgoplay.com",
      "https://packgoplay.com",
    );
    expect(title).toContain("support@packgoplay.com");
    expect(content).toContain(
      "https://packgoplay.com/api/admin/connect-gmail",
    );
    expect(content).toContain("選 support@packgoplay.com");
  });

  it("trims a trailing slash on baseUrl", () => {
    const { content } = buildTokenRevocationAlert("a@b.com", "https://x.com/");
    expect(content).toContain("https://x.com/api/admin/connect-gmail");
    expect(content).not.toContain("https://x.com//api");
  });

  it("uses no em dash anywhere (Jeff's rule)", () => {
    const { title, content } = buildTokenRevocationAlert("a@b.com", "https://x.com");
    expect(title).not.toContain("—");
    expect(content).not.toContain("—");
  });
});

describe("handleIntegrationPollError", () => {
  function makeIo() {
    const io: PollErrorIo = {
      markDisconnectReason: vi.fn().mockResolvedValue(undefined),
      notifyOwner: vi.fn().mockResolvedValue(true),
    };
    return io;
  }

  it("ignores generic / transient errors (no side effects)", async () => {
    const io = makeIo();
    const outcome = await handleIntegrationPollError(
      { id: 30001, emailAddress: "support@packgoplay.com", disconnectReason: null },
      new Error("ECONNRESET"),
      io,
    );
    expect(outcome).toEqual({ revoked: false, alerted: false });
    expect(io.markDisconnectReason).not.toHaveBeenCalled();
    expect(io.notifyOwner).not.toHaveBeenCalled();
  });

  it("on first revocation: stamps reason + alerts owner exactly once", async () => {
    const io = makeIo();
    const outcome = await handleIntegrationPollError(
      { id: 30001, emailAddress: "support@packgoplay.com", disconnectReason: null },
      new Error("invalid_grant"),
      io,
    );
    expect(outcome).toEqual({ revoked: true, alerted: true });
    expect(io.markDisconnectReason).toHaveBeenCalledTimes(1);
    expect(io.markDisconnectReason).toHaveBeenCalledWith(
      30001,
      `${REVOCATION_REASON_PREFIX}: invalid_grant`,
    );
    expect(io.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("on a subsequent tick (already flagged): stays quiet, no I/O", async () => {
    const io = makeIo();
    const outcome = await handleIntegrationPollError(
      {
        id: 30001,
        emailAddress: "support@packgoplay.com",
        disconnectReason: `${REVOCATION_REASON_PREFIX}: invalid_grant`,
      },
      new Error("invalid_grant"),
      io,
    );
    expect(outcome).toEqual({ revoked: true, alerted: false });
    expect(io.markDisconnectReason).not.toHaveBeenCalled();
    expect(io.notifyOwner).not.toHaveBeenCalled();
  });

  it("re-arms after reconnect (disconnectReason cleared) → alerts again", async () => {
    const io = makeIo();
    // Simulates a row that was reconnected (callback set disconnectReason=null)
    // and then revoked a second time.
    const outcome = await handleIntegrationPollError(
      { id: 30001, emailAddress: "support@packgoplay.com", disconnectReason: null },
      new Error("Token has been expired or revoked."),
      io,
    );
    expect(outcome.alerted).toBe(true);
    expect(io.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("does not touch a non-revocation disconnectReason set by something else", async () => {
    const io = makeIo();
    // e.g. jeffhsieh09's "Switched to support@…" reason — but that row is
    // isActive=0 so the worker never reaches here. Belt + suspenders: a generic
    // error on such a row still does nothing.
    const outcome = await handleIntegrationPollError(
      {
        id: 1,
        emailAddress: "jeffhsieh09@gmail.com",
        disconnectReason: "Switched to support@packgoplay.com",
      },
      new Error("some other failure"),
      io,
    );
    expect(outcome.revoked).toBe(false);
    expect(io.markDisconnectReason).not.toHaveBeenCalled();
    expect(io.notifyOwner).not.toHaveBeenCalled();
  });
});
