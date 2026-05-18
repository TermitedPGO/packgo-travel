/**
 * Round 80.20 → 80.21: Membership pricing helper.
 *
 * Each tier has yearly + monthly variants (Round 80.21). Yearly is the
 * discounted commitment, monthly is the lower commitment.
 *
 * Maps Stripe price IDs ↔ (tier, period). Used by both the tRPC checkout
 * endpoint (creates session for given tier+period) and the webhook
 * (resolves tier from incoming subscription's price).
 */
import { ENV } from "./env";

export type Tier = "free" | "plus" | "concierge";
export type PaidTier = Exclude<Tier, "free">;
export type BillingPeriod = "yearly" | "monthly";

/** Map (tier, period) → Stripe price ID (set via env). */
export function priceIdForTier(tier: PaidTier, period: BillingPeriod = "yearly"): string {
  if (tier === "plus") {
    return period === "monthly" ? ENV.stripePricePlusMonthlyId : ENV.stripePricePlusYearlyId;
  }
  if (tier === "concierge") {
    return period === "monthly"
      ? ENV.stripePriceConciergeMonthlyId
      : ENV.stripePriceConciergeYearlyId;
  }
  throw new Error(`Unknown paid tier: ${tier}`);
}

/** Reverse — Stripe price ID → tier (drops period info). Used by webhook. */
export function tierFromPriceId(priceId: string): PaidTier | null {
  if (priceId === ENV.stripePricePlusYearlyId) return "plus";
  if (priceId === ENV.stripePricePlusMonthlyId) return "plus";
  if (priceId === ENV.stripePriceConciergeYearlyId) return "concierge";
  if (priceId === ENV.stripePriceConciergeMonthlyId) return "concierge";
  return null;
}

export function isMembershipPricingConfigured(): boolean {
  // Yearly is required; monthly is optional (admin may choose not to offer it).
  return Boolean(
    ENV.stripeSecretKey && ENV.stripePricePlusYearlyId && ENV.stripePriceConciergeYearlyId
  );
}

/** True when monthly is also configured for the given tier. */
export function hasMonthlyOption(tier: PaidTier): boolean {
  if (tier === "plus") return Boolean(ENV.stripePricePlusMonthlyId);
  if (tier === "concierge") return Boolean(ENV.stripePriceConciergeMonthlyId);
  return false;
}
