// server/email/index.test.ts
//
// Smoke tests for the email shim + per-template renderers.
//
// Goals:
//   1. Surface check — every public function the monolith used to export
//      is reachable from the new `server/email` directory module.
//   2. Render check — a representative template (bookingConfirmation)
//      builds the expected HTML/text payload and invokes the mocked
//      SMTP transporter exactly once with `from`/`to`/`subject`/`html`.
//   3. Notify-owner check — booking confirmation always calls
//      notifyOwner so Jeff sees new orders even when SMTP is down.
//
// We mock at the boundary (`getTransporter` + `notifyOwner`) so we
// never touch real Gmail / Slack from CI.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories run BEFORE imports, so any captured variables must
// live in a vi.hoisted() block. We expose the mocks here for assertions.
const { sendMailMock, notifyOwnerMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async () => ({ messageId: "test-msg-id" })),
  notifyOwnerMock: vi.fn(async () => undefined),
}));

vi.mock("./_shared", () => ({
  EMAIL_FROM: "noreply@packgo.test",
  BASE_URL: "https://packgo-test.fly.dev",
  getTransporter: () => ({ sendMail: sendMailMock }),
}));

vi.mock("../_core/notification", () => ({
  notifyOwner: notifyOwnerMock,
}));

vi.mock("../_core/redact", () => ({
  redactEmail: (e: string) => e,
}));

import * as emailModule from "./index";
import { sendBookingConfirmationEmail } from "./templates/bookingConfirmation";
import { sendPaymentSuccessEmail } from "./templates/paymentSuccess";

describe("server/email — public surface", () => {
  it("re-exports every template sender the monolith used to expose", () => {
    // 11 senders + getTransporter
    expect(typeof emailModule.sendBookingConfirmationEmail).toBe("function");
    expect(typeof emailModule.sendPaymentSuccessEmail).toBe("function");
    expect(typeof emailModule.sendTripReminderEmail).toBe("function");
    expect(typeof emailModule.sendSupplierNotificationEmail).toBe("function");
    expect(typeof emailModule.sendQuoteFollowUpEmail).toBe("function");
    expect(typeof emailModule.sendReviewRequestEmail).toBe("function");
    expect(typeof emailModule.sendAbandonmentRecoveryEmail).toBe("function");
    expect(typeof emailModule.sendVoucherIssuedEmail).toBe("function");
    expect(typeof emailModule.sendWinbackEmail).toBe("function");
    expect(typeof emailModule.sendCheckinEmail).toBe("function");
    expect(typeof emailModule.sendTrialEndingReminder).toBe("function");
    expect(typeof emailModule.getTransporter).toBe("function");
  });
});

describe("bookingConfirmation template", () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    notifyOwnerMock.mockClear();
  });

  it("notifies the owner AND sends a customer email via SMTP (zh-TW default)", async () => {
    const result = await sendBookingConfirmationEmail({
      to: "customer@example.com",
      customerName: "王小明",
      customerEmail: "customer@example.com",
      bookingId: 12345,
      tourTitle: "日本關西 7 日遊",
      departureDate: "2026-07-01",
      returnDate: "2026-07-07",
      numberOfAdults: 2,
      numberOfChildren: 1,
      numberOfInfants: 0,
      totalPrice: 80000,
      depositAmount: 20000,
      remainingAmount: 60000,
    });

    expect(result).toBe(true);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    const ownerArgs = notifyOwnerMock.mock.calls[0][0] as {
      title: string;
      content: string;
    };
    expect(ownerArgs.title).toContain("12345");
    expect(ownerArgs.title).toContain("王小明");

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailArgs = sendMailMock.mock.calls[0][0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(mailArgs.to).toBe("customer@example.com");
    expect(mailArgs.subject).toContain("訂單已收到");
    expect(mailArgs.subject).toContain("12345");
    expect(mailArgs.html).toContain("PACK&amp;GO");
    expect(mailArgs.html).toContain("NT$ 20,000");
    expect(mailArgs.html).toContain("NT$ 80,000");
    expect(mailArgs.text).toContain("訂單編號：12345");
  });

  it("switches subject + body to English when language=en", async () => {
    await sendBookingConfirmationEmail({
      to: "alice@example.com",
      customerName: "Alice",
      customerEmail: "alice@example.com",
      bookingId: 67890,
      tourTitle: "Kansai 7-day",
      departureDate: "2026-08-01",
      returnDate: "2026-08-07",
      numberOfAdults: 1,
      numberOfChildren: 0,
      numberOfInfants: 0,
      totalPrice: 50000,
      depositAmount: 10000,
      remainingAmount: 40000,
      language: "en",
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailArgs = sendMailMock.mock.calls[0][0] as { subject: string; html: string };
    expect(mailArgs.subject.startsWith("Booking received")).toBe(true);
    expect(mailArgs.html).toContain("Booking received!");
    expect(mailArgs.html).toContain("1 adult");
  });
});

// Phase 0.1 (booking-hardening): the payment-success email must show the
// currency the customer was ACTUALLY charged in. UV tours charge USD — a
// customer who paid $1,800 must never read "NT$ 1,800".
describe("paymentSuccess template — currency", () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    notifyOwnerMock.mockClear();
  });

  const base = {
    customerName: "Alice",
    customerEmail: "alice@example.com",
    bookingId: 555,
    tourTitle: "Alaska Cruise 8-day",
    paymentAmount: 1800,
    paymentType: "deposit" as const,
    language: "en" as const,
  };

  it("renders $ for USD payments (never NT$)", async () => {
    await sendPaymentSuccessEmail({ ...base, currency: "USD" });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailArgs = sendMailMock.mock.calls[0][0] as { html: string; text: string };
    expect(mailArgs.html).toContain("$ 1,800");
    expect(mailArgs.html).not.toContain("NT$");
    expect(mailArgs.text).toContain("$ 1,800");
    expect(mailArgs.text).not.toContain("NT$");
  });

  it("defaults to NT$ when currency is omitted (legacy TWD bookings)", async () => {
    await sendPaymentSuccessEmail({ ...base });

    const mailArgs = sendMailMock.mock.calls[0][0] as { html: string; text: string };
    expect(mailArgs.html).toContain("NT$ 1,800");
    expect(mailArgs.text).toContain("NT$ 1,800");
  });

  it("falls back to the ISO code prefix for other currencies", async () => {
    await sendPaymentSuccessEmail({ ...base, currency: "EUR" });

    const mailArgs = sendMailMock.mock.calls[0][0] as { html: string };
    expect(mailArgs.html).toContain("EUR 1,800");
    expect(mailArgs.html).not.toContain("NT$");
  });

  it("owner notification shows the charged currency too", async () => {
    await sendPaymentSuccessEmail({ ...base, currency: "USD", language: "zh-TW" });

    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    const ownerArgs = notifyOwnerMock.mock.calls[0][0] as { content: string };
    expect(ownerArgs.content).toContain("$ 1,800");
    expect(ownerArgs.content).not.toContain("NT$");
  });
});
