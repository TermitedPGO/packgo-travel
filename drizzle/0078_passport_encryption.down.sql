-- Rollback for 0078. Narrows passportNumber columns back to VARCHAR(50).
--
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  WARNING — DESTRUCTIVE IF BACKFILL HAS RUN                          ║
-- ║                                                                      ║
-- ║  Once server/scripts/backfill-passport-encryption.ts has executed   ║
-- ║  in production, every row's passportNumber is the AES-256-GCM       ║
-- ║  ciphertext "enc:v1:<base64>" (~96 chars). MODIFY COLUMN to         ║
-- ║  VARCHAR(50) will SILENTLY TRUNCATE that ciphertext, permanently    ║
-- ║  destroying the data — the truncated bytes cannot be decrypted      ║
-- ║  because the AES authTag is mangled.                                ║
-- ║                                                                      ║
-- ║  SAFE ROLLBACK ORDER:                                                ║
-- ║    1. Revert the code (git revert) so writes go back to plaintext   ║
-- ║       and reads use the legacy-plaintext fallback path.             ║
-- ║    2. Decrypt every row IN PLACE to plaintext (custom script —      ║
-- ║       NOT included in this rollback because plaintext-on-disk is    ║
-- ║       the very thing the forward migration fixed). Escalate to     ║
-- ║       supervisor before running.                                    ║
-- ║    3. THEN run this DOWN migration to narrow the columns.           ║
-- ║                                                                      ║
-- ║  If backfill has NOT yet run, this DOWN is non-destructive: all     ║
-- ║  rows are still ≤50-char plaintext and fit the old column width.   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

ALTER TABLE `bookingParticipants` MODIFY COLUMN `passportNumber` VARCHAR(50);
ALTER TABLE `visaApplications` MODIFY COLUMN `passportNumber` VARCHAR(50) NOT NULL;
