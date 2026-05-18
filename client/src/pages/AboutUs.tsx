import MarketingLayout from "@/components/layouts/MarketingLayout";
import SEO from "@/components/SEO";
import { useLocale } from "@/contexts/LocaleContext";

export default function AboutUs() {
  const { t } = useLocale();

  // Round 80.25 — Person Schema for founder Jeff Hsieh + AboutPage schema.
  // Establishes founder identity for AI engines (ChatGPT/Perplexity/Claude)
  // and strengthens E-E-A-T signals for Google. Founder is linked back to
  // the TravelAgency entity declared on the homepage via @id reference.
  const aboutPageSchema = [
    {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      "@id": "https://packgoplay.com/about-us#aboutpage",
      url: "https://packgoplay.com/about-us",
      mainEntity: {
        "@type": "Person",
        "@id": "https://packgoplay.com/about-us#jeffhsieh",
        name: "Jeff Hsieh",
        alternateName: "謝亦德",
        jobTitle: "Founder",
        worksFor: {
          "@id": "https://packgoplay.com#organization",
        },
        knowsLanguage: ["zh-TW", "zh-CN", "en"],
        knowsAbout: [
          "Travel Planning",
          "Custom Itineraries",
          "China Visa Services",
          "Group Tours",
          "Mandarin-speaking travelers",
        ],
        nationality: { "@type": "Country", name: "Taiwan" },
        homeLocation: {
          "@type": "Place",
          name: "Newark, California, USA",
        },
      },
    },
  ];

  return (
    <>
      <SEO
        title={{
          zh: "關於 PACK&GO｜創辦人 Jeff 與 Newark 在地團隊",
          en: "About PACK&GO | Founder Jeff & Our Newark CA Team",
        }}
        description={{
          zh: "PACK&GO Travel LLC 設籍加州 Newark，CST #2166984。創辦人 Jeff 從家庭旅遊規劃師起家，專注華人家庭信任服務。",
          en: "PACK&GO Travel LLC, based in Newark CA, CST #2166984. Founded by Jeff to bring trustworthy Mandarin service to Asian-American families.",
        }}
        image="/images/hero-sakura.webp"
        url="/about-us"
        schema={aboutPageSchema}
      />
      <MarketingLayout
        title={t('aboutUs.title')}
        subtitle={t('aboutUs.subtitle')}
      >
      <p className="lead">{t('aboutUs.intro')}</p>

      {/* Round 80.7: Founder's note — Jeff's emotional anchor.
          Wrapped in a styled blockquote with gold left-border to give it
          weight on the otherwise plain marketing layout. */}
      <h2>{t('aboutUs.founderTitle')}</h2>
      <div className="not-prose my-6 border-l-2 border-[#c9a563]/55 pl-5 md:pl-7 space-y-4 text-foreground/80 leading-relaxed">
        <p>{t('aboutUs.founderP1')}</p>
        <p>{t('aboutUs.founderP2')}</p>
        <p>{t('aboutUs.founderP3')}</p>
        <footer className="pt-2 text-sm">
          <span className="font-semibold text-foreground">— {t('aboutUs.founderSignature')}</span>
          <span className="text-foreground/55 ml-2">· {t('aboutUs.founderRole')}</span>
        </footer>
      </div>

      <h2>{t('aboutUs.mission.title')}</h2>
      <p>{t('aboutUs.mission.content')}</p>

      <h2>{t('aboutUs.servicesTitle')}</h2>
      <ul>
        <li>{t('aboutUs.servicesList.customTours')}</li>
        <li>{t('aboutUs.servicesList.visaServices')}</li>
        <li>{t('aboutUs.servicesList.groupPackages')}</li>
        <li>{t('aboutUs.servicesList.flightBooking')}</li>
        <li>{t('aboutUs.servicesList.airportTransfer')}</li>
        <li>{t('aboutUs.servicesList.hotelBooking')}</li>
      </ul>

      <h2>{t('aboutUs.licencesTitle')}</h2>
      <div className="not-prose grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
        {[
          { label: t('aboutUs.legalEntityLabel'), value: 'Pack & Go, LLC', desc: t('aboutUs.legalEntityDesc') },
          { label: t('aboutUs.cityLicenceLabel'), value: 'Newark #115594', desc: t('aboutUs.cityLicenceDesc') },
          { label: t('aboutUs.cstLabel'), value: 'CST #2166984', desc: t('aboutUs.cstDesc') },
          { label: t('aboutUs.consumerProtectionLabel'), value: t('aboutUs.tcrfParticipant'), desc: t('aboutUs.consumerProtectionDesc') },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-foreground/15 bg-white p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/55 mb-1.5">{card.label}</p>
            <p className="font-serif font-semibold text-foreground text-lg">{card.value}</p>
            <p className="text-sm text-foreground/65 mt-1.5 leading-relaxed">{card.desc}</p>
          </div>
        ))}
      </div>

      <h2>{t('aboutUs.contactTitle')}</h2>
      <p>
        <strong>{t('aboutUs.address')}：</strong>39055 Cedar Blvd #126, Newark, CA 94560, USA<br />
        <strong>{t('aboutUs.phone')}：</strong>+1 (510) 634-2307<br />
        <strong>{t('aboutUs.email')}：</strong>Jeffhsieh09@gmail.com
      </p>
      </MarketingLayout>
    </>
  );
}
