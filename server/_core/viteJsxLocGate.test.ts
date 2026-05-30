/**
 * Guard for the Builder.io jsx-loc dev gate in vite.config.ts.
 *
 * Context: `@builder.io/vite-plugin-jsx-loc` injects `data-loc="file:line"` on
 * every JSX element — a dev-only click-to-source affordance. Shipped into a
 * production build it leaks source paths into the public HTML (and the
 * bot-prerender output that crawlers / AI answer engines read) and bloats every
 * element. Commit fb897dc fixed this by scoping the plugin to the Vite dev
 * server: `{ ...jsxLocPlugin(), apply: "serve" }`. That fix shipped without a
 * test (CLAUDE.md §9.6 red line: shipped code must have matching Vitest), so
 * this file locks the contract — the jsx-loc plugin must be excluded from
 * `vite build`, which is what guarantees prod + prerender HTML carry zero
 * `data-loc`.
 *
 * Why assert the gate instead of running `vite build` + `grep dist/`: a real
 * build is 30s+, heavy, and flaky inside a unit test. Vite decides whether a
 * plugin runs via its `apply` field, so we model that exact filter here. If the
 * plugin is excluded for command "build", it cannot emit data-loc into the
 * build — the same outcome as grepping an empty dist/, proven deterministically.
 */
import { describe, it, expect } from "vitest";
import type { Plugin } from "vite";
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import viteConfig from "../../vite.config";

const JSX_LOC_NAME = "vite-plugin-jsx-loc";

/**
 * Faithful re-implementation of Vite's plugin `apply` filter (see Vite's
 * resolvePlugins): a plugin runs for a command unless `apply` excludes it.
 *   - no `apply`            → runs in BOTH build and serve
 *   - `apply: "serve"`      → runs only in the dev server
 *   - `apply: "build"`      → runs only in build
 *   - `apply: (c, env)=>..` → runs when the predicate is truthy
 */
function appliesToCommand(plugin: Plugin, command: "build" | "serve"): boolean {
  const apply = (plugin as { apply?: unknown }).apply;
  if (!apply) return true;
  if (typeof apply === "function") {
    return !!(apply as (config: unknown, env: { command: string; mode: string }) => unknown)(
      {},
      { command, mode: command === "build" ? "production" : "development" },
    );
  }
  return apply === command;
}

/**
 * vite.config.ts builds its `plugins` array from factories that may return
 * nested arrays (react(), tailwindcss()). Flatten + drop falsy/non-object
 * entries down to a plain list of named Plugin objects we can inspect.
 */
function flattenPlugins(config: unknown): Plugin[] {
  const raw = (config as { plugins?: unknown })?.plugins;
  const arr = Array.isArray(raw) ? raw : [];
  return (arr.flat(Infinity) as unknown[]).filter(
    (p): p is Plugin => !!p && typeof p === "object" && "name" in (p as Record<string, unknown>),
  );
}

describe("vite.config jsx-loc dev gate (data-loc leak guard)", () => {
  const plugins = flattenPlugins(viteConfig);
  const jsxLocEntries = plugins.filter((p) => p.name === JSX_LOC_NAME);

  it("registers exactly one jsx-loc plugin entry", () => {
    // Guards against an accidental second, un-gated copy sneaking in.
    expect(jsxLocEntries).toHaveLength(1);
  });

  it("excludes jsx-loc from `vite build` → 0 data-loc in prod / prerender HTML", () => {
    const jsxLoc = jsxLocEntries[0];
    expect(jsxLoc).toBeDefined();
    expect(appliesToCommand(jsxLoc, "build")).toBe(false);
  });

  it("keeps jsx-loc in the dev server (`serve`) so click-to-source still works locally", () => {
    const jsxLoc = jsxLocEntries[0];
    expect(appliesToCommand(jsxLoc, "serve")).toBe(true);
  });

  it("documents the danger: the raw plugin is un-gated and WOULD run in build", () => {
    // If anyone drops the `{ ...jsxLocPlugin(), apply: "serve" }` wrapper, the
    // plugin reverts to this shape — no `apply`, so it runs in every command
    // including build, re-introducing the leak. This is the regression the gate
    // exists to prevent.
    const raw = jsxLocPlugin() as Plugin;
    expect(raw.name).toBe(JSX_LOC_NAME);
    expect((raw as { apply?: unknown }).apply).toBeUndefined();
    expect(appliesToCommand(raw, "build")).toBe(true);
  });
});
