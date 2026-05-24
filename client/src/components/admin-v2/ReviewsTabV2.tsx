/**
 * ReviewsTabV2 — Trip.com-style review moderation admin (Round 81 v2).
 *
 * Same visual pattern as BookingsTabV2 / InquiriesTabV2:
 *   - StatusToggle pill chips with live count per status
 *   - DataTable 36px rows + StatusDot + DetailDrawer (slide-from-right)
 *   - Search box for ID / author / title
 *
 * Backend wire: trpc.reviews.adminList + adminApprove / adminReject /
 * adminHide — no migration. Approving auto-awards +50 Packpoint (server).
 *
 * Phase C tab #3 (Bookings was #1, Inquiries was #2). 2026-05-22.
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
  Check,
  EyeOff,
  Loader2,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ReviewStatus = "pending" | "approved" | "rejected" | "hidden";
type ReviewStatusFilter = ReviewStatus | "all";

type ReviewRow = {
  id: number;
  userId: number;
  authorName?: string | null;
  authorEmail?: string | null;
  tourId: number;
  tourTitle?: string | null;
  bookingId?: number | null;
  rating: number;
  title?: string | null;
  content?: string | null;
  photos?: string | null;
  language?: string | null;
  status: ReviewStatus;
  rejectionReason?: string | null;
  createdAt?: string | Date | null;
  publishedAt?: string | Date | null;
};

const STATUS_TONE: Record<ReviewStatus, StatusTone> = {
  pending: "warn",
  approved: "success",
  rejected: "danger",
  hidden: "muted",
};

function statusLabel(s: ReviewStatus, t: (k: string) => string): string {
  switch (s) {
    case "pending":
      return t("admin.reviewsTab.statusPending");
    case "approved":
      return t("admin.reviewsTab.statusApproved");
    case "rejected":
      return t("admin.reviewsTab.statusRejected");
    case "hidden":
      return t("admin.reviewsTab.statusHidden");
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

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-3 w-3 ${
            s <= rating ? "fill-amber-400 text-amber-400" : "text-gray-200"
          }`}
        />
      ))}
    </div>
  );
}

export default function ReviewsTabV2() {
  const { t, language } = useLocale();
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.reviews.adminList.useQuery({
    status: statusFilter,
    limit: 50,
  });
  const rawReviews = (data?.items ?? []) as ReviewRow[];

  // Also fetch "all" to compute per-status counts for the toggle chips.
  const { data: allData } = trpc.reviews.adminList.useQuery(
    { status: "all", limit: 100 },
    { staleTime: 30_000 },
  );
  const allReviews = (allData?.items ?? []) as ReviewRow[];

  const approveMutation = trpc.reviews.adminApprove.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.awarded > 0
          ? t("admin.reviewsTab.toastApprovedWithPoints", {
              n: String(res.awarded),
            })
          : t("admin.reviewsTab.toastApproved"),
      );
      utils.reviews.adminList.invalidate();
      setDrawerOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const rejectMutation = trpc.reviews.adminReject.useMutation({
    onSuccess: () => {
      toast.success(t("admin.reviewsTab.toastRejected"));
      utils.reviews.adminList.invalidate();
      setDrawerOpen(false);
      setRejectionReason("");
    },
    onError: (e) => toast.error(e.message),
  });
  const hideMutation = trpc.reviews.adminHide.useMutation({
    onSuccess: () => {
      toast.success(t("admin.reviewsTab.toastHidden"));
      utils.reviews.adminList.invalidate();
      setDrawerOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    let out = rawReviews;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter(
        (r) =>
          String(r.id).includes(q) ||
          (r.authorName ?? "").toLowerCase().includes(q) ||
          (r.authorEmail ?? "").toLowerCase().includes(q) ||
          (r.title ?? "").toLowerCase().includes(q) ||
          (r.tourTitle ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [rawReviews, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: allReviews.length,
      pending: allReviews.filter((r) => r.status === "pending").length,
      approved: allReviews.filter((r) => r.status === "approved").length,
      rejected: allReviews.filter((r) => r.status === "rejected").length,
      hidden: allReviews.filter((r) => r.status === "hidden").length,
    };
  }, [allReviews]);

  const selected = useMemo(
    () => (selectedId !== null ? rawReviews.find((r) => r.id === selectedId) ?? null : null),
    [selectedId, rawReviews],
  );

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

  const columns: Column<ReviewRow>[] = [
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
      header: t("admin.reviewsTab.columnCustomer"),
      sortable: true,
      sortValue: (r) => r.authorName ?? "",
      render: (r) => (
        <div className="min-w-0">
          <div className="text-gray-900 truncate font-medium">{r.authorName || "—"}</div>
          <div className="text-[11px] text-gray-500 truncate">{r.authorEmail}</div>
        </div>
      ),
    },
    {
      key: "rating",
      header: t("admin.reviewsTab.columnRating"),
      width: "w-28",
      sortable: true,
      sortValue: (r) => r.rating,
      render: (r) => <StarRating rating={r.rating} />,
    },
    {
      key: "title",
      header: t("admin.reviewsTab.columnTitle"),
      render: (r) => (
        <div className="truncate text-gray-700">{r.title || "—"}</div>
      ),
    },
    {
      key: "status",
      header: t("admin.reviewsTab.columnStatus"),
      width: "w-24",
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <StatusDot tone={STATUS_TONE[r.status]} label={statusLabel(r.status, t)} />
      ),
    },
    {
      key: "time",
      header: t("admin.reviewsTab.columnTime"),
      width: "w-32",
      sortable: true,
      sortValue: (r) => (r.createdAt ? new Date(r.createdAt).getTime() : 0),
      render: (r) => (
        <span className="text-xs text-gray-500 tabular-nums">{formatTime(r.createdAt)}</span>
      ),
    },
  ];

  const handleSelectStatus = (id: number, target: ReviewStatus) => {
    if (target === "approved") approveMutation.mutate({ id });
    else if (target === "hidden") hideMutation.mutate({ id });
    else if (target === "rejected") {
      // 'rejected' from dropdown opens inline reason input — keep drawer open
      toast.info(t("admin.reviewsTab.toastEnterReason"));
    }
  };

  const handleReject = (id: number) => {
    if (rejectionReason.trim().length < 3) {
      toast.error(t("admin.reviewsTab.toastReasonTooShort"));
      return;
    }
    rejectMutation.mutate({ id, reason: rejectionReason });
  };

  const photoUrls: string[] = (() => {
    if (!selected?.photos) return [];
    try {
      const parsed = JSON.parse(selected.photos);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusToggle
            label={t("admin.reviewsTab.statusAll")}
            count={counts.all}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <StatusToggle
            label={t("admin.reviewsTab.statusPending")}
            count={counts.pending}
            active={statusFilter === "pending"}
            tone="warn"
            onClick={() => setStatusFilter("pending")}
          />
          <StatusToggle
            label={t("admin.reviewsTab.statusApproved")}
            count={counts.approved}
            active={statusFilter === "approved"}
            tone="success"
            onClick={() => setStatusFilter("approved")}
          />
          <StatusToggle
            label={t("admin.reviewsTab.statusRejected")}
            count={counts.rejected}
            active={statusFilter === "rejected"}
            tone="danger"
            onClick={() => setStatusFilter("rejected")}
          />
          <StatusToggle
            label={t("admin.reviewsTab.statusHidden")}
            count={counts.hidden}
            active={statusFilter === "hidden"}
            tone="muted"
            onClick={() => setStatusFilter("hidden")}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("admin.reviewsTab.searchPlaceholder")}
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
          icon={<Star className="h-8 w-8" />}
          title={t("admin.reviewsTab.emptyTitle")}
          description={t("admin.reviewsTab.emptyDesc")}
        />
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(r) => {
            setSelectedId(r.id);
            setRejectionReason("");
            setDrawerOpen(true);
          }}
          selectedId={selectedId ?? undefined}
        />
      )}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full xl:max-w-5xl xl:rounded-l-xl overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-gray-100">
            <SheetTitle className="text-base flex items-center gap-2">
              <span className="text-gray-500 tabular-nums font-normal">
                #{selected?.id ?? ""}
              </span>
              <span>{t("admin.reviewsTab.detailDialogTitle")}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              {selected?.title ?? ""}
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="space-y-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <StatusDot
                  tone={STATUS_TONE[selected.status]}
                  label={statusLabel(selected.status, t)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 rounded-lg text-xs">
                      {t("admin.reviewsTab.quickStatusLabel")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(["approved", "rejected", "hidden"] as ReviewStatus[]).map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onSelect={() => handleSelectStatus(selected.id, s)}
                        disabled={s === selected.status}
                      >
                        <StatusDot tone={STATUS_TONE[s]} label={statusLabel(s, t)} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.reviewsTab.customerInfoLabel")}</SectionTitle>
                <Field label={t("admin.reviewsTab.columnCustomer")}>
                  {selected.authorName || "—"}
                </Field>
                <Field label="Email">{selected.authorEmail || "—"}</Field>
                <Field label={t("admin.reviewsTab.tourLabel")}>
                  {selected.tourTitle || `Tour #${selected.tourId}`}
                </Field>
                {selected.bookingId && (
                  <Field label={t("admin.reviewsTab.bookingLabel")}>
                    #{selected.bookingId}
                  </Field>
                )}
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.reviewsTab.ratingLabel")}</SectionTitle>
                <StarRating rating={selected.rating} />
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.reviewsTab.titleLabel")}</SectionTitle>
                <p className="text-xs text-gray-900 font-medium">
                  {selected.title || "—"}
                </p>
              </div>

              <div className="space-y-1.5">
                <SectionTitle>{t("admin.reviewsTab.contentLabel")}</SectionTitle>
                <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3">
                  {selected.content || "—"}
                </p>
              </div>

              {photoUrls.length > 0 && (
                <div className="space-y-1.5">
                  <SectionTitle>{t("admin.reviewsTab.photosLabel")}</SectionTitle>
                  <div className="grid grid-cols-3 gap-2">
                    {photoUrls.map((url, idx) => (
                      <img
                        key={idx}
                        src={url}
                        alt={`photo ${idx + 1}`}
                        className="rounded-lg w-full h-20 object-cover border border-gray-200"
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <SectionTitle>{t("admin.reviewsTab.metaLabel")}</SectionTitle>
                <Field label={t("admin.reviewsTab.submittedLabel")}>
                  {formatTime(selected.createdAt)}
                </Field>
                {selected.publishedAt && (
                  <Field label={t("admin.reviewsTab.publishedLabel")}>
                    {formatTime(selected.publishedAt)}
                  </Field>
                )}
                {selected.rejectionReason && (
                  <Field label={t("admin.reviewsTab.rejectionReasonLabel")}>
                    <span className="text-rose-700">{selected.rejectionReason}</span>
                  </Field>
                )}
              </div>

              {/* Action buttons */}
              <div className="pt-3 border-t border-gray-100 space-y-3">
                {selected.status !== "approved" && (
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate({ id: selected.id })}
                      disabled={approveMutation.isPending}
                      className="h-8 rounded-lg gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {approveMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {t("admin.reviewsTab.approveButton")}
                    </Button>
                    {selected.status !== "hidden" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => hideMutation.mutate({ id: selected.id })}
                        disabled={hideMutation.isPending}
                        className="h-8 rounded-lg gap-1"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                        {t("admin.reviewsTab.hideButton")}
                      </Button>
                    )}
                  </div>
                )}
                {selected.status === "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => hideMutation.mutate({ id: selected.id })}
                    disabled={hideMutation.isPending}
                    className="h-8 rounded-lg gap-1"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    {t("admin.reviewsTab.unpublishButton")}
                  </Button>
                )}

                {/* Reject with reason */}
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-[11px] text-gray-500">
                    {t("admin.reviewsTab.rejectHelp")}
                  </p>
                  <Textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder={t("admin.reviewsTab.rejectPlaceholder")}
                    rows={2}
                    className="text-xs rounded-lg"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReject(selected.id)}
                    disabled={
                      rejectMutation.isPending || rejectionReason.trim().length < 3
                    }
                    className="h-8 rounded-lg gap-1 border-rose-300 text-rose-700 hover:bg-rose-50"
                  >
                    {rejectMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    {t("admin.reviewsTab.rejectButton")}
                  </Button>
                </div>

                <div className="flex items-center pt-2">
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
