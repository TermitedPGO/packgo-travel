/**
 * ws-ui/card — WorkspaceCard 卡片文法本體 + 動作元件 (按鈕 / 處理好了 toggle)。
 *
 * The card grammar — white, rounded-xl, gray border, black LEFT rule whose
 * width/style encodes state (done=1px / err=4px / running·wait=2px dashed /
 * else 2px solid). Header row: lock + badge + who + time + state, then body,
 * with optional jump + 處理好了 toggle on the right.
 */
import type { ReactNode } from "react";
import { Check, Lock, ChevronRight } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { Badge, BadgeK, WhoChip, StateChip, type CardState } from "./chips";

export function BtnB({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2.5 py-1 rounded-lg bg-black text-white text-[11px] font-medium disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function BtnO({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2.5 py-1 rounded-lg border border-gray-300 text-gray-700 text-[11px] font-medium disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** 未處理 / 處理好了 checkbox (top-right of every card). */
export function StatusToggle({
  on,
  onToggle,
  busy,
}: {
  on: boolean;
  onToggle: () => void;
  busy?: boolean;
}) {
  const { t } = useLocale();
  return (
    <button
      onClick={onToggle}
      disabled={busy}
      className={`flex items-center gap-1 text-[10px] flex-shrink-0 ${
        on ? "text-black" : "text-gray-400"
      } disabled:opacity-50`}
    >
      <span
        className={`w-4 h-4 rounded-[4px] flex items-center justify-center ${
          on
            ? "bg-black text-white"
            : "border-2 border-gray-300"
        }`}
      >
        {on && <Check className="w-3 h-3" />}
      </span>
      <span>{on ? t("workspace.handled") : t("workspace.unhandled")}</span>
    </button>
  );
}

export type WorkspaceCardProps = {
  /** type badge text (報價 / 詢問 / 退款 …). */
  type: string;
  /** black-filled badge instead of bordered (碰錢 / 等你決定). */
  emphasize?: boolean;
  /** show the 🔒 lock glyph before the badge. */
  lock?: boolean;
  /** customer display name for the @chip (omit → no chip unless whoCompany). */
  who?: string;
  /** company-wide item → 🏢 全公司 chip (overrides who). */
  whoCompany?: boolean;
  time?: string;
  state?: CardState;
  waitLabel?: string;
  /** main body (string or rich nodes). */
  children: ReactNode;
  /** jump affordance label e.g.「去陳美玲」(omit → none). */
  jumpLabel?: string;
  onJump?: () => void;
  /** 處理好了 toggle. Omit handled to hide the toggle entirely. */
  handled?: boolean;
  onToggle?: () => void;
  toggleBusy?: boolean;
};

export function WorkspaceCard(props: WorkspaceCardProps) {
  const {
    type,
    emphasize,
    lock,
    who,
    whoCompany,
    time,
    state = "none",
    waitLabel,
    children,
    jumpLabel,
    onJump,
    handled,
    onToggle,
    toggleBusy,
  } = props;

  const dim = state === "done" ? "opacity-40" : "";
  const leftWidth =
    state === "done" ? "1px" : state === "err" ? "4px" : "2px";
  const leftStyle = state === "running" || state === "wait" ? "dashed" : "solid";

  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 p-3 ${dim}`}
      style={{
        borderLeftWidth: leftWidth,
        borderLeftStyle: leftStyle,
        borderLeftColor: "#000",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {lock && <Lock className="w-3.5 h-3.5" />}
            {emphasize ? <BadgeK>{type}</BadgeK> : <Badge>{type}</Badge>}
            {(who || whoCompany) && (
              <WhoChip who={who} company={whoCompany} />
            )}
            {time && <span className="text-[10px] text-gray-400">{time}</span>}
            {state !== "none" && (
              <span className="ml-1">
                <StateChip state={state} waitLabel={waitLabel} />
              </span>
            )}
          </div>
          <div className="text-[12.5px] leading-relaxed">{children}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {jumpLabel && (
            <button
              onClick={onJump}
              className="self-start text-[11px] text-gray-400 flex items-center gap-0.5"
            >
              {jumpLabel}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
          {handled !== undefined && onToggle && (
            <StatusToggle on={handled} onToggle={onToggle} busy={toggleBusy} />
          )}
        </div>
      </div>
    </div>
  );
}
