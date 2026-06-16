/**
 * CustomerChat — per-customer 對話 (批2 m3; sales mockup 的 composer
 * 「跟 Agent 聊陳美玲的事,或叫我做事…」).
 *
 * One thread per customer, persisted in customerChatMessages (拍板:獨立新表)。
 * Streams over the SAME hardened SSE pipeline the global ops chat uses
 * (/api/agent/ask-ops-stream + customerId) — auth, CSRF header, shared
 * 30/hr rate limit, heartbeat, 90s timeout all inherited. The agent gets the
 * customer pinned in its system prompt (server-side context injection) plus
 * its usual read-only query tools.
 *
 * m3b: agent turns render their data cards (shared OpsCards) and
 * suggested-action chips. A chip click NEVER executes — it opens the gated
 * ActionConfirmDialog (sensitive = type CONFIRM) and runs through the
 * existing agent.executeOpsAction; zero new execution paths.
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { Streamdown } from "streamdown";
import { Send, Square } from "lucide-react";
import { OpsCards } from "@/components/admin/AgentChatPage";
import { parseTurnExtras } from "./customerChatExtras";
import {
  CustomerActionChips,
  ActionConfirmDialog,
  type SuggestedAction,
} from "./CustomerChatActions";

/**
 * Bound to a REGISTERED customer (userId) OR an email GUEST
 * (customerProfileId, guest-customer-chat 2026-06-15) — exactly one. Same
 * thread UI + same hardened SSE pipeline; only the scope key differs.
 */
type CustomerChatProps = { customerName: string; label?: string } & (
  | { userId: number; customerProfileId?: undefined }
  | { customerProfileId: number; userId?: undefined }
);

