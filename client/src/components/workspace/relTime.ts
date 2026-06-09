/**
 * formatRelTime — shared relative-time formatter for workspace cards.
 *
 * Replaces the duplicated hardcoded-Chinese relTime() helpers that lived in
 * WorkspaceToday / CustomerInbox (CLAUDE.md §4.1: no hardcoded zh in JSX).
 * Takes the locale `t` so it stays a pure, testable function.
 */
export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export function formatRelTime(
  v: Date | string | number,
  t: TranslateFn,
  now: number = Date.now(),
): string {
  const ts = v instanceof Date ? v.getTime() : new Date(v).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const min = Math.round((now - ts) / 60000);
  if (min < 1) return t("workspace.timeJustNow");
  if (min < 60) return t("workspace.timeMinAgo", { n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("workspace.timeHourAgo", { n: hr });
  const d = Math.round(hr / 24);
  return d === 1
    ? t("workspace.timeYesterday")
    : t("workspace.timeDaysAgo", { n: d });
}
