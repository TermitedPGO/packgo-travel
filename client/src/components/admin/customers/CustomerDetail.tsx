import { useState } from "react"
import { Phone, Mail, FileText, FileCheck, DollarSign, Star } from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"
import type { AdaptedCustomer, ChatMessage } from "./types"
import { OverviewTab, OrdersTab, DocsTab, TimelineTab } from "./DetailTabs"
import CustomOrderSheet from "./CustomOrderSheet"

const TAB_KEYS = ["overview", "orders", "docs", "history"] as const
type TabKey = (typeof TAB_KEYS)[number]
type FocusSection = "quote" | "collect" | "confirm" | null

export default function CustomerDetail({ customer, chatMessages = [] }: { customer: AdaptedCustomer; chatMessages?: ChatMessage[] }) {
  const { t } = useLocale()
  const [tab, setTab] = useState<TabKey>("overview")
  const [orderSheet, setOrderSheet] = useState<{ open: boolean; focus: FocusSection }>({ open: false, focus: null })
  const openOrders = (focus: FocusSection) => setOrderSheet({ open: true, focus })
  const c = customer

  const tabLabel = (k: TabKey) => t(`admin.customers.tab.${k}`)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-3.5 border-b border-gray-200 flex items-center gap-3.5">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0"
          style={{ background: c.color, color: c.textColor }}
        >
          {c.initials}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold flex items-center gap-2">
            {c.name}
            {c.profile.vip && <Star className="w-3.5 h-3.5 text-gray-900 fill-gray-900" />}
          </h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {c.email} · {c.phone}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {c.followup.daysSinceContact !== null && (
              <span className="text-[11px] text-gray-500">
                {c.followup.daysSinceContact === 0
                  ? t("admin.customers.followup.today")
                  : t("admin.customers.followup.lastContact", {
                      n: c.followup.daysSinceContact,
                    })}
              </span>
            )}
            {c.followup.needsFollowup && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-900 text-white">
                {t("admin.customers.followup.badge")}
                {c.followup.reason
                  ? ` · ${t(`admin.customers.followup.reason.${c.followup.reason}`)}`
                  : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={() => {
              if (c.phone) window.location.href = `tel:${c.phone.replace(/[^\d+]/g, "")}`
            }}
            disabled={!c.phone}
            title={c.phone || t("admin.customers.action.call")}
            aria-label={t("admin.customers.action.call")}
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Phone className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (c.email) window.location.href = `mailto:${c.email}`
            }}
            disabled={!c.email}
            title={c.email || t("admin.customers.action.email")}
            aria-label={t("admin.customers.action.email")}
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Mail className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => openOrders("quote")}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors"
          >
            <FileText className="w-3 h-3 inline mr-1 -mt-px" />
            {t("admin.customers.action.quote")}
          </button>
          <button
            onClick={() => openOrders("collect")}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-400 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <DollarSign className="w-3 h-3 inline mr-1 -mt-px" />
            {t("admin.customers.action.collect")}
          </button>
          <button
            onClick={() => openOrders("confirm")}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-400 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileCheck className="w-3 h-3 inline mr-1 -mt-px" />
            {t("admin.customers.action.confirm")}
          </button>
        </div>
      </div>

      <CustomOrderSheet
        open={orderSheet.open}
        onClose={() => setOrderSheet({ open: false, focus: null })}
        customer={c}
        focusSection={orderSheet.focus}
      />

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-6">
        {TAB_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === k
                ? "text-gray-900 border-gray-900"
                : "text-gray-500 border-transparent hover:text-gray-700"
            }`}
          >
            {tabLabel(k)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "overview" && <OverviewTab customer={c} chatMessages={chatMessages} />}
        {tab === "orders" && <OrdersTab customer={c} />}
        {tab === "docs" && <DocsTab customer={c} />}
        {tab === "history" && <TimelineTab customer={c} />}
      </div>
    </div>
  )
}
