# Evidence Preservation Manifest — 2026-07-11

> Evidence-preservation index for the Trust Account #5442 fund-flow review
> (`trust-drift-audit-20260711.md`). **This file is the only piece of the
> preservation hold that lives in git. It contains NO sensitive financial data** —
> only filenames, row counts, SHA-256 hashes, capture timestamps, source table
> names, coverage windows, and status. The actual data snapshot is held **off git**,
> local only, under `~/Documents` (a non-synced path: never git, never iCloud,
> never any AI conversation).
>
> Renamed 2026-07-12 from `legal-hold-manifest-20260711.md` →
> `evidence-preservation-manifest-20260711.md` (legal characterization belongs to
> counsel; "evidence preservation hold" is the factual descriptor). The local hold
> directory was likewise renamed `PACKGO_legal_hold_20260711` →
> `PACKGO_evidence_preservation_20260711`. The 12 evidence data files are unchanged
> and their hashes are byte-identical to the original capture.

## Status ladder（現況）

Current position: **rung 4 (gap registry in progress)**. Rung 5 (internal
integrity check) is **NOT** claimed complete.

| # | Stage | Status |
|---|-------|--------|
| 1 | Preservation scope defined | ✅ done |
| 2 | DB-side preserved + hashed | ✅ done |
| 3 | Processor/bank raw collection | ⏳ in progress (Jeff to download — see gap registry) |
| 4 | Gap registry | ⏳ **← current** (13-item registry created) |
| 5 | Internal integrity check | ☐ **not complete** (only a hash spot-check run; formal chain/cross-source verification pending) |

## Snapshot facts

| Item | Value |
|------|-------|
| Snapshot date | 2026-07-11 |
| Source | PACK&GO production DB (Fly app `packgo-travel`, sjc) |
| Method | Read-only `SELECT` only, via `flyctl ssh console` + `mysql2` on `DATABASE_URL`. Zero writes. |
| Data location | `/Users/jeff/Documents/PACKGO_evidence_preservation_20260711/` (local, read-only `chmod -w`) — **never committed to git** |
| Format | One JSON array per table, `dateStrings` (no tz coercion), DECIMAL/JSON preserved |
| Files | 12 evidence data files + 4 derived docs (`README.md`, `GAP_REGISTRY.md`, `SYSTEM_SNAPSHOT.json`, `SYSTEM_SNAPSHOT.md`) + `SHA256SUMS.txt` |

## Evidence data-file index (SHA-256)

Capture timestamps are UTC. Verify locally with `shasum -a 256 -c SHA256SUMS.txt`
in the hold directory. **These 12 hashes are unchanged from the original capture —
that identity is the proof of immutability across the rename.**

| File | Source table | Rows | Bytes | SHA-256 | Captured (UTC) |
|------|--------------|-----:|------:|---------|----------------|
| `bankTransactions.json` | bankTransactions (all accounts, full history) | 1524 | 2365447 | `054acc9c0d748c3b0268ddb6411a48a77c0535a95dd5336948fe33a9650e2897` | 2026-07-11T22:07:28Z |
| `trustDeferredIncome.json` | trustDeferredIncome (all statuses) | 3 | 1703 | `0f0406fc5105c2d637391e99e73a04cb9b44c032b75b5b22759524e9aec0064a` | 2026-07-11T22:06:48Z |
| `bankTransactionLinks.json` | bankTransactionLinks | 16 | 6257 | `477d143cb915df8316dca0c4a31ab6d76d5a54987735730ab2eb3b85bbea7b2a` | 2026-07-11T22:06:50Z |
| `linkedBankAccounts.json` | linkedBankAccounts (redacted, see below) | 4 | 3548 | `1a9f8b7bc68c66aacacca984baf82e30b70684fad7d02646f41ca716a49928a8` | 2026-07-11T22:07:10Z |
| `customOrders.json` | customOrders | 11 | 15272 | `026b889d5935479c8bc9fd4c6389e4c2c093f55495b75e2459e0cb01a26f448b` | 2026-07-11T22:07:31Z |
| `invoices.json` | invoices | 1 | 5327 | `e6a79759a621a02c3673a38be9ab2b8c90839fa3cb1fa9811a6a24febd6e81a7` | 2026-07-11T22:07:33Z |
| `payments.json` | payments | 0 | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 2026-07-11T22:07:46Z |
| `accountingEntries.json` | accountingEntries | 0 | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 2026-07-11T22:07:49Z |
| `checkoutDisclosures.json` | checkoutDisclosures | 0 | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 2026-07-11T22:07:52Z |
| `stripeWebhookEvents.json` | stripeWebhookEvents | 0 | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 2026-07-11T22:07:54Z |
| `adminAuditLog_full.json` | adminAuditLog (complete table) | 333 | 275631 | `4feec4f50f4ddcff412097b55804a8d31c971573cc3913a635527afb3ed13aa2` | 2026-07-11T22:07:56Z |
| `adminAuditLog_trust.json` | adminAuditLog (finance subset, derived from full) | 202 | 174814 | `3d8b3c157c5d2aeacf5184d98a4b3c7a44787a66c84000df79413fdf56c3573f` | 2026-07-11T22:08:34Z |

## Derived preservation-record index (SHA-256, as of 2026-07-12)

De-identified, living documents (updated as gaps fill). No sensitive data.

