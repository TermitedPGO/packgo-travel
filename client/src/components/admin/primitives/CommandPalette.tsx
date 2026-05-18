/**
 * CommandPalette — ⌘K global search & jump.
 *
 * Two modes:
 *   1. Empty input → show "Jump to" — list of admin pages
 *   2. Has input → search tours / bookings / customers / inquiries via trpc
 *
 * Keyboard: ⌘K to open, esc to close, ↑↓ to navigate, enter to pick.
 *
 * MVP: jump only. Search wiring can come in a follow-up — the structure
 * here makes it easy to add (insert `useQuery` calls into ResultSection).
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Search } from "lucide-react";

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  actions,
  searchHint = "搜尋頁面、行程、訂單、客戶…",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
  searchHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const filtered = query
    ? actions.filter(
        (a) =>
          a.label.toLowerCase().includes(query.toLowerCase()) ||
          a.hint?.toLowerCase().includes(query.toLowerCase())
      )
    : actions;

  // Clamp active index when filter changes
  useEffect(() => {
    if (activeIdx >= filtered.length && filtered.length > 0) {
      setActiveIdx(0);
    }
  }, [filtered.length, activeIdx]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) {
        item.onSelect();
        onOpenChange(false);
      }
    } else if (e.key === "Escape") {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl p-0 max-w-2xl overflow-hidden border-gray-200">
        <div className="flex items-center gap-2 px-3 h-11 border-b border-gray-100">
          <Search className="h-3.5 w-3.5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={searchHint}
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400"
            autoFocus
          />
          <kbd className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1 py-0.5 rounded">
            esc
          </kbd>
        </div>
        <div className="max-h-[420px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">
              沒有符合的結果
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => {
                  item.onSelect();
                  onOpenChange(false);
                }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`w-full px-3 h-9 flex items-center gap-2 text-xs text-left ${
                  idx === activeIdx
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-700"
                }`}
              >
                {item.icon && (
                  <span className="text-gray-400 flex-shrink-0">{item.icon}</span>
                )}
                <span className="font-medium flex-1 truncate">{item.label}</span>
                {item.hint && (
                  <span className="text-[10px] text-gray-400 truncate">
                    {item.hint}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Hook: returns [open, setOpen] and binds ⌘K to open. */
export function useCommandPaletteHotkey(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen];
}
