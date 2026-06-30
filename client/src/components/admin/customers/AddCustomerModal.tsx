import { useEffect, useRef, useState } from "react"
import { Upload, FileText, Loader2, X } from "lucide-react"
import { trpc } from "@/lib/trpc"
import { useLocale } from "@/contexts/LocaleContext"

/** Extracted-then-create modal. A "chat box" intake: drop a PDF / image / text
 * file OR paste raw text, the server LLM extracts {name,email,phone}, Jeff
 * reviews the three editable fields, then creates a guest customer profile.
 * Read-only on the server side except the final createManualCustomer write. */
export default function AddCustomerModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (sel: { id: number; kind: "guest" }) => void
}) {
  const { t } = useLocale()
  const utils = trpc.useUtils()

  // Paste/type box + extracted (editable) fields.
  const [rawText, setRawText] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [sourceText, setSourceText] = useState("")

  // Drop / extract / create state.
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const dragCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const extract = trpc.admin.extractCustomerFromFile.useMutation()
  const create = trpc.admin.createManualCustomer.useMutation({
    onSuccess: () => {
      void utils.admin.customerList.invalidate()
      void utils.admin.guestList.invalidate()
    },
  })

  // Reset everything whenever the modal (re)opens so a previous draft never
  // bleeds into a fresh add.
  useEffect(() => {
    if (!open) return
    setRawText("")
    setName("")
    setEmail("")
    setPhone("")
    setSourceText("")
    setNotice(null)
    setFormError(null)
    setDragging(false)
    dragCounter.current = 0
    extract.reset()
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Close on Escape (only when not mid-extract / mid-create).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !extract.isPending && !create.isPending) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose, extract.isPending, create.isPending])

  if (!open) return null

  const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

  /** ArrayBuffer -> base64 without blowing the call stack: walk the bytes in
   * fixed-size chunks (String.fromCharCode(...hugeArray) overflows the argument
   * list on large files), build a binary string, then btoa it. */
  const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
    const bytes = new Uint8Array(buf)
    const CHUNK = 0x8000 // 32 KB per fromCharCode call
    let binary = ""
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, i + CHUNK)
      binary += String.fromCharCode.apply(null, slice as unknown as number[])
    }
    return btoa(binary)
  }

  /** utf8 string -> base64 (handles non-ASCII / CJK correctly). */
  const utf8ToBase64 = (text: string): string => {
    const bytes = new TextEncoder().encode(text)
    return arrayBufferToBase64(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    )
  }

  const applyExtracted = (out: {
    name: string
    email: string | null
    phone: string | null
  }) => {
    setName(out.name ?? "")
    setEmail(out.email ?? "")
    setPhone(out.phone ?? "")
  }

  /** Map a server `ok:false` reason to a friendly hint. Always tells Jeff he can
   * still type the info by hand (the fields stay editable below). */
  const reasonMessage = (reason: string): string => {
    switch (reason) {
      case "too_large":
        return t("admin.customers.addModal.errTooLarge")
      case "unsupported":
        return t("admin.customers.addModal.errUnsupported")
      case "parse_error":
        return t("admin.customers.addModal.errParse")
      case "empty":
        return t("admin.customers.addModal.errEmpty")
      case "extract_failed":
        return t("admin.customers.addModal.errExtractFailed")
      default:
        return t("admin.customers.addModal.errGeneric")
    }
  }

  const runExtract = async (payload: {
    filename: string
    mimeType: string
    dataBase64: string
  }) => {
    setNotice(null)
    setFormError(null)
    try {
      const res = await extract.mutateAsync(payload)
      if (res.ok) {
        applyExtracted(res.extracted)
        setSourceText(res.sourceText ?? "")
      } else {
        setNotice(reasonMessage(res.reason))
      }
    } catch {
      // Network / server fault — let Jeff fall back to manual entry.
      setNotice(t("admin.customers.addModal.errExtractFailed"))
    }
  }

  const handleFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setNotice(t("admin.customers.addModal.errTooLarge"))
      return
    }
    try {
      const buf = await file.arrayBuffer()
      const dataBase64 = arrayBufferToBase64(buf)
      await runExtract({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64,
      })
    } catch {
      setNotice(t("admin.customers.addModal.errParse"))
    }
  }

  const handleReadText = async () => {
    const text = rawText.trim()
    if (!text) {
      setNotice(t("admin.customers.addModal.errEmpty"))
      return
    }
    await runExtract({
      filename: "input.txt",
      mimeType: "text/plain",
      dataBase64: utf8ToBase64(text),
    })
  }

  // Drag-and-drop (counter so nested children don't flicker the highlight).
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (e.dataTransfer.types.includes("Files")) setDragging(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragging(false)
    }
  }
  const onDragOver = (e: React.DragEvent) => e.preventDefault()
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  /** Mirror the existing AddCustomer validation idiom: name required, at least
   * one of email/phone, basic email shape — then call createManualCustomer and
   * map the server CONFLICT / refine errors to friendly strings. */
  const handleCreate = async () => {
    setFormError(null)
    const n = name.trim()
    const em = email.trim()
    const ph = phone.trim()
    if (!n) {
      setFormError(t("admin.customers.add.nameRequired"))
      return
    }
    if (!em && !ph) {
      setFormError(t("admin.customers.add.contactRequired"))
      return
    }
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setFormError(t("admin.customers.add.emailInvalid"))
      return
    }
    try {
      const res = await create.mutateAsync({
        name: n,
        email: em || undefined,
        phone: ph || undefined,
      })
      onCreated({ id: res.profileId, kind: "guest" })
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? ""
      if (msg === "email_exists_registered") {
        setFormError(t("admin.customers.add.emailExistsRegistered"))
      } else if (msg === "email_exists_guest") {
        setFormError(t("admin.customers.add.emailExistsGuest"))
      } else if (msg === "email_or_phone_required") {
        setFormError(t("admin.customers.add.contactRequired"))
      } else {
        setFormError(t("admin.customers.add.genericError"))
      }
    }
  }

  const extracting = extract.isPending
  const creating = create.isPending

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => {
        if (!extracting && !creating) onClose()
      }}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
          <div>
            <div className="text-[15px] font-semibold text-gray-900">
              {t("admin.customers.add.title")}
            </div>
            <div className="mt-0.5 text-[12px] text-gray-500">
              {t("admin.customers.add.subtitle")}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={extracting || creating}
            aria-label={t("admin.customers.add.cancel")}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Drop zone */}
          <div
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => !extracting && fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragging
                ? "border-gray-500 bg-gray-50"
                : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
            }`}
          >
            <Upload className="h-5 w-5 text-gray-400" />
            <div className="text-[12px] leading-relaxed text-gray-600">
              {t("admin.customers.addModal.dropZone")}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,application/pdf,image/*,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
                e.target.value = ""
              }}
            />
          </div>

          {/* Paste / type box + 讀取 */}
          <div className="space-y-1.5">
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={3}
              placeholder={t("admin.customers.addModal.pastePlaceholder")}
              disabled={extracting}
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-[12px] leading-relaxed text-gray-800 outline-none transition-colors focus:border-gray-400 disabled:opacity-60"
            />
            <div className="flex justify-end">
              <button
                onClick={handleReadText}
                disabled={extracting || !rawText.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
              >
                {extracting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FileText className="h-3 w-3" />
                )}
                {t("admin.customers.addModal.read")}
              </button>
            </div>
          </div>

          {/* Extracting indicator */}
          {extracting && (
            <div className="flex items-center gap-1.5 text-[12px] text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("admin.customers.addModal.extracting")}
            </div>
          )}

          {/* Friendly extraction notice (ok:false / too large / network) */}
          {notice && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              {notice}
            </div>
          )}

          {/* Editable fields */}
          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600">
                {t("admin.customers.add.name")}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("admin.customers.add.namePlaceholder")}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-800 outline-none transition-colors focus:border-gray-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600">
                {t("admin.customers.add.email")}
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("admin.customers.add.emailPlaceholder")}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-800 outline-none transition-colors focus:border-gray-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600">
                {t("admin.customers.add.phone")}
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("admin.customers.add.phonePlaceholder")}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-800 outline-none transition-colors focus:border-gray-400"
              />
            </div>
            <div className="text-[11px] text-gray-400">
              {t("admin.customers.add.contactHint")}
            </div>
          </div>

          {/* Source text 原文對照 (collapsible, read-only) */}
          {sourceText && (
            <details className="rounded-lg border border-gray-200 bg-gray-50">
              <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-gray-600">
                {t("admin.customers.addModal.sourceText")}
              </summary>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-gray-200 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
                {sourceText}
              </div>
            </details>
          )}

          {/* Form error */}
          {formError && (
            <div className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-[11px] text-gray-900">
              {formError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3.5">
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            {t("admin.customers.add.cancel")}
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || extracting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
          >
            {creating && <Loader2 className="h-3 w-3 animate-spin" />}
            {creating
              ? t("admin.customers.add.creating")
              : t("admin.customers.add.submit")}
          </button>
        </div>
      </div>
    </div>
  )
}
