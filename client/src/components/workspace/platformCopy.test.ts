/**
 * Tests for normalizePlatformCopy (v690 UAT B-04) — legacy raw-JSON copy
 * rows must unwrap cleanly; normal text must pass through untouched.
 */
import { describe, it, expect } from "vitest";
import { normalizePlatformCopy } from "./platformCopy";

describe("normalizePlatformCopy", () => {
  it("plain text passes through with its hashtags", () => {
    const out = normalizePlatformCopy("夏威夷七日,親子首選。", "夏威夷 親子");
    expect(out).toEqual({ text: "夏威夷七日,親子首選。", hashtags: "夏威夷 親子" });
  });

  it("unwraps legacy {text, hashtags[]} blob (UAT-observed shape)", () => {
    const blob = JSON.stringify({
      text: "您好，誠摯推薦這趟大阪賞楓行程…",
      hashtags: ["大阪", "賞楓", "日本"],
    });
    const out = normalizePlatformCopy(blob, null);
    expect(out.text).toBe("您好，誠摯推薦這趟大阪賞楓行程…");
    expect(out.hashtags).toBe("大阪 賞楓 日本");
  });

  it("unwraps {copyText, hashtags string} shape", () => {
    const blob = JSON.stringify({ copyText: "正文", hashtags: "a b c" });
    expect(normalizePlatformCopy(blob)).toEqual({
      text: "正文",
      hashtags: "a b c",
    });
  });

  it("explicit hashtags column wins over embedded ones", () => {
    const blob = JSON.stringify({ text: "正文", hashtags: ["embedded"] });
    expect(normalizePlatformCopy(blob, "column").hashtags).toBe("column");
  });

  it("unwraps shape 3: nested content object (v691 re-verify finding)", () => {
    const blob = JSON.stringify({
      platform: "Email Newsletter",
      content: {
        subject_line: "【限時揭秘】北京-西安深度體驗",
        body: "親愛的朋友您好，這趟行程我們親自把關…",
        hashtags: ["北京", "西安"],
      },
    });
    const out = normalizePlatformCopy(blob, null);
    expect(out.text).toBe(
      "【限時揭秘】北京-西安深度體驗\n\n親愛的朋友您好，這趟行程我們親自把關…",
    );
    expect(out.hashtags).toBe("北京 西安");
  });

  it("unwraps content fields at top level (subject + body, no wrapper)", () => {
    const blob = JSON.stringify({ subject: "標題", body: "內文" });
    expect(normalizePlatformCopy(blob).text).toBe("標題\n\n內文");
  });

  it("bullet-list array fields become one line per bullet", () => {
    const blob = JSON.stringify({
      content: { subject_line: "S", body: "B", cta: "去 packgoplay.com" },
    });
    expect(normalizePlatformCopy(blob).text).toBe("S\n\nB\n\n去 packgoplay.com");
  });

  it("truly unrecognisable JSON stays raw (don't guess)", () => {
    const blob = JSON.stringify({ foo: "x", bar: 5 });
    expect(normalizePlatformCopy(blob).text).toBe(blob);
  });

  it("brace-wrapped non-JSON stays raw", () => {
    const s = "{這不是 JSON 只是大括號開頭}";
    expect(normalizePlatformCopy(s).text).toBe(s);
  });

  it("null/empty degrade to empty strings", () => {
    expect(normalizePlatformCopy(null)).toEqual({ text: "", hashtags: "" });
    expect(normalizePlatformCopy("", null)).toEqual({ text: "", hashtags: "" });
  });

  it("drops non-string entries in hashtag arrays", () => {
    const blob = JSON.stringify({ text: "t", hashtags: ["ok", 5, null, "good"] });
    expect(normalizePlatformCopy(blob).hashtags).toBe("ok good");
  });
});
