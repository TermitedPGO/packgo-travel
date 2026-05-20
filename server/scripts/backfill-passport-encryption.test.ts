/**
 * v2 Wave 1 · Module 1.8 — backfill script behavior tests.
 *
 * The script in server/scripts/backfill-passport-encryption.ts has to be
 * idempotent: running it twice on the same DB must NOT double-encrypt,
 * NOT leave any row plaintext, and NOT change rows that were already
 * encrypted on a prior run.
 *
 * These tests exercise the encryption logic against an in-memory store
 * that mimics what the script's UPDATE batches would do. We don't spin up
 * Drizzle here — the goal is to verify the idempotency invariant of the
 * pattern: "encrypt rows where passportNumber NOT LIKE 'enc:v1:%'".
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";

process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

import {
  encryptPassport,
  decryptPassport,
} from "../_core/passportEncryption";
import { isEncrypted } from "../_core/tokenCrypto";

/**
 * Simulate one pass of the backfill batch loop on an in-memory store.
 * Mirrors processBookingParticipantsBatch / processVisaApplicationsBatch
 * logic from the production script: pick rows that don't start with
 * "enc:v1:", encrypt them in place, return count processed.
 */
function backfillPass(rows: Array<{ id: number; passportNumber: string | null }>): number {
  let processed = 0;
  for (const row of rows) {
    if (!row.passportNumber) continue;
    if (isEncrypted(row.passportNumber)) continue;
    row.passportNumber = encryptPassport(row.passportNumber);
    processed += 1;
  }
  return processed;
}

describe("backfill-passport-encryption — idempotency", () => {
  it("encrypts all plaintext rows on first run", () => {
    const rows = [
      { id: 1, passportNumber: "X12345678" },
      { id: 2, passportNumber: "P09876543" },
      { id: 3, passportNumber: "G123456" },
    ];
    const processed = backfillPass(rows);
    expect(processed).toBe(3);
    for (const r of rows) {
      expect(isEncrypted(r.passportNumber!)).toBe(true);
    }
  });

  it("second run is a no-op (returns 0, leaves rows unchanged)", () => {
    const rows = [
      { id: 1, passportNumber: "X12345678" },
      { id: 2, passportNumber: "P09876543" },
    ];
    backfillPass(rows);
    const ciphertexts = rows.map((r) => r.passportNumber);

    const processedSecond = backfillPass(rows);
    expect(processedSecond).toBe(0);
    // Rows unchanged byte-for-byte — no re-encryption on the second pass.
    for (let i = 0; i < rows.length; i += 1) {
      expect(rows[i].passportNumber).toBe(ciphertexts[i]);
    }
  });

  it("mixed-state run only touches plaintext rows", () => {
    // Pre-encrypt row 2, leave rows 1, 3 as plaintext.
    const rows = [
      { id: 1, passportNumber: "X12345678" },
      { id: 2, passportNumber: encryptPassport("P09876543") },
      { id: 3, passportNumber: "G123456" },
    ];
    const cipherBefore = rows[1].passportNumber;
    const processed = backfillPass(rows);
    // Only 1 and 3 should be processed.
    expect(processed).toBe(2);
    // Row 2 untouched (re-encryption would produce a different ciphertext
    // due to IV randomness, so byte-equality is a real assertion here).
    expect(rows[1].passportNumber).toBe(cipherBefore);
    // Rows 1 and 3 are now encrypted.
    expect(isEncrypted(rows[0].passportNumber!)).toBe(true);
    expect(isEncrypted(rows[2].passportNumber!)).toBe(true);
  });

  it("post-backfill rows decrypt to original plaintext", () => {
    const originals = ["X12345678", "P09876543", "G123456"];
    const rows = originals.map((p, i) => ({ id: i + 1, passportNumber: p }));
    backfillPass(rows);
    for (let i = 0; i < rows.length; i += 1) {
      expect(decryptPassport(rows[i].passportNumber!)).toBe(originals[i]);
    }
  });

  it("null passportNumber rows are skipped, never encrypted", () => {
    const rows = [
      { id: 1, passportNumber: null as string | null },
      { id: 2, passportNumber: "X12345678" as string | null },
    ];
    const processed = backfillPass(rows as never);
    expect(processed).toBe(1);
    expect(rows[0].passportNumber).toBeNull();
    expect(isEncrypted(rows[1].passportNumber!)).toBe(true);
  });
});
