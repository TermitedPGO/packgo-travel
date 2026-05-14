# Pack&Go LLC — Information Security Policy

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

This policy defines the information security practices in effect at Pack&Go
LLC ("the Company"), a California-registered limited liability company
operating a custom travel agency under California Seller of Travel
registration #2166984.

The policy applies to:

- All systems that store, process, or transmit Company financial data,
  customer personal information, or third-party (e.g., Plaid, Stripe,
  Google) credentials.
- All persons with administrative access to Company systems. Currently
  the sole administrator is the Owner; the policy is written to scale
  as Pack&Go adds contractors or employees.

The policy operationalizes the controls Pack&Go relies on to identify,
mitigate, and monitor information security risks.

---

## 2. Information Security Officer

The Owner serves as the Information Security Officer (ISO). The ISO is
responsible for:

- Maintaining and reviewing this policy
- Reviewing security incidents and remediation
- Approving access changes for any future contractors or employees
- Conducting the annual policy review

Contact: support@packgoplay.com (monitored daily by the Owner).

---

## 3. Access Control

### 3.1 Role-Based Access Control (RBAC)

Application access is gated through two roles enforced at the tRPC
procedure layer:

- **`admin`** — Full access to financial data, bank account linking,
  audit logs, customer PII, AccountingAgent overrides. Granted only to
  the Owner.
- **`user`** — Customer-facing flows (browse tours, place bookings,
  view their own bookings). No access to administrative data.

### 3.2 Least Privilege

- Bank account data (`linkedBankAccounts`, `bankTransactions`,
  `trustDeferredIncome`) is queryable only by `admin` role.
- All admin mutations are rate-limited (60 requests per minute per
  admin) at the tRPC middleware layer.
- Login attempts are rate-limited (10 attempts per 15 minutes per IP,
  5 attempts per 15 minutes per email) and trigger a 15-minute lockout
  on exceed.

### 3.3 Centralized Identity

- Admin login is authenticated via Google OAuth (Google Workspace acts
  as the centralized identity provider).
- Non-human service-to-service authentication uses OAuth tokens (Plaid,
  Stripe, Google APIs) or short-lived JWT credentials — never embedded
  passwords.

### 3.4 Provisioning and De-provisioning

- The Company currently has one administrator (the Owner). Provisioning
  and de-provisioning are documented in this policy and executed by the
  ISO.
- If a future contractor or employee gains administrative access, the
  ISO will:
  1. Issue access via Google Workspace user provisioning
  2. Document the access grant in the audit log
  3. Revoke access immediately upon role termination
  4. Rotate any shared credentials within 24 hours of termination

---

## 4. Authentication (Multi-Factor Authentication)

Multi-factor authentication (MFA) is enforced on every system that
stores, processes, or grants access to Company financial data:

| System | MFA method | Purpose |
|---|---|---|
| Google Workspace | Passkey + Google prompt (phishing-resistant) + phone | Admin email + OAuth identity provider |
| Plaid Dashboard | TOTP authenticator app | Plaid API key management, webhook config |
| GitHub | TOTP authenticator app | Source-code repository (production) |
| Fly.io | TOTP authenticator app | Production hosting + secrets management |
| TiDB Cloud | TOTP authenticator app | Production database |

Per Plaid security questionnaire wording, the effective MFA tier is
**non-phishing-resistant** because non-Google systems use TOTP rather
than passkey/hardware-key. The Owner's primary Google account (the
upstream identity provider) is protected with a phishing-resistant
passkey.

No system that touches Pack&Go financial data is accessible by password
alone. There are no consumer-facing MFA-protected applications — the
Plaid integration is admin-only.

---

## 5. Encryption

### 5.1 Data In Transit

All HTTP traffic to `packgoplay.com` is served over TLS 1.3 by the
Fly.io edge proxy. TLS 1.2 is supported as a fallback for legacy
clients; TLS 1.1 and below are rejected.

Server-to-third-party API calls (Plaid, Stripe, Google) use TLS 1.3
enforced by the respective SDK clients.

### 5.2 Data At Rest

#### 5.2.1 Plaid Access Tokens

Plaid `access_token` values are encrypted before storage using
AES-256-GCM symmetric encryption. Each token uses:

- A unique 96-bit (12-byte) initialization vector
- A 128-bit (16-byte) authentication tag

These are packaged into a single base64-encoded envelope:
`iv | authTag | ciphertext` and stored in the
`linkedBankAccounts.plaidAccessTokenEncrypted` column.

The 256-bit encryption key (`PLAID_ENCRYPTION_KEY`) is stored as a
Fly.io application secret and is never committed to source control or
written to log files.

#### 5.2.2 Database

The underlying database provider (TiDB Cloud) provides AES-256
encryption at rest for all stored data as a second defense layer.

#### 5.2.3 Backups

Database backups maintained by TiDB Cloud inherit the same AES-256
encryption-at-rest guarantees. Backup access requires both TiDB Cloud
authentication and TOTP MFA.

