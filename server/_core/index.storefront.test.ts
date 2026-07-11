/**
 * index.storefront.test.ts — storefront-split Phase 0「掛載清單斷言」那一半。
 *
 * 純函式契約在 storefrontBootPlan.test.ts。這支用原始碼掃描(仿 repo 既有的
 * migrationBreakpoint.test.ts / sqlRehearsal/coverage.test.ts 慣例)確認 index.ts
 * 真的把每個後台端點導進 gate:沒有任何後台 HTTP 端點直接掛在裸 app.post/get/all
 * 上,worker 已從靜態 top-level import 改成 gated 動態 import,cron 尾段整段被
 * bootPlan.startCron 包住,而公開面(Google 登入、tRPC、prerender、靜態 SPA)維持
 * 裸掛。任何未來的漂移(有人把新後台端點掛回 app.post、或不小心 gate 掉公開面)
 * 這裡先紅。
 *
 * 為什麼掃原始碼而不 boot server:import index.ts 會執行 startServer()(listen
 * port、動態 import DB、init Sentry),不是乾淨的單元測試邊界。掃原始碼是本 repo
 * 對「啟動期不變式」既有的守門手法。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
  "utf8",
);

describe("index.ts — worker 已 gate(不再靜態 top-level import)", () => {
  it("沒有裸的 top-level `import \"../worker\"`", () => {
    expect(/^import\s+["']\.\.\/worker["']/m.test(SRC)).toBe(false);
  });

  it("worker 改成 gated 動態 import(startWorkers 旗標包住)", () => {
    expect(SRC).toContain('await import("../worker")');
    // 動態 import 落在 startWorkers gate 內:兩者都出現,且 gate 在 import 之前。
    const gateIdx = SRC.indexOf("bootPlan.startWorkers");
    const importIdx = SRC.indexOf('await import("../worker")');
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeGreaterThan(gateIdx);
  });
});

describe("index.ts — 後台 HTTP 端點沒有一支掛在裸 app.post/get/all", () => {
  // 允許 app.post( 與 path 之間有換行(catalog-rebuild 等多行註冊),\s* 涵蓋。
  const RAW_BACKEND =
    /app\.(post|get|all)\(\s*["']\/api\/(admin|internal|stripe|plaid|gmail|agent)\//g;

  it("裸 app.post/get/all 上的後台路徑數 = 0(全走 backend* registrar)", () => {
    const hits = SRC.match(RAW_BACKEND) ?? [];
    expect(hits).toEqual([]);
  });

  it("backend* registrar 有定義,且由 mountBackendEndpoints gate", () => {
    for (const name of ["backendPost", "backendGet", "backendAll"]) {
      expect(SRC).toContain(`const ${name} = (`);
    }
    expect(SRC).toContain("if (bootPlan.mountBackendEndpoints) app.post");
    expect(SRC).toContain("if (bootPlan.mountBackendEndpoints) app.get");
    expect(SRC).toContain("if (bootPlan.mountBackendEndpoints) app.all");
  });

  it("三支 webhook + ask-ops-stream + internal/admin 至少 22 支走 registrar", () => {
    const uses = SRC.match(/backend(Post|Get|All)\(/g) ?? [];
    // 22 = 定義處 3 + 註冊處 (3 webhook + 2 internal + 1 test-status + 1 SSE + 15 admin=22)。
    // 用 registrar 呼叫(帶引號路徑或多行 `(`)過濾掉定義行後仍應 >= 22。
    expect(uses.length).toBeGreaterThanOrEqual(22);
  });
});

describe("index.ts — Gmail 管線 OAuth gate,客人 Google 登入不 gate", () => {
  it("initializeGmailOAuth 被 mountBackendEndpoints 包住", () => {
    expect(SRC).toContain(
      "if (bootPlan.mountBackendEndpoints) initializeGmailOAuth(app)",
    );
  });

  it("initializeGoogleAuth(app) 維持裸掛(公開登入)", () => {
    expect(SRC).toContain("initializeGoogleAuth(app);");
    expect(SRC).not.toContain(
      "bootPlan.mountBackendEndpoints) initializeGoogleAuth",
    );
  });
});

describe("index.ts — cron 尾段整段被 startCron 包住", () => {
  it("有 `if (bootPlan.startCron) {` 開啟 cron 區塊", () => {
    expect(SRC).toContain("if (bootPlan.startCron) {");
  });
});

describe("index.ts — 公開面維持裸掛(byte-identical when OFF)", () => {
  it("tRPC appRouter、prerender、靜態 SPA、body parser 都不被 gate", () => {
    expect(SRC).toContain('"/api/trpc"');
    expect(SRC).toContain("createExpressMiddleware");
    expect(SRC).toContain("app.use(prerenderMiddleware)");
    expect(SRC).toContain("serveStatic(app)");
    expect(SRC).toContain('app.use(express.json({ limit: "10mb" }))');
    // 上面這些都不該出現在 backend* registrar 或 mountBackendEndpoints gate 裡。
    expect(SRC).not.toContain("backendUse(");
  });
});
