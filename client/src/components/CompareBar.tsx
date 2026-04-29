/**
 * CompareBar — v78j Sprint 3: floating bar that lets users build a 2-3 tour
 * comparison set and view them side-by-side in a modal.
 *
 * State persists in localStorage so users can browse multiple pages and
 * accumulate tours to compare.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, GitCompare, Plus } from "lucide-react";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";

const STORAGE_KEY = "packgo:compareTourIds";
const STAMP_KEY = "packgo:compareTourIdsStamp";
const MAX_COMPARE = 3;
const STALE_MS = 24 * 60 * 60 * 1000; // v78z-z2: auto-clear after 24h inactivity

// Module-level event listeners so any component can update
type Listener = (ids: number[]) => void;
const listeners: Set<Listener> = new Set();

function readIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    // v78z-z2: drop stale entries (>24h since last write)
    const stamp = Number(localStorage.getItem(STAMP_KEY) || 0);
    if (stamp && Date.now() - stamp > STALE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STAMP_KEY);
      return [];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function writeIds(ids: number[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    localStorage.setItem(STAMP_KEY, String(Date.now()));
  } catch {}
  listeners.forEach((fn) => fn(ids));
}

// Public API used by tour cards / detail page
export function addToCompare(tourId: number): boolean {
  const ids = readIds();
  if (ids.includes(tourId)) return false;
  if (ids.length >= MAX_COMPARE) return false;
  writeIds([...ids, tourId]);
  return true;
}

export function removeFromCompare(tourId: number) {
  writeIds(readIds().filter((id) => id !== tourId));
}

export function isInCompare(tourId: number): boolean {
  return readIds().includes(tourId);
}

export function useCompareIds(): number[] {
  const [ids, setIds] = useState<number[]>(() => readIds());
  useEffect(() => {
    const fn: Listener = (next) => setIds(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return ids;
}

export default function CompareBar() {
  const { language, formatPrice, t: tr } = useLocale();
  const isEN = language === "en";
  const ids = useCompareIds();
  const [open, setOpen] = useState(false);

  // Fetch the tours selected for compare
  const { data: tours } = trpc.tours.list.useQuery(undefined, {
    enabled: ids.length >= 2,
  });

  // v78z-z2 Sprint 8: only show when user has 2+ tours to actually compare.
  // 1 tour means user is mid-selection — bar is noise.
  if (ids.length < 2) return null;

  const compared = (tours || []).filter((t: any) => ids.includes(t.id));

  // v78o: 用 LocaleContext 的 formatPrice — 自動依使用者選的幣別轉換 + 格式化
  const fmtPrice = (price: number, currency: string) => {
    if (!price) return "—";
    const cur = (currency || "TWD").toUpperCase();
    return formatPrice(price, cur === "USD" ? "USD" : "TWD");
  };

  return (
    <>
      {/* Sticky bottom-left compare bar (above admin button if any) */}
      <div className="fixed bottom-20 md:bottom-6 left-4 z-30 bg-black text-white rounded-full shadow-2xl flex items-center gap-2 pl-4 pr-2 py-2">
        <GitCompare className="h-4 w-4" />
        <span className="text-sm font-medium hidden sm:inline">
          {tr("compareBar.label")}
        </span>
        <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-white text-black text-xs font-bold">
          {ids.length}
        </span>
        <Button
          size="sm"
          className="ml-1 h-7 px-3 text-xs rounded-lg bg-white text-black hover:bg-gray-200"
          onClick={() => setOpen(true)}
        >
          {tr("compareBar.view")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {tr("compareBar.title")}
            </DialogTitle>
          </DialogHeader>

          {compared.length === 0 ? (
            <p className="text-gray-500 py-8 text-center">
              {tr("compareBar.noToursSelected")}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4">
              <table className="w-full min-w-[640px] border-separate border-spacing-x-3 px-4">
                <thead>
                  <tr>
                    <th className="text-left text-xs uppercase tracking-wide text-gray-400 font-medium pb-2"></th>
                    {compared.map((t: any) => (
                      <th key={t.id} className="text-left pb-3 align-bottom min-w-[200px]">
                        <div className="relative bg-gray-50 rounded-xl p-3">
                          <button
                            onClick={() => removeFromCompare(t.id)}
                            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white shadow flex items-center justify-center hover:bg-gray-100"
                            aria-label={tr("compareBar.removeAria")}
                          >
                            <X className="h-3 w-3" />
                          </button>
                          {(t.imageUrl || t.heroImage) && (
                            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-gray-200 mb-2">
                              <img
                                src={t.imageUrl || t.heroImage}
                                alt={t.title}
                                className="w-full h-full object-cover rounded-xl"
                              />
                            </div>
                          )}
                          <h4 className="text-sm font-bold text-gray-900 line-clamp-2 mb-2 leading-snug">
                            {(t.title || "").split(/[|｜]/)[0].trim()}
                          </h4>
                          <Link href={`/tours/${t.id}`}>
                            <Button size="sm" className="w-full rounded-lg text-xs h-8" onClick={() => setOpen(false)}>
                              {tr("compareBar.viewTour")}
                            </Button>
                          </Link>
                        </div>
                      </th>
                    ))}
                    {/* Empty placeholders for missing slots */}
                    {Array.from({ length: MAX_COMPARE - compared.length }).map((_, i) => (
                      <th key={`empty-${i}`} className="text-left pb-3 align-bottom min-w-[200px]">
                        <Link href="/tours">
                          <div className="aspect-[4/3] rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors cursor-pointer">
                            <div className="text-center">
                              <Plus className="h-6 w-6 mx-auto mb-1" />
                              <p className="text-xs">{tr("compareBar.addTour")}</p>
                            </div>
                          </div>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <Row label={tr("compareBar.destination")} values={compared.map((t: any) => t.destinationCountry || "—")} />
                  <Row label={tr("compareBar.city")} values={compared.map((t: any) => t.destinationCity || "—")} />
                  <Row label={tr("compareBar.duration")} values={compared.map((t: any) => `${t.duration || "?"}${tr("compareBar.daySuffix")}${t.nights ? `${t.nights}${tr("compareBar.nightSuffix")}` : ""}`)} />
                  <Row label={tr("compareBar.startingPrice")} values={compared.map((t: any) => fmtPrice(t.price || 0, t.priceCurrency || "USD"))} bold />
                  <Row label={tr("compareBar.category")} values={compared.map((t: any) => (t.category === "group" ? tr("compareBar.catGroup") : t.category === "cruise" ? tr("compareBar.catCruise") : t.category === "custom" ? tr("compareBar.catCustom") : t.category || "—"))} />
                  <Row label={tr("compareBar.rating")} values={compared.map((t: any) => (t.rating > 0 ? `${t.rating.toFixed(1)} / 5` : tr("compareBar.ratingNew")))} />
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-between items-center pt-3 border-t border-gray-100">
            <button
              onClick={() => writeIds([])}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              {tr("compareBar.clearAll")}
            </button>
            <Button onClick={() => setOpen(false)} variant="outline" className="rounded-lg">
              {tr("common.close")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, values, bold = false }: { label: string; values: string[]; bold?: boolean }) {
  return (
    <tr>
      <td className="py-2 align-top text-xs uppercase tracking-wide text-gray-500 font-medium pr-2 whitespace-nowrap">
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={`py-2 align-top ${bold ? "font-bold text-gray-900" : "text-gray-700"}`}
        >
          {v}
        </td>
      ))}
    </tr>
  );
}
