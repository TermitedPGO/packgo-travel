/**
 * Mobile admin shell — chat-first (Mobile Phase 8, 2026-06-01).
 *
 * The conversation (Agent Chat) is the hero. The old 5-item bottom nav is gone
 * (Jeff: "減少選項,大窗直接跟 AI 對話"). Navigation now lives in:
 *   - header ≡  → MobileMenuDrawer (全部功能, grouped + searchable)
 *   - header 🔍 → GlobalSearchSheet (jump to anything / ask)
 *   - quick chips above the composer + asking the agent
 * On any non-chat page the ≡ becomes a ← back-to-chat so home is one tap away.
 *
 * Layout-only component: maps to existing PageId render via children.
 * B&W, lucide line icons, safe-area aware.
 */
import { type ReactNode } from "react";
import { Search, Menu, ChevronLeft } from "lucide-react";

export default function MobileShell({
  breadcrumb,
  onMenuClick,
  onSearchClick,
  showBack = false,
  onBack,
  children,
  fullHeight = false,
}: {
  breadcrumb: string;
  onMenuClick: () => void;
  onSearchClick: () => void;
  /** On non-chat pages, the ≡ becomes a back-to-chat affordance. */
  showBack?: boolean;
  onBack?: () => void;
  children: ReactNode;
  /**
   * Full-height mode for self-contained app shells (e.g. Agent Chat) that own
   * their internal scroll + a composer pinned to the bottom. Skips the default
   * scrolling wrapper and hands the child a bounded, non-scrolling slot whose
   * bottom edge clears the safe-area inset.
   */
  fullHeight?: boolean;
}) {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header — 56px tall */}
      <header className="flex-shrink-0 h-14 bg-white border-b border-gray-200 flex items-center justify-between px-2">
        <div className="flex items-center gap-1 min-w-0">
          {showBack ? (
            <button
              type="button"
              aria-label="返回對話"
              onClick={onBack}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-700 hover:bg-gray-100 active:bg-gray-200 flex-shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="選單"
              onClick={onMenuClick}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-700 hover:bg-gray-100 active:bg-gray-200 flex-shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <div className="w-7 h-7 rounded-lg bg-black text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
            P
          </div>
          <span className="text-sm font-semibold text-gray-900 truncate ml-1">
            {breadcrumb}
          </span>
        </div>
        <button
          type="button"
          aria-label="搜尋"
          onClick={onSearchClick}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-700 hover:bg-gray-100 active:bg-gray-200 flex-shrink-0"
        >
          <Search className="w-5 h-5" />
        </button>
      </header>

      {fullHeight ? (
        <main
          className="flex-1 min-h-0 overflow-hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {children}
        </main>
      ) : (
        <main className="flex-1 overflow-y-auto overscroll-y-contain">
          <div style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
            {children}
          </div>
        </main>
      )}
    </div>
  );
}
