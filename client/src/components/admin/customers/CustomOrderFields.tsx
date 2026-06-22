import { useLocale } from "@/contexts/LocaleContext"
import { shortDate } from "./customOrderHelpers"

// Controlled trip/money fields, shared by the create form (CustomOrderSheet)
// and the edit form (CustomOrderDetail). All money as plain strings; the parent
// parses on submit. supplierCost is clearly marked internal (never on customer
// documents — admin margin only).

export type OrderFormState = {
  title: string
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
