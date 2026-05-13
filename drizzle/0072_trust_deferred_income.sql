-- Phase 4: CST §17550 trust account income deferral.
--
-- When a customer pays for a tour, CA law requires the money sits in a
-- "trust account" until the customer departs. Only on/after departure does
-- the money legally belong to PACK&GO and can be recognized as income.
--
-- This table records:
--   - Every inflow into a trust account (linked to the originating bank
--     transaction)
--   - The booking it pays for (best-effort match, manually correctable)
--   - The expected recognition date (the booking's departureDate)
--   - Whether/when income was actually recognized in P&L
--   - Reversal info if the booking was cancelled before departure
--
-- Recognition flow (cron 06:00 UTC daily):
--   For each row where recognizedAt IS NULL AND expectedRecognitionDate <= today
--   AND reversedAt IS NULL → mark recognizedAt = NOW(). bankPLService then
--   counts the underlying transaction as income for the recognition date,
--   not the original deposit date.
--
-- Until recognized, the transaction's amount is SUBTRACTED from the P&L's
-- income_booking total so monthly statements correctly reflect deferred
-- revenue.
--
-- Feature-flagged OFF via PLAID_TRUST_DEFERRAL_ENABLED env var. When the
-- flag is off, AccountingAgent classifies trust account inflows as
-- income_booking like any other inflow and they're recognized immediately
-- (matches Phase 3 behavior). Flip ON only after Jeff sanity-checks Q1-Q7
-- in docs/PHASE_4_TRUST_DEFERRAL_DESIGN.md with a fake booking.

CREATE TABLE IF NOT EXISTS `trustDeferredIncome` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  -- The bank transaction this row defers
  `bankTransactionId` INT NOT NULL,
  -- Which trust account (denormalized for fast filter)
  `linkedAccountId` INT NOT NULL,
  -- The booking this payment funds (NULL = unmatched, surfaced in admin)
  `bookingId` INT,
  -- Confidence of the matching heuristic (0-100). Below 70 = ask Jeff.
  `matchConfidence` INT NOT NULL DEFAULT 0,
  -- How the match happened: auto = heuristic, manual = Jeff picked it
  `matchMethod` ENUM('auto','manual','unmatched') NOT NULL DEFAULT 'unmatched',
  -- The amount being deferred (positive = inflow to trust)
  `amount` DECIMAL(14,2) NOT NULL,
  `isoCurrencyCode` VARCHAR(3) NOT NULL DEFAULT 'USD',
  -- When the deposit hit the trust account
  `depositDate` DATE NOT NULL,
  -- When we EXPECT to recognize (= booking.departureDate)
  `expectedRecognitionDate` DATE,
  -- When we ACTUALLY recognized (NULL = still deferred)
  `recognizedAt` TIMESTAMP NULL,
  -- Recognition cron's run-id, for audit
  `recognitionRunId` VARCHAR(64),
  -- If the booking was cancelled and the deposit refunded, set both fields
  `reversedAt` TIMESTAMP NULL,
  `reversedReason` VARCHAR(256),
  -- Free-form note (Jeff override / CPA annotation)
  `notes` TEXT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- One row per bank transaction (no double-defer)
  UNIQUE KEY `uniq_bank_txn` (`bankTransactionId`),
  -- Fast lookup for the daily recognition cron
  KEY `idx_recognition_ready` (`recognizedAt`, `expectedRecognitionDate`, `reversedAt`),
  -- Fast lookup for "what's still in trust for this booking"
  KEY `idx_booking_pending` (`bookingId`, `recognizedAt`),
  -- Fast lookup for trust account reconciliation
  KEY `idx_account_status` (`linkedAccountId`, `recognizedAt`, `reversedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
