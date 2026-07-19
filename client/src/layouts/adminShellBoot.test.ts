/**
 * adminShellBoot —— 1A0a boot telemetry orchestration Seam(plan v4.3 §3.2.9)。
 *
 * 契約(換版證明鏈的承重面,全注入直測):
 * - guard 已存在 → "skipped",不呼 report。
 * - await report 成功 → 先寫 guard 再回 "reported"。
 * - report reject → 不寫 guard、回 "failed",下次 mount 可重試。
 * - mutation 呼叫之前絕不寫 guard。
 * - 新 sha → guard key 不同,重報。
 * - clientKind:display-mode standalone → pwa-standalone,否則 desktop-browser。
 * - shortBuildSha:footer 顯示值唯一切法(前 7 位)。
 */
import { describe, expect, it, vi } from "vitest";
import {
  detectClientKind,
  reportBootOnce,
  shortBuildSha,
  type BootPayload,
} from "./adminShellBoot";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const mm = (standalone: boolean) => (q: string) => ({
  matches: q === "(display-mode: standalone)" && standalone,
});

describe("detectClientKind / shortBuildSha", () => {
  it("standalone → pwa-standalone;否則 desktop-browser", () => {
    expect(detectClientKind(mm(true))).toBe("pwa-standalone");
    expect(detectClientKind(mm(false))).toBe("desktop-browser");
  });
  it("shortBuildSha = 前 7 位(footer 同源)", () => {
    expect(shortBuildSha(SHA)).toBe("0123456");
  });
});

describe("reportBootOnce — orchestration 契約", () => {
  it("成功:呼叫前 guard 不存在、成功後 guard 寫入、payload 精確", async () => {
    const storage = fakeStorage();
    const seen: BootPayload[] = [];
    const report = vi.fn(async (p: BootPayload) => {
      // mutation 呼叫當下 guard 必須尚未寫入
      expect(storage.map.size).toBe(0);
      seen.push(p);
      return { status: "reported" };
    });
    const r = await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report });
    expect(r).toBe("reported");
    expect(seen).toEqual([{ buildSha: SHA, clientKind: "desktop-browser" }]);
    expect(storage.map.size).toBe(1);
  });

  it("PWA 判型進 payload", async () => {
    const storage = fakeStorage();
    const report = vi.fn(async (p: BootPayload) => {
      expect(p.clientKind).toBe("pwa-standalone");
      return { status: "reported" };
    });
    await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(true), report });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("reject:不寫 guard、回 failed,下次可重試成功", async () => {
    const storage = fakeStorage();
    const failing = vi.fn(async () => {
      throw new Error("network");
    });
    const r1 = await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: failing });
    expect(r1).toBe("failed");
    expect(storage.map.size).toBe(0); // guard 未寫,可重試

    const ok = vi.fn(async () => ({ status: "reported" as const }));
    const r2 = await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: ok });
    expect(r2).toBe("reported");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("server 回 skipped(DB 暫時不可用)→ failed、不寫 guard,可重試(P2-1)", async () => {
    const storage = fakeStorage();
    const skipped = vi.fn(async () => ({ status: "skipped" as const }));
    const r = await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: skipped });
    expect(r).toBe("failed");
    expect(storage.map.size).toBe(0); // outage 不吃掉整個 session
  });

  it("server 回 failed / 未知形狀 → failed、不寫 guard(只認 reported|deduped)", async () => {
    const storage = fakeStorage();
    const failed = vi.fn(async () => ({ status: "failed" as const }));
    expect(await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: failed })).toBe("failed");
    const weird = vi.fn(async () => ({}) as unknown);
    expect(await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: weird })).toBe("failed");
    expect(storage.map.size).toBe(0);
  });

  it("server 回 deduped → 視同已證(寫 guard,不再重報)", async () => {
    const storage = fakeStorage();
    const deduped = vi.fn(async () => ({ status: "deduped" as const }));
    expect(await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: deduped })).toBe("reported");
    expect(storage.map.size).toBe(1);
  });

  it("guard 已存在 → skipped,不呼 report", async () => {
    const storage = fakeStorage();
    const ok = vi.fn(async () => ({ status: "reported" as const }));
    await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: ok });
    const r = await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: ok });
    expect(r).toBe("skipped");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("新 sha → 不同 guard key,重報", async () => {
    const storage = fakeStorage();
    const ok = vi.fn(async () => ({ status: "reported" as const }));
    await reportBootOnce({ storage, buildSha: SHA, matchMediaFn: mm(false), report: ok });
    const newSha = "fedcba9876543210fedcba9876543210fedcba98";
    const r = await reportBootOnce({ storage, buildSha: newSha, matchMediaFn: mm(false), report: ok });
    expect(r).toBe("reported");
    expect(ok).toHaveBeenCalledTimes(2);
  });
});
