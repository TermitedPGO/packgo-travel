/**
 * PosterDistribution — Batch 4 m3: poster list, detail sheet, upload, approve/archive.
 *
 * Separated from MarketingHub to keep each sub-view under the 300-line red line.
 * Uses ws-ui card grammar + shadcn Sheet for detail panel.
 */
import { useState, useMemo, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import {
  Plus,
  RefreshCw,
  Lock,
  Check,
  Archive,
  Copy,
  Pencil,
  X,
  Share2,
} from "lucide-react";

const SixPlatformComposer = lazy(() => import("./SixPlatformComposer"));
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  WorkspaceCard,
  BtnB,
  BtnO,
  Badge,
  Kv,
  type CardState,
} from "./ws-ui";
import { formatRelTime } from "./relTime";

type PosterRow = {
  id: number;
  sourceVendor: string;
  title: string | null;
  targetAudience: string;
  originalImageUrl: string;
  brandedImageUrl: string | null;
  aiAnalysis: string | null;
  status: string;
  createdAt: Date;
};

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

const VENDOR_LABELS: Record<string, string> = {
  lion: "workspace.mktPsVendorLion",
  zongheng: "workspace.mktPsVendorZH",
  house: "workspace.mktPsVendorHouse",
  other: "workspace.mktPsVendorOther",
};

const AUDIENCE_LABELS: Record<string, string> = {
  family: "workspace.mktPsAudFamily",
  honeymoon: "workspace.mktPsAudHoneymoon",
  parent_child: "workspace.mktPsAudParentChild",
  business: "workspace.mktPsAudBusiness",
  senior: "workspace.mktPsAudSenior",
  general: "workspace.mktPsAudGeneral",
};

const PLATFORM_LABELS: Record<string, string> = {
  wechat_moments: "workspace.mktPsPlatWechatMoments",
  wechat_group: "workspace.mktPsPlatWechatGroup",
  xiaohongshu: "workspace.mktPsPlatXHS",
  line: "workspace.mktPsPlatLine",
  facebook: "workspace.mktPsPlatFB",
  instagram: "workspace.mktPsPlatIG",
  newsletter: "workspace.mktPsPlatNewsletter",
};

function posterState(status: string): CardState {
  if (status === "uploaded") return "wait";
  if (status === "processing") return "running";
  if (status === "ready") return "decide";
  if (status === "approved") return "done";
  if (status === "distributed") return "done";
  if (status === "archived") return "done";
  if (status === "failed") return "err";
  return "none";
}

