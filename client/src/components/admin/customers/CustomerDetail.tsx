import { useState } from "react"
import { Phone, Mail, Star, CalendarClock, X } from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"
import { trpc } from "@/lib/trpc"
import { toast } from "sonner"
import type { AdaptedCustomer, ChatMessage } from "./types"
import { OverviewTab, OrdersTab, DocsTab, TimelineTab } from "./DetailTabs"
import { deriveBallInCourt, deriveNextMove } from "./adapters"
import { toSelection } from "./customOrderHelpers"

const TAB_KEYS = ["overview", "orders", "docs", "history"] as const
type TabKey = (typeof TAB_KEYS)[number]

export default function CustomerDetail({ customer, chatMessages = [] }: { customer: AdaptedCustomer; chatMessages?: ChatMessage[] }) {
  const { t } = useLocale()
  const [tab, setTab] = useState<TabKey>("overview")
  const c = customer

  // Q4-A — per-customer follow-up date. Set/clear writes go through the same
  // selection key the rest of the customer page uses; on success we invalidate
  // the detail query so the truth bar re-reads followUpDate without a manual
  // refresh. All deterministic — no LLM.
  const utils = trpc.useUtils()
  const sel = toSelection(c)
  const invalidateDetail = () => {
    if (c.kind === "guest") void utils.admin.guestOpenItems.invalidate({ profileId: c.id })
    else void utils.admin.customerDetail.invalidate({ userId: c.id })
  }
  const setFollowUp = trpc.admin.setFollowUpDate.useMutation({
    onSuccess: invalidateDetail,
    onError: () => toast.error(t("admin.customers.followup.saveFailed")),
  })

  const tabLabel = (k: TabKey) => t(`admin.customers.tab.${k}`)

  // 五秒真相條 (Step 1): all deterministic — ball-in-court from who spoke last,
  // days from the existing followup signal, next move from the two combined.
  const ball = deriveBallInCourt(chatMessages)
  const nextMove = deriveNextMove(ball, c.followup)
  const truthDays = c.followup.daysSinceContact

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
        </div>
      </div>

      {/* 五秒真相條 (Step 1): 下一步 · N 天沒往來。換你回/該跟進=深色提醒,其餘灰。
          下一步本身就是「輪到誰」,不用「球」這種比喻。全部 deterministic,不靠 LLM。
          右側是 Q4-A 客人跟進日:設了且到期 → 深色「今天該跟進」;設了但未來 → 淺色顯示日期。 */}
      <div className="px-6 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-2 text-[11px]">
        <span
          className={`px-1.5 py-0.5 rounded-md font-medium ${
            nextMove === "reply" || nextMove === "followup"
              ? "bg-gray-900 text-white"
              : "bg-gray-200 text-gray-700"
          }`}
        >
          {t(`admin.customers.truth.next.${nextMove}`)}
        </span>
        {truthDays !== null && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500">
              {truthDays === 0
                ? t("admin.customers.truth.today")
                : t("admin.customers.truth.quiet", { n: truthDays })}
            </span>
          </>
        )}

        {/* 客人跟進日 (Q4-A) — display + quick clear only. 設定改由右欄 ops AI chat
            打字(例「跟進日設下週三」),AI 解析後寫入 → 真相條這裡浮出。刻意不放原生
            date picker(Jeff:不要 default ui/ux)。未設時不顯示任何控制項。 */}
        {c.followup.followUpDate && (
          <div className="ml-auto flex items-center gap-1.5">
            {c.followup.isDue ? (
              <span className="px-1.5 py-0.5 rounded-md font-medium bg-gray-900 text-white inline-flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />
                {t("admin.customers.followup.dueToday")}
              </span>
            ) : (
              <span className="text-gray-500 inline-flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />
                {t("admin.customers.followup.scheduled", { date: c.followup.followUpDate })}
              </span>
            )}
            <button
              onClick={() => setFollowUp.mutate({ ...sel, followUpDate: null })}
              disabled={setFollowUp.isPending}
              title={t("admin.customers.followup.clearDate")}
              aria-label={t("admin.customers.followup.clearDate")}
              className="p-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

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
        {tab === "history" && <TimelineTab customer={c} chatMessages={chatMessages} />}
      </div>
    </div>
  )
}
