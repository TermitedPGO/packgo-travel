import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MarketingLayoutProps {
  /** Hero headline — rendered in Noto Serif TC, large. */
  title: string;
  /** Hero subtitle. Single line, light weight. */
  subtitle?: string;
  /** Page body. Wrapped in a centered prose container. */
  children: ReactNode;
  /** Optional CTA button shown after the body. */
  ctaText?: string;
  ctaLink?: string;
  /** Optional full-bleed hero background image URL. Falls back to brand teal. */
  heroBgImage?: string;
  /** Show the brand credentials line under the title (default: true). */
  showCredentials?: boolean;
}

const CREDENTIALS_LINE = "PACK&GO TRAVEL · SINCE 2024 · CST #2166984";

export default function MarketingLayout({
  title,
  subtitle,
  children,
  ctaText,
  ctaLink,
  heroBgImage,
  showCredentials = true,
}: MarketingLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background font-sans">
      <Header />

      <main className="flex-grow">
        <section
          className={cn(
            "relative h-[360px] md:h-[420px] flex items-center justify-center overflow-hidden",
            heroBgImage ? "bg-foreground" : "bg-primary",
          )}
          style={
            heroBgImage
              ? {
                  backgroundImage: `url(${heroBgImage})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          <div
            className={cn(
              "absolute inset-0",
              heroBgImage ? "bg-black/55" : "bg-black/15",
            )}
            aria-hidden
          />

          <div className="container relative z-10 text-center text-white px-4">
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-4 text-base md:text-lg text-white/85 max-w-2xl mx-auto leading-relaxed">
                {subtitle}
              </p>
            )}
            {showCredentials && (
              <p className="mt-6 text-xs tracking-[0.25em] uppercase text-white/60">
                {CREDENTIALS_LINE}
              </p>
            )}
          </div>
        </section>

        <section className="py-16 md:py-20">
          <div className="container">
            <div className="max-w-4xl mx-auto prose prose-lg">{children}</div>

            {ctaText && ctaLink && (
              <div className="text-center mt-12">
                <Link href={ctaLink}>
                  <Button size="lg" className="rounded-lg px-8 gap-2">
                    {ctaText}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