---

## 6. Vulnerability Management

### 6.1 Dependency Vulnerabilities

- GitHub Dependabot scans the production repository's pnpm dependency
  tree daily and automatically opens pull requests for any package with
  a known CVE.
- `pnpm audit` runs as part of the build pipeline. Builds fail on
  critical-severity vulnerabilities.
- The ISO reviews and merges Dependabot PRs on the following timeline:
  - **Critical:** within 3 business days
  - **High:** within 7 business days
  - **Medium / Low:** within 14 business days

### 6.2 Code Review

Every production commit passes through:

1. Mandatory AI code-review agent (`packgo-code-reviewer`) which
   inspects against this repository's CLAUDE.md security and
   coding rules
2. ISO review for changes touching authentication, encryption, or
   financial data paths

### 6.3 Operating System and Runtime

- Production servers run on Fly.io's managed container runtime.
  Fly.io patches the underlying kernel and base image.
- The Owner's development machine (macOS) is configured to install
  Apple security updates automatically.

### 6.4 Future Improvements

The Company commits to evaluating the following within 90 days of
this policy's effective date:

- Static Application Security Testing (SAST) tooling (e.g., GitHub
  CodeQL — already enabled by default on the production repository)
- Software Bill of Materials (SBOM) generation for the production image
- End-of-life (EOL) tracking program for major dependencies

---

## 7. Audit Logging

All privileged actions are recorded in the `auditLog` database table.
Each entry captures:

- Action type (e.g., `LINK_BANK_ACCOUNT`, `MARK_TRUST_ACCOUNT`,
  `OVERRIDE_AGENT_CATEGORY`, `EXCLUDE_TRANSACTION`)
- Admin user ID
- Timestamp (UTC)
- Affected resource ID
- Before/after values where applicable
- Source IP and user-agent

Audit logs are retained indefinitely. They are visible to the Owner
through the admin dashboard at `/admin/audit-log`. The audit log is
append-only at the application layer; no mutation procedures expose a
delete or update path.

---

## 8. Incident Response

### 8.1 Detection

The ISO receives notification of security-relevant events via:

- Owner notification service (`notifyOwner`) — fires on
  `notifyOwner` queue events for: Plaid item errors, BullMQ worker
  failures, Stripe payment/refund events, AccountingAgent failures,
  rate-limit thresholds exceeded
- GitHub Dependabot alerts (email + dashboard)
- TiDB Cloud monitoring alerts
- Fly.io platform alerts

### 8.2 Response Procedure

Upon detection of a credible security incident, the ISO will:

1. **Contain** — Rotate the affected credentials within 1 hour. For
   Plaid: revoke item via `/item/remove`. For Fly secrets: rotate via
   `flyctl secrets set`. For Google: change password and revoke
   sessions.
2. **Assess** — Determine scope: what data, which users, what
   timeframe.
3. **Notify** — If customer PII or financial data was exposed, notify
   affected users within 72 hours per CCPA and California breach
   notification law.
4. **Remediate** — Patch the underlying vulnerability. Update this
   policy if the incident reveals a control gap.
5. **Document** — Log the incident, response actions, and lessons
   learned in `docs/incidents/` (private folder).

### 8.3 External Notification

- Plaid: notify `building@plaid.com` if a Plaid-related incident
  affects more than one item or exposes any access token
- California Attorney General: notify per
  [Cal. Civ. Code §1798.82](https://oag.ca.gov/privacy/databreach) if
  500+ California residents affected

---

## 9. Third-Party Risk

Pack&Go relies on the following third parties for security-sensitive
services:

| Provider | Service | Risk mitigation |
|---|---|---|
| Plaid | Bank data API | SOC 2 Type II certified; webhook signatures verified (JWT ES256); access tokens encrypted at rest on our side |
| Stripe | Payment processing | PCI DSS Level 1; webhook signatures verified |
| Google Workspace | Email, OAuth identity | Tier-1 enterprise provider; MFA on owner account |
| Fly.io | Production hosting | TLS 1.3 edge, encrypted secrets, MFA on platform account |
| TiDB Cloud | Database | AES-256 at rest, TLS in transit, MFA on platform account |
| GitHub | Source control | MFA on owner account; production repository private |
| Anthropic | LLM API for AccountingAgent | API key as Fly secret; no PII sent to LLM (only transaction descriptors) |

The ISO reviews third-party security posture annually as part of this
policy's review cycle.

---

## 10. Policy Review

This policy is reviewed annually. The next scheduled review is
**2027-05-14**.

Reviews may occur ad-hoc if:

- A material security incident occurs
- A new third-party processor is added
- The Company moves beyond a single administrator
- Plaid, Stripe, or another regulator requires updates

Policy version history is maintained in this document's repository
(`docs/INFORMATION_SECURITY_POLICY.md` on the private production
repository).

---

| | |
|---|---|
| **Approved by** | Chunfu Hsieh, Owner / ISO |
| **Date** | 2026-05-14 |
