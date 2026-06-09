/**
 * ws-ui — 整合工作台設計系統 primitives (B&W card grammar + state language).
 *
 * Faithful React port of the mockup vocabulary in
 *   PackGo_示意圖/admin-cards-states.html  (one card grammar, one state language)
 *   PackGo_示意圖/admin-full-pages.html     (tcard / greeting / group header)
 *
 * Pure black & white. State is shown by weight / border / dimming, never color:
 *   等你決定 (decide)  → pill「等你決定」
 *   處理中   (running) → dashed border + spinner
 *   等外部   (wait)    → dashed border + hourglass + label
 *   處理好了 (done)    → 40% opacity + thin left rule
 *   出錯     (err)     → 4px black left rule + 出錯 chip
 *
 * Everything here is presentational. No data fetching, no money actions.
 */
import type { ReactNode } from "react";
import {
  Check,
  Lock,
  AlertTriangle,
  Hourglass,
  ChevronRight,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

export type CardState = "decide" | "running" | "wait" | "done" | "err" | "none";

/** Bordered type chip (default emphasis). */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-bold tracking-[0.05em] px-1.5 py-0.5 rounded-md border border-gray-300">
      {children}
    </span>
  );
}

/** Black-filled type chip (high emphasis — 碰錢 / 等你決定 type). */
export function BadgeK({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-bold tracking-[0.05em] px-1.5 py-0.5 rounded-md bg-black text-white">
      {children}
    </span>
  );
}

/** 是誰的事: @客戶名 or 🏢 全公司. */
export function WhoChip({
  who,
  company,
}: {
  /** customer display name (ignored when company). */
  who?: string;
  /** company-wide item → 🏢 + localized 全公司 label. */
  company?: boolean;
}) {
  const { t } = useLocale();
  return (
    <span
      className={`text-[11px] font-medium ${company ? "text-gray-500" : ""}`}
    >
      {company ? `🏢 ${t("workspace.whoCompany")}` : `@${who ?? ""}`}
    </span>
  );
}

/** Bordered pill (status / meta). */
export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-gray-400">
      {children}
    </span>
  );
}

/** 🔒 + label pill (信託 / 加密 etc.). */
export function Vault({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-gray-400 inline-flex items-center gap-1">
      <Lock className="w-3 h-3" />
      {children}
    </span>
  );
}

/** State chip — the single state language across the whole workspace. */
export function StateChip({
  state,
  waitLabel,
}: {
  state: CardState;
  waitLabel?: string;
}) {
  const { t } = useLocale();
  if (state === "decide") return <Pill>{t("workspace.stateDecide")}</Pill>;
  if (state === "running")
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-gray-400 inline-flex items-center gap-1">
        <span className="w-2.5 h-2.5 rounded-full border-2 border-black border-t-transparent inline-block animate-spin" />
        {t("workspace.stateRunning")}
      </span>
    );
  if (state === "wait")
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-gray-400 inline-flex items-center gap-1">
        <Hourglass className="w-3 h-3" />
        {waitLabel ?? t("workspace.stateWait")}
      </span>
    );
  if (state === "err")
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-black text-white">
        {t("workspace.stateErr")}
      </span>
    );
  return null;
}

export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 mt-2 text-[11px] font-medium">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
      <span>{children}</span>
    </div>
  );
}

export function Src({ children }: { children: ReactNode }) {
  return <div className="text-[10px] text-gray-400 mt-1.5">{children}</div>;
}

/** key→value line (right value bold unless muted). */
export function Kv({
  k,
  v,
  muted,
}: {
  k: ReactNode;
  v: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between text-[12.5px]">
      <span className="text-gray-500">{k}</span>
      <span className={muted ? "text-gray-500" : "font-semibold"}>{v}</span>
    </div>
  );
}

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

/** Group header — 「需要你決定 (5)」. */
export function GroupHeader({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <span className="text-sm font-semibold">{title}</span>
      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center">
        {count}
      </span>
    </div>
  );
}

/** Serif greeting block — 「下午好,Jeff」+ date / counts line. */
export function Greeting({
  name,
  line,
  right,
}: {
  name: string;
  line: string;
  right?: ReactNode;
}) {
  const { t } = useLocale();
  const hour = new Date().getHours();
  const part =
    hour < 12
      ? t("workspace.greetMorning")
      : hour < 18
        ? t("workspace.greetAfternoon")
        : t("workspace.greetEvening");
  return (
    <div className="flex items-end justify-between">
      <div>
        <div
          className="text-2xl font-bold"
          style={{ fontFamily: '"Noto Serif TC", serif' }}
        >
          {part}
          {name && (
            <>
              {t("common.greetingComma")}
              {name}
            </>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1">{line}</div>
      </div>
      {right}
    </div>
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

/**
 * The card grammar — white, rounded-xl, gray border, black LEFT rule whose
 * width/style encodes state (done=1px / err=4px / running·wait=2px dashed /
 * else 2px solid). Header row: lock + badge + who + time + state, then body,
 * with optional jump + 處理好了 toggle on the right.
 */
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
