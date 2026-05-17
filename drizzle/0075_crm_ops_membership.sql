-- Migration 0075: CRM v2 + Tour Groups ops + Membership trials
-- 2026-05-16 — supports Round 81 agent architecture:
--   • Per-customer profile w/ structured preferences (Plus/Concierge only)
--   • Tour group operational layer on top of catalog tourDepartures
--   • 10-day membership trial tracking for AB 390 compliance
--   • Repurchase trigger fields on users (drives 2nd-inquiry upsell)
--
-- Split each statement so TiDB cloud applies them sequentially without
-- the "Information schema is changed during the execution" error.

-- ────────────────────────────────────────────────────────────────────
-- 1. Tour Groups: extend tourDepartures with ops layer
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE tourDepartures ADD COLUMN internalCode VARCHAR(64);
--> statement-breakpoint
ALTER TABLE tourDepartures ADD COLUMN groupName VARCHAR(255);
--> statement-breakpoint
ALTER TABLE tourDepartures ADD COLUMN tourLeader VARCHAR(128);
--> statement-breakpoint
ALTER TABLE tourDepartures ADD COLUMN opsStatus ENUM('planning','confirmed','departed','completed','cancelled') DEFAULT 'planning' NOT NULL;
--> statement-breakpoint
ALTER TABLE tourDepartures ADD COLUMN internalNotes MEDIUMTEXT;
--> statement-breakpoint
ALTER TABLE tourDepartures ADD COLUMN supplierConfirmations JSON;
--> statement-breakpoint
CREATE INDEX idx_departure_opsstatus ON tourDepartures(opsStatus, departureDate);
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────
-- 2. tourGroupNotes: activity log per group (ops/financial/followup/ai)
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE tourGroupNotes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tourDepartureId INT NOT NULL,
  type ENUM('ops','customer','financial','followup','ai_query') NOT NULL,
  author VARCHAR(64) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  attachments JSON,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_departure (tourDepartureId, createdAt DESC),
  INDEX idx_type (type, createdAt DESC)
);
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────
-- 3. customerProfiles: structured preferences + manual notes
--    (existing aiNotes stays — that's free-form AI summary;
--     these new fields are structured + manual)
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE customerProfiles ADD COLUMN preferences JSON;
--> statement-breakpoint
ALTER TABLE customerProfiles ADD COLUMN keyFacts TEXT;
--> statement-breakpoint
ALTER TABLE customerProfiles ADD COLUMN jeffPersonalNote TEXT;
--> statement-breakpoint
ALTER TABLE customerProfiles ADD COLUMN birthDate TIMESTAMP NULL;
--> statement-breakpoint
ALTER TABLE customerProfiles ADD COLUMN importantDates JSON;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────
-- 4. customerDocuments: passport / visa / insurance / medical
--    Sensitive fields (passport number, SSN-like) stored encrypted via
--    APP_ENCRYPTION_KEY (AES-256-GCM, same pattern as Plaid tokens).
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE customerDocuments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customerProfileId INT NOT NULL,
  type ENUM('passport','visa','insurance','medical','other') NOT NULL,
  fileName VARCHAR(255),
  r2Url VARCHAR(1024),
  expiresAt TIMESTAMP NULL,
  isCurrent BOOLEAN DEFAULT TRUE NOT NULL,
  encryptedFields JSON,
  uploadedBy VARCHAR(50),
  uploadedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer_type (customerProfileId, type, isCurrent),
  INDEX idx_expiry (expiresAt, isCurrent)
);
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────
-- 5. membershipTrials: AB 390 compliant 10-day trial tracking
--    Tracks every trial → auto-charge or cancel transition.
--    Prevents multi-trial abuse (1 trial / user / tier).
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE membershipTrials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  tier ENUM('plus','concierge') NOT NULL,
  startedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  endsAt TIMESTAMP NOT NULL,
  reminderSentAt TIMESTAMP NULL,
  converted BOOLEAN DEFAULT FALSE NOT NULL,
  convertedAt TIMESTAMP NULL,
  canceledAt TIMESTAMP NULL,
  cancelReason TEXT,
  stripeSubscriptionId VARCHAR(255),
  stripePriceId VARCHAR(255),
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (userId),
  INDEX idx_ends_pending (endsAt, converted)
);
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────
-- 6. users: repurchase trigger + trial abuse prevention fields
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN inquiryCount INT DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN lastInquiryAt TIMESTAMP NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN upgradePromptSentAt TIMESTAMP NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN plusTrialUsedAt TIMESTAMP NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN conciergeTrialUsedAt TIMESTAMP NULL;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN bookingCount INT DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_users_repurchase ON users(bookingCount, lastInquiryAt, upgradePromptSentAt);
