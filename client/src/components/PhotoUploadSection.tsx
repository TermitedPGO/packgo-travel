/**
 * PhotoUploadSection — Round 80.22 Phase G.
 *
 * Drop into a completed booking detail page to let customers upload trip
 * photos. Each upload:
 *   1. POSTs raw file to /api/upload/image (existing endpoint, returns S3 URL)
 *   2. Calls trpc.photos.upload(bookingId, photoUrl) to register + earn +10 pt
 *
 * Bonus cap: first 10 photos per booking earn +10 each (= 100 pts max per
 * booking per docs/packpoint-policy.md §4). Subsequent photos still upload
 * but won't earn points (system message clarifies this).
 *
 * Counts toward the photo book voucher unlock (50+ photos across all
 * approved bookings — see server/_core/vouchers.ts photoBookGate).
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import {
  Camera,
  Upload,
  Loader2,
  Trash2,
  Check,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface PhotoUploadSectionProps {
  bookingId: number;
}

const PHOTO_BONUS_CAP_PER_BOOKING = 10;

export default function PhotoUploadSection({ bookingId }: PhotoUploadSectionProps) {
  const utils = trpc.useUtils();
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);

  const { data: photos = [] } = trpc.photos.myPhotos.useQuery({ bookingId });
  const uploadMutation = trpc.photos.upload.useMutation();
  const deleteMutation = trpc.photos.delete.useMutation({
    onSuccess: () => utils.photos.myPhotos.invalidate({ bookingId }),
  });

  const earnedCount = photos.filter((p) => p.pointsAwarded).length;
  const remainingBonus = Math.max(0, PHOTO_BONUS_CAP_PER_BOOKING - earnedCount);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingCount(files.length);

    let totalEarned = 0;
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        // Step 1: upload to S3 via existing endpoint
        const formData = new FormData();
        formData.append("image", file);
        const uploadRes = await fetch("/api/upload/image", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!uploadRes.ok) {
          throw new Error(`Upload failed: ${uploadRes.statusText}`);
        }
        const { url } = await uploadRes.json();

        // Step 2: register in tripPhotos table + earn Packpoint
        const result = await uploadMutation.mutateAsync({
          bookingId,
          photoUrl: url,
        });
        if (result.pointsEarned > 0) {
          totalEarned += result.pointsEarned;
        }
        successCount++;
      } catch (err: any) {
        console.error("[PhotoUpload] Failed:", err);
        toast.error(`照片 ${i + 1} 上傳失敗:${err.message || "unknown"}`);
      }
    }

    setUploadingCount(0);
    utils.photos.myPhotos.invalidate({ bookingId });
    utils.packpoint.getStatus.invalidate();

    if (successCount > 0) {
      const msg =
        totalEarned > 0
          ? `已上傳 ${successCount} 張,獲得 +${totalEarned} Packpoint`
          : `已上傳 ${successCount} 張(已達點數獎勵上限)`;
      toast.success(msg);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDelete = (photoId: number) => {
    if (!confirm(t("rewards.deletePhotoConfirm"))) return;
    deleteMutation.mutate({ photoId });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Camera className="h-4 w-4 text-[#c9a563]" />
            上傳行程照片
          </h3>
          <p className="text-xs text-foreground/60 mt-0.5">
            {remainingBonus > 0
              ? `每張 +10 Packpoint(此筆訂單還能賺 ${remainingBonus} 張)`
              : `已達此筆訂單獎勵上限(總 ${earnedCount} 張賺到 ${earnedCount * 10} 點)`}
          </p>
        </div>
      </div>

      {/* Upload button + hidden input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
      <Button
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadingCount > 0}
        className="w-full rounded-lg border-dashed border-foreground/30 hover:border-[#c9a563] hover:bg-[#c9a563]/5"
      >
        {uploadingCount > 0 ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            上傳中…({uploadingCount} 張)
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            選擇照片(可多選)
          </>
        )}
      </Button>

      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div
              key={p.id}
              className="relative group aspect-square rounded-lg overflow-hidden border border-foreground/10"
            >
              <img
                src={p.photoUrl}
                alt={p.caption || "Trip photo"}
                className="w-full h-full object-cover"
              />
              {p.pointsAwarded && (
                <div className="absolute top-1 left-1 bg-[#c9a563] text-foreground text-[10px] font-bold rounded px-1.5 py-0.5 flex items-center gap-0.5">
                  <Check className="h-2.5 w-2.5" />
                  +10
                </div>
              )}
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                disabled={deleteMutation.isPending}
                className="absolute top-1 right-1 bg-black/60 text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Photo book voucher hint */}
      {photos.length > 0 && photos.length < 50 && (
        <div className="bg-[#FAF8F2] border border-[#c9a563]/20 rounded-lg p-2.5 text-[11px] text-foreground/70 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-[#8a6f3a] flex-shrink-0 mt-0.5" />
          <span>
            累積上傳 50 張後可在 <a href="/rewards" className="text-[#8a6f3a] underline">兌換中心</a>{" "}
            兌換 30,000 點精裝旅遊相簿(目前 {photos.length} 張)
          </span>
        </div>
      )}
    </div>
  );
}
