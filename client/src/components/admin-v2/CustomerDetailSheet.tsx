/**
 * CustomerDetailSheet — full customer profile Sheet (admin.customerDetail).
 *
 * Extracted verbatim from CustomersTabV2 (批2 m1): the workspace per-customer
 * inbox「看完整資料」opens the SAME sheet the CRM table row-click uses, so
 * there is exactly one customer-profile surface to maintain. No behavior
 * change in the move; §2.5 padding contract unchanged (primitive owns px).
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { StatusDot, type StatusTone } from "@/components/admin/primitives";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Users,
  Coins,
  ShoppingBag,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";

export default function CustomerDetailSheet({
  userId,
  open,
  onClose,
}: {
  userId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t, language } = useLocale();
  const dateFnsLocale = language === "en" ? enUS : zhTW;

  const detail = trpc.admin.customerDetail.useQuery(
    { userId: userId! },
    { enabled: open && userId !== null }
  );

  const user = detail.data?.user;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full xl:max-w-2xl xl:rounded-l-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{user?.name || user?.email || "..."}</SheetTitle>
          <SheetDescription>{user?.email}</SheetDescription>
        </SheetHeader>

        {detail.isLoading ? (
          <div className="text-center py-12 text-foreground/40">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </div>
        ) : !user ? (
          <div className="text-center py-12 text-foreground/40">
            {t("admin.customersCrm.notFound")}
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* Quick stats */}
            <div className="grid grid-cols-4 gap-3">
              <MiniStat
                icon={<ShoppingBag className="h-4 w-4" />}
                label={t("admin.customersCrm.colBookings")}
                value={String(user.bookingCount)}
              />
              <MiniStat
                icon={<MessageSquare className="h-4 w-4" />}
                label={t("admin.customersCrm.inquiries")}
                value={String(user.inquiryCount)}
              />
              <MiniStat
                icon={<Coins className="h-4 w-4" />}
                label="PP"
                value={user.packpointBalance.toLocaleString()}
              />
              <MiniStat
                icon={<Users className="h-4 w-4" />}
                label={t("admin.customersCrm.colTier")}
                value={user.tier}
              />
            </div>

            {/* Info row */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label={t("admin.customersCrm.colPhone")} value={user.phone || "—"} />
              <Field label={t("admin.customersCrm.signupDate")} value={new Date(user.createdAt).toLocaleDateString(language === "en" ? "en-US" : "zh-TW")} />
              <Field label={t("admin.customersCrm.colLastActive")} value={formatDistanceToNow(new Date(user.lastSignedIn), { addSuffix: true, locale: dateFnsLocale })} />
              <Field label={t("admin.customersCrm.referralCode")} value={user.referralCode || "—"} />
            </div>

            {/* Recent bookings */}
            <Section title={t("admin.customersCrm.recentBookings")}>
              {(detail.data?.recentBookings ?? []).length === 0 ? (
                <p className="text-sm text-foreground/40">{t("admin.customersCrm.noBookings")}</p>
              ) : (
                <div className="space-y-1.5">
                  {detail.data!.recentBookings.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {b.tourTitle || `#${b.id}`}
                        </div>
                        <div className="text-xs text-foreground/50">
                          {b.numberOfAdults ?? 1}{" "}
                          {t("admin.customersCrm.travelers")}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tabular-nums font-medium">
                          ${Number(b.totalPrice ?? 0).toLocaleString()}
                        </div>
                        <StatusDot
                          tone={bookingTone(b.bookingStatus)}
                          label={b.bookingStatus ?? "unknown"}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Recent inquiries */}
            <Section title={t("admin.customersCrm.recentInquiries")}>
              {(detail.data?.recentInquiries ?? []).length === 0 ? (
                <p className="text-sm text-foreground/40">{t("admin.customersCrm.noInquiries")}</p>
              ) : (
                <div className="space-y-1.5">
                  {detail.data!.recentInquiries.map((inq) => (
                    <div
                      key={inq.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {inq.subject || inq.destination || `#${inq.id}`}
                        </div>
                        <div className="text-xs text-foreground/50 line-clamp-1">
                          {inq.message?.slice(0, 60) || "—"}
                        </div>
                      </div>
                      <StatusDot
                        tone={inquiryTone(inq.status)}
                        label={inq.status ?? "unknown"}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Packpoint history */}
            <Section title={t("admin.customersCrm.packpointHistory")}>
              {(detail.data?.recentPoints ?? []).length === 0 ? (
                <p className="text-sm text-foreground/40">{t("admin.customersCrm.noTransactions")}</p>
              ) : (
                <div className="space-y-1">
                  {detail.data!.recentPoints.map((pt) => (
                    <div
                      key={pt.id}
                      className="flex items-center justify-between py-1.5 px-3 text-sm"
                    >
                      <div>
                        <span className="text-xs text-foreground/50">
                          {pt.reason}
                        </span>
                        {pt.description && (
                          <span className="text-xs text-foreground/40 ml-2">
                            {pt.description}
                          </span>
                        )}
                      </div>
                      <span
                        className={`tabular-nums font-medium ${
                          pt.delta > 0 ? "text-green-600" : "text-red-500"
                        }`}
                      >
                        {pt.delta > 0 ? "+" : ""}
                        {pt.delta}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Private helpers (moved with the sheet) ──────────────────────────────

function bookingTone(status: string | null): StatusTone {
  switch (status) {
    case "confirmed":
    case "completed":
      return "success";
    case "pending":
      return "warn";
    case "cancelled":
      return "danger";
    default:
      return "muted";
  }
}

function inquiryTone(status: string | null): StatusTone {
  switch (status) {
    case "resolved":
    case "closed":
      return "success";
    case "new":
    case "in_progress":
      return "warn";
    case "replied":
      return "info";
    default:
      return "muted";
  }
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3 text-center">
      <div className="mx-auto text-foreground/50 mb-1 flex justify-center">{icon}</div>
      <div className="tabular-nums font-medium text-sm">{value}</div>
      <div className="text-xs text-foreground/50">{label}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground/50">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground/70">{title}</h3>
      {children}
    </div>
  );
}
