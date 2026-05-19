/**
 * Agent desks — grid of clickable per-agent cards (Phase 5 module 5B).
 */
import { trpc } from "@/lib/trpc";
import { AGENT_DEFS, COLOR_MAP, type AgentDef, type AgentId } from "./agentDefs";

export function AgentDesks({
  active,
  onSelect,
}: {
  active: AgentId;
  onSelect: (id: AgentId) => void;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {AGENT_DEFS.map((a) => (
        <AgentDeskCard
          key={a.id}
          agent={a}
          isActive={active === a.id}
          onClick={() => onSelect(a.id)}
        />
      ))}
    </div>
  );
}

function AgentDeskCard({
  agent,
  isActive,
  onClick,
}: {
  agent: AgentDef;
  isActive: boolean;
  onClick: () => void;
}) {
  const office = trpc.agent.agentOffice.useQuery({ agentName: agent.id });
  const colors = COLOR_MAP[agent.color];
  const Icon = agent.icon;
  const data = office.data;
  const status = data?.status ?? "off";

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all ${
        isActive
          ? `${colors.bg} ${colors.border} ring-2 ${colors.ring}`
          : "bg-white border-gray-200 hover:border-gray-300"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`rounded-md p-1.5 ${isActive ? "bg-white" : colors.bg}`}>
          <Icon className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
        <StatusDot status={status} />
      </div>
      <div className="text-sm font-bold text-gray-900 mb-0.5">{agent.label}</div>
      <div className="text-[10px] text-gray-500 mb-2">{agent.name}</div>
      <div className="flex items-center justify-between text-xs">
        <div className="text-gray-500">
          今日{" "}
          <span className="font-bold text-gray-900 tabular-nums">
            {data?.todayCount ?? 0}
          </span>
        </div>
        {(data?.pendingCount ?? 0) > 0 ? (
          <div className="text-rose-600 font-bold tabular-nums">
            ⚠ {data?.pendingCount}
          </div>
        ) : (
          <div className="text-gray-400">—</div>
        )}
      </div>
    </button>
  );
}

export function StatusDot({ status }: { status: "active" | "demo" | "off" }) {
  const map = {
    active: { dot: "bg-emerald-500", label: "ON" },
    demo: { dot: "bg-amber-400", label: "DEMO" },
    off: { dot: "bg-gray-300", label: "OFF" },
  } as const;
  const m = map[status];
  return (
    <div className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
        {m.label}
      </span>
    </div>
  );
}
