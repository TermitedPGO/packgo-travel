/**
 * Shared primitives used by the autonomous-agents sub-views
 * (Phase 5 module 5B). Verbatim cut from AutonomousAgentsTab.tsx —
 * Section, Timeline, ErrorBox, ReasoningCard + the isToday helper.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

export type TimelineItem = {
  outcomeId: number;
  actionTaken: string;
  confidence: number | null;
  outcomeFinalized: number;
  jeffOverride: number;
  createdAt: Date | string;
  channel: string | null;
  contentSummary: string | null;
  classification: string | null;
  customerEmail: string | null;
};

export function Timeline({
  items,
  compact = false,
}: {
  items: TimelineItem[];
  compact?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((i) => {
        const isEsc = i.actionTaken.includes("escalate");
        const lowConf = i.confidence != null && i.confidence < 70;
        const final = i.outcomeFinalized === 1;
        return (
          <div
            key={i.outcomeId}
            className="flex items-start gap-3 text-xs py-1.5 border-b border-gray-100 last:border-0"
          >
            <span className="text-gray-400 font-mono text-[10px] w-12 flex-shrink-0 pt-0.5">
              {new Date(i.createdAt).toLocaleString("zh-TW", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${
                isEsc
                  ? "bg-rose-100 text-rose-700"
                  : lowConf
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {isEsc ? "升級" : lowConf ? "低信心" : "自動"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-gray-800 truncate">
                {i.contentSummary ?? i.classification ?? i.actionTaken}
              </div>
              {!compact && i.customerEmail && (
                <div className="text-[10px] text-gray-400 font-mono">
                  {i.customerEmail} · {i.channel}
                </div>
              )}
            </div>
            <span
              className={`text-[11px] font-bold tabular-nums w-10 text-right ${
                lowConf ? "text-amber-700" : "text-gray-500"
              }`}
            >
              {i.confidence != null ? `${i.confidence}%` : "—"}
            </span>
            <span className="flex-shrink-0 w-12 text-right text-[10px]">
              {final ? (
                i.jeffOverride === 1 ? (
                  <span className="text-rose-600 font-bold">override</span>
                ) : (
                  <span className="text-emerald-600 font-bold">✓ ack</span>
                )
              ) : (
                <span className="text-gray-400">未看</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
      <p className="font-semibold mb-1">錯誤:</p>
      <p>{message}</p>
    </div>
  );
}

export function ReasoningCard({
  reasoning,
  meta,
}: {
  reasoning: string;
  meta: {
    policyVersion?: number;
    profileId?: number;
    interactionId?: number;
    outcomeId?: number;
  };
}) {
  return (
    <Card className="rounded-xl border-gray-200">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-bold">我為什麼這樣決定</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-gray-600 italic leading-relaxed">
          {reasoning}
        </p>
        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-gray-500">
          <div>
            <span className="font-semibold">policy v</span>{" "}
            {meta.policyVersion ?? "—"}
          </div>
          <div>
            <span className="font-semibold">profile #</span>{" "}
            {meta.profileId ?? "—"}
          </div>
          <div>
            <span className="font-semibold">interaction #</span>{" "}
            {meta.interactionId ?? "—"}
          </div>
          <div>
            <span className="font-semibold">outcome #</span>{" "}
            {meta.outcomeId ?? "—"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Pure helper: is `d` "today" in local time?
 * Extracted because both AgentDeskDetail and AutonomousAgentsTab use it.
 */
export function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
