import { useEffect, useRef, useState } from "react"
import {
  MessageSquare,
  Send,
  FileText,
  Square,
  Maximize2,
  Minimize2,
  Loader2,
  Check,
} from "lucide-react"
import { Streamdown } from "streamdown"
import { trpc } from "@/lib/trpc"
import { useLocale } from "@/contexts/LocaleContext"
import type { AdaptedCustomer, ChatMessage, Draft } from "./types"
import {
  emptyTurn,
  reduceChatEvent,
  parseSseChunk,
  type ChatTurn,
  type ChatStep,
} from "./chatStream"

type ChatMsg = { role: "user"; text: string } | { role: "ai"; turn: ChatTurn }

/** Dim "thinking" step label: the bridge sentence the model spoke, or the tools
 * it ran when it spoke nothing. */
function stepLabel(s: ChatStep): string {
  const text = s.text.trim()
  if (text) return text.length > 48 ? text.slice(0, 48) + "…" : text
  if (s.tools.length) return s.tools.join(", ")
  return "…"
}

/** Smooth the streamed answer: reveal characters at a steady cadence (rAF) so the
 * text flows in like Claude Code instead of jumping in token-sized bursts. The
 * cadence scales mildly with backlog so it never lags, but stays smooth on a
 * trickle. `streamKey` resets the buffer when a new turn starts. */
