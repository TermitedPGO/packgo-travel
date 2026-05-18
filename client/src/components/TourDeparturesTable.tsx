/**
 * TourDeparturesTable — v78m Sprint 5B: clean upcoming-departures table
 * for tour detail pages. Shows year, date, status, price (if differs from
 * base), and a CTA per row.
 *
 * Why: signettours / 雄獅 both have a discrete「日期/團費」section showing all
 * future departures. Customers compare across dates without scrolling the
 * whole calendar UI.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Calendar, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { format } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";

interface Props {
  tourId: number;
  basePrice: number;
  baseCurrency?: string;
  themeColor?: { primary: string; secondary?: string };
}

export default function TourDeparturesTable({
  tourId,
  basePrice,
  baseCurrency = "TWD",
  themeColor,
}: Props) {
  const { language, formatPrice, t } = useLocale();
  const isEN = language === "en";
  const dateLocale = isEN ? enUS : zhTW;

  const { data: departures, isLoading } = trpc.departures.list.useQuery({ tourId });

  const upcoming = useMemo(() => {
    if (!Array.isArray(departures)) return [];
    const now = new Date();
    return (departures as any[])
      .filter((d) => {
        const dep = new Date(d.departureDate);
        return dep >= now && d.status !== "cancelled";
      })
      .sort(
        (a, b) =>
          new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime()
      )
      .slice(0, 12); // show up to 12 upcoming
  }, [departures]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 my-8">
        <p className="text-sm text-gray-400">{t("tourDeparturesTable.loadingDates")}</p>
      </div>
    );
  }

  if (upcoming.length === 0) {
    return null; // Hide section if no upcoming departures
  }

  // v78o: 改用 LocaleContext 的 formatPrice — 自動依使用者選的幣別轉換 + 格式化
  const fmtPrice = (price: number | string | null, currency: string) => {
    const n = typeof price === "string" ? parseFloat(price) : price;
    if (!n) return null;
    const cur = (currency || "TWD").toUpperCase();
    return formatPrice(n, cur === "USD" ? "USD" : "TWD");
  };

  const statusConfig: Record<string, { label: string; className: string }> = {
    open: {
      label: t("tourDeparturesTable.statusAvailable"),
      className: "bg-[#c9a563]/10 text-[#8a6f3a] border-[#c9a563]/35",
    },
    confirmed: {
      label: t("tourDeparturesTable.statusConfirmed"),
      className: "bg-foreground/[0.04] text-foreground/70 border-foreground/15",
    },
    full: {
      label: t("tourDeparturesTable.statusSoldOut"),
      className: "bg-gray-100 text-gray-500 border-gray-200",
    },
    waitlist: {
      label: t("tourDeparturesTable.statusWaitlist"),
      className: "bg-amber-50 text-amber-700 border-amber-200",
    },
  };

  return (
    <section className="py-12 lg:py-16 bg-gray-50">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-8">
          <h2
            className="text-3xl md:text-4xl font-bold mb-3"
            style={{ color: themeColor?.primary || "#0d9488" }}
          >
            {t("tourDeparturesTable.sectionTitle")}
          </h2>
          <p className="text-gray-600">
            {t("tourDeparturesTable.subtitle")}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("tourDeparturesTable.dateLabel")}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("tourDeparturesTable.returnLabel")}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("tourDeparturesTable.statusLabel")}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("tourDeparturesTable.seatsLabel")}
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("tourDeparturesTable.priceLabel")}
                  </th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {upcoming.map((dep) => {
                  const depDate = new Date(dep.departureDate);
                  const retDate = dep.returnDate ? new Date(dep.returnDate) : null;
                  const status = statusConfig[dep.status] || statusConfig.open;
                  const isFull = dep.status === "full" || dep.status === "cancelled";
                  const adultPrice =
                    dep.adultPrice && dep.adultPrice !== "0"
                      ? Number(dep.adultPrice)
                      : basePrice;
                  const currency = dep.currency || baseCurrency;
                  // Round 79: schema fields are totalSlots/bookedSlots (NOT
                  // maxParticipants/currentParticipants — that bug shipped from a copy-paste
                  // from the tour entity, which uses different naming).
                  const totalSlots = Number((dep as any).totalSlots ?? (dep as any).maxParticipants ?? 0);
                  const bookedSlots = Number((dep as any).bookedSlots ?? (dep as any).currentParticipants ?? 0);
                  const seatsLeft = totalSlots > 0 ? totalSlots - bookedSlots : null;
                  const isConfirmed = dep.status === "confirmed";

                  return (
                    <tr key={dep.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-gray-400" />
                          {format(depDate, "yyyy/MM/dd", { locale: dateLocale })}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {format(depDate, "EEEE", { locale: dateLocale })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {retDate ? (
                          <div className="text-sm text-gray-700">
                            {format(retDate, "yyyy/MM/dd", { locale: dateLocale })}
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${status.className}`}
                        >
                          {status.label}
                        </span>
                        {isConfirmed && (
                          <div className="mt-1 text-xs text-primary flex items-center gap-1 font-medium">
                            ✓ {t("tourDeparturesTable.groupConfirmed")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {totalSlots > 0 ? (
                          <div className="text-sm">
                            <div className="font-semibold text-foreground">
                              {bookedSlots} / {totalSlots}
                            </div>
                            {seatsLeft !== null && seatsLeft > 0 && seatsLeft <= 3 && !isFull && (
                              <div className="mt-0.5 text-xs text-amber-600 flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {t("tourDeparturesTable.seatsLeft", { n: seatsLeft, s: seatsLeft > 1 ? "s" : "" })}
                              </div>
                            )}
                            {seatsLeft !== null && seatsLeft > 3 && !isFull && (
                              <div className="mt-0.5 text-xs text-foreground/55">
                                {t("tourDeparturesTable.seatsAvailable", { n: seatsLeft })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-foreground/30 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-sm font-bold text-gray-900">
                          {fmtPrice(adultPrice, currency)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isFull ? (
                          <Button variant="outline" size="sm" disabled className="rounded-lg">
                            {t("tourDeparturesTable.soldOutCta")}
                          </Button>
                        ) : (
                          <Link href={`/book/${tourId}?departureId=${dep.id}`}>
                            <Button
                              size="sm"
                              className="rounded-lg text-white"
                              style={{ backgroundColor: themeColor?.primary || "#0d9488" }}
                            >
                              {t("tourDeparturesTable.bookCta")}
                            </Button>
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          {t("tourDeparturesTable.finalPriceNote")}
        </p>
      </div>
    </section>
  );
}
