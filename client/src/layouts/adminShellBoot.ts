/**
 * adminShellBoot —— 1A0a build-marker boot telemetry 的純 orchestration(plan v4.3 §3.2.9)。
 *
 * 換版證明鏈:client bundle 注入 __BUILD_SHA__ → AdminShell 掛載時經 reportBootOnce
 * 上報一次(admin-authenticated clientBoot.report,closed payload)→ server 寫
 * append-only adminAuditLog → Jeff 的 desktop 與 PWA 兩 clientKind audit 列齊 =
 * 1A0b server-block 的硬前置兩證之一(另一證 = footer 短 sha 口頭確認)。
 *
 * 全部依賴注入(storage / matchMedia / report),node vitest 可直測;AdminShell 只接線。
 */

export type ClientKind = "desktop-browser" | "pwa-standalone";

export interface BootPayload {
  buildSha: string;
  clientKind: ClientKind;
}

/** display-mode: standalone(iOS 加入主畫面 PWA)→ pwa-standalone;否則 desktop-browser。 */
export function detectClientKind(matchMediaFn: (q: string) => { matches: boolean }): ClientKind {
  return matchMediaFn("(display-mode: standalone)").matches
    ? "pwa-standalone"
    : "desktop-browser";
}

/** footer 顯示的短 sha —— 唯一切法來源(前 7 位,與 git 慣例一致)。 */
export function shortBuildSha(sha: string): string {
  return sha.slice(0, 7);
}

/** per-SHA session guard key(key 含 sha:新版部署後自然重報,同版一 session 一次)。 */
function guardKey(buildSha: string): string {
  return `packgo:client-boot-reported:${buildSha}`;
}

/**
 * 一 session 一次的上報 orchestration。契約(1A0a 固定,adminShellBoot.test.ts 釘死;
 * Codex 7-18 P2-1 跨層 acknowledgement 修正):
 * - guard 已存在 → 回 "skipped",不呼 report。
 * - **只有 server 明確回 status "reported"|"deduped" 才寫 guard**(server 端已
 *   exact re-query 證明 audit 列持久化)。
 * - server 回 "skipped"(如 DB 暫時不可用)/"failed"/未知形狀、或 report reject
 *   → **不寫 guard**、回 "failed" —— 下次 mount 可重試,暫時 outage 不吃掉整個 session。
 * - mutation 呼叫之前絕不寫 guard。
 */
export async function reportBootOnce(deps: {
  storage: Pick<Storage, "getItem" | "setItem">;
  buildSha: string;
  matchMediaFn: (q: string) => { matches: boolean };
  report: (payload: BootPayload) => Promise<{ status: string } | unknown>;
}): Promise<"reported" | "skipped" | "failed"> {
  const key = guardKey(deps.buildSha);
  if (deps.storage.getItem(key) !== null) return "skipped";
  const payload: BootPayload = {
    buildSha: deps.buildSha,
    clientKind: detectClientKind(deps.matchMediaFn),
  };
  let res: unknown;
  try {
    res = await deps.report(payload);
  } catch {
    return "failed";
  }
  const status = typeof res === "object" && res !== null ? (res as { status?: unknown }).status : undefined;
  if (status !== "reported" && status !== "deduped") return "failed";
  deps.storage.setItem(key, "1");
  return "reported";
}
