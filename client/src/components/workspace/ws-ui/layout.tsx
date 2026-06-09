/**
 * ws-ui/layout — 版面元件:group header 與 serif 問候列。
 */
import type { ReactNode } from "react";
import { useLocale } from "@/contexts/LocaleContext";

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
