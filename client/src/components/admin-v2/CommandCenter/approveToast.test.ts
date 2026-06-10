import { describe, expect, it } from "vitest";
import { approveToastFor } from "./approveToast";

describe("approveToastFor (honest outcome reporting)", () => {
  it("cs + sent → 已送出 (the only lane that really emails)", () => {
    expect(approveToastFor("cs", { status: "sent" })).toEqual({
      kind: "success",
      i18nKey: "admin.commandCenter.toastSent",
    });
  });

  it("non-cs + sent → 已記錄 (executors only record in v1, claiming sent would lie)", () => {
    for (const lane of ["quote", "marketing", "finance"] as const) {
      expect(approveToastFor(lane, { status: "sent" }).i18nKey).toBe(
        "admin.commandCenter.toastRecorded",
      );
    }
  });

  it("failed → error toast carrying the executor message", () => {
    expect(
      approveToastFor("cs", { status: "failed", errorMessage: "SMTP down" }),
    ).toEqual({
      kind: "error",
      i18nKey: "admin.commandCenter.toastFailed",
      detail: "SMTP down",
    });
    expect(
      approveToastFor("cs", { status: "failed", errorMessage: null }).detail,
    ).toBeUndefined();
  });

  it("approved (no executor) → plain 已通過", () => {
    expect(approveToastFor("quote", { status: "approved" })).toEqual({
      kind: "success",
      i18nKey: "admin.commandCenter.toastApproved",
    });
  });
});
