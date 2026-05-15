-- SECURITY_AUDIT_2026_05_14 P2-1: tamper-evident hash chain on adminAuditLog.
--
-- Add two SHA-256-hex columns:
--   previousHash : the rowHash of the row inserted immediately before this one
--                  (the literal string "GENESIS" for the very first row).
--   rowHash      : SHA-256(previousHash || canonicalRow(this row))
--                  where canonicalRow is a stable JSON.stringify with keys in
--                  a fixed order (see server/_core/auditLog.ts).
--
-- A verifier (admin only) walks the table id-ascending, recomputes each
-- rowHash, and compares against the stored value. Any mismatch flags
-- either a modified row OR a deleted row in the middle of the chain.
--
-- Why this design (vs. revoking DELETE/UPDATE grants):
--   - TiDB Cloud's free tier doesn't support per-table grants for the
--     application user; we'd need a separate user + secret management.
--     Hash chain works at the SQL layer with no grant changes.
--   - Survives a DB-admin-level compromise: anyone with full DB access
--     can still delete/modify rows, but the verifier detects it.
--   - DB-agnostic — if PACK&GO ever moves off TiDB, the chain comes
--     with the data.
--
-- Columns are nullable so existing rows (pre-migration) don't fail.
-- They'll show up as "ungated" in the verifier — those predate the
-- chain and have to be trusted by their createdAt timestamp + ID
-- monotonicity alone.

-- VARCHAR(64) (not CHAR) to match the Drizzle schema's varchar() decl
-- so `drizzle-kit push` doesn't report drift. SHA-256-hex is always
-- exactly 64 chars so no padding semantics matter either way.
ALTER TABLE `adminAuditLog`
  ADD COLUMN `previousHash` VARCHAR(64) NULL AFTER `errorMessage`,
  ADD COLUMN `rowHash` VARCHAR(64) NULL AFTER `previousHash`;

-- The verifier reads rows id-ascending and needs the hash on each row.
-- This composite index supports a fast "tip" lookup (SELECT rowHash
-- FROM adminAuditLog ORDER BY id DESC LIMIT 1) — the PK index alone
-- would still work since rowHash is then a heap lookup per row, but
-- this index covers the lookup completely.
CREATE INDEX `idx_audit_chain` ON `adminAuditLog` (`id`, `rowHash`);
