/**
 * SixPlatformComposer — Batch 4 m5: 1 poster → 7 platform copies.
 *
 * Sheet view showing all platform copies for a poster asset with
 * platform-specific aspect ratio indicators, inline editing,
 * copy-to-clipboard, and download actions.
 * Generate ≠ publish: zero auto-publish, only ready-to-post material.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import {
  Check,
  Clipboard,
  Download,
  Pencil,
  X,
  Lock,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BtnB, BtnO, Badge } from "./ws-ui";
import { normalizePlatformCopy } from "./platformCopy";

type PlatformCopy = {
  id: number;
  posterAssetId: number;
  platform: string;
  copyText: string;
  hashtags: string | null;
  status: string;
  postedAt: Date | null;
  postedUrl: string | null;
  notes: string | null;
};

const PLATFORM_CONFIG: Record<
  string,
  { labelKey: string; ratio: string; ratioClass: string }
> = {
  facebook: {
    labelKey: "workspace.mktPsPlatFB",
    ratio: "1.91:1",
    ratioClass: "aspect-[1.91/1]",
  },
  instagram: {
    labelKey: "workspace.mktPsPlatIG",
    ratio: "1:1",
    ratioClass: "aspect-square",
  },
  xiaohongshu: {
    labelKey: "workspace.mktPsPlatXHS",
    ratio: "3:4",
    ratioClass: "aspect-[3/4]",
  },
  wechat_moments: {
    labelKey: "workspace.mktPsPlatWechatMoments",
    ratio: "1:1",
    ratioClass: "aspect-square",
  },
  wechat_group: {
    labelKey: "workspace.mktPsPlatWechatGroup",
    ratio: "2.35:1",
    ratioClass: "aspect-[2.35/1]",
  },
  line: {
    labelKey: "workspace.mktPsPlatLine",
    ratio: "1:1",
    ratioClass: "aspect-square",
  },
  newsletter: {
    labelKey: "workspace.mktPsPlatNewsletter",
    ratio: "16:9",
    ratioClass: "aspect-video",
  },
};

export default function SixPlatformComposer({
  posterAssetId,
  posterImageUrl,
  onClose,
}: {
  posterAssetId: number;
  posterImageUrl: string;
  onClose: () => void;
}) {
  const { t } = useLocale();

  const posterQ = trpc.posters.get.useQuery({ id: posterAssetId });
  const copies = (posterQ.data?.copies ?? []) as PlatformCopy[];

  const allDraft = copies.length > 0 && copies.every((c) => c.status === "draft");
  const [confirmSaveAll, setConfirmSaveAll] = useState(false);

  const approveMut = trpc.posters.approve.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.mktPsApproved"));
      posterQ.refetch();
      setConfirmSaveAll(false);
    },
  });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full xl:max-w-5xl xl:rounded-l-xl overflow-y-auto">
        <SheetHeader className="border-b">
          <SheetTitle className="text-sm">
            {t("workspace.mkt6pTitle")}
          </SheetTitle>
        </SheetHeader>

        {posterQ.isLoading && (
          <p className="text-xs text-gray-400 py-8">
            {t("workspace.loading")}
          </p>
        )}

        {/* No-publish banner */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-2.5 mt-2">
          <Lock className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <p className="text-[11px] text-gray-500">
            {t("workspace.mkt6pNoPub")}
          </p>
        </div>

        {/* Platform grid */}
        {copies.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 py-3">
            {copies.map((copy) => (
              <PlatformCard
                key={copy.id}
                copy={copy}
                imageUrl={posterImageUrl}
                t={t}
                onUpdated={() => posterQ.refetch()}
              />
            ))}
          </div>
        )}

        {copies.length === 0 && !posterQ.isLoading && (
          <p className="text-xs text-gray-400 py-8 text-center">
            {t("workspace.mktPsNoCopies")}
          </p>
        )}

        {/* Approve all bar */}
        {allDraft && copies.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            {!confirmSaveAll ? (
              <BtnB onClick={() => setConfirmSaveAll(true)}>
                <Check className="w-3 h-3 inline mr-1" />
                {t("workspace.mkt6pApproveAll")}
              </BtnB>
            ) : (
              <div className="flex items-center gap-2 bg-black text-white rounded-lg px-3 py-2 inline-flex">
                <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-[11px]">
                  {t("workspace.mktPsApproveConfirm")}
                </span>
                <button
                  onClick={() => approveMut.mutate({ id: posterAssetId })}
                  disabled={approveMut.isPending}
                  className="px-2 py-0.5 rounded-md bg-white text-black text-[11px] font-medium disabled:opacity-40"
                >
                  {t("workspace.mktPsYes")}
                </button>
                <button
                  onClick={() => setConfirmSaveAll(false)}
                  className="text-gray-400 text-[11px]"
                >
                  {t("workspace.mktCancel")}
                </button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PlatformCard({
  copy,
  imageUrl,
  t,
  onUpdated,
}: {
  copy: PlatformCopy;
  imageUrl: string;
  t: (k: string) => string;
  onUpdated: () => void;
}) {
  // v690 B-04: unwrap legacy raw-JSON copy rows before display/edit
  const normalized = normalizePlatformCopy(copy.copyText, copy.hashtags);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(normalized.text);
  const [editHashtags, setEditHashtags] = useState(normalized.hashtags);

  const updateMut = trpc.posters.updateCopy.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.mktPsCopyUpdated"));
      setEditing(false);
      onUpdated();
    },
  });

  const config = PLATFORM_CONFIG[copy.platform] ?? {
    labelKey: "workspace.mktPsPlatFB",
    ratio: "1:1",
    ratioClass: "aspect-square",
  };

  const statusLabel =
    copy.status === "draft"
      ? t("workspace.mktSt_draft")
      : copy.status === "approved"
        ? t("workspace.mktPsSt_approved")
        : copy.status === "posted"
          ? t("workspace.mktPsSt_posted")
          : t("workspace.mktPsSt_skipped");

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(
        normalized.text +
          (normalized.hashtags ? "\n\n" + normalized.hashtags : ""),
      );
      toast.success(t("workspace.mkt6pCopied"));
    } catch {
      toast.error("Clipboard not available");
    }
  }

  async function handleDownload() {
    try {
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `poster-${copy.platform}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Image preview with aspect ratio */}
      <div className={`relative ${config.ratioClass} max-h-48 overflow-hidden bg-gray-100`}>
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute top-2 left-2 flex gap-1.5">
          <Badge>{t(config.labelKey)}</Badge>
          <span className="text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded-md">
            {config.ratio}
          </span>
        </div>
        <span className="absolute top-2 right-2 text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded-md">
          {statusLabel}
        </span>
      </div>

      {/* Copy content */}
      <div className="p-3 space-y-2">
        {!editing ? (
          <>
            <p className="text-[12px] leading-relaxed line-clamp-4">
              {normalized.text}
            </p>
            {normalized.hashtags && (
              <p className="text-[11px] text-gray-500">{normalized.hashtags}</p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={4}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-[12px]"
            />
            <input
              type="text"
              value={editHashtags}
              onChange={(e) => setEditHashtags(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-[12px]"
              placeholder="Hashtags"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-1">
          {!editing ? (
            <>
              <BtnO onClick={() => setEditing(true)}>
                <Pencil className="w-3 h-3 inline mr-0.5" />
                {t("workspace.mkt6pEdit")}
              </BtnO>
              <BtnO onClick={handleCopyText}>
                <Clipboard className="w-3 h-3 inline mr-0.5" />
                {t("workspace.mkt6pCopy")}
              </BtnO>
              <BtnO onClick={handleDownload}>
                <Download className="w-3 h-3 inline mr-0.5" />
                {t("workspace.mkt6pDl")}
              </BtnO>
            </>
          ) : (
            <>
              <BtnB
                onClick={() =>
                  updateMut.mutate({
                    copyId: copy.id,
                    copyText: editText,
                    hashtags: editHashtags || null,
                  })
                }
                disabled={updateMut.isPending}
              >
                <Check className="w-3 h-3 inline mr-0.5" />
                {t("workspace.mktSave")}
              </BtnB>
              <BtnO onClick={() => setEditing(false)}>
                <X className="w-3 h-3 inline mr-0.5" />
                {t("workspace.mktCancel")}
              </BtnO>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
