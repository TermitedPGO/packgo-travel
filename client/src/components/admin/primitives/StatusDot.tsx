/**
 * StatusDot — single-color dot + optional label.
 * Replaces bulky status badges (which use background fills).
 *
 * Anti-pattern this replaces:
 *   <Badge className="bg-emerald-100 text-emerald-700">已確認</Badge>
 *
 * Use instead:
 *   <StatusDot tone="success" label="已確認" />
 */
export type StatusTone = "neutral" | "success" | "warn" | "danger" | "info" | "muted";

const COLOR: Record<StatusTone, { dot: string; text: string }> = {
  neutral: { dot: "bg-gray-500", text: "text-gray-700" },
  success: { dot: "bg-emerald-500", text: "text-emerald-700" },
  warn: { dot: "bg-amber-500", text: "text-amber-700" },
  danger: { dot: "bg-rose-500", text: "text-rose-700" },
  info: { dot: "bg-blue-500", text: "text-blue-700" },
  muted: { dot: "bg-gray-300", text: "text-gray-500" },
};

export function StatusDot({
  tone = "neutral",
  label,
  size = "sm",
}: {
  tone?: StatusTone;
  label?: string;
  size?: "xs" | "sm" | "md";
}) {
  const dotSize = size === "xs" ? "h-1.5 w-1.5" : size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";
  const textSize = size === "md" ? "text-sm" : "text-xs";
  const colors = COLOR[tone];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`${dotSize} rounded-full ${colors.dot} flex-shrink-0`} />
      {label && <span className={`${textSize} ${colors.text} font-medium`}>{label}</span>}
    </span>
  );
}
