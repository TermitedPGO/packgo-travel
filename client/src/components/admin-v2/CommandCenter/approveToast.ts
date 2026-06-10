/**
 * approveToast — honest outcome → toast mapping for approval decisions.
 *
 * Extracted from ApprovalInbox so the workspace 今日待辦 review dialog shares
 * the EXACT same honesty rules (progress.md B3):
 *   - "sent" on the cs lane is the only case that truly emails the customer
 *     → 「已送出」. quote / marketing / finance executors only record in v1
 *     (Jeff still sends by hand) → claiming 已送出 would be a lie, show 已記錄.
 *   - "failed" surfaces the executor errorMessage, never a fake success.
 *   - anything else (no executor registered) → plain 已通過.
 */
import type { ApprovalLane } from "./types";

export interface ApproveOutcomeLike {
  status: string;
  errorMessage?: string | null;
}

export interface ToastSpec {
  kind: "success" | "error";
  /** i18n key under admin.commandCenter.* */
  i18nKey: string;
  /** appended verbatim after the translated text (executor error detail). */
  detail?: string;
}

export function approveToastFor(
  lane: ApprovalLane,
  res: ApproveOutcomeLike,
): ToastSpec {
  if (res.status === "sent") {
    return {
      kind: "success",
      i18nKey:
        lane === "cs"
          ? "admin.commandCenter.toastSent"
          : "admin.commandCenter.toastRecorded",
    };
  }
  if (res.status === "failed") {
    return {
      kind: "error",
      i18nKey: "admin.commandCenter.toastFailed",
      detail: res.errorMessage ?? undefined,
    };
  }
  return { kind: "success", i18nKey: "admin.commandCenter.toastApproved" };
}
