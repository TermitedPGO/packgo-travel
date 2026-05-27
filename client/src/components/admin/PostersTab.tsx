/**
 * PostersTab — Round 80.22 Phase H2 admin UI for supplier poster distribution.
 *
 * Workflow:
 *   1. Upload supplier poster (raw screenshot from WeChat)
 *   2. Backend processes: AI Vision → gpt-image-2 brands it → 7 platform copies
 *   3. Admin reviews side-by-side (original vs branded)
 *   4. Admin edits each platform copy individually + approves
 *   5. Distribution: copy text + download branded image, mark each platform "posted"
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
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
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LoadingRow } from "@/components/ui/spinner";
import {
  Megaphone,
  Upload,
  Loader2,
  Copy,
  Check,
  CheckCircle2,
  RefreshCw,
  Download,
  Trash2,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

const VENDOR_KEY: Record<string, string> = {
  lion: "admin.posters.vendorLionLabel",
  zongheng: "admin.posters.vendorZonghengLabel",
  house: "admin.posters.vendorHouseLabel",
  other: "admin.posters.vendorOtherLabel",
};
const AUDIENCE_KEY: Record<string, string> = {
  family: "admin.posters.audienceFamilyLabel",
  honeymoon: "admin.posters.audienceHoneymoonLabel",
  parent_child: "admin.posters.audienceParentChildLabel",
  business: "admin.posters.audienceBusinessLabel",
  senior: "admin.posters.audienceSeniorLabel",
  general: "admin.posters.audienceGeneralLabel",
};
const PLATFORM_KEY: Record<string, string> = {
  wechat_moments: "admin.posters.platformWechatMoments",
  wechat_group: "admin.posters.platformWechatGroup",
  xiaohongshu: "admin.posters.platformXiaohongshu",
  line: "admin.posters.platformLine",
  facebook: "admin.posters.platformFacebook",
  instagram: "admin.posters.platformInstagram",
  newsletter: "admin.posters.platformNewsletter",
};
const STATUS_KEY: Record<string, string> = {
  uploaded: "admin.posters.statusUploaded",
  processing: "admin.posters.statusProcessing",
  ready: "admin.posters.statusReady",
  approved: "admin.posters.statusApproved",
  distributed: "admin.posters.statusDistributed",
  archived: "admin.posters.statusArchived",
  failed: "admin.posters.statusFailed",
};
const STATUS_CLASS: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  processing: "bg-blue-100 text-blue-800",
  ready: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  distributed: "bg-[#c9a563]/20 text-[#8a6f3a]",
  archived: "bg-gray-100 text-gray-500",
  failed: "bg-red-100 text-red-800",
};

export default function PostersTab() {
  const { t } = useLocale();
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-[#c9a563]" />
            {t("admin.posters.title")}
          </h2>
          <p className="text-sm text-foreground/60 mt-1">
            {t("admin.posters.subtitle")}
          </p>
        </div>
      </div>

      {view === "list" ? (
        <PosterList onOpen={(id) => { setSelectedId(id); setView("detail"); }} />
      ) : selectedId ? (
        <PosterDetail
          id={selectedId}
          onBack={() => { setView("list"); setSelectedId(null); }}
        />
      ) : null}
    </div>
  );
}

/* ──────────────── List view ──────────────── */

