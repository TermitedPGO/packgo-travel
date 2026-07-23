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
  // R6-2 P2-2 誠實更正:本測試是「抽樣 + 與 index.ts 實際註冊對帳」,不是逐條
  // 全列;真正的全量防漂移靠下面的 backendPost 對帳測試。標題不再宣稱全部。
  it("涵蓋三支 webhook + Gmail OAuth + OpsAgent SSE + script-token 端點抽樣", () => {
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
    // audit-chain-repair R6-2:鏈錨定端點必須在清單(storefront gate 之內)
    expect(BACKEND_ONLY_ENDPOINTS).toContain("POST /api/admin/audit-chain-epoch");
  });

  it("與 index.ts 實際 backendPost/backendGet/backendAll 註冊對帳(全量防漂移)", async () => {
    // 清單宣稱「文件化 + 測試釘住」,那就真的逐條對:index.ts 原始碼中每個
    // backendPost("/api/…") 註冊路徑都必須出現在清單;清單多列或漏列都紅。
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "server/_core/index.ts"), "utf8");
    const registered = new Set<string>();
    for (const m of src.matchAll(/backend(Post|Get|All)\(\s*\n?\s*"(\/api\/[^"]+)"/g)) {
      const verb = m[1] === "Post" ? "POST" : m[1] === "Get" ? "GET" : "ALL";
      registered.add(`${verb} ${m[2]}`);
    }
    const listed = new Set(
      BACKEND_ONLY_ENDPOINTS.filter((e) => /^(POST|GET|ALL) \/api\//.test(e)),
    );
    // R7-3:雙向 set equality —— 清單漏列(missing)與清單殘留不存在的端點
    // (extra)都要紅,不是單向包含。
    const missing = [...registered].filter((r) => !listed.has(r));
    const extra = [...listed].filter((l) => !registered.has(l));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("全部條目唯一(沒有重複登記)", () => {
    expect(new Set(BACKEND_ONLY_ENDPOINTS).size).toBe(BACKEND_ONLY_ENDPOINTS.length);
  });
});
