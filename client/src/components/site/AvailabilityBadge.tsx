/**
 * AvailabilityBadge — the one shared availability indicator for the public site.
 *
 * Red line #2: customers only ever see 有位 / 名額有限 / 已滿, never a seat count.
 * The bucket is derived upstream (server-side, or via deriveAvailability) and
 * this component only renders it. Gold is reserved for the urgency state
 * (名額有限) so it draws the eye; 有位 stays quiet, 已滿 reads as closed.
 *
 * Position-agnostic: it renders an inline pill. Callers add absolute
 * positioning (e.g. an image overlay) via className when needed.
 */
import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";
import type { AvailabilityBucket } from "./types";

export function AvailabilityBadge({
  bucket,
  className,
}: {
  bucket: AvailabilityBucket;
  className?: string;
}) {
  const { t } = useLocale();
  if (bucket === "unknown") return null;

  const cfg: Record<
    Exclude<AvailabilityBucket, "unknown">,
    { label: string; cls: string }
  > = {
    available: {
      label: t("tours.availAvailable"),
      cls: "bg-white text-foreground border border-foreground/20",
    },
    limited: { label: t("tours.availLimited"), cls: "bg-[#c9a563] text-white" },
    soldout: {
      label: t("tours.availSoldout"),
      cls: "bg-gray-900/90 text-white line-through decoration-1",
    },
  };
  const c = cfg[bucket];

  return (
    <span
      className={cn(
        "inline-flex items-center text-[11px] font-semibold px-2 py-1 rounded-md whitespace-nowrap",
        c.cls,
        className,
      )}
    >
      {c.label}
    </span>
  );
}
