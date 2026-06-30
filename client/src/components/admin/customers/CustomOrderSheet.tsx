import { useEffect, useState } from "react"
import { Plus, Loader2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useLocale } from "@/contexts/LocaleContext"
import { trpc } from "@/lib/trpc"
import type { AdaptedCustomer } from "./types"
import { toSelection, num, suggestedDeposit, uploadPdfViaPresign, type ProjectCategory } from "./customOrderHelpers"
import CustomOrderFields, {
  PdfDrop,
  emptyForm,
  type OrderFormState,
} from "./CustomOrderFields"
import CustomOrderDetail from "./CustomOrderDetail"

type FocusSection = "quote" | "collect" | "confirm" | null
type Selected = number | "new" | null

const PRIMARY_BTN =
  "px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:hover:bg-gray-900"

export default function CustomOrderSheet({
  open,
  onClose,
  customer,
  focusSection,
}: {
  open: boolean
  onClose: () => void
  customer: AdaptedCustomer
  focusSection?: FocusSection
}) {
  const { t } = useLocale()
  const k = (s: string) => t(`admin.customers.order.${s}`)
  const sel = toSelection(customer)
  const utils = trpc.useUtils()

  const [selected, setSelected] = useState<Selected>(null)
  const [form, setForm] = useState<OrderFormState>(emptyForm())

  const list = trpc.customerOrders.listForCustomer.useQuery(sel, { enabled: open })
  const detail = trpc.customerOrders.get.useQuery(
    { orderId: typeof selected === "number" ? selected : 0 },
    { enabled: open && typeof selected === "number" },
  )

  // default to the newest order, else the new-order form
  useEffect(() => {
    if (!open) {
      setSelected(null)
      setForm(emptyForm())
      return
    }
    if (selected === null && list.data) {
      setSelected(list.data[0]?.id ?? "new")
    }
  }, [open, list.data, selected])

  const refresh = () => {
    utils.customerOrders.listForCustomer.invalidate(sel)
    if (typeof selected === "number") {
      utils.customerOrders.get.invalidate({ orderId: selected })
    }
  }

  const create = trpc.customerOrders.create.useMutation({
    onSuccess: (created) => {
      utils.customerOrders.listForCustomer.invalidate(sel)
      if (created?.id) setSelected(created.id)
      setForm(emptyForm())
    },
  })

  const patchForm = (patch: Partial<OrderFormState>) =>
    setForm((prev) => {
      const next = { ...prev, ...patch }
      if (patch.totalPrice !== undefined && !prev.depositAmount) {
        const sug = suggestedDeposit(num(patch.totalPrice))
        if (sug != null) next.depositAmount = String(sug)
      }
      return next
    })

  const validEmail = /^\S+@\S+\.\S+$/.test(customer.email)
  const buildCreateInput = (titleOverride?: string) => ({
    selection: sel,
    title: titleOverride ?? form.title.trim(),
    category: (form.category || undefined) as ProjectCategory | undefined,
    destination: form.destination.trim() || undefined,
    needsQuote: form.needsQuote,
    totalPrice: num(form.totalPrice) ?? undefined,
    depositAmount: num(form.depositAmount) ?? undefined,
    currency: form.currency || "USD",
    departureDate: form.departureDate || undefined,
    returnDate: form.returnDate || undefined,
    supplierCost: num(form.supplierCost) ?? undefined,
    customerName: customer.name || undefined,
    customerEmail: validEmail ? customer.email : undefined,
    notes: form.notes.trim() || undefined,
  })
  const submitCreate = () => create.mutate(buildCreateInput())

  // Drop a PDF on the new-order form → auto-create the order (default title if
  // blank) + upload + attach as the quote, then jump to the order detail. Saves
  // the "create order first, then find the dropzone" hunt.
  const createPdfUpload = trpc.customerOrders.createPdfUpload.useMutation()
  const attachQuote = trpc.customerOrders.attachQuote.useMutation()
  const [dropBusy, setDropBusy] = useState(false)
  async function handleCreateDrop(file: File) {
    if (file.type && file.type !== "application/pdf") {
      window.alert(k("notPdf"))
      return
    }
    if (dropBusy || create.isPending) return
    setDropBusy(true)
    try {
      const title =
        form.title.trim() ||
        t("admin.customers.order.defaultTitle", {
          name: customer.name || t("admin.customers.unnamed"),
        })
      const created = await create.mutateAsync(buildCreateInput(title))
      if (!created?.id) throw new Error("create failed")
      const url = await uploadPdfViaPresign(createPdfUpload.mutateAsync, created.id, "quote", file)
      await attachQuote.mutateAsync({ orderId: created.id, quotePdfUrl: url })
      utils.customerOrders.listForCustomer.invalidate(sel)
      utils.customerOrders.get.invalidate({ orderId: created.id })
      setSelected(created.id)
    } catch {
      window.alert(k("uploadFailed"))
    } finally {
      setDropBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full xl:max-w-2xl xl:rounded-l-xl overflow-y-auto">
        <SheetHeader className="border-b border-gray-200">
          <SheetTitle className="text-base font-bold">
            {customer.name} · {k("section")}
          </SheetTitle>
        </SheetHeader>

        {/* order switcher */}
        <div className="flex flex-wrap items-center gap-1.5 py-1">
          {list.data?.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o.id)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium border ${
                selected === o.id
                  ? "bg-gray-900 text-white border-gray-900"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {o.orderNumber}
            </button>
          ))}
          <button
            onClick={() => setSelected("new")}
            className={`px-2 py-1 rounded-md text-[11px] font-medium border inline-flex items-center gap-1 ${
              selected === "new"
                ? "bg-gray-900 text-white border-gray-900"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Plus className="w-3 h-3" />
            {k("new")}
          </button>
        </div>

        <div className="pb-6">
          {selected === "new" ? (
            <div className="space-y-3">
              <PdfDrop
                label={dropBusy ? k("uploading") : k("dropPdfCreates")}
                busy={dropBusy}
                onFile={handleCreateDrop}
              />
              <CustomOrderFields value={form} onChange={patchForm} />
              {create.error && (
                <p className="text-[11px] text-red-600">{create.error.message}</p>
              )}
              <div className="flex justify-end">
                <button
                  className={PRIMARY_BTN}
                  disabled={!form.title.trim() || create.isPending}
                  onClick={submitCreate}
                >
                  {create.isPending ? k("creating") : k("create")}
                </button>
              </div>
            </div>
          ) : detail.isLoading || (typeof selected === "number" && !detail.data) ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : detail.data ? (
            <CustomOrderDetail order={detail.data} focusSection={focusSection} onChanged={refresh} />
          ) : (
            <div className="py-12 text-center text-sm text-gray-400">{k("empty")}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
