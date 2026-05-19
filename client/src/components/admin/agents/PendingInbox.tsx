/**
 * Pending inbox — escalations + low-confidence drafts waiting on Jeff
 * (Phase 5 module 5B).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { AGENT_DEFS } from "./agentDefs";

export type PendingItem = {
  outcomeId: number;
  agentName: string;
  actionTaken: string;
  confidence: number | null;
  createdAt: Date | string;
  // Phase 1 Cluster C: align with agent.pendingForJeff tRPC return shape.
  // The query left-joins customerInteractions + customerProfiles so all
  // joined-table columns are nullable; interactionId is part of the row.
  interactionId: number | null;
  channel: string | null;
  content: string | null;
  contentSummary: string | null;
  classification: string | null;
  sentiment: string | null;
  // urgency is nullable in the DB column → treat null as "no urgency rating".
  urgency: number | null;
  customerProfileId: number | null;
  customerEmail: string | null;
};

export function PendingInbox({ items }: { items: PendingItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="rounded-xl border-gray-200">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-gray-500">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <p className="text-sm">辦公室一片祥和 — 沒有等你看的事。</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-rose-200 bg-gradient-to-br from-rose-50/50 to-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-rose-700">
          <AlertTriangle className="h-4 w-4" />
          等你看 · {items.length} 件
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <PendingRow key={item.outcomeId} item={item} />
        ))}
      </CardContent>
    </Card>
  );
}

function PendingRow({ item }: { item: PendingItem }) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const ack = trpc.agent.acknowledge.useMutation({
    onSuccess: () => {
      utils.agent.pendingForJeff.invalidate();
      utils.agent.recentActivity.invalidate();
      utils.agent.snapshot.invalidate();
      utils.agent.agentOffice.invalidate();
    },
  });

  const isEscalation = item.actionTaken.includes("escalate");
  const lowConfidence = item.confidence != null && item.confidence < 70;
  const agentDef = AGENT_DEFS.find((a) => a.id === item.agentName);
  const summary =
    item.contentSummary ??
    (item.content ? item.content.slice(0, 120) : "(無內容)");

  return (
    <div
      className={`rounded-lg border bg-white p-3 transition-shadow ${
        expanded ? "shadow-sm border-gray-300" : "border-gray-200"
      }`}
    >
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-shrink-0 mt-0.5">
          {isEscalation ? (
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
              升級
            </span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              低信心
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
            <span className="font-semibold text-gray-700">
              {agentDef?.label ?? item.agentName}
            </span>
            <span>·</span>
            <span>{item.channel ?? "—"}</span>
            <span>·</span>
            <span>
              {new Date(item.createdAt).toLocaleString("zh-TW", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {item.customerEmail && (
              <>
                <span>·</span>
                <span className="font-mono text-[11px]">
                  {item.customerEmail}
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-gray-800 line-clamp-2">{summary}</p>
        </div>
        <div className="text-right flex-shrink-0">
          {item.confidence != null && (
            <div
              className={`text-sm font-bold tabular-nums ${
                lowConfidence ? "text-amber-700" : "text-gray-700"
              }`}
            >
              {item.confidence}%
            </div>
          )}
          <ArrowRight
            className={`h-4 w-4 text-gray-400 transition-transform inline-block ${
              expanded ? "rotate-90" : ""
            }`}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
          {item.content && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                客戶原文
              </p>
              <pre className="text-xs whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                {item.content}
              </pre>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Meta label="分類" value={item.classification ?? "—"} />
            <Meta label="情感" value={item.sentiment ?? "—"} />
            <Meta label="緊急" value={String(item.urgency ?? "—")} />
            <Meta label="動作" value={item.actionTaken} />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              你的回覆 (給 agent,他會學習)
            </p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如:這種情況以後可以直接 escalate / 其實這封 confidence 抓太低,可以自動回 / 客人想要的不是這個,實際是…"
              className="rounded-lg text-xs min-h-[60px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ack.mutate({
                  outcomeId: item.outcomeId,
                  verdict: "approved",
                  reason: reason || undefined,
                })
              }
              disabled={ack.isPending}
              className="rounded-lg gap-1.5"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              這次判斷正確
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ack.mutate({
                  outcomeId: item.outcomeId,
                  verdict: "override",
                  reason: reason || undefined,
                })
              }
              disabled={ack.isPending || !reason.trim()}
              className="rounded-lg gap-1.5 text-rose-700 border-rose-300 hover:bg-rose-50"
              title={!reason.trim() ? "請先填寫原因" : ""}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              我有不同意見
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
      <div className="text-xs font-semibold text-gray-700 mt-0.5">
        <code className="text-[11px]">{value}</code>
      </div>
    </div>
  );
}
