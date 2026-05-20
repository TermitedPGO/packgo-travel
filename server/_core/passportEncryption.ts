/**
 * Passport-at-rest encryption helpers (v2 Wave 1 · Module 1.8).
 *
 * Thin layer over tokenCrypto that handles the row-shape patterns db.ts
 * uses for `bookingParticipants` (passportNumber nullable) and
 * `visaApplications` (passportNumber NOT NULL). Kept separate from db.ts
 * so we can unit-test the encryption boundary without spinning up Drizzle.
 *
 * Contract:
 *   - encryptPassport(plain)               → AES-256-GCM ciphertext
 *     ("enc:v1:" + base64 — see tokenCrypto.ts).
 *   - decryptPassport(stored)              → plaintext; tokenCrypto's
 *     "no enc:v1: prefix → return as-is" fallback covers legacy rows.
 *   - decryptParticipantRow({passportNumber?: string|null})  → row with
 *     decrypted passportNumber (null preserved).
 *   - decryptVisaApplicationRow({passportNumber: string})    → row with
 *     decrypted passportNumber (always present).
 *
 * Direct use:
 *
 *     import {
 *       encryptPassport, decryptPassport,
 *       decryptParticipantRow, decryptVisaApplicationRow,
 *     } from "./passportEncryption";
 *
 * CRITICAL: every read/write touching `passportNumber` in server/db.ts (and
 * any future direct Drizzle write to either column outside db.ts) MUST
 * route through these helpers. Bypassing them leaks plaintext to disk.
 * See CLAUDE.md §四 forbidden patterns.
 */

import { encryptToken, decryptToken } from "./tokenCrypto";

export function encryptPassport(plain: string): string {
  return encryptToken(plain);
}

export function decryptPassport(stored: string): string {
  return decryptToken(stored);
}

export function decryptParticipantRow<T extends { passportNumber?: string | null }>(row: T): T {
  return {
    ...row,
    passportNumber: row.passportNumber ? decryptPassport(row.passportNumber) : (row.passportNumber ?? null),
  } as T;
}

export function decryptVisaApplicationRow<T extends { passportNumber: string }>(row: T): T {
  // visaApplications.passportNumber is NOT NULL — always decrypt.
  return { ...row, passportNumber: decryptPassport(row.passportNumber) };
}
