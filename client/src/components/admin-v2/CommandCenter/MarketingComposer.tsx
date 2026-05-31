/**
 * MarketingComposer — 「貼供應商內容」的入口元件 (P3-v2).
 *
 * Shown above the approval inbox when the marketing lane is selected.
 * Jeff pastes supplier WeChat promotional text → optional poster image URL →
 * optional platform/notes → clicks "AI 轉換" → the transformer produces a
 * PACK&GO branded draft that lands in the marketing inbox for review.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Sparkles, Loader2 } from "lucide-react";

const PLATFORM_OPTIONS = [
  { value: "", label: "mktComposerPlatformNone" },
  { value: "xiaohongshu", label: "mktComposerPlatformXhs" },
  { value: "wechat", label: "mktComposerPlatformWechat" },
  { value: "facebook", label: "mktComposerPlatformFb" },
  { value: "instagram", label: "mktComposerPlatformIg" },
] as const;

export default function MarketingComposer() {
  const { t } = useLocale();
  const [supplierText, setSupplierText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [platform, setPlatform] = useState("");
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();
  const transform = trpc.commandCenter.transformSupplierContent.useMutation({
    onSuccess: () => {
      // Refetch inbox so the new task appears immediately
      utils.commandCenter.list.invalidate();
      utils.commandCenter.stats.invalidate();
      // Reset form
      setSupplierText("");
      setImageUrl("");
      setPlatform("");
      setNotes("");
    },
  });

  const canSubmit = supplierText.trim().length >= 10 && !transform.isPending;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {t("admin.commandCenter.mktComposerTitle")}
      </h3>

      {/* Supplier text */}
      <Textarea
        value={supplierText}
        onChange={(e) => setSupplierText(e.target.value)}
        rows={8}
        className="rounded-lg text-sm"
        placeholder={t("admin.commandCenter.mktComposerPlaceholder")}
      />

      {/* Image URL */}
      <Input
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        className="rounded-lg text-sm"
        placeholder={t("admin.commandCenter.mktComposerImageUrl")}
      />

      {/* Platform + notes row */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 bg-white"
        >
          {PLATFORM_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(`admin.commandCenter.${opt.label}`)}
            </option>
          ))}
        </select>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="rounded-lg text-sm flex-1 min-w-[200px]"
          placeholder={t("admin.commandCenter.mktComposerNotes")}
        />
      </div>

      {/* Transform button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            transform.mutate({
              supplierText: supplierText.trim(),
              supplierImageUrl: imageUrl.trim() || undefined,
              platform: platform || undefined,
              notes: notes.trim() || undefined,
            })
          }
          disabled={!canSubmit}
          className="rounded-lg"
        >
          {transform.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              {t("admin.commandCenter.mktComposerTransforming")}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-1.5" />
              {t("admin.commandCenter.mktComposerTransform")}
            </>
          )}
        </Button>
        {transform.isSuccess && (
          <span className="text-xs text-green-600">
            {t("admin.commandCenter.toastSent")} ✓
          </span>
        )}
        {transform.isError && (
          <span className="text-xs text-red-600">
            {t("admin.commandCenter.toastError")}
          </span>
        )}
      </div>
    </div>
  );
}
