import { useState } from "react"
import { Upload, Loader2 } from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"
import { shortDate, PROJECT_CATEGORY_KEYS } from "./customOrderHelpers"

// Controlled trip/money fields, shared by the create form (CustomOrderSheet)
// and the edit form (CustomOrderDetail). All money as plain strings; the parent
// parses on submit. supplierCost is clearly marked internal (never on customer
// documents — admin margin only).

export type OrderFormState = {
  title: string
  /** 總類 key (flight/quote/visa/general) or "" = 未標 (0105). */
  category: string
  destination: string
  departureDate: string
  returnDate: string
  totalPrice: string
  depositAmount: string
  currency: string
  needsQuote: boolean
  supplierCost: string
  notes: string
}

export function emptyForm(): OrderFormState {
  return {
    title: "",
    category: "",
    destination: "",
    departureDate: "",
    returnDate: "",
    totalPrice: "",
    depositAmount: "",
    currency: "USD",
    needsQuote: true,
    supplierCost: "",
    notes: "",
  }
}

export function formFromOrder(o: {
  title: string
  category: string | null
  destination: string | null
  departureDate: string | null
  returnDate: string | null
  totalPrice: string | null
  depositAmount: string | null
  currency: string
  needsQuote: number
  supplierCost: string | null
  notes: string | null
}): OrderFormState {
  return {
    title: o.title,
    category: o.category ?? "",
    destination: o.destination ?? "",
    departureDate: shortDate(o.departureDate),
    returnDate: shortDate(o.returnDate),
    totalPrice: o.totalPrice ?? "",
    depositAmount: o.depositAmount ?? "",
    currency: o.currency || "USD",
    needsQuote: o.needsQuote === 1,
    supplierCost: o.supplierCost ?? "",
    notes: o.notes ?? "",
  }
}

/** Drag-drop / click-to-pick a PDF. Shared by the new-order form + order detail. */
export function PdfDrop({
  label,
  busy,
  onFile,
}: {
  label: string
  busy: boolean
  onFile: (f: File) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
      className={`flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-[11px] cursor-pointer transition-colors ${
        over
          ? "border-gray-900 bg-gray-50 text-gray-900"
          : "border-gray-300 text-gray-500 hover:bg-gray-50"
      }`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
      {label}
      <input
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ""
        }}
      />
    </label>
  )
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-gray-900"
const labelCls = "block text-[11px] text-gray-500 mb-1"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  )
}

export default function CustomOrderFields({
  value,
  onChange,
}: {
  value: OrderFormState
  onChange: (patch: Partial<OrderFormState>) => void
}) {
  const { t } = useLocale()
  const k = (s: string) => t(`admin.customers.order.${s}`)

  return (
    <div className="space-y-3">
      <Field label={k("fldTitle")}>
        <input
          className={inputCls}
          value={value.title}
          placeholder={k("fldTitlePh")}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>
      <Field label={k("fldCategory")}>
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_CATEGORY_KEYS.map((key) => {
            const sel = value.category === key
            return (
              <button
                type="button"
                key={key}
                onClick={() => onChange({ category: sel ? "" : key })}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                  sel
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t(`admin.customers.projects.category.${key}`)}
              </button>
            )
          })}
        </div>
      </Field>
      <Field label={k("fldDestination")}>
        <input
          className={inputCls}
          value={value.destination}
          onChange={(e) => onChange({ destination: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={k("fldDeparture")}>
          <input
            type="date"
            className={inputCls}
            value={value.departureDate}
            onChange={(e) => onChange({ departureDate: e.target.value })}
          />
        </Field>
        <Field label={k("fldReturn")}>
          <input
            type="date"
            className={inputCls}
            value={value.returnDate}
            onChange={(e) => onChange({ returnDate: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={k("fldTotal")}>
          <input
            inputMode="decimal"
            className={inputCls}
            value={value.totalPrice}
            onChange={(e) => onChange({ totalPrice: e.target.value })}
          />
        </Field>
        <Field label={k("fldDeposit")}>
          <input
            inputMode="decimal"
            className={inputCls}
            value={value.depositAmount}
            onChange={(e) => onChange({ depositAmount: e.target.value })}
          />
        </Field>
        <Field label={k("fldCurrency")}>
          <input
            className={inputCls}
            value={value.currency}
            maxLength={3}
            onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}
          />
        </Field>
      </div>
      <p className="text-[10px] text-gray-400 -mt-1">{k("depositHint")}</p>
      <label className="flex items-center gap-2 text-[12px] text-gray-700">
        <input
          type="checkbox"
          className="rounded border-gray-300"
          checked={value.needsQuote}
          onChange={(e) => onChange({ needsQuote: e.target.checked })}
        />
        {k("needsQuote")}
      </label>
      <Field label={`${k("supplierCost")} · ${k("costInternalNote")}`}>
        <input
          inputMode="decimal"
          className={inputCls}
          value={value.supplierCost}
          onChange={(e) => onChange({ supplierCost: e.target.value })}
        />
      </Field>
      <Field label={k("notes")}>
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>
    </div>
  )
}
