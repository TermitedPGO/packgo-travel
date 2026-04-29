/**
 * BookingRiskCard — v78z-z3 Sprint 10 (C4): warning-signal card on Dashboard.
 *
 * Per UX audit: $5-15K AOV means losing 1 booking = a week's revenue.
 * Solo founder needs warning signals, not vanity dashboards. Surfaces 3
 * actionable risk metrics:
 *   1. Departures <50% booked within next 30 days (cancel-or-promote decision)
 *   2. Bookings with deposit_paid for >14 days (chase customer for balance)
 *   3. Active tours with zero bookings in last 30 days (delete or boost)
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { AlertTriangle, TrendingDown, Clock, ArrowRight } from "lucide-react";

interface Props {
  onNavigate?: (tab: string) => void;
}

export default function BookingRiskCard({ onNavigate }: Props = {}) {
  const { t } = useLocale();
  const { data, isLoading } = trpc.admin.getRiskMetrics.useQuery();

  const lowCapacity = data?.lowCapacity?.count ?? 0;
  const unpaidBalance = data?.unpaidBalance?.count ?? 0;
  const staleTours = data?.staleTours?.count ?? 0;
  const total = lowCapacity + unpaidBalance + staleTours;

  // Don't render the card at all if no risks (saves visual space)
  if (!isLoading && total === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            {t("bookingRisk.title")}
          </h3>
        </div>
        <span className="text-xs text-gray-500">{t("bookingRisk.subtitle")}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. Low capacity */}
        <button
          onClick={() => onNavigate?.("tours")}
          disabled={lowCapacity === 0}
          className={`
            flex items-start gap-3 p-4 rounded-xl border text-left transition-colors group
            ${lowCapacity > 0
              ? "bg-amber-50 border-amber-200 hover:bg-amber-100 cursor-pointer"
              : "bg-gray-50 border-gray-200 cursor-default"
            }
          `}
        >
          <TrendingDown className={`h-5 w-5 flex-shrink-0 mt-0.5 ${lowCapacity > 0 ? "text-amber-600" : "text-gray-300"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold tabular-nums text-gray-900">
              {isLoading ? "—" : lowCapacity}
            </p>
            <p className={`text-xs font-semibold ${lowCapacity > 0 ? "text-amber-700" : "text-gray-500"}`}>
              {t("bookingRisk.lowCapacityLabel")}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
              {t("bookingRisk.lowCapacityHint")}
            </p>
          </div>
          {lowCapacity > 0 && (
            <ArrowRight className="h-4 w-4 text-gray-300 flex-shrink-0 mt-2 group-hover:text-gray-600" />
          )}
        </button>

        {/* 2. Unpaid balance */}
        <button
          onClick={() => onNavigate?.("bookings")}
          disabled={unpaidBalance === 0}
          className={`
            flex items-start gap-3 p-4 rounded-xl border text-left transition-colors group
            ${unpaidBalance > 0
              ? "bg-red-50 border-red-200 hover:bg-red-100 cursor-pointer"
              : "bg-gray-50 border-gray-200 cursor-default"
            }
          `}
        >
          <Clock className={`h-5 w-5 flex-shrink-0 mt-0.5 ${unpaidBalance > 0 ? "text-red-600" : "text-gray-300"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold tabular-nums text-gray-900">
              {isLoading ? "—" : unpaidBalance}
            </p>
            <p className={`text-xs font-semibold ${unpaidBalance > 0 ? "text-red-700" : "text-gray-500"}`}>
              {t("bookingRisk.unpaidBalanceLabel")}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
              {t("bookingRisk.unpaidBalanceHint")}
            </p>
          </div>
          {unpaidBalance > 0 && (
            <ArrowRight className="h-4 w-4 text-gray-300 flex-shrink-0 mt-2 group-hover:text-gray-600" />
          )}
        </button>

        {/* 3. Stale tours */}
        <button
          onClick={() => onNavigate?.("tours")}
          disabled={staleTours === 0}
          className={`
            flex items-start gap-3 p-4 rounded-xl border text-left transition-colors group
            ${staleTours > 0
              ? "bg-blue-50 border-blue-200 hover:bg-blue-100 cursor-pointer"
              : "bg-gray-50 border-gray-200 cursor-default"
            }
          `}
        >
          <AlertTriangle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${staleTours > 0 ? "text-blue-600" : "text-gray-300"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold tabular-nums text-gray-900">
              {isLoading ? "—" : staleTours}
            </p>
            <p className={`text-xs font-semibold ${staleTours > 0 ? "text-blue-700" : "text-gray-500"}`}>
              {t("bookingRisk.staleToursLabel")}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
              {t("bookingRisk.staleToursHint")}
            </p>
          </div>
          {staleTours > 0 && (
            <ArrowRight className="h-4 w-4 text-gray-300 flex-shrink-0 mt-2 group-hover:text-gray-600" />
          )}
        </button>
      </div>
    </div>
  );
}
