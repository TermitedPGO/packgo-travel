// @vitest-environment jsdom
/**
 * Service-worker registration tests — Mobile Phase 0.
 *
 * Focused on the install-prompt capture path since that's the only
 * piece with real branching logic. registerServiceWorker() is mostly
 * a thin wrapper around navigator.serviceWorker.register; testing
 * the no-op-in-dev path requires module re-evaluation per case which
 * fights Vite's import.meta.env immutability.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("captureInstallPrompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("hasInstallPrompt is false before any event fires", async () => {
    const { hasInstallPrompt } = await import("./serviceWorker");
    expect(hasInstallPrompt()).toBe(false);
  });

  it("bumps localStorage counter on beforeinstallprompt event", async () => {
    const { captureInstallPrompt, hasInstallPrompt } = await import(
      "./serviceWorker"
    );
    captureInstallPrompt();
    expect(hasInstallPrompt()).toBe(false); // captured nothing yet

    const evt = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    (evt as any).prompt = async () => undefined;
    (evt as any).userChoice = Promise.resolve({ outcome: "accepted" });

    window.dispatchEvent(evt);

    expect(window.localStorage.getItem("packgo:installPromptAvailable")).toBe("1");
    expect(hasInstallPrompt()).toBe(true);
  });
});
