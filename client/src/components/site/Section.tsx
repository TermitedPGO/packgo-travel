/**
 * Section — the one shared content block wrapper for the public site.
 *
 * Owns the site's vertical rhythm and an optional header (eyebrow + serif
 * title + a right-aligned action like "see all"). Using it everywhere keeps
 * section spacing and heading treatment identical page to page, which is the
 * whole point of the design system.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  eyebrow,
  title,
  action,
  children,
  className,
  containerClassName,
  id,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  id?: string;
}) {
  const hasHeader = Boolean(eyebrow || title || action);
  return (
    <section id={id} className={cn("py-12 md:py-16", className)}>
      <div className={cn("container", containerClassName)}>
        {hasHeader && (
          <div className="flex items-end justify-between gap-4 mb-7 md:mb-9">
            <div className="min-w-0">
              {eyebrow && (
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#c9a563] mb-2">
                  {eyebrow}
                </div>
              )}
              {title && (
                <h2 className="font-serif font-bold text-2xl md:text-3xl text-foreground leading-tight">
                  {title}
                </h2>
              )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
