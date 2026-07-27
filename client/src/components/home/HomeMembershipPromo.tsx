/**
 * 首頁會員促銷區塊。2026-07-25 Jeff 裁定會員制為免費單層,本區塊
 * 從付費 Plus 推銷卡改為免費會員說明卡:無價格、無月付年付、無試用。
 * 權益只講有實作的 Packpoint 積分(100 點 = $1 折抵是 packpoint.ts 的
 * 既有換算)。倍率、上限、效期未定案,文案不得出現具體倍數承諾。
 */
import { Link } from "wouter";
import { Star, ArrowRight, Check } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

export default function HomeMembershipPromo() {
  const { t } = useLocale();

  return (
    <section className="py-16 md:py-24 bg-foreground text-white">
      <div className="container mx-auto px-6 max-w-5xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          {/* Left: pitch */}
          <div>
            <p className="text-xs tracking-[0.3em] uppercase text-[#c9a563] mb-4 flex items-center gap-2">
              <Star className="w-3.5 h-3.5 fill-current" />
              {t("homeMembership.eyebrow")}
            </p>
            <h2 className="font-serif font-bold text-3xl md:text-4xl lg:text-5xl leading-tight mb-5 tracking-tight">
              {t("homeMembership.title")}
            </h2>
            <p className="text-base text-white/75 leading-relaxed mb-6 max-w-lg">
              {t("homeMembership.subtitle")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/membership"
                className="inline-flex items-center gap-2 bg-[#c9a563] text-foreground hover:bg-[#d4b478] transition-colors px-5 py-3 rounded-lg font-semibold text-sm"
              >
                {t("homeMembership.ctaPrimary")}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/membership"
                className="inline-flex items-center gap-2 text-white/80 hover:text-white transition-colors text-sm font-medium"
              >
                {t("homeMembership.ctaSecondary")}
              </Link>
            </div>
          </div>

          {/* Right: free membership benefit card */}
          <div className="bg-white/[0.04] border border-[#c9a563]/30 rounded-xl p-6 md:p-8 backdrop-blur-sm">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-xs uppercase tracking-[0.2em] text-[#c9a563] font-semibold">
                {t("homeMembership.freeBadge")}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mb-5 flex-wrap">
              <span className="text-4xl md:text-5xl font-bold text-white tracking-tight">
                {t("homeMembership.freePrice")}
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                t("homeMembership.benefit1"),
                t("homeMembership.benefit2"),
                t("homeMembership.benefit3"),
                t("homeMembership.benefit4"),
              ].map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-white/85">
                  <Check className="w-4 h-4 text-[#c9a563] flex-shrink-0 mt-0.5" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