export default function PosterDistribution() {
  const { t } = useLocale();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const postersQ = trpc.posters.list.useQuery({
    status: "all",
    limit: 30,
  });

  const items = (postersQ.data?.items ?? []) as PosterRow[];

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const order: Record<string, number> = {
          ready: 0,
          processing: 1,
          uploaded: 2,
          approved: 3,
          distributed: 4,
          failed: 5,
          archived: 6,
        };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      }),
    [items],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t("workspace.mktPosters")}
          {items.length > 0 && (
            <span className="ml-1.5 text-gray-400 font-normal">
              {items.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <BtnO onClick={() => postersQ.refetch()}>
            <RefreshCw
              className={`w-3 h-3 inline mr-1 ${postersQ.isFetching ? "animate-spin" : ""}`}
            />
            {t("workspace.refresh")}
          </BtnO>
          <BtnB onClick={() => setShowUpload(true)}>
            <Plus className="w-3 h-3 inline mr-1" />
            {t("workspace.mktPsUpload")}
          </BtnB>
        </div>
      </div>

      {postersQ.isLoading && (
        <p className="text-xs text-gray-400">{t("workspace.loading")}</p>
      )}

      {!postersQ.isLoading && sorted.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">
          {t("workspace.mktPsNone")}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {sorted.map((p) => (
          <PosterCard
            key={p.id}
            poster={p}
            onClick={() => setDetailId(p.id)}
            t={t}
          />
        ))}
      </div>

      {detailId !== null && (
        <PosterDetailSheet
          posterId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => postersQ.refetch()}
          t={t}
        />
      )}

      {showUpload && (
        <UploadPosterDialog
          onClose={() => setShowUpload(false)}
          onCreated={() => {
            postersQ.refetch();
            setShowUpload(false);
          }}
          t={t}
        />
      )}
    </div>
  );
}

function PosterCard({
  poster,
  onClick,
  t,
}: {
  poster: PosterRow;
  onClick: () => void;
  t: (k: string) => string;
}) {
  const state = posterState(poster.status);
  const vendorKey = VENDOR_LABELS[poster.sourceVendor] ?? VENDOR_LABELS.other;
  const displayTitle = poster.title || t("workspace.mktPsUntitled");

  return (
    <WorkspaceCard
      type={t(vendorKey)}
      whoCompany
      state={state}
      time={poster.createdAt ? formatRelTime(poster.createdAt, t) : undefined}
      jumpLabel={t("workspace.mktPsDetail")}
      onJump={onClick}
    >
      <div className="flex items-start gap-3">
        <img
          src={poster.brandedImageUrl || poster.originalImageUrl}
          alt=""
          className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
        />
        <div className="min-w-0">
          <p className="font-semibold text-[13px] truncate">{displayTitle}</p>
          <Kv
            k={t("workspace.mktPsAudience")}
            v={t(AUDIENCE_LABELS[poster.targetAudience] ?? AUDIENCE_LABELS.general)}
          />
          <Kv
            k={t("workspace.mktStatus")}
            v={t(`workspace.mktPsSt_${poster.status}`)}
            muted={state === "done"}
          />
        </div>
      </div>
    </WorkspaceCard>
  );
}

function PosterDetailSheet({
  posterId,
  onClose,
  onChanged,
  t,
}: {
  posterId: number;
  onClose: () => void;
  onChanged: () => void;
  t: (k: string) => string;
}) {
  const posterQ = trpc.posters.get.useQuery({ id: posterId });
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

  const approveMut = trpc.posters.approve.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.mktPsApproved"));
      onChanged();
      posterQ.refetch();
      setConfirmApprove(false);
    },
  });

  const archiveMut = trpc.posters.archive.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.mktPsArchived"));
      onChanged();
      onClose();
    },
  });

  const data = posterQ.data;
  const poster = data?.poster as PosterRow | undefined;
  const copies = (data?.copies ?? []) as PlatformCopy[];

  let aiSummary = "";
  if (poster?.aiAnalysis) {
    try {
      const parsed = JSON.parse(poster.aiAnalysis);
      aiSummary =
        parsed.title || parsed.highlights?.join(", ") || poster.aiAnalysis;
    } catch {
      aiSummary = poster.aiAnalysis.slice(0, 200);
    }
  }

  const canApprove = poster?.status === "ready";
  const canArchive =
    poster?.status !== "archived" && poster?.status !== "processing";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full xl:max-w-3xl xl:rounded-l-xl overflow-y-auto">
        <SheetHeader className="border-b">
          <SheetTitle className="text-sm">
            {t("workspace.mktPsDetail")}
          </SheetTitle>
        </SheetHeader>

        {posterQ.isLoading && (
          <p className="text-xs text-gray-400 py-8">
            {t("workspace.loading")}
          </p>
        )}

        {poster && (
          <div className="space-y-5 py-2">
            {/* Header: image + title + AI analysis */}
            <div className="flex gap-4">
              <img
                src={poster.brandedImageUrl || poster.originalImageUrl}
                alt=""
                className="w-32 h-32 rounded-xl object-cover flex-shrink-0"
              />
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-sm">
                  {poster.title || t("workspace.mktPsUntitled")}
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Badge>
                    {t(
                      VENDOR_LABELS[poster.sourceVendor] ??
                        VENDOR_LABELS.other,
                    )}
                  </Badge>
                  <Badge>
                    {t(
                      AUDIENCE_LABELS[poster.targetAudience] ??
                        AUDIENCE_LABELS.general,
                    )}
                  </Badge>
                </div>
                {aiSummary && (
                  <p className="text-[12px] text-gray-500 line-clamp-3">
                    {aiSummary}
                  </p>
                )}
              </div>
            </div>

            {/* 7-platform copies */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-500">
                {t("workspace.mktPsPlatformCopies")} ({copies.length})
              </h4>
              {copies.length === 0 && (
                <p className="text-xs text-gray-400">
                  {t("workspace.mktPsNoCopies")}
                </p>
              )}
              {copies.map((copy) => (
                <PlatformCopyRow
                  key={copy.id}
                  copy={copy}
                  t={t}
                  onUpdated={() => posterQ.refetch()}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              {copies.length > 0 && (
                <BtnB onClick={() => setShowComposer(true)}>
                  <Share2 className="w-3 h-3 inline mr-1" />
                  {t("workspace.mkt6pDistribute")}
                </BtnB>
              )}
              {canApprove && !confirmApprove && (
                <BtnO onClick={() => setConfirmApprove(true)}>
                  <Check className="w-3 h-3 inline mr-1" />
                  {t("workspace.mktPsApproveAll")}
                </BtnO>
              )}
              {canApprove && confirmApprove && (
                <div className="flex items-center gap-2 bg-black text-white rounded-lg px-3 py-2">
                  <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-[11px]">
                    {t("workspace.mktPsApproveConfirm")}
                  </span>
                  <button
                    onClick={() => approveMut.mutate({ id: posterId })}
                    disabled={approveMut.isPending}
                    className="px-2 py-0.5 rounded-md bg-white text-black text-[11px] font-medium disabled:opacity-40"
                  >
                    {t("workspace.mktPsYes")}
                  </button>
                  <button
                    onClick={() => setConfirmApprove(false)}
                    className="text-gray-400 text-[11px]"
                  >
                    {t("workspace.mktCancel")}
                  </button>
                </div>
              )}
              {canArchive && !confirmArchive && (
                <BtnO onClick={() => setConfirmArchive(true)}>
                  <Archive className="w-3 h-3 inline mr-1" />
                  {t("workspace.mktPsArchive")}
                </BtnO>
              )}
              {canArchive && confirmArchive && (
                <div className="flex items-center gap-2 bg-black text-white rounded-lg px-3 py-2">
                  <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-[11px]">
                    {t("workspace.mktPsArchiveConfirm")}
                  </span>
                  <button
                    onClick={() => archiveMut.mutate({ id: posterId })}
                    disabled={archiveMut.isPending}
                    className="px-2 py-0.5 rounded-md bg-white text-black text-[11px] font-medium disabled:opacity-40"
                  >
                    {t("workspace.mktPsYes")}
                  </button>
                  <button
                    onClick={() => setConfirmArchive(false)}
                    className="text-gray-400 text-[11px]"
                  >
                    {t("workspace.mktCancel")}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>

      {showComposer && poster && (
        <Suspense fallback={null}>
          <SixPlatformComposer
            posterAssetId={posterId}
            posterImageUrl={poster.brandedImageUrl || poster.originalImageUrl}
            onClose={() => {
              setShowComposer(false);
              posterQ.refetch();
            }}
          />
        </Suspense>
      )}
    </Sheet>
  );
}

function PlatformCopyRow({
  copy,
  t,
  onUpdated,
}: {
  copy: PlatformCopy;
  t: (k: string) => string;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(copy.copyText);
  const [editHashtags, setEditHashtags] = useState(copy.hashtags ?? "");

  const updateMut = trpc.posters.updateCopy.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.mktPsCopyUpdated"));
      setEditing(false);
      onUpdated();
    },
  });

  const platformKey =
    PLATFORM_LABELS[copy.platform] ?? "workspace.mktPsPlatFB";
  const statusLabel =
    copy.status === "draft"
      ? t("workspace.mktSt_draft")
      : copy.status === "approved"
        ? t("workspace.mktPsSt_approved")
        : copy.status === "posted"
          ? t("workspace.mktPsSt_posted")
          : t("workspace.mktPsSt_skipped");

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge>{t(platformKey)}</Badge>
          <span className="text-[10px] text-gray-400">{statusLabel}</span>
          {copy.postedAt && (
            <span className="text-[10px] text-gray-400">
              {formatRelTime(copy.postedAt, t)}
            </span>
          )}
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded-md hover:bg-gray-100"
          >
            <Pencil className="w-3.5 h-3.5 text-gray-500" />
          </button>
        )}
      </div>

      {!editing && (
        <>
          <p className="text-[12px] leading-relaxed line-clamp-3">
            {copy.copyText}
          </p>
          {copy.hashtags && (
            <p className="text-[11px] text-gray-500">{copy.hashtags}</p>
          )}
        </>
      )}

      {editing && (
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
          <div className="flex justify-end gap-1.5">
            <BtnO onClick={() => setEditing(false)}>
              <X className="w-3 h-3 inline mr-0.5" />
              {t("workspace.mktCancel")}
            </BtnO>
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
          </div>
        </div>
      )}
    </div>
  );
}

function UploadPosterDialog({
  onClose,
  onCreated,
  t,
}: {
  onClose: () => void;
  onCreated: () => void;
  t: (k: string) => string;
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [title, setTitle] = useState("");
  const [vendor, setVendor] = useState<"lion" | "zongheng" | "house" | "other">(
    "other",
  );
  const [audience, setAudience] = useState<
    "family" | "honeymoon" | "parent_child" | "business" | "senior" | "general"
  >("general");

  const createMut = trpc.posters.create.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.mktPsCreated"));
      onCreated();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md shadow-lg">
        <h3 className="text-sm font-semibold mb-4">
          {t("workspace.mktPsUpload")}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.mktPsImageUrl")}
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.mktPsTitle")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
              placeholder={t("workspace.mktPsTitlePlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">
                {t("workspace.mktPsVendor")}
              </label>
              <select
                value={vendor}
                onChange={(e) => setVendor(e.target.value as typeof vendor)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
              >
                {Object.entries(VENDOR_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">
                {t("workspace.mktPsAudience")}
              </label>
              <select
                value={audience}
                onChange={(e) =>
                  setAudience(e.target.value as typeof audience)
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
              >
                {Object.entries(AUDIENCE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <BtnO onClick={onClose}>{t("workspace.mktCancel")}</BtnO>
          <BtnB
            onClick={() =>
              createMut.mutate({
                originalImageUrl: imageUrl,
                title: title || undefined,
                sourceVendor: vendor,
                targetAudience: audience,
              })
            }
            disabled={!imageUrl.trim() || createMut.isPending}
          >
            <Plus className="w-3 h-3 inline mr-1" />
            {t("workspace.mktCreate")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}
