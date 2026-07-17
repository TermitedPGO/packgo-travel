import { useState } from "react"
import { Search, EyeOff, RotateCcw, Trash2 } from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"
import type { ListItem } from "./types"
import { filterCustomers } from "./adapters"

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
  onDeleteGuest,
}: {
  customers: ListItem[]
  selected: RowRef | null
  onSelect: (ref: RowRef) => void
  showHidden: boolean
  onToggleHidden: (v: boolean) => void
  onMarkNotCustomer: (ref: RowRef) => void
  onRestoreCustomer: (ref: RowRef) => void
  onDeleteGuest: (profileId: number) => void
}) {
  const { t } = useLocale()
  const [query, setQuery] = useState("")
  // 訪客刪除確認小卡(自製,非原生 confirm)— 存待刪列,null = 關閉。
  const [confirmDelete, setConfirmDelete] = useState<ListItem | null>(null)

  const filtered = filterCustomers(customers, query)

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
              {/* Avatar red has ONE meaning: unseen inbound customer mail.
                  Rendering the agent-message count in the same spot made a
                  read row look permanently unread. */}
              {c.unread && !c.blocked && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </div>
            <div data-customer-row-info className="flex-1 min-w-0">
              <div className={`text-[13px] min-w-0 flex items-center gap-1.5 ${c.unread && !c.blocked ? "font-semibold" : "font-medium"}`}>
                <span
                  data-customer-row-name
                  className="min-w-0 truncate"
                  title={c.name}
                >
                  {c.name}
                </span>
                {c.blocked && (
                  <span className="text-[9px] px-1 py-0.5 rounded-md bg-gray-200 text-gray-500 font-normal flex-shrink-0">
                    {t("admin.customers.blockedBadge")}
                  </span>
                )}
                {c.needsFollowup && !c.blocked && (
                  <span className="text-[9px] px-1 py-0.5 rounded-md bg-gray-900 text-white font-normal flex-shrink-0">
                    {t("admin.customers.followup.badge")}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-400 truncate">{c.email}</div>
            </div>
            {/* Trailing metadata owns one fixed slot. Row actions overlay that
                slot on hover/focus instead of invisibly consuming 36–72px of
                the customer's name at all times. */}
            <div className="relative w-12 self-stretch flex-shrink-0">
              <div className="absolute inset-y-0 right-0 flex flex-col justify-center text-right transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                <div className="text-[10px] text-gray-400">{c.lastContact}</div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md inline-block mt-0.5 ${TAG_STYLES[c.tag] ?? ""}`}
                >
                  {c.tagLabel}
                </span>
              </div>
              <div
                data-customer-row-actions
                className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-lg bg-gray-50/95 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity"
              >
                {/* Per-row mark / restore — works for registered + guests. */}
                <button
                  type="button"
                  title={c.blocked ? t("admin.customers.restoreAction") : t("admin.customers.hideAction")}
                  onClick={(e) => {
                    e.stopPropagation()
                    const ref = { id: c.id, kind: c.kind }
                    if (c.blocked) onRestoreCustomer(ref)
                    else onMarkNotCustomer(ref)
                  }}
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
                >
                  {c.blocked ? <RotateCcw className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                {/* Guest deletion keeps the audited in-app confirmation card. */}
                {c.kind === "guest" && (
                  <button
                    type="button"
                    title={t("admin.customers.deleteConfirm.action")}
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDelete(c)
                    }}
                    className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 訪客刪除確認小卡 — 自製 overlay(rounded-xl),不用原生 confirm。 */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 w-72"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[13px] font-semibold text-gray-900 mb-1">
              {t("admin.customers.deleteConfirm.title", { name: confirmDelete.name })}
            </div>
            <div className="text-[12px] text-gray-500 mb-4">
              {t("admin.customers.deleteConfirm.warning")}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 rounded-lg text-[12px] text-gray-600 hover:bg-gray-100 transition-colors"
              >
                {t("admin.customers.deleteConfirm.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteGuest(confirmDelete.id)
                  setConfirmDelete(null)
                }}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                {t("admin.customers.deleteConfirm.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
