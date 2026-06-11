/**
 * WorkspaceSystem — 批8 系統頁 (mockup 後台_10,單頁 5 段,乾淨黑白).
 *
 * 「覺得哪裡不對勁才來查的頁」。唯讀 reuse 既有 query,零新後端。
 * agent 開關 / 技能試跑無後端 — 不放死按鈕(gaps 見 batch-8-system.md)。
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Cpu, Zap, AlertTriangle } from "lucide-react";
import { Pill } from "./ws-ui";
import { formatRelTime } from "./relTime";
import SystemLogsSections from "./SystemLogsSections";

export default function WorkspaceSystem() {
  const { t } = useLocale();
  return (
    <div className="space-y-5">
      <p className="text-[11px] text-gray-500">{t("workspace.sysSub")}</p>
      <AgentSection />
      <SkillsSection />
      <SystemLogsSections />
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px text-gray-500" />
        <p className="text-[12px] text-gray-600 leading-relaxed">
          {t("workspace.sysCleanupNote")}
        </p>
      </div>
    </div>
  );
}

function SectionHead({
  icon: Icon,
  title,
}: {
  icon: typeof Cpu;
  title: string;
}) {
  return (
    <h3 className="text-[12px] font-semibold mb-2 flex items-center gap-1.5">
      <Icon className="w-4 h-4" />
      {title}
    </h3>
  );
}

/* ── 自主 Agent(7 天統計;無開關後端,唯讀) ── */

function AgentSection() {
  const { t } = useLocale();
  const statusQ = trpc.admin.getAgentOfficeStatus.useQuery();
  const stats = statusQ.data?.agentTodayStats ?? [];

  return (
    <section>
      <SectionHead icon={Cpu} title={t("workspace.sysAgents")} />
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {statusQ.isLoading && (
          <p className="text-xs text-gray-400 text-center py-4">
            {t("workspace.loading")}
          </p>
        )}
        {!statusQ.isLoading && stats.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">
            {t("workspace.sysAgentsEmpty")}
          </p>
        )}
        <div className="divide-y divide-gray-100 text-[12px]">
          {stats.map((s) => (
            <div
              key={s.agentName}
              className="grid grid-cols-[1.2fr_0.8fr_0.8fr] gap-2 px-3 py-2.5 items-center min-w-0"
            >
              <div className="font-semibold truncate">{s.agentName}</div>
              <div className="text-gray-500">
                {t("workspace.sysAgentCalls", { n: s.calls })}
              </div>
              <div className="text-gray-500 text-right">
                {s.lastActive ? formatRelTime(s.lastActive, t) : "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5">
        {t("workspace.sysAgentsNote")}
      </p>
    </section>
  );
}

/* ── AI 技能(唯讀列表;試跑無後端) ── */

function SkillsSection() {
  const { t } = useLocale();
  const skillsQ = trpc.skills.list.useQuery();
  const skills = skillsQ.data ?? [];

  return (
    <section>
      <SectionHead icon={Zap} title={t("workspace.sysSkills")} />
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {!skillsQ.isLoading && skills.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">
            {t("workspace.sysSkillsEmpty")}
          </p>
        )}
        <div className="divide-y divide-gray-100 text-[12px]">
          {skills.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 px-3 py-2.5 min-w-0"
            >
              <div className="w-[210px] font-semibold flex-shrink-0 truncate">
                {s.skillName}
              </div>
              <div className="flex-1 text-gray-500 min-w-0 truncate">
                {s.description}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {(s.usageCount ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-400">
                    ×{s.usageCount}
                  </span>
                )}
                <Pill>
                  {s.isActive
                    ? t("workspace.sysSkillOn")
                    : t("workspace.sysSkillOff")}
                </Pill>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