| File | SHA-256 |
|------|---------|
| `README.md` | `7ed35d011001657f1d01906d73d6fc69d1bbaf2884e59f1196859b714983c754` |
| `GAP_REGISTRY.md` | `933747d07f1567cf887cb2baa172d0679c729071a6f32cd05add86cf620a81d1` |
| `SYSTEM_SNAPSHOT.json` | `2486411b536a1bce4d4f025d499636324526ac025387019d2d282fe4ca251d06` |
| `SYSTEM_SNAPSHOT.md` | `59cf516acfa6b4f302b7381ce1f04c3d959be20b9ad01ce3ff540ad5b13234d2` |

**Master integrity anchor** (hash the checksum file itself):

| File | SHA-256 |
|------|---------|
| `SHA256SUMS.txt` | `6379cad0682a7dfaced4a6b0f54ae5feae03fc522a947da3a0f373dac26c8e15` |

## Coverage windows (dates only — non-sensitive)

- `bankTransactions`: 2025-01-14 → 2026-07-10, across all 4 linked accounts
  (row counts by internal account id: 30001 = 727, 30002 = 614,
  **30003 = 40 (Trust #5442, the account under review)**, 30004 = 143).
- `adminAuditLog`: 2026-04-26 → 2026-07-10. The **full** table is preserved so the
  tamper-evident hash chain (`previousHash`/`rowHash`) can be verified end to end;
  the `_trust` file is a convenience subset and must not be used for chain verification.
- `customOrders`: 2026-07-01 → 2026-07-07.
- `payments`, `accountingEntries`, `checkoutDisclosures`, `stripeWebhookEvents`:
  empty on the snapshot date (preserved as `[]` so "empty" is itself on record).

`adminAuditLog_trust.json` filter: `targetType ∈ {bankTransaction, customOrder,
report}` OR `action` matching `bank|reconcil|categor|payment|deferr|trust|recogn|
transfer|invoice`. (No dedicated `trust.*` action exists; deferral recognition
and transfer are automated and not admin-logged.)

## Redaction

Only `linkedBankAccounts` was redacted, to strip a **live credential** and a
display blob — no financial fact removed:
- excluded `plaidAccessTokenEncrypted` (live Plaid API credential — must not leave the secret store)
- excluded `institutionLogoUrl` (base64 bank-logo PNG, display only)
- preserved: id, name, mask, type, `isTrustAccount`, balances, currency, cursor, sync timestamps.

All other tables are full, unredacted.

## Gap registry (13 items — full detail in the hold's GAP_REGISTRY.md)

DB-side (✅ preserved + hashed): (1) bankTransactions; (2) trustDeferredIncome +
customOrders + invoices; (3) adminAuditLog chain; (4) supporting/link + empty
tables. External (⏳ Jeff to download — only the account holder can export):
(5) **BofA official monthly statements** for all 4 accounts (#2174/#5442/#4899/#9888),
Jan 2025 → Jul 2026 — primary record vs the Plaid-derived DB feed; (6) **Square**
export incl. refunds/disputes/payouts; (7) **Stripe** export incl. charges/payouts/
disputes/fees (DB `payments`/`stripeWebhookEvents` empty → any Stripe activity lives
only on Stripe); (8) **Zelle**; (9) **Venmo**; (10) **PayPal** native export;
(11) **supplier invoices** (cost documentation, not in DB); (12) **R2 receipt PDFs**
(`bankTransactions.receiptUrl`, needs R2 export); (13) **related communications**
(email / 微信 / iMessage re: trust deposits/transfers).

## System snapshot & auto-deletion inventory (summary — full detail in the hold's SYSTEM_SNAPSHOT.*)

- **Feature flags** (code default → prod): `PLAID_TRUST_DEFERRAL_ENABLED` OFF → **ON**
  (§17550 Plaid main switch; pre-existing since Phase 4/block B, observed ON
  2026-07-09 and 2026-07-10; docs still say default OFF — Jeff to confirm intentional);
  `STRIPE_TRUST_DEFERRAL_ENABLED` OFF → OFF (introduced 2026-07-08, awaiting CPA);
  `PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS` default 30, Fly secret Deployed.
- **Cron inventory**: 17 boot-registered repeatable jobs. Financial-relevant:
  plaid-daily-sync (05:00), trust-recognition (06:00), scaling-guardrails (07:00),
  weekly-correctness-audit (Mon 12:00, read-only watchdog).
- **Release timeline**: v805–v811 mapped to representative commits (v806 = F1
  reconciliation engine; v808 = F2 finance compliance + migration 0114; v811 ready,
  awaiting ship).
- **Auto-deletion inventory — conclusion**: **no scheduled job hard-deletes any of
  the 12 preserved tables.** The only scheduled financial mutations are
  non-destructive soft flags (`archived`, `excludeFromAccounting`); rows retained,
  and the immutable off-DB snapshot is unaffected regardless. One **latent** item —
  daily scaling-guardrails `archiveOldTransactions` (2-year retention, soft flag) —
  will begin flag-flipping rows inside the preserved window ~2027-01-14; a disable
  recommendation is recorded but **was not executed** (deploy is `pnpm ship` /
  Jeff's call, and effect is latent until 2027). `cleanupOrphanReceipts` is a v1
  no-op stub (future threat to R2 receipts if v2 R2-reaping is wired). Manual
  deletion surfaces (adminCleanup purge, CSV-merge de-dup, sandboxResidueCleanup —
  triple-guarded against the 4 real BofA accounts) are non-scheduled; Jeff should
  avoid triggering them during the hold.
