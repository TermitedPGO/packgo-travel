import { useState } from "react"
import { X } from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"

type CreateInput = { name: string; email?: string; phone?: string }

export default function AddCustomerDialog({
  open,
  onClose,
  onCreate,
  isCreating,
}: {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateInput) => Promise<unknown>
  isCreating: boolean
}) {
  const { t } = useLocale()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const reset = () => {
    setName("")
    setEmail("")
    setPhone("")
    setError(null)
  }
  const close = () => {
    reset()
    onClose()
  }

  const mapError = (msg: string): string => {
    if (msg.includes("email_exists_registered"))
      return t("admin.customers.add.emailExistsRegistered")
    if (msg.includes("email_exists_guest"))
      return t("admin.customers.add.emailExistsGuest")
    if (msg.includes("email_or_phone_required"))
      return t("admin.customers.add.contactRequired")
    return t("admin.customers.add.genericError")
  }

  const handleSubmit = async () => {
    // In-flight guard: Enter can fire twice before isCreating re-renders the
    // disabled button; without this a phone-only add (no server-side email
    // dedupe) would create two duplicate cards.
    if (isCreating) return
    const n = name.trim()
    const e = email.trim()
    const p = phone.trim()
    if (!n) return setError(t("admin.customers.add.nameRequired"))
    if (!e && !p) return setError(t("admin.customers.add.contactRequired"))
    // Approximate the server's zod .email() (reject whitespace) so a malformed
    // email surfaces the precise message, not the generic fallback.
    if (e && !/^\S+@\S+\.\S+$/.test(e))
      return setError(t("admin.customers.add.emailInvalid"))
    setError(null)
    try {
      await onCreate({ name: n, email: e || undefined, phone: p || undefined })
      close()
    } catch (err) {
      setError(mapError(err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white shadow-xl overflow-hidden"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-bold">{t("admin.customers.add.title")}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {t("admin.customers.add.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="p-1.5 -mr-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <Field
            label={t("admin.customers.add.name")}
            value={name}
            onChange={setName}
            placeholder={t("admin.customers.add.namePlaceholder")}
            autoFocus
          />
          <Field
            label={t("admin.customers.add.email")}
            value={email}
            onChange={setEmail}
            placeholder={t("admin.customers.add.emailPlaceholder")}
            type="email"
          />
          <Field
            label={t("admin.customers.add.phone")}
            value={phone}
            onChange={setPhone}
            placeholder={t("admin.customers.add.phonePlaceholder")}
            type="tel"
            onEnter={handleSubmit}
          />
          <p className="text-[11px] text-gray-400">
            {t("admin.customers.add.contactHint")}
          </p>
          {error && (
            <p className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button
            type="button"
            onClick={close}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t("admin.customers.add.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isCreating}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {isCreating
              ? t("admin.customers.add.creating")
              : t("admin.customers.add.submit")}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  onEnter,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  autoFocus?: boolean
  onEnter?: () => void
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter()
        }}
        placeholder={placeholder}
        className="mt-1 w-full border border-gray-300 rounded-lg py-2 px-3 text-[13px] outline-none focus:border-gray-500"
      />
    </label>
  )
}
