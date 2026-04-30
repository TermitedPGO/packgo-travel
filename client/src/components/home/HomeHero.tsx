import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Phone } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { cn } from "@/lib/utils";

interface HomeHeroProps {
  /** Optional full-bleed background image. Defaults to solid black. */
  bgImage?: string;
}

/**
 * Round 79: anchor hero for the home page.
 *
 * Replaces the previous duo of HomeHeroSpotlight (rotating featured tour
 * carousel) + EditableHero (duplicate search bar). One photographic hero
 * with a fixed serif headline gives every visitor the same first
 * impression instead of a roulette.
 */
export default function HomeHero({ bgImage }: HomeHeroProps) {
  const { t } = useLocale();

  return (
    <section
      className={cn(
        "relative w-full overflow-hidden",
        "h-[78vh] min-h-[560px] max-h-[820px]",
        "flex items-center",
        bgImage ? "bg-foreground" : "bg-foreground",
      )}
      style={
        bgImage
          ? {
              backgroundImage: `url(${bgImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      {/* Overlay: heavier on photo bg, none on solid black */}
      {bgImage && (
        <div
          className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/65"
          aria-hidden
        />
      )}

      <div className="container relative z-10 mx-auto px-6 md:px-10">
        <div className="max-w-3xl">
          {/* Eyebrow — credentials line, matches PDF cover */}
          <p className="text-xs md:text-sm tracking-[0.35em] uppercase text-white/65 mb-6 md:mb-8">
            {t("homeHero.eyebrow")}
          </p>

          {/* Headline — Noto Serif TC, fixed copy that anchors brand */}
          <h1 className="font-serif font-bold text-white text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight">
            {t("homeHero.title")}
          </h1>

          {/* Subtitle — matches PDF tagline */}
          <p className="mt-5 md:mt-6 text-lg md:text-xl text-white/80 leading-relaxed max-w-2xl">
            {t("homeHero.subtitle")}
          </p>

          {/* Dual CTA */}
          <div className="mt-8 md:mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Link href="/custom-tour-request">
              <Button
                size="lg"
                className="rounded-lg px-7 h-12 bg-white text-foreground hover:bg-white/90 font-semibold tracking-wide gap-2 w-full sm:w-auto"
              >
                {t("homeHero.ctaPrimary")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/tours">
              <Button
                size="lg"
                variant="outline"
                className="rounded-lg px-7 h-12 bg-transparent text-white border-white/40 hover:bg-white/10 hover:text-white hover:border-white/70 font-semibold tracking-wide w-full sm:w-auto"
              >
                {t("homeHero.ctaSecondary")}
              </Button>
            </Link>
          </div>

          {/* Phone CTA at the bottom — secondary trust signal */}
          <div className="mt-10 md:mt-14 flex items-center gap-3 text-white/70">
            <Phone className="h-4 w-4" />
            <a
              href="tel:+15106342307"
              className="text-sm tracking-wide hover:text-white transition-colors"
            >
              +1 (510) 634-2307 · {t("homeHero.phoneNote")}
            </a>
          </div>
        </div>
      </div>

      {/* Subtle decorative gold accent at bottom — echoes PDF gold line */}
      <div
        className="absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#c9a563] to-transparent opacity-40"
        aria-hidden
      />
    </section>
  );
}
