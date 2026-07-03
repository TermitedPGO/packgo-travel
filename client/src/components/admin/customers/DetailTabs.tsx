import { useState, useEffect, useMemo, useRef } from "react"
import {
  FileText, DollarSign, CheckCircle2,
  CircleDot, CircleAlert, TriangleAlert, CircleX,
  Circle, Clock, MessageSquare, Calendar, HelpCircle, Bot,
  Download, Plane, Plus, RefreshCw, Sparkles, Loader2,
  Inbox, FolderInput,
} from "lucide-react"
import { toast } from "sonner"
import { useLocale } from "@/contexts/LocaleContext"
import { trpc } from "@/lib/trpc"
import type { AdaptedCustomer, ChecklistItem, TimelineEntry, ChatMessage, Project } from "./types"
import CustomOrderSheet from "./CustomOrderSheet"
import { toSelection, fmtMoney, shortDate } from "./customOrderHelpers"
import { stripQuotedReply } from "./conversationText"
import {
  deriveProjectActions,
  deriveProjectDelivered,
  deriveProjectSummaryState,
  deriveOrderUnderstandingState,
  splitOrderUnderstanding,
  projectDeliveredDocNames,
} from "./projectSummary"

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

/** Compact localized "updated N ago" for the AI summary header. Accepts a Date
 *  or an ISO string (tRPC may serialize either). */
function relativeUpdated(
  d: Date | string,
  t: ReturnType<typeof useLocale>["t"],
): string {
  const ms = Date.now() - new Date(d).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return t("admin.customers.summary.updatedJustNow")
  if (min < 60) return t("admin.customers.summary.updatedMinAgo", { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t("admin.customers.summary.updatedHrAgo", { n: hr })
  return t("admin.customers.summary.updatedDayAgo", { n: Math.floor(hr / 24) })
}

/** Margin as a compact percent string. -0.12 → "-12%", 0.149 → "14.9%". */
function formatMarginPct(p: number): string {
  const v = p * 100
  return `${Number.isInteger(v) ? v : Number(v.toFixed(1))}%`
}

/** M/D in the viewer's local clock (Jeff = Pacific), matching the chat-row dates
 *  elsewhere in this tab. Accepts a Date or ISO string (tRPC may serialize either). */
function md(d: string | Date): string {
  return new Date(d).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })
}

/**
 * Step 5 看門狗:打開客人最上面跳警示卡。純規則(server),admin-only,不改不送。
 *   - margin 類:售價對不上後台成本(賠錢 / 毛利過薄),售價/成本/毛利三個數字直接攤給 Jeff。
 *   - promise 類(v2):答應了還沒寄(說好的報價 7 天 / 訂金收了確認書 3 天)。
 */
