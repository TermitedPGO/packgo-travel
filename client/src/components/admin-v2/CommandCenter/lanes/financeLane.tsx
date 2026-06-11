/**
 * Finance lane (P4) — payload shape, parser, and the read-only alert preview
 * (finance alerts have no editor).
 * Moved verbatim out of lanes/index.tsx (852-line split, 2026-06-11).
 */
import { useLocale } from "@/contexts/LocaleContext";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { GenericPayloadPreview } from "./GenericPayloadPreview";

/** Parsed shape the finance producer writes into payload JSON. */
export interface FinanceAlertPayload {
  alertType: string;
  severity: "info" | "warning" | "critical";
  headline: string;
  details: string;
  metric?: number;
  threshold?: number;
  period?: string;
  actionSuggestion?: string;
}

function parseFinancePayload(payload: string): FinanceAlertPayload | null {
  try {
    const obj = JSON.parse(payload);
    if (obj && typeof obj.headline === "string" && typeof obj.severity === "string") {
      return obj as FinanceAlertPayload;
    }
  } catch {
    // fall through
  }
  return null;
}

const SEVERITY_STYLES: Record<
  FinanceAlertPayload["severity"],
  { border: string; bg: string; text: string; badge: string }
> = {
  info: {
    border: "border-blue-200",
    bg: "bg-blue-50",
    text: "text-blue-700",
    badge: "bg-blue-100 text-blue-700",
  },
  warning: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
  },
  critical: {
    border: "border-rose-200",
    bg: "bg-rose-50",
    text: "text-rose-700",
    badge: "bg-rose-100 text-rose-700",
  },
};

const SEVERITY_ICON: Record<FinanceAlertPayload["severity"], typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  critical: ShieldAlert,
};

export function FinanceAlertPreview({ payload }: { payload: string }) {
  const { t } = useLocale();
  const parsed = parseFinancePayload(payload);

  if (!parsed) {
    return <GenericPayloadPreview summary={null} payload={payload} />;
  }

  const style = SEVERITY_STYLES[parsed.severity];
  const Icon = SEVERITY_ICON[parsed.severity];

  return (
    <div className="space-y-3">
      {/* Severity badge + headline */}
      <div className={`rounded-xl border ${style.border} ${style.bg} p-4 space-y-2`}>
        <div className="flex items-start gap-2">
          <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${style.text}`} />
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
              >
                {t(`admin.commandCenter.finSeverity${parsed.severity.charAt(0).toUpperCase() + parsed.severity.slice(1)}` as any)}
              </span>
              {parsed.period && (
                <span className="text-xs text-gray-400">{parsed.period}</span>
              )}
            </div>
            <p className={`text-sm font-medium ${style.text}`}>
              {parsed.headline}
            </p>
          </div>
        </div>

        {/* Metric vs threshold */}
        {parsed.metric !== undefined && (
          <div className="flex items-center gap-3 text-xs">
            <span className={`font-mono font-semibold ${style.text}`}>
              {typeof parsed.metric === "number"
                ? parsed.metric % 1 === 0
                  ? parsed.metric.toLocaleString()
                  : parsed.metric.toFixed(2)
                : parsed.metric}
            </span>
            {parsed.threshold !== undefined && (
              <>
                <span className="text-gray-400">/</span>
                <span className="text-gray-500">
                  {t("admin.commandCenter.finThreshold")}: {parsed.threshold}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Details */}
      {parsed.details && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-[11px] font-medium text-gray-400 mb-1">
            {t("admin.commandCenter.finDetails")}
          </p>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">
            {parsed.details}
          </pre>
        </div>
      )}

      {/* Action suggestion */}
      {parsed.actionSuggestion && (
        <div className="rounded-lg bg-gray-100 border border-gray-200 p-3">
          <p className="text-[11px] font-medium text-gray-400 mb-1">
            {t("admin.commandCenter.finActionSuggestion")}
          </p>
          <p className="text-xs text-gray-600">{parsed.actionSuggestion}</p>
        </div>
      )}
    </div>
  );
}
