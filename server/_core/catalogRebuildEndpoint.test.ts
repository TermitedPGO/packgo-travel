/**
 * catalogRebuildEndpoint.test — /api/admin/catalog-rebuild 紅綠(線三 R3)。
 *
 * 指揮驗收條目:壞 token 401(auth 失敗短路,絕不跑 rebuild)、預設 dryRun、
 * dryRun:false 無 confirm 拒絕 400、參數硬驗(scope enum / limit 1-100 / 未知鍵)。
 * 另:report 原樣回傳、service 炸 → 500。全走注入的假 deps,不起 express、不碰 DB。
 */

import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import {
  makeCatalogRebuildHandler,
  parseCatalogRebuildRequest,
} from "./catalogRebuildEndpoint";
import type { RebuildReport } from "../services/catalogRebuild";

const REPORT: RebuildReport = {
  scope: "uv",
  batchId: null,
  dryRun: true,
  productsScanned: 10,
  complete: 8,
  incomplete: 2,
  promoted: 0,
  retired: 0,
  newDrafts: 0,
  matchedExisting: 0,
  wouldCreateNew: 8,
  missingBreakdown: { attractions: 2 },
  incompleteSamples: [],
};

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

const req = (body: unknown) => ({ body }) as Request;

/** auth 一律過(回 ip)的假 verifyAuth。 */
const authPass = vi.fn(async () => "1.2.3.4");

describe("壞 token → 401 短路,絕不碰 rebuild", () => {
  it("verifyAuth 失敗(它自己送 401)→ handler 直接 return,runRebuild 不被呼叫", async () => {
    // 模擬 verifyInternalAuth 對壞 token 的真實行為:送 401、回 null。
    const authFail = vi.fn(async (_req: Request, res: Response) => {
      res.status(401).json({ error: "Invalid token" });
      return null;
    });
    const runRebuild = vi.fn(async () => REPORT);
    const handler = makeCatalogRebuildHandler({ verifyAuth: authFail, runRebuild });
    const res = makeRes();
    await handler(req({ scope: "uv" }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(runRebuild).not.toHaveBeenCalled();
  });
});

describe("預設值:dryRun=true / skipSync=false / limit 不設", () => {
  it("最小 body {scope:'uv'} → rebuild 以安全預設觸發", async () => {
    const runRebuild = vi.fn(async () => REPORT);
    const handler = makeCatalogRebuildHandler({ verifyAuth: authPass, runRebuild });
    const res = makeRes();
    await handler(req({ scope: "uv" }), res);
    expect(runRebuild).toHaveBeenCalledWith("uv", {
      dryRun: true,
      limit: undefined,
      skipSync: false,
    });
    // report 原樣回傳
    expect(res.json).toHaveBeenCalledWith(REPORT);
  });
});

describe("安全閘:dryRun:false 必帶 confirm:'promote' 字面", () => {
  it("dryRun:false 無 confirm → 400,絕不跑", async () => {
    const runRebuild = vi.fn(async () => REPORT);
    const handler = makeCatalogRebuildHandler({ verifyAuth: authPass, runRebuild });
    const res = makeRes();
    await handler(req({ scope: "uv", dryRun: false }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(runRebuild).not.toHaveBeenCalled();
  });

  it("confirm 打錯字(非 'promote' 字面)→ 400", async () => {
    const runRebuild = vi.fn(async () => REPORT);
    const handler = makeCatalogRebuildHandler({ verifyAuth: authPass, runRebuild });
    const res = makeRes();
    await handler(req({ scope: "uv", dryRun: false, confirm: "yes" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(runRebuild).not.toHaveBeenCalled();
  });

  it("dryRun:false + confirm:'promote' → 真跑(scope/limit 原樣帶入)", async () => {
    const runRebuild = vi.fn(async () => ({ ...REPORT, dryRun: false, promoted: 25 }));
    const handler = makeCatalogRebuildHandler({ verifyAuth: authPass, runRebuild });
    const res = makeRes();
    await handler(req({ scope: "lion", dryRun: false, confirm: "promote", limit: 25 }), res);
    expect(runRebuild).toHaveBeenCalledWith("lion", {
      dryRun: false,
      limit: 25,
      skipSync: false,
    });
  });
});

describe("參數硬驗(zod strict)", () => {
  const expect400 = (result: ReturnType<typeof parseCatalogRebuildRequest>) => {
    expect(result.ok).toBe(false);
  };

  it("scope 缺 / 非 enum → 拒絕", () => {
    expect400(parseCatalogRebuildRequest({}));
    expect400(parseCatalogRebuildRequest({ scope: "expedia" }));
    expect400(parseCatalogRebuildRequest({ scope: "UV" })); // 大小寫也不放水
  });

  it("limit 硬驗:0 / 負 / 小數 / 超過 100 / 字串 → 拒絕", () => {
    expect400(parseCatalogRebuildRequest({ scope: "uv", limit: 0 }));
    expect400(parseCatalogRebuildRequest({ scope: "uv", limit: -5 }));
    expect400(parseCatalogRebuildRequest({ scope: "uv", limit: 2.5 }));
    expect400(parseCatalogRebuildRequest({ scope: "uv", limit: 101 }));
    expect400(parseCatalogRebuildRequest({ scope: "uv", limit: "25" }));
  });

  it("limit 邊界:1 與 100 放行", () => {
    expect(parseCatalogRebuildRequest({ scope: "uv", limit: 1 }).ok).toBe(true);
    expect(parseCatalogRebuildRequest({ scope: "uv", limit: 100 }).ok).toBe(true);
  });

  it("未知鍵拒絕(strict — 防打錯參數名靜默全量)", () => {
    expect400(parseCatalogRebuildRequest({ scope: "uv", dryrun: false }));
    expect400(parseCatalogRebuildRequest({ scope: "uv", extra: 1 }));
  });

  it("dryRun / skipSync 型別硬驗:非 boolean → 拒絕", () => {
    expect400(parseCatalogRebuildRequest({ scope: "uv", dryRun: "false" }));
    expect400(parseCatalogRebuildRequest({ scope: "uv", skipSync: 1 }));
  });

  it("handler 對壞參數回 400 + error 訊息", async () => {
    const runRebuild = vi.fn(async () => REPORT);
    const handler = makeCatalogRebuildHandler({ verifyAuth: authPass, runRebuild });
    const res = makeRes();
    await handler(req({ scope: "uv", limit: 999 }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("limit") }),
    );
    expect(runRebuild).not.toHaveBeenCalled();
  });
});

describe("service 錯誤 → 500(不裸吞)", () => {
  it("runRebuild throw → 500 + error message", async () => {
    const runRebuild = vi.fn(async () => {
      throw new Error("Database not available");
    });
    const handler = makeCatalogRebuildHandler({ verifyAuth: authPass, runRebuild });
    const res = makeRes();
    await handler(req({ scope: "uv" }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Database not available" });
  });
});
