/**
 * RefundAgentDemo — always escalates; triage + internal briefing for Jeff
 * (Phase 5 module 5B). Verbatim cut from AutonomousAgentsTab.tsx.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import { ErrorBox, ReasoningCard, Section } from "./sharedPrimitives";

export function RefundAgentDemo() {
  const [rawMessage, setRawMessage] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const demo = trpc.agent.demoRefund.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.officeOverview.invalidate();
      utils.agent.unreadMessageCount.invalidate();
      utils.agent.listMessages.invalidate();
    },
  });
  const run = () => {
    setResult(null);
    demo.mutate({ rawMessage, senderEmail: senderEmail.trim() || undefined });
  };
  return (
    <Section title="練習場 — 貼一封退款請求,我做 triage 並寫內部 briefing 給你">
      <Card className="rounded-xl border-rose-200 bg-rose-50/20">
        <CardContent className="space-y-3 p-4">
          <div className="rounded-lg bg-rose-100 border border-rose-200 p-2 text-[11px] text-rose-800">
            ⚠ 重要規則:我永遠 NEVER 直接回客戶,永遠 escalate 你。輸出 ONLY 給你看。
          </div>
          <Input
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            placeholder="客人 email (可選)"
            className="rounded-lg text-xs"
          />
          <Textarea
            value={rawMessage}
            onChange={(e) => setRawMessage(e.target.value)}
            placeholder="貼上客戶退款請求原文..."
            className="min-h-[160px] rounded-lg text-xs font-mono"
          />
          <div className="flex items-center justify-end">
            <Button
              onClick={run}
              disabled={rawMessage.length < 10 || demo.isPending}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Triage 中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  跑 RefundAgent
                </>
              )}
            </Button>
          </div>
          {demo.error && <ErrorBox message={demo.error.message} />}
          {result && <RefundResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function RefundResult({ result }: { result: any }) {
  const d = result.decision;
  const SEV_COLORS = {
    critical: "border-rose-300 bg-rose-50 text-rose-700",
    high: "border-amber-300 bg-amber-50 text-amber-700",
    medium: "border-amber-200 bg-amber-50/50 text-amber-700",
    low: "border-gray-200 bg-gray-50 text-gray-700",
  } as const;
  // Phase 1 Cluster C: d.severity comes through `any` (result is typed `any`).
  // Cast to the SEV_COLORS key set; fall back to "low" if absent / unknown.
  const sevKey = (d.severity as keyof typeof SEV_COLORS) in SEV_COLORS
    ? (d.severity as keyof typeof SEV_COLORS)
    : "low";
  const sevColor = SEV_COLORS[sevKey];

  return (
    <div className="space-y-3 mt-2">
      <div className={`rounded-xl border-2 p-4 ${sevColor}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-70 font-bold">
              嚴重程度
            </div>
            <div className="text-xl font-bold">{d.severity.toUpperCase()}</div>
            <div className="text-xs mt-1">原因類別:{d.reasonCategory}</div>
            <div className="text-xs mt-0.5">客人情緒:{d.customerEmotionalState}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider opacity-70 font-bold">
              信心
            </div>
            <div className="text-2xl font-bold tabular-nums">{d.confidence}</div>
          </div>
        </div>
      </div>

      <Card className="rounded-xl border-gray-300 bg-gradient-to-br from-gray-50 to-white">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold">📋 給你的內部 briefing</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-sm text-gray-800 leading-relaxed">
            {d.jeffInternalBriefing}
          </p>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              抽取的事實
            </p>
            <div className="space-y-1 text-xs">
              {d.extractedFacts.bookingIdMentioned && (
                <div>
                  訂單編號: <code>{d.extractedFacts.bookingIdMentioned}</code>
                </div>
              )}
              {d.extractedFacts.amountMentioned && (
                <div>
                  金額提及: <code>{d.extractedFacts.amountMentioned}</code>
                </div>
              )}
              {d.extractedFacts.dateRangeMentioned && (
                <div>
                  日期: <code>{d.extractedFacts.dateRangeMentioned}</code>
                </div>
              )}
              {d.extractedFacts.specificIncidents.length > 0 && (
                <div>
                  具體事件:
                  <ul className="list-disc list-inside ml-2 mt-1">
                    {d.extractedFacts.specificIncidents.map(
                      (s: string, i: number) => (
                        <li key={i}>{s}</li>
                      )
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              下一步建議
            </p>
            <ul className="list-disc list-inside text-xs space-y-0.5">
              {d.suggestedJeffActions.map((s: string, i: number) => (
                <li key={i} className="text-gray-700">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
        💬 此 triage 已自動寫入「Agent 對話框」(critical 等級立刻通知)。
      </div>

      <ReasoningCard reasoning={d.reasoning} meta={result} />
    </div>
  );
}
