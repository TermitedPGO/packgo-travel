/**
 * PageHero — the one shared page header for the public site.
 *
 * Two variants replace the four ad-hoc heroes the site grew (full-bleed photo,
 * dark band, service-page photo, plain):
 *   - "photo":   full-bleed image + gradient + serif headline + one primary CTA.
 *                Use for landing / service / catalog-landing pages.
 *   - "compact": dark brand band + serif title + eyebrow. Use for utility pages
 *                (contact, membership, list headers) where a photo is noise.
 *
 * The full-bleed <img> is the ONE element allowed to skip rounded corners
 * (CLAUDE.md §2.1 hero exception). Everything else stays on the rounding rules.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHero({
  variant = "compact",
  image,
  eyebrow,
  title,
  subtitle,
  actions,
  className,
  heightClassName = "h-[58vh] min-h-[400px]",
}: {
  variant?: "photo" | "compact";
  image?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  heightClassName?: string;
}) {
  if (variant === "photo") {
    return (
      <section
        className={cn("relative isolate overflow-hidden", heightClassName, className)}
      >
        {image && (
          <img
            src={image}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/15"
          aria-hidden
        />
        <div className="relative container h-full flex flex-col justify-end pb-12 md:pb-16 text-white">
          {eyebrow && (
            <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#c9a563] mb-3">
              {eyebrow}
            </div>
          )}
          <h1 className="font-serif font-bold text-3xl md:text-5xl leading-tight max-w-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-4 text-base md:text-lg text-white/85 max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          )}
          {actions && <div className="mt-7 flex flex-wrap gap-3">{actions}</div>}
        </div>
        {/* Signature gold baseline, echoes header + footer */}
        <div
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#c9a563]/60 to-transparent"
          aria-hidden
        />
      </section>
    );
  }

  return (
    <section className={cn("bg-foreground text-white", className)}>
      <div className="container py-12 md:py-16 text-center">
        {eyebrow && (
          <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#c9a563] mb-3">
            {eyebrow}
          </div>
        )}
        <h1 className="font-serif font-bold text-3xl md:text-4xl leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 text-white/75 max-w-2xl mx-auto leading-relaxed">
            {subtitle}
          </p>
        )}
        {actions && (
          <div className="mt-6 flex flex-wrap gap-3 justify-center">{actions}</div>
        )}
      </div>
    </section>
  );
}
