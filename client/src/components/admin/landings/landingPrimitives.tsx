/**
 * Round 81 / 2026-05-17 — Shared primitives for per-domain landing pages.
 *
 * All 4 domain landings (Ops/Customers/Marketing/Finance) follow the same
 * structure:
 *   [Greeting / context strip]
 *   [KPI hero row — 3-5 cards]
 *   [Body grid — 2-3 columns of data widgets]
 *   [Quick CTA row]
 *
 * Extracting these primitives keeps the 4 landings to ~80 lines each
 * instead of 300+, and Jeff can edit one place to restyle them all.
 */
import { ReactNode } from "react";
import { TrendingUp, TrendingDown, ArrowRight } from "lucide-react";

export type Accent = "rose" | "amber" | "emerald" | "indigo" | "violet" | "sky" | "slate";
const ACCENT_BG: Record<Accent, string> = {
  rose: "from-rose-50 to-white border-rose-100",
  amber: "from-amber-50 to-white border-amber-100",
  emerald: "from-emerald-50 to-white border-emerald-100",
  indigo: "from-indigo-50 to-white border-indigo-100",
  violet: "from-violet-50 to-white border-violet-100",
  sky: "from-sky-50 to-white border-sky-100",
  slate: "from-slate-50 to-white border-slate-100",
};
const ACCENT_ICON: Record<Accent, string> = {
  rose: "text-rose-600 bg-rose-100",
  amber: "text-amber-600 bg-amber-100",
  emerald: "text-emerald-600 bg-emerald-100",
  indigo: "text-indigo-600 bg-indigo-100",
  violet: "text-violet-600 bg-violet-100",
  sky: "text-sky-600 bg-sky-100",
  slate: "text-slate-600 bg-slate-100",
};

export function KpiCard({
  icon: Icon,
  label,
  primary,
  secondary,
  accent,
  trend,
  onClick,
  loading,
}: {
  icon: any;
  label: string;
  primary: string | number;
  secondary?: string;
  accent: Accent;
  trend?: "up" | "down";
  onClick?: () => void;
  loading?: boolean;
}) {
  const Cmp = onClick ? "button" : "div";
  return (
    <Cmp
      onClick={onClick}
      className={`group relative text-left rounded-xl border bg-gradient-to-b ${ACCENT_BG[accent]} p-3.5 ${onClick ? "hover:shadow-md cursor-pointer" : ""} transition-shadow`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-lg ${ACCENT_ICON[accent]} flex items-center justify-center`}>
          <Icon className="w-4 h-4" />
        </div>
        {onClick && (
          <ArrowRight className="w-3.5 h-3.5 text-foreground/30 group-hover:text-foreground/60 transition-colors" />
        )}
      </div>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-foreground/50 mb-0.5">
        {label}
      </div>
      <div className="text-base font-bold text-foreground tabular-nums flex items-center gap-1">
        {loading ? <span className="text-foreground/30">⋯</span> : primary}
        {trend === "up" && <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />}
        {trend === "down" && <TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
      </div>
      {secondary && (
        <div className="text-[11px] text-foreground/55 mt-0.5 line-clamp-1">
          {loading ? "" : secondary}
        </div>
      )}
    </Cmp>
  );
}

/**
 * Body widget — square card with a header + content.
 * Used for "Recent X" / "Upcoming Y" sections.
 */
export function SectionCard({
  title,
  icon: Icon,
  iconTone = "text-foreground/60",
  action,
  children,
}: {
  title: string;
  icon?: any;
  iconTone?: string;
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          {Icon && <Icon className={`w-4 h-4 ${iconTone}`} />}
          {title}
        </h2>
        {action && (
          <button
            onClick={action.onClick}
            className="text-[11px] text-foreground/50 hover:text-foreground/80"
          >
            {action.label} →
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function LandingGreeting({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-foreground/50">{subtitle}</p>}
      </div>
    </div>
  );
}
