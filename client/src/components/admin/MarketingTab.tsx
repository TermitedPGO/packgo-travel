/**
 * MarketingTab.tsx
 * Admin UI for marketing automation:
 * - Campaign management (CRUD)
 * - AI social copy generator (FB/IG/LINE)
 * - Poster generator (landscape/square/story)
 * - Email newsletter sender
 * - Materials library
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Megaphone,
  Plus,
  Trash2,
  Copy,
  Image,
  Mail,
  Loader2,
  ExternalLink,
  RefreshCw,
  Send,
  Facebook,
  Instagram,
  MessageCircle,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────

type CampaignStatus = "draft" | "scheduled" | "sent" | "cancelled";
type CampaignType = "social_post" | "email_newsletter" | "poster";
type Platform = "facebook" | "instagram" | "line";
type PosterFormat = "landscape" | "square" | "story";
type Tone = "professional" | "casual" | "exciting" | "luxury";

interface Campaign {
  id: number;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  tourId?: number | null;
  subject?: string | null;
  scheduledAt?: number | null;
  createdAt: number;
}

// ── Status badge ───────────────────────────────────────────

const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-100 text-blue-700",
  sent: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "草稿",
  scheduled: "已排程",
  sent: "已發送",
  cancelled: "已取消",
};

const TYPE_LABELS: Record<CampaignType, string> = {
  social_post: "社群貼文",
  email_newsletter: "電子報",
  poster: "海報",
};

// ── Main Component ─────────────────────────────────────────

export default function MarketingTab() {
  const [activeSubTab, setActiveSubTab] = useState<"campaigns" | "copy" | "poster" | "newsletter">("campaigns");
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="w-6 h-6 text-teal-600" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">行銷自動化中心</h2>
            <p className="text-sm text-gray-500">管理行銷活動、AI 文案、海報生成與電子報發送</p>
          </div>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          新增活動
        </Button>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as typeof activeSubTab)}>
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="campaigns">活動管理</TabsTrigger>
          <TabsTrigger value="copy">社群文案</TabsTrigger>
          <TabsTrigger value="poster">海報生成</TabsTrigger>
          <TabsTrigger value="newsletter">電子報</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns">
          <CampaignsPanel
            selectedCampaign={selectedCampaign}
            onSelectCampaign={setSelectedCampaign}
          />
        </TabsContent>

        <TabsContent value="copy">
          <CopyGeneratorPanel />
        </TabsContent>

        <TabsContent value="poster">
          <PosterGeneratorPanel />
        </TabsContent>

        <TabsContent value="newsletter">
          <NewsletterPanel />
        </TabsContent>
      </Tabs>

      {/* Create Campaign Dialog */}
      <CreateCampaignDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </div>
  );
}

// ── Campaigns Panel ────────────────────────────────────────

