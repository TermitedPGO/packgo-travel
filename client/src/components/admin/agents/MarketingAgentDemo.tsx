/**
 * MarketingAgentDemo — given a segment + topic, the agent drafts an EDM
 * (Phase 5 module 5B). Verbatim cut from AutonomousAgentsTab.tsx.
 *
 * NOTE: This demo is not currently mounted (Marketing's desk card is hidden
 * — UI lives in the Marketing domain). Component retained for completeness
 * + so the entry orchestrator can re-mount it via feature flag in v2.
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

export function MarketingAgentDemo() {
  const [segment, setSegment] = useState("");
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState<"zh-TW" | "zh-CN" | "en">("zh-TW");
  const [additionalContext, setAdditionalContext] = useState("");
  const [result, setResult] = useState<any>(null);
  const utils = trpc.useUtils();
  const demo = trpc.agent.demoMarketing.useMutation({
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
      segment,
      topic,
      language,
      additionalContext: additionalContext || undefined,
    });
  };
  return (
    <Section title="練習場 — 給 segment + 主題,我寫一封 EDM">
      <Card className="rounded-xl border-gray-200">
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                目標 segment
              </label>
              <Input
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="例:首次詢問未下訂、去年來過西雅圖的客戶"
                className="rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                推廣主題
              </label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例:黃石公園夏季團、感恩節長週末紐約"
                className="rounded-lg text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-gray-700">語言:</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
            >
              <option value="zh-TW">繁體中文</option>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <Textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="(可選)補充資訊 — 例如客戶痛點、特殊優惠、行程亮點"
            className="min-h-[80px] rounded-lg text-xs"
          />
          <div className="flex items-center justify-end">
            <Button
              onClick={run}
              disabled={!segment || !topic || demo.isPending}
              className="rounded-lg gap-2"
            >
              {demo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  寫信中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  寫 EDM
                </>
              )}
            </Button>
          </div>
          {demo.error && <ErrorBox message={demo.error.message} />}
          {result && <MarketingResult result={result} />}
        </CardContent>
      </Card>
    </Section>
  );
}

function MarketingResult({ result }: { result: any }) {
  const d = result.decision;
  return (
    <div className="space-y-3 mt-2">
      <Card className="rounded-xl border-purple-200 bg-purple-50/30">
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              主旨
            </div>
            <div className="font-bold text-gray-900">{d.subject}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              Preheader (gmail 預覽文字)
            </div>
            <div className="text-sm text-gray-700 italic">{d.preheader}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
              內文
            </div>
            <pre className="text-sm whitespace-pre-wrap font-sans bg-white rounded-lg p-4 leading-relaxed border border-purple-100">
              {d.body}
            </pre>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <Badge variant="secondary" className="rounded-md">
              CTA: {d.callToAction}
            </Badge>
            <Badge variant="outline" className="rounded-md">
              閱讀時間: {d.estimatedReadingTime}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-md ml-auto tabular-nums"
            >
              信心 {d.confidence}
            </Badge>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-xl border-gray-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold">
            我的公平自我檢查
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-xs text-gray-700 italic">
          {d.fairnessCheck}
        </CardContent>
      </Card>
      <ReasoningCard reasoning={d.reasoning} meta={result} />
    </div>
  );
}
