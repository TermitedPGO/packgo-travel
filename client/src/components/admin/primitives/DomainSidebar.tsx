/**
 * DomainSidebar — 5-item left sidebar with collapse.
 *
 * Replaces the previous 28-item sidebar. Now shows only the 5 top-level
 * domains. Sub-navigation happens inside each domain via DomainSubNav.
 *
 * Widths: 220px expanded, 56px collapsed (icons only).
 */
import { useState } from "react";
import { Bot, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Domain = {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

export function DomainSidebar({
  domains,
  active,
  onSelect,
  user,
  onLogout,
  onHome,
}: {
  domains: Domain[];
  active: string;
  onSelect: (id: string) => void;
  user?: { name?: string | null; email?: string | null };
  onLogout?: () => void;
  onHome?: () => void;
}) {
  // Round 81 (2026-05-17) — Auto-collapse on mobile so admin is usable
  // on phone (< 768px screens). Jeff's preference persists via localStorage.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("admin.sidebar.collapsed");
    if (saved !== null) return saved === "1";
    return window.innerWidth < 768;
  });
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("admin.sidebar.collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  };
  const width = collapsed ? "w-14" : "w-56";

  return (
    <aside
      className={`${width} flex-shrink-0 bg-white border-r border-gray-200 flex flex-col transition-[width] duration-150`}
    >
      {/* Brand + collapse toggle */}
      <div className="h-12 px-3 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
        <button
          onClick={onHome}
          className="flex items-center gap-2 min-w-0 hover:opacity-80"
        >
          <div className="h-6 w-6 rounded-md bg-gray-900 flex items-center justify-center flex-shrink-0">
            <Bot className="h-3.5 w-3.5 text-white" />
          </div>
          {!collapsed && (
            <span className="text-xs font-bold tracking-wider text-gray-900 truncate">
              PACK&GO
            </span>
          )}
        </button>
        <button
          onClick={toggleCollapsed}
          className="text-gray-400 hover:text-gray-700"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Domain list */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {domains.map((d) => {
          const Icon = d.icon;
          const isActive = d.id === active;
          return (
            <button
              key={d.id}
              onClick={() => onSelect(d.id)}
              title={collapsed ? d.label : undefined}
              className={`w-full h-9 px-3 flex items-center gap-2.5 text-xs font-medium transition relative ${
                isActive
                  ? "text-gray-900 bg-gray-100/80"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-gray-900 rounded-r" />
              )}
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left truncate">{d.label}</span>
                  {d.badge !== undefined && d.badge > 0 && (
                    <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-rose-600 text-white">
                      {d.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* User footer */}
      {user && (
        <div className="border-t border-gray-100 p-2 flex-shrink-0">
          {collapsed ? (
            <button
              onClick={onLogout}
              className="w-full h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-md hover:bg-gray-50"
              title="登出"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50">
              <div className="h-6 w-6 rounded-full bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {(user.name || user.email || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-gray-900 truncate">
                  {user.name || "Admin"}
                </div>
                <div className="text-[10px] text-gray-500 truncate">
                  {user.email}
                </div>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="text-gray-400 hover:text-rose-600"
                  title="登出"
                >
                  <LogOut className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
