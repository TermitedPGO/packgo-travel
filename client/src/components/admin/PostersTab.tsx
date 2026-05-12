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

const VENDOR_LABEL: Record<string, string> = {
  lion: "雄獅旅遊",
  zongheng: "縱橫旅遊",
  house: "PACK&GO 自家",
  other: "其他",
};
const AUDIENCE_LABEL: Record<string, string> = {
  family: "家庭",
  honeymoon: "蜜月",
  parent_child: "親子",
  business: "商務",
  senior: "銀髮",
  general: "通用",
};
const PLATFORM_LABEL: Record<string, string> = {
  wechat_moments: "微信朋友圈",
  wechat_group: "微信群",
  xiaohongshu: "小紅書",
  line: "LINE",
  facebook: "Facebook",
  instagram: "Instagram",
  newsletter: "Newsletter",
};
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  uploaded: { label: "已上傳", className: "bg-gray-100 text-gray-700" },
  processing: { label: "AI 處理中", className: "bg-blue-100 text-blue-800" },
  ready: { label: "待審核", className: "bg-yellow-100 text-yellow-800" },
  approved: { label: "已審核", className: "bg-green-100 text-green-800" },
  distributed: { label: "已分發", className: "bg-[#c9a563]/20 text-[#8a6f3a]" },
  archived: { label: "已封存", className: "bg-gray-100 text-gray-500" },
  failed: { label: "失敗", className: "bg-red-100 text-red-800" },
};

