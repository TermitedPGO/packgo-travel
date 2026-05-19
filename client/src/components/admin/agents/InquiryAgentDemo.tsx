/**
 * InquiryAgentDemo — paste a real email, see what the agent would do
 * (Phase 5 module 5B). Verbatim cut from AutonomousAgentsTab.tsx.
 *
 * `: any` annotations on `result` retained — typing cleanup is v2.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Section } from "./sharedPrimitives";

export function InquiryAgentDemo() {
  const [rawMessage, setRawMessage] = useState("");
  const [channel, setChannel] = useState<
    "email" | "web_form" | "whatsapp" | "wechat" | "line" | "sms"
  >("email");
  const [result, setResult] = useState<any>(null);

  const utils = trpc.useUtils();
  const demo = trpc.agent.demoInquiry.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.snapshot.invalidate();
      utils.agent.recentOutcomes.invalidate();
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.pendingForJeff.invalidate();
    },
  });

  const run = () => {
    setResult(null);
    demo.mutate({ rawMessage, channel });
  };

  const charCount = rawMessage.length;
  const canRun = charCount >= 10 && !demo.isPending;

  return (
    <Section title="練習場 — 貼一封信看我會怎麼做(不會寄出)">
      <Card className="rounded-xl border-gray-200">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-700">頻道:</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as any)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
            >
              <option value="email">email</option>
              <option value="web_form">web_form</option>
              <option value="whatsapp">whatsapp</option>
              <option value="wechat">wechat</option>
              <option value="line">line</option>
              <option value="sms">sms</option>
            </select>
          </div>

          <Textarea
            value={rawMessage}
            onChange={(e) => setRawMessage(e.target.value)}
            placeholder={`貼上完整的客戶來信(包括 from / subject / body)。例如:\n\nFrom: lisa.chen@example.com\nSubject: 八月去黃石公園\n\n您好,我們一家四口想八月底去黃石,有 10 天時間。預算約 USD 12000。小孩 6 歲和 11 歲,想知道有沒有適合家庭的團體行程?`}
            className="min-h-[160px] rounded-lg text-xs font-mono"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400">
              {charCount}/50000 字元
            </span>
            <Button onClick={run} disabled={!canRun} className="rounded-lg gap-2">
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  思考中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  跑 InquiryAgent
                </>
              )}
            </Button>
          </div>

          {demo.error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <p className="font-semibold mb-1">錯誤:</p>
              <p>{demo.error.message}</p>
            </div>
          )}

          {result && <InquiryAgentResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function InquiryAgentResult({ result }: { result: any }) {
  const d = result.decision;
  const isEscalated = d.shouldEscalate;
  return (
    <div className="space-y-4 mt-2">
      <div
        className={`rounded-xl border-2 p-4 ${
          isEscalated
            ? "border-rose-200 bg-rose-50"
            : "border-emerald-200 bg-emerald-50"
        }`}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              我的決定
            </div>
            <div
              className={`text-lg font-bold ${
                isEscalated ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {isEscalated ? "⚠ Escalate Jeff" : "✓ 自動回覆(草稿已備)"}
            </div>
            {d.escalationReason && (
              <p className="text-xs text-rose-700 mt-1 italic">
                原因:{d.escalationReason}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              信心
            </div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                d.confidence >= 80
                  ? "text-emerald-700"
                  : d.confidence >= 60
                  ? "text-amber-600"
                  : "text-rose-700"
              }`}
            >
              {d.confidence}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <ResultField label="分類" value={d.classification} />
          <ResultField label="緊急度" value={d.urgency} />
          <ResultField label="情感" value={d.sentiment} />
          <ResultField label="回覆語言" value={d.draftLanguage} />
        </div>
      </div>

      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <MessageCircle className="h-3.5 w-3.5" />
            我對客戶意圖的理解
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-gray-700">{d.intent}</p>
          {d.extractedCustomer &&
            (d.extractedCustomer.senderEmail ||
              d.extractedCustomer.senderName) && (
              <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600">
                <span className="font-semibold">寄件人:</span>{" "}
                {d.extractedCustomer.senderName && (
                  <span>{d.extractedCustomer.senderName}</span>
                )}
                {d.extractedCustomer.senderEmail && (
                  <span className="ml-2 text-gray-500">
                    &lt;{d.extractedCustomer.senderEmail}&gt;
                  </span>
                )}
              </div>
            )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold flex items-center justify-between">
            <span>我會這樣回({d.draftLanguage})</span>
            <Badge variant="outline" className="rounded-md text-[10px]">
              {isEscalated ? "草稿僅供你參考" : "可審後送出"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <pre className="text-sm whitespace-pre-wrap font-sans text-gray-800 bg-gray-50 rounded-lg p-4 leading-relaxed">
            {d.draftReply}
          </pre>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold">我為什麼這樣決定</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-gray-600 italic leading-relaxed">
            {d.reasoning}
          </p>
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-gray-500">
            <div>
              <span className="font-semibold">policy v</span>{" "}
              {result.policyVersion ?? "—"}
            </div>
            <div>
              <span className="font-semibold">profile #</span>{" "}
              {result.profileId ?? "未建立"}
            </div>
            <div>
              <span className="font-semibold">interaction #</span>{" "}
              {result.interactionId ?? "未記錄"}
            </div>
            <div>
              <span className="font-semibold">outcome #</span>{" "}
              {result.outcomeId ?? "未記錄"}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </div>
      <div className="text-sm font-bold text-gray-900 mt-0.5">
        <code className="text-xs bg-white/60 px-1.5 py-0.5 rounded">
          {value}
        </code>
      </div>
    </div>
  );
}
