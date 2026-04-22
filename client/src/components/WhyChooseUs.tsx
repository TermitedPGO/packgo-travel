import { Shield, Clock, Users, Star, Globe, Headphones } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

export default function WhyChooseUs() {
  const { t } = useLocale();

  const reasons = [
    {
      icon: Shield,
      title: t("whyChooseUs.reason1Title"),
      desc: t("whyChooseUs.reason1Desc"),
    },
    {
      icon: Users,
      title: t("whyChooseUs.reason2Title"),
      desc: t("whyChooseUs.reason2Desc"),
    },
    {
      icon: Globe,
      title: t("whyChooseUs.reason3Title"),
      desc: t("whyChooseUs.reason3Desc"),
    },
    {
      icon: Star,
      title: t("whyChooseUs.reason4Title"),
      desc: t("whyChooseUs.reason4Desc"),
    },
    {
      icon: Clock,
      title: t("whyChooseUs.reason5Title"),
      desc: t("whyChooseUs.reason5Desc"),
    },
    {
      icon: Headphones,
      title: t("whyChooseUs.reason6Title"),
      desc: t("whyChooseUs.reason6Desc"),
    },
  ];

  return (
    <section className="py-16 bg-black text-white border-b border-gray-800">
      <div className="container">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="text-xs font-bold tracking-[0.3em] text-gray-400 uppercase mb-3">
            {t("whyChooseUs.eyebrow")}
          </p>
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-white mb-4">
            {t("whyChooseUs.title")}
          </h2>
          <p className="text-gray-400 text-base max-w-2xl mx-auto leading-relaxed">
            {t("whyChooseUs.subtitle")}
          </p>
        </div>

        {/* Reasons Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reasons.map((reason, index) => {
            const Icon = reason.icon;
            return (
              <div
                key={index}
                className="rounded-xl border border-gray-700 p-4 sm:p-6 hover:border-white transition-colors duration-300 group"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-lg border border-gray-600 group-hover:border-white flex items-center justify-center transition-colors">
                    <Icon className="h-5 w-5 text-gray-400 group-hover:text-white transition-colors" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-2">
                      {reason.title}
                    </h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                      {reason.desc}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/*
          Stats Row removed per FTC Act §5 (deceptive acts/practices) and
          16 CFR Part 260 (advertising substantiation).
          Prior hardcoded numbers ("10+ years", "1,200+ travelers",
          "50+ destinations", "98% satisfaction") had no reasonable basis
          documented. Re-introduce only when backed by auditable data
          (e.g., tRPC query over bookings table with tourist-facing caveats).
        */}
      </div>
    </section>
  );
}
