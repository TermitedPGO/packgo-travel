/**
 * DepartureCalendarV2 — monthly calendar grid for all tour departures.
 *
 * Visual pattern: Google Calendar-style monthly view. Each departure renders
 * as a small colored pill on its departure date. Clicking a pill opens a
 * Sheet drawer with full departure details + seat utilization bar.
 *
 * Filter chips above calendar: All / Open / Confirmed / Full / Cancelled.
 *
 * Backend wire: trpc.admin.departureCalendar (adminDepartures router).
 * 2026-05-27
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import {
  StatusDot,
  type StatusTone,
} from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Users,
  MapPin,
  Clock,
  DollarSign,
  User,
  Tag,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

type DepartureStatus = "open" | "confirmed" | "full" | "cancelled";
type OpsStatus = "planning" | "confirmed" | "departed" | "completed" | "cancelled";
type StatusFilter = DepartureStatus | "all";

type Departure = {
  id: number;
  tourId: number;
  tourTitle: string;
  departureDate: string | Date;
  returnDate: string | Date;
  adultPrice: number;
  childPriceWithBed?: number | null;
  childPriceNoBed?: number | null;
  infantPrice?: number | null;
  singleRoomSupplement?: number | null;
  currency: string;
  totalSlots: number;
  bookedSlots: number;
  status: DepartureStatus;
  opsStatus: OpsStatus;
  groupName?: string | null;
  tourLeader?: string | null;
  notes?: string | null;
};

// ────────────────────────────────────────────────────────────────────────
// Status colors + tone mapping
// ────────────────────────────────────────────────────────────────────────

const STATUS_PILL_CLASSES: Record<DepartureStatus, string> = {
  open: "bg-emerald-100 text-emerald-800 border-emerald-200",
  confirmed: "bg-blue-100 text-blue-800 border-blue-200",
  full: "bg-amber-100 text-amber-800 border-amber-200",
  cancelled: "bg-gray-100 text-gray-400 border-gray-200 line-through",
};

const STATUS_TONE: Record<DepartureStatus, StatusTone> = {
  open: "success",
  confirmed: "info",
  full: "warn",
  cancelled: "muted",
};

const OPS_STATUS_TONE: Record<OpsStatus, StatusTone> = {
  planning: "muted",
  confirmed: "info",
  departed: "success",
  completed: "success",
  cancelled: "danger",
};

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Calendar grid cells for a given year/month. Pads start to align to Sunday. */
function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay(); // 0=Sun

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push(new Date(year, month, d));
  }
  // Pad end to fill complete weeks
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatPrice(price: number, currency: string): string {
  if (currency === "USD") return `$${price.toLocaleString()}`;
  if (currency === "TWD") return `NT$${price.toLocaleString()}`;
  return `${currency} ${price.toLocaleString()}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export default function DepartureCalendarV2() {
  const { t } = useLocale();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Departure | null>(null);

  const { data: rawDepartures, isLoading } =
    trpc.admin.departureCalendar.useQuery();

  // Filter departures by status
  const departures = useMemo(() => {
    if (!rawDepartures) return [];
    if (statusFilter === "all") return rawDepartures as Departure[];
    return (rawDepartures as Departure[]).filter(
      (d) => d.status === statusFilter
    );
  }, [rawDepartures, statusFilter]);

  // Group departures by date string for fast lookup
  const departuresByDate = useMemo(() => {
    const map = new Map<string, Departure[]>();
    for (const d of departures) {
      const dt = toDate(d.departureDate);
      const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return map;
  }, [departures]);

  // Count per status for filter badges
  const statusCounts = useMemo(() => {
    const all = (rawDepartures ?? []) as Departure[];
    return {
      all: all.length,
      open: all.filter((d) => d.status === "open").length,
      confirmed: all.filter((d) => d.status === "confirmed").length,
      full: all.filter((d) => d.status === "full").length,
      cancelled: all.filter((d) => d.status === "cancelled").length,
    };
  }, [rawDepartures]);

  // Calendar grid
  const cells = useMemo(() => getCalendarDays(year, month), [year, month]);

  const goToPrevMonth = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  // Month label
  const monthLabel = new Date(year, month).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
  });

  // Weekday headers
  const weekdays = [
    t("admin.departureCalendar.sun"),
    t("admin.departureCalendar.mon"),
    t("admin.departureCalendar.tue"),
    t("admin.departureCalendar.wed"),
    t("admin.departureCalendar.thu"),
    t("admin.departureCalendar.fri"),
    t("admin.departureCalendar.sat"),
  ];

  // Status filter options
  const filterOptions: { key: StatusFilter; label: string }[] = [
    { key: "all", label: `${t("admin.departureCalendar.filterAll")} (${statusCounts.all})` },
    { key: "open", label: `${t("admin.departureCalendar.filterOpen")} (${statusCounts.open})` },
    { key: "confirmed", label: `${t("admin.departureCalendar.filterConfirmed")} (${statusCounts.confirmed})` },
    { key: "full", label: `${t("admin.departureCalendar.filterFull")} (${statusCounts.full})` },
    { key: "cancelled", label: `${t("admin.departureCalendar.filterCancelled")} (${statusCounts.cancelled})` },
  ];

  // Detail panel helpers
  const selectedDep = toDate(selected?.departureDate ?? new Date());
  const selectedRet = toDate(selected?.returnDate ?? new Date());
  const durationDays = selected ? daysBetween(selectedDep, selectedRet) + 1 : 0;
  const durationNights = selected ? daysBetween(selectedDep, selectedRet) : 0;
  const seatPct = selected
    ? Math.round((selected.bookedSlots / Math.max(selected.totalSlots, 1)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-teal-600" />
          <h1 className="text-lg font-semibold text-gray-900">
            {t("admin.departureCalendar.title")}
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={goToToday}
        >
          {t("admin.departureCalendar.today")}
        </Button>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setStatusFilter(opt.key)}
            className={`
              inline-flex items-center h-7 px-3 text-xs font-medium rounded-md border transition-colors
              ${
                statusFilter === opt.key
                  ? "bg-teal-50 border-teal-300 text-teal-700"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }
            `}
          >
            {opt.key !== "all" && (
              <span className="mr-1"><StatusDot tone={STATUS_TONE[opt.key as DepartureStatus]} /></span>
            )}
            {opt.label}
          </button>
        ))}
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-lg"
          onClick={goToPrevMonth}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold text-gray-900">{monthLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          className="rounded-lg"
          onClick={goToNextMonth}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
          {t("admin.departureCalendar.loading")}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Weekday header */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {weekdays.map((wd, i) => (
              <div
                key={i}
                className="text-center text-xs font-medium text-gray-500 py-2"
              >
                {wd}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {cells.map((cell, idx) => {
              if (!cell) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="min-h-[100px] border-b border-r border-gray-50 bg-gray-50/30"
                  />
                );
              }

              const key = `${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`;
              const dayDeps = departuresByDate.get(key) ?? [];
              const isToday = isSameDay(cell, today);
              const isWeekend = cell.getDay() === 0 || cell.getDay() === 6;

              return (
                <div
                  key={key}
                  className={`
                    min-h-[100px] border-b border-r border-gray-100 p-1.5
                    ${isWeekend ? "bg-gray-50/50" : "bg-white"}
                  `}
                >
                  {/* Date number */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`
                        text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full
                        ${
                          isToday
                            ? "bg-teal-600 text-white"
                            : isWeekend
                              ? "text-gray-400"
                              : "text-gray-700"
                        }
                      `}
                    >
                      {cell.getDate()}
                    </span>
                    {dayDeps.length > 0 && (
                      <span className="text-[10px] text-gray-400">
                        {dayDeps.length}
                      </span>
                    )}
                  </div>

                  {/* Departure pills */}
                  <div className="space-y-0.5">
                    {dayDeps.slice(0, 3).map((dep) => (
                      <button
                        key={dep.id}
                        onClick={() => setSelected(dep)}
                        className={`
                          w-full text-left text-[10px] leading-tight px-1.5 py-0.5
                          rounded-md border truncate cursor-pointer
                          hover:shadow-sm transition-shadow
                          ${STATUS_PILL_CLASSES[dep.status]}
                        `}
                        title={dep.tourTitle}
                      >
                        {truncate(dep.tourTitle, 8)}{" "}
                        <span className="opacity-70">
                          {dep.bookedSlots}/{dep.totalSlots}
                        </span>
                      </button>
                    ))}
                    {dayDeps.length > 3 && (
                      <div className="text-[10px] text-gray-400 text-center">
                        +{dayDeps.length - 3}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span className="font-medium">{t("admin.departureCalendar.legend")}:</span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-200" />
          {t("admin.departureCalendar.filterOpen")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-blue-100 border border-blue-200" />
          {t("admin.departureCalendar.filterConfirmed")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-200" />
          {t("admin.departureCalendar.filterFull")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" />
          {t("admin.departureCalendar.filterCancelled")}
        </span>
      </div>

      {/* ── Detail Sheet ────────────────────────────────────────────── */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full xl:max-w-lg xl:rounded-l-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base font-semibold">
              {selected?.tourTitle ?? ""}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("admin.departureCalendar.detailDesc")}
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="space-y-5 pt-2">
              {/* Status badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border ${STATUS_PILL_CLASSES[selected.status]}`}>
                  <StatusDot tone={STATUS_TONE[selected.status]} />
                  {t(`admin.departureCalendar.status_${selected.status}`)}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border bg-gray-50 text-gray-700 border-gray-200">
                  <StatusDot tone={OPS_STATUS_TONE[selected.opsStatus]} />
                  {t(`admin.departureCalendar.ops_${selected.opsStatus}`)}
                </span>
              </div>

              {/* Dates + duration */}
              <div className="rounded-xl bg-gray-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="font-medium">{t("admin.departureCalendar.dateRange")}</span>
                </div>
                <div className="text-sm text-gray-900 pl-6">
                  {toDate(selected.departureDate).toLocaleDateString("zh-TW", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    weekday: "short",
                  })}
                  {" → "}
                  {toDate(selected.returnDate).toLocaleDateString("zh-TW", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    weekday: "short",
                  })}
                </div>
                <div className="text-xs text-gray-500 pl-6">
                  {t("admin.departureCalendar.duration", {
                    days: String(durationDays),
                    nights: String(durationNights),
                  })}
                </div>
              </div>

              {/* Seat utilization */}
              <div className="rounded-xl bg-gray-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Users className="h-4 w-4 text-gray-400" />
                  <span className="font-medium">{t("admin.departureCalendar.seats")}</span>
                </div>
                <div className="flex items-center gap-3 pl-6">
                  <div className="flex-1 h-2.5 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        seatPct >= 90
                          ? "bg-red-500"
                          : seatPct >= 70
                            ? "bg-amber-500"
                            : "bg-teal-500"
                      }`}
                      style={{ width: `${Math.min(seatPct, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 tabular-nums">
                    {selected.bookedSlots}/{selected.totalSlots}
                  </span>
                  <span className="text-xs text-gray-500">({seatPct}%)</span>
                </div>
              </div>

              {/* Pricing */}
              <div className="rounded-xl bg-gray-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <DollarSign className="h-4 w-4 text-gray-400" />
                  <span className="font-medium">{t("admin.departureCalendar.pricing")}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pl-6 text-sm">
                  <div>
                    <span className="text-gray-500">{t("admin.departureCalendar.adultPrice")}</span>
                    <div className="font-medium text-gray-900">
                      {formatPrice(selected.adultPrice, selected.currency)}
                    </div>
                  </div>
                  {selected.childPriceWithBed != null && (
                    <div>
                      <span className="text-gray-500">{t("admin.departureCalendar.childWithBed")}</span>
                      <div className="font-medium text-gray-900">
                        {formatPrice(selected.childPriceWithBed, selected.currency)}
                      </div>
                    </div>
                  )}
                  {selected.childPriceNoBed != null && (
                    <div>
                      <span className="text-gray-500">{t("admin.departureCalendar.childNoBed")}</span>
                      <div className="font-medium text-gray-900">
                        {formatPrice(selected.childPriceNoBed, selected.currency)}
                      </div>
                    </div>
                  )}
                  {selected.infantPrice != null && (
                    <div>
                      <span className="text-gray-500">{t("admin.departureCalendar.infantPrice")}</span>
                      <div className="font-medium text-gray-900">
                        {formatPrice(selected.infantPrice, selected.currency)}
                      </div>
                    </div>
                  )}
                  {selected.singleRoomSupplement != null && (
                    <div>
                      <span className="text-gray-500">{t("admin.departureCalendar.singleSupplement")}</span>
                      <div className="font-medium text-gray-900">
                        +{formatPrice(selected.singleRoomSupplement, selected.currency)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Group info */}
              {(selected.groupName || selected.tourLeader) && (
                <div className="rounded-xl bg-gray-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Tag className="h-4 w-4 text-gray-400" />
                    <span className="font-medium">{t("admin.departureCalendar.groupInfo")}</span>
                  </div>
                  <div className="pl-6 text-sm space-y-1">
                    {selected.groupName && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-gray-400" />
                        <span className="text-gray-900">{selected.groupName}</span>
                      </div>
                    )}
                    {selected.tourLeader && (
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-gray-400" />
                        <span className="text-gray-500">{t("admin.departureCalendar.tourLeader")}:</span>
                        <span className="text-gray-900">{selected.tourLeader}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notes */}
              {selected.notes && (
                <div className="rounded-xl bg-gray-50 p-4 space-y-2">
                  <div className="text-sm font-medium text-gray-700">
                    {t("admin.departureCalendar.notes")}
                  </div>
                  <p className="text-sm text-gray-600 pl-0 whitespace-pre-wrap">
                    {selected.notes}
                  </p>
                </div>
              )}

              {/* ID reference */}
              <div className="text-xs text-gray-400 pt-2">
                ID: {selected.id} &middot; Tour #{selected.tourId}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
