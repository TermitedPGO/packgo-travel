/**
 * storefrontBootPlan — single source of truth for the boot-time role decision
 * introduced by the storefront-split feature (Phase 0).
 *
 * The same image runs in two roles, chosen by the `STOREFRONT_MODE` flag
 * (see ./featureFlags.ts → storefrontMode):
 *   - ops / backend (flag UNSET, default): mount everything, start every
 *     BullMQ worker + cron. Byte-identical to pre-flag behavior.
 *   - storefront (flag SET): serve the public SPA + tRPC surface only. Start
 *     NO workers, NO cron, and mount NONE of the backend-only Express
 *     endpoints listed in BACKEND_ONLY_ENDPOINTS.
 *
 * The imperative boot in server/_core/index.ts consumes THIS function's
 * fields to gate each block, so the boot decision is a pure, testable unit
 * (storefrontBootPlan.test.ts) rather than something only observable by
 * booting the whole server. If a future edit lets cron start in storefront
 * mode, the pure test — and the index.storefront.test.ts source-scan that
 * asserts index.ts actually routes through these gates — go red.
 */
import { storefrontMode } from "./featureFlags";

/**
 * Canonical inventory of the backend-only Express endpoints a storefront
 * process must NOT expose. This is the documented mount-list the boot-mode
 * tests assert against; keep it in sync with the `backend*(...)` registrations
 * and the gated `initializeGmailOAuth` call in server/_core/index.ts.
 *
 * (Purely descriptive — index.ts does not import this array to register
 * routes; it exists so the gate's scope is written down and test-locked.)
 */
export const BACKEND_ONLY_ENDPOINTS = [
  "POST /api/stripe/webhook",
  "POST /api/plaid/webhook",
  "POST /api/gmail/push",
  "GMAIL_OAUTH initializeGmailOAuth (/api/admin/connect-gmail + /api/gmail/oauth/callback)",
  "ALL /api/agent/ask-ops-stream",
  "POST /api/internal/test-generate",
  "POST /api/internal/bulk-import-lion",
  "GET /api/internal/test-status/:jobId",
  "POST /api/admin/import-case-file",
  "POST /api/admin/deploy-smoke",
  "POST /api/admin/import-case-documents",
  "POST /api/admin/harvest-case-lessons",
  "POST /api/admin/backfill-bank-transaction-links",
  "POST /api/admin/backfill-stripe-payout-declassify",
  "POST /api/admin/cleanup-sandbox-residue",
  "POST /api/admin/trust-transfer-detect",
  "POST /api/admin/catalog-rebuild",
  "POST /api/admin/import-case-conversations",
  "POST /api/admin/backfill-interaction-orders",
  "POST /api/admin/backfill-guest-classification",
  "POST /api/admin/guest-noise-hygiene-report",
  "POST /api/admin/imessage-check-known-phones",
  "POST /api/admin/imessage-ingest",
  "POST /api/admin/audit-chain-epoch",
] as const;

export interface StorefrontBootPlan {
  /** True when this process is the customer-facing storefront role. */
  isStorefront: boolean;
  /** Start BullMQ workers (worker.ts consumers). Ops only. */
  startWorkers: boolean;
  /** Register cron schedulers + their workers (index.ts tail). Ops only. */
  startCron: boolean;
  /** Mount the BACKEND_ONLY_ENDPOINTS + Gmail-pipeline OAuth. Ops only. */
  mountBackendEndpoints: boolean;
  /**
   * Mount the public customer surface (tRPC appRouter, bot-prerender, static
   * SPA, Google login OAuth, public upload/SSE routers). Always true — both
   * roles serve this; the split is purely about what ops ADDS on top.
   */
  mountPublicSurface: boolean;
}

/**
 * Build the boot plan. Pass an explicit `isStorefront` for pure unit tests;
 * omit it in production to read the live `STOREFRONT_MODE` flag.
 */
export function buildStorefrontBootPlan(
  isStorefront: boolean = storefrontMode(),
): StorefrontBootPlan {
  return {
    isStorefront,
    startWorkers: !isStorefront,
    startCron: !isStorefront,
    mountBackendEndpoints: !isStorefront,
    mountPublicSurface: true,
  };
}
