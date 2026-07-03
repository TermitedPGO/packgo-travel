import { useLocale } from "@/contexts/LocaleContext"
import { trpc } from "@/lib/trpc"
import type { Selection } from "./useCustomerData"

/** Mirrors server/services/todayList.ts TodayListItem (tRPC output shape). */
type TodayListItem = {
  category: "followUpDue" | "quoteExpiring" | "commitment" | "departureCountdown" | "balanceDue"
  customerProfileId: number
  userId: number | null
  customerName: string | null
  oneLiner: string
  sortKey: number | string
}

/**
 * customer-cockpit Phase4 — 中欄空狀態的今日待辦清單(design-phase3-4.md
 * 「Phase4:今日清單」)。沒選客人時顯示,取代純文字的 selectCustomer 空狀態。
 * 每項點擊呼叫既有 onSelect/setSelected 機制跳過去 —— 不發明新路由。
 *
 * userId != null → registered customer,ref 的 id 是 userId(CustomerList.tsx
 * 既有的 {id, kind} 慣例,registered 客人的 id 是 userId 不是 profileId);
 * userId == null → guest,ref 的 id 就是 customerProfileId 本身。
 */
export default function TodayList({ onSelect }: { onSelect: (ref: Selection) => void }) {
  const { t } = useLocale()
  const { data, isLoading } = trpc.customerOrders.todayList.useQuery()

  const items = [...(data ?? [])].sort((a, b) => {
    if (typeof a.sortKey === "number" && typeof b.sortKey === "number") {
      return a.sortKey - b.sortKey
    }
    return String(a.sortKey).localeCompare(String(b.sortKey))
  })

  const handleClick = (item: TodayListItem) => {
    if (item.userId != null) {
      onSelect({ id: item.userId, kind: "user" })
    } else {
      onSelect({ id: item.customerProfileId, kind: "guest" })
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        {t("admin.customers.selectCustomer")}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-1.5 text-sm text-gray-400">
        <div>{t("admin.customers.selectCustomer")}</div>
        <div className="text-[13px]">{t("admin.customers.todayList.empty")}</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-lg mx-auto space-y-3">
        <div className="text-[13px] font-medium text-gray-500">
          {t("admin.customers.todayList.heading")}
        </div>
        <div className="space-y-2">
          {items.map((item, i) => (
            <button
              key={`${item.category}-${item.customerProfileId}-${i}`}
              type="button"
              onClick={() => handleClick(item)}
              className="w-full text-left rounded-xl border border-gray-200 px-3.5 py-3 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 font-medium flex-shrink-0">
                  {t(`admin.customers.todayList.category.${item.category}`)}
                </span>
              </div>
              <div className="text-[13px] text-gray-900 mt-1.5 leading-snug">
                {item.oneLiner}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
