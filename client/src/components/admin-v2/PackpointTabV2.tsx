/**
 * PackpointTabV2 — Trip.com-style loyalty admin (Round 81 v2).
 *
 * V1 was a "search by email → adjust balance + trigger maintenance" form.
 * V2 keeps the same workflows but in the v2 visual idiom:
 *   - Search box for user email (no status filter — there are no statuses)
 *   - Refresh + manual-maintenance trigger in the header
 *   - When a user is found, they render as a single dense row in the
 *     DataTable (clickable to open the DetailDrawer)
 *   - DetailDrawer: user info, balance / lifetime, tier, adjust form
 *
 * Backend wire: trpc.admin.lookupUserByEmail + packpoint.adminAdjust +
 * packpoint.adminTriggerMaintenance — no migration.
 *
 * Phase C tab #4 (Bookings was #1). 2026-05-22.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DataTable,
  EmptyState,
  type Column,
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
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PackpointUser = {
  id: number;
  email: string;
  name: string | null;
  tier: string;
  balance: number;
  lifetime: number;
};

export default function PackpointTabV2() {
  const { t } = useLocale();
  const [searchEmail, setSearchEmail] = useState("");
  const [foundUser, setFoundUser] = useState<PackpointUser | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adjustDelta, setAdjustDelta] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState<string>("");

  const adminLookupQuery = trpc.admin.lookupUserByEmail.useQuery(
    { email: searchEmail.trim() },
    { enabled: false, retry: false },
  );

  const adjustMutation = trpc.packpoint.adminAdjust.useMutation({
    onSuccess: (res) => {
      toast.success(
        t("admin.packpointTab.toastAdjustSuccess", {
          n: res.newBalance.toLocaleString(),
        }),
      );
      setAdjustDelta(0);
      setAdjustReason("");
      // Refetch user balance
      handleSearch();
    },
    onError: (e) => toast.error(e.message),
  });

  const triggerMutation = trpc.packpoint.adminTriggerMaintenance.useMutation({
    onSuccess: (res) =>
      toast.success(
        t("admin.packpointTab.toastMaintenanceQueued", { id: String(res.jobId) }),
      ),
    onError: (e) => toast.error(e.message),
  });

  const handleSearch = async () => {
    if (!searchEmail.trim()) {
      toast.error(t("admin.packpointTab.toastEmptyEmail"));
      return;
    }
    try {
      const result = await adminLookupQuery.refetch();
      if (result.data) {
        setFoundUser(result.data);
      } else {
        setFoundUser(null);
        toast.error(t("admin.packpointTab.toastNotFound"));
      }
    } catch (err: any) {
      toast.error(err.message || t("admin.packpointTab.toastSearchFailed"));
      setFoundUser(null);
    }
  };

  const rows = useMemo<PackpointUser[]>(
    () => (foundUser ? [foundUser] : []),
    [foundUser],
  );

  const columns: Column<PackpointUser>[] = [
    {
      key: "id",
      header: "#",
      width: "w-16",
      sortable: true,
      sortValue: (u) => u.id,
      render: (u) => <span className="text-gray-500 tabular-nums">#{u.id}</span>,
    },
    {
      key: "user",
      header: t("admin.packpointTab.columnUser"),
      sortable: true,
      sortValue: (u) => u.name ?? "",
      render: (u) => (
        <div className="min-w-0">
          <div className="text-gray-900 truncate font-medium">{u.name || "—"}</div>
          <div className="text-[11px] text-gray-500 truncate">{u.email}</div>
        </div>
      ),
    },
    {
      key: "tier",
      header: t("admin.packpointTab.columnTier"),
      width: "w-24",
      sortable: true,
      sortValue: (u) => u.tier,
      render: (u) => (
        <span className="text-xs capitalize text-gray-700">{u.tier}</span>
      ),
    },
    {
      key: "balance",
      header: t("admin.packpointTab.columnBalance"),
      width: "w-28",
      align: "right",
      sortable: true,
      sortValue: (u) => u.balance,
      render: (u) => (
        <span className="tabular-nums font-semibold text-[#8a6f3a]">
          {u.balance.toLocaleString()}
        </span>
      ),
    },
    {
      key: "lifetime",
      header: t("admin.packpointTab.columnLifetime"),
      width: "w-28",
      align: "right",
      sortable: true,
      sortValue: (u) => u.lifetime,
      render: (u) => (
        <span className="tabular-nums text-gray-700">
          {u.lifetime.toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="text-xs text-gray-500 flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-[#c9a563]" />
            <span>{t("admin.packpointTab.title")}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={t("admin.packpointTab.searchPlaceholder")}
              className="h-8 rounded-lg pl-8 text-xs w-64"
            />
            {searchEmail && (
              <button
                type="button"
                onClick={() => {
                  setSearchEmail("");
                  setFoundUser(null);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label={t("common.clear")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleSearch}
            disabled={adminLookupQuery.isFetching || !searchEmail.trim()}
            className="h-8 rounded-lg gap-1.5"
          >
            {adminLookupQuery.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {t("admin.packpointTab.searchButton")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            className="h-8 rounded-lg gap-1.5"
          >
            {triggerMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("admin.packpointTab.triggerMaintenanceButton")}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Coins className="h-8 w-8" />}
          title={t("admin.packpointTab.emptyTitle")}
          description={t("admin.packpointTab.emptyDesc")}
        />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          onRowClick={(u) => {
            setFoundUser(u);
            setDrawerOpen(true);
          }}
          selectedId={foundUser?.id}
        />
      )}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full 2xl:max-w-5xl 2xl:rounded-l-xl overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-gray-100">
            <SheetTitle className="text-base flex items-center gap-2">
              <Coins className="h-4 w-4 text-[#c9a563]" />
              <span>{t("admin.packpointTab.detailDialogTitle")}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              {foundUser?.email ?? ""}
            </SheetDescription>
          </SheetHeader>

          {foundUser && (
            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <SectionTitle>{t("admin.packpointTab.userInfoLabel")}</SectionTitle>
                <Field label={t("admin.packpointTab.nameLabel")}>
                  {foundUser.name || "—"}
                </Field>
                <Field label="Email">{foundUser.email}</Field>
                <Field label={t("admin.packpointTab.tierLabel")}>
                  <span className="capitalize">{foundUser.tier}</span>
                </Field>
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.packpointTab.balanceLabel")}</SectionTitle>
                <Field label={t("admin.packpointTab.currentBalance")}>
                  <span className="font-semibold text-[#8a6f3a] tabular-nums">
                    {foundUser.balance.toLocaleString()} pts
                  </span>
                </Field>
                <Field label={t("admin.packpointTab.lifetimeLabel")}>
                  <span className="tabular-nums">
                    {foundUser.lifetime.toLocaleString()} pts
                  </span>
                </Field>
              </div>

              <div className="space-y-2">
                <SectionTitle>{t("admin.packpointTab.adjustLabel")}</SectionTitle>
                <p className="text-[11px] text-gray-500">
                  {t("admin.packpointTab.adjustHelp")}
                </p>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="delta" className="text-[11px] text-gray-600">
                      {t("admin.packpointTab.deltaLabel")}
                    </Label>
                    <Input
                      id="delta"
                      type="number"
                      value={adjustDelta || ""}
                      onChange={(e) =>
                        setAdjustDelta(parseInt(e.target.value, 10) || 0)
                      }
                      placeholder={t("admin.packpointTab.deltaPlaceholder")}
                      className="mt-1 h-8 rounded-lg text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <Label htmlFor="reason" className="text-[11px] text-gray-600">
                      {t("admin.packpointTab.reasonLabel")}
                    </Label>
                    <Input
                      id="reason"
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder={t("admin.packpointTab.reasonPlaceholder")}
                      className="mt-1 h-8 rounded-lg text-xs"
                      maxLength={500}
                    />
                  </div>
                </div>
                {adjustDelta !== 0 && (
                  <p className="text-[11px] text-gray-500">
                    {t("admin.packpointTab.projectedBalance")}:{" "}
                    <span className="font-semibold text-gray-900 tabular-nums">
                      {Math.max(0, foundUser.balance + adjustDelta).toLocaleString()} pts
                    </span>
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() =>
                    adjustMutation.mutate({
                      userId: foundUser.id,
                      delta: adjustDelta,
                      description: adjustReason,
                    })
                  }
                  disabled={
                    adjustMutation.isPending ||
                    adjustDelta === 0 ||
                    adjustReason.length < 3
                  }
                  className="h-8 rounded-lg gap-1 bg-[#c9a563] hover:bg-[#d4b478] text-gray-900"
                >
                  {adjustMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : adjustDelta > 0 ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {adjustDelta > 0
                    ? t("admin.packpointTab.addButton", {
                        n: Math.abs(adjustDelta).toLocaleString(),
                      })
                    : adjustDelta < 0
                      ? t("admin.packpointTab.deductButton", {
                          n: Math.abs(adjustDelta).toLocaleString(),
                        })
                      : t("admin.packpointTab.confirmAdjust")}
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
