import MarketingLayout from "@/components/layouts/MarketingLayout";
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "wouter";

/**
 * Privacy Policy — Pack & Go, LLC
 *
 * Drafted to satisfy the California Consumer Privacy Act (CCPA) as amended
 * by the California Privacy Rights Act (CPRA), Cal. Civ. Code §§1798.100
 * et seq., including the 9 enumerated consumer rights and the mandatory
 * categorical notice at collection.
 *
 * Review by licensed counsel is recommended before relying on this text
 * in a regulatory inquiry.
 */
export default function PrivacyPolicy() {
  const { t, tArray } = useLocale();

  const Section = ({ h, children }: { h: string; children: React.ReactNode }) => (
    <>
      <h2>{h}</h2>
      {children}
    </>
  );

  const List = ({ items }: { items: string[] }) => (
    <ul>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );

  return (
    <MarketingLayout
      title={t('privacyPolicy.fullPolicy.title')}
      subtitle={t('privacyPolicy.fullPolicy.subtitle')}
    >
      <p className="!text-sm !text-foreground/50 !mt-0">
        {t('privacyPolicy.fullPolicy.effective')}: 2026-04-18
      </p>

      <p className="lead">{t('privacyPolicy.fullPolicy.intro')}</p>

        <Section h={t('privacyPolicy.fullPolicy.s1h')}>
          <p>{t('privacyPolicy.fullPolicy.s1intro')}</p>
          <List items={tArray('privacyPolicy.fullPolicy.s1list')} />
          <p>
            <em>{t('privacyPolicy.fullPolicy.s1note')}</em>
          </p>
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s2h')}>
          <List items={tArray('privacyPolicy.fullPolicy.s2list')} />
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s3h')}>
          <p>{t('privacyPolicy.fullPolicy.s3p')}</p>
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s4h')}>
          <p>{t('privacyPolicy.fullPolicy.s4intro')}</p>
          <List items={tArray('privacyPolicy.fullPolicy.s4list')} />
          <p>{t('privacyPolicy.fullPolicy.s4how')}</p>
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s5h')}>
          <List items={tArray('privacyPolicy.fullPolicy.s5list')} />
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s6h')}>
          <p>{t('privacyPolicy.fullPolicy.s6p')}</p>
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s7h')}>
          <List items={tArray('privacyPolicy.fullPolicy.s7list')} />
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s8h')}>
          <p>{t('privacyPolicy.fullPolicy.s8p')}</p>
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s9h')}>
          <p>{t('privacyPolicy.fullPolicy.s9p')}</p>
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s10h')}>
          <p>{t('privacyPolicy.fullPolicy.s10p')}</p>
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s11h')}>
          <p>{t('privacyPolicy.fullPolicy.s11p')}</p>
        </Section>

        <Section h={t('privacyPolicy.fullPolicy.s12h')}>
          <p>{t('privacyPolicy.fullPolicy.s12p')}</p>
        </Section>

      <div className="not-prose mt-12 rounded-xl border border-foreground/15 bg-foreground/[0.02] p-5 text-sm text-foreground/70 leading-relaxed">
        <p>
          {t('privacyPolicy.fullPolicy.cppaPrefix')}
          <a
            href="https://cppa.ca.gov"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            cppa.ca.gov
          </a>
          .
        </p>
        <p className="mt-2">
          {t('privacyPolicy.seeAlsoPrefix')}
          <Link href="/terms-of-service" className="text-primary hover:underline">
            {t('privacyPolicy.seeAlsoLink')}
          </Link>
          {t('privacyPolicy.seeAlsoSuffix')}
        </p>
      </div>
    </MarketingLayout>
  );
}
