/**
 * Membership landing — 單一免費層。
 *
 * 2026-07-25 Jeff 裁定:砍掉 Plus 與 Concierge 付費層,會員制改為完全免費,
 * 權益只保留 Packpoint 積分。理由(三項,前兩項是法遵):
 *
 *   一、加州 Business and Professions Code 17550.27(Seller of Travel Discount
 *       Program)管的就是「收費會員 + 賣點是折扣或優待」這種組合。落進去要同時
 *       維持 10 萬美元保證金、年費上限 150 美元、續約授權不得在到期前 60 天以上
 *       取得。最後一項與 Stripe 訂閱「加入當下取得永久扣款同意」直接牴觸。
 *   二、加州自動續訂法(現行控制版本 AB 2863,2025-01-01 生效)的揭露、獨立同意、
 *       續訂前通知、線上取消義務,一人公司的維護成本與收益不成比例。
 *   三、同業(雄獅、雄獅嚴選、Trip.com、走四方、途風)忠誠方案全部免費。
 *
 * 本頁因此不再有:價格、月付年付切換、免費試用、Stripe 結帳、訂閱管理。
 * 結構由 client/src/pages/Membership.test.ts 鎖住,要恢復付費層必須先完成上述
 * 法遵並更新該測試,不得直接刪測試。
 *
 * server/routers/membership.ts 的訂閱路由已於同批移除(2026-07-26 R2 更正),
 * 本頁也不再呼叫任何訂閱端點。
 */
import { Link } from "wouter";
import { Check, Sparkles, ArrowRight, Phone } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import SEO from "@/components/SEO";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function Membership() {
  const { t, language } = useLocale();

  const tiers = [
    {
      key: "free" as const,
      icon: Sparkles,
      name: t("membership.freeTitle"),
      price: t("membership.freePrice"),
      saveHint: null as string | null,
      tagline: t("membership.freeTagline"),
      // 2026-07-25 Jeff 裁定:會員權益只保留 Packpoint 積分。
      // 刪除的四項與理由:
      //   featNoFeeChange(60 天免費改期)  bookings.ts 沒有改期功能,做不到
      //   featDedicatedAdvisor(4h 內回覆) 沒有任何排隊或限額機制,一人公司旺季必跳票
      //   featAiFree / featAiUnlimited     有實作但屬服務承諾,Jeff 裁定不當權益賣
      //   featPhotoBook(年度相片書)       改由 Packpoint 兌換,不列為方案權益
      // 保留項全部有實作:packpoint.ts 的累積扣抵、packpointMaintenanceQueue 的自動升等。
      // 成本護欄不動:單筆最多折抵 50%、單筆發放不超過訂單 20%、最低兌換 100 點。
      // 2026-07-26 R2(P1-3):featNewsletter 自權益清單移除。Jeff 原話
      // 「會員積分就可以了」;電子報是行銷通路,不是會員權益。
      features: [
        { text: t("membership.featPackpointFree"), included: true },
        { text: t("membership.featPackpointBonuses"), included: true },
        { text: t("membership.featAutoUpgrade"), included: true },
      ],
      cta: t("membership.freeCta"),
      ctaLink: "/",
      highlight: false,
    },
  ];

  return (
    <>
      <SEO
        title={t("membership.seoTitle")}
        description={t("membership.seoDesc")}
      />
      <Header />
      <main className="min-h-screen bg-white">
        {/* Hero */}
        <section className="bg-foreground text-white py-16 md:py-24">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <p className="text-xs tracking-[0.3em] uppercase text-[#c9a563] mb-4">
              {t("membership.eyebrow")}
            </p>
            <h1 className="font-serif font-bold text-4xl md:text-5xl lg:text-6xl leading-tight mb-5 tracking-tight">
              {t("membership.heroTitle")}
            </h1>
            <p className="text-base md:text-lg text-white/80 leading-relaxed">
              {t("membership.heroSubtitle")}
            </p>
            <div className="h-px bg-gradient-to-r from-transparent via-[#c9a563]/40 to-transparent mt-10" />
          </div>
        </section>

        {/* Pricing */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-6 max-w-6xl">

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {tiers.map((tier) => {
                const Icon = tier.icon;
                return (
                  <div
                    key={tier.key}
                    className={`rounded-xl border p-6 md:p-8 flex flex-col ${
                      tier.highlight
                        ? "bg-foreground text-white border-[#c9a563] shadow-2xl scale-100 md:scale-[1.03] relative"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    {tier.highlight && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#c9a563] text-foreground text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full">
                        {t("membership.popular")}
                      </span>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          tier.highlight ? "bg-[#c9a563]/20" : "bg-foreground/5"
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 ${
                            tier.highlight ? "text-[#c9a563]" : "text-foreground/60"
                          }`}
                        />
                      </div>
                      <h2
                        className={`font-serif text-xl font-bold ${
                          tier.highlight ? "text-white" : "text-foreground"
                        }`}
                      >
                        {tier.name}
                      </h2>
                    </div>
                    <p
                      className={`text-sm mb-3 ${
                        tier.highlight ? "text-white/70" : "text-foreground/60"
                      }`}
                    >
                      {tier.tagline}
                    </p>
                    <div className="mb-6">
                      <div className="flex items-baseline gap-1">
                        <span
                          className={`text-4xl font-bold tracking-tight ${
                            tier.highlight ? "text-white" : "text-foreground"
                          }`}
                        >
                          {tier.price}
                        </span>
                      </div>
                      {tier.saveHint && (
                        <p
                          className={`mt-1 text-[11px] font-medium ${
                            tier.highlight ? "text-[#c9a563]" : "text-[#8a6f3a]"
                          }`}
                        >
                          {tier.saveHint}
                        </p>
                      )}
                    </div>
                    <ul className="flex-1 space-y-2.5 mb-6">
                      {tier.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          {/* 2026-07-25:單一免費層,所有列出的權益都包含,
                              不再需要「未包含」的打叉與刪除線分支。 */}
                          <Check
                            className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                              tier.highlight ? "text-[#c9a563]" : "text-foreground/70"
                            }`}
                          />
                          <span
                            className={
                              tier.highlight
                                ? "text-white"
                                : "text-foreground"
                            }
                          >
                            {f.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={tier.ctaLink}
                      className="inline-flex items-center justify-center gap-2 h-11 rounded-lg font-semibold text-sm transition-colors border border-foreground/20 text-foreground hover:bg-foreground/5"
                    >
                      {tier.cta}
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                );
              })}
            </div>

            {/* Soft launch notice */}
            <div className="mt-12 max-w-2xl mx-auto text-center">
              <p className="text-xs tracking-[0.3em] uppercase text-[#8a6f3a] mb-2">
                {t("membership.softLaunchEyebrow")}
              </p>
              <p className="text-sm text-foreground/70 leading-relaxed">
                {t("membership.softLaunchBody")}
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-[#FAF8F2] py-12 border-t border-foreground/8">
          <div className="container mx-auto px-6 text-center max-w-2xl">
            <p className="text-sm text-foreground/60 mb-3">{t("membership.contactHint")}</p>
            <a
              href="tel:+15106342307"
              className="inline-flex items-center gap-2 text-foreground hover:text-[#8a6f3a] transition-colors font-semibold"
            >
              <Phone className="w-4 h-4 text-[#c9a563]" />
              +1 (510) 634-2307
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
