/**
 * Unit tests for server/_core/notification.ts.
 *
 * v2 Wave 1 Module 1.1 regression anchor: notifyOwner must keep working
 * AND must also surface the alert in Sentry (belt + suspenders per
 * CLAUDE.md §核心原則).
 *
 * We mock:
 *   - nodemailer (so no real SMTP)
 *   - ./sentry (so we can assert captureMessage was called)
 *
 * vi.mock() is hoisted to the top of the file by Vitest, so we cannot
 * reference let-bound spies inside the factory. Instead we capture the
 * spy with `vi.hoisted()` and reference it from both the factory and
 * the tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  sendMail: vi.fn().mockResolvedValue({ messageId: "test" }),
}));

// Mock nodemailer so notifyOwner never tries real SMTP.
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: hoisted.sendMail }),
  },
  createTransport: vi.fn().mockReturnValue({ sendMail: hoisted.sendMail }),
}));

// Mock our Sentry wrapper.
vi.mock("./sentry", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  initSentry: vi.fn(),
  isSentryInitialized: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
}));

import { notifyOwner } from "./notification";
import { captureMessage } from "./sentry";

describe("notifyOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMAIL_USER = "test@example.com";
    process.env.EMAIL_PASSWORD = "test-app-password";
  });

  it("(regression) still sends email when SMTP is configured", async () => {
    const ok = await notifyOwner({
      title: "Test title",
      content: "Test body",
    });

    expect(hoisted.sendMail).toHaveBeenCalled();
    expect(ok).toBe(true);
  });

  it("(new) ALSO calls Sentry.captureMessage with warning level", async () => {
    await notifyOwner({
      title: "Worker failure",
      content: "BullMQ job 42 failed",
    });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, level] = (captureMessage as any).mock.calls[0];
    expect(msg).toContain("Worker failure");
    expect(msg).toContain("BullMQ job 42 failed");
    expect(level).toBe("warning");
  });

  it("(regression) rejects empty title", async () => {
    await expect(
      notifyOwner({ title: "", content: "hello" }),
    ).rejects.toThrow(/Notification title is required/);
  });

  it("(regression) rejects empty content", async () => {
    await expect(
      notifyOwner({ title: "hello", content: "" }),
    ).rejects.toThrow(/Notification content is required/);
  });
});
