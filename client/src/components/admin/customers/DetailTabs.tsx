import {
  FileText, DollarSign, CheckCircle2,
  CircleDot, CircleAlert, TriangleAlert, CircleX,
  Circle, Clock, MessageSquare, Calendar, HelpCircle, Bot,
  Download, Plane,
} from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"
import type { AdaptedCustomer, ChecklistItem, TimelineEntry, ChatMessage } from "./types"

const CHECKLIST_ICON: Record<ChecklistItem["s"], React.ReactNode> = {
  done: <CheckCircle2 className="w-3.5 h-3.5 text-gray-900" />,
  pending: <CircleDot className="w-3.5 h-3.5 text-gray-500" />,
  missing: <CircleX className="w-3.5 h-3.5 text-gray-900" />,
  muted: <Circle className="w-3.5 h-3.5 text-gray-300" />,
}

const BADGE_COLOR: Record<string, string> = {
  PDF: "bg-red-600 text-white",
  XLS: "bg-green-600 text-white",
  MSG: "bg-blue-600 text-white",
}

const TL_ICON: Record<TimelineEntry["type"], React.ReactNode> = {
  inquiry: <HelpCircle className="w-4 h-4" />,
  booking: <Calendar className="w-4 h-4" />,
  payment: <DollarSign className="w-4 h-4" />,
  doc: <FileText className="w-4 h-4" />,
  chat: <MessageSquare className="w-4 h-4" />,
}

