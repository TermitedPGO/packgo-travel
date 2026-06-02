/**
 * MobileMenuDrawer — chat-first "全部功能" drawer (Mobile Phase 8, 2026-06-01).
 *
 * Replaces the old 5-item bottom nav. The conversation (Agent Chat) is the
 * mobile hero; every other admin function lives here, one tap from the header
 * ≡ button. Reuses AdminV2's `paletteActions` (already grouped by domain +
 * emoji-stripped) so there are no new labels / no new i18n to drift.
 *
 * B&W, lucide line icons, rounded, ≥44px tap rows, safe-area aware.
 */
import { useMemo, useState } from "react";
import { Search, X, ChevronRight } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { buildMenuGroups, type MenuAction } from "./mobileMenu";

export default function MobileMenuDrawer({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: MenuAction[];
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () => buildMenuGroups(actions, query),
    [actions, query],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="absolute inset-y-0 left-0 w-[86%] max-w-sm bg-white flex flex-col rounded-r-2xl overflow-hidden"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Header */}
        <div className="flex-shrink-0 h-14 px-3 flex items-center justify-between border-b border-gray-200">
          <span className="text-sm font-semibold text-black">
            {t("admin.agentChat.menuAllFunctions")}
          </span>
          <button
            type="button"
            aria-label="關閉"
            onClick={onClose}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-100 active:bg-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="flex-shrink-0 p-3 border-b border-gray-100">
          <div className="flex items-center gap-2 h-11 px-3 rounded-xl bg-gray-100">
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("admin.agentChat.menuSearchPlaceholder")}
              className="flex-1 min-w-0 bg-transparent outline-none text-base text-black placeholder:text-gray-400"
            />
          </div>
        </div>

        {/* Grouped list */}
        <div className="flex-1 overflow-y-auto bg-gray-50 p-3 space-y-4">
          {groups.length === 0 && (
            <div className="text-center text-sm text-gray-400 py-10">
              {t("admin.agentChat.menuEmpty")}
            </div>
          )}
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="text-[11px] font-semibold text-gray-500 px-1 mb-1.5">
                {group}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                {items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      a.onSelect();
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left active:bg-gray-50"
                  >
                    <span className="text-sm text-gray-900 truncate">
                      {a.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
