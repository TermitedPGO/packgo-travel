import { Link } from "wouter";
import { ArrowRight, ShieldCheck, MapPin, Heart } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Round 80.5: Founder story + trust strip.
 *
 * Sits immediately below the hero so first-time visitors see — within their
 * first 5 seconds — that PACK&GO is (1) run by a real human (Jeff), (2) a
 * licensed California travel agency (CST #2166984), and (3) built around an
 * emotional anchor ("為忙碌的家庭帶出國的機會").
 *
 * Typography-first design — NO founder photo per Jeff's request. The lift
 * comes from a serif quote, a gold accent rule, and a horizontal trust-pill
 * row. Layout: large quote on the left (60%), credentials column on the right
 * (40%) on desktop; stacked on mobile.
 */
export default function HomeFounderStory() {
  const { t } = useLocale();

  return (
    <section className="relative w-full bg-foreground/[0.015] border-y border-foreground/[0.06] py-14 md:py-20">
      {/* Soft gold radial wash — barely-there warmth, breaks the flat
          off-white. Centred behind the quote so eye gravitates there. */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,_rgba(201,165,99,0.07)_0%,_transparent_55%)]"
        aria-hidden
      />

      <div className="container relative mx-auto px-6 md:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 md:gap-14 items-start">
          {/* Story — left column */}
          <div className="lg:col-span-7">
            <div className="flex items-center gap-3 mb-5 text-[#c9a563]">
              <span className="h-px w-8 bg-[#c9a563]" aria-hidden />
              <p className="text-[11px] tracking-[0.35em] uppercase font-medium">
                {t("homeFounder.eyebrow")}
              </p>
            </div>
            <h2 className="font-serif font-bold text-foreground text-3xl md:text-4xl lg:text-[2.75rem] leading-[1.15] tracking-tight mb-6 md:mb-8">
              {t("homeFounder.title")}
            </h2>
            <blockquote className="space-y-4 text-foreground/75 text-base md:text-lg leading-relaxed max-w-2xl border-l-2 border-[#c9a563]/35 pl-5 md:pl-6">
              <p>{t("homeFounder.bodyP1")}</p>
              <p>{t("homeFounder.bodyP2")}</p>
              <footer className="not-italic pt-2 text-sm md:text-base text-foreground/60">
                <span className="font-semibold text-foreground/85">— Jeff Hsieh</span>
                <span className="text-foreground/45 ml-2">{t("homeFounder.byline")}</span>
              </footer>
            </blockquote>

            <Link
              href="/about-us"
              className="group mt-7 md:mt-8 inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground hover:text-[#8a6f3a] transition-colors"
            >
              {t("homeFounder.aboutCta")}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          {/* Credentials — right column. Stacked pills, each with icon +
              label + sub-text. Compact, scannable, anchors trust. */}
          <div className="lg:col-span-5 lg:pl-6 lg:border-l lg:border-foreground/10">
            <p className="text-[11px] tracking-[0.3em] uppercase text-foreground/45 font-medium mb-5">
              {t("homeFounder.credentialsTitle")}
            </p>
            <div className="space-y-4">
              {/* CST license — California Seller of Travel */}
              <div className="flex items-start gap-4 p-4 rounded-xl bg-white border border-[#c9a563]/30">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#c9a563]/15 border border-[#c9a563]/35">
                  <ShieldCheck className="h-5 w-5 text-[#c9a563]" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground leading-tight">
                    {t("homeFounder.cstTitle")}
                  </p>
                  <p className="text-xs text-foreground/55 mt-0.5 leading-snug">
                    {t("homeFounder.cstSub")}
                  </p>
                  <p className="text-xs font-mono font-bold text-[#8a6f3a] mt-1.5 tracking-wide">
                    CST #2166984
                  </p>
                </div>
              </div>

              {/* Bay Area HQ */}
              <div className="flex items-start gap-4 p-4 rounded-xl bg-white border border-foreground/10">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg bg-foreground/[0.04]">
                  <MapPin className="h-5 w-5 text-foreground/65" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground leading-tight">
                    {t("homeFounder.locationTitle")}
                  </p>
                  <p className="text-xs text-foreground/55 mt-0.5 leading-snug">
                    {t("homeFounder.locationSub")}
                  </p>
                </div>
              </div>

              {/* Boutique promise */}
              <div className="flex items-start gap-4 p-4 rounded-xl bg-white border border-foreground/10">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg bg-foreground/[0.04]">
                  <Heart className="h-5 w-5 text-foreground/65" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground leading-tight">
                    {t("homeFounder.boutiqueTitle")}
                  </p>
                  <p className="text-xs text-foreground/55 mt-0.5 leading-snug">
                    {t("homeFounder.boutiqueSub")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
