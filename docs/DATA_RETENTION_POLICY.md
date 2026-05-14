# Pack&Go LLC — Data Retention and Deletion Policy

| | |
|---|---|
| **Document version** | 1.0 |
| **Effective date** | 2026-05-14 |
| **Last reviewed** | 2026-05-14 |
| **Owner** | Chunfu Hsieh, Owner / Operator |
| **Contact** | support@packgoplay.com |
| **Next scheduled review** | 2027-05-14 (annual) |

---

## 1. Purpose and Scope

This policy defines how long Pack&Go LLC ("the Company") retains
different categories of data, the procedures for deleting data when
retention periods expire, and how users may exercise their rights to
request data deletion.

The policy applies to all data processed by Pack&Go in the operation
of its travel agency business and its internal bookkeeping system,
including:

- Customer personal information (PII)
- Booking and transaction records
- Bank account integration data (via Plaid)
- Audit logs and security records
- Application logs and analytics

---

## 2. Data Categories and Retention Periods

The Company recognizes that different data categories have different
legal, business, and tax-driven retention requirements. The table
below documents each category, its retention period, and the
governing rationale.

### 2.1 Customer Personal Information (PII)

| Data | Retention period | Rationale |
|---|---|---|
| Name, email, phone, mailing address | 3 years after last booking | Industry-standard for travel agency customer support; covers post-trip review and recurring-customer marketing window |
| Date of birth (if collected for visa or insurance) | 3 years after last booking | Same as above |
| Government ID (passport scans for visa applications) | 90 days after travel completion | Minimum needed for visa lifecycle; deleted promptly to limit exposure |
| Payment card details | **Never stored** | Pack&Go does not store card data; Stripe is the PCI processor |

### 2.2 Booking and Trip Records

| Data | Retention period | Rationale |
|---|---|---|
| Booking records (tour, dates, party, status) | 7 years after departure | IRS record-retention requirement for taxable income |
| Itineraries (generated tour content) | 7 years after departure | Reference for service-quality disputes; tax-record adjacent |
| Customer communications (inquiries, support tickets) | 3 years after closure | Service quality + dispute resolution |

### 2.3 Financial Data

| Data | Retention period | Rationale |
|---|---|---|
| Bank transactions (from Plaid) | **Indefinite** | Required for IRS audit defense (7-year minimum) and CST §17550 trust account audit (CA travel-agency rule) |
| AccountingAgent classifications + jeff overrides | Indefinite | Audit trail for tax-classification decisions |
| Audit log of admin actions on financial data | Indefinite | Compliance / forensic integrity |
| Invoices and receipts | 7 years | IRS minimum |
| Trust account deferral records (`trustDeferredIncome`) | Indefinite | CST §17550 audit requirement (CA Seller of Travel) |

### 2.4 Plaid Integration Data

| Data | Retention period | Rationale |
|---|---|---|
| Encrypted Plaid `access_token` | Until owner disconnects account | Plaid-recommended practice; revoked on `/item/remove` |
| Plaid `webhookEvents` (audit trail of incoming webhooks) | 1 year | Operational debugging; auto-pruned beyond 1 year |
| Plaid `linkedBankAccounts` rows after disconnect | Soft-deleted (`isActive=0`); rows retained indefinitely with `plaidAccessTokenEncrypted` cleared | Preserves historical context for transaction history; token field zeroed at disconnect time |

### 2.5 Application Logs

| Data | Retention period | Rationale |
|---|---|---|
| Fly.io application logs | 30 days (Fly.io default) | Operational debugging |
| HTTP access logs | 30 days | Operational; PII redacted at write time |
| Error stack traces | 90 days | Reproduction window for bug fixes |

### 2.6 Security Logs

| Data | Retention period | Rationale |
|---|---|---|
| Authentication events (login success/failure) | 1 year | Anomaly detection; rate-limit forensics |
| Admin audit log | Indefinite | Compliance / forensic integrity |
| Rate-limit hits and account lockouts | 90 days | Anomaly pattern review |

---

## 3. Deletion Procedures

### 3.1 Automated Deletion

Where data has a defined expiry, deletion is automated via scheduled
BullMQ workers:

- **Plaid webhook events older than 1 year** — pruned weekly
- **Application error logs older than 90 days** — pruned weekly
- **Security login events older than 1 year** — pruned monthly
- **Customer government ID scans older than 90 days post-travel** —
  flagged for manual deletion review (no automated bulk delete for
  customer-identifying data)

### 3.2 Manual Deletion

For data without automated expiry, deletion is initiated by the Owner
following these steps:

1. Verify the deletion is permitted (no active legal hold, no pending
   tax audit, no open dispute)
