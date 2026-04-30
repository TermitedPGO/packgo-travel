/**
 * PosterGenPanel — v78z-z3 Sprint 11 (Image 2.0 Phase A v1).
 *
 * ChatGPT-in-admin poster composer. Rewritten from v0's templated
 * tour-spotlight to free-form prompt + iteration + reference library.
 *
 * Workflow:
 *   1. (Optional) upload brand assets to library (logo/photo/past poster)
 *   2. Type a free-form prompt
 *   3. Pick reference assets (will be appended to prompt as "see logo:
 *      [URL]" etc.)
 *   4. Click Generate → gpt-image-2 → result shown
 *   5. Click "iterate on this" + new prompt → uses edit endpoint to
 *      refine
 *   6. History shows v1, v2, v3 with click-to-revert/branch
 *
 * Note: Sharp branding lock (logo + CST # corners) is applied
 * automatically server-side unless lockBranding=false.
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Sparkles, Download, RefreshCw, Upload, Image as ImageIcon, Plus,
  X, Trash2, History, AlertCircle, DollarSign,
} from "lucide-react";
import { toast } from "sonner";

type Quality = "low" | "medium" | "high";
type Size = "1024x1024" | "1024x1792" | "1792x1024" | "2048x2048";

function newProjectKey(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function PosterGenPanel() {
  const { t } = useLocale();
  const [projectKey, setProjectKey] = useState(() => newProjectKey());
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<Size>("1024x1792");
  const [quality, setQuality] = useState<Quality>("medium");
  const [pickedRefIds, setPickedRefIds] = useState<number[]>([]);
  const [parentIterationId, setParentIterationId] = useState<number | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: costStatus, refetch: refetchCost } = trpc.posterGen.getCostStatus.useQuery();
  const { data: references, refetch: refetchRefs } = trpc.posterGen.listReferences.useQuery({ kind: "all" });
  const { data: iterations, refetch: refetchIter } = trpc.posterGen.listIterations.useQuery({ projectKey });

  const uploadMutation = trpc.posterGen.uploadReference.useMutation({
    onSuccess: () => {
      toast.success(t("posterGen.toastUploaded"));
      refetchRefs();
    },
    onError: (err) => toast.error(t("posterGen.toastUploadFailed") + " " + err.message),
  });

  const deleteRefMutation = trpc.posterGen.deleteReference.useMutation({
    onSuccess: () => {
      toast.success(t("posterGen.toastDeleted"));
      refetchRefs();
    },
  });

  const generateMutation = trpc.posterGen.generate.useMutation({
    onSuccess: (data) => {
      toast.success(t("posterGen.toastGenerated", { cost: data.costUsd.toFixed(3) }));
      refetchCost();
      refetchIter();
      setParentIterationId(data.iterationId); // next iteration will branch from this
    },
    onError: (err) => {
      toast.error(t("posterGen.toastFailed") + " " + err.message);
    },
  });

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("posterGen.toastFileTooLarge"));
      return;
    }
    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const kind = file.name.toLowerCase().includes("logo") ? "logo" : "photo";
    uploadMutation.mutate({
      kind,
      label: file.name.slice(0, 100),
      mimeType: (file.type as any) || "image/png",
      base64Data: base64,
    });
    e.target.value = ""; // allow re-uploading same file
  };

  const handleGenerate = () => {
    if (prompt.trim().length < 10) {
      toast.error(t("posterGen.toastPromptTooShort"));
      return;
    }
    // Build full prompt: include reference asset URLs as inline notes.
    let fullPrompt = prompt;
    if (pickedRefIds.length > 0 && references) {
      const refNotes = pickedRefIds
        .map((id) => {
          const ref = references.find((r: any) => r.id === id);
          return ref ? `[Reference ${ref.kind}: "${ref.label}"]` : "";
        })
        .filter(Boolean)
        .join(" ");
      fullPrompt = `${prompt}\n\nReference assets to mirror style/branding from:\n${refNotes}`;
    }
    generateMutation.mutate({
      projectKey,
      prompt: fullPrompt,
      size,
      quality,
      parentIterationId: parentIterationId ?? undefined,
      referenceAssetIds: pickedRefIds,
      lockBranding: true,
    });
  };

  const handleNewProject = () => {
    setProjectKey(newProjectKey());
    setPrompt("");
    setParentIterationId(null);
    setPickedRefIds([]);
    toast.success(t("posterGen.toastNewProject"));
  };

  const togglePickRef = (id: number) =>
    setPickedRefIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const lastIteration = iterations && iterations.length > 0 ? iterations[iterations.length - 1] : null;

  const todaySpend = costStatus?.todaySpend ?? 0;
  const monthSpend = costStatus?.monthSpend ?? 0;
  const dailyBudget = costStatus?.dailyBudget ?? 10;
  const monthlyBudget = costStatus?.monthlyBudget ?? 100;
  const dailyPct = (todaySpend / dailyBudget) * 100;

  return (
    <div className="space-y-6">
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Header + budget surface */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("posterGen.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">{t("posterGen.subtitle")}</p>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1 justify-end">
              <DollarSign className="h-3 w-3" /> {t("posterGen.todaySpend")}
            </p>
            <p className={`text-lg font-bold tabular-nums ${dailyPct > 80 ? "text-red-600" : "text-gray-900"}`}>
              ${todaySpend.toFixed(2)} / ${dailyBudget.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">{t("posterGen.monthSpend")}</p>
            <p className="text-lg font-bold tabular-nums text-gray-900">
              ${monthSpend.toFixed(2)} / ${monthlyBudget.toFixed(0)}
            </p>
          </div>
        </div>
      </div>

      {/* Project context banner */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center justify-between text-sm">
        <span className="text-gray-600">
          <span className="font-mono text-xs text-gray-400">{projectKey}</span>
          {parentIterationId && (
            <span className="ml-2 text-blue-600 font-medium">
              {t("posterGen.iteratingFrom", { n: String(parentIterationId) })}
            </span>
          )}
        </span>
        <Button variant="outline" size="sm" onClick={handleNewProject} className="rounded-lg gap-1">
          <Plus className="h-3 w-3" /> {t("posterGen.newProject")}
        </Button>
      </div>

      {/* Prompt + controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
            {t("posterGen.promptLabel")}
            {parentIterationId && (
              <span className="ml-2 text-blue-600 font-normal normal-case">
                — {t("posterGen.editPromptHint")}
              </span>
            )}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              parentIterationId
                ? t("posterGen.editPlaceholder")
                : t("posterGen.generatePlaceholder")
            }
            rows={8}
            maxLength={4000}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
          />
          <p className="text-xs text-gray-400 mt-1 text-right">
            {prompt.length} / 4000
          </p>
        </div>

        {/* Reference picker summary */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">
              {t("posterGen.referencesLabel")} ({pickedRefIds.length})
            </label>
            <button
              onClick={() => setShowLibrary((v) => !v)}
              className="text-xs text-teal-600 hover:underline"
            >
              {showLibrary ? t("posterGen.hideLibrary") : t("posterGen.showLibrary")}
            </button>
          </div>
          {pickedRefIds.length > 0 && references && (
            <div className="flex flex-wrap gap-2">
              {pickedRefIds.map((id) => {
                const r = references.find((x: any) => x.id === id);
                if (!r) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-teal-50 border border-teal-200 text-teal-700"
                  >
                    <ImageIcon className="h-3 w-3" />
                    {r.label}
                    <button onClick={() => togglePickRef(id)} aria-label="Remove">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Size + quality */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              {t("posterGen.size")}
            </label>
            <Select value={size} onValueChange={(v) => setSize(v as Size)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1024x1024">{t("posterGen.sizeSquare")}</SelectItem>
                <SelectItem value="1024x1792">{t("posterGen.sizePortrait")}</SelectItem>
                <SelectItem value="1792x1024">{t("posterGen.sizeLandscape")}</SelectItem>
                <SelectItem value="2048x2048">{t("posterGen.sizeXl")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              {t("posterGen.quality")}
            </label>
            <Select value={quality} onValueChange={(v) => setQuality(v as Quality)}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">{t("posterGen.qualityLow")}</SelectItem>
                <SelectItem value="medium">{t("posterGen.qualityMedium")}</SelectItem>
                <SelectItem value="high">{t("posterGen.qualityHigh")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            {t("posterGen.estimateHint", {
              cost: quality === "low" ? "$0.02" : quality === "high" ? "$0.30" : "$0.07",
            })}
          </p>
          <Button
            onClick={handleGenerate}
            disabled={prompt.trim().length < 10 || generateMutation.isPending}
            className="rounded-lg gap-2"
          >
            {generateMutation.isPending ? (
              <>
                <Spinner className="h-4 w-4" />
                {t("posterGen.generating")}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {parentIterationId ? t("posterGen.iterate") : t("posterGen.generate")}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Reference library (toggle) */}
      {showLibrary && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              {t("posterGen.libraryTitle")}
            </h3>
            <Button onClick={handleUploadClick} disabled={uploadMutation.isPending} className="rounded-lg gap-2">
              {uploadMutation.isPending ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
              {t("posterGen.uploadAsset")}
            </Button>
          </div>
          {!references || references.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">{t("posterGen.libraryEmpty")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {references.map((r: any) => (
                <div
                  key={r.id}
                  className={`
                    relative bg-gray-50 rounded-xl border-2 overflow-hidden cursor-pointer transition-colors
                    ${pickedRefIds.includes(r.id) ? "border-teal-500" : "border-transparent hover:border-gray-300"}
                  `}
                  onClick={() => togglePickRef(r.id)}
                >
                  <div className="aspect-square bg-gray-100 flex items-center justify-center">
                    {r.url ? (
                      <img src={r.url} alt={r.label} className="w-full h-full object-contain rounded-xl" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-gray-300" />
                    )}
                  </div>
                  <div className="p-2 bg-white">
                    <p className="text-xs font-medium text-gray-900 truncate">{r.label}</p>
                    <p className="text-xs text-gray-500">{r.kind}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(t("posterGen.confirmDelete"))) deleteRefMutation.mutate({ id: r.id });
                    }}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/80 hover:bg-white flex items-center justify-center"
                  >
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Latest iteration preview */}
      {lastIteration && lastIteration.url && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                {t("posterGen.preview")} — v{iterations?.length ?? 0}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {t("posterGen.previewMeta", {
                  cost: lastIteration.costUsd.toFixed(3),
                  duration: lastIteration.durationMs ? Math.round(lastIteration.durationMs / 1000) + "s" : "—",
                })}
              </p>
            </div>
            <a
              href={lastIteration.url}
              download={`packgo-poster-${projectKey}-v${iterations?.length ?? 0}.png`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="rounded-lg gap-1.5">
                <Download className="h-4 w-4" />
                {t("posterGen.download")}
              </Button>
            </a>
          </div>
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex justify-center">
            <img
              src={lastIteration.url}
              alt="Latest iteration"
              className="max-w-full max-h-[80vh] rounded-lg shadow-lg"
            />
          </div>
        </div>
      )}

      {/* Iteration history */}
      {iterations && iterations.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
            <History className="h-4 w-4" /> {t("posterGen.history")}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {iterations.map((it: any, idx: number) => (
              <button
                key={it.id}
                onClick={() => setParentIterationId(it.id)}
                className={`
                  relative bg-gray-50 rounded-xl border-2 overflow-hidden text-left transition-colors
                  ${parentIterationId === it.id ? "border-teal-500" : "border-transparent hover:border-gray-300"}
                  ${it.status === "errored" ? "opacity-50" : ""}
                `}
              >
                <div className="aspect-[4/5] bg-gray-100 flex items-center justify-center">
                  {it.url ? (
                    <img src={it.url} alt={`v${idx + 1}`} className="w-full h-full object-cover rounded-xl" />
                  ) : (
                    <AlertCircle className="h-6 w-6 text-red-300" />
                  )}
                </div>
                <div className="p-2 bg-white text-xs">
                  <p className="font-semibold text-gray-900">v{idx + 1}</p>
                  <p className="text-gray-500 truncate">{it.mode}</p>
                  <p className="text-gray-400 tabular-nums">${it.costUsd.toFixed(3)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
