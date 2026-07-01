import { useEffect, useState } from "react"
import { FileText, DollarSign, FileCheck, Loader2 } from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"
import { trpc, type RouterOutputs } from "@/lib/trpc"
import CustomOrderFields, {
  PdfDrop,
  type OrderFormState,
  formFromOrder,
} from "./CustomOrderFields"
import {
  fmtMoney,
  num,
  shortDate,
  suggestedDeposit,
  todayLocal,
  localDateAtNoon,
  uploadPdfViaPresign,
  type ProjectCategory,
} from "./customOrderHelpers"

type Order = NonNullable<RouterOutputs["customerOrders"]["get"]>

const PRIMARY_BTN =
  "px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:hover:bg-gray-900"
const GHOST_BTN =
  "px-3 py-1.5 rounded-lg text-[11px] font-medium border border-gray-400 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40"
const inputCls =
  "w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-gray-900"

function StatusPill({ status }: { status: string }) {
  const { t } = useLocale()
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-900 text-white">
      {t(`admin.customers.order.status.${status}`)}
    </span>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 space-y-2.5">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-900">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

export default function CustomOrderDetail({
  order,
  onChanged,
}: {
  order: Order
  onChanged: () => void
}) {
  const { t } = useLocale()
  const k = (s: string, p?: Record<string, string | number>) =>
    t(`admin.customers.order.${s}`, p)

  const refresh = () => onChanged()
  const mutOpts = { onSuccess: refresh }
  const update = trpc.customerOrders.update.useMutation(mutOpts)
  const attachQuote = trpc.customerOrders.attachQuote.useMutation(mutOpts)
  const sendQuote = trpc.customerOrders.sendQuote.useMutation(mutOpts)
  const sendCollection = trpc.customerOrders.sendCollection.useMutation(mutOpts)
  const recordPayment = trpc.customerOrders.recordPayment.useMutation(mutOpts)
  const attachConfirmation = trpc.customerOrders.attachConfirmation.useMutation(mutOpts)
  const sendConfirmation = trpc.customerOrders.sendConfirmation.useMutation(mutOpts)
  const cancel = trpc.customerOrders.cancel.useMutation(mutOpts)
  const createPdfUpload = trpc.customerOrders.createPdfUpload.useMutation()

  // ── drag-drop PDF upload (presign → browser PUT to R2 → attach) ──
  const [uploading, setUploading] = useState<null | "quote" | "confirmation">(null)
  async function handlePdf(file: File, kind: "quote" | "confirmation") {
    if (file.type && file.type !== "application/pdf") {
      window.alert(k("notPdf"))
      return
    }
    setUploading(kind)
    try {
      const fileUrl = await uploadPdfViaPresign(createPdfUpload.mutateAsync, order.id, kind, file)
      if (kind === "quote") {
        await attachQuote.mutateAsync({ orderId: order.id, quotePdfUrl: fileUrl })
        setQuoteUrl(fileUrl)
      } else {
        await attachConfirmation.mutateAsync({ orderId: order.id, confirmationPdfUrl: fileUrl })
        setConfirmUrl(fileUrl)
      }
    } catch {
      window.alert(k("uploadFailed"))
    } finally {
      setUploading(null)
    }
  }

  // ── editable trip/money fields ──
  const [form, setForm] = useState<OrderFormState>(formFromOrder(order))
  useEffect(() => setForm(formFromOrder(order)), [order.id])
  const patchForm = (patch: Partial<OrderFormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch }
      // suggest 30% deposit once a total is entered and deposit still blank
      if (patch.totalPrice !== undefined && !prev.depositAmount) {
        const sug = suggestedDeposit(num(patch.totalPrice))
        if (sug != null) next.depositAmount = String(sug)
      }
      return next
    })
  }
  const saveFields = () =>
    update.mutate({
      orderId: order.id,
      title: form.title.trim() || order.title,
      category: (form.category || null) as ProjectCategory | null,
      destination: form.destination.trim() || null,
      departureDate: form.departureDate || null,
      returnDate: form.returnDate || null,
      totalPrice: num(form.totalPrice),
      depositAmount: num(form.depositAmount),
      currency: form.currency || "USD",
      needsQuote: form.needsQuote,
      supplierCost: num(form.supplierCost),
      notes: form.notes.trim() || null,
    })

  // ── action-local state ──
  const [quoteUrl, setQuoteUrl] = useState(order.quotePdfUrl ?? "")
  const [confirmUrl, setConfirmUrl] = useState(order.confirmationPdfUrl ?? "")
  const [kind, setKind] = useState<"deposit" | "balance">("deposit")
  const [payLink, setPayLink] = useState("")
  const [recAmount, setRecAmount] = useState("")
  const [recDate, setRecDate] = useState(todayLocal())
  useEffect(() => {
    setQuoteUrl(order.quotePdfUrl ?? "")
    setConfirmUrl(order.confirmationPdfUrl ?? "")
  }, [order.id])
  // pre-fill the received-amount field with the owed figure for the chosen kind
  useEffect(() => {
    setRecAmount((kind === "deposit" ? order.depositAmount : order.balanceAmount) ?? "")
  }, [kind, order.id, order.depositAmount, order.balanceAmount])

  const total = num(order.totalPrice)
  const deposit = num(order.depositAmount)
  const balance = num(order.balanceAmount)
  const cost = num(order.supplierCost)
  // received = actually-collected amounts (the *PaidAmount columns), falling
  // back to the owed figure for legacy rows. Never derived from owed alone.
  const received =
    (order.depositPaidAt ? num(order.depositPaidAmount) ?? deposit ?? 0 : 0) +
    (order.balancePaidAt ? num(order.balancePaidAmount) ?? balance ?? 0 : 0)
  const margin = total != null && cost != null ? total - cost : null

  const askSend = () => window.confirm(k("confirmSendCustomer"))
  const noEmail = !order.customerEmail
  const busy =
    sendQuote.isPending || sendCollection.isPending || sendConfirmation.isPending

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold">{order.orderNumber}</span>
        <StatusPill status={order.status} />
        {noEmail && (
          <span className="text-[10px] text-amber-700 bg-amber-50 rounded-md px-1.5 py-0.5">
            {k("needEmail")}
          </span>
        )}
      </div>

      {/* money summary + edit */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label={k("fldTotal")} value={fmtMoney(order.totalPrice, order.currency)} />
          <Stat label={k("deposit")} value={fmtMoney(order.depositAmount, order.currency)} />
          <Stat label={k("balance")} value={fmtMoney(order.balanceAmount, order.currency)} />
          <Stat label={k("received")} value={fmtMoney(received, order.currency)} />
        </div>
        {(cost != null || margin != null) && (
          <div className="flex items-center justify-between text-[11px] border-t border-gray-200 pt-2">
            <span className="text-gray-500">
              {k("supplierCost")}: {fmtMoney(order.supplierCost, order.currency)}
              <span className="text-gray-400"> · {k("costInternalNote")}</span>
            </span>
            <span className="font-medium text-gray-900">
              {k("margin")}: {fmtMoney(margin, order.currency)}
            </span>
          </div>
        )}
      </div>

      <details className="rounded-xl border border-gray-200 p-4">
        <summary className="text-[12px] font-semibold text-gray-900 cursor-pointer select-none">
          {k("editDetails")}
        </summary>
        <div className="mt-3">
          <CustomOrderFields value={form} onChange={patchForm} />
          <div className="mt-3 flex justify-end">
            <button className={PRIMARY_BTN} disabled={update.isPending} onClick={saveFields}>
              {update.isPending ? k("saving") : k("save")}
            </button>
          </div>
        </div>
      </details>

      {/* 報價 */}
      <Section title={k("quoteSection")} icon={<FileText className="w-3.5 h-3.5" />}>
        <PdfDrop
          label={uploading === "quote" ? k("uploading") : k("dropPdf")}
          busy={uploading === "quote"}
          onFile={(f) => handlePdf(f, "quote")}
        />
        <div className="text-[10px] text-gray-400">{k("orPasteUrl")}</div>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={quoteUrl}
            placeholder={k("pdfUrlQuotePh")}
            onChange={(e) => setQuoteUrl(e.target.value)}
          />
          <button
            className={GHOST_BTN}
            disabled={!quoteUrl.trim() || attachQuote.isPending}
            onClick={() => attachQuote.mutate({ orderId: order.id, quotePdfUrl: quoteUrl.trim() })}
          >
            {k("attach")}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">
            {order.quoteSentAt ? k("quoteSentAt", { date: shortDate(order.quoteSentAt) }) : ""}
          </span>
          <button
            className={PRIMARY_BTN}
            disabled={!order.quotePdfUrl || noEmail || busy}
            title={!order.quotePdfUrl ? k("needQuotePdf") : ""}
            onClick={() => askSend() && sendQuote.mutate({ orderId: order.id, confirm: true })}
          >
            {sendQuote.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : k("sendQuote")}
          </button>
        </div>
      </Section>

      {/* 催款 */}
      <Section title={k("collectSection")} icon={<DollarSign className="w-3.5 h-3.5" />}>
        <div className="flex gap-1.5">
          {(["deposit", "balance"] as const).map((kd) => (
            <button
              key={kd}
              onClick={() => setKind(kd)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border ${
                kind === kd
                  ? "bg-gray-900 text-white border-gray-900"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {k(kd)} · {fmtMoney(kd === "deposit" ? order.depositAmount : order.balanceAmount, order.currency)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={payLink}
            placeholder={k("paymentLinkPh")}
            onChange={(e) => setPayLink(e.target.value)}
          />
          <button
            className={PRIMARY_BTN}
            disabled={noEmail || sendCollection.isPending}
            onClick={() =>
              askSend() &&
              sendCollection.mutate({
                orderId: order.id,
                kind,
                paymentLink: payLink.trim() || undefined,
                confirm: true,
              })
            }
          >
            {sendCollection.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : k("sendCollection")}
          </button>
        </div>
        <span className="text-[10px] text-gray-400">
          {order.collectionSentAt ? k("collectSentAt", { date: shortDate(order.collectionSentAt) }) : ""}
        </span>
        {/* 記已收 (money truth, manual) */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5 space-y-2">
          <div className="text-[11px] font-medium text-gray-700">{k("recordTitle")}</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              inputMode="decimal"
              className={inputCls}
              placeholder={k("paidAmount")}
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
            />
            <input type="date" className={inputCls} value={recDate} onChange={(e) => setRecDate(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <button
              className={GHOST_BTN}
              disabled={recordPayment.isPending}
              onClick={() =>
                recordPayment.mutate({
                  orderId: order.id,
                  kind,
                  amount: num(recAmount) ?? undefined,
                  paidAt: recDate ? localDateAtNoon(recDate) : undefined,
                })
              }
            >
              {k("markPaid")}
            </button>
          </div>
        </div>
      </Section>

      {/* 確認書 */}
      <Section title={k("confirmSection")} icon={<FileCheck className="w-3.5 h-3.5" />}>
        <PdfDrop
          label={uploading === "confirmation" ? k("uploading") : k("dropPdf")}
          busy={uploading === "confirmation"}
          onFile={(f) => handlePdf(f, "confirmation")}
        />
        <div className="text-[10px] text-gray-400">{k("orPasteUrl")}</div>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={confirmUrl}
            placeholder={k("pdfUrlConfirmPh")}
            onChange={(e) => setConfirmUrl(e.target.value)}
          />
          <button
            className={GHOST_BTN}
            disabled={!confirmUrl.trim() || attachConfirmation.isPending}
            onClick={() =>
              attachConfirmation.mutate({ orderId: order.id, confirmationPdfUrl: confirmUrl.trim() })
            }
          >
            {k("attach")}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">
            {order.confirmedAt ? k("confirmSentAt", { date: shortDate(order.confirmedAt) }) : ""}
          </span>
          <button
            className={PRIMARY_BTN}
            disabled={!order.confirmationPdfUrl || noEmail || busy}
            title={!order.confirmationPdfUrl ? k("needConfirmPdf") : ""}
            onClick={() => askSend() && sendConfirmation.mutate({ orderId: order.id, confirm: true })}
          >
            {sendConfirmation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : k("sendConfirmation")}
          </button>
        </div>
      </Section>

      {/* cancel */}
      {order.status !== "cancelled" && order.status !== "completed" && (
        <div className="flex justify-end">
          <button
            className="text-[11px] text-gray-400 hover:text-red-600 transition-colors"
            disabled={cancel.isPending}
            onClick={() => {
              if (!window.confirm(k("confirmCancel"))) return
              cancel.mutate({ orderId: order.id })
            }}
          >
            {k("cancelOrder")}
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-[12px] font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  )
}

