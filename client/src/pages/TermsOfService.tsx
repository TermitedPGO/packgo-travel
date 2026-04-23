import GenericPage from "@/components/GenericPage";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Terms of Service — Pack & Go, LLC
 *
 * Includes the mandatory disclosures required of a California registered
 * Seller of Travel under California Business & Professions Code
 * §§17550 – 17550.30, and the 9 itinerary-level disclosures enumerated
 * in "Disclosures From Sellers of Travel" (CA DOJ, 2015-08-28 rev.).
 *
 * The text below is PLAIN LANGUAGE reflecting the statutes; review by
 * licensed California counsel is still recommended before relying on
 * these terms in a contested transaction.
 */
export default function TermsOfService() {
  const { t, tArray } = useLocale();

  const Section = ({ h, p }: { h: string; p: string[] }) => (
    <>
      <h2 className="text-2xl font-bold text-black mt-8">{h}</h2>
      {p.map((para, i) => (
        <p key={i} className="mt-3 leading-relaxed">
          {para}
        </p>
      ))}
    </>
  );

  return (
    <GenericPage
      title={t('termsOfService.fullTerms.title')}
      subtitle={t('termsOfService.fullTerms.subtitle')}
    >
      <div className="space-y-4 text-gray-700 max-w-4xl">
        <p className="text-sm text-gray-500">
          {t('termsOfService.fullTerms.effective')}: 2026-04-18
        </p>

        <p className="leading-relaxed">{t('termsOfService.fullTerms.intro')}</p>

        <Section h={t('termsOfService.fullTerms.s1h')} p={tArray('termsOfService.fullTerms.s1p')} />
        <Section h={t('termsOfService.fullTerms.s2h')} p={tArray('termsOfService.fullTerms.s2p')} />
        <Section h={t('termsOfService.fullTerms.s3h')} p={tArray('termsOfService.fullTerms.s3p')} />
        <Section h={t('termsOfService.fullTerms.s4h')} p={tArray('termsOfService.fullTerms.s4p')} />
        <Section h={t('termsOfService.fullTerms.s5h')} p={tArray('termsOfService.fullTerms.s5p')} />
        <Section h={t('termsOfService.fullTerms.s6h')} p={tArray('termsOfService.fullTerms.s6p')} />
        <Section h={t('termsOfService.fullTerms.s7h')} p={tArray('termsOfService.fullTerms.s7p')} />
        <Section h={t('termsOfService.fullTerms.s8h')} p={tArray('termsOfService.fullTerms.s8p')} />
        <Section h={t('termsOfService.fullTerms.s9h')} p={tArray('termsOfService.fullTerms.s9p')} />
        <Section h={t('termsOfService.fullTerms.s10h')} p={tArray('termsOfService.fullTerms.s10p')} />
        <Section h={t('termsOfService.fullTerms.s11h')} p={tArray('termsOfService.fullTerms.s11p')} />

        <div className="mt-12 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
          <p>{t('termsOfService.fullTerms.dojFooter')}</p>
        </div>
      </div>
    </GenericPage>
  );
}
