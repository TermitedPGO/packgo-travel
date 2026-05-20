/**
 * v2 Wave 1 · Module 1.8 — passport-at-rest encryption tests.
 *
 * Three contract guarantees:
 *
 *   Case 1 (round-trip via tokenCrypto)
 *     - encryptPassport("X12345678") returns a string starting with
 *       "enc:v1:"; decryptPassport on that ciphertext returns the
 *       original plaintext.
 *
 *   Case 2 (legacy plaintext fallback)
 *     - decryptPassport on a value WITHOUT the "enc:v1:" prefix returns
 *       the value as-is. This is the migration safety net so legacy rows
 *       (pre-backfill) continue to work transparently.
 *
 *   Case 3 (db.ts encryption-boundary helpers)
 *     - decryptParticipantRow on a row with encrypted passportNumber →
 *       returns row with plaintext.
 *     - decryptParticipantRow on a row with null passportNumber → preserves null.
 *     - decryptParticipantRow on a legacy plaintext row → returns same plaintext.
 *     - decryptVisaApplicationRow on encrypted → returns plaintext.
 *     - decryptVisaApplicationRow on legacy plaintext → returns same plaintext.
 *     - Pattern used by db.ts: encrypt at insert, decrypt at read — round-trip
 *       preserves the original plaintext.
 *
 * The encryption key is set at module load so tokenCrypto can encrypt
 * without a real APP_ENCRYPTION_KEY env var in CI. No DB / network access.
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";

// Set encryption key BEFORE the first call into tokenCrypto.
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

import { encryptToken, decryptToken, isEncrypted } from "./tokenCrypto";
import {
  encryptPassport,
  decryptPassport,
  decryptParticipantRow,
  decryptVisaApplicationRow,
} from "./passportEncryption";

// ─────────────────────────────────────────────────────────────────────
// Case 1 — direct tokenCrypto / passport round-trip
// ─────────────────────────────────────────────────────────────────────

describe("passportEncryption — round-trip", () => {
  it("encryptPassport returns enc:v1: prefixed ciphertext", () => {
    const ciphertext = encryptPassport("X12345678");
    expect(ciphertext.startsWith("enc:v1:")).toBe(true);
    expect(ciphertext).not.toBe("X12345678");
    expect(isEncrypted(ciphertext)).toBe(true);
  });

  it("decryptPassport on encrypted value returns original plaintext", () => {
    const plaintext = "X12345678";
    const ciphertext = encryptPassport(plaintext);
    expect(decryptPassport(ciphertext)).toBe(plaintext);
  });

  it("each encryption produces a different ciphertext (IV randomness)", () => {
    const a = encryptPassport("X12345678");
    const b = encryptPassport("X12345678");
    expect(a).not.toBe(b);
    // But both decrypt to the same plaintext.
    expect(decryptPassport(a)).toBe("X12345678");
    expect(decryptPassport(b)).toBe("X12345678");
  });

  it("encryptPassport and encryptToken produce compatible output", () => {
    // Confirms helpers are a thin alias — same envelope, same key.
    const a = encryptPassport("X12345678");
    expect(decryptToken(a)).toBe("X12345678");
    const b = encryptToken("X12345678");
    expect(decryptPassport(b)).toBe("X12345678");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Case 2 — legacy plaintext fallback
// ─────────────────────────────────────────────────────────────────────

describe("passportEncryption — legacy plaintext fallback", () => {
  it("decryptPassport on a plaintext value (no enc:v1: prefix) returns it as-is", () => {
    expect(decryptPassport("X12345678")).toBe("X12345678");
    expect(isEncrypted("X12345678")).toBe(false);
  });

  it("decryptPassport handles passport-looking strings transparently", () => {
    // Mix of formats observed in the wild — US passports, EU MRZ, etc.
    const samples = ["A12345678", "P09876543", "G123456", "EF1234567"];
    for (const s of samples) {
      expect(decryptPassport(s)).toBe(s);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Case 3 — db.ts encryption-boundary helpers
//
// db.ts wraps every passportNumber READ with decryptParticipantRow or
// decryptVisaApplicationRow before returning to callers, and every
// passportNumber WRITE with encryptPassport before insert. These tests
// verify the row-shape behavior the wrapper code relies on.
// ─────────────────────────────────────────────────────────────────────

describe("passportEncryption — decryptParticipantRow (bookingParticipants)", () => {
  it("returns plaintext for an encrypted row", () => {
    const ciphertext = encryptPassport("P99887766");
    const out = decryptParticipantRow({
      id: 1,
      bookingId: 42,
      passportNumber: ciphertext,
      firstName: "Bob",
    } as never);
    expect(out.passportNumber).toBe("P99887766");
    expect(out.firstName).toBe("Bob");
  });

  it("preserves null when passportNumber is null", () => {
    const out = decryptParticipantRow({
      id: 2,
      bookingId: 42,
      passportNumber: null,
    } as never);
    expect(out.passportNumber).toBeNull();
  });

  it("passes legacy plaintext through unchanged", () => {
    const out = decryptParticipantRow({
      id: 3,
      bookingId: 42,
      passportNumber: "P99887766",
    } as never);
    expect(out.passportNumber).toBe("P99887766");
  });

  it("preserves all other fields on the row", () => {
    const ciphertext = encryptPassport("P99887766");
    const out = decryptParticipantRow({
      id: 4,
      bookingId: 42,
      participantType: "adult",
      firstName: "Bob",
      lastName: "Lee",
      dietaryRequirements: "vegetarian",
      passportNumber: ciphertext,
    } as never);
    expect(out.passportNumber).toBe("P99887766");
    expect((out as never as { participantType: string }).participantType).toBe("adult");
    expect((out as never as { dietaryRequirements: string }).dietaryRequirements).toBe("vegetarian");
  });
});

describe("passportEncryption — decryptVisaApplicationRow (visaApplications)", () => {
  it("returns plaintext for an encrypted row", () => {
    const ciphertext = encryptPassport("X12345678");
    const out = decryptVisaApplicationRow({
      id: 1,
      firstName: "Alice",
      lastName: "Chen",
      passportNumber: ciphertext,
    } as never);
    expect(out.passportNumber).toBe("X12345678");
    expect(out.firstName).toBe("Alice");
  });

  it("passes legacy plaintext through unchanged", () => {
    const out = decryptVisaApplicationRow({
      id: 2,
      firstName: "Alice",
      lastName: "Chen",
      passportNumber: "X12345678",
    } as never);
    expect(out.passportNumber).toBe("X12345678");
  });

  it("preserves all other fields on the row", () => {
    const ciphertext = encryptPassport("X12345678");
    const out = decryptVisaApplicationRow({
      id: 3,
      firstName: "Alice",
      lastName: "Chen",
      email: "alice@example.com",
      visaType: "L_tourist",
      passportNumber: ciphertext,
    } as never);
    expect(out.passportNumber).toBe("X12345678");
    expect((out as never as { email: string }).email).toBe("alice@example.com");
    expect((out as never as { visaType: string }).visaType).toBe("L_tourist");
  });
});

describe("passportEncryption — full write→read round-trip (db.ts pattern)", () => {
  it("write then read for bookingParticipants returns plaintext", () => {
    // Simulate what db.ts does: encrypt before insert, decrypt the row before returning.
    const plaintext = "P99887766";
    const storedPassport = encryptPassport(plaintext);
    expect(storedPassport.startsWith("enc:v1:")).toBe(true);
    const rowFromDb = { id: 1, bookingId: 42, passportNumber: storedPassport };
    const returned = decryptParticipantRow(rowFromDb as never);
    expect(returned.passportNumber).toBe(plaintext);
  });

  it("write then read for visaApplications returns plaintext", () => {
    const plaintext = "X12345678";
    const storedPassport = encryptPassport(plaintext);
    expect(storedPassport.startsWith("enc:v1:")).toBe(true);
    const rowFromDb = {
      id: 1,
      firstName: "Alice",
      lastName: "Chen",
      passportNumber: storedPassport,
    };
    const returned = decryptVisaApplicationRow(rowFromDb as never);
    expect(returned.passportNumber).toBe(plaintext);
  });
});
