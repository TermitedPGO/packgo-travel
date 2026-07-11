/**
 * storefrontBootPlan.test.ts — storefront-split Phase 0 boot-decision契約。
 *
 * 這支鎖住「純函式」那一半驗收:旗標 OFF(ops)→ worker/cron/後台端點全開;
 * 旗標 ON(storefront)→ 全關,但公開面永遠開。index.ts 直接消費本函式的欄位
 * 來 gate 每個區塊,所以測這裡就是測 index.ts 真正用的那個決策。掛載清單那半
 * 由 index.storefront.test.ts 的原始碼掃描斷言(index.ts 確實有把每個後台端點
 * 導進 gate)。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  buildStorefrontBootPlan,
  BACKEND_ONLY_ENDPOINTS,
} from "./storefrontBootPlan";

describe("buildStorefrontBootPlan — 純函式(顯式傳入 isStorefront)", () => {
  it("ops 角色(isStorefront=false)→ worker/cron/後台端點全開,行為不變", () => {
    const plan = buildStorefrontBootPlan(false);
    expect(plan).toEqual({
      isStorefront: false,
      startWorkers: true,
      startCron: true,
      mountBackendEndpoints: true,
      mountPublicSurface: true,
    });
  });

  it("storefront 角色(isStorefront=true)→ worker 不起、cron 不起、後台端點不掛", () => {
    const plan = buildStorefrontBootPlan(true);
    expect(plan.startWorkers).toBe(false);
    expect(plan.startCron).toBe(false);
    expect(plan.mountBackendEndpoints).toBe(false);
  });

  it("公開面永遠掛(兩種角色都 serve SPA + tRPC + prerender)", () => {
    expect(buildStorefrontBootPlan(false).mountPublicSurface).toBe(true);
    expect(buildStorefrontBootPlan(true).mountPublicSurface).toBe(true);
  });
});

describe("buildStorefrontBootPlan — 預設從 STOREFRONT_MODE 旗標讀", () => {
  const orig = process.env.STOREFRONT_MODE;
  afterEach(() => {
    if (orig === undefined) delete process.env.STOREFRONT_MODE;
    else process.env.STOREFRONT_MODE = orig;
  });

  it("旗標未設 → ops 角色(全開)", () => {
    delete process.env.STOREFRONT_MODE;
    const plan = buildStorefrontBootPlan();
    expect(plan.isStorefront).toBe(false);
    expect(plan.startWorkers).toBe(true);
    expect(plan.startCron).toBe(true);
    expect(plan.mountBackendEndpoints).toBe(true);
  });

  it("STOREFRONT_MODE=1 → storefront 角色(worker/cron/後台端點全關)", () => {
    process.env.STOREFRONT_MODE = "1";
    const plan = buildStorefrontBootPlan();
    expect(plan.isStorefront).toBe(true);
    expect(plan.startWorkers).toBe(false);
    expect(plan.startCron).toBe(false);
    expect(plan.mountBackendEndpoints).toBe(false);
    expect(plan.mountPublicSurface).toBe(true);
  });
});

describe("BACKEND_ONLY_ENDPOINTS — 後台端點清單(文件化 + 防漂移)", () => {
  it("涵蓋三支 webhook + Gmail OAuth + OpsAgent SSE + 全部 script-token 端點", () => {
    // 三支 webhook
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/stripe/webhook");
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/plaid/webhook");
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/gmail/push");
    // OpsAgent SSE
    expect(BACKEND_ONLY_ENDPOINTS).toContain("ALL /api/agent/ask-ops-stream");
    // /api/internal/* 三支
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/internal/test-generate");
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/internal/bulk-import-lion");
    expect(BACKEND_ONLY_ENDPOINTS).toContain("GET /api/internal/test-status/:jobId");
    // /api/admin/* 抽樣(catalog-rebuild 是多行註冊,最容易漏)
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/admin/catalog-rebuild");
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/admin/import-case-file");
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/admin/imessage-ingest");
  });

  it("全部條目唯一(沒有重複登記)", () => {
    expect(new Set(BACKEND_ONLY_ENDPOINTS).size).toBe(BACKEND_ONLY_ENDPOINTS.length);
  });
});