function useSmoothStream(target: string, streamKey: number): string {
  const [displayed, setDisplayed] = useState("")
  useEffect(() => {
    setDisplayed("")
  }, [streamKey])
  useEffect(() => {
    if (displayed === target) return
    // The cleaned final answer can diverge from the raw stream — snap, don't stall.
    if (!target.startsWith(displayed)) {
      setDisplayed(target)
      return
    }
    const backlog = target.length - displayed.length
    const step = Math.max(2, Math.min(Math.ceil(backlog / 10), 40))
    const id = requestAnimationFrame(() =>
      setDisplayed(target.slice(0, Math.min(target.length, displayed.length + step))),
    )
    return () => cancelAnimationFrame(id)
  }, [target, displayed, streamKey])
  return displayed
}

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
  const utils = trpc.useUtils()
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<ChatMsg[]>([])
  // AI 助手 streaming state. `busy` gates the send button; abortRef tears down
  // the in-flight SSE if Jeff switches customer mid-answer or hits stop.
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Draft approve/edit/confirm state (keyed by draft id).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmBody, setConfirmBody] = useState<string | undefined>(undefined)
  const [error, setError] = useState<{ id: string; msg: string } | null>(null)

  // Smooth the active (last) AI turn so the answer flows in at a steady cadence
  // instead of token-sized jumps (Claude Code feel). Older turns render directly.
  const lastMsg = messages[messages.length - 1]
  const smoothed = useSmoothStream(
    lastMsg && lastMsg.role === "ai" ? lastMsg.turn.answer || lastMsg.turn.live : "",
    messages.length,
  )

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

  // Keep the latest streamed token in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  // Tear down any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Auto-grow the composer textarea (1 line up to ~5), like Claude Code.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }, [input])

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

  // Update the in-flight AI turn (always the last message) immutably.
  const updateLastAi = (fn: (turn: ChatTurn) => ChatTurn) =>
    setMessages((prev) => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      if (last && last.role === "ai") copy[copy.length - 1] = { role: "ai", turn: fn(last.turn) }
      return copy
    })

  // Stream a customer-scoped answer over the hardened SSE pipeline the global ops
  // chat uses (/api/agent/ask-ops-stream + customerId/profileId). Thinking rounds
  // collapse into dim steps; the answer streams clean (no 斷句). Read-only.
  const handleSend = async () => {
    const q = input.trim()
    if (!q || busy || !customer) return
    setInput("")
    setBusy(true)
    const scopeParam =
      customer.kind === "guest" ? `customerProfileId=${customer.id}` : `customerId=${customer.id}`
    setMessages((prev) => [...prev, { role: "user", text: q }, { role: "ai", turn: emptyTurn() }])

    const ac = new AbortController()
    abortRef.current = ac
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
        updateLastAi((turn) => ({ ...turn, error: t("admin.customers.drafts.askFailed") }))
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
        const { events, rest } = parseSseChunk(buffer)
        buffer = rest
        for (const ev of events) updateLastAi((turn) => reduceChatEvent(turn, ev))
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        updateLastAi((turn) => ({ ...turn, error: t("admin.customers.drafts.askFailed") }))
      }
    } finally {
      setBusy(false)
      // The agent may have produced a follow-up draft (draft_followup); refresh
      // the 待審草稿 cards so a new one shows without a manual reload.
      void utils.admin.customerDrafts.invalidate()
    }
  }

  const drafts = customer?.drafts ?? []

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={() => setExpanded(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={
          expanded
            ? "fixed inset-y-0 right-0 z-50 w-[min(960px,72vw)] bg-white border-l border-gray-200 flex flex-col overflow-hidden shadow-2xl"
            : "w-[340px] border-l border-gray-200 flex flex-col overflow-hidden"
        }
      >
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-200 text-[13px] font-medium flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
          {t("admin.customers.drafts.heading")}
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? t("admin.customers.drafts.chatCollapse") : t("admin.customers.drafts.chatExpand")}
          title={expanded ? t("admin.customers.drafts.chatCollapse") : t("admin.customers.drafts.chatExpand")}
          className="w-6 h-6 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors"
        >
          {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
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

        {/* Chat: user bubbles + AI turns (dim thinking steps, then clean answer) */}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="text-[13px] leading-relaxed rounded-xl px-3 py-2 max-w-[88%] whitespace-pre-wrap bg-gray-900 text-white ml-auto"
            >
              {m.text}
            </div>
          ) : (
            <div key={i} className="space-y-1.5 max-w-[94%]">
              {m.turn.steps.map((s, j) => (
                <div key={j} className="flex items-start gap-1.5 text-[11px] text-gray-400 leading-snug">
                  <Check className="w-3 h-3 mt-0.5 text-gray-300 flex-shrink-0" />
                  <span className="truncate">{stepLabel(s)}</span>
                </div>
              ))}

              {(() => {
                const isLast = i === messages.length - 1
                const fullText = m.turn.answer || m.turn.live
                const shown = isLast ? smoothed : fullText
                if (shown) {
                  return (
                    <div className="text-[13px] text-gray-700 leading-relaxed bg-gray-100 rounded-xl px-3 py-2 prose-chat">
                      <Streamdown>{shown}</Streamdown>
                      {isLast && (busy || smoothed !== fullText) && (
                        <span className="inline-block w-1.5 h-3.5 bg-gray-400 ml-0.5 align-text-bottom animate-pulse" />
                      )}
                    </div>
                  )
                }
                if (busy && isLast && !m.turn.error) {
                  return (
                    <div className="flex items-center gap-1.5 text-[12px] text-gray-400 px-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                    </div>
                  )
                }
                return null
              })()}

              {m.turn.error && (
                <div className="text-[12px] text-gray-700 bg-gray-100 rounded-xl px-3 py-2">
                  {m.turn.error}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-2">
        <div className="flex items-end gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            disabled={!customer}
            rows={1}
            placeholder={t("admin.customers.drafts.askPlaceholder")}
            className="flex-1 text-[12px] leading-relaxed outline-none bg-transparent resize-none max-h-[120px] py-0.5 disabled:opacity-60"
          />
          <button
            onClick={busy ? () => abortRef.current?.abort() : handleSend}
            disabled={!customer || (!busy && !input.trim())}
            aria-label={busy ? t("admin.customers.drafts.chatStop") : t("admin.customers.drafts.send")}
            title={busy ? t("admin.customers.drafts.chatStop") : undefined}
            className="w-6 h-6 mb-0.5 rounded-md bg-gray-900 text-white flex items-center justify-center hover:bg-gray-700 transition-colors flex-shrink-0 disabled:opacity-40 disabled:hover:bg-gray-900"
          >
            {busy ? <Square className="w-2.5 h-2.5" /> : <Send className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
