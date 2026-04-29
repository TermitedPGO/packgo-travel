/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { BarChart2, FileText, Building2 } from "lucide-react";
import AiCostTab from "./AiCostTab";
import AiSessionReport from "./AiSessionReport";
import AiOffice from "./AiOffice";
import { useLocale } from "@/contexts/LocaleContext";

type HubTab = "office" | "report" | "session";

export default function AiHubTab() {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<HubTab>("office");

  // v72: tab labels and page header migrated to i18n. Previously rendered as
  // hardcoded Chinese even on EN locale.
  const tabs: { id: HubTab; icon: any; label: string; desc: string }[] = [
    { id: "office",  icon: Building2, label: t('aiHubTab.officeLabel'),  desc: t('aiHubTab.officeDesc') },
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
        {activeTab === "office"  && <AiOffice />}
        {activeTab === "report"  && <AiCostTab />}
        {activeTab === "session" && <AiSessionReport />}
      </div>
    </div>
  );
}
