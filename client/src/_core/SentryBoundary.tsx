import * as Sentry from "@sentry/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { translate } from "@/i18n";

interface Props {
  children: ReactNode;
}

/**
 * Sentry error boundary wrapping the entire app tree.
 *
 * v2 Wave 1 Module 1.1 — outermost boundary. Catches anything React throws
 * during rendering / lifecycle and ships the stack to Sentry. Sits OUTSIDE
 * HelmetProvider + trpc.Provider + LocaleProvider, so it cannot call
 * `useLocale()` (the LocaleProvider may itself be the thing that crashed).
 *
 * Translation strategy: read the user's preferred language directly from
 * `localStorage` (same key the LocaleProvider uses) and feed it into the
 * stateless `translate()` helper. If localStorage is unavailable or the
 * key is unset, default to zh-TW.
 *
 * Tailwind-only styling — no shadcn dependency. If a bad shadcn upgrade is
 * what triggered the boundary, this fallback must still render.
 */
function readSavedLanguage(): "zh-TW" | "en" {
  if (typeof window === "undefined") return "zh-TW";
  try {
    const saved = window.localStorage.getItem("packgo-language");
    if (saved === "en" || saved === "zh-TW") {
      return saved;
    }
  } catch {
    /* localStorage may throw in some private-mode browsers */
  }
  return "zh-TW";
}

function FallbackUI({ resetError }: { resetError: () => void }) {
  const lang = readSavedLanguage();
  const fallbackText = translate("errorBoundary.fallback", lang);
  const reloadText = translate("errorBoundary.reload", lang);
  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-white">
      <div className="flex flex-col items-center w-full max-w-2xl p-8 rounded-xl">
        <AlertTriangle size={48} className="text-red-500 mb-6 flex-shrink-0" />
        <p className="text-base text-gray-800 mb-6 text-center">{fallbackText}</p>
        <button
          type="button"
          onClick={() => {
            resetError();
            window.location.reload();
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
        >
          <RotateCcw size={16} />
          {reloadText}
        </button>
      </div>
    </div>
  );
}

export default function SentryBoundary({ children }: Props) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => <FallbackUI resetError={resetError} />}
      showDialog={false}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