export function OverviewTab({ customer: c, chatMessages }: { customer: AdaptedCustomer; chatMessages: ChatMessage[] }) {
  const { t } = useLocale()
  const lastMsg = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null
  const recentMsgs = chatMessages.slice(-3)

  return (
    <div className="p-6 space-y-4">
      {/* AI Summary */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
        <SummaryRow label={t("admin.customers.summary.wantsLabel")} value={c.aiSummary.wants} />
        <SummaryRow label={t("admin.customers.summary.actionsLabel")} value={c.aiSummary.actions} />
        <SummaryRow label={t("admin.customers.summary.deliveredLabel")} value={c.aiSummary.delivered} />
      </div>

      {/* Follow-up context */}
      {lastMsg && (
        <div className="rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {t("admin.customers.followUp.recentChat")}
            </div>
            <div className="text-[10px] text-gray-400">
              {lastMsg.createdAt.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}
            </div>
          </div>
          {recentMsgs.map((m) => (
            <div key={m.id} className="flex gap-2.5 text-[12px]">
              <span className="flex-shrink-0 text-[10px] text-gray-400 w-10 pt-0.5">
                {m.createdAt.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}
              </span>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-gray-900">
                  {m.senderRole === "jeff" ? t("admin.customers.followUp.me") : c.name}
                </span>
                <p className="text-gray-600 mt-0.5 line-clamp-2">{m.body}</p>
                {m.context && (
                  <span className="inline-block mt-1 text-[10px] text-orange-600 bg-orange-50 rounded px-1.5 py-0.5">
                    {m.context}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-gray-100 text-[11px] text-gray-500 flex items-center gap-1">
            <Bot className="w-3 h-3" />
            <span className="text-gray-400">{t("admin.customers.followUp.aiNextStep")}</span>
            <span>{t("admin.customers.followUp.aiPending")}</span>
          </div>
        </div>
      )}

      {/* Status banner */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 flex items-start gap-2.5">
        <div className="w-5 h-5 flex-shrink-0 mt-0.5">
          {c.status.type === "action" && <CircleAlert className="w-5 h-5 text-gray-900" />}
          {c.status.type === "warn" && <TriangleAlert className="w-5 h-5 text-gray-900" />}
          {c.status.type === "good" && <CheckCircle2 className="w-5 h-5 text-gray-500" />}
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-semibold">{c.status.title}</div>
          <div className="text-[11.5px] text-gray-500 leading-relaxed mt-0.5">{c.status.desc}</div>
          {c.status.btn && (
            <button
              onClick={() => alert(c.status.act)}
              className="mt-2 px-3.5 py-1.5 rounded-md text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              {c.status.btn}
            </button>
          )}
        </div>
      </div>

      {/* Checklist */}
      {c.status.checklist.length > 0 && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
          {c.status.checklist.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11.5px]">
              {CHECKLIST_ICON[item.s]}
              <span className={item.s === "muted" ? "text-gray-400" : "text-gray-700"}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Bundle */}
      {c.status.bundle && (
        <div className="rounded-xl border border-gray-200 p-4 space-y-2">
          <div className="text-[11px] text-gray-400 font-medium">{t("admin.customers.bundle.title")}</div>
          {c.status.bundle.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-[12px] text-gray-700 py-1.5 border-b border-gray-100 last:border-0"
            >
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${BADGE_COLOR[b.type] ?? "bg-gray-200 text-gray-700"}`}>
                {b.type}
              </span>
              {b.name}
            </div>
          ))}
        </div>
      )}

      {/* Profile strip */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <ProfilePill label={t("admin.customers.profile.passport")} value={c.profile.passport} />
        <ProfilePill label={t("admin.customers.profile.pref")} value={c.profile.pref} />
        <ProfilePill label={t("admin.customers.profile.lang")} value={c.profile.lang} />
        <ProfilePill label={t("admin.customers.profile.source")} value={c.profile.source} />
        <ProfilePill label={t("admin.customers.profile.spend")} value={c.profile.totalSpend > 0 ? `$${c.profile.totalSpend.toLocaleString()}` : "$0"} />
        <ProfilePill label={t("admin.customers.profile.trips")} value={c.profile.trips > 0 ? t("admin.customers.profile.tripsUnit", { n: c.profile.trips }) : t("admin.customers.profile.tripsUnit", { n: 0 })} />
      </div>
    </div>
  )
}

export function OrdersTab({ customer: c }: { customer: AdaptedCustomer }) {
  const { t } = useLocale()
  if (c.orders.length === 0) {
    return <div className="p-6 text-sm text-gray-400">{t("admin.customers.empty.noOrders")}</div>
  }
  const statusLabel = (s: string) =>
    s === "paid" ? t("admin.customers.payment.paid")
      : s === "partial" ? t("admin.customers.payment.partial")
        : t("admin.customers.payment.unpaid")
  return (
    <div className="p-6">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            <th className="text-left py-2 font-medium">{t("admin.customers.payment.tourCol")}</th>
            <th className="text-left py-2 font-medium">{t("admin.customers.payment.destCol")}</th>
            <th className="text-right py-2 font-medium">{t("admin.customers.payment.totalCol")}</th>
            <th className="text-right py-2 font-medium">{t("admin.customers.payment.paidCol")}</th>
            <th className="text-right py-2 font-medium">{t("admin.customers.payment.statusCol")}</th>
            <th className="text-right py-2 font-medium">{t("admin.customers.payment.dateCol")}</th>
          </tr>
        </thead>
        <tbody>
          {c.orders.map((o, i) => (
            <tr key={i} className="border-b border-gray-50">
              <td className="py-2 font-medium text-gray-900">{o.name}</td>
              <td className="py-2 text-gray-600">{o.dest}</td>
              <td className="py-2 text-right">${o.total.toLocaleString()}</td>
              <td className="py-2 text-right">${o.paid.toLocaleString()}</td>
              <td className="py-2 text-right">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    o.status === "paid"
                      ? "bg-gray-200 text-gray-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {statusLabel(o.status)}
                </span>
              </td>
              <td className="py-2 text-right text-gray-500">{o.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DocsTab({ customer: c }: { customer: AdaptedCustomer }) {
  const { t } = useLocale()
  if (c.docs.length === 0) {
    return <div className="p-6 text-sm text-gray-400">{t("admin.customers.empty.noDocs")}</div>
  }
  return (
    <div className="p-6 space-y-2">
      {c.docs.map((d) => {
        const Icon = d.kind === "flight" ? Plane : FileText
        const row = (
          <>
            <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-gray-900 truncate">
                <span className="text-[10px] text-gray-400 mr-1.5">
                  {t(`admin.customers.docKind.${d.kind}`)}
                </span>
                {d.name}
              </div>
              {d.meta && <div className="text-[10px] text-gray-400 truncate">{d.meta}</div>}
            </div>
            <div className="text-[10px] text-gray-400 flex-shrink-0">{d.date}</div>
            {d.url && <Download className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
          </>
        )
        const cls =
          "flex items-center gap-3 p-3 rounded-lg border border-gray-100 transition-colors"
        return d.url ? (
          <a
            key={d.id}
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${cls} hover:bg-gray-50 cursor-pointer`}
          >
            {row}
          </a>
        ) : (
          <div key={d.id} className={cls}>
            {row}
          </div>
        )
      })}
    </div>
  )
}

export function TimelineTab({ customer: c }: { customer: AdaptedCustomer }) {
  return (
    <div className="p-6">
      <div className="relative pl-7">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" />
        {c.timeline.map((t, i) => (
          <div key={i} className="relative flex gap-3 pb-5 last:pb-0">
            <div className="absolute left-[-21px] w-4 h-4 rounded-full bg-white border border-gray-300 flex items-center justify-center text-gray-500">
              {TL_ICON[t.type]}
            </div>
            <div>
              <div className="text-[12px] font-medium text-gray-900">{t.title}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{t.desc}</div>
              <div className="text-[10px] text-gray-400 mt-1">{t.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 text-[12px] leading-relaxed border-b border-gray-100 last:border-0 pb-2 last:pb-0">
      <span className="flex-shrink-0 w-20 font-semibold text-gray-900 text-[11.5px] pt-px">
        {label}
      </span>
      <span className="flex-1 text-gray-700">{value}</span>
    </div>
  )
}

function ProfilePill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-gray-300 rounded-full px-3 py-1">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </span>
  )
}
