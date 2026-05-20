-- v2 Wave 1 · Module 1.8 — widen passportNumber for AES-256-GCM ciphertext.
--
-- Pairs with server/db.ts encrypt/decrypt wrappers (encryptToken /
-- decryptToken from server/_core/tokenCrypto.ts) that envelope
-- passportNumber on the way INTO bookingParticipants + visaApplications
-- and decrypt on the way OUT. Ciphertext format is
--   "enc:v1:" + base64( iv(12) | authTag(16) | ciphertext )
-- which runs ~96 chars for a typical 9-char passport string — VARCHAR(50)
-- was too narrow. Widening to VARCHAR(255) gives headroom for any future
-- version-prefix bump (e.g. enc:v2:) without another migration.
--
-- Legacy plaintext rows continue to work via decryptToken's "no enc:v1:
-- prefix → return as-is" fallback. The one-shot
-- server/scripts/backfill-passport-encryption.ts script re-encrypts
-- existing rows post-deploy.
--
-- TiDB-safe: each statement standalone (mirrors migration 0073 precedent).

ALTER TABLE `bookingParticipants` MODIFY COLUMN `passportNumber` VARCHAR(255);
ALTER TABLE `visaApplications` MODIFY COLUMN `passportNumber` VARCHAR(255) NOT NULL;