function CampaignsPanel({
  selectedCampaign,
  onSelectCampaign,
}: {
  selectedCampaign: Campaign | null;
  onSelectCampaign: (c: Campaign | null) => void;
}) {
  const { data, isLoading, refetch } = trpc.marketing.listCampaigns.useQuery({ page: 1, pageSize: 50 });
  const deleteMutation = trpc.marketing.deleteCampaign.useMutation({
    onSuccess: () => { toast.success("活動已刪除"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const campaigns = (data as { campaigns?: Campaign[] })?.campaigns ?? [];

  return (
    <div className="space-y-4">
      {campaigns.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>尚無行銷活動，點擊「新增活動」開始</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">活動名稱</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">類型</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">狀態</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">建立時間</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.map((campaign) => (
                <tr
                  key={campaign.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => onSelectCampaign(campaign)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{campaign.name}</td>
                  <td className="px-4 py-3 text-gray-500">{TYPE_LABELS[campaign.type]}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[campaign.status]}`}>
                      {STATUS_LABELS[campaign.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(campaign.createdAt).toLocaleDateString("zh-TW")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("確定刪除此活動？")) {
                          deleteMutation.mutate({ campaignId: campaign.id });
                        }
                      }}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Copy Generator Panel ───────────────────────────────────

function CopyGeneratorPanel() {
  const [tourId, setTourId] = useState("");
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [tone, setTone] = useState<Tone>("professional");
  const [language, setLanguage] = useState<"zh-TW" | "en">("zh-TW");
  const [result, setResult] = useState<null | {
    mainCopy: string;
    hashtags: string[];
     cta: string;
    characterCount: number;
  }>(null);
  const generateMutation = trpc.marketing.generateCopy.useMutation({
    onSuccess: (data) => {
      // Map SocialCopyResult fields to local display format
      const mapped = {
        mainCopy: (data as any).copyText ?? (data as any).mainCopy ?? "",
        hashtags: (data as any).hashtags ?? [],
        cta: (data as any).callToAction ?? (data as any).cta ?? "",
        characterCount: ((data as any).copyText ?? (data as any).mainCopy ?? "").length,
      };
      setResult(mapped);
      toast.success("文案生成成功！");
    },
    onError: (e) => toast.error(`生成失敗：${e.message}`),
  });

  const platformIcons: Record<Platform, React.ReactNode> = {
    facebook: <Facebook className="w-4 h-4" />,
    instagram: <Instagram className="w-4 h-4" />,
    line: <MessageCircle className="w-4 h-4" />,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Config */}
      <div className="space-y-4 border border-gray-200 rounded-lg p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Copy className="w-4 h-4 text-teal-600" />
          AI 社群文案生成器
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">行程 ID</label>
            <Input
              type="number"
              placeholder="輸入行程 ID"
              value={tourId}
              onChange={(e) => setTourId(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">目標平台</label>
            <div className="flex gap-2">
              {(["facebook", "instagram", "line"] as Platform[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    platform === p
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-teal-400"
                  }`}
                >
                  {platformIcons[p]}
                  {p === "facebook" ? "Facebook" : p === "instagram" ? "Instagram" : "LINE"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">文案風格</label>
            <Select value={tone} onValueChange={(v) => setTone(v as Tone)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">專業正式</SelectItem>
                <SelectItem value="casual">輕鬆親切</SelectItem>
                <SelectItem value="exciting">熱情活潑</SelectItem>
                <SelectItem value="luxury">高端奢華</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">語言</label>
            <Select value={language} onValueChange={(v) => setLanguage(v as "zh-TW" | "en")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-TW">繁體中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => {
              if (!tourId) { toast.error("請輸入行程 ID"); return; }
              generateMutation.mutate({
                tourId: parseInt(tourId),
                platform,
                tone,
                language,
              });
            }}
            disabled={generateMutation.isPending}
            className="w-full"
          >
            {generateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />生成中...</>
            ) : (
              <><Copy className="w-4 h-4 mr-2" />生成文案</>
            )}
          </Button>
        </div>
      </div>

      {/* Right: Result */}
      <div className="border border-gray-200 rounded-lg p-5">
        <h3 className="font-semibold text-gray-900 mb-4">生成結果</h3>
        {!result ? (
          <div className="text-center py-12 text-gray-400">
            <Copy className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>填寫左側設定後點擊「生成文案」</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">主文案</label>
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap">
                {result.mainCopy}
              </div>
              <p className="text-xs text-gray-400 mt-1 text-right">{result.characterCount} 字</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Hashtags</label>
              <div className="flex flex-wrap gap-1">
                {result.hashtags.map((tag, i) => (
                  <span key={i} className="bg-teal-50 text-teal-700 text-xs px-2 py-1 rounded">{tag}</span>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">行動呼籲 (CTA)</label>
              <div className="bg-teal-50 rounded-lg p-3 text-sm text-teal-800 font-medium">
                {result.cta}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const text = `${result.mainCopy}\n\n${result.hashtags.join(" ")}\n\n${result.cta}`;
                navigator.clipboard.writeText(text);
                toast.success("已複製到剪貼簿");
              }}
              className="w-full"
            >
              <Copy className="w-4 h-4 mr-2" />
              複製全部
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Poster Generator Panel ─────────────────────────────────

function PosterGeneratorPanel() {
  const [tourId, setTourId] = useState("");
  const [format, setFormat] = useState<PosterFormat>("landscape");
  const [result, setResult] = useState<null | { s3Url: string; format: string; width: number; height: number }>(null);

  const generateMutation = trpc.marketing.generatePoster.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success("海報生成成功！");
    },
    onError: (e) => toast.error(`生成失敗：${e.message}`),
  });

  const formatInfo: Record<PosterFormat, { label: string; size: string; desc: string }> = {
    landscape: { label: "橫式", size: "1200×630", desc: "Facebook/OG 封面" },
    square: { label: "方形", size: "1080×1080", desc: "Instagram 貼文" },
    story: { label: "限動", size: "1080×1920", desc: "IG/LINE 限時動態" },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Config */}
      <div className="space-y-4 border border-gray-200 rounded-lg p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Image className="w-4 h-4 text-teal-600" />
          AI 海報生成器
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">行程 ID</label>
            <Input
              type="number"
              placeholder="輸入行程 ID"
              value={tourId}
              onChange={(e) => setTourId(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">海報尺寸</label>
            <div className="grid grid-cols-3 gap-2">
              {(["landscape", "square", "story"] as PosterFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex flex-col items-center p-3 rounded-lg border text-sm transition-colors ${
                    format === f
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-teal-400"
                  }`}
                >
                  <span className="font-semibold">{formatInfo[f].label}</span>
                  <span className="text-xs opacity-80">{formatInfo[f].size}</span>
                  <span className="text-xs opacity-60">{formatInfo[f].desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={() => {
              if (!tourId) { toast.error("請輸入行程 ID"); return; }
              generateMutation.mutate({ tourId: parseInt(tourId), format });
            }}
            disabled={generateMutation.isPending}
            className="w-full"
          >
            {generateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />生成中（約 15-30 秒）...</>
            ) : (
              <><Image className="w-4 h-4 mr-2" />生成海報</>
            )}
          </Button>
        </div>
      </div>

      {/* Right: Preview */}
      <div className="border border-gray-200 rounded-lg p-5">
        <h3 className="font-semibold text-gray-900 mb-4">海報預覽</h3>
        {!result ? (
          <div className="text-center py-12 text-gray-400">
            <Image className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>填寫左側設定後點擊「生成海報」</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <img
                src={result.s3Url}
                alt="Generated poster"
                className="w-full object-contain"
                style={{ maxHeight: "400px" }}
              />
            </div>
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{result.width}×{result.height}px</span>
              <a
                href={result.s3Url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-teal-600 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                開啟原圖
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Newsletter Panel ───────────────────────────────────────

function NewsletterPanel() {
  const [subject, setSubject] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [campaignId, setCampaignId] = useState("");

  const { data: statsData } = trpc.marketing.subscriberStats.useQuery();
  const sendMutation = trpc.marketing.sendNewsletter.useMutation({
    onSuccess: (data) => {
      const r = data as { sent?: number; failed?: number };
      toast.success(`電子報發送完成！成功 ${r.sent ?? 0} 封，失敗 ${r.failed ?? 0} 封`);
      setSubject("");
      setHtmlContent("");
    },
    onError: (e) => toast.error(`發送失敗：${e.message}`),
  });

  return (
    <div className="space-y-6">
      {/* Subscriber stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-teal-600">{statsData?.active ?? 0}</p>
          <p className="text-sm text-gray-500 mt-1">有效訂閱者</p>
        </div>
        <div className="border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-gray-700">{statsData?.total ?? 0}</p>
          <p className="text-sm text-gray-500 mt-1">總訂閱者</p>
        </div>
      </div>

      {/* Compose */}
      <div className="border border-gray-200 rounded-lg p-5 space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Mail className="w-4 h-4 text-teal-600" />
          撰寫電子報
        </h3>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">活動 ID（選填）</label>
          <Input
            type="number"
            placeholder="關聯到現有活動"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">郵件主旨</label>
          <Input
            placeholder="例：【PACK&GO】日本東京 5 天 4 夜限時優惠"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">HTML 內容</label>
          <Textarea
            placeholder="輸入 HTML 格式的電子報內容..."
            value={htmlContent}
            onChange={(e) => setHtmlContent(e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
        </div>

        <Button
          onClick={() => {
            if (!subject) { toast.error("請輸入郵件主旨"); return; }
            if (!htmlContent) { toast.error("請輸入電子報內容"); return; }
            if (!campaignId) { toast.error("請輸入活動 ID"); return; }
            if (!confirm(`確定發送給 ${statsData?.active ?? 0} 位訂閱者？`)) return;
            sendMutation.mutate({
              campaignId: parseInt(campaignId),
              subject,
              htmlContent,
            });
          }}
          disabled={sendMutation.isPending}
          className="w-full"
        >
          {sendMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />發送中...</>
          ) : (
            <><Send className="w-4 h-4 mr-2" />發送電子報</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Create Campaign Dialog ─────────────────────────────────

function CreateCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("social_post");
  const [tourId, setTourId] = useState("");
  const [subject, setSubject] = useState("");

  const utils = trpc.useUtils();
  const createMutation = trpc.marketing.createCampaign.useMutation({
    onSuccess: () => {
      toast.success("活動已建立");
      utils.marketing.listCampaigns.invalidate();
      onClose();
      setName("");
      setType("social_post");
      setTourId("");
      setSubject("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新增行銷活動</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">活動名稱</label>
            <Input
              placeholder="例：2025 春季日本行銷活動"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">活動類型</label>
            <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="social_post">社群貼文</SelectItem>
                <SelectItem value="email_newsletter">電子報</SelectItem>
                <SelectItem value="poster">海報</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">關聯行程 ID（選填）</label>
            <Input
              type="number"
              placeholder="輸入行程 ID"
              value={tourId}
              onChange={(e) => setTourId(e.target.value)}
            />
          </div>

          {type === "email_newsletter" && (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">郵件主旨（選填）</label>
              <Input
                placeholder="電子報主旨"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={() => {
              if (!name) { toast.error("請輸入活動名稱"); return; }
              createMutation.mutate({
                name,
                type,
                tourId: tourId ? parseInt(tourId) : undefined,
                subject: subject || undefined,
              });
            }}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "建立"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
