import { useEffect, useRef, useState } from "react"
import { Inbox } from "lucide-react"
import { trpc } from "@/lib/trpc"
import { useLocale } from "@/contexts/LocaleContext"
import { toast } from "sonner"
import type { AdaptedCustomer, Project } from "./types"
import { toSelection, shortDate } from "./customOrderHelpers"
import { shouldCommitRename } from "./adapters"

/**
 * customer-projects (0104) — the「標題列下方一排」project switcher. Projects
 * (newest first, as the server returns) on the left, the「未分類」basket pinned
 * at the far right. Selecting a chip scopes the AI chat (and 歷史) to that
 * project. Double-click an active project chip to rename it inline (= edit the
 * order title, like renaming a Claude chat). Active = solid; 未分類 = dashed.
 * Monochrome + rounded-md (CLAUDE.md §2.1). No native dropdown.
 */
export default function ProjectBar({
  customer,
  projects,
  activeProjectId,
  onSelect,
}: {
  customer: AdaptedCustomer
  projects: Project[]
  activeProjectId: number | null
  onSelect: (id: number | null) => void
}) {
  const { t } = useLocale()
  const utils = trpc.useUtils()
  const sel = toSelection(customer)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const rename = trpc.customerOrders.update.useMutation({
    onSuccess: () => {
      void utils.customerOrders.listForCustomer.invalidate(sel)
      void utils.customerOrders.get.invalidate()
    },
    onError: () => toast.error(t("admin.customers.projects.renameFailed")),
  })

  useEffect(() => {
    if (editingId !== null) inputRef.current?.focus()
  }, [editingId])

  const startEdit = (p: Project) => {
    setEditingId(p.id)
    setDraft(p.title)
  }
  const commit = (p: Project) => {
    setEditingId(null)
    if (shouldCommitRename(p.title, draft)) {
      rename.mutate({ orderId: p.id, title: draft.trim() })
    }
  }

  const chip =
    "flex-shrink-0 text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap transition-colors"

  return (
    <div className="px-6 py-2 border-b border-gray-200 flex items-center gap-1.5 overflow-x-auto">
      {projects.map((p) => {
        const active = p.id === activeProjectId
        if (editingId === p.id) {
          return (
            <input
              key={p.id}
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(p)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  commit(p)
                } else if (e.key === "Escape") {
                  setEditingId(null)
                }
              }}
              className="flex-shrink-0 text-[11px] px-2.5 py-1 rounded-lg border border-gray-400 outline-none focus:border-gray-900 min-w-[120px]"
            />
          )
        }
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            onDoubleClick={() => active && startEdit(p)}
            title={p.departureDate ? shortDate(p.departureDate) : t("admin.customers.projects.renameHint")}
            className={`${chip} ${
              active
                ? "bg-gray-900 text-white"
                : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span className={`mr-1.5 ${active ? "text-gray-500" : "text-gray-400"}`}>
              {p.orderNumber}
            </span>
            {p.title}
          </button>
        )
      })}

      {/* 未分類 basket — pinned far right, dashed, never renamable */}
      <button
        onClick={() => onSelect(null)}
        className={`${chip} inline-flex items-center gap-1 border border-dashed ${
          activeProjectId === null
            ? "bg-gray-900 text-white border-gray-900"
            : "border-gray-300 text-gray-500 hover:bg-gray-50"
        }`}
      >
        <Inbox className="w-3 h-3" />
        {t("admin.customers.projects.unfiled")}
      </button>
    </div>
  )
}