function PosterList({ onOpen }: { onOpen: (id: number) => void }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.posters.list.useQuery({ status: "all", limit: 30 });
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <PosterComposer
        onCreated={(id) => {
          utils.posters.list.invalidate();
          onOpen(id);
        }}
      />

      <Card>
        <CardContent className="p-6">
          <h3 className="font-semibold mb-4">{t("admin.posters.historyTitle")}</h3>

          {isLoading ? (
            <LoadingRow />
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-foreground/50 text-sm">
              <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
              {t("admin.posters.emptyMessage")}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpen(p.id)}
                  className="text-left bg-white border border-foreground/10 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="aspect-[3/4] bg-gray-50 flex items-center justify-center overflow-hidden relative">
                    {p.brandedImageUrl ? (
                      <img src={p.brandedImageUrl} alt="" className="w-full h-full object-cover rounded-xl" />
                    ) : p.originalImageUrl ? (
                      <img src={p.originalImageUrl} alt="" className="w-full h-full object-cover opacity-60 rounded-xl" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-gray-300" />
                    )}
                    <span className={`absolute top-2 right-2 px-2 py-0.5 text-[10px] rounded ${STATUS_CLASS[p.status] ?? ""}`}>
                      {STATUS_KEY[p.status] ? t(STATUS_KEY[p.status]) : p.status}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-foreground/50">{VENDOR_KEY[p.sourceVendor] ? t(VENDOR_KEY[p.sourceVendor]) : p.sourceVendor}</p>
                    <p className="text-sm font-semibold truncate mt-0.5">
                      {p.title || t("admin.posters.processing")}
                    </p>
                    <p className="text-[10px] text-foreground/40 mt-0.5">
                      {new Date(p.createdAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ──────────────── Composer (inline, 2-field) ──────────────── */

function PosterComposer({ onCreated }: { onCreated: (id: number) => void }) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [originalCopy, setOriginalCopy] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [vendor, setVendor] = useState<"lion" | "zongheng" | "house" | "other">("other");
  const [audience, setAudience] = useState<
    "family" | "honeymoon" | "parent_child" | "business" | "senior" | "general"
  >("general");
  const [title, setTitle] = useState("");

  const createMutation = trpc.posters.create.useMutation({
    onSuccess: (res) => {
      toast.success(t("admin.posters.toastGenerateStart"));
      // Reset for next round so Jeff can chain inputs
      setImageUrl(null);
      setOriginalCopy("");
      setTitle("");
      setSubmitting(false);
      onCreated(res.id);
    },
    onError: (e) => {
      toast.error(e.message);
      setSubmitting(false);
    },
  });

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/upload/image", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      setImageUrl(url);
    } catch (err: any) {
      toast.error(t("admin.posters.toastUploadFail") + (err?.message || "unknown"));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!imageUrl) {
      toast.error(t("admin.posters.toastImageRequired"));
      return;
    }
    setSubmitting(true);
    createMutation.mutate({
      originalImageUrl: imageUrl,
      originalCopyText: originalCopy.trim() || undefined,
      sourceVendor: vendor,
      targetAudience: audience,
      title: title.trim() || undefined,
    });
  };

  const hasAdvancedOverrides =
    vendor !== "other" || audience !== "general" || title.trim().length > 0;

  return (
    <Card className="border-foreground/15">
      <CardContent className="p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-base">{t("admin.posters.composerTitle")}</h3>
          <p className="text-xs text-foreground/55 mt-0.5">
            {t("admin.posters.composerSubtitle")}
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
        />

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3">
          {/* Image drop zone */}
          {imageUrl ? (
            <div className="relative">
              <img
                src={imageUrl}
                alt={t("admin.posters.originalPoster")}
                className="w-full h-48 md:h-full object-cover rounded-lg border border-foreground/10"
              />
              <button
                onClick={() => setImageUrl(null)}
                className="absolute top-1.5 right-1.5 bg-black/70 text-white p-1 rounded-md hover:bg-black"
                aria-label={t("admin.posters.removeImage")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full h-48 md:h-full min-h-[160px] flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-foreground/20 hover:border-foreground/40 hover:bg-foreground/[0.02] transition-colors text-foreground/60"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-xs">{t("admin.posters.uploading")}</span>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">{t("admin.posters.uploadHint")}</span>
                </>
              )}
            </button>
          )}

          {/* Copy textarea */}
          <Textarea
            value={originalCopy}
            onChange={(e) => setOriginalCopy(e.target.value)}
            placeholder={t("admin.posters.copyTextareaPlaceholder")}
            className="rounded-lg text-sm resize-none min-h-[160px] md:min-h-full"
            maxLength={10_000}
          />
        </div>

        {/* Advanced disclosure */}
        <div className="border-t border-foreground/10 pt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs text-foreground/55 hover:text-foreground/80 inline-flex items-center gap-1"
          >
            {t("admin.posters.advancedSettings")}
            {hasAdvancedOverrides && !advancedOpen && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10">
                {t("admin.posters.adjusted")}
              </span>
            )}
            <span className="text-[10px]">{advancedOpen ? "▴" : "▾"}</span>
          </button>

          {advancedOpen && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-foreground/70">{t("admin.posters.vendorLabel")}</label>
                <Select value={vendor} onValueChange={(v: any) => setVendor(v)}>
                  <SelectTrigger className="mt-1 rounded-lg h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="other">{t("admin.posters.vendorOther")}</SelectItem>
                    <SelectItem value="lion">{t("admin.posters.vendorLion")}</SelectItem>
                    <SelectItem value="zongheng">{t("admin.posters.vendorZongheng")}</SelectItem>
                    <SelectItem value="house">{t("admin.posters.vendorHouse")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-foreground/70">{t("admin.posters.audienceLabel")}</label>
                <Select value={audience} onValueChange={(v: any) => setAudience(v)}>
                  <SelectTrigger className="mt-1 rounded-lg h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">{t("admin.posters.audienceGeneral")}</SelectItem>
                    <SelectItem value="family">{t("admin.posters.audienceFamily")}</SelectItem>
                    <SelectItem value="honeymoon">{t("admin.posters.audienceHoneymoon")}</SelectItem>
                    <SelectItem value="parent_child">{t("admin.posters.audienceParentChild")}</SelectItem>
                    <SelectItem value="business">{t("admin.posters.audienceBusiness")}</SelectItem>
                    <SelectItem value="senior">{t("admin.posters.audienceSenior")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-foreground/70">{t("admin.posters.titleLabel")}</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("admin.posters.titlePlaceholder")}
                  className="mt-1 rounded-lg h-9 text-sm"
                  maxLength={500}
                />
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={!imageUrl || submitting}
            className="rounded-lg bg-foreground hover:bg-foreground/90 text-white"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            {t("admin.posters.generateButton")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ──────────────── Detail / review view ──────────────── */

function PosterDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  // Poll while processing — stop once status is terminal
  const { data, isLoading } = trpc.posters.get.useQuery(
    { id },
    {
      refetchInterval: (q) => {
        const s = (q.state.data as any)?.poster?.status;
        return s === "processing" || s === "uploaded" ? 3000 : false;
      },
    }
  );

  const regenerateMutation = trpc.posters.regenerateImage.useMutation({
    onSuccess: () => {
      toast.success(t("admin.posters.toastRegenerateStart"));
      utils.posters.get.invalidate({ id });
    },
    onError: (e) => toast.error(e.message),
  });
  const approveMutation = trpc.posters.approve.useMutation({
    onSuccess: () => {
      toast.success(t("admin.posters.toastApproved"));
      utils.posters.get.invalidate({ id });
    },
    onError: (e) => toast.error(e.message),
  });
  const archiveMutation = trpc.posters.archive.useMutation({
    onSuccess: () => {
      toast.success(t("admin.posters.toastArchived"));
      onBack();
    },
  });

  if (isLoading) return <LoadingRow />;
  if (!data) return <p className="text-foreground/50">{t("admin.posters.posterNotFound")}</p>;

  const { poster, copies } = data;
  const isProcessing = poster.status === "processing" || poster.status === "uploaded";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onBack} className="rounded-lg" size="sm">
            {t("admin.posters.backToList")}
          </Button>
          <div>
            <h3 className="text-xl font-bold">{poster.title || t("admin.posters.processing")}</h3>
            <p className="text-xs text-foreground/60 mt-0.5">
              {VENDOR_KEY[poster.sourceVendor] ? t(VENDOR_KEY[poster.sourceVendor]) : poster.sourceVendor} · {AUDIENCE_KEY[poster.targetAudience] ? t(AUDIENCE_KEY[poster.targetAudience]) : poster.targetAudience} ·{" "}
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLASS[poster.status] ?? ""}`}>
                {STATUS_KEY[poster.status] ? t(STATUS_KEY[poster.status]) : poster.status}
              </span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {(poster.status === "ready" || poster.status === "approved") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => regenerateMutation.mutate({ id })}
              disabled={regenerateMutation.isPending}
              className="rounded-lg"
            >
              {regenerateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {t("admin.posters.regenerateImage")}
            </Button>
          )}
          {poster.status === "ready" && (
            <Button
              size="sm"
              onClick={() => approveMutation.mutate({ id })}
              disabled={approveMutation.isPending}
              className="rounded-lg bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="h-4 w-4 mr-2" />
              {t("admin.posters.approveAll")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => archiveMutation.mutate({ id })}
            className="rounded-lg"
          >
            {t("admin.posters.archive")}
          </Button>
        </div>
      </div>

      {/* Side-by-side images */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-foreground/50 mb-2">{t("admin.posters.originalPoster")}</p>
          <img
            src={poster.originalImageUrl}
            alt="original"
            className="w-full rounded-lg border border-foreground/10"
          />
          {poster.originalCopyText && (
            <details className="mt-2 text-xs text-foreground/60">
              <summary className="cursor-pointer font-semibold">{t("admin.posters.originalCopyText")}</summary>
              <pre className="mt-2 p-2 bg-foreground/5 rounded whitespace-pre-wrap font-sans">
                {poster.originalCopyText}
              </pre>
            </details>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-[#8a6f3a] mb-2">{t("admin.posters.brandedVersion")}</p>
          {isProcessing ? (
            <div className="aspect-[9/16] bg-gradient-to-br from-foreground/5 to-foreground/10 rounded-lg flex flex-col items-center justify-center text-foreground/60">
              <Loader2 className="h-8 w-8 animate-spin mb-3" />
              <p className="text-sm font-semibold">{t("admin.posters.aiProcessing")}</p>
              <p className="text-xs mt-1">{t("admin.posters.aiProcessingTime")}</p>
            </div>
          ) : poster.brandedImageUrl ? (
            <div className="space-y-2">
              <img
                src={poster.brandedImageUrl}
                alt="branded"
                className="w-full rounded-lg border border-[#c9a563]/30"
              />
              <a
                href={poster.brandedImageUrl}
                download={`packgo-poster-${id}.png`}
                target="_blank"
                rel="noopener"
                className="text-xs text-[#8a6f3a] hover:underline inline-flex items-center gap-1"
              >
                <Download className="h-3 w-3" /> {t("admin.posters.downloadBranded")}
              </a>
            </div>
          ) : (
            <div className="aspect-[9/16] bg-red-50 border border-red-200 rounded-lg flex flex-col items-center justify-center text-red-700 p-4">
              <p className="text-sm font-semibold">{t("admin.posters.processingFailed")}</p>
              {poster.notes && <p className="text-xs mt-2 text-center">{poster.notes}</p>}
            </div>
          )}
        </div>
      </div>

      {/* AI Analysis preview */}
      {poster.aiAnalysis && (
        <Card>
          <CardContent className="p-4">
            <details className="text-xs text-foreground/70">
              <summary className="cursor-pointer font-semibold">{t("admin.posters.aiAnalysisTitle")}</summary>
              <pre className="mt-2 p-2 bg-foreground/5 rounded overflow-x-auto">
                {JSON.stringify(JSON.parse(poster.aiAnalysis), null, 2)}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}

      {/* Platform copies tabs */}
      {!isProcessing && copies.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h4 className="font-semibold mb-3">{t("admin.posters.platformCopiesTitle")}</h4>
            <Tabs defaultValue={copies[0]?.platform}>
              <TabsList className="flex-wrap h-auto">
                {copies.map((c) => (
                  <TabsTrigger key={c.id} value={c.platform} className="text-xs">
                    {PLATFORM_KEY[c.platform] ? t(PLATFORM_KEY[c.platform]) : c.platform}
                    {c.status === "posted" && (
                      <CheckCircle2 className="h-3 w-3 ml-1 text-green-600" />
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              {copies.map((c) => (
                <TabsContent key={c.id} value={c.platform}>
                  <PlatformCopyEditor
                    copy={c}
                    brandedImageUrl={poster.brandedImageUrl}
                    onUpdated={() => utils.posters.get.invalidate({ id })}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ──────────────── Platform copy editor ──────────────── */

function PlatformCopyEditor({
  copy,
  brandedImageUrl,
  onUpdated,
}: {
  copy: any;
  brandedImageUrl: string | null;
  onUpdated: () => void;
}) {
  const { t } = useLocale();
  const [text, setText] = useState(copy.copyText);
  const [hashtags, setHashtags] = useState(copy.hashtags ?? "");
  const [postedUrl, setPostedUrl] = useState(copy.postedUrl ?? "");
  const [copiedText, setCopiedText] = useState(false);

  // Reset state when switching copies
  useEffect(() => {
    setText(copy.copyText);
    setHashtags(copy.hashtags ?? "");
    setPostedUrl(copy.postedUrl ?? "");
  }, [copy.id]);

  const updateMutation = trpc.posters.updateCopy.useMutation({
    onSuccess: () => onUpdated(),
    onError: (e) => toast.error(e.message),
  });

  const platform = copy.platform;
  const platformLabel = PLATFORM_KEY[platform] ? t(PLATFORM_KEY[platform]) : platform;
  const useHashtags = ["xiaohongshu", "facebook", "instagram"].includes(platform);

  const handleCopyText = async () => {
    let toCopy = text.trim();
    if (useHashtags && hashtags.trim()) {
      const tags = hashtags.split(/\s+/).filter(Boolean).map((tag: string) => `#${tag}`).join(" ");
      toCopy = `${toCopy}\n\n${tags}`;
    }
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopiedText(true);
      toast.success(t("admin.posters.toastCopied").replace("{platform}", platformLabel));
      setTimeout(() => setCopiedText(false), 2000);
    } catch {
      toast.error(t("admin.posters.toastCopyFail"));
    }
  };

  const saveText = () => {
    updateMutation.mutate({
      copyId: copy.id,
      copyText: text,
      hashtags: useHashtags ? hashtags : null,
    });
  };

  const markPosted = () => {
    updateMutation.mutate({
      copyId: copy.id,
      status: "posted",
      postedUrl: postedUrl || null,
    });
    toast.success(t("admin.posters.toastPosted").replace("{platform}", platformLabel));
  };

  const markSkipped = () => {
    updateMutation.mutate({ copyId: copy.id, status: "skipped" });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
            {t("admin.posters.copyContentLabel")}
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            rows={12}
            className="mt-1 rounded-lg text-sm font-sans"
          />
          <p className="text-[10px] text-foreground/40 mt-1 text-right">{t("admin.posters.charCount").replace("{count}", String(text.length))}</p>
        </div>
        {useHashtags && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
              {t("admin.posters.hashtagsLabel")}
            </label>
            <Textarea
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              onBlur={saveText}
              rows={2}
              className="mt-1 rounded-lg text-xs"
              placeholder={t("admin.posters.hashtagsPlaceholder")}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-2">
          <Button
            onClick={handleCopyText}
            className="rounded-lg bg-foreground hover:bg-foreground/90 text-white"
          >
            {copiedText ? (
              <>
                <Check className="h-4 w-4 mr-2" /> {t("admin.posters.copiedText")}
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                {t("admin.posters.copyToClipboard")}
              </>
            )}
          </Button>
          {brandedImageUrl && (
            <a
              href={brandedImageUrl}
              download={`packgo-${platform}-${copy.id}.png`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center justify-center rounded-lg border border-foreground/20 hover:bg-foreground/5 px-4 py-2 text-sm font-medium"
            >
              <Download className="h-4 w-4 mr-2" />
              {t("admin.posters.downloadBrandedPoster")}
            </a>
          )}
        </div>

        <div className="rounded-lg border border-foreground/10 p-3 space-y-2 bg-foreground/[0.02]">
          <p className="text-xs font-semibold">{t("admin.posters.afterPosting").replace("{platform}", platformLabel)}</p>
          <Input
            value={postedUrl}
            onChange={(e) => setPostedUrl(e.target.value)}
            placeholder={t("admin.posters.postedUrlPlaceholder")}
            className="rounded-lg text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={markPosted}
              disabled={copy.status === "posted"}
              className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs"
            >
              {copy.status === "posted" ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" /> {t("admin.posters.alreadyPosted")}
                </>
              ) : (
                <>{t("admin.posters.markPosted")}</>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={markSkipped}
              disabled={copy.status === "skipped"}
              className="rounded-lg text-xs"
            >
              {t("admin.posters.skipPosting")}
            </Button>
          </div>
          {copy.postedAt && (
            <p className="text-[10px] text-foreground/50">
              {t("admin.posters.postedAt", { time: new Date(copy.postedAt).toLocaleString() })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
