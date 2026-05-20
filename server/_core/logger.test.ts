/**
 * Tests for the pino logger redaction + child-logger + level filtering.
 *
 * Module 1.2 of v2 Wave 1.
 *
 * Strategy: pino accepts a custom `destination` writable stream; we capture
 * every emitted line as JSON and assert on the shape. Each test runs an
 * isolated logger instance against an in-memory destination — the singleton
 * exported from logger.ts is intentionally NOT used here because its dev
 * transport is pino-pretty (not JSON, harder to parse).
 */

import { describe, expect, it } from "vitest";
import pino, { type LoggerOptions } from "pino";

// Mirror the redact config from logger.ts. Keep in sync — any change there
// requires updating this. Inlined (not exported) because the test must
// validate the production config exactly.
const REDACT_PATHS = [
  "req.body.password",
  "req.body.passwordHash",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.confirmPassword",
  "req.body.token",
  "req.body.refreshToken",
  "req.body.accessToken",
  "req.body.apiKey",
  "req.body.passportNumber",
  "req.body.passportExpiry",
  "req.body.dateOfBirth",
  "req.body.phone",
  "req.body.email",
  "req.body.creditCardNumber",
  "req.body.cardNumber",
  "req.body.cvv",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "*.password",
  "*.passwordHash",
  "*.accessToken",
  "*.refreshToken",
  "*.apiKey",
  "*.passportNumber",
  "*.dateOfBirth",
  "*.cvv",
  "*.cardNumber",
  "*.creditCardNumber",
  "password",
  "passwordHash",
  "passportNumber",
  "passportExpiry",
  "dateOfBirth",
  "phone",
  "creditCardNumber",
  "cardNumber",
  "cvv",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
];

function makeTestLogger(opts: Partial<LoggerOptions> = {}) {
  const lines: string[] = [];
  const dest = {
    write(chunk: string) {
      lines.push(chunk);
      return true;
    },
  };
  const log = pino(
    {
      level: "debug",
      redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
      ...opts,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dest as any,
  );
  return {
    log,
    parse: () => lines.map((l) => JSON.parse(l)),
    lines,
  };
}

describe("logger redaction", () => {
  it("redacts passportNumber when nested in req.body", () => {
    const { log, parse } = makeTestLogger();
    log.info({ req: { body: { passportNumber: "X12345678" } } }, "user signup");
    const out = parse();
    expect(out).toHaveLength(1);
    expect(out[0].req.body.passportNumber).toBe("[Redacted]");
  });

  it("redacts passportNumber at the top level", () => {
    const { log, parse } = makeTestLogger();
    log.info({ passportNumber: "X12345678", customerId: 42 }, "kyc");
    const out = parse();
    expect(out[0].passportNumber).toBe("[Redacted]");
    expect(out[0].customerId).toBe(42); // non-PII fields pass through
  });

  it("redacts phone number from top-level field", () => {
    const { log, parse } = makeTestLogger();
    log.info({ phone: "+1 415-555-0123" }, "sms send");
    const out = parse();
    expect(out[0].phone).toBe("[Redacted]");
  });

  it("redacts accessToken / apiKey / secret tokens", () => {
    const { log, parse } = makeTestLogger();
    log.info(
      {
        accessToken: "Bearer xyz",
        apiKey: "sk_live_abc",
        secret: "shhh",
        normalField: "ok",
      },
      "credentials",
    );
    const out = parse();
    expect(out[0].accessToken).toBe("[Redacted]");
    expect(out[0].apiKey).toBe("[Redacted]");
    expect(out[0].secret).toBe("[Redacted]");
    expect(out[0].normalField).toBe("ok");
  });
});

describe("logger level filtering", () => {
  it("debug call below info level produces no output", () => {
    const { log, lines } = makeTestLogger({ level: "info" });
    log.debug({ foo: "bar" }, "should not appear");
    expect(lines).toHaveLength(0);
  });

  it("info call at info level produces output", () => {
    const { log, parse } = makeTestLogger({ level: "info" });
    log.info({ foo: "bar" }, "should appear");
    const out = parse();
    expect(out).toHaveLength(1);
    expect(out[0].msg).toBe("should appear");
  });
});

describe("logger child / bindings", () => {
  it("child logger inherits bindings on every line", () => {
    const { log, parse } = makeTestLogger();
    const child = log.child({ module: "stripeWebhook", requestId: "abc" });
    child.info({ eventId: "evt_1" }, "received");
    child.info({ eventId: "evt_2" }, "processed");
    const out = parse();
    expect(out).toHaveLength(2);
    expect(out[0].module).toBe("stripeWebhook");
    expect(out[0].requestId).toBe("abc");
    expect(out[0].eventId).toBe("evt_1");
    expect(out[1].module).toBe("stripeWebhook");
    expect(out[1].requestId).toBe("abc");
    expect(out[1].eventId).toBe("evt_2");
  });
});
