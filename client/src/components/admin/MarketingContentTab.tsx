/**
 * MarketingContentTab — v78n Sprint 6B: admin UI for AI weekly social
 * content generation. One click → AI drafts IG/FB/小紅書 captions for top
 * featured tours. Admin reviews, edits, copies to platform.
 *
 * Workflow:
 *   1. Admin picks number of tours (1-5) + language + platforms
 *   2. Click "AI 生成" → ~30 seconds → drafts appear stacked by platform
 *   3. Admin clicks Copy on the one they like → paste into IG/FB/小紅書 admin
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import {
  Sparkles,
  Copy,
  Instagram,
  Facebook,
  Globe,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type Platform = "instagram" | "facebook" | "xiaohongshu";

interface SocialPostDraft {
  platform: Platform;
  tourId: number;
  tourTitle: string;
  caption: string;
  hashtags: string[];
  imageUrl?: string;
}

const platformConfig: Record<
  Platform,
  { label: string; icon: any; bg: string; text: string }
> = {
  instagram: {
    label: "Instagram",
    icon: Instagram,
    bg: "bg-pink-50 border-pink-200",
    text: "text-pink-700",
  },
  facebook: {
    label: "Facebook",
    icon: Facebook,
    bg: "bg-blue-50 border-blue-200",
    text: "text-blue-700",
  },
  xiaohongshu: {
    label: "小紅書",
    icon: Globe,
    bg: "bg-red-50 border-red-200",
    text: "text-red-700",
  },
};

export default function MarketingContentTab() {
  const [topN, setTopN] = useState(3);
  const [language, setLanguage] = useState<"zh-TW" | "en">("zh-TW");
  const [drafts, setDrafts] = useState<SocialPostDraft[]>([]);

  const generateMutation = trpc.marketingContent.generateWeekly.useMutation({
    onSuccess: (data) => {
      setDrafts(data.drafts);
      toast.success(`生成 ${data.drafts.length} 則草稿`);
    },
    onError: (err) => toast.error("生成失敗：" + err.message),
  });

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已複製到剪貼簿");
  };

  const groupedByTour = drafts.reduce<Record<number, SocialPostDraft[]>>(
    (acc, draft) => {
      if (!acc[draft.tourId]) acc[draft.tourId] = [];
      acc[draft.tourId].push(draft);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI 行銷內容生成</h2>
          <p className="text-sm text-gray-500 mt-1">
            一鍵為精選行程生成 Instagram / Facebook / 小紅書貼文草稿。檢查後直接複製貼到平台。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(topN)} onValueChange={(v) => setTopN(parseInt(v))}>
            <SelectTrigger className="w-32 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 個行程</SelectItem>
              <SelectItem value="2">2 個行程</SelectItem>
              <SelectItem value="3">3 個行程（建議）</SelectItem>
              <SelectItem value="5">5 個行程</SelectItem>
            </SelectContent>
          </Select>
          <Select value={language} onValueChange={(v) => setLanguage(v as any)}>
            <SelectTrigger className="w-28 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-TW">繁體中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
          <Button
            className="rounded-lg gap-1.5"
            disabled={generateMutation.isPending}
            onClick={() =>
              generateMutation.mutate({
                topN,
                language,
                platforms: ["instagram", "facebook", "xiaohongshu"],
              })
            }
          >
            {generateMutation.isPending ? (
              <>
                <Spinner className="h-4 w-4" />
                生成中… (~30 秒)
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                AI 生成本週貼文
              </>
            )}
          </Button>
        </div>
      </div>

      {drafts.length === 0 && !generateMutation.isPending && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Sparkles className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">
            點「AI 生成本週貼文」開始，AI 會為您挑選 Top {topN} 個精選行程，
            並為每個行程產出 IG / FB / 小紅書 三個版本的貼文。
          </p>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="space-y-8">
          {Object.entries(groupedByTour).map(([tourId, tourDrafts]) => (
            <div key={tourId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
                {tourDrafts[0].imageUrl && (
                  <img
                    src={tourDrafts[0].imageUrl}
                    alt={tourDrafts[0].tourTitle}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                )}
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">行程</p>
                  <h3 className="font-semibold text-gray-900">
                    {tourDrafts[0].tourTitle.split(/[|｜]/)[0].trim()}
                  </h3>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
                {tourDrafts.map((draft, i) => {
                  const cfg = platformConfig[draft.platform];
                  const Icon = cfg.icon;
                  const fullText = `${draft.caption}\n\n${draft.hashtags
                    .map((t) => `#${t}`)
                    .join(" ")}`;
                  return (
                    <div key={i} className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-bold border ${cfg.bg} ${cfg.text}`}>
                          <Icon className="h-3 w-3" />
                          {cfg.label}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-lg gap-1 h-7 text-xs"
                          onClick={() => copyText(fullText)}
                        >
                          <Copy className="h-3 w-3" />
                          複製
                        </Button>
                      </div>
                      <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap mb-3">
                        {draft.caption}
                      </div>
                      {draft.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-3 border-t border-gray-100">
                          {draft.hashtags.map((tag, j) => (
                            <span
                              key={j}
                              className="text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="text-center">
            <Button
              variant="outline"
              className="rounded-lg gap-1.5"
              onClick={() =>
                generateMutation.mutate({
                  topN,
                  language,
                  platforms: ["instagram", "facebook", "xiaohongshu"],
                })
              }
              disabled={generateMutation.isPending}
            >
              <RefreshCw className="h-4 w-4" />
              重新生成（換不同行程或角度）
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
