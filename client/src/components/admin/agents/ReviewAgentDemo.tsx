/**
 * ReviewAgentDemo — paste a review, see how the agent would reply
 * (Phase 5 module 5B). Verbatim cut from AutonomousAgentsTab.tsx.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send } from "lucide-react";
import { ErrorBox, ReasoningCard, Section } from "./sharedPrimitives";

export function ReviewAgentDemo() {
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState(5);
  const [senderEmail, setSenderEmail] = useState("");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const demo = trpc.agent.demoReview.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.snapshot.invalidate();
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.officeOverview.invalidate();
    },
  });
  const run = () => {
    setResult(null);
    demo.mutate({
      reviewText,
      rating,
      senderEmail: senderEmail.trim() || undefined,
    });
  };
  return (
    <Section title="練習場 — 貼一條評論看我會怎麼回(不會公開發布)">
      <Card className="rounded-xl border-gray-200">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-4">
            <label className="text-xs font-semibold text-gray-700">評分:</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={`text-xl transition-transform ${
                    n <= rating ? "text-amber-500" : "text-gray-300"
                  }`}
                >
                  ★
                </button>
              ))}
              <span className="ml-2 text-xs text-gray-500 self-center">
                {rating}/5
              </span>
            </div>
            <label className="text-xs font-semibold text-gray-700 ml-4">
              客人 email (可選):
            </label>
            <Input
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              placeholder="lisa@example.com"
              className="rounded-lg text-xs max-w-xs"
            />
          </div>
          <Textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="貼上客戶評論原文,例如:&#10;&#10;這次黃石之旅整體不錯,行程安排很豐富。不過第二天的飯店有點老舊,熱水不太穩定..."
            className="min-h-[140px] rounded-lg text-xs"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400">
              {reviewText.length}/10000 字元
            </span>
            <Button
              onClick={run}
              disabled={reviewText.length < 5 || demo.isPending}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  思考中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  跑 ReviewAgent
                </>
              )}
            </Button>
          </div>
          {demo.error && <ErrorBox message={demo.error.message} />}
          {result && <ReviewResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function ReviewResult({ result }: { result: any }) {
  const d = result.decision;
  return (
    <div className="space-y-3 mt-2">
      <div
        className={`rounded-xl border-2 p-4 ${
          d.shouldEscalate
            ? "border-rose-200 bg-rose-50"
            : "border-emerald-200 bg-emerald-50"
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
              我的決定
            </div>
            <div
              className={`text-lg font-bold ${
                d.shouldEscalate ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {d.shouldEscalate ? "⚠ Escalate Jeff" : "✓ 自動公開回覆"}
            </div>
            {d.escalationReason && (
              <p className="text-xs text-rose-700 mt-1 italic">
                {d.escalationReason}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
              信心
            </div>
            <div className="text-2xl font-bold tabular-nums">{d.confidence}</div>
          </div>
        </div>
        <div className="mt-3 flex gap-2 flex-wrap">
          <Badge variant="secondary" className="rounded-md text-[10px]">
            {d.classification}
          </Badge>
          <Badge variant="secondary" className="rounded-md text-[10px]">
            {d.sentiment}
          </Badge>
          {d.themes.map((t: string) => (
            <Badge key={t} variant="outline" className="rounded-md text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      </div>
      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold">
            我會這樣公開回({d.draftLanguage})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <pre className="text-sm whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-4 leading-relaxed">
            {d.draftReply}
          </pre>
        </CardContent>
      </Card>
      <ReasoningCard reasoning={d.reasoning} meta={result} />
    </div>
  );
}
