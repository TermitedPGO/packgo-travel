/**
 * InquiriesTabV2 — Trip.com-style customer inquiry admin (Round 81 v2).
 *
 * Same visual pattern as BookingsTabV2:
 *   - StatusToggle pill chips with live count per status
 *   - DataTable 36px rows + StatusDot + DetailDrawer
 *   - Search box for ID / customer / subject
 *
 * Backend wire: trpc.inquiries.list, getById, update — no migration.
 *
 * Phase C tab #2 (Bookings was #1). Establishes the reusable pattern;
 * tabs #3+ should be progressively faster to redesign.
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MessageSquare, RefreshCw, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type InquiryStatus = "new" | "in_progress" | "replied" | "resolved" | "closed";

type InquiryRow = {
  id: number;
  status: InquiryStatus;
  inquiryType?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  subject?: string | null;
  message?: string | null;
  createdAt?: string | Date | null;
};

const STATUS_TONE: Record<InquiryStatus, StatusTone> = {
  new: "warn",
  in_progress: "info",
  replied: "info",
  resolved: "success",
  closed: "muted",
};

function statusLabel(s: InquiryStatus, t: (key: string) => string): string {
  switch (s) {
    case "new": return t("admin.inquiriesTab.statusNew");
    case "in_progress": return t("admin.inquiriesTab.statusInProgress");
    case "replied": return t("admin.inquiriesTab.statusReplied");
    case "resolved": return t("admin.inquiriesTab.statusResolved");
    case "closed": return t("admin.inquiriesTab.statusClosed");
  }
}

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

export default function InquiriesTabV2() {
  const { t, language } = useLocale();
  const [statusFilter, setStatusFilter] = useState<"all" | InquiryStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data: rawInquiries = [], isLoading, refetch } =
    trpc.inquiries.list.useQuery();
  const { data: detail } = trpc.inquiries.getById.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId },
  );

  const updateStatus = trpc.inquiries.update.useMutation({
    onSuccess: () => {
      utils.inquiries.list.invalidate();
      utils.inquiries.getById.invalidate();
      toast.success(t("admin.inquiriesTab.toastStatusUpdated"));
    },
    onError: (e) =>
      toast.error(t("admin.inquiriesTab.toastUpdateFailed", { err: e.message })),
  });

  const filtered = useMemo(() => {
    const list = rawInquiries as InquiryRow[];
    let out = statusFilter === "all" ? list : list.filter((r) => r.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter((r) =>
        String(r.id).includes(q) ||
        (r.customerName ?? "").toLowerCase().includes(q) ||
        (r.customerEmail ?? "").toLowerCase().includes(q) ||
        (r.subject ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [rawInquiries, statusFilter, searchQuery]);

  const counts = useMemo(() => {
    const list = rawInquiries as InquiryRow[];
    return {
      all: list.length,
      new: list.filter((r) => r.status === "new").length,
      in_progress: list.filter((r) => r.status === "in_progress").length,
      replied: list.filter((r) => r.status === "replied").length,
      resolved: list.filter((r) => r.status === "resolved").length,
      closed: list.filter((r) => r.status === "closed").length,
    };
  }, [rawInquiries]);

  const dateLocale = language === "en" ? "en-US" : "zh-TW";
  const formatTime = (d: string | Date | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleString(dateLocale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const columns: Column<InquiryRow>[] = [
    {
      key: "id",
      header: "#",
      width: "w-16",
      sortable: true,
      sortValue: (r) => r.id,
      render: (r) => <span className="text-gray-500 tabular-nums">#{r.id}</span>,
    },
    {
      key: "customer",
      header: t("admin.inquiriesTab.columnCustomer"),
      sortable: true,
      sortValue: (r) => r.customerName ?? "",
      render: (r) => (
        <div className="min-w-0">
          <div className="text-gray-900 truncate font-medium">{r.customerName || "—"}</div>
          <div className="text-[11px] text-gray-500 truncate">{r.customerEmail}</div>
        </div>
      ),
    },
    {
      key: "type",
      header: t("admin.inquiriesTab.columnType"),
      width: "w-28",
      render: (r) => (
        <span className="text-xs text-gray-700">{r.inquiryType || "—"}</span>
      ),
    },
    {
      key: "subject",
      header: t("admin.inquiriesTab.columnSubject"),
      render: (r) => (
        <div className="truncate text-gray-700">{r.subject || "—"}</div>
      ),
    },
    {
      key: "status",
      header: t("admin.inquiriesTab.columnStatus"),
      width: "w-24",
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <StatusDot tone={STATUS_TONE[r.status]} label={statusLabel(r.status, t)} />
      ),
    },
    {
      key: "time",
      header: t("admin.inquiriesTab.columnTime"),
      width: "w-32",
      sortable: true,
      sortValue: (r) => (r.createdAt ? new Date(r.createdAt).getTime() : 0),
      render: (r) => (
        <span className="text-xs text-gray-500 tabular-nums">{formatTime(r.createdAt)}</span>
      ),
    },
  ];

  const handleQuickStatus = (id: number, status: InquiryStatus) => {
    updateStatus.mutate({ id, status });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusToggle
            label={t("admin.inquiriesTab.statusAll")}
            count={counts.all}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <StatusToggle
            label={t("admin.inquiriesTab.statusNew")}
            count={counts.new}
            active={statusFilter === "new"}
            tone="warn"
            onClick={() => setStatusFilter("new")}
          />
          <StatusToggle
            label={t("admin.inquiriesTab.statusInProgress")}
            count={counts.in_progress}
            active={statusFilter === "in_progress"}
            tone="info"
            onClick={() => setStatusFilter("in_progress")}
          />
          <StatusToggle
            label={t("admin.inquiriesTab.statusReplied")}
            count={counts.replied}
            active={statusFilter === "replied"}
            tone="info"
            onClick={() => setStatusFilter("replied")}
          />
          <StatusToggle
            label={t("admin.inquiriesTab.statusResolved")}
            count={counts.resolved}
            active={statusFilter === "resolved"}
            tone="success"
            onClick={() => setStatusFilter("resolved")}
          />
          <StatusToggle
            label={t("admin.inquiriesTab.statusClosed")}
            count={counts.closed}
            active={statusFilter === "closed"}
            tone="muted"
            onClick={() => setStatusFilter("closed")}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("admin.inquiriesTab.searchPlaceholder")}
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
            onClick={() => refetch()}
            className="h-8 rounded-lg gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {!isLoading && filtered.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-8 w-8" />}
          title={t("admin.inquiriesTab.emptyTitle")}
          description={t("admin.inquiriesTab.emptyDesc")}
        />
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(r) => {
            setSelectedId(r.id);
            setDrawerOpen(true);
          }}
          selectedId={selectedId ?? undefined}
        />
      )}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full 2xl:max-w-5xl 2xl:rounded-l-xl overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-gray-100">
            <SheetTitle className="text-base flex items-center gap-2">
              <span className="text-gray-500 tabular-nums font-normal">#{detail?.id ?? ""}</span>
              <span>{t("admin.inquiriesTab.detailDialogTitle")}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              {detail?.subject ?? ""}
            </SheetDescription>
          </SheetHeader>

          {detail && (
            <div className="space-y-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <StatusDot
                  tone={STATUS_TONE[detail.status as InquiryStatus]}
                  label={statusLabel(detail.status as InquiryStatus, t)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 rounded-lg text-xs">
                      {t("admin.inquiriesTab.filterPlaceholder")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(["new", "in_progress", "replied", "resolved", "closed"] as InquiryStatus[]).map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onSelect={() => handleQuickStatus(detail.id, s)}
                        disabled={s === detail.status}
                      >
                        <StatusDot tone={STATUS_TONE[s]} label={statusLabel(s, t)} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.inquiriesTab.customerInfoLabel")}</SectionTitle>
                <Field label={t("admin.inquiriesTab.nameLabel")}>{detail.customerName || "—"}</Field>
                <Field label={t("admin.inquiriesTab.emailLabel")}>{detail.customerEmail || "—"}</Field>
                <Field label={t("admin.inquiriesTab.phoneLabel")}>{detail.customerPhone || "—"}</Field>
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.inquiriesTab.subjectLabel")}</SectionTitle>
                <p className="text-xs text-gray-900 font-medium">{detail.subject || "—"}</p>
              </div>

              <div className="space-y-1.5">
                <SectionTitle>{t("admin.inquiriesTab.messageLabel")}</SectionTitle>
                <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3">
                  {detail.message || "—"}
                </p>
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDrawerOpen(false)}
                  className="ml-auto h-8 rounded-lg gap-1"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 font-semibold">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-900 text-right break-words">{children}</span>
    </div>
  );
}
