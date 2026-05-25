/**
 * SupplierDetailSection — renders rich content from supplierProductDetails.
 *
 * M6 of supplier deep sync (2026-05-24). Reads tours.getSupplierDetail
 * and renders 4 collapsible sections:
 *   - 詳細行程 (itinerary days + hotels + meals)
 *   - 費用說明 (included / excluded / payment / cancellation)
 *   - 注意事項 (visa / insurance / baggage / general)
 *   - 自費項目 (optional add-ons with prices)
 *
 * Each section only renders if its parseStatus === 'parsed' AND parsed
 * data exists. parseFailed / missing sections are hidden — the existing
 * LLM-generated sections in TourDetailPeony stay as fallback.
 *
 * Per CLAUDE.md §2.1 rounded-xl + admin design system tokens.
 */

import { trpc } from "@/lib/trpc";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  MapPin,
  Hotel,
  Utensils,
  Plane,
  DollarSign,
  AlertCircle,
  Sparkles,
  FileText,
  Calendar,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

interface Props {
  tourId: number;
}

export default function SupplierDetailSection({ tourId }: Props) {
  const { t } = useLocale();
  const { data: detail, isLoading } = trpc.tours.getSupplierDetail.useQuery(
    { tourId },
    { enabled: !!tourId, staleTime: 5 * 60 * 1000 },
  );

  if (isLoading || !detail) return null;

  const hasItinerary =
    detail.itinerary.status === "parsed" &&
    detail.itinerary.parsed &&
    (detail.itinerary.parsed.days?.length ?? 0) > 0;
  const hasPriceTerms =
    detail.priceTerms.status === "parsed" &&
    detail.priceTerms.parsed &&
    (detail.priceTerms.parsed.included.length +
      detail.priceTerms.parsed.excluded.length +
      detail.priceTerms.parsed.cancellationPolicy.length >
      0);
  const hasNotices =
    detail.notices.status === "parsed" &&
    detail.notices.parsed &&
    (detail.notices.parsed.visa ||
      detail.notices.parsed.insurance ||
      detail.notices.parsed.baggage ||
      detail.notices.parsed.general);
  const hasOptional =
    detail.optional.status === "parsed" &&
    detail.optional.parsed &&
    (detail.optional.parsed.items?.length ?? 0) > 0;

  // If nothing parsed, render nothing (page falls back to existing sections)
  if (!hasItinerary && !hasPriceTerms && !hasNotices && !hasOptional) {
    return null;
  }

  return (
    <section className="my-8">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[#c9a563]" />
        <h2 className="text-lg font-semibold text-foreground">
          {t("tourDetail.supplierDetail.heading") || "供應商完整資訊"}
        </h2>
        <Badge variant="outline" className="rounded-md text-[10px] py-0 px-1.5 font-normal">
          {t("tourDetail.supplierDetail.fromSupplier") || "來自供應商"}
        </Badge>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {hasItinerary && (
          <AccordionItem
            value="itinerary"
            className="border rounded-xl bg-card px-4"
          >
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#c9a563]" />
                <span className="font-medium">
                  {t("tourDetail.supplierDetail.itinerary") || "詳細行程"}
                </span>
                <Badge variant="secondary" className="rounded-md text-xs">
                  {detail.itinerary.parsed!.totalDays}{" "}
                  {t("tourDetail.supplierDetail.days") || "天"}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <ItineraryView itinerary={detail.itinerary.parsed!} />
            </AccordionContent>
          </AccordionItem>
        )}

        {hasPriceTerms && (
          <AccordionItem
            value="priceTerms"
            className="border rounded-xl bg-card px-4"
          >
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-[#c9a563]" />
                <span className="font-medium">
                  {t("tourDetail.supplierDetail.priceTerms") || "費用說明"}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <PriceTermsView priceTerms={detail.priceTerms.parsed!} />
            </AccordionContent>
          </AccordionItem>
        )}

        {hasNotices && (
          <AccordionItem
            value="notices"
            className="border rounded-xl bg-card px-4"
          >
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#c9a563]" />
                <span className="font-medium">
                  {t("tourDetail.supplierDetail.notices") || "注意事項"}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <NoticesView notices={detail.notices.parsed!} />
            </AccordionContent>
          </AccordionItem>
        )}

        {hasOptional && (
          <AccordionItem
            value="optional"
            className="border rounded-xl bg-card px-4"
          >
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#c9a563]" />
                <span className="font-medium">
                  {t("tourDetail.supplierDetail.optional") || "自費項目"}
                </span>
                <Badge variant="secondary" className="rounded-md text-xs">
                  {detail.optional.parsed!.items.length}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <OptionalView optional={detail.optional.parsed!} />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {detail.lastEnrichedAt && (
        <p className="mt-2 text-xs text-muted-foreground text-right">
          {t("tourDetail.supplierDetail.lastUpdated") || "最後更新"}:{" "}
          {new Date(detail.lastEnrichedAt).toLocaleDateString()}
        </p>
      )}
    </section>
  );
}

function ItineraryView({
  itinerary,
}: {
  itinerary: NonNullable<NonNullable<unknown> & { days: any[]; totalDays: number }>;
}) {
  return (
    <div className="space-y-3 pb-3">
      {itinerary.days.map((day: any) => (
        <div
          key={day.dayNumber}
          className="rounded-lg border border-foreground/10 p-3 bg-background"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-[#c9a563]/10 text-[#c9a563] px-2.5 py-1 text-xs font-semibold tabular-nums">
              DAY {day.dayNumber}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm mb-2">{day.title}</div>
              {day.transportation && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Plane className="w-3 h-3" />
                  {day.transportation}
                </div>
              )}
              {day.attractions?.length > 0 && (
                <div className="mb-2 space-y-1">
                  {day.attractions.map((a: any, i: number) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs">
                      <MapPin className="w-3 h-3 mt-0.5 text-foreground/40" />
                      <span>{a.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {day.hotels?.length > 0 && (
                <div className="mb-2 space-y-1">
                  {day.hotels.map((h: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <Hotel className="w-3 h-3 text-foreground/40" />
                      <span className="font-medium">{h.name}</span>
                      {h.type && h.type !== "未指定" && (
                        <Badge variant="outline" className="rounded-md text-[10px] py-0 px-1.5">
                          {h.type}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {day.meals && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Utensils className="w-3 h-3" />
                  <span>
                    {mealLabel("早", day.meals.breakfast)} ·{" "}
                    {mealLabel("午", day.meals.lunch)} ·{" "}
                    {mealLabel("晚", day.meals.dinner)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function mealLabel(prefix: string, val: boolean | string): string {
  if (val === false) return `${prefix}: -`;
  if (val === true) return `${prefix}: ✓`;
  return `${prefix}: ${val}`;
}

function PriceTermsView({
  priceTerms,
}: {
  priceTerms: NonNullable<NonNullable<unknown> & { included: string[]; excluded: string[]; paymentTerms: string; cancellationPolicy: any[] }>;
}) {
  return (
    <div className="space-y-3 pb-3 text-sm">
      {priceTerms.included.length > 0 && (
        <div>
          <div className="font-medium text-xs text-emerald-700 mb-1.5">✓ {"包含"}</div>
          <ul className="space-y-0.5 text-xs">
            {priceTerms.included.map((x: string, i: number) => (
              <li key={i} className="text-foreground/80">• {x}</li>
            ))}
          </ul>
        </div>
      )}
      {priceTerms.excluded.length > 0 && (
        <div>
          <div className="font-medium text-xs text-rose-700 mb-1.5">✗ {"不含"}</div>
          <ul className="space-y-0.5 text-xs">
            {priceTerms.excluded.map((x: string, i: number) => (
              <li key={i} className="text-foreground/80">• {x}</li>
            ))}
          </ul>
        </div>
      )}
      {priceTerms.paymentTerms && (
        <div>
          <div className="font-medium text-xs text-foreground/70 mb-1.5">付款條件</div>
          <p className="text-xs text-foreground/80">{priceTerms.paymentTerms}</p>
        </div>
      )}
      {priceTerms.cancellationPolicy.length > 0 && (
        <div>
          <div className="font-medium text-xs text-foreground/70 mb-1.5">退費政策</div>
          <ul className="space-y-0.5 text-xs">
            {priceTerms.cancellationPolicy.map((p: any, i: number) => (
              <li key={i} className="text-foreground/80">
                出發前 {p.daysBeforeDeparture} 天:退款 {p.refundPercent}%
                {p.note && <span className="text-muted-foreground"> ({p.note})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NoticesView({
  notices,
}: {
  notices: NonNullable<NonNullable<unknown> & { visa: string; insurance: string; baggage: string; general: string }>;
}) {
  return (
    <div className="space-y-3 pb-3 text-sm">
      {notices.visa && <NoticeBlock label="簽證" content={notices.visa} />}
      {notices.insurance && <NoticeBlock label="保險" content={notices.insurance} />}
      {notices.baggage && <NoticeBlock label="行李" content={notices.baggage} />}
      {notices.general && <NoticeBlock label="其他" content={notices.general} />}
    </div>
  );
}

function NoticeBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <div className="font-medium text-xs text-foreground/70 mb-1.5">{label}</div>
      <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {content}
      </p>
    </div>
  );
}

function OptionalView({
  optional,
}: {
  optional: NonNullable<NonNullable<unknown> & { items: any[] }>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pb-3">
      {optional.items.map((item: any, i: number) => (
        <div
          key={i}
          className="rounded-lg border border-foreground/10 bg-background p-3"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="font-medium text-sm">{item.name}</span>
            {item.price > 0 && (
              <Badge variant="outline" className="rounded-md text-xs whitespace-nowrap">
                {item.currency} {item.price.toLocaleString()}
              </Badge>
            )}
          </div>
          {item.description && (
            <p className="text-xs text-muted-foreground">{item.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}
