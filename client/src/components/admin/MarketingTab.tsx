/**
 * MarketingTab.tsx
 * Admin UI for marketing automation:
 * - Campaign management (CRUD)
 * - AI social copy generator (FB/IG/LINE)
 * - Poster generator (landscape/square/story)
 * - Email newsletter sender
 * - Materials library
 */

import { useMemo, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
  Send,
  Facebook,
  Instagram,
  MessageCircle,
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

const STATUS_KEYS: Record<CampaignStatus, string> = {
  draft: "statusDraft",
  scheduled: "statusScheduled",
  sent: "statusSent",
  cancelled: "statusCancelled",
};

const TYPE_KEYS: Record<CampaignType, string> = {
  social_post: "typeSocialPost",
  email_newsletter: "typeEmailNewsletter",
  poster: "typePoster",
};

// ── Main Component ─────────────────────────────────────────

export default function MarketingTab() {
  const { t } = useLocale();
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
            <h2 className="text-xl font-bold text-gray-900">{t("admin.marketing.pageTitle")}</h2>
            <p className="text-sm text-gray-500">{t("admin.marketing.pageDesc")}</p>
          </div>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="flex items-center gap-2 rounded-lg">
          <Plus className="w-4 h-4" />
          {t("admin.marketing.addCampaign")}
        </Button>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as typeof activeSubTab)}>
        <TabsList className="grid grid-cols-4 w-full max-w-xl rounded-lg">
          <TabsTrigger value="campaigns">{t("admin.marketing.tabCampaigns")}</TabsTrigger>
          <TabsTrigger value="copy">{t("admin.marketing.tabCopy")}</TabsTrigger>
          <TabsTrigger value="poster">{t("admin.marketing.tabPoster")}</TabsTrigger>
          <TabsTrigger value="newsletter">{t("admin.marketing.tabNewsletter")}</TabsTrigger>
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
  selectedCampaign: _selectedCampaign,
  onSelectCampaign,
}: {
  selectedCampaign: Campaign | null;
  onSelectCampaign: (c: Campaign | null) => void;
}) {
  const { t, language } = useLocale();
  const { data, isLoading, refetch } = trpc.marketing.listCampaigns.useQuery({ page: 1, pageSize: 50 });
  const deleteMutation = trpc.marketing.deleteCampaign.useMutation({
    onSuccess: () => { toast.success(t("admin.marketing.toastCampaignDeleted")); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const campaigns = (data as { campaigns?: Campaign[] })?.campaigns ?? [];
  const locale = language === "en" ? "en-US" : "zh-TW";

  return (
    <div className="space-y-4">
      {campaigns.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{t("admin.marketing.emptyCampaigns")}</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("admin.marketing.colCampaignName")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("admin.marketing.colType")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("admin.marketing.colStatus")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("admin.marketing.colCreatedAt")}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">{t("admin.marketing.colActions")}</th>
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
                  <td className="px-4 py-3 text-gray-500">{t(`admin.marketing.${TYPE_KEYS[campaign.type]}`)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-md text-xs font-medium ${STATUS_COLORS[campaign.status]}`}>
                      {t(`admin.marketing.${STATUS_KEYS[campaign.status]}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(campaign.createdAt).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(t("admin.marketing.confirmDeleteCampaign"))) {
                          deleteMutation.mutate({ campaignId: campaign.id });
                        }
                      }}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md"
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
  const { t } = useLocale();
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
      toast.success(t("admin.marketing.toastCopyGenerated"));
    },
    onError: (e) => toast.error(t("admin.marketing.toastGenerateFailedWithMsg", { msg: e.message })),
  });

  const platformIcons: Record<Platform, React.ReactNode> = {
    facebook: <Facebook className="w-4 h-4" />,
    instagram: <Instagram className="w-4 h-4" />,
    line: <MessageCircle className="w-4 h-4" />,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Config */}
      <div className="space-y-4 border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Copy className="w-4 h-4 text-teal-600" />
          {t("admin.marketing.copyGeneratorTitle")}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.tourIdLabel")}</label>
            <Input
              type="number"
              placeholder={t("admin.marketing.tourIdPlaceholder")}
              value={tourId}
              onChange={(e) => setTourId(e.target.value)}
              className="rounded-lg"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.targetPlatform")}</label>
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
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.copyTone")}</label>
            <Select value={tone} onValueChange={(v) => setTone(v as Tone)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">{t("admin.marketing.toneProfessional")}</SelectItem>
                <SelectItem value="casual">{t("admin.marketing.toneCasual")}</SelectItem>
                <SelectItem value="exciting">{t("admin.marketing.toneExciting")}</SelectItem>
                <SelectItem value="luxury">{t("admin.marketing.toneLuxury")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.language")}</label>
            <Select value={language} onValueChange={(v) => setLanguage(v as "zh-TW" | "en")}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-TW">{t("admin.marketing.langZhTW")}</SelectItem>
                <SelectItem value="en">{t("admin.marketing.langEn")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => {
              if (!tourId) { toast.error(t("admin.marketing.tourIdRequired")); return; }
              generateMutation.mutate({
                tourId: parseInt(tourId),
                platform,
                tone,
                language,
              });
            }}
            disabled={generateMutation.isPending}
            className="w-full rounded-lg"
          >
            {generateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t("admin.marketing.generating")}</>
            ) : (
              <><Copy className="w-4 h-4 mr-2" />{t("admin.marketing.generateCopy")}</>
            )}
          </Button>
        </div>
      </div>

      {/* Right: Result */}
      <div className="border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-4">{t("admin.marketing.generationResult")}</h3>
        {!result ? (
          <div className="text-center py-12 text-gray-400">
            <Copy className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>{t("admin.marketing.configFirstCopy")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">{t("admin.marketing.mainCopy")}</label>
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap">
                {result.mainCopy}
              </div>
              <p className="text-xs text-gray-400 mt-1 text-right">
                {t("admin.marketing.charCount", { n: String(result.characterCount) })}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Hashtags</label>
              <div className="flex flex-wrap gap-1">
                {result.hashtags.map((tag, i) => (
                  <span key={i} className="bg-teal-50 text-teal-700 text-xs px-2 py-1 rounded-md">{tag}</span>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">{t("admin.marketing.ctaLabel")}</label>
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
                toast.success(t("admin.marketing.copiedToClipboard"));
              }}
              className="w-full rounded-lg"
            >
              <Copy className="w-4 h-4 mr-2" />
              {t("admin.marketing.copyAll")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Poster Generator Panel ─────────────────────────────────

function PosterGeneratorPanel() {
  const { t } = useLocale();
  const [tourId, setTourId] = useState("");
  const [format, setFormat] = useState<PosterFormat>("landscape");
  const [result, setResult] = useState<null | { s3Url: string; format: string; width: number; height: number }>(null);

  const generateMutation = trpc.marketing.generatePoster.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success(t("admin.marketing.toastPosterGenerated"));
    },
    onError: (e) => toast.error(t("admin.marketing.toastGenerateFailedWithMsg", { msg: e.message })),
  });

  const formatInfo = useMemo<Record<PosterFormat, { label: string; size: string; desc: string }>>(() => ({
    landscape: { label: t("admin.marketing.formatLandscape"), size: "1200×630", desc: t("admin.marketing.formatLandscapeDesc") },
    square: { label: t("admin.marketing.formatSquare"), size: "1080×1080", desc: t("admin.marketing.formatSquareDesc") },
    story: { label: t("admin.marketing.formatStory"), size: "1080×1920", desc: t("admin.marketing.formatStoryDesc") },
  }), [t]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Config */}
      <div className="space-y-4 border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Image className="w-4 h-4 text-teal-600" />
          {t("admin.marketing.posterGeneratorTitle")}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.tourIdLabel")}</label>
            <Input
              type="number"
              placeholder={t("admin.marketing.tourIdPlaceholder")}
              value={tourId}
              onChange={(e) => setTourId(e.target.value)}
              className="rounded-lg"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.posterFormat")}</label>
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
              if (!tourId) { toast.error(t("admin.marketing.tourIdRequired")); return; }
              generateMutation.mutate({ tourId: parseInt(tourId), format });
            }}
            disabled={generateMutation.isPending}
            className="w-full rounded-lg"
          >
            {generateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t("admin.marketing.posterGenerating")}</>
            ) : (
              <><Image className="w-4 h-4 mr-2" />{t("admin.marketing.generatePoster")}</>
            )}
          </Button>
        </div>
      </div>

      {/* Right: Preview */}
      <div className="border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-4">{t("admin.marketing.posterPreview")}</h3>
        {!result ? (
          <div className="text-center py-12 text-gray-400">
            <Image className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>{t("admin.marketing.configFirstPoster")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <img
                src={result.s3Url}
                alt="Generated poster"
                className="w-full object-contain rounded-xl"
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
                {t("admin.marketing.openOriginal")}
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
  const { t } = useLocale();
  const [subject, setSubject] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [campaignId, setCampaignId] = useState("");

  const { data: statsData } = trpc.marketing.subscriberStats.useQuery();
  const sendMutation = trpc.marketing.sendNewsletter.useMutation({
    onSuccess: (data) => {
      const r = data as { sent?: number; failed?: number };
      toast.success(t("admin.marketing.toastNewsletterSent", {
        sent: String(r.sent ?? 0),
        failed: String(r.failed ?? 0),
      }));
      setSubject("");
      setHtmlContent("");
    },
    onError: (e) => toast.error(t("admin.marketing.toastSendFailed", { msg: e.message })),
  });

  return (
    <div className="space-y-6">
      {/* Subscriber stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-teal-600">{statsData?.active ?? 0}</p>
          <p className="text-sm text-gray-500 mt-1">{t("admin.marketing.activeSubs")}</p>
        </div>
        <div className="border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-gray-700">{statsData?.total ?? 0}</p>
          <p className="text-sm text-gray-500 mt-1">{t("admin.marketing.totalSubs")}</p>
        </div>
      </div>

      {/* Compose */}
      <div className="border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Mail className="w-4 h-4 text-teal-600" />
          {t("admin.marketing.composeNewsletter")}
        </h3>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.campaignIdOptional")}</label>
          <Input
            type="number"
            placeholder={t("admin.marketing.linkToCampaign")}
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="rounded-lg"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.emailSubject")}</label>
          <Input
            placeholder={t("admin.marketing.subjectPlaceholder")}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-lg"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.htmlContent")}</label>
          <Textarea
            placeholder={t("admin.marketing.htmlContentPlaceholder")}
            value={htmlContent}
            onChange={(e) => setHtmlContent(e.target.value)}
            rows={10}
            className="font-mono text-sm rounded-lg"
          />
        </div>

        <Button
          onClick={() => {
            if (!subject) { toast.error(t("admin.marketing.subjectRequired")); return; }
            if (!htmlContent) { toast.error(t("admin.marketing.contentRequired")); return; }
            if (!campaignId) { toast.error(t("admin.marketing.campaignIdRequired")); return; }
            if (!confirm(t("admin.marketing.confirmSendPrompt", { n: String(statsData?.active ?? 0) }))) return;
            sendMutation.mutate({
              campaignId: parseInt(campaignId),
              subject,
              htmlContent,
            });
          }}
          disabled={sendMutation.isPending}
          className="w-full rounded-lg"
        >
          {sendMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t("admin.marketing.sending")}</>
          ) : (
            <><Send className="w-4 h-4 mr-2" />{t("admin.marketing.sendNewsletter")}</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Create Campaign Dialog ─────────────────────────────────

function CreateCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("social_post");
  const [tourId, setTourId] = useState("");
  const [subject, setSubject] = useState("");

  const utils = trpc.useUtils();
  const createMutation = trpc.marketing.createCampaign.useMutation({
    onSuccess: () => {
      toast.success(t("admin.marketing.toastCampaignCreated"));
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
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>{t("admin.marketing.createCampaignTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.colCampaignName")}</label>
            <Input
              placeholder={t("admin.marketing.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.campaignType")}</label>
            <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="social_post">{t("admin.marketing.typeSocialPost")}</SelectItem>
                <SelectItem value="email_newsletter">{t("admin.marketing.typeEmailNewsletter")}</SelectItem>
                <SelectItem value="poster">{t("admin.marketing.typePoster")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.associatedTourId")}</label>
            <Input
              type="number"
              placeholder={t("admin.marketing.tourIdPlaceholder")}
              value={tourId}
              onChange={(e) => setTourId(e.target.value)}
              className="rounded-lg"
            />
          </div>

          {type === "email_newsletter" && (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">{t("admin.marketing.subjectOptional")}</label>
              <Input
                placeholder={t("admin.marketing.newsletterSubject")}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="rounded-lg"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg">{t("admin.marketing.cancel")}</Button>
          <Button
            className="rounded-lg"
            onClick={() => {
              if (!name) { toast.error(t("admin.marketing.nameRequired")); return; }
              createMutation.mutate({
                name,
                type,
                tourId: tourId ? parseInt(tourId) : undefined,
                subject: subject || undefined,
              });
            }}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("admin.marketing.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
