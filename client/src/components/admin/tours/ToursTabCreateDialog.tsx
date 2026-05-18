/**
 * ToursTabCreateDialog — Round 80.21 unified "新增行程" entry point.
 *
 * Replaces the two separate buttons / dialogs:
 *   - ToursTabAiGenerateDialog (single URL / PDF, 60-90s LLM)
 *   - ToursTabBulkImportDialog  (Lion category, ~30s for 20 tours, no LLM)
 *
 * Jeff's complaint: "這兩個功能能直接做一個整合" — the user mental model is
 * "I want to add tours". Whether it's one URL, one PDF, or a Lion category
 * is a detail. Having two separate buttons forced the user to know that
 * detail upfront. New flow: ONE button "新增行程", dialog opens with three
 * mode chips at the top — pick the input style, fill the relevant form,
 * single CTA at the bottom.
 *
 * Layout:
 *   [✨ 新增行程]                                              [✕]
 *   選擇輸入方式
 *   ┌──────────┬──────────┬──────────┐
 *   │ URL 連結 │ PDF 上傳 │ 整批匯入 │
 *   └──────────┴──────────┴──────────┘
 *   [hint card explaining the chosen mode]
 *   [mode-specific form]
 *   [advanced options]
 *   [progress / error region]
 *                                              [取消] [開始生成]
 */
import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GenerationProgressComponent } from "../GenerationProgress";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileUp,
  Globe,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

type CreateMode = "url" | "pdf" | "bulk";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ── single-tour AI generation props (forwarded from parent) ── */
  autoGenerateUrl: string;
  setAutoGenerateUrl: (v: string) => void;
  pdfFile: File | null;
  setPdfFile: (f: File | null) => void;
  forceRegenerate: boolean;
  setForceRegenerate: (v: boolean) => void;
  isGenerating: boolean;
  pdfUploading: boolean;
  currentTaskId: string | null;
  generationStatus: any;
  generationError: string | null;
  setGenerationError: (v: string | null) => void;
  isPending: boolean;
  onGenerate: (mode: "url" | "pdf") => void;
  onClose: () => void;
}

