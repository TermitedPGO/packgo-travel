import { useEffect, useRef, useState } from "react"
import { MessageSquare, Send, FileText } from "lucide-react"
import { useLocale } from "@/contexts/LocaleContext"
import type { AdaptedCustomer, ChatMessage, Draft } from "./types"

export default function CustomerChat({
  customer,
  chatMessages,
  onApproveDraft,
  isApprovingDraft,
}: {
  customer: AdaptedCustomer | null
  chatMessages: ChatMessage[]
  onApproveDraft: (draft: Draft, editedBody?: string) => Promise<void>
  isApprovingDraft: boolean
}) {
  const { t } = useLocale()
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([])
  // AI 助手 streaming state. `busy` gates the send button; abortRef tears down
  // the in-flight SSE if Jeff switches customer mid-answer.
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Draft approve/edit/confirm state (keyed by draft id).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmBody, setConfirmBody] = useState<string | undefined>(undefined)
  const [error, setError] = useState<{ id: string; msg: string } | null>(null)

  const reset = () => {
    setEditingId(null)
    setConfirmId(null)
    setConfirmBody(undefined)
  }

  // Drop any in-flight edit / confirm / error state when the selected customer
  // changes — a money/legal send surface must never carry state across customers.
  useEffect(() => {
    setEditingId(null)
    setConfirmId(null)
    setConfirmBody(undefined)
    setError(null)
    setEditText("")
    // The AI 助手 thread is per-customer — abort any in-flight stream and clear
    // the Q&A so customer A's answers never linger while viewing customer B.
    abortRef.current?.abort()
    setMessages([])
    setBusy(false)
  }, [customer?.id, customer?.kind])

  // Tear down any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Sensitive (碰錢碰法律) drafts go through a confirm step; others send directly.
  // On failure: surface an error and KEEP the dialog open — never silently clear
  // (a failed send must not look like a success).
  const submit = async (draft: Draft, body?: string) => {
    setError(null)
    if (draft.sensitive) {
      setConfirmId(draft.id)
      setConfirmBody(body)
      return
    }
    try {
      await onApproveDraft(draft, body)
      reset()
    } catch {
      setError({ id: draft.id, msg: t("admin.customers.drafts.sendFailed") })
    }
  }
  const doConfirm = async (draft: Draft) => {
    setError(null)
    try {
      await onApproveDraft(draft, confirmBody)
      reset()
    } catch {
      setError({ id: draft.id, msg: t("admin.customers.drafts.sendFailed") })
    }
  }

  // Stream a customer-scoped answer over the SAME hardened SSE pipeline the
  // global ops chat uses (/api/agent/ask-ops-stream + customerId/profileId):
  // admin-auth + CSRF + the system prompt pinned to THIS customer's real data
  // (搬運 facts, not invented). Read-only — it never sends or edits anything.
  const handleSend = async () => {
    const q = input.trim()
    if (!q || busy || !customer) return
    setInput("")
    setBusy(true)
    // registered → customerId (userId); guest → customerProfileId.
    const scopeParam =
      customer.kind === "guest"
        ? `customerProfileId=${customer.id}`
        : `customerId=${customer.id}`
    // Optimistic user bubble + an empty AI bubble we stream tokens into.
    setMessages((prev) => [...prev, { role: "user", text: q }, { role: "ai", text: "" }])
    const setAiText = (next: (prev: string) => string) =>
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last?.role === "ai") copy[copy.length - 1] = { role: "ai", text: next(last.text) }
        return copy
      })

    const ac = new AbortController()
    abortRef.current = ac
    let sawToken = false
    try {
      const resp = await fetch(
        `/api/agent/ask-ops-stream?q=${encodeURIComponent(q)}&${scopeParam}`,
        {
          method: "GET",
          credentials: "include",
          signal: ac.signal,
          headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/event-stream" },
        },
      )
      if (!resp.ok || !resp.body) {
        setAiText(() => t("admin.customers.drafts.askFailed"))
        setBusy(false)
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() ?? ""
        for (const chunk of chunks) {
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "))
          if (!dataLine) continue
          try {
            const event = JSON.parse(dataLine.slice(6))
            if (event.type === "token") {
              // first real token clears any "查詢中…" status placeholder
              if (!sawToken) { sawToken = true; setAiText(() => "") }
              setAiText((p) => p + (event.text ?? ""))
            } else if (event.type === "status") {
              if (!sawToken) setAiText(() => event.text ?? "")
            } else if (event.type === "done") {
              if (event.finalAnswer) setAiText(() => event.finalAnswer)
            } else if (event.type === "error") {
              setAiText(() => event.error ?? t("admin.customers.drafts.askFailed"))
            }
          } catch {
            /* ignore a malformed SSE chunk */
          }
        }
      }
    } catch (err) {
      // a deliberate abort (customer switch / unmount) is not an error
      if ((err as { name?: string })?.name !== "AbortError") {
        setAiText(() => t("admin.customers.drafts.askFailed"))
      }
    } finally {
      setBusy(false)
    }
  }

  const drafts = customer?.drafts ?? []

  return (
    <div className="w-[340px] border-l border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-200 text-[13px] font-medium flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
        {t("admin.customers.drafts.heading")}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Intro card */}
        {customer && drafts.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-700 leading-relaxed">
            {t("admin.customers.drafts.intro", { name: customer.name, n: drafts.length })}
          </div>
        )}

        {/* Drafts */}
        {drafts.map((draft) => (
          <div key={draft.id} className="rounded-xl border border-gray-200 p-3 bg-white">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] text-gray-400 tracking-wide">
                {t("admin.customers.drafts.label")} · {draft.type.toUpperCase()}
              </div>
              {draft.sensitive && (
                <span className="text-[10px] font-medium bg-gray-900 text-white px-1.5 py-0.5 rounded-md">
                  {t("admin.customers.drafts.sensitive")}
                </span>
              )}
            </div>
            <div className="text-[11px] text-gray-500 mb-0.5">
              {t("admin.customers.drafts.to")}：{draft.to || "—"}
            </div>
            {draft.subject && (
              <div className="text-[11px] text-gray-500 mb-1.5">
                {t("admin.customers.drafts.subject")}：{draft.subject}
              </div>
            )}
            {draft.attachments && draft.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {draft.attachments.map((a, j) => (
                  <span
                    key={j}
                    className="inline-flex items-center gap-1 text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md"
                  >
                    <FileText className="w-2.5 h-2.5" />
                    {a}
                  </span>
                ))}
              </div>
            )}

            {editingId === draft.id ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={6}
                className="w-full text-[12px] text-gray-700 leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-200 outline-none focus:border-gray-400"
              />
            ) : (
              <div className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100">
                {draft.body}
              </div>
            )}

            {error?.id === draft.id && (
              <div className="mt-2 text-[11px] text-gray-900 bg-gray-100 border border-gray-300 rounded-lg p-2">
                {error.msg}
              </div>
            )}

            {confirmId === draft.id ? (
              <div className="mt-2.5">
                <div className="text-[11px] text-gray-700 bg-gray-100 rounded-lg p-2 leading-relaxed">
                  {t("admin.customers.drafts.confirmSensitive")}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button
                    disabled={isApprovingDraft}
                    onClick={() => doConfirm(draft)}
                    className="px-3.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
                  >
                    {isApprovingDraft ? t("admin.customers.drafts.sending") : t("admin.customers.drafts.confirmSend")}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmId(null)
                      setConfirmBody(undefined)
                    }}
                    className="px-3.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {t("admin.customers.drafts.cancel")}
                  </button>
                </div>
              </div>
            ) : editingId === draft.id ? (
              <div className="flex gap-1.5 mt-2.5">
                <button
                  disabled={isApprovingDraft}
                  onClick={() => submit(draft, editText)}
                  className="px-3.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {t("admin.customers.drafts.save")}
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {t("admin.customers.drafts.cancel")}
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5 mt-2.5">
                <button
                  disabled={isApprovingDraft}
                  onClick={() => submit(draft)}
                  className="px-3.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {isApprovingDraft ? t("admin.customers.drafts.sending") : t("admin.customers.drafts.send")}
                </button>
                <button
                  onClick={() => {
                    setError(null)
                    setEditingId(draft.id)
                    setEditText(draft.body)
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {t("admin.customers.drafts.edit")}
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Chat messages */}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-[12px] leading-relaxed rounded-xl px-3 py-2 max-w-[90%] whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-gray-900 text-white ml-auto"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-2">
        <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={busy || !customer}
            placeholder={t("admin.customers.drafts.askPlaceholder")}
            className="flex-1 text-[12px] outline-none bg-transparent disabled:opacity-60"
          />
          <button
            onClick={handleSend}
            disabled={busy || !customer || !input.trim()}
            className="w-6 h-6 rounded-md bg-gray-900 text-white flex items-center justify-center hover:bg-gray-700 transition-colors flex-shrink-0 disabled:opacity-40 disabled:hover:bg-gray-900"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
