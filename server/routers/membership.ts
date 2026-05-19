/**
 * Membership router — Round 80.20: Stripe subscription lifecycle.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (3):
 *   - getStatus              – current tier + expiry + subscription presence
 *   - createCheckoutSession  – Stripe Checkout (with AB 390 compliant trial)
 *   - createPortalSession    – Stripe Customer Portal redirect
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";

export const membershipRouter = router({
    // Read current user's membership status (for /membership UI to show
    // "Manage subscription" instead of "Subscribe" when already paid).
    getStatus: publicProcedure.query(async ({ ctx }) => {
      const user = ctx.user as any;
      if (!user) {
        return { tier: "free" as const, expiresAt: null, hasSubscription: false };
      }
      return {
        tier: (user.tier || "free") as "free" | "plus" | "concierge",
        expiresAt: user.tierExpiresAt || null,
        hasSubscription: Boolean(user.stripeSubscriptionId),
      };
    }),

    // Create a Stripe Checkout session for the given paid tier. Logged-in
    // users only — anonymous flow would need email capture first which we
    // defer to Phase 3.
    createCheckoutSession: protectedProcedure
      .input(
        z.object({
          tier: z.enum(["plus", "concierge"]),
          period: z.enum(["yearly", "monthly"]).default("yearly"),
          // Round 81 / migration 0075 — AB 390 compliant 10-day trial.
          // Defaults to true (better UX = lower bounce); set false for
          // promo flows that already gave the user other discounts.
          withTrial: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { isMembershipPricingConfigured, priceIdForTier, hasMonthlyOption } =
          await import("../_core/membershipPricing");
        if (!isMembershipPricingConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Stripe membership pricing is not yet configured. Please set yearly Stripe price IDs.",
          });
        }
        // Round 80.21: monthly is optional — if user picks monthly but it's
        // not configured for this tier, fall back to yearly with a hint.
        const period =
          input.period === "monthly" && !hasMonthlyOption(input.tier)
            ? "yearly"
            : input.period;

        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(ENV.stripeSecretKey);
        const baseUrl = ENV.baseUrl || "https://packgoplay.com";

        // Reuse existing customer if user already has one
        let customerId = (ctx.user as any).stripeCustomerId as string | null;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: ctx.user.email || undefined,
            name: ctx.user.name || undefined,
            metadata: { userId: String(ctx.user.id) },
          });
          customerId = customer.id;
          // Save for next time (best-effort — webhook also captures it)
          try {
            const { getDb } = await import("../db");
            const { users } = await import("../../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const dbInstance = await getDb();
            if (dbInstance) {
              await dbInstance
                .update(users)
                .set({ stripeCustomerId: customerId })
                .where(eq(users.id, ctx.user.id));
            }
          } catch (e) {
            console.warn("[Membership] Failed to persist stripeCustomerId:", e);
          }
        }

        // Round 81 / migration 0075 — AB 390 compliant 10-day trial.
        //   - Allowed once per tier per user (enforced by plus/conciergeTrialUsedAt
        //     check below; abuse via creating new accounts is the residual risk).
        //   - Stripe handles the trial mechanics; we just say "give them 10 days
        //     before charging". `trial_will_end` webhook (fires ~3 days before)
        //     is what triggers our AB 390 reminder email.
        //   - subscription_data.trial_settings.end_behavior.missing_payment_method
        //     = 'cancel' means: if the customer somehow loses their card during
        //     trial, Stripe cancels the trial → never charges. Safer default than
        //     'create_invoice' which would try to charge and fail.
        let trialPeriodDays: number | undefined = undefined;
        let trialAlreadyUsed = false;
        if (input.withTrial) {
          const trialFlag = input.tier === "plus" ? "plusTrialUsedAt" : "conciergeTrialUsedAt";
          const alreadyUsedAt = (ctx.user as any)[trialFlag];

          // 2026-05-17 red-team round 1 — also check any OTHER user account
          // that resolves to the same physical Gmail inbox (j.e.f.f@gmail.com,
          // jeff+tag@gmail.com, jeff@googlemail.com all → jeff@gmail.com).
          // Without this check, attacker can register N variants and get N
          // trials from one inbox.
          const { normalizeEmail } = await import("../_core/emailNormalize");
          const normalized = normalizeEmail(ctx.user.email);
          let dotTrickAlreadyUsed = false;
          if (normalized && normalized !== ctx.user.email.toLowerCase()) {
            try {
              const { getDb } = await import("../db");
              const { users } = await import("../../drizzle/schema");
              const { ne, isNotNull, and: dAnd, sql: dSql } = await import("drizzle-orm");
              const db = await getDb();
              if (db) {
                // Find any OTHER account whose normalized email matches AND
                // has already used this tier's trial.
                const rows = await db
                  .select({ id: users.id, usedAt: (users as any)[trialFlag] })
                  .from(users)
                  .where(
                    dAnd(
                      ne(users.id, ctx.user.id),
                      isNotNull((users as any)[trialFlag]),
                      // Subquery would be cleaner but MySQL needs computed col
                      // Cheap: load + compare in app code
                    )
                  );
                for (const r of rows as any[]) {
                  // We don't have normalizedEmail column yet — manual recompute.
                  // For perf, future migration should add users.normalizedEmail
                  // with unique index.
                  const otherUser = await db
                    .select({ email: users.email })
                    .from(users)
                    .where(dSql`${users.id} = ${r.id}`)
                    .limit(1);
                  if (otherUser[0] && normalizeEmail(otherUser[0].email) === normalized) {
                    dotTrickAlreadyUsed = true;
                    console.warn(
                      `[Membership] User ${ctx.user.id} (${ctx.user.email}) blocked from trial: same physical inbox as user ${r.id} already trialed ${input.tier}`
                    );
                    break;
                  }
                }
              }
            } catch (err) {
              console.warn("[Membership] dot-trick check failed (non-fatal):", err);
            }
          }

          if (alreadyUsedAt || dotTrickAlreadyUsed) {
            trialAlreadyUsed = true;
            console.log(
              `[Membership] User ${ctx.user.id} already used ${input.tier} trial — billing immediately`
            );
          } else {
            trialPeriodDays = 10;
          }
        }

        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: priceIdForTier(input.tier, period), quantity: 1 }],
          success_url: `${baseUrl}/membership?success=1&tier=${input.tier}&period=${period}${trialPeriodDays ? "&trial=1" : ""}`,
          cancel_url: `${baseUrl}/membership?canceled=1`,
          // Metadata so webhook can identify the user even if subscription
          // lookup fails (defensive).
          subscription_data: {
            metadata: {
              userId: String(ctx.user.id),
              tier: input.tier,
              period,
            },
            ...(trialPeriodDays ? {
              trial_period_days: trialPeriodDays,
              trial_settings: {
                end_behavior: {
                  missing_payment_method: "cancel" as const,
                },
              },
            } : {}),
          },
          // AB 390: trial users must enter a payment method upfront so
          // auto-charge works at trial end. This is Stripe's default
          // behavior — explicitly stating for documentation.
          payment_method_collection: trialPeriodDays ? "always" : "always",
          // Allow customer to enter promotion code at checkout (set up in
          // Stripe Dashboard) — useful for "FRIENDS" / "EARLYBIRD" discounts.
          allow_promotion_codes: true,
        });

        return {
          url: session.url,
          // Surface to UI so it can show "free trial" badge or not
          trialDays: trialPeriodDays || 0,
          trialAlreadyUsed,
        };
      }),

    // Customer portal — let users manage / cancel their subscription.
    createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
      const customerId = (ctx.user as any).stripeCustomerId as string | null;
      if (!customerId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No subscription found for your account.",
        });
      }
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(ENV.stripeSecretKey);
      const baseUrl = ENV.baseUrl || "https://packgoplay.com";
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/membership`,
      });
      return { url: portal.url };
    }),
  });
