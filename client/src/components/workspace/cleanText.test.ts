import { describe, it, expect } from "vitest";
import { cleanDisplayText } from "./cleanText";

describe("cleanDisplayText", () => {
  it("strips the <untrusted_input> injection wrapper (guest pane leak)", () => {
    const raw =
      "From: Jenny <j@x.com>\nSubject: Taiwan trip\n\n<untrusted_input>\n你好 想報價\n</untrusted_input>";
    const out = cleanDisplayText(raw);
    expect(out).not.toContain("untrusted_input");
    expect(out).toContain("你好 想報價");
  });

  it("strips ** markdown that leaked into old draft cards (escalation card leak)", () => {
    expect(cleanDisplayText("Draft (供你參考,**未送出**):")).toBe(
      "Draft (供你參考,未送出):",
    );
    expect(cleanDisplayText("**請將行程內容改以下列格式重新提供:**")).toBe(
      "請將行程內容改以下列格式重新提供:",
    );
  });

  it("strips __underscore__ bold, `code`, and # headers", () => {
    expect(cleanDisplayText("__重點__")).toBe("重點");
    expect(cleanDisplayText("用 `getProductGroup` 查")).toBe("用 getProductGroup 查");
    expect(cleanDisplayText("# 標題\n內文")).toBe("標題\n內文");
  });

  it("leaves clean plain text untouched (no false positives)", () => {
    const clean = "Hi Jeff,\n\n謝謝您的來信,我們會在 2 到 3 個工作天回覆。\n\nPACK&GO Travel";
    expect(cleanDisplayText(clean)).toBe(clean);
  });

  it("handles null/empty safely", () => {
    expect(cleanDisplayText(null)).toBe("");
    expect(cleanDisplayText("")).toBe("");
  });
});
