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
  const { language } = useLocale();
  const isEn = language === "en";
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
      aria-label={isEn ? "Cookie consent" : "Cookie 同意"}
      className="fixed bottom-4 left-4 right-4 md:left-6 md:right-auto md:max-w-md z-50"
    >
      <div className="rounded-xl border border-gray-200 bg-white shadow-2xl p-5">
        <div className="flex items-start gap-3">
          <Cookie className="h-6 w-6 text-black shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-black mb-1">
              {isEn ? "Your privacy, your choice" : "您的隱私，您作主"}
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isEn
                ? "We use strictly necessary cookies to run this site. With your permission we also use analytics cookies (Plausible, Google Analytics) to understand how the site is used. We do not sell or share your personal information."
                : "本網站使用維持運作所必需之 Cookie。若您同意，我們另將使用分析 Cookie（Plausible、Google Analytics）以了解網站使用情形。本公司不出售亦不分享您的個人資料。"}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              <Link href="/privacy-policy" className="underline hover:text-black">
                {isEn ? "Read our Privacy Policy" : "閱讀隱私權政策"}
              </Link>
            </p>

            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <button
                onClick={() => handle("necessary")}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {isEn ? "Necessary only" : "僅必要 Cookie"}
              </button>
              <button
                onClick={() => handle("all")}
                className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
              >
                {isEn ? "Accept all" : "全部接受"}
              </button>
            </div>
          </div>
          <button
            onClick={() => handle("necessary")}
            aria-label={isEn ? "Close and accept necessary only" : "關閉並僅接受必要 Cookie"}
            className="rounded-md p-1 text-gray-400 hover:text-black hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
