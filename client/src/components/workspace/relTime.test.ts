import { describe, expect, it } from "vitest";
import { formatRelTime, type TranslateFn } from "./relTime";

/** Echo translator — returns the key plus any params so assertions can see both. */
const t: TranslateFn = (key, params) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

const NOW = new Date("2026-06-09T12:00:00Z").getTime();
const min = (n: number) => NOW - n * 60_000;

describe("formatRelTime", () => {
  it("returns empty string for invalid input", () => {
    expect(formatRelTime("not-a-date", t, NOW)).toBe("");
    expect(formatRelTime(0, t, NOW)).toBe("");
    expect(formatRelTime(-5, t, NOW)).toBe("");
  });

  it("under a minute → timeJustNow", () => {
    expect(formatRelTime(NOW - 20_000, t, NOW)).toBe("workspace.timeJustNow");
  });

  it("minutes → timeMinAgo with n", () => {
    expect(formatRelTime(min(5), t, NOW)).toBe(
      'workspace.timeMinAgo:{"n":5}',
    );
    expect(formatRelTime(min(59), t, NOW)).toBe(
      'workspace.timeMinAgo:{"n":59}',
    );
  });

  it("hours → timeHourAgo with n", () => {
    expect(formatRelTime(min(120), t, NOW)).toBe(
      'workspace.timeHourAgo:{"n":2}',
    );
  });

  it("one day → timeYesterday, multiple days → timeDaysAgo", () => {
    expect(formatRelTime(min(24 * 60), t, NOW)).toBe(
      "workspace.timeYesterday",
    );
    expect(formatRelTime(min(3 * 24 * 60), t, NOW)).toBe(
      'workspace.timeDaysAgo:{"n":3}',
    );
  });

  it("accepts Date and ISO string inputs", () => {
    expect(formatRelTime(new Date(min(10)), t, NOW)).toBe(
      'workspace.timeMinAgo:{"n":10}',
    );
    expect(formatRelTime(new Date(min(10)).toISOString(), t, NOW)).toBe(
      'workspace.timeMinAgo:{"n":10}',
    );
  });
});
