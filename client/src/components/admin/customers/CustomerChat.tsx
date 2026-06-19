import { useState } from "react"
import { MessageSquare, Send, FileText } from "lucide-react"
import type { AdaptedCustomer, ChatMessage } from "./types"

export default function CustomerChat({ customer, chatMessages }: { customer: AdaptedCustomer | null; chatMessages: ChatMessage[] }) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([])

  const handleSend = () => {
    if (!input.trim()) return
    const q = input.trim()
    setInput("")
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
      { role: "ai", text: `收到你關於 ${customer?.name ?? ""} 的問題：「${q}」\n\n這是 mock 回覆，接 AI 後會有真正的回答。` },
    ])
  }

  return (
    <div className="w-[340px] border-l border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-200 text-[13px] font-medium flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
        AI 助手
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Intro card */}
        {customer && customer.drafts.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-700 leading-relaxed">
            AI 已為 {customer.name} 準備了 {customer.drafts.length} 則草稿，審核後可直接發送：
          </div>
        )}

        {/* Drafts */}
        {(customer?.drafts ?? []).map((draft, i) => (
          <div key={`draft-${i}`} className="rounded-xl border border-gray-200 p-3 bg-white">
            <div className="text-[10px] text-gray-400 tracking-wide mb-1.5">
              AI 草稿 — {draft.type.toUpperCase()}
            </div>
            <div className="text-[11px] text-gray-500 mb-1.5">
              收件：{draft.to}
            </div>
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
            <div className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100">
              {draft.body}
            </div>
            <div className="flex gap-1.5 mt-2.5">
              <button
                onClick={() => alert(`已發送 ${draft.type}`)}
                className="px-3.5 py-1.5 rounded-lg text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors"
              >
                確認發送
              </button>
              <button
                onClick={() => alert("編輯草稿")}
                className="px-3.5 py-1.5 rounded-lg text-[11px] font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                編輯
              </button>
            </div>
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
            placeholder="關於這位客戶..."
            className="flex-1 text-[12px] outline-none bg-transparent"
          />
          <button
            onClick={handleSend}
            className="w-6 h-6 rounded-md bg-gray-900 text-white flex items-center justify-center hover:bg-gray-700 transition-colors flex-shrink-0"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
