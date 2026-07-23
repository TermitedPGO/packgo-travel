/**
 * Batch P1c — BC storefront preview chrome (header + footer + page frame).
 *
 * Faithful port of the BC prototype's finalized navigation rulings:
 *   - 置中品牌 masthead (2026-07-17 ruling C): brand lockup center,
 *     the three core entries left, account tools right.
 *   - Core nav is EXACTLY 團體行程 / 機票服務 / 中國簽證; everything else
 *     lives on real production pages linked from the footer.
 *   - No emoji, no decorative punctuation in visible copy (transaction
 *     data — address, phone, CST — keeps its necessary format).
 *
 * All links target REAL routes: the three BC preview routes plus existing
 * production pages (/flight-booking, /china-visa, /inquiry, ...).
 *
 * Brand lockup (prototype NOTES 品牌字樣裁決, 2026-07-14 — landed per the
 * Codex 2026-07-22 round-2 allow-list): PACK&GO is NEVER retyped in the
 * site font. Header and footer use the approved wordmark artwork
 * /images/packgo-wordmark-black.png (byte-identical copy of the prototype
 * asset) alongside the production bag mark.
 */
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { languageNames, useLocale } from "@/contexts/LocaleContext";
import { CONTACT, LICENSES } from "@/lib/brand";
import "./bc-preview.css";

function BcHeader() {
  const { t, language, setLanguage } = useLocale();
  const [location] = useLocation();
  const navItems = [
    { href: "/preview/bc/tours", labelKey: "bcPreview.nav.tours" },
    { href: "/flight-booking", labelKey: "bcPreview.nav.flights" },
    { href: "/china-visa", labelKey: "bcPreview.nav.chinaVisa" },
  ];
  return (
    <header className="bc-nav">
      <span className="bc-preview-tag">{t("bcPreview.chrome.previewTag")}</span>
      <div className="bc-nav-inner">
        <nav className="bc-nav-links" aria-label={t("bcPreview.chrome.primaryNav")}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`bc-nav-link ${location.startsWith(item.href) ? "is-active" : ""}`}
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
        <Link href="/preview/bc" className="bc-brand" aria-label={t("bcPreview.chrome.brandHome")}>
          <img src="/images/logo-bag-black-v3.png" alt="" />
          <img
            className="bc-brand-wordmark"
            src="/images/packgo-wordmark-black.png"
            alt="PACK&amp;GO"
          />
        </Link>
        <div className="bc-nav-tools">
          <button
            type="button"
            className="bc-nav-tool"
            onClick={() => setLanguage(language === "zh-TW" ? "en" : "zh-TW")}
            aria-label={t("bcPreview.chrome.languageToggle")}
          >
            {language === "zh-TW" ? languageNames.en : languageNames["zh-TW"]}
          </button>
          <Link href="/login" className="bc-nav-tool">
            {t("bcPreview.nav.member")}
          </Link>
        </div>
      </div>
    </header>
  );
}

function BcFooter() {
  const { t } = useLocale();
  const col = (
    titleKey: string,
    links: Array<{ href: string; labelKey: string }>,
  ) => (
    <div className="bc-footer-col">
      <h3>{t(titleKey)}</h3>
      {links.map((link) => (
        <Link key={link.href + link.labelKey} href={link.href}>
          {t(link.labelKey)}
        </Link>
      ))}
    </div>
  );
  return (
    <footer className="bc-footer">
      <div className="bc-shell">
        <div className="bc-footer-top">
          <div className="bc-footer-brand">
            <img
              className="bc-footer-wordmark"
              src="/images/packgo-wordmark-black.png"
              alt="PACK&amp;GO"
            />
            <p>{t("bcPreview.chrome.footerBlurb")}</p>
          </div>
          {col("bcPreview.chrome.colFind", [
            { href: "/preview/bc/tours", labelKey: "bcPreview.nav.tours" },
            { href: "/custom-tour-request", labelKey: "bcPreview.chrome.linkCustom" },
            { href: "/about-us", labelKey: "bcPreview.chrome.linkAbout" },
          ])}
          {col("bcPreview.chrome.colServices", [
            { href: "/flight-booking", labelKey: "bcPreview.nav.flights" },
            { href: "/china-visa", labelKey: "bcPreview.nav.chinaVisa" },
            { href: "/airport-transfer", labelKey: "bcPreview.chrome.linkTransfer" },
            { href: "/hotel-booking", labelKey: "bcPreview.chrome.linkHotel" },
          ])}
          {col("bcPreview.chrome.colSupport", [
            { href: "/inquiry", labelKey: "bcPreview.chrome.linkInquiry" },
            { href: "/contact-us", labelKey: "bcPreview.chrome.linkContact" },
            { href: "/faq", labelKey: "bcPreview.chrome.linkFaq" },
          ])}
        </div>
        <div className="bc-footer-bottom">
          <address>
            PACK&amp;GO · {CONTACT.address.street}, {CONTACT.address.city},{" "}
            {CONTACT.address.state} {CONTACT.address.zip}
            <br />
            {CONTACT.phone} · {CONTACT.email}
          </address>
          <div>
            <span>
              {LICENSES.cstFull} · Newark Business License #{CONTACT.newarkBusinessLicense}
            </span>
            <br />
            <span>{t("bcPreview.chrome.tcrfNote")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Shared page frame: BC tokens root + header + faded main + footer. */
export default function BcChrome({ children }: { children: ReactNode }) {
  return (
    <div className="bc-preview">
      <BcHeader />
      <main className="bc-fade">{children}</main>
      <BcFooter />
    </div>
  );
}
