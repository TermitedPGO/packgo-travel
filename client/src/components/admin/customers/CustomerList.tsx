import { useState } from "react"
import { Search } from "lucide-react"
import type { ListItem } from "./types"

const TAG_STYLES: Record<string, string> = {
  active: "bg-gray-200 text-gray-900",
  pending: "bg-gray-100 text-gray-700",
  inquiry: "bg-gray-100 text-gray-500",
}

export default function CustomerList({
  customers,
  selectedId,
  onSelect,
}: {
  customers: ListItem[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [query, setQuery] = useState("")

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.email.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="w-[300px] flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="搜尋客戶..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full border border-gray-300 rounded-lg py-2 pl-9 pr-3 text-[13px] outline-none focus:border-gray-500"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 ${
              selectedId === c.id ? "bg-gray-50 border-l-[3px] border-l-gray-900" : ""
            }`}
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
              <div className="text-[13px] font-medium truncate">{c.name}</div>
              <div className="text-[11px] text-gray-400 truncate">{c.email}</div>
            </div>
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
