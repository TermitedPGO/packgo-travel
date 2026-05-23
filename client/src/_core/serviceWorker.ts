/**
 * Service worker registration — Mobile Phase 0 (2026-05-22).
 *
 * Registers /service-worker.js after the page loads (low priority).
 * Skips entirely in dev / preview / unsupported browsers.
 *
 * The actual SW logic lives in client/public/service-worker.js so it
 * can be served from the site root (browsers reject SWs scoped above
 * their location — /assets/ would only control /assets/*).
 */
import * as Sentry from "@sentry/react";

const SW_PATH = "/service-worker.js";

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  // Dev: vite serves source files unhashed and HMR'd. Caching would defeat
  // hot reload. Skip in import.meta.env.DEV.
  if (import.meta.env.DEV) return;

  // After page load to avoid contending with initial bundle download.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .then((registration) => {
        // Listen for updates so future "new version available" UX has a
        // hook. Phase 6 will wire a Toast here.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New SW ready; user has the old version cached. Phase 6
              // shows a toast "新版本就緒, 點選重整使用". For now silent.
              console.info("[sw] new version installed, will activate on next load");
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[sw] registration failed:", err.message);
        try {
          Sentry.captureMessage(`[sw] registration failed: ${err.message}`, {
            level: "warning",
          });
        } catch {
          // Sentry not init'd in test environments.
        }
      });
  });
}

/**
 * "Add to Home Screen" install prompt — fires after the browser decides
 * the site meets PWA install criteria (HTTPS + manifest + SW registered +
 * user engagement).
 *
 * Phase 0 just stores the deferred event so a Phase 6 toast can call
 * `prompt()` on it. We do NOT call `prompt()` automatically — that's
 * iOS-hostile and feels spammy.
 */
let _deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

export function captureInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e as BeforeInstallPromptEvent;
    // Bump a counter so the InstallPromptToast (Phase 1+) knows it's
    // available and can render the "📲 加入桌面" button.
    try {
      const count =
        Number(localStorage.getItem("packgo:installPromptAvailable") || "0") + 1;
      localStorage.setItem("packgo:installPromptAvailable", String(count));
    } catch {
      // Safari private mode etc.
    }
  });
}

export function hasInstallPrompt(): boolean {
  return _deferredInstallPrompt !== null;
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!_deferredInstallPrompt) return "unavailable";
  await _deferredInstallPrompt.prompt();
  const choice = await _deferredInstallPrompt.userChoice;
  _deferredInstallPrompt = null;
  return choice.outcome;
}

// Type augmentation — BeforeInstallPromptEvent isn't in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
