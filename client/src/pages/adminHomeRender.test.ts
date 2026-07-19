/**
 * AdminHome render —— 1A0a 導航 href 與 Wouter 3 no-nested-anchor(Codex 7-18 P1-2)。
 * 突變抽核意圖:錯 href(/admin/*)或 nested <a> 都會使斷言紅。
 * 用 .test.ts + createElement(vitest esbuild 對 .ts 不做 JSX transform)。
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({ t: (k: string) => k, language: "zh-TW" }),
}));

// Wouter 3 Link:class 直接放 Link,渲染單一 <a href>(無 nested anchor)。
vi.mock("wouter", () => ({
  Link: ({ href, className, children }: { href: string; className?: string; children: unknown }) =>
    createElement("a", { href, className }, children as never),
}));

const { default: AdminHome } = await import("./AdminHome");

describe("AdminHome — 導航 href 與 anchor 結構", () => {
  const html = renderToStaticMarkup(createElement(AdminHome));

  it("四張卡 href 全部命中真實路由(Codex 7-18 R2:斷言四 href)", () => {
    expect(html).toContain('href="/ops/finance"');
    expect(html).toContain('href="/workspace"'); // 第四卡,Codex 點名要嚴查
    expect(html).toContain('href="/ops/customers"');
    expect(html).toContain('href="/ops/tours"');
    expect(html).not.toContain('href="/admin/customers"');
    expect(html).not.toContain('href="/admin/tours"');
  });

  it("零 nested anchor(Wouter 3:class 放 Link,不套 <a>)", () => {
    expect(html).not.toMatch(/<a[^>]*>\s*<a/);
  });

  it("零 mock 財務數字(純導航,無 $ 金額)", () => {
    expect(html).not.toContain("$");
  });
});
