/**
 * Mobile-first breakpoint hook.
 *
 * Single source of truth for "is this user on a phone-sized screen?"
 * — matched at 767px (Tailwind's `md` breakpoint inverted). Below that,
 * components render their mobile branch (`<MobileShell>`, `<KpiStrip>`,
 * etc.); at or above, the existing desktop layout stays untouched.
 *
 * Resize-aware: tracks the media query so rotation (or DevTools
 * responsive mode flips) flips the layout without a page reload.
 *
 * SSR safe — defaults to false during server render so the desktop tree
 * hydrates first, then upgrades to mobile on the client if needed.
 *
 * Mobile Phase 1 (2026-05-22).
 */

import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT_PX = 767;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    // Initial sync in case the SSR default was wrong.
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
