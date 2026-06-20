import { useState } from "react"
import { Search, EyeOff, RotateCcw } from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"
import type { ListItem } from "./types"

const TAG_STYLES: Record<string, string> = {
  active: "bg-gray-200 text-gray-900",
  pending: "bg-gray-100 text-gray-700",
  inquiry: "bg-gray-100 text-gray-500",
}

type RowRef = { id: number; kind: "user" | "guest" }

export default function CustomerList({
  customers,
  selected,
  onSelect,
  showHidden,
  onToggleHidden,
  onMarkNotCustomer,
  onRestoreCustomer,
}: {
  customers: ListItem[]
  selected: RowRef | null
  onSelect: (ref: RowRef) => void
  showHidden: boolean
  onToggleHidden: (v: boolean) => void
  onMarkNotCustomer: (ref: RowRef) => void
  onRestoreCustomer: (ref: RowRef) => void
}) {
  const { t } = useLocale()
  const [query, setQuery] = useState("")

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.email.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="w-[300px] flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-200 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder={t("admin.customers.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full border border-gray-300 rounded-lg py-2 pl-9 pr-3 text-[13px] outline-none focus:border-gray-500"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => onToggleHidden(e.target.checked)}
            className="rounded border-gray-300"
          />
          {t("admin.customers.showHidden")}
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((c) => (
          <div
            key={`${c.kind}-${c.id}`}
            onClick={() => onSelect({ id: c.id, kind: c.kind })}
            className={`group relative flex items-center gap-2.5 px-3 py-2.5 cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 ${
              selected?.id === c.id && selected?.kind === c.kind
                ? "bg-gray-50 border-l-[3px] border-l-gray-900"
                : ""
            } ${c.blocked ? "opacity-55" : ""}`}
          >
            <div className="relative flex-shrink-0">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-medium"
                style={{ background: c.color, color: c.textColor }}
              >
                {c.initials}
              </div>
              {c.notifs > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-gray-900 text-white text-[9px] font-semibold flex items-center justify-center px-1 border-2 border-white">
                  {c.notifs}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate flex items-center gap-1.5">
                {c.name}
                {c.blocked && (
                  <span className="text-[9px] px-1 py-0.5 rounded-md bg-gray-200 text-gray-500 font-normal flex-shrink-0">
                    {t("admin.customers.blockedBadge")}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-400 truncate">{c.email}</div>
            </div>
            {/* Per-row mark / restore — works for both registered accounts and
                email guests (suppliers like uvbookings can be hidden here too). */}
            <button
              type="button"
              title={c.blocked ? t("admin.customers.restoreAction") : t("admin.customers.hideAction")}
              onClick={(e) => {
                e.stopPropagation()
                const ref = { id: c.id, kind: c.kind }
                if (c.blocked) onRestoreCustomer(ref)
                else onMarkNotCustomer(ref)
              }}
              className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-700 transition-all"
            >
              {c.blocked ? <RotateCcw className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <div className="text-right flex-shrink-0">
              <div className="text-[10px] text-gray-400">{c.lastContact}</div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-md inline-block mt-0.5 ${TAG_STYLES[c.tag] ?? ""}`}
              >
                {c.tagLabel}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
