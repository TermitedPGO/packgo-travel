import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Cookie, X } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { loadGA4 } from "@/lib/analytics";

/**
 * CCPA/CPRA-compliant cookie consent banner.
 *
 * Contract:
 *  - Analytics cookies MUST NOT fire until the user has affirmatively
 *    accepted them (or accepted "necessary only", in which case only
 *    strictly-necessary cookies are set).
 *  - The choice is persisted in localStorage under `pag_cookie_consent`.
 *  - A `cookieconsent` CustomEvent is dispatched on change so that the
 *    analytics loader can react without coupling to this component.
 *
 * Values stored in localStorage:
 *   "all"       — necessary + analytics
 *   "necessary" — necessary only
 *   (missing)   — banner shown, nothing loaded yet
 */

const STORAGE_KEY = "pag_cookie_consent";
type Consent = "all" | "necessary";

export function getCookieConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "all" || v === "necessary" ? v : null;
}

export function setCookieConsent(v: Consent) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, v);
  window.dispatchEvent(new CustomEvent("cookieconsent", { detail: v }));
}

export default function CookieConsentBanner() {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show if the user has NOT already decided.
    const decided = getCookieConsent();
    if (!decided) {
      setVisible(true);
    } else if (decided === "all") {
      // Returning visitor who already accepted analytics — load GA4 now.
      loadGA4();
    }
  }, []);

  if (!visible) return null;

  const handle = (choice: Consent) => {
    setCookieConsent(choice);
    if (choice === "all") {
      // User just accepted analytics — inject GA4 script immediately.
      loadGA4();
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('common.cookieConsent')}
      className="fixed bottom-3 md:bottom-4 left-3 right-3 md:left-6 md:right-auto md:max-w-md z-50"
    >
      {/* Round 80.6: split mobile vs desktop layouts. Mobile was eating ~50%
          of fold-1 on every page (verified via puppeteer audit) — first
          impression is the cookie box, not the brand. New mobile is a single-
          row compact bar. Desktop keeps the original full card. */}

      {/* Mobile compact bar — horizontal layout, single short line of body */}
      <div className="md:hidden rounded-xl border border-gray-200 bg-white shadow-xl px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Cookie className="h-4 w-4 text-foreground shrink-0" aria-hidden />
          <div className="flex-1 min-w-0 text-xs text-foreground/80 leading-snug">
            {t("cookieBanner.compactBody")}
            <Link href="/privacy-policy" className="underline ml-1 text-foreground/60 hover:text-foreground">
              {t("cookieBanner.detailsLink")}
            </Link>
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => handle("necessary")}
            className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-medium text-foreground/75 active:bg-gray-50 transition-colors"
          >
            {t("cookieBanner.necessaryOnly")}
          </button>
          <button
            onClick={() => handle("all")}
            className="flex-1 rounded-lg bg-foreground px-2 py-1.5 text-xs font-medium text-white active:bg-foreground/85 transition-colors"
          >
            {t("cookieBanner.acceptAll")}
          </button>
        </div>
      </div>

      {/* Desktop full card — original layout */}
      <div className="hidden md:block rounded-xl border border-gray-200 bg-white shadow-2xl p-5">
        <div className="flex items-start gap-3">
          <Cookie className="h-6 w-6 text-black shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-black mb-1">
              {t("cookieBanner.title")}
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {t("cookieBanner.body")}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              <Link href="/privacy-policy" className="underline hover:text-black">
                {t("cookieBanner.readPolicy")}
              </Link>
            </p>

            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <button
                onClick={() => handle("necessary")}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {t("cookieBanner.necessaryOnly")}
              </button>
              <button
                onClick={() => handle("all")}
                className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
              >
                {t("cookieBanner.acceptAll")}
              </button>
            </div>
          </div>
          <button
            onClick={() => handle("necessary")}
            aria-label={t('common.closeCookieBanner')}
            className="rounded-md p-1 text-gray-400 hover:text-black hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
