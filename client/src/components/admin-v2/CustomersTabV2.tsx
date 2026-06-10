/**
 * CustomersTabV2 — Customer CRM page for admin panel.
 *
 * Same visual pattern as BookingsTabV2 / ReviewsTabV2:
 *   - Tier filter pills (All / Free / Plus / Concierge)
 *   - DataTable with StatusDot + detail Sheet on row click
 *   - Search by name / email / phone
 *
 * Backend: trpc.admin.customerList + customerDetail
 * 2026-05-27
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DataTable,
  StatusDot,
  EmptyState,
  type Column,
  type StatusTone,
} from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CustomerDetailSheet from "./CustomerDetailSheet";
import { RefreshCw, Search, Users, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";

// ── Types ──────────────────────────────────────────────────────────────

type TierFilter = "all" | "free" | "plus" | "concierge";

type CustomerRow = {
  id: number;
  name: string | null;
  email: string;
  phone: string | null;
  avatar: string | null;
  tier: "free" | "plus" | "concierge";
  role: string;
  packpointBalance: number;
  bookingCount: number;
  inquiryCount: number;
  totalSpend: number;
  createdAt: string | Date;
  lastSignedIn: string | Date;
};

const TIER_TONE: Record<string, StatusTone> = {
  free: "muted",
  plus: "info",
  concierge: "success",
};

// ── Main Component ─────────────────────────────────────────────────────

export default function CustomersTabV2() {
  const { t, language } = useLocale();
  const dateFnsLocale = language === "en" ? enUS : zhTW;

  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const list = trpc.admin.customerList.useQuery();

  // ── Derived data ──

  const tierCounts = useMemo(() => {
    const rows = (list.data ?? []) as CustomerRow[];
    return {
      all: rows.length,
      free: rows.filter((r) => r.tier === "free").length,
      plus: rows.filter((r) => r.tier === "plus").length,
      concierge: rows.filter((r) => r.tier === "concierge").length,
    };
  }, [list.data]);

  const filtered = useMemo(() => {
    let rows = (list.data ?? []) as CustomerRow[];
    if (tierFilter !== "all") rows = rows.filter((r) => r.tier === tierFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.name ?? "").toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q)
      );
    }
    return rows;
  }, [list.data, tierFilter, search]);

  // ── Table columns ──

  const columns: Column<CustomerRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("admin.customersCrm.colName"),
        render: (r: CustomerRow) => (
          <div className="min-w-0">
            <div className="font-medium truncate">
              {r.name || t("admin.customersCrm.unnamed")}
            </div>
            <div className="text-xs text-foreground/50 truncate">{r.email}</div>
          </div>
        ),
      },
      {
        key: "phone",
        header: t("admin.customersCrm.colPhone"),
        render: (r: CustomerRow) => (
          <span className="text-sm tabular-nums">{r.phone || "—"}</span>
        ),
      },
      {
        key: "tier",
        header: t("admin.customersCrm.colTier"),
        render: (r: CustomerRow) => (
          <StatusDot tone={TIER_TONE[r.tier] ?? "muted"} label={tierLabel(r.tier, t)} />
        ),
      },
      {
        key: "bookingCount",
        header: t("admin.customersCrm.colBookings"),
        render: (r: CustomerRow) => (
          <span className="tabular-nums">{r.bookingCount}</span>
        ),
        sortable: true,
        sortValue: (r: CustomerRow) => r.bookingCount,
      },
      {
        key: "totalSpend",
        header: t("admin.customersCrm.colSpend"),
        render: (r: CustomerRow) => (
          <span className="tabular-nums font-medium">
            ${Number(r.totalSpend).toLocaleString()}
          </span>
        ),
        sortable: true,
        sortValue: (r: CustomerRow) => Number(r.totalSpend),
      },
      {
        key: "packpointBalance",
        header: "PP",
        render: (r: CustomerRow) => (
          <span className="tabular-nums">{r.packpointBalance.toLocaleString()}</span>
        ),
        sortable: true,
        sortValue: (r: CustomerRow) => r.packpointBalance,
      },
      {
        key: "lastSignedIn",
        header: t("admin.customersCrm.colLastActive"),
        render: (r: CustomerRow) => (
          <span className="text-xs text-foreground/50 tabular-nums">
            {formatDistanceToNow(new Date(r.lastSignedIn), {
              addSuffix: true,
              locale: dateFnsLocale,
            })}
          </span>
        ),
        sortable: true,
        sortValue: (r: CustomerRow) => new Date(r.lastSignedIn).getTime(),
      },
    ],
    [t, dateFnsLocale]
  );

  // ── Render ──

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("admin.customersCrm.title")}
        </h1>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg gap-1.5"
          onClick={() => list.refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("admin.customersCrm.refresh")}
        </Button>
      </div>

      {/* Tier filter pills + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {(["all", "free", "plus", "concierge"] as TierFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setTierFilter(f)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                tierFilter === f
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground/60 hover:text-foreground"
              }`}
            >
              {tierLabel(f === "all" ? "all" : f, t)}{" "}
              <span className="tabular-nums opacity-60">
                {tierCounts[f]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.customersCrm.searchPlaceholder")}
            className="pl-9 h-8 rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Table */}
      {list.isLoading ? (
        <div className="text-center py-16 text-foreground/40">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
          {t("admin.customersCrm.loading")}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={t("admin.customersCrm.emptyTitle")}
          description={t("admin.customersCrm.emptyDesc")}
        />
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          onRowClick={(row) => setSelectedId(row.id)}
          selectedId={selectedId ?? undefined}
        />
      )}

      {/* Detail Sheet */}
      <CustomerDetailSheet
        userId={selectedId}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function tierLabel(tier: string, t: (k: string) => string): string {
  switch (tier) {
    case "all":
      return t("admin.customersCrm.filterAll");
    case "free":
      return "Free";
    case "plus":
      return "Plus";
    case "concierge":
      return "Concierge";
    default:
      return tier;
  }
}
