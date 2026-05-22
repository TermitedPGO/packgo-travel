/**
 * VouchersTabV2 — Trip.com-style voucher admin (Round 81 v2).
 *
 * Same visual pattern as BookingsTabV2 / InquiriesTabV2 / ReviewsTabV2:
 *   - StatusToggle pill chips with live count per status
 *   - DataTable 36px rows + StatusDot + DetailDrawer (slide-from-right)
 *   - Search box for code / user / type
 *
 * Backend wire: trpc.vouchers.adminList + adminMarkRedeemed — no migration.
 *
 * Phase C tab #5 (Bookings was #1). 2026-05-22.
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
import {
  BookOpen,
  Check,
  Copy,
  Loader2,
  Plane,
  RefreshCw,
  Search,
  Ticket,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type VoucherStatus = "issued" | "redeemed" | "expired" | "voided";
type VoucherStatusFilter = VoucherStatus | "all";
type VoucherType = "flight_credit" | "photo_book" | "tour_credit";

type VoucherRow = {
  id: number;
  userId: number;
  authorName?: string | null;
  authorEmail?: string | null;
  type: VoucherType | string;
  code: string;
  amountUsd: number;
  pointsCost: number;
  status: VoucherStatus | string;
  expiresAt: string | Date;
  redeemedAt?: string | Date | null;
  redeemedAgainstBookingId?: number | null;
  notes?: string | null;
  createdAt: string | Date;
};

const STATUS_TONE: Record<VoucherStatus, StatusTone> = {
  issued: "success",
  redeemed: "info",
  expired: "muted",
  voided: "danger",
};

function statusLabel(s: VoucherStatus, t: (k: string) => string): string {
  switch (s) {
    case "issued":
      return t("admin.vouchersTab.statusIssued");
    case "redeemed":
      return t("admin.vouchersTab.statusRedeemed");
    case "expired":
      return t("admin.vouchersTab.statusExpired");
    case "voided":
      return t("admin.vouchersTab.statusVoided");
  }
}

function typeMeta(
  type: string,
  t: (k: string) => string,
): { label: string; icon: typeof Ticket } {
  switch (type) {
    case "flight_credit":
      return { label: t("admin.vouchersTab.typeFlightCredit"), icon: Plane };
    case "photo_book":
      return { label: t("admin.vouchersTab.typePhotoBook"), icon: BookOpen };
    case "tour_credit":
      return { label: t("admin.vouchersTab.typeTourCredit"), icon: Ticket };
    default:
      return { label: type, icon: Ticket };
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

export default function VouchersTabV2() {
  const { t, language } = useLocale();
  const [statusFilter, setStatusFilter] = useState<VoucherStatusFilter>("issued");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bookingIdInput, setBookingIdInput] = useState("");
  const [notesInput, setNotesInput] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.vouchers.adminList.useQuery({
    status: statusFilter,
    type: "all",
    limit: 100,
  });
  const rawVouchers = (data?.items ?? []) as VoucherRow[];

  // Also fetch "all" for chip counts.
  const { data: allData } = trpc.vouchers.adminList.useQuery(
    { status: "all", type: "all", limit: 200 },
    { staleTime: 30_000 },
  );
  const allVouchers = (allData?.items ?? []) as VoucherRow[];

  const markRedeemedMutation = trpc.vouchers.adminMarkRedeemed.useMutation({
    onSuccess: () => {
      toast.success(t("admin.vouchersTab.toastMarkedRedeemed"));
      utils.vouchers.adminList.invalidate();
      setDrawerOpen(false);
      setBookingIdInput("");
      setNotesInput("");
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    let out = rawVouchers;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter(
        (v) =>
          String(v.id).includes(q) ||
          v.code.toLowerCase().includes(q) ||
          (v.authorName ?? "").toLowerCase().includes(q) ||
          (v.authorEmail ?? "").toLowerCase().includes(q) ||
          (v.type ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [rawVouchers, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: allVouchers.length,
      issued: allVouchers.filter((v) => v.status === "issued").length,
      redeemed: allVouchers.filter((v) => v.status === "redeemed").length,
      expired: allVouchers.filter((v) => v.status === "expired").length,
      voided: allVouchers.filter((v) => v.status === "voided").length,
    };
  }, [allVouchers]);

  const selected = useMemo(
    () => (selectedId !== null ? rawVouchers.find((v) => v.id === selectedId) ?? null : null),
    [selectedId, rawVouchers],
  );

  const dateLocale = language === "en" ? "en-US" : "zh-TW";
  const formatDate = (d: string | Date | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(dateLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t("admin.vouchersTab.toastCopied", { code }));
    } catch {}
  };

  const columns: Column<VoucherRow>[] = [
    {
      key: "code",
      header: t("admin.vouchersTab.columnCode"),
      width: "w-36",
      sortable: true,
      sortValue: (v) => v.code,
      render: (v) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <code className="font-mono text-[11px] text-gray-900 truncate">{v.code}</code>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              copyCode(v.code);
            }}
            className="text-gray-400 hover:text-gray-700 flex-shrink-0"
            aria-label="copy"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      ),
    },
    {
      key: "user",
      header: t("admin.vouchersTab.columnUser"),
      sortable: true,
      sortValue: (v) => v.authorName ?? "",
      render: (v) => (
        <div className="min-w-0">
          <div className="text-gray-900 truncate font-medium">{v.authorName || "—"}</div>
          <div className="text-[11px] text-gray-500 truncate">{v.authorEmail}</div>
        </div>
      ),
    },
    {
      key: "type",
      header: t("admin.vouchersTab.columnType"),
      width: "w-28",
      render: (v) => {
        const meta = typeMeta(v.type, t);
        const Icon = meta.icon;
        return (
          <span className="inline-flex items-center gap-1 text-xs text-gray-700">
            <Icon className="h-3.5 w-3.5 text-[#8a6f3a]" />
            {meta.label}
          </span>
        );
      },
    },
    {
      key: "value",
      header: t("admin.vouchersTab.columnValue"),
      width: "w-24",
      align: "right",
      sortable: true,
      sortValue: (v) => v.amountUsd,
      render: (v) => (
        <span className="tabular-nums font-medium text-gray-900">
          ${v.amountUsd}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.vouchersTab.columnStatus"),
      width: "w-24",
      sortable: true,
      sortValue: (v) => v.status,
      render: (v) => (
        <StatusDot
          tone={STATUS_TONE[v.status as VoucherStatus] ?? "neutral"}
          label={statusLabel(v.status as VoucherStatus, t)}
        />
      ),
    },
    {
      key: "issued",
      header: t("admin.vouchersTab.columnIssued"),
      width: "w-28",
      sortable: true,
      sortValue: (v) => (v.createdAt ? new Date(v.createdAt).getTime() : 0),
      render: (v) => (
        <span className="text-gray-700 tabular-nums">{formatDate(v.createdAt)}</span>
      ),
    },
    {
      key: "expires",
      header: t("admin.vouchersTab.columnExpires"),
      width: "w-28",
      sortable: true,
      sortValue: (v) => (v.expiresAt ? new Date(v.expiresAt).getTime() : 0),
      render: (v) => (
        <span className="text-gray-700 tabular-nums">{formatDate(v.expiresAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusToggle
            label={t("admin.vouchersTab.statusAll")}
            count={counts.all}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <StatusToggle
            label={t("admin.vouchersTab.statusIssued")}
            count={counts.issued}
            active={statusFilter === "issued"}
            tone="success"
            onClick={() => setStatusFilter("issued")}
          />
          <StatusToggle
            label={t("admin.vouchersTab.statusRedeemed")}
            count={counts.redeemed}
            active={statusFilter === "redeemed"}
            tone="info"
            onClick={() => setStatusFilter("redeemed")}
          />
          <StatusToggle
            label={t("admin.vouchersTab.statusExpired")}
            count={counts.expired}
            active={statusFilter === "expired"}
            tone="muted"
            onClick={() => setStatusFilter("expired")}
          />
          <StatusToggle
            label={t("admin.vouchersTab.statusVoided")}
            count={counts.voided}
            active={statusFilter === "voided"}
            tone="danger"
            onClick={() => setStatusFilter("voided")}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("admin.vouchersTab.searchPlaceholder")}
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
          icon={<Ticket className="h-8 w-8" />}
          title={t("admin.vouchersTab.emptyTitle")}
          description={t("admin.vouchersTab.emptyDesc")}
        />
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(v) => {
            setSelectedId(v.id);
            setBookingIdInput("");
            setNotesInput("");
            setDrawerOpen(true);
          }}
          selectedId={selectedId ?? undefined}
        />
      )}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-md rounded-l-xl overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-gray-100">
            <SheetTitle className="text-base flex items-center gap-2">
              <Ticket className="h-4 w-4 text-[#c9a563]" />
              <span>{t("admin.vouchersTab.detailDialogTitle")}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              {selected?.code ?? ""}
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="space-y-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <StatusDot
                  tone={STATUS_TONE[selected.status as VoucherStatus] ?? "neutral"}
                  label={statusLabel(selected.status as VoucherStatus, t)}
                />
                <button
                  type="button"
                  onClick={() => copyCode(selected.code)}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900"
                >
                  <code className="font-mono">{selected.code}</code>
                  <Copy className="h-3 w-3" />
                </button>
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.vouchersTab.userInfoLabel")}</SectionTitle>
                <Field label={t("admin.vouchersTab.columnUser")}>
                  {selected.authorName || "—"}
                </Field>
                <Field label="Email">{selected.authorEmail || "—"}</Field>
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.vouchersTab.voucherInfoLabel")}</SectionTitle>
                <Field label={t("admin.vouchersTab.columnType")}>
                  {typeMeta(selected.type, t).label}
                </Field>
                <Field label={t("admin.vouchersTab.columnValue")}>
                  <span className="font-semibold">${selected.amountUsd}</span>
                </Field>
                <Field label={t("admin.vouchersTab.pointsCostLabel")}>
                  <span className="tabular-nums">
                    {selected.pointsCost.toLocaleString()} pt
                  </span>
                </Field>
                <Field label={t("admin.vouchersTab.columnIssued")}>
                  {formatDate(selected.createdAt)}
                </Field>
                <Field label={t("admin.vouchersTab.columnExpires")}>
                  {formatDate(selected.expiresAt)}
                </Field>
              </div>

              {selected.redeemedAt && (
                <div className="space-y-2">
                  <SectionTitle>{t("admin.vouchersTab.redeemedInfoLabel")}</SectionTitle>
                  <Field label={t("admin.vouchersTab.redeemedAtLabel")}>
                    {formatDate(selected.redeemedAt)}
                  </Field>
                  {selected.redeemedAgainstBookingId && (
                    <Field label={t("admin.vouchersTab.bookingLabel")}>
                      #{selected.redeemedAgainstBookingId}
                    </Field>
                  )}
                </div>
              )}

              {selected.notes && (
                <div className="space-y-1.5">
                  <SectionTitle>{t("admin.vouchersTab.notesLabel")}</SectionTitle>
                  <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3">
                    {selected.notes}
                  </p>
                </div>
              )}

              {selected.status === "issued" && (
                <div className="space-y-2 pt-3 border-t border-gray-100">
                  <SectionTitle>{t("admin.vouchersTab.markRedeemedLabel")}</SectionTitle>
                  <Input
                    type="number"
                    placeholder={t("admin.vouchersTab.bookingIdPlaceholder")}
                    value={bookingIdInput}
                    onChange={(e) => setBookingIdInput(e.target.value)}
                    className="h-8 rounded-lg text-xs tabular-nums"
                  />
                  <Textarea
                    placeholder={t("admin.vouchersTab.notesPlaceholder")}
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    rows={2}
                    className="text-xs rounded-lg"
                    maxLength={500}
                  />
                </div>
              )}

              <div className="pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                {selected.status === "issued" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      markRedeemedMutation.mutate({
                        voucherId: selected.id,
                        bookingId: bookingIdInput
                          ? parseInt(bookingIdInput, 10)
                          : undefined,
                        notes: notesInput || undefined,
                      })
                    }
                    disabled={markRedeemedMutation.isPending}
                    className="h-8 rounded-lg gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {markRedeemedMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {t("admin.vouchersTab.confirmRedeemButton")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDrawerOpen(false)}
                  className="ml-auto h-8 rounded-lg gap-1"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("common.close")}
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
