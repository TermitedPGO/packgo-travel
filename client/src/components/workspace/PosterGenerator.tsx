/**
 * PosterGenerator — Batch 4 m4: AI poster generation wizard.
 *
 * Workflow: style preset + prompt → cost gate confirm → generate → variant grid
 * → select for 6-platform distribution (M5).
 * Each generation is a posterIteration grouped by projectKey.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import {
  Sparkles,
  RefreshCw,
  Lock,
  Check,
  DollarSign,
  Clock,
  History,
  ChevronRight,
} from "lucide-react";
import { BtnB, BtnO, Kv, Badge } from "./ws-ui";

type StylePreset = "fresh" | "bold" | "magazine" | "scenic";

const STYLE_PRESETS: { id: StylePreset; labelKey: string; promptPrefix: string }[] = [
  { id: "fresh", labelKey: "workspace.mktGenStyleFresh", promptPrefix: "Clean, minimal, pastel palette. " },
  { id: "bold", labelKey: "workspace.mktGenStyleBold", promptPrefix: "Bold typography, high contrast, attention-grabbing. " },
  { id: "magazine", labelKey: "workspace.mktGenStyleMag", promptPrefix: "Magazine editorial layout, elegant, high-end travel. " },
  { id: "scenic", labelKey: "workspace.mktGenStyleScenic", promptPrefix: "Photorealistic scenic landscape, immersive. " },
];

const SIZE_OPTIONS = [
  { value: "1024x1792", label: "9:16" },
  { value: "1024x1024", label: "1:1" },
  { value: "1792x1024", label: "16:9" },
] as const;

const QUALITY_OPTIONS = [
  { value: "low", labelKey: "workspace.mktGenQualLow" },
  { value: "medium", labelKey: "workspace.mktGenQualMed" },
  { value: "high", labelKey: "workspace.mktGenQualHigh" },
] as const;

type IterationRow = {
  id: number;
  parentIterationId: number | null;
  prompt: string;
  mode: string;
  quality: string;
  size: string;
  costUsd: number;
  durationMs: number;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  url: string | null;
};

export default function PosterGenerator({
  onSelectForDistribution,
}: {
  onSelectForDistribution?: (iterationUrl: string, iterationId: number) => void;
}) {
  const { t } = useLocale();
  const [projectKey] = useState(
    () => `poster-${Date.now().toString(36)}`,
  );
  const [style, setStyle] = useState<StylePreset>("fresh");
  const [prompt, setPrompt] = useState("");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [size, setSize] = useState<string>("1024x1792");
  const [showCostGate, setShowCostGate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const costQ = trpc.posterGen.getCostStatus.useQuery();
  const iterationsQ = trpc.posterGen.listIterations.useQuery({ projectKey });

  const generateMut = trpc.posterGen.generate.useMutation({
    onSuccess: (data) => {
      toast.success(
        `${t("workspace.mktGenDone")} ($${data.costUsd.toFixed(2)})`,
      );
      iterationsQ.refetch();
      costQ.refetch();
      setShowCostGate(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setShowCostGate(false);
    },
  });

  const iterations = (iterationsQ.data ?? []) as IterationRow[];
  const successIterations = iterations.filter((i) => i.status === "success");

  function handleGenerate() {
    const preset = STYLE_PRESETS.find((p) => p.id === style);
    const fullPrompt = (preset?.promptPrefix ?? "") + prompt;
    generateMut.mutate({
      projectKey,
      prompt: fullPrompt,
      quality,
      size: size as any,
    });
  }

  const cost = costQ.data;

  return (
    <div className="space-y-4">
      {/* Cost dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CostCard
          label={t("workspace.mktGenCostToday")}
          value={`$${(cost?.todaySpend ?? 0).toFixed(2)}`}
          sub={`/ $${cost?.dailyBudget ?? 10}`}
        />
        <CostCard
          label={t("workspace.mktGenCostMonth")}
          value={`$${(cost?.monthSpend ?? 0).toFixed(2)}`}
          sub={`/ $${cost?.monthlyBudget ?? 100}`}
        />
        <CostCard
          label={t("workspace.mktGenCountToday")}
          value={String(cost?.todayCount ?? 0)}
          sub={t("workspace.mktGenImages")}
        />
        <CostCard
          label={t("workspace.mktGenCountMonth")}
          value={String(cost?.monthCount ?? 0)}
          sub={t("workspace.mktGenImages")}
        />
      </div>

      {/* Generation form */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <h4 className="text-sm font-semibold">
          {t("workspace.mktGenNewPoster")}
        </h4>

        {/* Style presets */}
        <div>
          <label className="text-[11px] text-gray-500 mb-1.5 block">
            {t("workspace.mktGenStyle")}
          </label>
          <div className="flex flex-wrap gap-2">
            {STYLE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setStyle(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  style === p.id
                    ? "bg-gray-900 text-white"
                    : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <label className="text-[11px] text-gray-500 mb-1 block">
            {t("workspace.mktGenPrompt")}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
            placeholder={t("workspace.mktGenPromptPlaceholder")}
          />
        </div>

        {/* Quality + Size */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.mktGenQuality")}
            </label>
            <select
              value={quality}
              onChange={(e) =>
                setQuality(e.target.value as typeof quality)
              }
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
            >
              {QUALITY_OPTIONS.map((q) => (
                <option key={q.value} value={q.value}>
                  {t(q.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.mktGenSize")}
            </label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
            >
              {SIZE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Generate button */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-[11px] text-gray-500 flex items-center gap-1 hover:text-gray-700"
          >
            <History className="w-3.5 h-3.5" />
            {t("workspace.mktGenHistory")} ({iterations.length})
          </button>
          <BtnB
            onClick={() => setShowCostGate(true)}
            disabled={!prompt.trim() || prompt.length < 10 || generateMut.isPending}
          >
            <Sparkles className="w-3 h-3 inline mr-1" />
            {generateMut.isPending
              ? t("workspace.mktGenGenerating")
              : t("workspace.mktGenGenerate")}
          </BtnB>
        </div>
      </div>

      {/* Cost gate confirm */}
      {showCostGate && (
        <CostGateDialog
          todaySpend={cost?.todaySpend ?? 0}
          dailyBudget={cost?.dailyBudget ?? 10}
          quality={quality}
          onConfirm={handleGenerate}
          onCancel={() => setShowCostGate(false)}
          busy={generateMut.isPending}
          t={t}
        />
      )}

      {/* Variant grid */}
      {successIterations.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">
            {t("workspace.mktGenVariants")} ({successIterations.length})
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {successIterations.map((iter) => (
              <VariantCard
                key={iter.id}
                iteration={iter}
                onSelect={() =>
                  iter.url &&
                  onSelectForDistribution?.(iter.url, iter.id)
                }
                onIterate={() => {
                  setPrompt(iter.prompt);
                }}
                t={t}
              />
            ))}
          </div>
        </div>
      )}

      {/* Generating spinner */}
      {generateMut.isPending && (
        <div className="flex items-center justify-center py-8 gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
          <span className="text-sm text-gray-500">
            {t("workspace.mktGenGenerating")}
          </span>
        </div>
      )}

      {/* Version history */}
      {showHistory && iterations.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <h4 className="text-xs font-semibold text-gray-500">
            {t("workspace.mktGenHistory")}
          </h4>
          {iterations.map((iter) => (
            <div
              key={iter.id}
              className="flex items-center gap-3 text-[12px] py-1.5 border-b border-gray-50 last:border-0"
            >
              {iter.url && (
                <img
                  src={iter.url}
                  alt=""
                  className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-gray-700">
                  {iter.prompt.slice(0, 60)}
                  {iter.prompt.length > 60 ? "..." : ""}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span>{iter.mode}</span>
                  <span>{iter.quality}</span>
                  <span>${iter.costUsd.toFixed(2)}</span>
                  <span>
                    {iter.status === "success"
                      ? t("workspace.mktGenSuccess")
                      : t("workspace.mktGenError")}
                  </span>
                </div>
              </div>
              {iter.status === "success" && iter.url && (
                <button
                  onClick={() =>
                    onSelectForDistribution?.(iter.url!, iter.id)
                  }
                  className="text-[10px] text-gray-500 flex items-center gap-0.5 hover:text-gray-700 flex-shrink-0"
                >
                  {t("workspace.mktGenUse")}
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CostCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <p className="text-lg font-bold">
        {value}
        <span className="text-[11px] font-normal text-gray-400 ml-1">
          {sub}
        </span>
      </p>
    </div>
  );
}

function VariantCard({
  iteration,
  onSelect,
  onIterate,
  t,
}: {
  iteration: IterationRow;
  onSelect: () => void;
  onIterate: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {iteration.url && (
        <img
          src={iteration.url}
          alt=""
          className="w-full aspect-[3/4] object-cover"
        />
      )}
      <div className="p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Badge>${iteration.costUsd.toFixed(2)}</Badge>
          <span className="text-[10px] text-gray-400">
            {iteration.quality}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <BtnB onClick={onSelect}>
            <Check className="w-3 h-3 inline mr-0.5" />
            {t("workspace.mktGenUse")}
          </BtnB>
          <BtnO onClick={onIterate}>
            <RefreshCw className="w-3 h-3 inline mr-0.5" />
            {t("workspace.mktGenIterate")}
          </BtnO>
        </div>
      </div>
    </div>
  );
}

function CostGateDialog({
  todaySpend,
  dailyBudget,
  quality,
  onConfirm,
  onCancel,
  busy,
  t,
}: {
  todaySpend: number;
  dailyBudget: number;
  quality: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  t: (k: string) => string;
}) {
  const estimatedCost =
    quality === "high" ? 0.17 : quality === "medium" ? 0.07 : 0.02;
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm shadow-lg overflow-hidden">
        <div className="p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            {t("workspace.mktGenCostGate")}
          </h3>
          <Kv
            k={t("workspace.mktGenEstCost")}
            v={`~$${estimatedCost.toFixed(2)}`}
          />
          <Kv
            k={t("workspace.mktGenTodaySpend")}
            v={`$${todaySpend.toFixed(2)} / $${dailyBudget.toFixed(0)}`}
            muted={todaySpend < dailyBudget * 0.8}
          />
          <Kv
            k={t("workspace.mktGenQuality")}
            v={quality}
          />
        </div>
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between">
          <label className="text-[12px] flex items-center gap-2 cursor-pointer select-none">
            <Lock className="w-4 h-4 flex-shrink-0" />
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="rounded-md"
            />
            {t("workspace.mktGenCostConfirm")}
          </label>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 text-[11px] font-medium"
            >
              {t("workspace.mktCancel")}
            </button>
            <button
              onClick={onConfirm}
              disabled={!confirmed || busy}
              className="px-3 py-1.5 rounded-lg bg-white text-black text-[11px] font-medium disabled:opacity-40"
            >
              <Sparkles className="w-3 h-3 inline mr-1" />
              {busy
                ? t("workspace.mktGenGenerating")
                : t("workspace.mktGenGenerate")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
