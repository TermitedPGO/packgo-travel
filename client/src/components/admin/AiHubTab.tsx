/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { BarChart2, FileText, Image } from "lucide-react";
import AiCostTab from "./AiCostTab";
import AiSessionReport from "./AiSessionReport";
import PosterGenPanel from "./PosterGenPanel";
import { useLocale } from "@/contexts/LocaleContext";

// v78z-z2 Sprint 8: removed "office" sub-tab (AiOffice department-org-chart with
// per-agent emoji icons). Per UX audit it was an engineering demo, not a product
// surface. AiOffice.tsx + AiTeamRoster.tsx remain on disk but no longer mount.
// v78z-z3 Sprint 11: added "poster" sub-tab (gpt-image-2 poster generator).
type HubTab = "poster" | "report" | "session";

export default function AiHubTab() {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<HubTab>("poster");

  // v72: tab labels and page header migrated to i18n. Previously rendered as
  // hardcoded Chinese even on EN locale.
  const tabs: { id: HubTab; icon: any; label: string; desc: string }[] = [
    { id: "poster",  icon: Image,     label: t('aiHubTab.posterLabel'),  desc: t('aiHubTab.posterDesc') },
    { id: "report",  icon: BarChart2, label: t('aiHubTab.reportLabel'),  desc: t('aiHubTab.reportDesc') },
    { id: "session", icon: FileText,  label: t('aiHubTab.sessionLabel'), desc: t('aiHubTab.sessionDesc') },
  ];

  return (
    <div className="space-y-0">
      {/* Page Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">{t('aiHubTab.title')}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t('aiHubTab.subtitle')}</p>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors relative
                ${isActive
                  ? "text-gray-900 border-b-2 border-black -mb-px"
                  : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px"
                }
              `}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
              {isActive && (
                <span className="hidden sm:inline text-xs text-gray-400 font-normal ml-1">
                  — {tab.desc}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "poster"  && <PosterGenPanel />}
        {activeTab === "report"  && <AiCostTab />}
        {activeTab === "session" && <AiSessionReport />}
      </div>
    </div>
  );
}
