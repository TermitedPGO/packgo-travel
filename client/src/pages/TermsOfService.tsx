import MarketingLayout from "@/components/layouts/MarketingLayout";
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
      <h2>{h}</h2>
      {p.map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </>
  );

  return (
    <MarketingLayout
      title={t('termsOfService.fullTerms.title')}
      subtitle={t('termsOfService.fullTerms.subtitle')}
    >
      <p className="!text-sm !text-foreground/50 !mt-0">
        {t('termsOfService.fullTerms.effective')}: 2026-04-18
      </p>

      <p className="lead">{t('termsOfService.fullTerms.intro')}</p>

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

      <div className="not-prose mt-12 rounded-xl border border-primary/15 bg-primary/5 p-5 text-sm text-foreground/70 leading-relaxed">
        <p>{t('termsOfService.fullTerms.dojFooter')}</p>
      </div>
    </MarketingLayout>
  );
}