function MarginWatchdogBanner({ customer: c }: { customer: AdaptedCustomer }) {
  const { t } = useLocale()
  const k = (s: string) => t(`admin.customers.watchdog.${s}`)
  const q = trpc.customerOrders.watchdogForCustomer.useQuery(toSelection(c))
  const all = q.data ?? []
  const findings = all.filter((f) => f.kind === "margin")
  const promises = all.filter((f) => f.kind === "promise")
  const invoiceMismatches = all.filter((f) => f.kind === "invoiceMismatch")
  const paymentMatches = all.filter((f) => f.kind === "paymentMatch")
  // 2c — 點卡片導去那張訂單:沿用 CustomOrdersSection 既有的「本地 sheet 狀態 +
  // CustomOrderSheet」模式(同檔案 717 行附近),不發明新的導航機制。
  const [sheet, setSheet] = useState<{ open: boolean; orderId?: number | null }>({ open: false })
  if (all.length === 0) return null
  return (
    <div className="space-y-2">
      {findings.map((f) => {
        const red = f.level === "red"
        return (
          <div
            key={f.orderId}
            className={`rounded-xl border p-3 flex items-start gap-2.5 ${
              red ? "border-red-300 bg-red-50/50" : "border-amber-300 bg-amber-50/50"
            }`}
          >
            <TriangleAlert
              className={`w-5 h-5 flex-shrink-0 mt-0.5 ${red ? "text-red-600" : "text-amber-600"}`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-gray-900">
                {k("title")}
                <span className="text-[10px] text-gray-400 font-normal ml-1.5">{f.orderNumber}</span>
              </div>
              <div className="text-[11.5px] text-gray-600 mt-0.5 truncate">
                {f.title} · {k(`reason.${f.reason}`)}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-[12px] text-gray-700">
                <span>
                  {k("sell")}{" "}
                  <span className="font-semibold text-gray-900">{fmtMoney(f.totalPrice, f.currency)}</span>
                </span>
                <span>
                  {k("cost")}{" "}
                  <span className="font-semibold text-gray-900">{fmtMoney(f.supplierCost, f.currency)}</span>
                </span>
                <span>
                  {k("margin")}{" "}
                  <span className={`font-semibold ${red ? "text-red-600" : "text-amber-600"}`}>
                    {formatMarginPct(f.marginPct)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        )
      })}
      {/* promise 類(答應了還沒寄)— 一律黃燈提醒,講白話,不用術語。 */}
      {promises.map((f) => (
        <div
          key={`promise-${f.orderId}-${f.reason}`}
          className="rounded-xl border border-amber-300 bg-amber-50/50 p-3 flex items-start gap-2.5"
        >
          <TriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-gray-900">
              {k(`promise.${f.reason}`)}
              <span className="text-[10px] text-gray-400 font-normal ml-1.5">{f.orderNumber}</span>
            </div>
            <div className="text-[11.5px] text-gray-600 mt-0.5 truncate">
              {f.title} · {t("admin.customers.watchdog.promise.days", { n: f.daysWaiting })}
            </div>
          </div>
        </div>
      ))}
      {/* invoiceMismatch 類(2a)— 訂單金額對不上文件裡的發票/確認單總額,黃燈提醒
          Jeff 核對(規則本身不知道誰對誰錯,只負責發現落差)。 */}
      {invoiceMismatches.map((f) => (
        <div
          key={`invoiceMismatch-${f.orderId}`}
          className="rounded-xl border border-amber-300 bg-amber-50/50 p-3 flex items-start gap-2.5"
        >
          <TriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-gray-900">
              {k("invoiceMismatch.title")}
              <span className="text-[10px] text-gray-400 font-normal ml-1.5">{f.orderNumber}</span>
            </div>
            <div className="text-[11.5px] text-gray-600 mt-0.5 truncate">{f.title}</div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-[12px] text-gray-700">
              <span>
                {k("invoiceMismatch.systemAmount")}{" "}
                <span className="font-semibold text-gray-900">{fmtMoney(f.systemAmount, f.currency)}</span>
              </span>
              <span>
                {k("invoiceMismatch.documentAmount")}{" "}
                <span className="font-semibold text-amber-600">{fmtMoney(f.documentAmount, f.currency)}</span>
              </span>
            </div>
          </div>
        </div>
      ))}
      {/* paymentMatch 類(2c)— 銀行流水入帳金額吻合這張單的欠款,黃卡建議「疑似
          收款了」。純建議,AI 絕不自動標記付款狀態 —— 點卡片只導去訂單頁,標記
          已收款永遠是 Jeff 自己點 recordPayment。candidateOrderIds > 1 時誠實講
          「可能是這幾張單其中一張」,不暗示系統已經確定是哪一張。 */}
      {paymentMatches.map((f) => (
        <button
          key={`paymentMatch-${f.orderId}`}
          onClick={() => setSheet({ open: true, orderId: f.orderId })}
          className="w-full text-left rounded-xl border border-amber-300 bg-amber-50/50 p-3 flex items-start gap-2.5 hover:bg-amber-50 transition-colors"
        >
          <TriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-gray-900">
              {k("paymentMatch.title")}
              <span className="text-[10px] text-gray-400 font-normal ml-1.5">{f.orderNumber}</span>
            </div>
            <div className="text-[11.5px] text-gray-600 mt-0.5 truncate">
              {f.title} · {k(`paymentMatch.leg.${f.legKind}`)}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-[12px] text-gray-700">
              <span>
                {k("paymentMatch.amount")}{" "}
                <span className="font-semibold text-amber-600">{fmtMoney(f.matchedAmount, "USD")}</span>
              </span>
              <span>
                {k("paymentMatch.date")}{" "}
                <span className="font-semibold text-gray-900">{shortDate(f.transactionDate)}</span>
              </span>
              {f.accountMask && (
                <span>
                  {k("paymentMatch.account")}{" "}
                  <span className="font-semibold text-gray-900">···{f.accountMask}</span>
                </span>
              )}
            </div>
            {f.candidateOrderIds.length > 1 && (
              <div className="text-[11px] text-amber-700 mt-1">
                {t("admin.customers.watchdog.paymentMatch.ambiguous", { n: f.candidateOrderIds.length })}
              </div>
            )}
          </div>
        </button>
      ))}
      <CustomOrderSheet
        open={sheet.open}
        initialOrderId={sheet.orderId ?? null}
        onClose={() => setSheet({ open: false })}
        customer={c}
      />
    </div>
  )
}

function LearnedPreferencesSection({ customer: c }: { customer: AdaptedCustomer }) {
  const { t } = useLocale()
  const utils = trpc.useUtils()
  const scopeInput = c.kind === "guest" ? { profileId: c.id } : { userId: c.id }
  const q = trpc.admin.customerLearnedPreferences.useQuery(scopeInput, {
    staleTime: 30_000,
    refetchInterval: q => q.state.data?.extracting ? 5000 : false,
  })
  const trigger = trpc.admin.triggerPreferenceExtraction.useMutation({
    onSuccess: () => {
      setTimeout(() => utils.admin.customerLearnedPreferences.invalidate(scopeInput), 8000)
    },
  })

  const d = q.data
  if (!d) return null
  const empty = !d.aiNotes && !d.keyFacts && !d.preferences
  if (empty && !d.extracting && !trigger.isPending) return null

  const busy = d.extracting || trigger.isPending

  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5">
          <Sparkles className="w-3 h-3" />
          {t("admin.customers.learned.title")}
          {busy && (
            <span className="text-gray-400 flex items-center gap-1">
              · <Loader2 className="w-3 h-3 animate-spin" />
              {t("admin.customers.learned.extracting")}
            </span>
          )}
        </div>
        <button
          onClick={() => trigger.mutate(scopeInput)}
          disabled={busy}
          className="text-[10px] font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1 rounded-lg px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
          {t("admin.customers.learned.refresh")}
        </button>
      </div>
      {d.aiNotes && (
        <div className="text-[12px] text-gray-700 leading-relaxed">{d.aiNotes}</div>
      )}
      {d.keyFacts && (
        <div className="space-y-1 mt-1">
          {d.keyFacts
            .split("\n")
            .filter((l) => l.trim())
            .map((line, i) => (
              <div key={i} className="text-[11.5px] text-gray-600 flex gap-1.5">
                <span className="text-gray-400 flex-shrink-0">·</span>
                <span>{line.replace(/^-\s*/, "")}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

/**
 * order-ai-understanding (0107) — 本專案客人理解. Jeff:「AI 客人理解 每一個專案
 * 都應該是專門的 太多會太亂」. Reads the CACHED customOrders.aiUnderstanding that
 * already arrived with the projectOrder row (customerOrders.get) — opening the
 * card never spends an LLM call. 重新分析 (customerOrders.analyzeOrder) is the
 * ONLY compute path; it invalidates the order query so the fresh cache
 * re-renders. Empty cache → honest empty state (still with the button). The
 * whole-customer LearnedPreferencesSection renders ONLY when no project chip is
 * active (deriveOrderUnderstandingState, pure + unit-tested).
 */
function OrderUnderstandingSection({
  customer: c,
  orderId,
  order,
  state,
}: {
  customer: AdaptedCustomer
  orderId: number
  order: { aiUnderstanding: string | null; aiUnderstandingAt: string | Date | null }
  state: "cached" | "empty"
}) {
  const { t } = useLocale()
  const utils = trpc.useUtils()
  const analyze = trpc.customerOrders.analyzeOrder.useMutation({
    onSuccess: (r) => {
      if (!r.analyzed) toast(t("admin.customers.learned.projectNoMaterial"))
      void utils.customerOrders.get.invalidate({ orderId })
    },
    onError: () => toast.error(t("admin.customers.learned.analyzeFailed")),
  })
  const busy = analyze.isPending
  const parsed =
    state === "cached" && order.aiUnderstanding
      ? splitOrderUnderstanding(order.aiUnderstanding)
      : null
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5">
          <Sparkles className="w-3 h-3" />
          {t("admin.customers.learned.title")}
          <span className="text-gray-300">· {t("admin.customers.summary.projectHeader")}</span>
          {busy ? (
            <span className="text-gray-400 flex items-center gap-1">
              · <Loader2 className="w-3 h-3 animate-spin" />
              {t("admin.customers.learned.extracting")}
            </span>
          ) : (
            order.aiUnderstandingAt && (
              <span className="text-gray-300">
                · {relativeUpdated(order.aiUnderstandingAt, t)}
              </span>
            )
          )}
        </div>
        <button
          onClick={() => analyze.mutate({ selection: toSelection(c), orderId })}
          disabled={busy}
          className="text-[10px] font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1 rounded-lg px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
          {t("admin.customers.learned.refresh")}
        </button>
      </div>
      {parsed ? (
        <>
          {parsed.paragraphs.map((p, i) => (
            <div key={i} className="text-[12px] text-gray-700 leading-relaxed">
              {p}
            </div>
          ))}
          {parsed.facts.length > 0 && (
            <div className="space-y-1 mt-1">
              {parsed.facts.map((line, i) => (
                <div key={i} className="text-[11.5px] text-gray-600 flex gap-1.5">
                  <span className="text-gray-400 flex-shrink-0">·</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-[12px] text-gray-400">
          {t("admin.customers.learned.projectEmpty")}
        </div>
      )}
    </div>
  )
}

/**
 * customer-projects (§5) — deterministic per-project facts card for the 概覽 tab.
 * Reads straight from the order row (no LLM, no fabrication). Shows 售價 (totalPrice)
 * + 已收 (depositPaidAmount+balancePaidAmount) + dates + doc count + notes. NEVER
 * shows supplierCost (成本 stays internal, off customer-facing anything).
 */
function ProjectOverviewCard({
  order,
  docCount,
}: {
  order: {
    orderNumber: string
    title: string
    category: string | null
    status: string
    totalPrice: string | null
    currency: string
    departureDate: string | null
    returnDate: string | null
    depositPaidAmount: string | null
    balancePaidAmount: string | null
    notes: string | null
  }
  docCount: number
}) {
  const { t } = useLocale()
  const received = Number(order.depositPaidAmount ?? 0) + Number(order.balancePaidAmount ?? 0)
  const rows: { label: string; value: string }[] = []
  if (order.totalPrice != null && order.totalPrice !== "")
    rows.push({ label: t("admin.customers.order.fldTotal"), value: fmtMoney(order.totalPrice, order.currency) })
  if (received > 0)
    rows.push({ label: t("admin.customers.order.received"), value: fmtMoney(received, order.currency) })
  if (order.departureDate)
    rows.push({ label: t("admin.customers.order.fldDeparture"), value: shortDate(order.departureDate) })
  if (order.returnDate)
    rows.push({ label: t("admin.customers.order.fldReturn"), value: shortDate(order.returnDate) })

  return (
    <div className="rounded-xl bg-white border border-gray-200 p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-gray-400 font-medium">
          {t("admin.customers.summary.projectHeader")} · {order.orderNumber}
        </div>
        <span className="text-[10px] text-gray-500 bg-gray-100 rounded-md px-1.5 py-0.5 flex-shrink-0">
          {t(`admin.customers.order.status.${order.status}`)}
        </span>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">{order.title}</div>
        {order.category && (
          <span className="text-[10px] text-gray-500 bg-gray-100 rounded-md px-1.5 py-0.5 flex-shrink-0">
            {t(`admin.customers.projects.category.${order.category}`)}
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-gray-400">{r.label}</span>
              <span className="text-gray-900 font-medium">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
        <FileText className="w-3 h-3" />
        {t("admin.customers.summary.docsCount", { n: docCount })}
      </div>
      {order.notes && (
        <div className="text-[11px] text-gray-500 border-t border-gray-100 pt-2 whitespace-pre-wrap">
          {t("admin.customers.order.notes")}: {order.notes}
        </div>
      )}
    </div>
  )
}

export function OverviewTab({
  customer: c,
  chatMessages,
  activeProjectId = null,
}: {
  customer: AdaptedCustomer
  chatMessages: ChatMessage[]
  activeProjectId?: number | null
}) {
  const { t } = useLocale()
  const [showAllChat, setShowAllChat] = useState(false)
  // customer-projects (§5) — when a ProjectBar chip is active, show that project's
  // OWN deterministic facts at the top (title/category/status/售價/dates/docs/notes),
  // straight from the order row — no LLM, no fabrication. The 摘要三行 below
  // follow the same order; only when the order is unavailable do they fall back
  // to the customer-level blend, explicitly labeled 整體 (see projState).
  const projectOrderQ = trpc.customerOrders.get.useQuery(
    { orderId: activeProjectId ?? 0 },
    { enabled: activeProjectId != null, staleTime: 30_000 },
  )
  const projectOrder = activeProjectId != null ? (projectOrderQ.data ?? null) : null
  // 誤讀防護 — loading → skeleton (never unlabeled whole-customer text posing as
  // this project); settled without an order (query failed / order gone) → the
  // whole-customer summary renders WITH the 整體 caption. Pure + unit-tested.
  const projState = deriveProjectSummaryState({
    activeProjectId,
    hasOrder: projectOrder != null,
    isFetching: projectOrderQ.isFetching,
  })
  const projectDocCount =
    activeProjectId != null
      ? c.docs.filter((d) => (d.customOrderId ?? null) === activeProjectId).length
      : 0
  // order-ai-understanding (0107) — which AI 客人理解 card may render (pure fn,
  // unit-tested). Profile card ONLY when no chip; a chip shows THIS project's
  // cached understanding (or an honest empty state — never an auto LLM call).
  const understandingState = deriveOrderUnderstandingState({
    activeProjectId,
    hasOrder: projectOrder != null,
    isFetching: projectOrderQ.isFetching,
    aiUnderstanding: projectOrder?.aiUnderstanding ?? null,
  })
  const lastMsg = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null
  // expanded → the whole thread (oldest→newest), full text; collapsed → last 3 preview
  const shownMsgs = showAllChat ? chatMessages : chatMessages.slice(-3)

  // 批3 m3/m5 — the real AI summary. Read the cache (秒開), fall back to the
  // rule-based c.aiSummary while it computes / if the LLM fails, and lazily
  // recompute once when the cache is stale (missing / >24h / newer activity).
  const utils = trpc.useUtils()
  const scopeInput = c.kind === "guest" ? { profileId: c.id } : { userId: c.id }
  const summaryQ = trpc.admin.customerAiSummary.useQuery(scopeInput, {
    staleTime: 60_000,
  })
  const refreshSummary = trpc.admin.refreshCustomerAiSummary.useMutation({
    onSuccess: () => utils.admin.customerAiSummary.invalidate(scopeInput),
  })
  const refreshedFor = useRef<string | null>(null)
  useEffect(() => {
    const key = `${c.kind}:${c.id}`
    const d = summaryQ.data
    if (!d) return
    if (d.stale && refreshedFor.current !== key && !refreshSummary.isPending) {
      refreshedFor.current = key
      refreshSummary.mutate(scopeInput)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.kind, c.id, summaryQ.data])

  const cached = summaryQ.data?.summary
  const busy = refreshSummary.isPending || summaryQ.isFetching
  const aiNextStep = cached?.nextStep || c.aiSummary.nextStep || ""
  const generatedAt = summaryQ.data?.generatedAt ?? null

  // customer-projects — when a project chip is active AND its order has loaded, the
  // 摘要三行 describe THAT project, computed deterministically from the order row +
  // its outbound docs (搬運不生成, no LLM). Otherwise the whole-customer LLM summary
  // (labeled 整體 when a chip is active but the order is unavailable — projState).
  const projActionParts = projectOrder
    ? deriveProjectActions(projectOrder).map(
        (a) => `${t(`admin.customers.summary.projAction.${a.key}`)} ${md(a.at)}`,
      )
    : []
  const projDeliveredParts =
    projectOrder && activeProjectId != null
      ? [
          ...deriveProjectDelivered(projectOrder).map(
            (d) => `${t(`admin.customers.summary.projDelivered.${d.key}`)} ${md(d.at)}`,
          ),
          ...projectDeliveredDocNames(c.docs, activeProjectId, projectOrder),
        ]
      : []
  const aiWants = projectOrder
    ? projectOrder.category
      ? t(`admin.customers.projects.category.${projectOrder.category}`)
      : projectOrder.title
    : cached?.wants || c.aiSummary.wants
  const aiActions = projectOrder
    ? projActionParts.join("、") || t("admin.customers.summary.projActionsEmpty")
    : cached?.actions || c.aiSummary.actions
  const aiDelivered = projectOrder
    ? projDeliveredParts.join("、") || t("admin.customers.summary.projDeliveredEmpty")
    : cached?.delivered || c.aiSummary.delivered

  return (
    <div className="p-6 space-y-4">
      {/* Step 5 看門狗:漏價警示(打開客人最上面就看到) */}
      <MarginWatchdogBanner customer={c} />

      {/* 本專案(§5)— 選了專案 chip 時,頂端出這張單自己的事實卡;下方的 AI 摘要
          三行也跟著這張單走(deterministic,計算在 OverviewTab 上方)。載入中先出
          skeleton 佔位,拿不到單(失敗/被刪)就不出卡 — 摘要那邊會標「整體」。 */}
      {projState === "loading" && (
        <div className="rounded-xl bg-white border border-gray-200 p-4 space-y-2.5 animate-pulse">
          <div className="h-3 w-40 rounded-md bg-gray-200" />
          <div className="h-4 w-56 rounded-md bg-gray-200" />
          <div className="h-3 w-full rounded-md bg-gray-200" />
        </div>
      )}
      {projectOrder && <ProjectOverviewCard order={projectOrder} docCount={projectDocCount} />}

      {/* AI Summary — whole-customer LLM blend, OR (project active) that project's
          deterministic 摘要三行. 重算鈕 + 更新時間 only apply to the LLM version;
          the per-project one is 搬運 from the order row so there is nothing to
          refresh. projState=loading → skeleton rows; projState=fallback → the
          whole-customer rows are explicitly labeled 整體 (overallCaption), never
          silently posing as this project. */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5">
            <Bot className="w-3 h-3" />
            {t("admin.customers.summary.aiLabel")}
            {projState === "project" || projState === "loading" ? (
              <span className="text-gray-300">· {t("admin.customers.summary.projectHeader")}</span>
            ) : projState === "fallback" ? (
              <span className="text-gray-300">· {t("admin.customers.summary.overallCaption")}</span>
            ) : busy ? (
              <span className="text-gray-400">· {t("admin.customers.summary.generating")}</span>
            ) : (
              generatedAt && (
                <span className="text-gray-300">· {relativeUpdated(generatedAt, t)}</span>
              )
            )}
          </div>
          {(projState === "none" || projState === "fallback") && (
            <button
              onClick={() => refreshSummary.mutate(scopeInput)}
              disabled={busy}
              className="text-[10px] font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1 rounded-lg px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
              {t("admin.customers.summary.refresh")}
            </button>
          )}
        </div>
        {projState === "loading" ? (
          <div className="space-y-2 pt-1 animate-pulse">
            <div className="h-3 w-3/4 rounded-md bg-gray-200" />
            <div className="h-3 w-2/3 rounded-md bg-gray-200" />
            <div className="h-3 w-1/2 rounded-md bg-gray-200" />
          </div>
        ) : (
          <>
            <SummaryRow label={t("admin.customers.summary.wantsLabel")} value={aiWants} />
            <SummaryRow label={t("admin.customers.summary.actionsLabel")} value={aiActions} />
            <SummaryRow label={t("admin.customers.summary.deliveredLabel")} value={aiDelivered} />
          </>
        )}
      </div>

      {/* AI 客人理解 — 選了專案 chip 就只出「本專案客人理解」卡(讀 customOrders
          快取欄位,按重新分析才燒 LLM);整體(profile 層)理解卡只在沒選專案時
          出現(Jeff:每一個專案都應該是專門的,太多會太亂)。狀態判斷是純函式
          deriveOrderUnderstandingState(unit-tested)。 */}
      {understandingState === "profile" ? (
        <LearnedPreferencesSection customer={c} />
      ) : understandingState === "loading" ? (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2 animate-pulse">
          <div className="h-3 w-32 rounded-md bg-gray-200" />
          <div className="h-3 w-3/4 rounded-md bg-gray-200" />
        </div>
      ) : understandingState === "hidden" ? null : (
        <OrderUnderstandingSection
          customer={c}
          orderId={activeProjectId!}
          order={projectOrder!}
          state={understandingState}
        />
      )}

      {/* Follow-up context */}
      {lastMsg && (
        <div className="rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-gray-400 font-medium flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {t("admin.customers.followUp.recentChat")}
              <span className="text-gray-300">·</span>
              <span className="text-gray-400">
                {lastMsg.createdAt.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}
              </span>
            </div>
            {chatMessages.length > 0 && (
              <button
                onClick={() => setShowAllChat((v) => !v)}
                className="text-[10px] font-medium text-gray-500 hover:text-gray-900 transition-colors"
              >
                {showAllChat
                  ? t("admin.customers.followUp.collapse")
                  : t("admin.customers.followUp.expandAll", { n: chatMessages.length })}
              </button>
            )}
          </div>
          {shownMsgs.map((m) => (
            <div key={m.id} className="flex gap-2.5 text-[12px]">
              <span className="flex-shrink-0 text-[10px] text-gray-400 w-10 pt-0.5">
                {m.createdAt.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}
              </span>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-gray-900">
                  {m.senderRole === "jeff" ? t("admin.customers.followUp.me") : c.name}
                </span>
                <p className={`text-gray-600 mt-0.5 whitespace-pre-wrap break-words ${showAllChat ? "" : "line-clamp-2"}`}>
                  {m.body}
                </p>
                {m.context && (
                  <span className="inline-block mt-1 text-[10px] text-orange-600 bg-orange-50 rounded-md px-1.5 py-0.5">
                    {m.context}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-gray-100 text-[11px] text-gray-500 flex items-center gap-1">
            <Bot className="w-3 h-3" />
            <span className="text-gray-400">{t("admin.customers.followUp.aiNextStep")}</span>
            <span>{aiNextStep || t("admin.customers.followUp.aiPending")}</span>
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

function CustomOrdersSection({ customer: c, activeProjectId }: { customer: AdaptedCustomer; activeProjectId?: number | null }) {
  const { t } = useLocale()
  const k = (s: string) => t(`admin.customers.order.${s}`)
  // orderId = which order the sheet opens on (row click). Absent (新增 button)
  // → the sheet's own default (newest order).
  const [sheet, setSheet] = useState<{ open: boolean; orderId?: number | null }>({ open: false })
  const orders = trpc.customerOrders.listForCustomer.useQuery(toSelection(c))

  const payLabel = (s: string) =>
    s === "paid" ? t("admin.customers.payment.paid")
      : s === "partial" ? t("admin.customers.payment.partial")
        : t("admin.customers.payment.unpaid")

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-gray-900">{k("section")}</div>
        <button
          onClick={() => setSheet({ open: true })}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          <Plus className="w-3 h-3" />
          {k("new")}
        </button>
      </div>
      {orders.data && orders.data.length > 0 ? (
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
          {orders.data.map((o) => (
            <button
              key={o.id}
              onClick={() => setSheet({ open: true, orderId: o.id })}
              className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                o.id === activeProjectId ? "bg-gray-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-gray-900 truncate">
                  <span className="text-[10px] text-gray-400 mr-1.5">{o.orderNumber}</span>
                  {o.title}
                </div>
                <div className="text-[10px] text-gray-400">
                  {o.departureDate ? shortDate(o.departureDate) : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[12px] text-gray-900">{fmtMoney(o.totalPrice, o.currency)}</div>
                <div className="text-[10px] text-gray-400">{payLabel(o.paymentStatus)}</div>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-900 text-white flex-shrink-0">
                {t(`admin.customers.order.status.${o.status}`)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-gray-400 py-2">{k("empty")}</div>
      )}
      <CustomOrderSheet
        open={sheet.open}
        initialOrderId={sheet.orderId ?? null}
        onClose={() => setSheet({ open: false })}
        customer={c}
      />
    </div>
  )
}

export function OrdersTab({
  customer: c,
  activeProjectId,
}: {
  customer: AdaptedCustomer
  activeProjectId?: number | null
  onSelectProject?: (id: number | null) => void
}) {
  const { t } = useLocale()
  const statusLabel = (s: string) =>
    s === "paid" ? t("admin.customers.payment.paid")
      : s === "partial" ? t("admin.customers.payment.partial")
        : t("admin.customers.payment.unpaid")
  return (
    <div className="p-6 space-y-6">
      <CustomOrdersSection customer={c} activeProjectId={activeProjectId} />
      {c.orders.length > 0 && (
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
      )}
    </div>
  )
}

export function DocsTab({
  customer: c,
  activeProjectId = null,
}: {
  customer: AdaptedCustomer
  activeProjectId?: number | null
}) {
  const { t } = useLocale()
  // customer-projects (0106) — scope to the active ProjectBar chip, same as the
  // 歷史 tab: a project chip shows that project's docs; 未分類 (null) shows docs
  // not filed under any project (passport, general uploads).
  const docs = c.docs.filter((d) => (d.customOrderId ?? null) === activeProjectId)
  if (docs.length === 0) {
    return <div className="p-6 text-sm text-gray-400">{t("admin.customers.empty.noDocs")}</div>
  }
  return (
    <div className="p-6 space-y-2">
      {docs.map((d) => {
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

const ALL_DATES = "__all__"
/** Local calendar day key (YYYY-MM-DD) for grouping conversation turns by date. */
const convoDayKey = (d: Date) => d.toLocaleDateString("en-CA")

/** customer-projects (0104) — the per-message「歸到專案 / 退回未分類」control.
 *  Only rendered on real-conversation (customerInteractions) rows. Files the
 *  whole Gmail thread when a threadId is present (the natural unit), else the
 *  single row. Inline chips (no overlay) keep it robust inside the scroll area. */
function AssignControl({
  customer: c,
  projects,
  assign,
}: {
  customer: AdaptedCustomer
  projects: Project[]
  assign: NonNullable<ConvoMsg["assign"]>
}) {
  const { t } = useLocale()
  const utils = trpc.useUtils()
  const sel = toSelection(c)
  const [open, setOpen] = useState(false)
  const assignM = trpc.customerOrders.assignConversation.useMutation({
    onSuccess: () => {
      toast.success(t("admin.customers.projects.assigned"))
      void utils.admin.customerConversationThread.invalidate()
      void utils.customerOrders.listForCustomer.invalidate(sel)
      setOpen(false)
    },
    onError: () => toast.error(t("admin.customers.projects.assignFailed")),
  })
  const go = (orderId: number | null) =>
    assignM.mutate({
      selection: sel,
      orderId,
      gmailThreadIds: assign.gmailThreadId ? [assign.gmailThreadId] : undefined,
      interactionIds: assign.gmailThreadId ? undefined : [assign.interactionId],
    })
  const targets = projects.filter((p) => p.id !== assign.customOrderId)

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] text-gray-400 hover:text-gray-700 inline-flex items-center gap-1 transition-colors"
      >
        <FolderInput className="w-3 h-3" />
        {t("admin.customers.projects.assignTo")}
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 mt-1">
          {targets.map((p) => (
            <button
              key={p.id}
              disabled={assignM.isPending}
              onClick={() => go(p.id)}
              className="text-[10px] px-1.5 py-0.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {p.title}
            </button>
          ))}
          {assign.customOrderId !== null && (
            <button
              disabled={assignM.isPending}
              onClick={() => go(null)}
              className="text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <Inbox className="w-2.5 h-2.5" />
              {t("admin.customers.projects.backToUnfiled")}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type ConvoMsg = {
  id: string
  senderRole: "customer" | "jeff"
  body: string
  createdAt: Date
  assign?: { interactionId: number; gmailThreadId: string | null; customOrderId: number | null }
}

/**
 * customer-projects (0104, batch-assign audit fix) — sticky bar that appears
 * once 2+ assignable messages are checked, so a backlog (Emerald has 28 unsorted
 * historical turns) can be filed in one click instead of one row at a time.
 * Distinct gmailThreadIds (the natural assign unit) are collected from the
 * selection; any selected row with no thread id falls back to its interactionId.
 * Both arrays go to assignConversation in a single mutation call.
 */
function BulkAssignBar({
  customer: c,
  projects,
  selected,
  onDone,
}: {
  customer: AdaptedCustomer
  projects: Project[]
  selected: ConvoMsg[]
  onDone: () => void
}) {
  const { t } = useLocale()
  const utils = trpc.useUtils()
  const sel = toSelection(c)
  const assignM = trpc.customerOrders.assignConversation.useMutation({
    onSuccess: () => {
      toast.success(t("admin.customers.projects.assigned"))
      void utils.admin.customerConversationThread.invalidate()
      void utils.customerOrders.listForCustomer.invalidate(sel)
      onDone()
    },
    onError: () => toast.error(t("admin.customers.projects.assignFailed")),
  })
  const go = (orderId: number | null) => {
    const threadIds = Array.from(
      new Set(
        selected
          .map((m) => m.assign?.gmailThreadId)
          .filter((x): x is string => x != null),
      ),
    )
    const interactionIds = selected
      .filter((m) => m.assign && m.assign.gmailThreadId == null)
      .map((m) => m.assign!.interactionId)
    assignM.mutate({
      selection: sel,
      orderId,
      gmailThreadIds: threadIds.length ? threadIds : undefined,
      interactionIds: interactionIds.length ? interactionIds : undefined,
    })
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 shadow-sm">
      <span className="text-[11px] font-medium text-gray-700">
        {t("admin.customers.projects.selectedCount", { n: selected.length })}
      </span>
      <span className="text-gray-300">·</span>
      {projects.map((p) => (
        <button
          key={p.id}
          disabled={assignM.isPending}
          onClick={() => go(p.id)}
          className="text-[10px] px-1.5 py-0.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {p.title}
        </button>
      ))}
      <button
        disabled={assignM.isPending}
        onClick={() => go(null)}
        className="text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
      >
        <Inbox className="w-2.5 h-2.5" />
        {t("admin.customers.projects.backToUnfiled")}
      </button>
      <button
        onClick={onDone}
        className="ml-auto text-[10px] text-gray-400 hover:text-gray-700 transition-colors"
      >
        {t("admin.customers.projects.clearSelection")}
      </button>
    </div>
  )
}

export function TimelineTab({
  customer: c,
  projects = [],
  activeProjectId = null,
}: {
  customer: AdaptedCustomer
  /** kept for call-site compat; the tab now reads its own project-scoped query. */
  chatMessages?: ChatMessage[]
  projects?: Project[]
  activeProjectId?: number | null
}) {
  const { t } = useLocale()
  const sel = toSelection(c)
  // customer-projects (0104) — own query, scoped to the active project. A
  // project → that order's filed turns; 未分類 → unfiledOnly (IS NULL) basket.
  const scope = activeProjectId !== null ? { orderId: activeProjectId } : { unfiledOnly: true }
  const threadInput =
    "userId" in sel
      ? { userId: sel.userId, limit: 200, ...scope }
      : { profileId: sel.profileId, limit: 200, ...scope }
  const threadQ = trpc.admin.customerConversationThread.useQuery(threadInput)

  const messages = useMemo<ConvoMsg[]>(
    () =>
      (threadQ.data?.messages ?? []).map((m) => ({
        id: m.id,
        senderRole: m.senderRole,
        body: stripQuotedReply(m.body),
        createdAt: new Date(m.createdAt),
        assign: m.assign,
      })),
    [threadQ.data],
  )
  const hasChat = messages.length > 0
  const hasEvents = c.timeline.length > 0

  // Distinct conversation days, newest first, for the date jump.
  const days = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const m of messages) {
      const k = convoDayKey(m.createdAt)
      if (!seen.has(k)) { seen.add(k); out.push(k) }
    }
    return out.reverse()
  }, [messages])

  const [selDay, setSelDay] = useState<string>(ALL_DATES)
  // Land on the newest day when the customer OR the active project changes.
  useEffect(() => {
    setSelDay(days[0] ?? ALL_DATES)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, activeProjectId])

  // customer-projects (0104, batch-assign audit fix) — multi-select for bulk
  // filing. Cleared whenever the customer/project/day view changes so a stale
  // selection can never carry into a different scope.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    setSelectedIds(new Set())
  }, [c.id, activeProjectId, selDay])
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectedMsgs = messages.filter((m) => selectedIds.has(m.id))

  const shownChat =
    selDay === ALL_DATES ? messages : messages.filter((m) => convoDayKey(m.createdAt) === selDay)
  const chipCls = (active: boolean) =>
    `px-2 py-0.5 rounded-md text-[11px] whitespace-nowrap border transition-colors ${
      active ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-600 hover:bg-gray-50"
    }`
  const fmtChip = (k: string) =>
    new Date(`${k}T00:00:00`).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })

  return (
    <div className="p-6 space-y-6">
      {/* full conversation — date jump (newest first, default newest day), then turns */}
      {hasChat && (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold text-gray-900">
            {t("admin.customers.followUp.fullChat")}
          </div>
          {days.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button onClick={() => setSelDay(ALL_DATES)} className={chipCls(selDay === ALL_DATES)}>
                {t("admin.customers.followUp.allDates")}
              </button>
              {days.map((d) => (
                <button key={d} onClick={() => setSelDay(d)} className={chipCls(selDay === d)}>
                  {fmtChip(d)}
                </button>
              ))}
            </div>
          )}
          {selectedMsgs.length > 1 && (
            <BulkAssignBar
              customer={c}
              projects={projects}
              selected={selectedMsgs}
              onDone={() => setSelectedIds(new Set())}
            />
          )}
          {shownChat.map((m) => (
            <div key={m.id} className="flex gap-2.5 text-[12px]">
              {m.assign ? (
                <input
                  type="checkbox"
                  className="flex-shrink-0 mt-0.5 rounded border-gray-300"
                  checked={selectedIds.has(m.id)}
                  onChange={() => toggleSelect(m.id)}
                  aria-label={t("admin.customers.projects.selectForBulk")}
                />
              ) : (
                <span className="flex-shrink-0 w-3.5" />
              )}
              <span className="flex-shrink-0 text-[10px] text-gray-400 w-10 pt-0.5">
                {m.createdAt.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}
              </span>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-gray-900">
                  {m.senderRole === "jeff" ? t("admin.customers.followUp.me") : c.name}
                </span>
                <p className="text-gray-600 mt-0.5 whitespace-pre-wrap break-words">{m.body}</p>
                {m.assign && <AssignControl customer={c} projects={projects} assign={m.assign} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* event timeline (orders / payments / docs) */}
      {hasEvents && (
        <div>
          <div className="text-[11px] font-semibold text-gray-900 mb-3">
            {t("admin.customers.followUp.events")}
          </div>
          <div className="relative pl-7">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" />
            {c.timeline.map((tl, i) => (
              <div key={i} className="relative flex gap-3 pb-5 last:pb-0">
                <div className="absolute left-[-21px] w-4 h-4 rounded-full bg-white border border-gray-300 flex items-center justify-center text-gray-500">
                  {TL_ICON[tl.type]}
                </div>
                <div>
                  <div className="text-[12px] font-medium text-gray-900">{tl.title}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{tl.desc}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{tl.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasChat && !hasEvents && (
        <div className="text-sm text-gray-400">{t("admin.customers.followUp.noHistory")}</div>
      )}
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
