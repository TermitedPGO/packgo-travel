/**
 * WorkspaceTours — 批7 行程庫 (m1 list, m2 detail switch).
 *
 * 6th sub-tab of WorkspaceCompany. Mockup 後台_09: library rows → click →
 * single-tour full view (TourDetail). pending_review rows pin top under
 * the default sort (calibration-review absorbed in 批7 m4).
 */
import { useMemo, useState, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Star } from "lucide-react";
import { Badge, BadgeK, BtnO } from "./ws-ui";
import {
  type WsTourFilter,
  type WsTourSort,
  filterSortTours,
  filterCounts,
  pageSlice,
} from "./workspaceTours.helpers";

const TourDetail = lazy(() => import("./TourDetail"));

const PER_PAGE = 25;

export default function WorkspaceTours() {
  const { t } = useLocale();
  const [filter, setFilter] = useState<WsTourFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<WsTourSort>("default");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const toursQ = trpc.tours.list.useQuery({ pageSize: 1000 });

  const all = toursQ.data ?? [];
  const counts = useMemo(() => filterCounts(all), [all]);
  const filtered = useMemo(
    () => filterSortTours(all, filter, search, sort),
    [all, filter, search, sort],
  );
  const paged = pageSlice(filtered, page, PER_PAGE);

  if (selectedId != null) {
    return (
      <Suspense
        fallback={
          <p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>
        }
      >
        <TourDetail tourId={selectedId} onBack={() => setSelectedId(null)} />
      </Suspense>
    );
  }

  const FILTERS: { id: WsTourFilter; label: string }[] = [
    { id: "all", label: t("workspace.trsAll") },
    { id: "active", label: t("workspace.trsActive") },
    { id: "unlisted", label: t("workspace.trsUnlisted") },
    { id: "pending_review", label: t("workspace.trsPending") },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFilter(f.id);
                setPage(1);
              }}
              className={`h-8 px-3 rounded-lg text-xs font-medium ${
                filter === f.id
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50 border border-gray-200"
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-60">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("workspace.trsSearch")}
            className="px-2.5 py-2 rounded-lg border border-gray-300 text-base sm:text-xs min-w-0 sm:col-span-2"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as WsTourSort)}
            className="px-2.5 py-2 rounded-lg border border-gray-300 text-base sm:text-xs min-w-0"
          >
            <option value="default">{t("workspace.trsSortDefault")}</option>
            <option value="newest">{t("workspace.trsSortNewest")}</option>
            <option value="price-asc">{t("workspace.trsSortPriceAsc")}</option>
            <option value="price-desc">{t("workspace.trsSortPriceDesc")}</option>
          </select>
        </div>
      </div>

      {toursQ.isLoading && (
        <p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {paged.rows.map((tour) => (
          <TourRow
            key={tour.id}
            tour={tour}
            onOpen={() => setSelectedId(tour.id)}
          />
        ))}
        {!toursQ.isLoading && paged.rows.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">
            {t("workspace.trsEmpty")}
          </p>
        )}
      </div>

      {paged.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <BtnO onClick={() => setPage((p) => p - 1)} disabled={paged.page <= 1}>
            {t("workspace.supCatPrev")}
          </BtnO>
          <span className="text-[11px] text-gray-500">
            {paged.page} / {paged.totalPages}
          </span>
          <BtnO
            onClick={() => setPage((p) => p + 1)}
            disabled={paged.page >= paged.totalPages}
          >
            {t("workspace.supCatNext")}
          </BtnO>
        </div>
      )}
    </div>
  );
}

function TourRow({
  tour,
  onOpen,
}: {
  tour: {
    id: number;
    title: string;
    imageUrl?: string | null;
    duration: number;
    price: number;
    priceCurrency?: string | null;
    status: string;
    featured: number | null;
    destinationCountry?: string | null;
    calibrationScore?: number | null;
  };
  onOpen: () => void;
}) {
  const { t } = useLocale();
  const pending = tour.status === "pending_review";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 min-w-0 min-h-[44px] ${
        pending ? "border-l-4 border-l-black" : ""
      }`}
    >
      {tour.imageUrl ? (
        <img
          src={tour.imageUrl}
          alt=""
          className="w-12 h-9 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-9 rounded-lg bg-gray-100 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12.5px] font-medium truncate">
            {tour.title}
          </span>
          {tour.featured === 1 && (
            <Star className="w-3 h-3 flex-shrink-0 fill-black" />
          )}
        </div>
        <div className="text-[11px] text-gray-400 flex items-center gap-1.5 flex-wrap">
          {pending ? (
            <BadgeK>{t(`workspace.trsSt_${tour.status}`)}</BadgeK>
          ) : (
            <Badge>{t(`workspace.trsSt_${tour.status}`)}</Badge>
          )}
          {tour.destinationCountry && (
            <span className="truncate">{tour.destinationCountry}</span>
          )}
          <span>{t("workspace.supCatDays", { n: tour.duration })}</span>
          <span className="font-medium text-gray-600">
            {tour.priceCurrency ?? ""} {Number(tour.price).toLocaleString()}
          </span>
          {tour.calibrationScore != null && (
            <span>
              {t("workspace.trsCalib")} {tour.calibrationScore}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
