/**
 * TourDetailPeony / DeparturePriceCalendar.tsx
 *
 * Dynamic price calendar widget — fetches departures for the tour and
 * renders a month-by-month grid with status pills + per-departure pricing.
 *
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React, { useEffect, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type { getThemeColorByDestination } from "./helpers";

export const DeparturePriceCalendar = ({
  tourId,
  basePrice,
  themeColor,
  onSelectDeparture
}: {
  tourId: number;
  basePrice: number;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  onSelectDeparture: (departureId: number) => void;
}) => {
  const { t, tArray, formatPrice } = useLocale();
  const { data: departures, isLoading } = trpc.departures.list.useQuery({ tourId });
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [selectedDeparture, setSelectedDeparture] = useState<number | null>(null);
  const [hasAutoJumped, setHasAutoJumped] = useState(false);

  // Auto-jump to the nearest upcoming departure month when data loads
  useEffect(() => {
    if (departures && departures.length > 0 && !hasAutoJumped) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const futureDepartures = (departures as any[])
        .filter((d) => new Date(d.departureDate) >= now && d.status !== 'cancelled')
        .sort((a, b) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
      if (futureDepartures.length > 0) {
        const nearest = new Date(futureDepartures[0].departureDate);
        setSelectedMonth(new Date(nearest.getFullYear(), nearest.getMonth(), 1));
      }
      setHasAutoJumped(true);
    }
  }, [departures, hasAutoJumped]);

  // 生成日曆網格
  const calendarDays = useMemo(() => {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const days: (Date | null)[] = [];

    for (let i = 0; i < startPadding; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
    return days;
  }, [selectedMonth]);

  const getDepartureForDay = (date: Date | null) => {
    if (!date || !departures) return null;
    return departures.find((d: any) => {
      const depDate = new Date(d.departureDate);
      return depDate.getDate() === date.getDate() &&
             depDate.getMonth() === date.getMonth() &&
             depDate.getFullYear() === date.getFullYear();
    });
  };

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));

  // Round 72 follow-up: weekdays come from tArray() for both zh-TW and en.
  const weekDays = tArray('tourDetail.weekdays').length > 0 ? tArray('tourDetail.weekdays') : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  if (isLoading) {
    return (
      <div className="bg-[#FAF8F2] border border-foreground/10 p-8 text-center mb-8 rounded-xl">
        <p className="text-gray-500">{t('tourDetail.loading')}</p>
      </div>
    );
  }

  if (!departures || departures.length === 0) {
    return (
      <div className="bg-[#FAF8F2] border border-foreground/10 p-8 text-center mb-8 rounded-xl">
        <p className="text-sm text-gray-500 mb-2">{t('tourDetail.pricePerPerson')}</p>
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-5xl font-bold" style={{ color: themeColor.primary }}>
            {basePrice ? formatPrice(basePrice, "TWD") : t('tourDetail.inquirePrice')}
          </span>
          <span className="text-gray-500">{t('tourDetail.startingFrom')}</span>
        </div>
        <p className="text-gray-400 mt-4 text-sm">{t('tourDetail.contactForDeparture')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-8 border border-gray-100">
      <div
        className="flex items-center justify-between p-6"
        style={{ background: `linear-gradient(135deg, ${themeColor.primary} 0%, ${themeColor.secondary} 100%)` }}
      >
        <button onClick={prevMonth} aria-label={t('tourDetail.prevMonth')} className="p-3 bg-white/20 hover:bg-white/30 rounded-lg transition-all duration-200 backdrop-blur-sm">
          <ChevronLeft className="h-5 w-5 text-white" />
        </button>
        <div className="text-center">
          <h3 className="text-2xl font-bold text-white tracking-wide">
            {(t('tourDetail.yearMonthFormat')).replace('{year}', String(selectedMonth.getFullYear())).replace('{month}', String(selectedMonth.getMonth() + 1))}
          </h3>
          <p className="text-white/80 text-sm mt-1">{t('tourDetail.selectDepartureDate')}</p>
        </div>
        <button onClick={nextMonth} aria-label={t('tourDetail.nextMonth')} className="p-3 bg-white/20 hover:bg-white/30 rounded-lg transition-all duration-200 backdrop-blur-sm">
          <ChevronRight className="h-5 w-5 text-white" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-6 py-4 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-lg" style={{ backgroundColor: themeColor.secondary }} /><span className="text-sm text-gray-600">{t('tourDetail.available')}</span></div>
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-gray-300" /><span className="text-sm text-gray-600">{t('tourDetail.soldOut')}</span></div>
        <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-gray-100 border border-gray-200" /><span className="text-sm text-gray-600">{t('tourDetail.noDeparture')}</span></div>
      </div>

      <div className="grid grid-cols-7 bg-white">
        {weekDays.map((day, idx) => (
          <div key={day} className={`py-4 text-center text-sm font-semibold border-b border-gray-100 ${idx === 0 || idx === 6 ? 'text-foreground' : 'text-foreground/65'}`}>
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 bg-white">
        {calendarDays.map((date, idx) => {
          const departure = getDepartureForDay(date);
          const isSelected = departure && selectedDeparture === departure.id;
          const isPast = date && date < new Date(new Date().setHours(0, 0, 0, 0));
          const isFull = departure?.status === 'full';
          const isConfirmed = departure?.status === 'confirmed';

          return (
            <div
              key={idx}
              className={`
                min-h-[90px] p-3 border-b border-r border-gray-50 relative transition-all duration-200
                ${!date ? 'bg-gray-50/50' : 'bg-white'}
                ${isPast ? 'bg-gray-50/50 opacity-40' : ''}
                ${isFull && !isPast ? 'bg-gray-100 opacity-60' : ''}
                ${departure && !isPast && !isFull ? 'cursor-pointer hover:bg-gray-50 hover:shadow-inner' : ''}
                ${isSelected ? 'bg-[#c9a563]/10 shadow-inner' : ''}
              `}
              style={isSelected ? { outline: `3px solid ${themeColor.secondary}`, outlineOffset: '-3px', borderRadius: '8px' } : {}}
              onClick={() => { if (departure && !isPast && !isFull) setSelectedDeparture(departure.id); }}
            >
              {date && (
                <div className="flex flex-col h-full">
                  <span className={`text-base font-medium ${date.getDay() === 0 || date.getDay() === 6 ? 'text-foreground' : 'text-foreground/75'}`}>
                    {date.getDate()}
                  </span>

                  {departure && (
                    <div className="mt-auto">
                      {isFull ? (
                        <span className="text-xs text-gray-400 bg-gray-200 px-2 py-1 rounded-lg">{t('tourDetail.soldOut')}</span>
                      ) : (
                        <>
                          {isConfirmed && (
                            <span className="text-[9px] font-bold text-[#8a6f3a] bg-[#c9a563]/15 border border-[#c9a563]/35 px-1.5 py-0.5 rounded mb-0.5 inline-block">
                              ✓ {t('tourDetail.confirmed')}
                            </span>
                          )}
                          <div className="text-xs font-bold px-2 py-1 rounded-lg text-white shadow-sm" style={{ backgroundColor: themeColor.secondary }}>
                            ${(departure.adultPrice || basePrice).toLocaleString()}
                          </div>
                          {departure.status === 'open' && (
                            <p className="text-[10px] mt-1 font-medium text-foreground/55">{t('tourDetail.statusOpen')}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedDeparture && (
        <div className="p-6 border-t border-gray-200" style={{ backgroundColor: themeColor.light }}>
          {(() => {
            const dep = departures.find((d: any) => d.id === selectedDeparture);
            if (!dep) return null;
            const depDate = new Date(dep.departureDate);
            const retDate = new Date(dep.returnDate);

            return (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-sm text-gray-500 mb-1">{t('tourDetail.selectedDeparture')}</p>
                  <p className="text-xl font-bold" style={{ color: themeColor.primary }}>
                    {depDate.getFullYear()}/{depDate.getMonth() + 1}/{depDate.getDate()}
                    <span className="text-gray-400 mx-2">~</span>
                    {retDate.getFullYear()}/{retDate.getMonth() + 1}/{retDate.getDate()}
                  </p>
                  <p className="text-sm text-gray-500 mt-1 inline-flex items-center gap-2">
                    {dep.status === 'full' ? (
                      <span className="px-2 py-0.5 rounded-md bg-foreground/[0.04] text-foreground/55 text-xs font-medium">{t('tourDetail.soldOut')}</span>
                    ) : dep.status === 'confirmed' ? (
                      <span className="px-2 py-0.5 rounded-md bg-[#c9a563]/15 text-[#8a6f3a] text-xs font-semibold">✓ {t('tourDetail.confirmed')}</span>
                    ) : dep.status === 'cancelled' ? (
                      <span className="px-2 py-0.5 rounded-md bg-foreground/[0.04] text-foreground/55 line-through text-xs font-medium">{t('tourDetail.statusCancelled')}</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-foreground/[0.04] text-foreground/70 border border-foreground/15 text-xs font-medium">● {t('tourDetail.statusOpen')}</span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500 mb-1">{t('tourDetail.pricePerPerson')}</p>
                  <p className="text-3xl font-bold" style={{ color: themeColor.secondary }}>
                    {formatPrice(Number(dep.adultPrice || basePrice), (dep.currency as any) || "TWD")}
                  </p>
                  <div className="mt-2 text-left space-y-1">
                    <p className="text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{t('tourDetail.adultPrice')}：</span>
                      {formatPrice(Number(dep.adultPrice || basePrice), (dep.currency as any) || "TWD")}
                    </p>
                    {(dep.childPriceWithBed ?? 0) > 0 && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{t('tourDetail.childWithBed')}：</span>
                        {formatPrice(Number(dep.childPriceWithBed ?? 0), (dep.currency as any) || "TWD")}
                      </p>
                    )}
                    {(dep.childPriceNoBed ?? 0) > 0 && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{t('tourDetail.childNoBed')}：</span>
                        {formatPrice(Number(dep.childPriceNoBed ?? 0), (dep.currency as any) || "TWD")}
                      </p>
                    )}
                    {(dep.infantPrice ?? 0) > 0 && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{t('tourDetail.infantPrice')}：</span>
                        {formatPrice(Number(dep.infantPrice ?? 0), (dep.currency as any) || "TWD")}
                      </p>
                    )}
                  </div>
                  <Button onClick={() => onSelectDeparture(dep.id)} className="mt-3 px-6 py-2 text-white" style={{ backgroundColor: themeColor.secondary }}>
                    {t('tourDetail.selectDate')}
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
