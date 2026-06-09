/**
 * SidebarRail — 整合工作台側邊欄的收合 56px icon 版。
 * 從 WorkspaceSidebar 拆出(CLAUDE.md §9.6 300 行紅線)。
 */
import type { ReactNode } from "react";
import { Bot, Sun, Building2, PanelLeft } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type { WsView } from "./WorkspaceSidebar";

export default function SidebarRail({
  view,
  onSelect,
  todayCount,
  onExpand,
  initial,
  userTitle,
}: {
  view: WsView;
  onSelect: (v: WsView) => void;
  todayCount: number;
  onExpand: () => void;
  initial: string;
  userTitle: string;
}) {
  const { t } = useLocale();

  const railBtn = (
    active: boolean,
    icon: ReactNode,
    title: string,
    onClick: () => void,
    dot?: boolean,
  ) => (
    <button
      title={title}
      onClick={onClick}
      className={`relative w-9 h-9 rounded-xl flex items-center justify-center ${
        active ? "bg-black text-white" : "text-gray-500 hover:bg-gray-100"
      }`}
    >
      {icon}
      {dot && (
        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-black border border-white" />
      )}
    </button>
  );

  return (
    <div className="w-[56px] flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col items-center py-3">
      <button
        onClick={onExpand}
        title={t("workspace.expandSidebar")}
        className="w-9 h-9 rounded-md hover:bg-gray-200 flex items-center justify-center text-gray-500 mb-2"
      >
        <PanelLeft className="w-4 h-4" />
      </button>
      <div className="flex-1 flex flex-col items-center gap-1.5">
        {railBtn(
          view.type === "ai",
          <Bot className="w-4 h-4" />,
          t("workspace.ai"),
          () => onSelect({ type: "ai" }),
        )}
        {railBtn(
          view.type === "today",
          <Sun className="w-4 h-4" />,
          t("workspace.today"),
          () => onSelect({ type: "today" }),
          todayCount > 0,
        )}
        {railBtn(
          view.type === "company",
          <Building2 className="w-4 h-4" />,
          t("workspace.company"),
          () => onSelect({ type: "company", sub: "ledger" }),
        )}
      </div>
      <div
        className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center text-[11px] font-bold"
        title={userTitle}
      >
        {initial}
      </div>
    </div>
  );
}
