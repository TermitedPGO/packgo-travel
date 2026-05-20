# v2 · Wave 2 · Module 2.11 — Split `server/email.ts` (1,302 → 11 files per-template)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.5)
**Audit ref:** v2-audit-2026-05-19.md §C lines 148, 211 (email.ts god-file); v2-plan.md lines 205-213
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (parallelize-safe after Module 2.7)
**Est. effort:** 7-9 h AI + 30 min Jeff review
**Risk tier:** MEDIUM — emails go to real customers. Wrong template render = embarrassing send. But all changes are structural, no logic touch.
**Deploy window:** any morning; consider toggling Resend to test-mode for the first deploy hour.

> **CRITICAL PATH NOTE:** v2-plan.md and CLAUDE.md §六 reference `server/_core/email.ts` but the actual file lives at **`server/email.ts`** (confirmed via filesystem grep 2026-05-19). The plan path is stale. This module uses the actual path.

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.7. Parallelize-safe with 2.8, 2.9, 2.10, 2.12, 2.13.

## Goal

Split `server/email.ts` (1,302 LOC) into a thin shim + 1 file per email template under `server/email/templates/`. Public function signatures (`sendBookingConfirmationEmail`, `sendPaymentSuccessEmail`, etc.) preserved — callers keep `import { sendX } from "../email"`.

## Pre-requisites

- Module 2.7 committed (db.ts split done)
- Working tree clean
- `pnpm tsc --noEmit` exit 0
- v1 `email-and-rememberme.test.ts` exists — current regression anchor

## Inputs (read these before executing)

1. **`server/email.ts`** — 1,302 LOC. 11 exported send functions + their HTML generators.
2. **`server/emailService.ts`** — separate file (does email logging?). Confirm scope; out of this module's scope unless it imports from `email.ts`.
3. **`server/services/emailTemplateService.ts`** — separate. Confirm relationship.
4. **`server/email-and-rememberme.test.ts`** — existing test; must still pass post-split.
5. **`docs/refactor/tasks/phase-5/module-5A-suppliersync.md`** — same Option-A re-export-shim pattern used here.

## Scope (what this module owns)

### Email template inventory

From grep on `server/email.ts`:

| Export function | Source line | Approx LOC | Target template file |
|---|---|---|---|
| `sendBookingConfirmationEmail` | L65 | ~70 | `templates/bookingConfirmation.ts` |
| `sendPaymentSuccessEmail` | L135 | ~64 | `templates/paymentSuccess.ts` |
| `sendTripReminderEmail` | L273 | ~71 | `templates/tripReminder.ts` |
| `sendSupplierNotificationEmail` | L638 | ~112 | `templates/supplierNotification.ts` |
| `sendQuoteFollowUpEmail` | L750 | ~67 | `templates/quoteFollowUp.ts` |
| `sendReviewRequestEmail` | L817 | ~60 | `templates/reviewRequest.ts` |
| `sendAbandonmentRecoveryEmail` | L877 | ~68 | `templates/abandonmentRecovery.ts` |
| `sendVoucherIssuedEmail` | L945 | ~65 | `templates/voucherIssued.ts` |
| `sendWinbackEmail` | L1010 | ~91 | `templates/winback.ts` |
| `sendCheckinEmail` | L1101 | ~98 | `templates/checkin.ts` |
| `sendTrialEndingReminder` | L1199 | ~103 | `templates/trialEnding.ts` |

**Plus internal HTML generators** (the `generate<X>HTML(data)` functions at L344, L385, L434, etc.) — these are private to their template; co-locate in the same file as the public sender.

### Directory structure

```
server/email/
├── _shared.ts                 ≤200 LOC  — Resend client, getTransporter, bilingual header/footer HTML, brand colors, logo URL
└── templates/
    ├── bookingConfirmation.ts  ≤200 LOC
    ├── paymentSuccess.ts       ≤200 LOC
    ├── tripReminder.ts         ≤200 LOC
    ├── supplierNotification.ts ≤250 LOC (largest)
    ├── quoteFollowUp.ts        ≤200 LOC
    ├── reviewRequest.ts        ≤200 LOC
    ├── abandonmentRecovery.ts  ≤200 LOC
    ├── voucherIssued.ts        ≤200 LOC
    ├── winback.ts              ≤200 LOC
    ├── checkin.ts              ≤200 LOC
    └── trialEnding.ts          ≤200 LOC

server/email.ts                ≤80 LOC   — shim re-exporting all 11 send* functions
```

