/**
 * FollowupAgentDemo — given a stage + context, the agent drafts a follow-up
 * message (Phase 5 module 5B). Verbatim cut from AutonomousAgentsTab.tsx.
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

export function FollowupAgentDemo() {
  const [stage, setStage] = useState<
    "pre_departure" | "mid_trip" | "post_trip"
  >("pre_departure");
  const [daysFromStart, setDaysFromStart] = useState(-3);
  const [customerName, setCustomerName] = useState("");
  const [destinationSummary, setDestinationSummary] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [language, setLanguage] = useState<"zh-TW" | "zh-CN" | "en">("zh-TW");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const demo = trpc.agent.demoFollowup.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.agent.recentActivity.invalidate();
      utils.agent.agentOffice.invalidate();
      utils.agent.officeOverview.invalidate();
    },
  });
  const run = () => {
    setResult(null);
    demo.mutate({
      stage,
      daysFromStart,
      customerName: customerName.trim() || undefined,
      destinationSummary,
      bookingNotes: bookingNotes.trim() || undefined,
      language,
      isFirstFollowup: true,
    });
  };
  return (
    <Section title="練習場 — 給情境,我寫一則關懷訊息">
      <Card className="rounded-xl border-gray-200">
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                階段
              </label>
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value as any);
                  setDaysFromStart(
                    e.target.value === "pre_departure"
                      ? -3
                      : e.target.value === "mid_trip"
                      ? 3
                      : 7
                  );
                }}
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="pre_departure">出發前</option>
                <option value="mid_trip">旅途中</option>
                <option value="post_trip">回國後</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                距出發 {daysFromStart < 0 ? "天前" : "天後"}
              </label>
              <Input
                type="number"
                value={daysFromStart}
                onChange={(e) => setDaysFromStart(Number(e.target.value))}
                className="rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                語言
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as any)}
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="zh-TW">繁體中文</option>
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                客人姓名 (可選)
              </label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="王太太"
                className="rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                目的地摘要
              </label>
              <Input
                value={destinationSummary}
                onChange={(e) => setDestinationSummary(e.target.value)}
                placeholder="黃石公園 10 日 / 紐約 7 日"
                className="rounded-lg text-xs"
              />
            </div>
          </div>
          <Textarea
            value={bookingNotes}
            onChange={(e) => setBookingNotes(e.target.value)}
            placeholder="(可選)訂單備註 — 例如小孩年齡、特殊飲食、紀念日"
            className="min-h-[60px] rounded-lg text-xs"
          />
          <div className="flex items-center justify-end">
            <Button
              onClick={run}
              disabled={!destinationSummary || demo.isPending}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  寫中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  寫關懷訊息
                </>
              )}
            </Button>
          </div>
          {demo.error && <ErrorBox message={demo.error.message} />}
          {result && <FollowupResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function FollowupResult({ result }: { result: any }) {
  const d = result.decision;
  return (
    <div className="space-y-3 mt-2">
      <Card className="rounded-xl border-amber-200 bg-amber-50/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge className="rounded-md">{d.channel}</Badge>
            {d.subject && (
              <span className="text-sm font-bold text-gray-900">
                主旨:{d.subject}
              </span>
            )}
            <Badge variant="outline" className="rounded-md ml-auto tabular-nums">
              信心 {d.confidence}
            </Badge>
          </div>
          <pre className="text-sm whitespace-pre-wrap font-sans bg-white rounded-lg p-4 leading-relaxed border border-amber-100">
            {d.body}
          </pre>
        </CardContent>
      </Card>
      <ReasoningCard reasoning={d.reasoning} meta={result} />
    </div>
  );
}
