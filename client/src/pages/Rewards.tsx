/**
 * Rewards page — Round 80.22 Phase F.
 *
 * Public-facing catalog where members redeem Packpoint for vouchers
 * (flight credit, photo book, etc.). Two sections:
 *   1. Catalog grid: all available SKUs with cost/value/CTA.
 *   2. My Vouchers: list of issued vouchers with code + expiry.
 *
 * Logged-out users see the catalog as marketing (with login CTA).
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Coins,
  Plane,
  BookOpen,
  Ticket,
  Loader2,
  Check,
  AlertCircle,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

const TYPE_ICON: Record<string, any> = {
  flight_credit: Plane,
  photo_book: BookOpen,
  tour_credit: Ticket,
};

// Round 80.25 — colors are static; labels look up via t() at render-time so
// they localize. Keep this map keyed by status so the lookup site reads cleanly.
const STATUS_COLOR: Record<string, string> = {
  issued: "bg-green-100 text-green-800",
  redeemed: "bg-gray-100 text-gray-700",
  expired: "bg-red-100 text-red-800",
  voided: "bg-red-100 text-red-800",
};

export default function Rewards() {
  const { language, t } = useLocale();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [confirmSku, setConfirmSku] = useState<string | null>(null);

  const { data: catalog, isLoading: catalogLoading } = trpc.vouchers.catalog.useQuery();
  const { data: status } = trpc.packpoint.getStatus.useQuery();
  const { data: myVouchers } = trpc.vouchers.myVouchers.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const redeemMutation = trpc.vouchers.redeem.useMutation({
    onSuccess: (res) => {
      toast.success(`兌換成功!Voucher 代碼:${res.code}`);
      setConfirmSku(null);
      utils.vouchers.myVouchers.invalidate();
      utils.packpoint.getStatus.invalidate();
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const balance = status?.balance ?? 0;
  const dollarValue = (balance / 100).toFixed(2);

  const confirmItem = catalog?.find((c) => c.sku === confirmSku);

  return (
    <>
      <SEO
        title={{ zh: "Packpoint 兌換中心｜PACK&GO", en: "Rewards · PACK&GO" }}
        description={{
          zh: "用 Packpoint 兌換機票折抵券、私人旅遊相簿、行程加值服務。",
          en: "Redeem Packpoint for flight credits, photo books, and trip upgrades.",
        }}
      />
      <Header />
      <main className="min-h-screen bg-white">
        {/* Hero */}
        <section className="bg-foreground text-white py-16 md:py-24">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <p className="text-xs tracking-[0.3em] uppercase text-[#c9a563] mb-4">
              {t("rewards.heroEyebrow")}
            </p>
            <h1 className="font-serif font-bold text-4xl md:text-5xl mb-5 tracking-tight">
              {t("rewards.heroTitle")}
            </h1>
            <p className="text-base md:text-lg text-white/80 leading-relaxed mb-6">
              {t("rewards.heroSubtitle")}
            </p>
            {isAuthenticated && status && (
              <div className="inline-flex items-center gap-3 bg-white/[0.06] border border-[#c9a563]/30 rounded-full px-6 py-3">
                <Coins className="h-5 w-5 text-[#c9a563]" />
                <span className="text-sm tracking-wider">
                  {t("rewards.currentBalance")}{" "}
                  <strong className="text-white text-lg tabular-nums">
                    {balance.toLocaleString()}
                  </strong>{" "}
                  {t("rewards.pointsWithValue", { value: String(dollarValue) })}
                </span>
              </div>
            )}
            {!isAuthenticated && (
              <Link
                href="/login?redirect=/rewards"
                className="inline-flex items-center gap-2 bg-[#c9a563] text-foreground hover:bg-[#d4b478] transition-colors px-5 py-3 rounded-lg font-semibold text-sm"
              >
                登入查看餘額
              </Link>
            )}
          </div>
        </section>

        {/* Catalog */}
        <section className="py-16">
          <div className="container mx-auto px-6 max-w-6xl">
            <h2 className="text-xs uppercase tracking-[0.3em] text-[#8a6f3a] mb-6">
              可兌換項目
            </h2>
            {catalogLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-[#c9a563]" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {catalog?.map((item) => {
                  const Icon = TYPE_ICON[item.type] ?? Ticket;
                  const canAfford = balance >= item.pointsCost;
                  const isBlocked = !!item.gateBlocked;
                  const title = language === "en" ? item.titleEn : item.titleZh;
                  const desc = language === "en" ? item.descriptionEn : item.descriptionZh;
                  return (
                    <div
                      key={item.sku}
                      className={`rounded-xl border p-6 flex flex-col ${
                        isBlocked
                          ? "border-foreground/10 bg-foreground/[0.02] opacity-70"
                          : "border-foreground/10 bg-white shadow-sm hover:shadow-md transition-shadow"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-lg bg-[#c9a563]/15 flex items-center justify-center">
                          <Icon className="w-5 h-5 text-[#8a6f3a]" />
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-foreground tabular-nums">
                            {item.pointsCost.toLocaleString()}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-foreground/50">
                            Packpoint
                          </div>
                        </div>
                      </div>
                      <h3 className="font-serif text-lg font-bold mb-1">{title}</h3>
                      <p className="text-sm text-foreground/65 mb-4 leading-relaxed flex-1">
                        {desc}
                      </p>
                      <div className="flex items-center justify-between text-xs text-foreground/50 mb-4">
                        <span>價值 ${item.amountUsd}</span>
                        <span>12 個月有效</span>
                      </div>

                      {isBlocked && (
                        <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-2 mb-3">
                          <AlertCircle className="h-3.5 w-3.5 text-yellow-700 flex-shrink-0 mt-0.5" />
                          <p className="text-[11px] text-yellow-900 leading-snug">
                            {item.gateBlocked}
                          </p>
                        </div>
                      )}

                      <Button
                        disabled={!isAuthenticated || isBlocked || !canAfford}
                        onClick={() => setConfirmSku(item.sku)}
                        className={`w-full rounded-lg ${
                          canAfford && !isBlocked
                            ? "bg-foreground text-white hover:bg-foreground/90"
                            : "bg-foreground/10 text-foreground/50 cursor-not-allowed"
                        }`}
                      >
                        {!isAuthenticated
                          ? "登入後兌換"
                          : isBlocked
                          ? "暫無法兌換"
                          : !canAfford
                          ? `還差 ${(item.pointsCost - balance).toLocaleString()} 點`
                          : "立即兌換"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* My vouchers */}
        {isAuthenticated && (
          <section className="py-16 bg-foreground/[0.02] border-t border-foreground/8">
            <div className="container mx-auto px-6 max-w-4xl">
              <h2 className="text-xs uppercase tracking-[0.3em] text-[#8a6f3a] mb-6">
                我的 Voucher
              </h2>
              {!myVouchers || myVouchers.length === 0 ? (
                <p className="text-sm text-foreground/50 py-8 text-center">
                  尚無兌換紀錄。從上方選一項開始兌換。
                </p>
              ) : (
                <div className="space-y-3">
                  {myVouchers.map((v) => (
                    <VoucherRow key={v.id} voucher={v} />
                  ))}
                </div>
              )}
              <div className="mt-8 text-xs text-foreground/50 leading-relaxed">
                <p className="font-semibold text-foreground/70 mb-1">{t("rewards.howToUse")}</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>{t("rewards.howToUseFlightCredit")}</li>
                  <li>{t("rewards.howToUsePhotoBook")}</li>
                  <li>{t("rewards.howToUseValidity")}</li>
                </ul>
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />

      {/* Confirm dialog */}
      <Dialog open={!!confirmSku} onOpenChange={(open) => !open && setConfirmSku(null)}>
        <DialogContent className="rounded-xl">
          {confirmItem && (
            <>
              <DialogHeader>
                <DialogTitle>{t("rewards.confirmRedeem")}</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60">{t("rewards.item")}</span>
                  <span className="font-semibold">
                    {language === "en" ? confirmItem.titleEn : confirmItem.titleZh}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60">{t("rewards.deductPoints")}</span>
                  <span className="font-bold text-[#8a6f3a]">
                    -{confirmItem.pointsCost.toLocaleString()} Packpoint
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60">{t("rewards.balanceAfterRedeem")}</span>
                  <span className="font-semibold tabular-nums">
                    {(balance - confirmItem.pointsCost).toLocaleString()} Packpoint
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground/60">{t("rewards.voucherValue")}</span>
                  <span className="font-semibold">${confirmItem.amountUsd}</span>
                </div>
                <p className="text-xs text-foreground/50 bg-foreground/5 rounded-lg p-3 mt-4">
                  {t("rewards.redeemNote")}
                </p>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmSku(null)}
                  className="rounded-lg"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => redeemMutation.mutate({ sku: confirmItem.sku })}
                  disabled={redeemMutation.isPending}
                  className="bg-[#c9a563] hover:bg-[#d4b478] text-foreground rounded-lg"
                >
                  {redeemMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  {t("rewards.confirmRedeem")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function VoucherRow({ voucher }: { voucher: any }) {
  const { language, t } = useLocale();
  const [copied, setCopied] = useState(false);
  const STATUS_KEY: Record<string, string> = {
    issued: "rewards.voucherStatusIssued",
    redeemed: "rewards.voucherStatusRedeemed",
    expired: "rewards.voucherStatusExpired",
    voided: "rewards.voucherStatusVoided",
  };
  const color = STATUS_COLOR[voucher.status] ?? STATUS_COLOR.issued;
  const label = t(STATUS_KEY[voucher.status] ?? STATUS_KEY.issued);
  const Icon = TYPE_ICON[voucher.type] ?? Ticket;
  const isActive = voucher.status === "issued";
  const expiresIn = Math.ceil(
    (new Date(voucher.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(voucher.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      className={`bg-white border rounded-xl p-4 flex items-center justify-between gap-4 ${
        isActive ? "border-[#c9a563]/30" : "border-foreground/10 opacity-75"
      }`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-[#c9a563]/15 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-[#8a6f3a]" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground">
            ${voucher.amountUsd}{" "}
            {voucher.type === "flight_credit"
              ? "機票券"
              : voucher.type === "photo_book"
              ? "相簿券"
              : "行程券"}
          </p>
          <code className="text-xs font-mono text-foreground/70 select-all">
            {voucher.code}
          </code>
        </div>
      </div>

      <div className="text-right text-xs flex flex-col items-end gap-1">
        <span className={`px-2 py-0.5 rounded font-semibold ${color}`}>{label}</span>
        {isActive && expiresIn > 0 && (
          <span className="text-foreground/50">
            {t("rewards.expiresInDays", { days: String(expiresIn) })}
          </span>
        )}
        {voucher.redeemedAt && (
          <span className="text-foreground/50">
            {t("rewards.redeemedOn", {
              date: new Date(voucher.redeemedAt).toLocaleDateString(language === "en" ? "en-US" : "zh-TW"),
            })}
          </span>
        )}
      </div>

      {isActive && (
        <button
          type="button"
          onClick={copyCode}
          className="rounded-lg border border-foreground/20 hover:bg-foreground/5 px-2.5 py-1.5 text-xs flex items-center gap-1 flex-shrink-0"
        >
          {copied ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-green-700" /> 已複製
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> 複製
            </>
          )}
        </button>
      )}
    </div>
  );
}