export default function CustomerChat(props: CustomerChatProps) {
  const { customerName, label } = props;
  // One scope object drives the query input, the SSE param, and invalidation —
  // so guest vs registered never drifts apart. The narrowed id is captured into
  // a local inside each arm (props isn't readonly, so TS would re-widen
  // props.* back to `number | undefined` inside the closures below).
  const scope = ((): {
    listInput: { userId: number } | { profileId: number };
    streamParam: string;
    invalidateOpenItems: (u: ReturnType<typeof trpc.useUtils>) => void;
  } => {
    if (props.customerProfileId != null) {
      const profileId = props.customerProfileId;
      return {
        listInput: { profileId },
        streamParam: `customerProfileId=${profileId}`,
        invalidateOpenItems: (u) =>
          void u.admin.guestOpenItems.invalidate({ profileId }),
      };
    }
    const userId = props.userId;
    return {
      listInput: { userId },
      streamParam: `customerId=${userId}`,
      invalidateOpenItems: (u) =>
        void u.admin.customerOpenItems.invalidate({ userId }),
    };
  })();

  const { t } = useLocale();
  const utils = trpc.useUtils();
  const listQ = trpc.admin.customerChatList.useQuery(scope.listInput);
  const [q, setQ] = useState("");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingExtras, setStreamingExtras] = useState<{
    cards: any[];
    actions: SuggestedAction[];
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // chip clicked → gated confirm dialog (m3b)
  const [pendingAction, setPendingAction] = useState<SuggestedAction | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollDown = () =>
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });

  const send = async () => {
    const outgoing = q.trim();
    if (!outgoing || busy) return;
    setBusy(true);
    setStreamingText("");
    setStreamingExtras(null);
    setQ("");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const resp = await fetch(
        `/api/agent/ask-ops-stream?q=${encodeURIComponent(outgoing)}&${scope.streamParam}`,
        {
          method: "GET",
          credentials: "include",
          signal: ac.signal,
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            Accept: "text/event-stream",
          },
        }
      );
      if (!resp.ok || !resp.body) {
        toast.error(`${resp.status}: ${(await resp.text()).slice(0, 120)}`);
        setBusy(false);
        setStreamingText(null);
        return;
      }
      // Jeff's question is persisted server-side before streaming — refetch
      // so his bubble appears under the thread immediately.
      utils.admin.customerChatList.invalidate(scope.listInput);
      scrollDown();

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const dataLine = chunk.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6));
            if (event.type === "token") {
              setStatus(null);
              setStreamingText(p => (p ?? "") + (event.text ?? ""));
              scrollDown();
            } else if (event.type === "status") {
              setStatus(event.text ?? null);
            } else if (event.type === "done") {
              setStatus(null);
              if (event.finalAnswer) setStreamingText(event.finalAnswer);
              setStreamingExtras({
                cards: Array.isArray(event.cards) ? event.cards : [],
                actions: Array.isArray(event.suggestedActions)
                  ? event.suggestedActions
                  : [],
              });
              // anti-flicker: refetch holds the persisted turn, then swap
              await utils.admin.customerChatList.invalidate(scope.listInput);
              setStreamingText(null);
              setStreamingExtras(null);
              setBusy(false);
              scrollDown();
            } else if (event.type === "error") {
              toast.error(event.error ?? "unknown");
              setBusy(false);
              setStreamingText(null);
              setStatus(null);
            }
          } catch {
            /* ignore malformed SSE chunk */
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast.error(err?.message ?? "stream failed");
      }
      setBusy(false);
      setStreamingText(null);
      setStatus(null);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
    setStreamingText(null);
    setStreamingExtras(null);
    setStatus(null);
  };

  const messages = listQ.data ?? [];
  const showThread =
    messages.length > 0 || streamingText !== null || status !== null;

  return (
    <div className="border-t border-gray-200 flex-shrink-0 bg-white">
      {label && (
        <div className="px-4 pt-2 text-[11px] text-gray-400">{label}</div>
      )}
      {showThread && (
        <div
          ref={scrollRef}
          className="max-h-[40vh] overflow-y-auto px-5 py-4 space-y-4"
        >
          {messages.map(m => {
            const extras =
              m.senderRole === "agent"
                ? parseTurnExtras((m as { context?: string | null }).context)
                : null;
            return (
              <div key={m.id}>
                <div
                  className={`text-[10px] font-semibold mb-1 ${
                    m.senderRole === "jeff" ? "text-gray-400" : "text-black"
                  }`}
                >
                  {m.senderRole === "jeff"
                    ? t("workspace.chatYou")
                    : "PACK&GO AGENT"}
                </div>
                {m.senderRole === "agent" ? (
                  <div className="text-[13.5px] leading-relaxed">
                    <Streamdown>{m.body}</Streamdown>
                  </div>
                ) : (
                  <div className="text-[13.5px] whitespace-pre-wrap">
                    {m.body}
                  </div>
                )}
                {/* m3b — data cards + gated action chips on agent turns */}
                {extras && <OpsCards cards={extras.cards} />}
                {extras && (
                  <CustomerActionChips
                    actions={extras.actions}
                    onPick={setPendingAction}
                  />
                )}
              </div>
            );
          })}
          {status && <div className="text-[12px] text-gray-400">{status}</div>}
          {streamingText !== null && streamingText !== "" && (
            <div>
              <div className="text-[10px] font-semibold mb-1 text-black">
                PACK&GO AGENT
              </div>
              <div className="text-[13.5px] leading-relaxed">
                <Streamdown>{streamingText}</Streamdown>
              </div>
              {streamingExtras && <OpsCards cards={streamingExtras.cards} />}
              {streamingExtras && (
                <CustomerActionChips
                  actions={streamingExtras.actions}
                  onPick={setPendingAction}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* composer — mockup grammar: 2px black border, rounded-xl, black send square */}
      <div className="p-3">
        <div className="flex items-center gap-2 border-2 border-black rounded-xl px-3 h-11">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            placeholder={t("workspace.chatPlaceholder", {
              name: customerName,
            })}
            className="flex-1 text-sm outline-none bg-transparent"
          />
          {busy ? (
            <button
              onClick={stop}
              className="h-8 px-3 rounded-lg bg-black text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Square className="w-3 h-3" />
              {t("workspace.chatStop")}
            </button>
          ) : (
            <button
              onClick={send}
              aria-label={t("workspace.chatSend")}
              className="w-7 h-7 rounded-lg bg-black text-white flex items-center justify-center"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* m3b — gated execution: confirm dialog owns agent.executeOpsAction;
          actions may create approval tasks → refresh the surrounding lists */}
      <ActionConfirmDialog
        action={pendingAction}
        onClose={() => setPendingAction(null)}
        onDone={() => {
          utils.admin.customerChatList.invalidate(scope.listInput);
          scope.invalidateOpenItems(utils);
          utils.commandCenter.list.invalidate();
          utils.commandCenter.stats.invalidate();
        }}
      />
    </div>
  );
}
