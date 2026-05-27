/**
 * NewsletterTabV2 — Newsletter subscriber management for admin v2 panel.
 *
 * Same visual pattern as ReviewsTabV2 / CustomersTabV2:
 *   - StatusToggle pill chips with live count per status (All / Active / Unsubscribed)
 *   - DataTable 36px rows + StatusDot
 *   - Search box for email filtering
 *   - Export CSV + Refresh actions
 *
 * Backend wire: trpc.newsletter.listSubscribers + exportSubscribers.
 * 2026-05-27.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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
import {
  Download,
  Mail,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

type SubscriberStatus = "active" | "unsubscribed";
type StatusFilter = SubscriberStatus | "all";

type SubscriberRow = {
  id: number;
  email: string;
  status: SubscriberStatus;
  subscribedAt: string | Date;
  unsubscribedAt?: string | Date | null;
};

const STATUS_TONE: Record<SubscriberStatus, StatusTone> = {
  active: "success",
  unsubscribed: "muted",
};

// ── StatusToggle (same chip pattern as ReviewsTabV2) ──────────────────

function StatusToggle({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: StatusTone;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`h-7 px-2.5 rounded-md text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
      }`}
    >
      {tone && !active && <StatusDot tone={tone} size="xs" />}
      <span>{label}</span>
      <span className={`tabular-nums ${active ? "text-white/70" : "text-gray-400"}`}>
        {count}
      </span>
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export default function NewsletterTabV2() {
  const { t, language } = useLocale();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, refetch } = trpc.newsletter.listSubscribers.useQuery({
    status: "all",
    limit: 500,
    offset: 0,
  });
  const rawSubscribers = (data?.subscribers ?? []) as SubscriberRow[];

  const exportMutation = trpc.newsletter.exportSubscribers.useQuery(undefined, {
    enabled: false,
  });

  // ── Derived data ──

  const counts = useMemo(() => {
    return {
      all: rawSubscribers.length,
      active: rawSubscribers.filter((s) => s.status === "active").length,
      unsubscribed: rawSubscribers.filter((s) => s.status === "unsubscribed").length,
    };
  }, [rawSubscribers]);

  const filtered = useMemo(() => {
    let out = rawSubscribers;
    if (statusFilter !== "all") {
      out = out.filter((s) => s.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter((s) => s.email.toLowerCase().includes(q));
    }
    return out;
  }, [rawSubscribers, statusFilter, searchQuery]);

  // ── Export handler ──

  const handleExport = async () => {
    try {
      const result = await exportMutation.refetch();
      if (result.data?.csv) {
        const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(
          t("admin.newsletter.toastExported", { n: String(result.data.count) })
        );
      }
    } catch {
      toast.error(t("admin.newsletter.toastExportFailed"));
    }
  };

  // ── Table columns ──

  const dateLocale = language === "en" ? "en-US" : "zh-TW";
  const formatDate = (d: string | Date | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleString(dateLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const columns: Column<SubscriberRow>[] = [
    {
      key: "email",
      header: t("admin.newsletter.columnEmail"),
      render: (r) => (
        <span className="text-gray-900 font-medium truncate">{r.email}</span>
      ),
      sortable: true,
      sortValue: (r) => r.email,
    },
    {
      key: "status",
      header: t("admin.newsletter.columnStatus"),
      width: "w-28",
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <StatusDot
          tone={STATUS_TONE[r.status]}
          label={
            r.status === "active"
              ? t("admin.newsletter.statusActive")
              : t("admin.newsletter.statusUnsubscribed")
          }
        />
      ),
    },
    {
      key: "subscribedAt",
      header: t("admin.newsletter.columnSubscribedAt"),
      width: "w-36",
      sortable: true,
      sortValue: (r) => new Date(r.subscribedAt).getTime(),
      render: (r) => (
        <span className="text-xs text-gray-500 tabular-nums">
          {formatDate(r.subscribedAt)}
        </span>
      ),
    },
    {
      key: "unsubscribedAt",
      header: t("admin.newsletter.columnUnsubscribedAt"),
      width: "w-36",
      sortable: true,
      sortValue: (r) => (r.unsubscribedAt ? new Date(r.unsubscribedAt).getTime() : 0),
      render: (r) => (
        <span className="text-xs text-gray-500 tabular-nums">
          {formatDate(r.unsubscribedAt)}
        </span>
      ),
    },
  ];

  // ── Render ──

  return (
    <div className="space-y-3">
      {/* Toolbar: filter pills + search + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusToggle
            label={t("admin.newsletter.statusAll")}
            count={counts.all}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <StatusToggle
            label={t("admin.newsletter.statusActive")}
            count={counts.active}
            active={statusFilter === "active"}
            tone="success"
            onClick={() => setStatusFilter("active")}
          />
          <StatusToggle
            label={t("admin.newsletter.statusUnsubscribed")}
            count={counts.unsubscribed}
            active={statusFilter === "unsubscribed"}
            tone="muted"
            onClick={() => setStatusFilter("unsubscribed")}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("admin.newsletter.searchPlaceholder")}
              className="h-8 rounded-lg pl-8 text-xs w-56"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label={t("common.clear")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="h-8 rounded-lg gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            {t("admin.newsletter.exportCsv")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-8 rounded-lg gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Table or empty state */}
      {!isLoading && filtered.length === 0 ? (
        <EmptyState
          icon={<Mail className="h-8 w-8" />}
          title={t("admin.newsletter.emptyTitle")}
          description={t("admin.newsletter.emptyDesc")}
        />
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          loading={isLoading}
        />
      )}
    </div>
  );
}