2. Confirm any external dependencies (e.g., active Plaid item, active
   Stripe customer)
3. Execute the deletion via admin dashboard or direct SQL with audit
   log entry recording the action
4. Verify backup retention rules (Section 5) — deletions in the
   primary database take 30+ days to propagate out of backups

### 3.3 Soft-Delete vs Hard-Delete

Some tables use a soft-delete pattern (e.g., `linkedBankAccounts.isActive=0`)
to preserve historical context while preventing the record from
appearing in admin views. Soft-deleted rows:

- Are excluded from default queries
- Retain their original `id` for foreign-key integrity
- Have any sensitive fields (e.g., encrypted Plaid access tokens)
  zeroed at soft-delete time

Hard-delete is used for data with mandatory expiry (logs, government
ID scans, expired tokens) and for processing user data deletion
requests per Section 4.

---

## 4. User Rights (CCPA + Privacy Policy)

Pack&Go is subject to the California Consumer Privacy Act (CCPA) as a
California-registered business. Users may exercise the following
rights:

### 4.1 Right to Know

A user may request a copy of all personal data Pack&Go holds about
them. The Owner will provide a response within 45 days of verified
request.

### 4.2 Right to Delete

A user may request deletion of their personal data. Pack&Go will
honor the request within 45 days unless retention is required for:

- A pending or recent booking (last 30 days)
- Resolving an active dispute or refund
- Compliance with a legal obligation (tax records, CST §17550 trust
  records)
- Detection of security incidents or fraudulent activity

If deletion is denied due to one of the above, the user is informed of
the specific reason and the date the data becomes eligible for deletion.

### 4.3 Right to Correct

A user may request correction of inaccurate personal data. Most
corrections are user-initiated through the account-settings page;
others require Owner action.

### 4.4 Right to Opt Out

Pack&Go does not sell user data. There is no opt-out flow needed.

### 4.5 Request Channel

All CCPA requests are made via email to `support@packgoplay.com` with
the subject line beginning `CCPA Request:`. The Owner responds within
10 days to acknowledge and within 45 days to fulfill.

---

## 5. Backup Retention

The production database (TiDB Cloud) maintains backups according to
the TiDB Cloud Service Plan in effect:

- **Daily snapshots** — retained for 7 days
- **Weekly snapshots** — retained for 30 days
- **Monthly snapshots** — retained for 90 days

Backups are encrypted at rest (AES-256). When a user's data is
deleted from the primary database, the data remains in encrypted
backups until the longest applicable backup retention period expires
(maximum 90 days).

This 30-90 day backup window is disclosed in our Privacy Policy
(linked from the website footer at packgoplay.com) and is consistent
with industry-standard data deletion practice.

---

## 6. Legal Holds

When data is subject to a legal hold (active litigation, regulatory
investigation, formal audit), all otherwise-scheduled deletions are
suspended for the duration of the hold. The Owner documents the hold
in the audit log including the date initiated, the scope, and the
expected duration.

Legal holds override the retention periods documented in Section 2.

---

## 7. International Transfers

Pack&Go customers are predominantly US- and Asia-based. The Company:

- Hosts its production database (TiDB Cloud) in US-East
- Uses Plaid (US) and Stripe (US) for financial integrations
- Does not currently transfer data to entities outside the United
  States

If Pack&Go begins serving EU customers or storing data outside the US
in the future, this policy will be updated with applicable GDPR /
adequacy-decision provisions.

---

## 8. Plaid-Specific Considerations

Per Plaid's developer policies, Pack&Go:

- Retains Plaid `access_token` only as long as needed for the
  business purpose (the owner's bank-sync feature)
- Calls `/item/remove` on disconnect to revoke the access token on
  Plaid's side
- Zeroes the `plaidAccessTokenEncrypted` field at disconnect time
- Retains historical transaction data (`bankTransactions`) because
  these are the Company's own financial records, not third-party
  consumer data

The Company is not subject to Plaid's "Consumer-Provided Data" deletion
requirements because the Plaid integration is admin-only and the data
flowing through is the business owner's own bank transactions, not
data sourced from third-party consumers.

---

## 9. Policy Review

This policy is reviewed annually. The next scheduled review is
**2027-05-14**.

Reviews may occur ad-hoc if:

- A material data-handling incident occurs
- New data categories are introduced (e.g., new product line)
- Applicable law changes (CCPA, GDPR, IRS, CST §17550)
- A new third-party processor is added

Policy version history is maintained in this document's repository
(`docs/DATA_RETENTION_POLICY.md` on the private production
repository).

---

| | |
|---|---|
| **Approved by** | Chunfu Hsieh, Owner |
| **Date** | 2026-05-14 |
