/**
 * ws-ui/chips — 卡片文法的小元件:badge / pill / chip / 狀態語言。
 *
 * Faithful React port of PackGo_示意圖/admin-cards-states.html。
 * Pure black & white. State is shown by weight / border / dimming, never color.
 */
import type { ReactNode } from "react";
import { Lock, AlertTriangle, Hourglass } from "lucide-react";
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