### Shim pattern (Option A from Phase 5A)

```ts
// server/email.ts — re-export shim. Public API preserved.
//
// Templates moved to server/email/templates/ in v2 Wave 2 Module 2.11.
// All existing call sites (stripeWebhook, autonomous agents, admin routers)
// continue importing from "../email" unchanged.

export { getTransporter } from "./email/_shared";

export { sendBookingConfirmationEmail } from "./email/templates/bookingConfirmation";
export { sendPaymentSuccessEmail } from "./email/templates/paymentSuccess";
export { sendTripReminderEmail } from "./email/templates/tripReminder";
export { sendSupplierNotificationEmail } from "./email/templates/supplierNotification";
export { sendQuoteFollowUpEmail } from "./email/templates/quoteFollowUp";
export { sendReviewRequestEmail } from "./email/templates/reviewRequest";
export { sendAbandonmentRecoveryEmail } from "./email/templates/abandonmentRecovery";
export { sendVoucherIssuedEmail } from "./email/templates/voucherIssued";
export { sendWinbackEmail } from "./email/templates/winback";
export { sendCheckinEmail } from "./email/templates/checkin";
export { sendTrialEndingReminder } from "./email/templates/trialEnding";

// Re-export types used by callers
export type {
  BookingEmailData,
  PaymentSuccessEmailData,
  TripReminderEmailData,
  SupplierNotificationData,
  QuoteFollowUpData,
  ReviewRequestData,
  AbandonmentRecoveryData,
  VoucherIssuedEmailData,
  WinbackEmailData,
  CheckinEmailData,
  TrialEndingReminderData,
} from "./email/templates/types";
```

### Out of scope

- `server/emailService.ts` and `server/services/emailTemplateService.ts` — separate files, separate concerns. Don't touch.
- Email content tweaking — preserve every HTML byte verbatim.
- Adding new templates — out of scope (v3).
- Replacing Resend with another provider — out of scope.

## Procedure

### Step 1 — Pre-extraction inventory

```bash
cd /Users/jeff/Desktop/網站
wc -l server/email.ts
grep -nE "^export (async )?function send" server/email.ts > /tmp/2.11-senders.txt
grep -nE "^(export )?function generate.*HTML" server/email.ts > /tmp/2.11-generators.txt
grep -rohE "from ['\"]\\.\\.?/email['\"]" server/ --include="*.ts" | sort -u > /tmp/2.11-callers.txt
```

Caller paths: should mostly be `from "../email"` (no `_core/email`). Confirm.

### Step 2 — Identify shared resources

Read L1-64 of `server/email.ts`:
- `getTransporter()` function (L20) — Resend client init
- Brand color constants
- Bilingual header/footer HTML helpers (if exist)

Move all to `server/email/_shared.ts`.

### Step 3 — Define shared types file

```ts
// server/email/templates/types.ts
export type BookingEmailData = { /* extract from existing inline types */ };
export type PaymentSuccessEmailData = { /* ... */ };
// ... 11 types
```

### Step 4 — Extract 11 template files

For each:

```ts
// server/email/templates/bookingConfirmation.ts
import { getTransporter } from "../_shared";
import type { BookingEmailData } from "./types";

function generateBookingConfirmationHTML(data: BookingEmailData): string {
  // Verbatim from server/email.ts L434+
}

export async function sendBookingConfirmationEmail(data: BookingEmailData) {
  // Verbatim from server/email.ts L65-134
}
```

**Verbatim rule:** copy every HTML string character-for-character. Email render diffs are visible to customers; any whitespace/CSS change is a regression.

### Step 5 — Rewrite `server/email.ts` as shim

Replace the entire file with the shim template above. `wc -l server/email.ts` should drop to ~50-80 LOC.

### Step 6 — Add Vitest per template

```ts
// server/email/templates/bookingConfirmation.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../_shared", () => ({
  getTransporter: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: "test-id" }),
  })),
}));

import { sendBookingConfirmationEmail } from "./bookingConfirmation";

describe("bookingConfirmation email template", () => {
  it("renders HTML and sends via transporter", async () => {
    const result = await sendBookingConfirmationEmail({
      to: "test@example.com",
      bookingId: 123,
      tourName: "Japan 7-day",
      totalAmount: 2500,
      currency: "USD",
      // ... rest of fixture
    });
    expect(result).toBeDefined();
    // Optionally: snapshot the HTML to detect content drift
  });
});
```

