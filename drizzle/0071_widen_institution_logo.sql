-- Widen linkedBankAccounts.institutionLogoUrl from VARCHAR(512) → MEDIUMTEXT.
--
-- Plaid returns institution logos as base64-encoded PNG data (~5-15KB per
-- logo). Storing them as `data:image/png;base64,…` URIs in a 512-char column
-- causes ER_DATA_TOO_LONG and silent insert failures across the entire
-- Hosted Link onboarding path (12+ accounts per session = 12 dropped rows).
--
-- Production DB was hotfixed manually via SSH during the Phase 0i debug
-- session (see commit history). This migration codifies the change so:
--   - Fresh dev/staging environments inherit the correct type
--   - The Drizzle migrator's journal stays accurate
--
-- MEDIUMTEXT supports up to 16 MB, which is comfortable for Plaid's 5-15KB
-- payloads with room for future larger logos.

ALTER TABLE `linkedBankAccounts`
  MODIFY COLUMN `institutionLogoUrl` MEDIUMTEXT;
