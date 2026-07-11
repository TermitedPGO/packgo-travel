# Legal Hold Manifest — 2026-07-11

> Evidence-preservation index for the Trust Account #5442 fund-flow review
> (`trust-drift-audit-20260711.md`). **This file is the only piece of the legal
> hold that lives in git. It contains NO sensitive financial data** — only
> filenames, row counts, SHA-256 hashes, capture timestamps, source table names,
> and coverage windows. The actual data snapshot is held **off git**, local only.

## Snapshot facts

| Item | Value |
|------|-------|
| Snapshot date | 2026-07-11 |
| Source | PACK&GO production DB (Fly app `packgo-travel`, sjc) |
| Method | Read-only `SELECT` only, via `flyctl ssh console` + `mysql2` on `DATABASE_URL`. Zero writes. |
| Data location | `/Users/jeff/Documents/PACKGO_legal_hold_20260711/` (local, read-only `chmod -w`) — **never committed to git** |
| Format | One JSON array per table, `dateStrings` (no tz coercion), DECIMAL/JSON preserved |
| Files | 12 data files + `README.md` + `SHA256SUMS.txt` |

## File index (SHA-256)

Capture timestamps are UTC. Verify locally with
`shasum -a 256 -c SHA256SUMS.txt` in the hold directory.

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

**Master integrity anchors** (hash the index files themselves):

| File | SHA-256 |
|------|---------|
| `SHA256SUMS.txt` | `c62550238a477b85ad008594b1f142e6d7556e86ec03432c19a174dc1ab9ceb4` |
| `README.md` | `fcdba9a0c3999dbb8325518c3970b887371ff1e746431a451e046abf0a01464f` |

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

## Known gaps — must be collected manually (processor / bank side)

The full list with reasons is in the hold directory's `README.md` §6. Summary of
what Jeff needs to download and add to the hold:

1. **Bank of America official monthly statements (PDF)** for all 4 accounts
   (#2174, #5442, #4899, #9888), Jan 2025 → Jul 2026. These are the primary
   record; `bankTransactions` here is the Plaid-derived feed.
2. **Square** — full transaction export incl. refunds and disputes, plus payouts.
3. **Stripe** — full export incl. charges, payouts, disputes, fees (DB `payments`/
   `stripeWebhookEvents` are empty, so any Stripe activity lives only on Stripe).
4. **Zelle / Venmo / PayPal** — processor-side transaction histories for the period.
5. **Receipt PDFs in Cloudflare R2** referenced by `bankTransactions.receiptUrl`
   (not part of this DB snapshot).
