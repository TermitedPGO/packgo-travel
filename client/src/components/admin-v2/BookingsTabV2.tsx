/**
 * BookingsTabV2 — Trip.com-style booking admin (Round 81 v2 redesign).
 *
 * Reference: Trip.com's supplier admin booking list. Key visual ideas:
 *   - Dense 36px row, every row a single line of meaningful data
 *   - Status as colored dot + text, NOT badge fill (uses StatusDot primitive)
 *   - Supplier logo + booking ref + traveler count + amount + departure date
 *     all visible in the row — no need to expand to see the basics
 *   - Filter chips above (Pending / Confirmed / Completed / Cancelled)
 *     dismissible
 *   - DetailDrawer slides from right when row is clicked (no Dialog modal)
 *
 * Backend wire: same trpc.bookings.adminList + adminUpdateStatus as v1.
 * No data migration. Only UI rewrite.
 *
 * 2026-05-22 — built as the pilot redesign establishing patterns for the
 * remaining 5-8 tabs to follow.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { orderPacketToCsv, type OrderPacket } from "@shared/orderPacket";
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
import { Download, FileText, Loader2, RefreshCw, Search, ShoppingCart, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";
type PaymentStatus = "pending" | "deposit_paid" | "paid" | "refunded";
// Phase 1.1: where the booking sits in the supplier (UV / Lion) ordering flow.
type SupplierStatus =
  | "not_placed"
  | "placed"
  | "vendor_confirmed"
  | "vendor_rejected"
  | "waitlisted";
const SUPPLIER_STATUS_ORDER: SupplierStatus[] = [
  "not_placed",
  "placed",
  "vendor_confirmed",
  "vendor_rejected",
  "waitlisted",
];

type BookingRow = {
  id: number;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  tourTitle?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  departureDate?: string | Date | null;
  totalPax?: number | null;
  totalAmount?: number | null;
  currency?: string | null;
  createdAt?: string | Date | null;
  // additional fields used in drawer
  depositAmount?: number | null;
  remainingAmount?: number | null;
  specialRequests?: string | null;
  tourId?: number | null;
  // Phase 1.1: supplier fulfillment state machine
  supplierStatus?: SupplierStatus | null;
  supplierBookingRef?: string | null;
};

const STATUS_TONE: Record<BookingStatus, StatusTone> = {
  pending: "warn",
  confirmed: "info",
  completed: "success",
  cancelled: "danger",
};

const PAYMENT_TONE: Record<PaymentStatus, StatusTone> = {
  pending: "muted",
  deposit_paid: "info",
  paid: "success",
  refunded: "warn",
};

const SUPPLIER_STATUS_TONE: Record<SupplierStatus, StatusTone> = {
  not_placed: "muted",
  placed: "info",
  vendor_confirmed: "success",
  vendor_rejected: "danger",
  waitlisted: "warn",
};

// Tab pill toggle — inline since the existing FilterChip primitive serves a
// different purpose (dismissible active-filter display).
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

export default function BookingsTabV2() {
  const { t, language } = useLocale();
  const [statusFilter, setStatusFilter] = useState<"all" | BookingStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  // Phase 1.1: draft for the supplier order-ref input, seeded when a row opens.
  const [refDraft, setRefDraft] = useState("");
  // Phase 1.5: order packet is fetched ON DEMAND (decrypts passport + audit-logs),
  // never auto-loaded. Opens only when Jeff clicks the button for a booking.
  const [packetOpen, setPacketOpen] = useState(false);

  const { data: rawBookings = [], isLoading, refetch } = trpc.bookings.adminList.useQuery();
  const bookings = useMemo(() => {
    const list = rawBookings as BookingRow[];
    let filtered = statusFilter === "all" ? list : list.filter((b) => b.bookingStatus === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((b) =>
        String(b.id).includes(q) ||
        (b.contactName ?? "").toLowerCase().includes(q) ||
        (b.contactEmail ?? "").toLowerCase().includes(q) ||
        (b.contactPhone ?? "").toLowerCase().includes(q) ||
        (b.tourTitle ?? "").toLowerCase().includes(q),
      );
    }
    return filtered;
  }, [rawBookings, statusFilter, searchQuery]);

  const updateStatusMutation = trpc.bookings.adminUpdateStatus.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("admin.bookingsTab.toastStatusUpdated"));
    },
    onError: () => toast.error(t("admin.bookingsTab.toastUpdateFailed")),
    onSettled: () => setUpdatingId(null),
  });

  // Phase 1.1: record the REAL supplier outcome. This (not payment) is what
  // flips the customer-facing label to "seat secured".
  const setSupplierStatusMutation = trpc.bookings.setSupplierStatus.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("admin.bookingsTab.toastSupplierUpdated"));
    },
    onError: () => toast.error(t("admin.bookingsTab.toastUpdateFailed")),
    onSettled: () => setUpdatingId(null),
  });

  // Phase 1.5: order packet, gated on packetOpen so the passport decryption +
  // audit-log fire only when Jeff actually opens it for the selected booking.
  const orderPacketQuery = trpc.bookings.getOrderPacket.useQuery(
    { id: selectedId ?? 0 },
    { enabled: packetOpen && selectedId != null, refetchOnWindowFocus: false },
  );

  // One-click deposit invoice PDF for the selected booking (restored from v1
  // BookingsTab; backend = trpc.tools.generateDeposit). Opens the rendered PDF
  // in a new tab so Jeff can sanity-check before forwarding to the customer.
  const generateDepositMutation = trpc.tools.generateDeposit.useMutation({
    onSuccess: (res) => {
      toast.success(t("admin.bookingsTab.toastDepositGenerated"));
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
    },
    onError: (err) =>
      toast.error(err?.message || t("admin.bookingsTab.toastDepositFailed")),
  });

  const handleGenerateDeposit = (b: BookingRow) => {
    const depUSD = Number(b.depositAmount ?? 0);
    const totUSD = Number(b.totalAmount ?? 0);
    if (!depUSD || !totUSD) {
      toast.error(t("admin.bookingsTab.toastMissingAmount"));
      return;
    }
    generateDepositMutation.mutate({
      bookingId: b.id,
      customerName: b.contactName || t("admin.bookingsTab.depositDefaultCustomer"),
      customerEmail: b.contactEmail || undefined,
      tripName: b.tourTitle || `Tour #${b.tourId ?? "?"}`,
      departureDate: b.departureDate
        ? new Date(b.departureDate).toLocaleDateString(
            language === "en" ? "en-US" : "zh-TW",
            { year: "numeric", month: "long", day: "numeric" },
          )
        : t("admin.bookingsTab.depositTbdDate"),
      passengers:
        b.totalPax != null
          ? `${b.totalPax} ${t("admin.bookingsTab.paxSuffix")}`
          : undefined,
      totalUSD: totUSD,
      depositUSD: depUSD,
    });
  };

  const selected = useMemo(
    () => (selectedId !== null ? (rawBookings as BookingRow[]).find((b) => b.id === selectedId) : null),
    [selectedId, rawBookings],
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

  const formatMoney = (amount: number | null | undefined, currency?: string | null) => {
    if (amount === null || amount === undefined) return "—";
    const cur = (currency || "TWD").toUpperCase();
    const symbol = cur === "USD" ? "$" : "NT$";
    return `${symbol}${amount.toLocaleString()}`;
  };

  const columns: Column<BookingRow>[] = [
    {
      key: "id",
      header: "#",
      width: "w-16",
      sortable: true,
      sortValue: (b) => b.id,
      render: (b) => <span className="text-gray-500 tabular-nums">#{b.id}</span>,
    },
    {
      key: "customer",
      header: t("admin.bookingsTab.columnCustomer"),
      sortable: true,
      sortValue: (b) => b.contactName ?? "",
      render: (b) => (
        <div className="min-w-0">
          <div className="text-gray-900 truncate font-medium">{b.contactName || "—"}</div>
          <div className="text-[11px] text-gray-500 truncate">{b.contactEmail}</div>
        </div>
      ),
    },
    {
      key: "tour",
      header: t("admin.bookingsTab.columnTour"),
      sortable: true,
      sortValue: (b) => b.tourTitle ?? "",
      render: (b) => (
        <div className="truncate text-gray-700">{b.tourTitle || `Tour #${b.tourId ?? "?"}`}</div>
      ),
    },
    {
      key: "departure",
      header: t("admin.bookingsTab.columnDeparture"),
      width: "w-28",
      sortable: true,
      sortValue: (b) => (b.departureDate ? new Date(b.departureDate).getTime() : 0),
      render: (b) => <span className="text-gray-700 tabular-nums">{formatDate(b.departureDate)}</span>,
    },
    {
      key: "pax",
      header: t("admin.bookingsTab.columnPax"),
      width: "w-16",
      align: "right",
      sortable: true,
      sortValue: (b) => b.totalPax ?? 0,
      render: (b) => <span className="tabular-nums">{b.totalPax ?? "—"}</span>,
    },
    {
      key: "amount",
      header: t("admin.bookingsTab.columnAmount"),
      width: "w-28",
      align: "right",
      sortable: true,
      sortValue: (b) => b.totalAmount ?? 0,
      render: (b) => (
        <span className="tabular-nums font-medium text-gray-900">
          {formatMoney(b.totalAmount, b.currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.bookingsTab.columnStatus"),
      width: "w-28",
      sortable: true,
      sortValue: (b) => b.bookingStatus,
      render: (b) => (
        <StatusDot
          tone={STATUS_TONE[b.bookingStatus]}
          label={t(`admin.bookingsTab.status${capitalize(b.bookingStatus)}`)}
        />
      ),
    },
    {
      key: "payment",
      header: t("admin.bookingsTab.columnPayment"),
      width: "w-28",
      render: (b) => (
        <StatusDot
          tone={PAYMENT_TONE[b.paymentStatus]}
          label={paymentLabel(b.paymentStatus, t)}
        />
      ),
    },
  ];

  const handleQuickStatus = (id: number, status: BookingStatus) => {
    setUpdatingId(id);
    updateStatusMutation.mutate({ id, status });
  };

  const handleSetSupplierStatus = (
    id: number,
    supplierStatus: SupplierStatus,
    supplierBookingRef?: string,
  ) => {
    setUpdatingId(id);
    setSupplierStatusMutation.mutate({ id, supplierStatus, supplierBookingRef });
  };

  const downloadPacketCsv = (packet: OrderPacket) => {
    const csv = orderPacketToCsv(packet);
    // Prepend a UTF-8 BOM so Excel opens CJK names correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `order-packet-${packet.bookingId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const SUPPLIER_STATUS_LABEL: Record<SupplierStatus, string> = {
    not_placed: t("admin.bookingsTab.supplierNotPlaced"),
    placed: t("admin.bookingsTab.supplierPlaced"),
    vendor_confirmed: t("admin.bookingsTab.supplierVendorConfirmed"),
    vendor_rejected: t("admin.bookingsTab.supplierVendorRejected"),
    waitlisted: t("admin.bookingsTab.supplierWaitlisted"),
  };

  // Stats per status for FilterChip counts
  const counts = useMemo(() => {
    const list = rawBookings as BookingRow[];
    return {
      all: list.length,
      pending: list.filter((b) => b.bookingStatus === "pending").length,
      confirmed: list.filter((b) => b.bookingStatus === "confirmed").length,
      completed: list.filter((b) => b.bookingStatus === "completed").length,
      cancelled: list.filter((b) => b.bookingStatus === "cancelled").length,
    };
  }, [rawBookings]);

  return (
    <div className="space-y-3">
      {/* Header row: filter chips + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusToggle
            label={t("admin.bookingsTab.statAll")}
            count={counts.all}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <StatusToggle
            label={t("admin.bookingsTab.statusPending")}
            count={counts.pending}
            active={statusFilter === "pending"}
            tone="warn"
            onClick={() => setStatusFilter("pending")}
          />
          <StatusToggle
            label={t("admin.bookingsTab.statusConfirmed")}
            count={counts.confirmed}
            active={statusFilter === "confirmed"}
            tone="info"
            onClick={() => setStatusFilter("confirmed")}
          />
          <StatusToggle
            label={t("admin.bookingsTab.statusCompleted")}
            count={counts.completed}
            active={statusFilter === "completed"}
            tone="success"
            onClick={() => setStatusFilter("completed")}
          />
          <StatusToggle
            label={t("admin.bookingsTab.statusCancelled")}
            count={counts.cancelled}
            active={statusFilter === "cancelled"}
            tone="danger"
            onClick={() => setStatusFilter("cancelled")}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("admin.bookingsTab.searchPlaceholder")}
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
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg gap-1.5"
            disabled
          >
            <Download className="h-3.5 w-3.5" />
            {t("admin.bookingsTab.exportButton")}
          </Button>
        </div>
      </div>

      {/* Table */}
      {!isLoading && bookings.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-8 w-8" />}
          title={t("admin.bookingsTab.emptyTitle")}
          description={t("admin.bookingsTab.emptyDesc")}
        />
      ) : (
        <DataTable
          data={bookings}
          columns={columns}
          loading={isLoading}
          onRowClick={(b) => {
            setSelectedId(b.id);
            setRefDraft(b.supplierBookingRef ?? "");
            setPacketOpen(false);
            setDrawerOpen(true);
          }}
          selectedId={selectedId ?? undefined}
        />
      )}

      {/* Detail Drawer — slides from right */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full xl:max-w-5xl xl:rounded-l-xl overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-gray-100">
            <SheetTitle className="text-base flex items-center gap-2">
              <span className="text-gray-500 tabular-nums font-normal">#{selected?.id ?? ""}</span>
              <span>{t("admin.bookingsTab.detailDialogTitle")}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              {selected?.tourTitle ?? ""}
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="space-y-5 py-4">
              {/* Status row with quick-change dropdown */}
              <div className="flex items-center justify-between gap-2">
                <StatusDot
                  tone={STATUS_TONE[selected.bookingStatus]}
                  label={t(`admin.bookingsTab.status${capitalize(selected.bookingStatus)}`)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-lg text-xs"
                      disabled={updatingId === selected.id}
                    >
                      {t("admin.bookingsTab.quickStatusLabel")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(["pending", "confirmed", "completed", "cancelled"] as BookingStatus[]).map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onSelect={() => handleQuickStatus(selected.id, s)}
                        disabled={s === selected.bookingStatus}
                      >
                        <StatusDot
                          tone={STATUS_TONE[s]}
                          label={t(`admin.bookingsTab.status${capitalize(s)}`)}
                        />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Supplier fulfillment (Phase 1.1) — the REAL operator outcome.
                  The customer "seat secured" label drives off vendor_confirmed,
                  NOT payment. Recording the supplier result here is what advances
                  the customer-facing status. */}
              <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                <SectionTitle>{t("admin.bookingsTab.supplierSectionLabel")}</SectionTitle>
                <div className="flex items-center justify-between gap-2">
                  <StatusDot
                    tone={SUPPLIER_STATUS_TONE[selected.supplierStatus ?? "not_placed"]}
                    label={SUPPLIER_STATUS_LABEL[selected.supplierStatus ?? "not_placed"]}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-lg text-xs"
                        disabled={updatingId === selected.id}
                      >
                        {t("admin.bookingsTab.supplierChangeLabel")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {SUPPLIER_STATUS_ORDER.map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onSelect={() =>
                            handleSetSupplierStatus(selected.id, s, refDraft.trim() || undefined)
                          }
                          disabled={s === (selected.supplierStatus ?? "not_placed")}
                        >
                          <StatusDot tone={SUPPLIER_STATUS_TONE[s]} label={SUPPLIER_STATUS_LABEL[s]} />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={refDraft}
                    onChange={(e) => setRefDraft(e.target.value)}
                    placeholder={t("admin.bookingsTab.supplierRefLabel")}
                    className="h-8 rounded-lg text-sm"
                    maxLength={128}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs whitespace-nowrap"
                    disabled={
                      updatingId === selected.id ||
                      refDraft.trim() === (selected.supplierBookingRef ?? "")
                    }
                    onClick={() =>
                      handleSetSupplierStatus(
                        selected.id,
                        selected.supplierStatus ?? "not_placed",
                        refDraft.trim() || undefined,
                      )
                    }
                  >
                    {t("admin.bookingsTab.supplierRefSave")}
                  </Button>
                </div>
                {/* Order packet (Phase 1.5): on-demand fetch that decrypts the
                    passenger passports + audit-logs the access. Compact preview
                    here; the CSV download carries the full manifest for the
                    supplier portal. */}
                {!packetOpen ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-lg text-xs"
                    onClick={() => setPacketOpen(true)}
                  >
                    <FileText className="h-3.5 w-3.5 mr-1" />
                    {t("admin.bookingsTab.orderPacketBtn")}
                  </Button>
                ) : orderPacketQuery.isLoading ? (
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("admin.bookingsTab.orderPacketLoading")}
                  </div>
                ) : orderPacketQuery.data ? (
                  <div className="space-y-2 rounded-lg border border-gray-200 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">
                        {t("admin.bookingsTab.orderPacketTitle")}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-lg text-xs"
                        onClick={() =>
                          orderPacketQuery.data && downloadPacketCsv(orderPacketQuery.data)
                        }
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        {t("admin.bookingsTab.orderPacketDownload")}
                      </Button>
                    </div>
                    {orderPacketQuery.data.passengers.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        {t("admin.bookingsTab.orderPacketNoPax")}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-gray-400">
                              <th className="pr-2 font-medium">#</th>
                              <th className="pr-2 font-medium">
                                {t("admin.bookingsTab.orderPacketColName")}
                              </th>
                              <th className="font-medium">
                                {t("admin.bookingsTab.orderPacketColPassport")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderPacketQuery.data.passengers.map((p) => (
                              <tr key={p.index} className="border-t border-gray-100">
                                <td className="pr-2 py-1 tabular-nums">{p.index}</td>
                                <td className="pr-2">
                                  {p.lastName} {p.firstName}
                                </td>
                                <td className="font-mono">{p.passportNumber || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-red-600">
                    {t("admin.bookingsTab.orderPacketError")}
                  </p>
                )}
              </div>

              {/* Tour */}
              <Field label={t("admin.bookingsTab.columnTour")}>
                {selected.tourTitle || `Tour #${selected.tourId ?? "?"}`}
              </Field>

              {/* Contact */}
              <div className="space-y-2">
                <SectionTitle>{t("admin.bookingsTab.contactInfoLabel")}</SectionTitle>
                <Field label={t("admin.bookingsTab.columnCustomer")}>
                  {selected.contactName || "—"}
                </Field>
                <Field label="Email">{selected.contactEmail || "—"}</Field>
                <Field label={t("contactUs.phone")}>{selected.contactPhone || "—"}</Field>
              </div>

              {/* Trip */}
              <div className="space-y-2">
                <SectionTitle>{t("admin.bookingsTab.paxBreakdownLabel")}</SectionTitle>
                <Field label={t("admin.bookingsTab.columnDeparture")}>
                  {formatDate(selected.departureDate)}
                </Field>
                <Field label={t("admin.bookingsTab.columnPax")}>
                  {selected.totalPax ?? "—"}
                </Field>
              </div>

              {/* Payment */}
              <div className="space-y-2">
                <SectionTitle>{t("admin.bookingsTab.costInfoLabel")}</SectionTitle>
                <Field label={t("admin.bookingsTab.columnAmount")}>
                  <span className="font-semibold">
                    {formatMoney(selected.totalAmount, selected.currency)}
                  </span>
                </Field>
                {selected.depositAmount !== null && selected.depositAmount !== undefined && (
                  <Field label={t("paymentSuccess.deposit20")}>
                    {formatMoney(selected.depositAmount, selected.currency)}
                  </Field>
                )}
                {selected.remainingAmount !== null && selected.remainingAmount !== undefined && (
                  <Field label={t("paymentSuccess.remainingPayment")}>
                    {formatMoney(selected.remainingAmount, selected.currency)}
                  </Field>
                )}
                <Field label="Payment status">
                  <StatusDot
                    tone={PAYMENT_TONE[selected.paymentStatus]}
                    label={paymentLabel(selected.paymentStatus, t)}
                  />
                </Field>
              </div>

              {/* Special requests */}
              {selected.specialRequests && (
                <div className="space-y-1.5">
                  <SectionTitle>{t("admin.bookingsTab.specialRequestsLabel")}</SectionTitle>
                  <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3">
                    {selected.specialRequests}
                  </p>
                </div>
              )}

              {/* Footer actions */}
              <div className="pt-3 border-t border-gray-100 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGenerateDeposit(selected)}
                  disabled={
                    generateDepositMutation.isPending ||
                    !selected.totalAmount ||
                    !selected.depositAmount
                  }
                  className="h-8 rounded-lg gap-1.5"
                >
                  {generateDepositMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t("admin.bookingsTab.generateDepositPdf")}
                </Button>
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

function capitalize<T extends string>(s: T): Capitalize<T> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<T>;
}

function paymentLabel(
  s: PaymentStatus,
  t: (key: string) => string,
): string {
  switch (s) {
    case "pending":
      return t("admin.bookingsTab.paymentPending");
    case "deposit_paid":
      return t("admin.bookingsTab.paymentDepositPaid");
    case "paid":
      return t("admin.bookingsTab.paymentPaid");
    case "refunded":
      return t("admin.bookingsTab.paymentRefunded");
  }
}
