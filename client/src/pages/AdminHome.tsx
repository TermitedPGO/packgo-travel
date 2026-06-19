import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "wouter";
import {
  Send,
  Paperclip,
  AlertCircle,
  Clock,
  DollarSign,
  Map,
  Bot,
  ChevronRight,
} from "lucide-react";

// ── Mock data (will be replaced by tRPC queries) ────────────────────────────

const MOCK_MESSAGES = [
  {
    id: 1,
    role: "assistant" as const,
    content:
      "早安 Jeff。今天有 5 件事要處理：\n\n1. **David Chen** 的日本報價還沒回覆（2 天前）\n2. **王小明** 歐洲 14 天團明天出發，護照資料未確認\n3. UV 同步昨晚失敗（timeout）\n4. 2 封新詢問等待分類\n5. Lisa Wu 尾款 $1,820 超過 7 天未收",
  },
];

const MOCK_TODO = [
  { id: 1, priority: "urgent" as const, text: "David Chen 日本報價未回覆", type: "customer", targetId: 101, time: "2 天前" },
  { id: 2, priority: "urgent" as const, text: "王小明 護照未確認（明天出發）", type: "customer", targetId: 102, time: "明天" },
  { id: 3, priority: "important" as const, text: "UV 同步失敗", type: "system", targetId: 0, time: "昨晚" },
  { id: 4, priority: "normal" as const, text: "2 封新詢問待分類", type: "inquiry", targetId: 0, time: "今天" },
  { id: 5, priority: "important" as const, text: "Lisa Wu 尾款 $1,820 逾期", type: "customer", targetId: 103, time: "7 天" },
];

const MOCK_FINANCE = { revenue: 12450, pending: 8200, trust: 45000, operating: 12300 };

const MOCK_TOURS = { active: 1205, byRegion: [{ name: "日本", count: 580 }, { name: "歐洲", count: 285 }, { name: "東南亞", count: 195 }, { name: "紐澳", count: 85 }, { name: "美洲", count: 60 }] };

const MOCK_AGENT = { inquiryToday: 3, opsToday: 12, lastSync: "6 小時前", syncOk: true, failures: 0 };

// ── Components ──────────────────────────────────────────────────────────────

function PriorityDot({ priority }: { priority: "urgent" | "important" | "normal" }) {
  const colors = { urgent: "bg-red-500", important: "bg-amber-400", normal: "bg-gray-300" };
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[priority]}`} />;
}

function TodoCard() {
  const { t } = useLocale();
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold">{t("admin.todoTitle")}</h3>
        </div>
        <span className="text-xs text-gray-400">{MOCK_TODO.length}</span>
      </div>
      <div className="space-y-2">
        {MOCK_TODO.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <PriorityDot priority={item.priority} />
            <span className="text-[13px] flex-1 truncate">{item.text}</span>
            <span className="text-[11px] text-gray-400 flex-shrink-0">{item.time}</span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FinanceCard() {
  const { t } = useLocale();
  const f = MOCK_FINANCE;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold">{t("admin.financeTitle")}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] text-gray-400">{t("admin.financeRevenue")}</p>
          <p className="text-lg font-bold">${f.revenue.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[11px] text-gray-400">{t("admin.financePending")}</p>
          <p className="text-lg font-bold text-amber-600">${f.pending.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[11px] text-gray-400">Trust</p>
          <p className="text-sm font-medium">${f.trust.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[11px] text-gray-400">Operating</p>
          <p className="text-sm font-medium">${f.operating.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

function ToursCard() {
  const { t } = useLocale();
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <Map className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold">{t("admin.toursTitle")}</h3>
      </div>
      <p className="text-lg font-bold mb-2">{MOCK_TOURS.active.toLocaleString()} <span className="text-sm font-normal text-gray-400">{t("admin.toursActive")}</span></p>
      <div className="space-y-1.5">
        {MOCK_TOURS.byRegion.map((r) => (
          <div key={r.name} className="flex items-center gap-2">
            <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gray-800 h-full rounded-full"
                style={{ width: `${(r.count / MOCK_TOURS.active) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-gray-500 w-16 text-right">{r.name}</span>
            <span className="text-[11px] font-medium w-8 text-right">{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentCard() {
  const { t } = useLocale();
  const a = MOCK_AGENT;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold">{t("admin.agentTitle")}</h3>
      </div>
      <div className="space-y-2 text-[13px]">
        <div className="flex justify-between">
          <span className="text-gray-500">Inquiry</span>
          <span>{t("admin.agentToday", { n: a.inquiryToday })}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Ops</span>
          <span>{t("admin.agentToday", { n: a.opsToday })}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">{t("admin.agentSync")}</span>
          <span className={a.syncOk ? "text-green-600" : "text-red-500"}>
            {a.lastSync} {a.syncOk ? "✓" : "✗"}
          </span>
        </div>
        {a.failures > 0 && (
          <div className="flex justify-between text-red-500">
            <span>{t("admin.agentFailures")}</span>
            <span>{a.failures}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function AdminHome() {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{ id: number; role: "assistant" | "user"; content: string }>>(MOCK_MESSAGES);

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { id: Date.now(), role: "user" as const, content: input }]);
    setInput("");
    // TODO: wire to OpsAgent tRPC call
  };

  return (
    <div className="h-full flex flex-col">
      {/* AI Chat area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-gray-900 text-white"
                      : "bg-gray-50 border border-gray-200 text-gray-800"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 focus-within:border-gray-500 transition-colors">
            <button
              type="button"
              className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              title={t("admin.chatAttach")}
            >
              <Paperclip className="w-4.5 h-4.5" />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={t("admin.chatPlaceholder")}
              className="flex-1 text-sm outline-none bg-transparent"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-1.5 rounded-lg bg-gray-900 text-white disabled:opacity-30 hover:bg-gray-800 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 text-center">
            {t("admin.chatHint")}
          </p>
        </div>
      </div>

      {/* Dashboard cards */}
      <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 xl:grid-cols-4 gap-3">
          <TodoCard />
          <FinanceCard />
          <ToursCard />
          <AgentCard />
        </div>
      </div>
    </div>
  );
}
