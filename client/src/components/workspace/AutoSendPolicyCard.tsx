/**
 * AutoSendPolicyCard — 自動回覆政策卡(email-auto-reply m4,系統頁)。
 *
 * 信任階梯的駕駛艙:成績單(per-class 不改核准率 + 影子數,達標徽章
 * = 20 封 + 95%,拍板)+ 六鍵政策(總開關 🔒 黑鎖條才能開、影子
 * toggle、類別白名單、信心門檻、日上限、附件擋)+ 全部停止鈕
 * (無 confirm — 停永遠是安全方向)。硬編碼排除五類根本不在候選裡。
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Lock, MailCheck } from "lucide-react";
import { Badge, BadgeK, BtnB, BtnO, Pill, Src } from "./ws-ui";

/** UI 候選 = 全部分類 − alwaysEscalate − 硬編碼排除(server 同步擋)。 */
const CLASS_CANDIDATES = [
  "general_info",
  "new_inquiry",
  "booking_question",
  "flight_inquiry",
  "tour_comparison_request",
] as const;

export default function AutoSendPolicyCard() {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  const policyQ = trpc.agent.getAutoSendPolicyFull.useQuery({
    agentName: "inquiry" as never,
  });
  const readinessQ = trpc.commandCenter.autoReplyReadiness.useQuery();

  const [enabled, setEnabled] = useState(false);
  const [shadowMode, setShadowMode] = useState(true);
  const [classes, setClasses] = useState<string[]>([]);
  const [minConfidence, setMinConfidence] = useState(90);
  const [dailyCap, setDailyCap] = useState(10);
  const [blockAttachments, setBlockAttachments] = useState(true);
  const [enableConfirm, setEnableConfirm] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const p = policyQ.data;
    if (p && !loaded) {
      setEnabled(p.enabled);
      setShadowMode(p.shadowMode);
      setClasses(p.classes);
      setMinConfidence(p.minConfidence);
      setDailyCap(p.dailyCap);
      setBlockAttachments(p.blockAttachments);
      setLoaded(true);
    }
  }, [policyQ.data, loaded]);

  const saveMut = trpc.agent.setAutoSendPolicyFull.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.aspSaved"));
      utils.agent.getAutoSendPolicyFull.invalidate();
      setEnableConfirm(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const save = (over: Partial<{ enabled: boolean; shadowMode: boolean }> = {}) =>
    saveMut.mutate({
      agentName: "inquiry" as never,
      enabled: over.enabled ?? enabled,
      shadowMode: over.shadowMode ?? shadowMode,
      classes,
      minConfidence,
      dailyCap,
      blockAttachments,
    });

  const readiness = readinessQ.data;
  const byClass = new Map(
    (readiness?.classes ?? []).map((c) => [c.classification, c]),
  );
  const live = enabled && !shadowMode;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <MailCheck className="w-4 h-4" />
        <h3 className="text-[13px] font-semibold">
          {t("workspace.aspTitle")}
        </h3>
        {live ? (
          <BadgeK>{t("workspace.aspLive")}</BadgeK>
        ) : (
          <Badge>{t("workspace.aspShadowStage")}</Badge>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
        {/* 成績單 */}
        <div>
          <div className="text-[11px] font-semibold mb-1">
            {t("workspace.aspReadiness", { d: readiness?.windowDays ?? 14 })}
          </div>
          {(readiness?.classes ?? []).length === 0 ? (
            <p className="text-[11px] text-gray-400">
              {t("workspace.aspNoData")}
            </p>
          ) : (
            <div className="space-y-1">
              {(readiness?.classes ?? []).map((c) => (
                <div
                  key={c.classification}
                  className="flex items-center gap-2 text-[11px] flex-wrap"
                >
                  <span className="font-medium min-w-[140px]">
                    {c.classification}
                  </span>
                  <span className="text-gray-500">
                    {t("workspace.aspStats", {
                      n: c.sample,
                      rate: Math.round(c.unchangedRate * 100),
                      shadow: c.shadowCount,
                    })}
                  </span>
                  {c.qualified && <Pill>{t("workspace.aspQualified")}</Pill>}
                </div>
              ))}
            </div>
          )}
          <Src>
            {t("workspace.aspBar", {
              n: readiness?.minSample ?? 20,
              rate: Math.round((readiness?.minRate ?? 0.95) * 100),
            })}
          </Src>
        </div>

        {/* 類別白名單 */}
        <div>
          <div className="text-[11px] font-semibold mb-1">
            {t("workspace.aspClasses")}
          </div>
          <div className="flex flex-wrap gap-2">
            {CLASS_CANDIDATES.map((cls) => {
              const on = classes.includes(cls);
              const r = byClass.get(cls);
              const qualified = r?.qualified === true;
              return (
                <label
                  key={cls}
                  className={`flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg border cursor-pointer ${
                    on ? "border-black" : "border-gray-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setClasses((prev) =>
                        e.target.checked
                          ? [...prev, cls]
                          : prev.filter((c) => c !== cls),
                      )
                    }
                  />
                  {cls}
                  {on && !qualified && (
                    <span className="font-bold">
                      {t("workspace.aspNotQualified")}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <Src>{t("workspace.aspHardExcluded")}</Src>
        </div>

        {/* 門檻 / 上限 / 附件 / 影子 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <label className="space-y-0.5">
            <span className="text-gray-500 block">
              {t("workspace.aspMinConf")}
            </span>
            <input
              type="number"
              min={50}
              max={99}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-base sm:text-xs"
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-gray-500 block">
              {t("workspace.aspDailyCap")}
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={dailyCap}
              onChange={(e) => setDailyCap(Number(e.target.value))}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-base sm:text-xs"
            />
          </label>
          <label className="flex items-end gap-1.5 pb-1.5">
            <input
              type="checkbox"
              checked={blockAttachments}
              onChange={(e) => setBlockAttachments(e.target.checked)}
            />
            {t("workspace.aspBlockAttach")}
          </label>
          <label className="flex items-end gap-1.5 pb-1.5">
            <input
              type="checkbox"
              checked={shadowMode}
              onChange={(e) => setShadowMode(e.target.checked)}
            />
            {t("workspace.aspShadowToggle")}
          </label>
        </div>

        {/* 總開關 + 儲存 + 全停 */}
        {!enabled ? (
          <div className="rounded-lg bg-black text-white px-3 py-2.5 flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <label className="flex items-start gap-2 cursor-pointer text-[11px] leading-relaxed flex-1">
              <input
                type="checkbox"
                checked={enableConfirm}
                onChange={(e) => setEnableConfirm(e.target.checked)}
                className="mt-0.5"
              />
              <span>{t("workspace.aspEnableConfirm")}</span>
            </label>
            <BtnO
              onClick={() => {
                setEnabled(true);
                save({ enabled: true });
              }}
              disabled={!enableConfirm || saveMut.isPending}
            >
              <span className="text-white">{t("workspace.aspEnable")}</span>
            </BtnO>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setEnabled(false);
                save({ enabled: false });
              }}
              disabled={saveMut.isPending}
              className="px-3 py-1.5 rounded-lg bg-black text-white text-[12px] font-bold"
            >
              {t("workspace.aspStopAll")}
            </button>
            <span className="text-[10px] text-gray-500">
              {t("workspace.aspStopHint")}
            </span>
          </div>
        )}

        <div className="flex justify-end">
          <BtnB onClick={() => save()} disabled={saveMut.isPending}>
            {saveMut.isPending
              ? t("workspace.aspSaving")
              : t("workspace.aspSave")}
          </BtnB>
        </div>
      </div>
    </section>
  );
}
