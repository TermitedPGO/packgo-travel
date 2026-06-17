/**
 * PriceTag — the one shared price display for the public site.
 *
 * Red line: customers only ever see the retail "from" price (USD). This
 * component never touches agentPrice (supplier cost). Pass a pre-derived USD
 * amount (see deriveStartingUsd). `approx` renders a "≈" when the figure was
 * converted from a TWD supplier price. The "from / 起" label sits after the
 * number in zh and before it in en so both languages read naturally.
 */
import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";

type PriceTagSize = "sm" | "md" | "lg";

const SIZE: Record<PriceTagSize, string> = {
  sm: "text-lg",
  md: "text-[22px]",
  lg: "text-[30px]",
};

export function PriceTag({
  amountUsd,
  approx = false,
  from = false,
  size = "md",
  tone = "default",
  className,
}: {
  amountUsd?: number | null;
  approx?: boolean;
  from?: boolean;
  size?: PriceTagSize;
  tone?: "default" | "onDark";
  className?: string;
}) {
  const { t, language } = useLocale();
  const valueColor = tone === "onDark" ? "text-white" : "text-foreground";
  const labelColor = tone === "onDark" ? "text-white/70" : "text-foreground/50";

  if (amountUsd == null || !(amountUsd > 0)) {
    return (
      <span className={cn("font-serif font-bold", valueColor, className)}>
        {t("tours.priceOnRequest")}
      </span>
    );
  }

  const label = from ? (
    <span className={cn("text-[11px] font-sans font-normal", labelColor)}>
      {t("tours.startingFrom")}
    </span>
  ) : null;
  const value = (
    <span
      className={cn(
        "font-serif font-bold leading-none tabular-nums",
        valueColor,
        SIZE[size],
      )}
    >
      {approx ? "≈" : ""}US${amountUsd.toLocaleString()}
    </span>
  );

  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      {from && language === "en" ? label : null}
      {value}
      {from && language !== "en" ? label : null}
    </span>
  );
}
