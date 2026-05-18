/**
 * TopBar — sticky header above content. h-12.
 *
 * Holds: breadcrumb (domain › page), global search trigger, ⌘K hint, profile.
 * Does NOT show the page title — that lives in <PageHeader> inside the page.
 */
import { Search } from "lucide-react";

export function TopBar({
  breadcrumb,
  onSearchClick,
  right,
}: {
  breadcrumb: { label: string; onClick?: () => void }[];
  onSearchClick?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <header className="h-12 px-4 border-b border-gray-200 bg-white flex items-center justify-between sticky top-0 z-20">
      <nav className="flex items-center gap-1 min-w-0">
        {breadcrumb.map((b, i) => (
          <span key={i} className="flex items-center gap-1 min-w-0">
            {i > 0 && <span className="text-gray-300 text-xs">/</span>}
            <button
              onClick={b.onClick}
              disabled={!b.onClick || i === breadcrumb.length - 1}
              className={`text-xs truncate ${
                i === breadcrumb.length - 1
                  ? "text-gray-900 font-semibold"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {b.label}
            </button>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {onSearchClick && (
          <button
            onClick={onSearchClick}
            className="h-7 px-2 inline-flex items-center gap-2 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-md border border-gray-200"
          >
            <Search className="h-3 w-3" />
            <span>搜尋</span>
            <kbd className="px-1 py-0.5 text-[9px] font-mono bg-gray-100 text-gray-500 rounded">
              ⌘K
            </kbd>
          </button>
        )}
        {right}
      </div>
    </header>
  );
}
