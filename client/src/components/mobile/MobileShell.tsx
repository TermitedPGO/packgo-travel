/**
 * Mobile admin shell — Mobile Phase 1 (2026-05-22).
 *
 * Replaces the desktop sidebar + sub-nav with a phone-tuned layout:
 *   - Top header (56px): breadcrumb + 🔔 notifications + 🔍 search
 *   - Main scroll area with safe padding
 *   - Bottom nav (60px, fixed, safe-area-inset-bottom): 5 items —
 *     今日 / 收件 / 銀行 / 客戶 / 更多
 *
 * Bottom nav approved by Jeff via AskUserQuestion 2026-05-22:
 *   「今日 / 收件 / 銀行 / 客戶 / 更多」
 *
 * Architecture: this is a layout-only component. It maps bottom-nav
 * taps to existing PageId values (no new pages yet — Phase 2+ creates
 * mobile-tuned versions of those pages).
 */

import { type ReactNode } from "react";
import { Bell, Search, Wallet, Inbox, Users, Home, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileNavId = "today" | "inbox" | "bank" | "customers" | "more";

const NAV_ITEMS: Array<{
  id: MobileNavId;
  label: string;
  icon: typeof Home;
}> = [
  { id: "today", label: "今日", icon: Home },
  { id: "inbox", label: "收件", icon: Inbox },
  { id: "bank", label: "銀行", icon: Wallet },
  { id: "customers", label: "客戶", icon: Users },
  { id: "more", label: "更多", icon: MoreHorizontal },
];

export default function MobileShell({
  active,
  onSelect,
  breadcrumb,
  notificationCount = 0,
  onSearchClick,
  onNotificationsClick,
  children,
  onNavigate,
  fullHeight = false,
}: {
  active: MobileNavId;
  onSelect: (id: MobileNavId) => void;
  breadcrumb: string;
  notificationCount?: number;
  onSearchClick: () => void;
  onNotificationsClick?: () => void;
  children: ReactNode;
  onNavigate?: (path: string) => void;
  /**
   * Full-height mode for self-contained app shells (e.g. Agent Chat) that own
   * their internal scroll + a composer pinned above the bottom nav. Skips the
   * default scrolling `pb-20` wrapper and hands the child a bounded,
   * non-scrolling slot whose bottom edge clears the fixed 60px nav (+ safe
   * area). Without this, a `h-full` child collapses inside the auto-height
   * scroll wrapper and its composer ends up buried at the bottom of a long
   * page instead of pinned. (Mobile Phase 7, 2026-05-31.)
   */
  fullHeight?: boolean;
}) {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header — 56px tall */}
      <header className="flex-shrink-0 h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
            P
          </div>
          <span className="text-sm font-medium text-gray-900 truncate">
            {breadcrumb}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            aria-label="通知"
            onClick={onNotificationsClick}
            className="relative w-10 h-10 rounded-lg flex items-center justify-center hover:bg-gray-100 active:bg-gray-200"
          >
            <Bell className="w-5 h-5 text-gray-700" />
            {notificationCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {notificationCount > 99 ? "99+" : notificationCount}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label="搜尋"
            onClick={onSearchClick}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-gray-100 active:bg-gray-200"
          >
            <Search className="w-5 h-5 text-gray-700" />
          </button>
        </div>
      </header>

      {fullHeight ? (
        /* Full-height slot — child owns its scroll; reserve the fixed nav so
           the child's bottom-pinned composer clears it. No page-level scroll. */
        <main
          className="flex-1 min-h-0 overflow-hidden"
          style={{ paddingBottom: "calc(60px + env(safe-area-inset-bottom))" }}
        >
          {children}
        </main>
      ) : (
        /* Default scroll area — pb-20 reserves space for bottom nav (60px) +
           safe-area-inset-bottom on iPhones with home indicator. */
        <main className="flex-1 overflow-y-auto overscroll-y-contain">
          <div className="pb-20" style={{ paddingBottom: "calc(80px + env(safe-area-inset-bottom))" }}>
            {children}
          </div>
        </main>
      )}

      {/* Bottom nav — fixed at bottom, 60px tall + safe-area inset */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch h-[60px]">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-teal-700"
                    : "text-gray-500 hover:text-gray-700 active:bg-gray-100",
                )}
              >
                <Icon className={cn("w-5 h-5", isActive && "stroke-[2.5]")} />
                <span>{item.label}</span>
                {isActive && (
                  <span className="absolute top-0 w-8 h-0.5 bg-teal-600 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