export default function PostersTab() {
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-[#c9a563]" />
            供應商海報分發
          </h2>
          <p className="text-sm text-foreground/60 mt-1">
            上傳雄獅 / 縱橫海報 → AI 自動轉成 PACK&GO 品牌版 + 7 平台文案
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
          <h3 className="font-semibold mb-4">歷史海報</h3>

          {isLoading ? (
            <LoadingRow />
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-foreground/50 text-sm">
              <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
              尚無海報。從上方丟一張供應商海報開始。
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
                    <span className={`absolute top-2 right-2 px-2 py-0.5 text-[10px] rounded ${STATUS_PILL[p.status]?.className ?? ""}`}>
                      {STATUS_PILL[p.status]?.label ?? p.status}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-foreground/50">{VENDOR_LABEL[p.sourceVendor]}</p>
                    <p className="text-sm font-semibold truncate mt-0.5">
                      {p.title || "(處理中)"}
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
      toast.success("已開始生成 PACK&GO 版本(~30 秒)");
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
      toast.error("上傳失敗:" + (err?.message || "unknown"));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!imageUrl) {
      toast.error("請先放入供應商海報圖片");
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
          <h3 className="font-semibold text-base">把供應商海報丟進來</h3>
          <p className="text-xs text-foreground/55 mt-0.5">
            放圖片 + 貼原宣傳文 → AI 30 秒內生成 PACK&GO 品牌版 + 7 平台文案。
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
                alt="供應商海報"
                className="w-full h-48 md:h-full object-cover rounded-lg border border-foreground/10"
              />
              <button
                onClick={() => setImageUrl(null)}
                className="absolute top-1.5 right-1.5 bg-black/70 text-white p-1 rounded-md hover:bg-black"
                aria-label="移除圖片"
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
                  <span className="text-xs">上傳中…</span>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">點此或拖曳供應商海報</span>
                </>
              )}
            </button>
          )}

          {/* Copy textarea */}
          <Textarea
            value={originalCopy}
            onChange={(e) => setOriginalCopy(e.target.value)}
            placeholder="貼上供應商原宣傳文(可選,從 WeChat 直接複製即可)…"
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
            進階設定
            {hasAdvancedOverrides && !advancedOpen && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10">
                已調整
              </span>
            )}
            <span className="text-[10px]">{advancedOpen ? "▴" : "▾"}</span>
          </button>

          {advancedOpen && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-foreground/70">供應商</label>
                <Select value={vendor} onValueChange={(v: any) => setVendor(v)}>
                  <SelectTrigger className="mt-1 rounded-lg h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="other">其他 / 自動偵測</SelectItem>
                    <SelectItem value="lion">雄獅旅遊</SelectItem>
                    <SelectItem value="zongheng">縱橫旅遊</SelectItem>
                    <SelectItem value="house">PACK&GO 自家</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-foreground/70">目標客群</label>
                <Select value={audience} onValueChange={(v: any) => setAudience(v)}>
                  <SelectTrigger className="mt-1 rounded-lg h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">通用</SelectItem>
                    <SelectItem value="family">家庭旅遊</SelectItem>
                    <SelectItem value="honeymoon">蜜月夫妻</SelectItem>
                    <SelectItem value="parent_child">親子家庭</SelectItem>
                    <SelectItem value="business">商務旅客</SelectItem>
                    <SelectItem value="senior">銀髮族</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-foreground/70">標題(可選)</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="AI 會自動解析"
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
            生成 PACK&GO 版本
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ──────────────── Detail / review view ──────────────── */

function PosterDetail({ id, onBack }: { id: number; onBack: () => void }) {
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
      toast.success("已重新提交 AI 生圖,~30 秒後完成");
      utils.posters.get.invalidate({ id });
    },
    onError: (e) => toast.error(e.message),
  });
  const approveMutation = trpc.posters.approve.useMutation({
    onSuccess: () => {
      toast.success("已標記為已審核");
      utils.posters.get.invalidate({ id });
    },
    onError: (e) => toast.error(e.message),
  });
  const archiveMutation = trpc.posters.archive.useMutation({
    onSuccess: () => {
      toast.success("已封存");
      onBack();
    },
  });

  if (isLoading) return <LoadingRow />;
  if (!data) return <p className="text-foreground/50">海報不存在</p>;

  const { poster, copies } = data;
  const isProcessing = poster.status === "processing" || poster.status === "uploaded";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onBack} className="rounded-lg" size="sm">
            ← 返回列表
          </Button>
          <div>
            <h3 className="text-xl font-bold">{poster.title || "(處理中)"}</h3>
            <p className="text-xs text-foreground/60 mt-0.5">
              {VENDOR_LABEL[poster.sourceVendor]} · {AUDIENCE_LABEL[poster.targetAudience]} ·{" "}
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_PILL[poster.status]?.className ?? ""}`}>
                {STATUS_PILL[poster.status]?.label ?? poster.status}
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
              重新生成海報
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
              一鍵全部審核通過
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => archiveMutation.mutate({ id })}
            className="rounded-lg"
          >
            封存
          </Button>
        </div>
      </div>

      {/* Side-by-side images */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-foreground/50 mb-2">原供應商海報</p>
          <img
            src={poster.originalImageUrl}
            alt="original"
            className="w-full rounded-lg border border-foreground/10"
          />
          {poster.originalCopyText && (
            <details className="mt-2 text-xs text-foreground/60">
              <summary className="cursor-pointer font-semibold">原宣傳文</summary>
              <pre className="mt-2 p-2 bg-foreground/5 rounded whitespace-pre-wrap font-sans">
                {poster.originalCopyText}
              </pre>
            </details>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-[#8a6f3a] mb-2">PACK&GO 品牌版</p>
          {isProcessing ? (
            <div className="aspect-[9/16] bg-gradient-to-br from-foreground/5 to-foreground/10 rounded-lg flex flex-col items-center justify-center text-foreground/60">
              <Loader2 className="h-8 w-8 animate-spin mb-3" />
              <p className="text-sm font-semibold">AI 處理中…</p>
              <p className="text-xs mt-1">~30 秒(自動更新)</p>
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
                <Download className="h-3 w-3" /> 下載品牌版海報
              </a>
            </div>
          ) : (
            <div className="aspect-[9/16] bg-red-50 border border-red-200 rounded-lg flex flex-col items-center justify-center text-red-700 p-4">
              <p className="text-sm font-semibold">處理失敗</p>
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
              <summary className="cursor-pointer font-semibold">AI 解析結果(JSON)</summary>
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
            <h4 className="font-semibold mb-3">7 平台文案(編輯後即時儲存)</h4>
            <Tabs defaultValue={copies[0]?.platform}>
              <TabsList className="flex-wrap h-auto">
                {copies.map((c) => (
                  <TabsTrigger key={c.id} value={c.platform} className="text-xs">
                    {PLATFORM_LABEL[c.platform]}
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
  const useHashtags = ["xiaohongshu", "facebook", "instagram"].includes(platform);

  const handleCopyText = async () => {
    let toCopy = text.trim();
    if (useHashtags && hashtags.trim()) {
      const tags = hashtags.split(/\s+/).filter(Boolean).map((t: string) => `#${t}`).join(" ");
      toCopy = `${toCopy}\n\n${tags}`;
    }
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopiedText(true);
      toast.success(`已複製 ${PLATFORM_LABEL[platform]} 文案`);
      setTimeout(() => setCopiedText(false), 2000);
    } catch {
      toast.error("複製失敗");
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
    toast.success(`已標記 ${PLATFORM_LABEL[platform]} 為已發布`);
  };

  const markSkipped = () => {
    updateMutation.mutate({ copyId: copy.id, status: "skipped" });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
            文案內容
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            rows={12}
            className="mt-1 rounded-lg text-sm font-sans"
          />
          <p className="text-[10px] text-foreground/40 mt-1 text-right">{text.length} 字</p>
        </div>
        {useHashtags && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-foreground/60">
              Hashtags(空格分隔,不用加 #)
            </label>
            <Textarea
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              onBlur={saveText}
              rows={2}
              className="mt-1 rounded-lg text-xs"
              placeholder="夏威夷 海島度假 親子旅遊 ..."
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
                <Check className="h-4 w-4 mr-2" /> 已複製
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                複製文案到剪貼簿
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
              下載品牌海報
            </a>
          )}
        </div>

        <div className="rounded-lg border border-foreground/10 p-3 space-y-2 bg-foreground/[0.02]">
          <p className="text-xs font-semibold">手動發布到 {PLATFORM_LABEL[platform]} 後:</p>
          <Input
            value={postedUrl}
            onChange={(e) => setPostedUrl(e.target.value)}
            placeholder="(選填)貼上發布後的網址"
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
                  <CheckCircle2 className="h-3 w-3 mr-1" /> 已發布
                </>
              ) : (
                <>✓ 標記已發布</>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={markSkipped}
              disabled={copy.status === "skipped"}
              className="rounded-lg text-xs"
            >
              不發布
            </Button>
          </div>
          {copy.postedAt && (
            <p className="text-[10px] text-foreground/50">
              發布於 {new Date(copy.postedAt).toLocaleString("zh-TW")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
