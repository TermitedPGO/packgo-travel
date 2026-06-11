/**
 * TourDetailActions — 批7 m3 行程全貌動作列.
 *
 * 編輯(重用 admin TourEditDialog)/ 上架 🔒 gated(客人可見)/ 下架輕
 * confirm / featured ★ / 預覽客人頁。toggleStatus 後端嚴格 active↔
 * inactive(draft 走匯入流程、pending_review 走 m4 approve),UI 照實。
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Pencil, Eye, Star, Lock } from "lucide-react";
import { BtnB, BtnO } from "./ws-ui";
import { TourEditDialog } from "@/components/admin/TourEditDialog";

export default function TourDetailActions({
  tour,
}: {
  tour: {
    id: number;
    status: string;
    featured: number | null;
  } & Record<string, unknown>;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);

  const invalidate = () => {
    utils.tours.getById.invalidate({ id: tour.id });
    utils.tours.list.invalidate();
  };

  const updateMut = trpc.tours.update.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.trsSaved"));
      invalidate();
      setEditing(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleMut = trpc.tours.toggleStatus.useMutation({
    onSuccess: (res) => {
      toast.success(res.message);
      invalidate();
      setPublishing(false);
      setUnpublishing(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const featuredMut = trpc.tours.toggleFeatured.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const canToggle = tour.status === "active" || tour.status === "inactive";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <BtnO onClick={() => setEditing(true)}>
        <span className="inline-flex items-center gap-1">
          <Pencil className="w-3 h-3" />
          {t("workspace.trsEdit")}
        </span>
      </BtnO>
      <BtnO onClick={() => window.open(`/tour/${tour.id}`, "_blank")}>
        <span className="inline-flex items-center gap-1">
          <Eye className="w-3 h-3" />
          {t("workspace.trsPreview")}
        </span>
      </BtnO>
      <BtnO
        onClick={() => featuredMut.mutate({ id: tour.id })}
        disabled={featuredMut.isPending}
      >
        <span className="inline-flex items-center gap-1">
          <Star
            className={`w-3 h-3 ${tour.featured === 1 ? "fill-black" : ""}`}
          />
          {tour.featured === 1
            ? t("workspace.trsUnfeature")
            : t("workspace.trsFeature")}
        </span>
      </BtnO>
      {tour.status === "active" && (
        <>
          {unpublishing ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500">
                {t("workspace.trsUnpublishConfirm")}
              </span>
              <BtnB
                onClick={() => toggleMut.mutate({ id: tour.id })}
                disabled={toggleMut.isPending}
              >
                {t("workspace.trsUnpublishGo")}
              </BtnB>
              <BtnO onClick={() => setUnpublishing(false)}>
                {t("workspace.supCancel")}
              </BtnO>
            </span>
          ) : (
            <BtnO onClick={() => setUnpublishing(true)}>
              {t("workspace.trsUnpublish")}
            </BtnO>
          )}
        </>
      )}
      {tour.status === "inactive" && (
        <BtnB onClick={() => setPublishing(true)}>
          {t("workspace.trsPublish")}
        </BtnB>
      )}
      {!canToggle && tour.status !== "pending_review" && (
        <span className="text-[10px] text-gray-400">
          {t("workspace.trsNoToggleHint")}
        </span>
      )}

      {publishing && (
        <PublishDialog
          busy={toggleMut.isPending}
          onConfirm={() => toggleMut.mutate({ id: tour.id })}
          onClose={() => setPublishing(false)}
        />
      )}

      {editing && (
        <TourEditDialog
          open={editing}
          onOpenChange={(o: boolean) => !o && setEditing(false)}
          tourData={tour}
          onSave={(editedData: Record<string, unknown>) =>
            updateMut.mutate({ id: tour.id, ...editedData })
          }
          isSaving={updateMut.isPending}
        />
      )}
    </div>
  );
}

/** 🔒 上架 = 客人立刻可見 = gated checkbox confirm. */
function PublishDialog({
  busy,
  onConfirm,
  onClose,
}: {
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md shadow-lg">
        <h3 className="text-sm font-semibold mb-1">
          {t("workspace.trsPublish")}
        </h3>
        <p className="text-[11px] text-gray-500 mb-4">
          {t("workspace.trsPublishHint")}
        </p>
        <div className="rounded-lg bg-black text-white px-3 py-2.5 flex items-start gap-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <label className="flex items-start gap-2 cursor-pointer text-[11px] leading-relaxed">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t("workspace.trsPublishConfirm")}</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <BtnO onClick={onClose}>{t("workspace.supCancel")}</BtnO>
          <BtnB onClick={onConfirm} disabled={!confirmed || busy}>
            {busy ? t("workspace.trsPublishing") : t("workspace.trsPublishGo")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}
