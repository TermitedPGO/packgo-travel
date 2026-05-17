/**
 * Membership landing — Round 80.19 Phase 1.
 *
 * Three-tier comparison: Free / Plus $99/yr / Concierge $399/yr.
 * Per docs/membership-plan.md.
 *
 * Phase 1: this is a STATIC landing page with "Coming soon" CTAs. The
 * Stripe integration ships in Phase 2. AI Advisor paywall links here so
 * even pre-payment, users can see the value prop and join the waitlist.
 */
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Check, X, Sparkles, Star, Crown, ArrowRight, Phone, Loader2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import SEO from "@/components/SEO";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { toast } from "sonner";

export default function Membership() {
  const { t, formatPrice, currency, language } = useLocale();
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [loadingTier, setLoadingTier] = useState<"plus" | "concierge" | null>(null);
  // Round 80.21: yearly = default (≈ 2 months free vs monthly).
  const [billingPeriod, setBillingPeriod] = useState<"yearly" | "monthly">("yearly");

  // Round 80.22: prices are USD-based (Stripe billing in USD); displayed in
  // the user's selected currency via formatPrice. Hardcoded numbers here
  // because Stripe products are priced in USD and we just convert for display.
  const PRICES_USD = {
    plusYearly: 89,
    plusMonthly: 9.99,
    conciergeYearly: 349,
    conciergeMonthly: 39.99,
    plusYearlySave: 30, // saved vs monthly × 12
    conciergeYearlySave: 130,
  };

  // Round 80.20: query membership status — show "Manage subscription"
  // instead of "Subscribe" when user already has paid tier.
  // Round 80.22: refetchOnMount + refetchOnWindowFocus so when user comes
  // back from Stripe Checkout, the tier flips immediately (webhook may have
  // updated the DB during the redirect window).
  const utils = trpc.useUtils();
  const { data: status } = trpc.membership.getStatus.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const checkoutMutation = trpc.membership.createCheckoutSession.useMutation({
    onSuccess: (res) => {
      // Round 80.22: replace() so browser back doesn't bounce user back to
      // Stripe Checkout (creates a forward-back loop). The previous /membership
      // entry stays in history so back goes to whatever was before /membership.
      if (res.url) window.location.replace(res.url);
    },
    onError: (err) => {
      toast.error(err.message || t("membership.checkoutError"));
      setLoadingTier(null);
    },
  });

  const portalMutation = trpc.membership.createPortalSession.useMutation({
    onSuccess: (res) => {
      if (res.url) window.location.replace(res.url);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubscribe = (tier: "plus" | "concierge") => {
    if (!isAuthenticated) {
      // Send to login, then return to /membership
      navigate("/login?redirect=/membership");
      return;
    }
    setLoadingTier(tier);
    checkoutMutation.mutate({ tier, period: billingPeriod });
  };

  // Show success/cancel toast from URL params after Stripe redirect.
  // Round 80.22: also force-invalidate getStatus so we don't show stale
  // tier=free when the webhook just promoted us to plus/concierge.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      toast.success(t("membership.subscribeSuccess"));
      // Webhook may take 1-2s to land — refetch a couple of times to catch it.
      void utils.membership.getStatus.invalidate();
      const t1 = setTimeout(() => void utils.membership.getStatus.invalidate(), 2_000);
      const t2 = setTimeout(() => void utils.membership.getStatus.invalidate(), 5_000);
      // Clean up URL
      window.history.replaceState({}, "", "/membership");
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else if (params.get("canceled") === "1") {
      toast(t("membership.subscribeCanceled"));
      window.history.replaceState({}, "", "/membership");
    }
  }, [t, utils]);

  const tiers = [
    {
      key: "free" as const,
      icon: Sparkles,
      name: t("membership.freeTitle"),
      price: t("membership.freePrice"),
      saveHint: null as string | null,
      tagline: t("membership.freeTagline"),
      // Round 80.22: feature lists rebuilt around Packpoint system.
      // Each tier earns Packpoint at a multiplied rate (1x/5x/10x) on top
      // of a tour-specific multiplier Jeff sets in admin (default 0.25x to
      // protect thin-margin tours from eating commission). Engagement
      // bonuses (sign up / review / refer / birthday) are shared across
      // all tiers and don't cost commission. Auto-upgrade rewards Free
      // users who hit a cumulative spend threshold.
      features: [
        { text: t("membership.featAiFree"), included: true },
        { text: t("membership.featNewsletter"), included: true },
        { text: t("membership.featPackpointFree"), included: true },
        { text: t("membership.featPackpointBonuses"), included: true },
        { text: t("membership.featAutoUpgrade"), included: true },
        { text: t("membership.featAiUnlimited"), included: false },
        { text: t("membership.featNoFeeChange"), included: false },
        { text: t("membership.featPhotoBook"), included: false },
        { text: t("membership.featDedicatedAdvisor"), included: false },
      ],
      cta: t("membership.freeCta"),
      ctaLink: "/",
      highlight: false,
    },
    {
      key: "plus" as const,
      icon: Star,
      name: t("membership.plusTitle"),
      price:
        billingPeriod === "yearly"
          ? formatPrice(PRICES_USD.plusYearly, "USD")
          : formatPrice(PRICES_USD.plusMonthly, "USD"),
      pricePeriod: billingPeriod === "yearly" ? t("membership.plusPeriod") : t("membership.plusPeriodMonthly"),
      saveHint:
        billingPeriod === "yearly"
          ? t("membership.plusYearlySave")
          : null,
      tagline: t("membership.plusTagline"),
      features: [
        { text: t("membership.featAiFree"), included: true },
        { text: t("membership.featNewsletter"), included: true },
        { text: t("membership.featPackpointPlus"), included: true },
        { text: t("membership.featPackpointBonuses"), included: true },
        { text: t("membership.featAiUnlimited"), included: true },
        { text: t("membership.featNoFeeChange"), included: true },
        { text: t("membership.featPhotoBook"), included: true },
        { text: t("membership.featDedicatedAdvisor"), included: false },
      ],
      cta: t("membership.plusCta"),
      ctaLink: "/contact-us?subject=plus-waitlist",
      highlight: true,
    },
    {
      key: "concierge" as const,
      icon: Crown,
      name: t("membership.conciergeTitle"),
      price:
        billingPeriod === "yearly"
          ? formatPrice(PRICES_USD.conciergeYearly, "USD")
          : formatPrice(PRICES_USD.conciergeMonthly, "USD"),
      pricePeriod: billingPeriod === "yearly" ? t("membership.conciergePeriod") : t("membership.conciergePeriodMonthly"),
      saveHint:
        billingPeriod === "yearly"
          ? t("membership.conciergeYearlySave")
          : null,
      tagline: t("membership.conciergeTagline"),
      features: [
        { text: t("membership.featAiFree"), included: true },
        { text: t("membership.featNewsletter"), included: true },
        { text: t("membership.featPackpointConcierge"), included: true },
        { text: t("membership.featPackpointBonuses"), included: true },
        { text: t("membership.featAiUnlimited"), included: true },
        { text: t("membership.featNoFeeChange"), included: true },
        { text: t("membership.featPhotoBook"), included: true },
        { text: t("membership.featDedicatedAdvisor"), included: true },
      ],
      cta: t("membership.conciergeCta"),
      ctaLink: "/contact-us?subject=concierge-waitlist",
      highlight: false,
    },
  ];

  return (
    <>
      <SEO
        title={t("membership.seoTitle")}
        description={t("membership.seoDesc")}
      />
      <Header />
      <main className="min-h-screen bg-white">
        {/* Hero */}
        <section className="bg-foreground text-white py-16 md:py-24">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <p className="text-xs tracking-[0.3em] uppercase text-[#c9a563] mb-4">
              {t("membership.eyebrow")}
            </p>
            <h1 className="font-serif font-bold text-4xl md:text-5xl lg:text-6xl leading-tight mb-5 tracking-tight">
              {t("membership.heroTitle")}
            </h1>
            <p className="text-base md:text-lg text-white/80 leading-relaxed">
              {t("membership.heroSubtitle")}
            </p>
            <div className="h-px bg-gradient-to-r from-transparent via-[#c9a563]/40 to-transparent mt-10" />
          </div>
        </section>

        {/* Pricing */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-6 max-w-6xl">
            {/* Round 80.21: Yearly / Monthly toggle */}
            <div className="flex items-center justify-center mb-10">
              <div className="inline-flex bg-foreground/5 rounded-full p-1">
                <button
                  type="button"
                  onClick={() => setBillingPeriod("yearly")}
                  className={`px-5 h-9 text-sm font-semibold rounded-full transition-colors ${
                    billingPeriod === "yearly"
                      ? "bg-foreground text-white shadow-sm"
                      : "text-foreground/60 hover:text-foreground"
                  }`}
                >
                  {t("membership.toggleYearly")}
                  <span className="ml-2 inline-block text-[10px] uppercase tracking-wider font-bold text-[#c9a563]">
                    {t("membership.toggleSaveBadge")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setBillingPeriod("monthly")}
                  className={`px-5 h-9 text-sm font-semibold rounded-full transition-colors ${
                    billingPeriod === "monthly"
                      ? "bg-foreground text-white shadow-sm"
                      : "text-foreground/60 hover:text-foreground"
                  }`}
                >
                  {t("membership.toggleMonthly")}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {tiers.map((tier) => {
                const Icon = tier.icon;
                return (
                  <div
                    key={tier.key}
                    className={`rounded-xl border p-6 md:p-8 flex flex-col ${
                      tier.highlight
                        ? "bg-foreground text-white border-[#c9a563] shadow-2xl scale-100 md:scale-[1.03] relative"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    {tier.highlight && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#c9a563] text-foreground text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full">
                        {t("membership.popular")}
                      </span>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          tier.highlight ? "bg-[#c9a563]/20" : "bg-foreground/5"
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 ${
                            tier.highlight ? "text-[#c9a563]" : "text-foreground/60"
                          }`}
                        />
                      </div>
                      <h2
                        className={`font-serif text-xl font-bold ${
                          tier.highlight ? "text-white" : "text-foreground"
                        }`}
                      >
                        {tier.name}
                      </h2>
                    </div>
                    <p
                      className={`text-sm mb-3 ${
                        tier.highlight ? "text-white/70" : "text-foreground/60"
                      }`}
                    >
                      {tier.tagline}
                    </p>
                    {/* Round 81 / 2026-05-17 — 10-day trial badge for paid tiers.
                        Required visual cue per AB 390 §17602(a)(1) "clear &
                        conspicuous" disclosure. Hidden for free tier (no trial)
                        and for users who already trialed this tier (server
                        returns trialAlreadyUsed=true in checkout response). */}
                    {(tier.key === "plus" || tier.key === "concierge") && (
                      <div className="mb-5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide ${
                            tier.highlight
                              ? "bg-[#c9a563]/30 text-[#c9a563] border border-[#c9a563]/40"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}
                        >
                          🎁 {language === "en" ? "10-day free trial" : "10 天免費試用"}
                        </span>
                      </div>
                    )}
                    <div className="mb-6">
                      <div className="flex items-baseline gap-1">
                        <span
                          className={`text-4xl font-bold tracking-tight ${
                            tier.highlight ? "text-white" : "text-foreground"
                          }`}
                        >
                          {tier.price}
                        </span>
                        {tier.pricePeriod && (
                          <span
                            className={`text-sm ${
                              tier.highlight ? "text-white/60" : "text-foreground/50"
                            }`}
                          >
                            {tier.pricePeriod}
                          </span>
                        )}
                      </div>
                      {tier.saveHint && (
                        <p
                          className={`mt-1 text-[11px] font-medium ${
                            tier.highlight ? "text-[#c9a563]" : "text-[#8a6f3a]"
                          }`}
                        >
                          {tier.saveHint}
                        </p>
                      )}
                    </div>
                    <ul className="flex-1 space-y-2.5 mb-6">
                      {tier.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          {f.included ? (
                            <Check
                              className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                                tier.highlight ? "text-[#c9a563]" : "text-foreground/70"
                              }`}
                            />
                          ) : (
                            <X
                              className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                                tier.highlight ? "text-white/30" : "text-foreground/20"
                              }`}
                            />
                          )}
                          <span
                            className={
                              f.included
                                ? tier.highlight
                                  ? "text-white"
                                  : "text-foreground"
                                : tier.highlight
                                ? "text-white/40 line-through"
                                : "text-foreground/35 line-through"
                            }
                          >
                            {f.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {(() => {
                      // Round 80.20: dynamic CTA per tier + user state.
                      const isFree = tier.key === "free";
                      const isCurrent =
                        status?.tier === tier.key && status.tier !== "free";
                      const isPaidTier = tier.key === "plus" || tier.key === "concierge";
                      const isLoading = loadingTier === tier.key;

                      // Free tier: always link to home
                      if (isFree) {
                        return (
                          <Link
                            href={tier.ctaLink}
                            className={`inline-flex items-center justify-center gap-2 h-11 rounded-lg font-semibold text-sm transition-colors border border-foreground/20 text-foreground hover:bg-foreground/5`}
                          >
                            {tier.cta}
                            <ArrowRight className="w-4 h-4" />
                          </Link>
                        );
                      }

                      // Currently-active paid tier → "Manage subscription"
                      if (isCurrent) {
                        return (
                          <button
                            type="button"
                            onClick={() => portalMutation.mutate()}
                            disabled={portalMutation.isPending}
                            className={`inline-flex items-center justify-center gap-2 h-11 rounded-lg font-semibold text-sm transition-colors w-full ${
                              tier.highlight
                                ? "bg-[#c9a563] text-foreground hover:bg-[#d4b478]"
                                : "border border-foreground/20 text-foreground hover:bg-foreground/5"
                            } disabled:opacity-60`}
                          >
                            {portalMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                {t("membership.manageSubscription")}
                                <ArrowRight className="w-4 h-4" />
                              </>
                            )}
                          </button>
                        );
                      }

                      // Paid tier, not current — Subscribe via Stripe
                      if (isPaidTier) {
                        return (
                          <button
                            type="button"
                            onClick={() => handleSubscribe(tier.key as "plus" | "concierge")}
                            disabled={isLoading || checkoutMutation.isPending}
                            className={`inline-flex items-center justify-center gap-2 h-11 rounded-lg font-semibold text-sm transition-colors w-full ${
                              tier.highlight
                                ? "bg-[#c9a563] text-foreground hover:bg-[#d4b478]"
                                : "border border-foreground/20 text-foreground hover:bg-foreground/5"
                            } disabled:opacity-60`}
                          >
                            {isLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                {isAuthenticated
                                  ? language === "en"
                                    ? "Start free trial"
                                    : "開始 10 天免費試用"
                                  : t("membership.loginToSubscribe")}
                                <ArrowRight className="w-4 h-4" />
                              </>
                            )}
                          </button>
                        );
                      }

                      return null;
                    })()}
                    {/* AB 390 §17602(a)(1) — clear & conspicuous disclosure
                        directly below the consent button. Plain language for
                        the trial → auto-charge transition, with a one-click
                        link to the full Membership Terms. */}
                    {(tier.key === "plus" || tier.key === "concierge") && (
                      <p
                        className={`mt-3 text-[11px] leading-relaxed ${
                          tier.highlight ? "text-white/55" : "text-foreground/45"
                        }`}
                      >
                        {language === "en" ? (
                          <>
                            10-day free trial. Card charged automatically after trial unless
                            cancelled. Cancel anytime online — no phone call needed.{" "}
                            <Link
                              href="/membership-terms"
                              className={`underline ${tier.highlight ? "text-[#c9a563]" : "text-[#8a6f3a]"}`}
                            >
                              Full terms
                            </Link>
                          </>
                        ) : (
                          <>
                            10 天免費試用,結束後自動扣款。可隨時線上取消,無需電話。{" "}
                            <Link
                              href="/membership-terms"
                              className={`underline ${tier.highlight ? "text-[#c9a563]" : "text-[#8a6f3a]"}`}
                            >
                              完整條款
                            </Link>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Soft launch notice */}
            <div className="mt-12 max-w-2xl mx-auto text-center">
              <p className="text-xs tracking-[0.3em] uppercase text-[#8a6f3a] mb-2">
                {t("membership.softLaunchEyebrow")}
              </p>
              <p className="text-sm text-foreground/70 leading-relaxed">
                {t("membership.softLaunchBody")}
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-[#FAF8F2] py-12 border-t border-foreground/8">
          <div className="container mx-auto px-6 text-center max-w-2xl">
            <p className="text-sm text-foreground/60 mb-3">{t("membership.contactHint")}</p>
            <a
              href="tel:+15106342307"
              className="inline-flex items-center gap-2 text-foreground hover:text-[#8a6f3a] transition-colors font-semibold"
            >
              <Phone className="w-4 h-4 text-[#c9a563]" />
              +1 (510) 634-2307
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