11 such test files. Each ≤80 LOC.

### Step 7 — Verify

```bash
NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
pnpm test server/email/
pnpm test  # regression (must include existing email-and-rememberme.test)
```

### Step 8 — Smoke (Resend test mode)

- Set `RESEND_KEY` to a test/sandbox key on staging
- Trigger 3 send paths via admin tools:
  - Force-send booking confirmation
  - Force-send quote follow-up
  - Force-send winback
- Compare resulting emails in test inbox vs pre-split snapshots — content + styling identical

## Acceptance Criteria

- [ ] `server/email/` directory exists with `_shared.ts` + `templates/` subdir
- [ ] 11 template files exist, each ≤250 LOC
- [ ] 11 Vitest files exist with 1+ happy-path send case each
- [ ] `server/email/templates/types.ts` exists with 11 exported types
- [ ] `server/email.ts` is a shim ≤80 LOC re-exporting all 11 senders
- [ ] All existing callers (`grep -rn "from ['\"]\\.\\./email['\"]" server/` count) unchanged
- [ ] `server/email-and-rememberme.test.ts` still passes
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression + 11 new tests pass
- [ ] Manual: 3 staging email sends render identically pre/post

## Deliverable

- New: `server/email/_shared.ts`, `server/email/templates/types.ts`, 11 template files, 11 test files
- Modified: `server/email.ts` (1,302 → ~80 LOC shim)
- Removed: 11 in-file function bodies + 11 HTML generators (all moved to templates)

**Single squash-merge commit:**

```
refactor(email): v2 Wave 2 Module 2.11 — split email.ts 1,302 → 11 templates

Closes audit C-priority god-file. Each email template (11 total) gets its
own file under server/email/templates/. Shared Resend client + brand
helpers live in server/email/_shared.ts. server/email.ts becomes an
~80-LOC re-export shim.

- bookingConfirmation, paymentSuccess, tripReminder, supplierNotification,
  quoteFollowUp, reviewRequest, abandonmentRecovery, voucherIssued, winback,
  checkin, trialEnding — each in its own file ≤250 LOC
- 11 Vitest files (mocked transporter, send happy path)
- Public API preserved: stripeWebhook + autonomous agents + admin routers
  still `import { sendX } from "../email"` unchanged
- HTML rendered verbatim — zero content diff

NOTE: path is server/email.ts (CLAUDE.md §六 and v2-plan.md previously
said server/_core/email.ts, which is wrong; this commit aligns CLAUDE.md
in Module 2.12 closing docs).

Audit ref: v2-audit §C; v2-plan.md Module 2.5.
```

## Rollback

- Single squash-merge → `git revert <SHA>` restores monolith.
- 11 new files orphan; existing `email-and-rememberme.test.ts` regression anchor pinned to monolith.
- If a customer reports email render glitch post-deploy → revert immediately + run staging-side bisect on which template's HTML drifted.

## Manual intervention

- **Jeff:** smoke-test 3 emails on staging (booking confirmation + voucher issued + winback). Open in Gmail + outlook.com to confirm HTML renders ≥ pre-split.
- **Supervisor:** verify `wc -l server/email.ts` ≤80.
- **Supervisor:** confirm `server/email-and-rememberme.test.ts` still passes (regression-anchor).

## Test plan

- 11 new Vitest cases, one per template
- Full regression run
- Manual: 3 staging emails rendered + compared

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.11-a | CLAUDE.md §六 path correction: `server/_core/email.ts` (stale) → `server/email.ts` (actual). Fix in this commit OR defer to Wave 4 docs? | **Fix in this commit.** §六 references that are stale degrade trust in the doc. One-line edit. |
| D2.11-b | Snapshot-test the HTML output of each template (catches content drift) OR happy-path send only? | **Snapshot.** 1 KB of stored fixture per template is cheap insurance against future "minor edit broke layout". |
| D2.11-c | Bilingual handling — does each template need to switch on `locale` param OR are there 11 zh-TW + 11 en files? | **Switch on locale param.** Reading the existing code: most templates take a locale arg. Confirm. |

**Must be committed before any module touches `server/email.ts` or `server/email/`.** Parallelize-safe with 2.8, 2.9, 2.10, 2.12, 2.13.
