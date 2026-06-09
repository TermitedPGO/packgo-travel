/**
 * WorkspaceSidebar — 整合工作台側邊欄 (faithful port of mockup `navTop`).
 *
 *   PACK&GO + 收合 · 搜尋框
 *   與 AI 對話        (隨手問,不綁客人)
 *   今日待辦          (所有客人 roll-up)        [pending badge]
 *   全公司事務        (記帳·月報·行銷·供應商)   [badge]
 *     └ 記帳 / 月報 / 行銷 / 供應商  (indented sub-items)
 *   客戶
 *     └ 每位客人一列 (頭像 + 名 + email)
 *   Jeff footer
 *
 * Pure black & white, rounded, line icons. Active row = black fill.
 * Collapsible to a 56px icon rail (localStorage "workspace.sidebar.collapsed").
 */
import { useState, type ReactNode } from "react";
import {
  Bot,
  Sun,
  Building2,
  Search,
  PanelLeft,
  LogOut,
} from "lucide-react";

export type CompanySub = "ledger" | "reports" | "marketing" | "suppliers";

export type WsView =
  | { type: "ai" }
  | { type: "today" }
  | { type: "company"; sub: CompanySub }
  | { type: "customer"; userId: number };

export type SidebarCustomer = { id: number; name: string | null; email: string | null };

const COMPANY_SUBS: { id: CompanySub; label: string }[] = [
  { id: "ledger", label: "記帳" },
  { id: "reports", label: "月報" },
  { id: "marketing", label: "行銷" },
  { id: "suppliers", label: "供應商" },
];

function Count({ n, light }: { n: number; light?: boolean }) {
  if (!n) return null;
  return (
    <span
      className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
        light ? "bg-white text-black" : "bg-black text-white"
      }`}
    >
      {n}
    </span>
  );
}

export default function WorkspaceSidebar({
  view,
  onSelect,
  todayCount,
  companyCount,
  customers,
  user,
  onLogout,
}: {
  view: WsView;
  onSelect: (v: WsView) => void;
  todayCount: number;
  companyCount: number;
  customers: SidebarCustomer[];
  user?: { name?: string | null; email?: string | null } | null;
  onLogout?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("workspace.sidebar.collapsed") === "1",
  );
  const [q, setQ] = useState("");

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("workspace.sidebar.collapsed", next ? "1" : "0");
      return next;
    });
  };

  const initial = (user?.name || user?.email || "J").charAt(0).toUpperCase();

  // ── collapsed icon rail ──────────────────────────────────────────────
  if (collapsed) {
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
          onClick={toggleCollapse}
          title="展開側邊欄"
          className="w-9 h-9 rounded-md hover:bg-gray-200 flex items-center justify-center text-gray-500 mb-2"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 flex flex-col items-center gap-1.5">
          {railBtn(view.type === "ai", <Bot className="w-4 h-4" />, "與 AI 對話", () =>
            onSelect({ type: "ai" }),
          )}
          {railBtn(
            view.type === "today",
            <Sun className="w-4 h-4" />,
            "今日待辦",
            () => onSelect({ type: "today" }),
            todayCount > 0,
          )}
          {railBtn(
            view.type === "company",
            <Building2 className="w-4 h-4" />,
            "全公司事務",
            () => onSelect({ type: "company", sub: "ledger" }),
          )}
        </div>
        <div
          className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center text-[11px] font-bold"
          title={user?.name || user?.email || "Jeff"}
        >
          {initial}
        </div>
      </div>
    );
  }

  // ── expanded sidebar ─────────────────────────────────────────────────
  const Row = ({
    active,
    icon,
    label,
    sub,
    badge,
    onClick,
  }: {
    active: boolean;
    icon: ReactNode;
    label: string;
    sub?: string;
    badge?: number;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 ${
        active ? "bg-black text-white" : "hover:bg-gray-100"
      }`}
    >
      <div
        className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
          active ? "bg-white text-black" : "bg-black text-white"
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">{label}</div>
        {sub && (
          <div
            className={`text-[11px] truncate ${active ? "text-gray-300" : "text-gray-400"}`}
          >
            {sub}
          </div>
        )}
      </div>
      {badge ? <Count n={badge} light={active} /> : null}
    </button>
  );

  const filtered = customers.filter((c) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      (c.name || "").toLowerCase().includes(s) ||
      (c.email || "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="w-[248px] flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
      <div className="h-12 flex items-center justify-between px-3.5 border-b border-gray-100 flex-shrink-0">
        <span className="text-sm font-semibold">PACK&amp;GO</span>
        <button
          onClick={toggleCollapse}
          title="收合側邊欄"
          className="w-7 h-7 rounded-md hover:bg-gray-200 flex items-center justify-center text-gray-500"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-gray-100">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋客人 / 事務"
            className="flex-1 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-2 space-y-1">
        <Row
          active={view.type === "ai"}
          icon={<Bot className="w-4 h-4" />}
          label="與 AI 對話"
          sub="隨手問,不綁客人"
          onClick={() => onSelect({ type: "ai" })}
        />
        <Row
          active={view.type === "today"}
          icon={<Sun className="w-4 h-4" />}
          label="今日待辦"
          sub="所有客人 roll-up"
          badge={todayCount}
          onClick={() => onSelect({ type: "today" })}
        />
        <Row
          active={view.type === "company"}
          icon={<Building2 className="w-4 h-4" />}
          label="全公司事務"
          sub="記帳 · 月報 · 行銷 · 供應商"
          badge={companyCount}
          onClick={() => onSelect({ type: "company", sub: "ledger" })}
        />
        <div className="pl-3 space-y-0.5 py-0.5">
          {COMPANY_SUBS.map((s) => {
            const on = view.type === "company" && view.sub === s.id;
            return (
              <button
                key={s.id}
                onClick={() => onSelect({ type: "company", sub: s.id })}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between ${
                  on ? "bg-gray-200" : "hover:bg-gray-100"
                }`}
              >
                <span className="text-[12px]">{s.label}</span>
              </button>
            );
          })}
        </div>

        <div className="text-[10px] font-semibold text-gray-400 px-1 pt-2 pb-1">
          客戶
        </div>
        {filtered.map((c) => {
          const on = view.type === "customer" && view.userId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => onSelect({ type: "customer", userId: c.id })}
              className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center gap-2.5 ${
                on ? "bg-black text-white" : "hover:bg-gray-100"
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  on ? "bg-white text-black" : "bg-gray-200 text-gray-700"
                }`}
              >
                {(c.name || c.email || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {c.name || c.email}
                </div>
                <div
                  className={`text-[11px] truncate ${on ? "text-gray-300" : "text-gray-400"}`}
                >
                  {c.email}
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-2.5 py-3 text-[11px] text-gray-400">查無客人</div>
        )}
      </div>

      <div className="h-11 border-t border-gray-100 flex items-center gap-2 px-3.5 flex-shrink-0">
        <div className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center text-[10px] font-bold">
          {initial}
        </div>
        <span className="text-xs flex-1 truncate">
          {user?.name || user?.email || "Jeff"}
        </span>
        {onLogout && (
          <button
            onClick={onLogout}
            title="登出"
            className="w-6 h-6 rounded-md hover:bg-gray-200 flex items-center justify-center text-gray-400"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