export function ToursTabCreateDialog({
  open,
  onOpenChange,
  autoGenerateUrl,
  setAutoGenerateUrl,
  pdfFile,
  setPdfFile,
  forceRegenerate,
  setForceRegenerate,
  isGenerating,
  pdfUploading,
  currentTaskId,
  generationStatus,
  generationError,
  setGenerationError,
  isPending,
  onGenerate,
  onClose,
}: Props) {
  const { t } = useLocale();
  const [mode, setMode] = useState<CreateMode>("url");

  // ── Bulk-import-specific state (kept LOCAL — not lifted to parent) ──
  const [bulkCategoryPath, setBulkCategoryPath] = useState<string>("");
  const [bulkLimit, setBulkLimit] = useState<number>(20);
  const [bulkQueueRewrite, setBulkQueueRewrite] = useState<boolean>(true);
  const [bulkResult, setBulkResult] = useState<any>(null);

  const utils = trpc.useUtils();
  const { data: lionCategories } = trpc.tours.listLionCategories.useQuery(
    undefined,
    { enabled: open && mode === "bulk" }
  );

  const bulkImportMutation = trpc.tours.bulkImportFromLion.useMutation({
    onSuccess: (data: any) => {
      setBulkResult(data);
      utils.tours.list.invalidate();
      utils.admin.getStats.invalidate();
      toast.success(
        `匯入完成：${data.imported}/${data.total} 筆（耗時 ${(
          data.durationMs / 1000
        ).toFixed(1)}秒）`
      );
    },
    onError: (err) => {
      toast.error(`匯入失敗：${err.message}`);
    },
  });

  const isBulkRunning = bulkImportMutation.isPending;

  const handlePrimary = () => {
    if (mode === "bulk") {
      if (!bulkCategoryPath) {
        toast.error("請選擇雄獅分類");
        return;
      }
      setBulkResult(null);
      bulkImportMutation.mutate({
        categoryPath: bulkCategoryPath,
        limit: bulkLimit,
        queueRewrite: bulkQueueRewrite,
      });
    } else {
      onGenerate(mode);
    }
  };

  const isAnyRunning = isGenerating || pdfUploading || isBulkRunning || isPending;

  // Primary button label varies by mode
  const primaryLabel = (() => {
    if (mode === "bulk") {
      if (isBulkRunning) return "匯入中...";
      return bulkResult ? "再匯入一批" : "開始匯入";
    }
    if (isAnyRunning) return t("toursTab.generating");
    return t("toursTab.startGenerate");
  })();

  // Primary disabled?
  const primaryDisabled = (() => {
    if (mode === "bulk") return isBulkRunning || !bulkCategoryPath;
    if (mode === "url") return isAnyRunning || !autoGenerateUrl.trim();
    return isAnyRunning || !pdfFile;
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isAnyRunning) {
          setBulkResult(null);
          onClose();
        } else if (o) {
          onOpenChange(true);
        }
      }}
    >
      <DialogContent className="max-w-xl rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#c9a563]" />
            新增行程
          </DialogTitle>
          <DialogDescription>
            選擇最適合的輸入方式 — 單筆精修或整批快速匯入
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Mode selector — 3 cards ────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2">
            <ModeCard
              active={mode === "url"}
              disabled={isAnyRunning}
              onClick={() => setMode("url")}
              icon={<Globe className="h-5 w-5" />}
              title="URL 連結"
              hint="60-90 秒"
            />
            <ModeCard
              active={mode === "pdf"}
              disabled={isAnyRunning}
              onClick={() => setMode("pdf")}
              icon={<FileUp className="h-5 w-5" />}
              title="PDF 上傳"
              hint="60-90 秒"
            />
            <ModeCard
              active={mode === "bulk"}
              disabled={isAnyRunning}
              onClick={() => setMode("bulk")}
              icon={<Layers className="h-5 w-5" />}
              title="整批匯入"
              hint="~30秒/20筆"
              badge="快速"
            />
          </div>

          {/* ── Mode hint ──────────────────────────────────────────────── */}
          <div className="text-xs rounded-lg px-3 py-2.5 bg-[#FAF8F2] border border-[#c9a563]/30 text-foreground/75 leading-relaxed">
            {mode === "url" && (
              <>
                <strong className="text-foreground">單筆 URL</strong> —
                貼一個雄獅 / 同行行程網址,系統爬取內容後跑完整 LLM pipeline,
                生成 PACK&GO 風格行程(含詩意標題、每日行程改寫、飯店/餐食描述、翻譯)。
              </>
            )}
            {mode === "pdf" && (
              <>
                <strong className="text-foreground">單筆 PDF</strong> —
                上傳一個 PDF 行程表,系統解析內容後跑完整 LLM pipeline。
                適合手上已有業者提供的 PDF 但找不到網址的情況。
              </>
            )}
            {mode === "bulk" && (
              <>
                <strong className="text-foreground">整批匯入</strong> —
                選擇雄獅分類(例如「歐洲｜中西歐」),一次抓取多筆行程的 raw 資料。
                <strong className="text-foreground"> 不跑 LLM 重寫</strong>,
                速度約 30 秒匯入 20 筆。匯入後可勾選「背景排隊 LLM 升級」,
                由系統慢慢一筆筆升級為 PACK&GO 風格。
              </>
            )}
          </div>

          {/* ── Mode-specific form ────────────────────────────────────── */}
          {mode === "url" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">行程網址</Label>
              <input
                type="url"
                value={autoGenerateUrl}
                onChange={(e) => setAutoGenerateUrl(e.target.value)}
                placeholder="https://travel.liontravel.com/detail?..."
                disabled={isAnyRunning}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40"
              />
            </div>
          )}

          {mode === "pdf" && (
            <div className="space-y-2">
              <Label>{t("toursTab.selectPdfFile")}</Label>
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  pdfFile
                    ? "border-[#c9a563] bg-[#c9a563]/5"
                    : "border-gray-300 hover:border-[#c9a563] hover:bg-[#c9a563]/5"
                }`}
              >
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setPdfFile(file);
                  }}
                  disabled={isAnyRunning}
                  className="hidden"
                  id="pdf-upload-unified"
                />
                <label
                  htmlFor="pdf-upload-unified"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  {pdfFile ? (
                    <>
                      <FileUp className="h-8 w-8 text-[#8a6f3a]" />
                      <span className="text-sm font-medium text-[#8a6f3a]">
                        {pdfFile.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-gray-400" />
                      <span className="text-sm text-gray-600">
                        {t("toursTab.dropPdfHint")}
                      </span>
                      <span className="text-xs text-gray-400">
                        {t("toursTab.pdfSupportHint")}
                      </span>
                    </>
                  )}
                </label>
              </div>
              {pdfFile && (
                <button
                  type="button"
                  onClick={() => setPdfFile(null)}
                  disabled={isAnyRunning}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  {t("toursTab.clearFile")}
                </button>
              )}
            </div>
          )}

          {mode === "bulk" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-sm font-medium">雄獅分類</Label>
                <Select
                  value={bulkCategoryPath}
                  onValueChange={setBulkCategoryPath}
                  disabled={isBulkRunning}
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue placeholder="選擇分類(例如:歐洲｜中西歐)" />
                  </SelectTrigger>
                  <SelectContent>
                    {(lionCategories || []).map((c) => (
                      <SelectItem key={c.path} value={c.path}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">最多匯入幾筆</Label>
                <Select
                  value={String(bulkLimit)}
                  onValueChange={(v) => setBulkLimit(Number(v))}
                  disabled={isBulkRunning}
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 筆(快速測試)</SelectItem>
                    <SelectItem value="10">10 筆</SelectItem>
                    <SelectItem value="20">20 筆(建議)</SelectItem>
                    <SelectItem value="50">50 筆</SelectItem>
                    <SelectItem value="100">100 筆(最多)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ── Advanced toggles (mode-specific) ───────────────────────── */}
          {(mode === "url" || mode === "pdf") && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={forceRegenerate}
                onChange={(e) => setForceRegenerate(e.target.checked)}
                disabled={isAnyRunning}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-foreground focus:ring-foreground"
              />
              <span className="text-sm font-normal text-foreground/85">
                {t("toursTab.forceRegenerate")}
              </span>
            </label>
          )}

          {mode === "bulk" && (
            <label className="flex items-start gap-2 px-3 py-2.5 bg-[#FAF8F2] border border-[#c9a563]/30 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={bulkQueueRewrite}
                onChange={(e) => setBulkQueueRewrite(e.target.checked)}
                disabled={isBulkRunning}
                className="mt-0.5 h-4 w-4 rounded border-foreground/40 text-foreground"
              />
              <span className="text-xs leading-relaxed flex-1">
                <strong className="text-foreground">背景排隊 LLM 升級</strong>
                <span className="block text-foreground/60 mt-0.5">
                  匯入完成後,自動排隊背景升級每筆為 PACK&GO 風格(每筆約 60-90 秒,序列執行)。
                  不勾選則只匯入 raw 資料,之後可手動點選個別行程升級。
                </span>
              </span>
            </label>
          )}

          {/* ── Progress / Result panels ────────────────────────────────── */}
          {(mode === "url" || mode === "pdf") && isGenerating && (
            <GenerationProgressComponent
              taskId={currentTaskId}
              isGenerating={isGenerating}
              pollingStatus={generationStatus}
              onComplete={() => {
                /* parent handles via polling */
              }}
              onError={() => {
                /* parent handles via polling */
              }}
            />
          )}

          {(mode === "url" || mode === "pdf") &&
            generationError &&
            !isGenerating && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-red-800">
                      {t("toursTab.generationFailed")}
                    </h4>
                    <p className="text-xs text-red-600 mt-1">
                      {t("toursTab.generationFailedDesc")}
                    </p>
                    <details className="mt-2">
                      <summary className="text-xs text-red-500 cursor-pointer hover:text-red-700">
                        {t("toursTab.errorDetails")}
                      </summary>
                      <p className="text-xs text-red-500 mt-1 font-mono break-all">
                        {generationError}
                      </p>
                    </details>
                  </div>
                </div>
              </div>
            )}

          {mode === "bulk" && bulkResult && (
            <div className="rounded-lg border border-foreground/15 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#c9a563]" />
                <span className="font-semibold text-sm">
                  匯入完成 {bulkResult.imported} / {bulkResult.total}
                  <span className="ml-2 text-xs text-foreground/55">
                    ({(bulkResult.durationMs / 1000).toFixed(1)} 秒)
                  </span>
                </span>
              </div>
              {bulkResult.queued > 0 && (
                <div className="flex items-center gap-2 text-xs text-foreground/70">
                  <Sparkles className="h-3.5 w-3.5 text-[#c9a563]" />
                  已排隊 {bulkResult.queued} 筆背景 LLM 升級
                </div>
              )}
              {bulkResult.failed > 0 && (
                <div className="flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {bulkResult.failed} 筆失敗(檢查 fly logs 詳情)
                </div>
              )}
              <div className="max-h-40 overflow-y-auto text-xs space-y-1 mt-2 pt-2 border-t border-foreground/10">
                {(bulkResult.results || [])
                  .filter((r: any) => r.success)
                  .slice(0, 10)
                  .map((r: any) => (
                    <div key={r.tourId} className="flex items-baseline gap-2">
                      <span className="text-foreground/55 tabular-nums">
                        #{r.tourId}
                      </span>
                      <span className="truncate flex-1">{r.title}</span>
                      <span className="text-foreground/45">
                        {r.destinationCountry} · {r.durationDays}日
                      </span>
                    </div>
                  ))}
                {bulkResult.results?.filter((r: any) => r.success).length >
                  10 && (
                  <div className="text-foreground/55 italic">
                    ...另{" "}
                    {bulkResult.results.filter((r: any) => r.success).length -
                      10}{" "}
                    筆
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {(mode === "url" || mode === "pdf") &&
          generationError &&
          !isGenerating ? (
            <>
              <Button
                variant="outline"
                onClick={() => setGenerationError(null)}
                className="rounded-lg"
              >
                {t("toursTab.backToInput")}
              </Button>
              <Button
                onClick={() => {
                  setGenerationError(null);
                  onGenerate(mode);
                }}
                className="bg-foreground text-white hover:bg-foreground/85 rounded-lg"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("toursTab.retryGeneration")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setBulkResult(null);
                  onClose();
                }}
                disabled={isAnyRunning && mode === "bulk"}
                className="rounded-lg"
              >
                {isGenerating
                  ? t("toursTab.minimizeToBackground") || "縮小到背景"
                  : bulkResult
                  ? "關閉"
                  : t("common.cancel")}
              </Button>
              <Button
                onClick={handlePrimary}
                disabled={primaryDisabled}
                className="bg-foreground text-white hover:bg-foreground/85 rounded-lg h-10 px-5 disabled:opacity-60"
              >
                {isAnyRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {primaryLabel}
                  </>
                ) : (
                  <>
                    {mode === "bulk" ? (
                      <Download className="h-4 w-4 mr-2 text-[#c9a563]" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2 text-[#c9a563]" />
                    )}
                    {primaryLabel}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mode-card chip used in the 3-mode selector at the top.
 *
 * Active state: black background + white text + gold corner accent.
 * Inactive: light cream hover, gray border. Disabled: 50% opacity.
 */
function ModeCard({
  active,
  disabled,
  onClick,
  icon,
  title,
  hint,
  badge,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col items-center justify-center gap-1.5 py-3.5 px-2 rounded-xl border-2 transition-all ${
        active
          ? "border-foreground bg-foreground text-white shadow-md"
          : "border-gray-200 bg-white hover:border-[#c9a563]/60 hover:bg-[#FAF8F2] text-foreground"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={
          active ? "text-[#c9a563]" : "text-foreground/70"
        }
      >
        {icon}
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span
        className={`text-[10px] tabular-nums ${
          active ? "text-white/65" : "text-foreground/50"
        }`}
      >
        {hint}
      </span>
      {badge && (
        <span className="absolute -top-1.5 -right-1.5 bg-[#c9a563] text-foreground text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full">
          {badge}
        </span>
      )}
    </button>
  );
}
