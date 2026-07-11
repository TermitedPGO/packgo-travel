/**
 * heroCredit.test — 署名行渲染邏輯純測(指揮回令 P2 紅綠)。
 *
 * UI 只在 parseHeroImageCredit 回非 null 時渲染署名行,所以「無 credit 時 UI
 * 不渲染署名行」的判定就是這支 parse:null / 空字串 / 壞 JSON / 缺欄 → null。
 */

import { describe, it, expect } from "vitest";
import {
  parseHeroImageCredit,
  withUnsplashUtm,
  UNSPLASH_HOME_URL,
} from "./heroCredit";

const CREDIT_JSON = JSON.stringify({
  name: "Jane Doe",
  username: "janedoe",
  profileUrl: "https://unsplash.com/@janedoe",
});

describe("parseHeroImageCredit", () => {
  it("parses a stored credit JSON into the render shape", () => {
    expect(parseHeroImageCredit(CREDIT_JSON)).toEqual({
      name: "Jane Doe",
      username: "janedoe",
      profileUrl: "https://unsplash.com/@janedoe",
    });
  });

  it("NO credit → null → UI does not render the attribution line", () => {
    expect(parseHeroImageCredit(null)).toBeNull();
    expect(parseHeroImageCredit(undefined)).toBeNull();
    expect(parseHeroImageCredit("")).toBeNull();
    expect(parseHeroImageCredit("   ")).toBeNull();
  });

  it("malformed / incomplete credit → null (never a broken line)", () => {
    expect(parseHeroImageCredit("{not json")).toBeNull();
    expect(parseHeroImageCredit(JSON.stringify({ username: "x" }))).toBeNull(); // no name
    expect(parseHeroImageCredit(JSON.stringify({ name: "X" }))).toBeNull(); // no profileUrl
    expect(
      parseHeroImageCredit(JSON.stringify({ name: "X", profileUrl: "javascript:alert(1)" })),
    ).toBeNull(); // non-http link rejected
  });

  it("tolerates a missing username (name + profileUrl are the required pair)", () => {
    const r = parseHeroImageCredit(
      JSON.stringify({ name: "Jane", profileUrl: "https://unsplash.com/@j" }),
    );
    expect(r).toEqual({ name: "Jane", username: "", profileUrl: "https://unsplash.com/@j" });
  });
});

describe("withUnsplashUtm — 官方署名指引的 referral 參數", () => {
  it("appends utm params with ? on a clean URL", () => {
    expect(withUnsplashUtm("https://unsplash.com/@janedoe")).toBe(
      "https://unsplash.com/@janedoe?utm_source=packgo_travel&utm_medium=referral",
    );
  });

  it("appends with & when the URL already has a query", () => {
    expect(withUnsplashUtm("https://unsplash.com/@j?x=1")).toBe(
      "https://unsplash.com/@j?x=1&utm_source=packgo_travel&utm_medium=referral",
    );
  });

  it("home link carries the params too", () => {
    expect(UNSPLASH_HOME_URL).toContain("utm_source=packgo_travel");
    expect(UNSPLASH_HOME_URL).toContain("utm_medium=referral");
  });
});
