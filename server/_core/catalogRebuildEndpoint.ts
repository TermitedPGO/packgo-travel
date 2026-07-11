/**
 * catalogRebuildEndpoint — /api/admin/catalog-rebuild 的可測 handler(線三 R3)。
 *
 * script-token 端點(照 trust-transfer-detect 現成模式,同 LOCAL_SCRIPT_TOKEN 驗證),
 * 包 `rebuildCatalog`:走 promote pipeline(單一 txn、快照可回滾),不是裸寫。
 *
 * 合約:
 *   POST /api/admin/catalog-rebuild
 *   Headers: Authorization: Bearer <LOCAL_SCRIPT_TOKEN>
 *   Body: {
 *     scope: "uv" | "lion"        // zod enum 硬驗,必填
 *     dryRun?: boolean            // 預設 true(安全預設:只算不寫)
 *     limit?: number              // 正整數,上限 100;不給 = 全量
 *     skipSync?: boolean          // 預設 false(首跑要刷鏡像,見 uv-audit 前置 #1)
 *     confirm?: "promote"         // 安全閘:dryRun:false 必帶此字面,缺了 400
 *   }
 *   回傳:RebuildReport 原樣。
 *
 * 為什麼拆成 factory:index.ts 的 verifyInternalAuth 是 registerRoutes 閉包內的
 * 函式(不可 import),把 auth 與 rebuild 以依賴注入進來,紅綠(壞 token 401 短路、
 * 預設 dryRun、confirm 閘、參數硬驗)才能純測,不用起整個 express app。
 * 本檔無 raw SQL(只調 service),不需 sqlRehearsal 登記。
 */

import { z } from "zod";
import type { Request, Response } from "express";
import { logger } from "./logger";
import type {
  RebuildScope,
  RebuildOptions,
  RebuildReport,
} from "../services/catalogRebuild";

/** Body schema — strict:未知鍵直接 400(硬驗,防打錯參數名靜默全量)。 */
export const catalogRebuildBodySchema = z
  .object({
    scope: z.enum(["uv", "lion"]),
    dryRun: z.boolean().default(true),
    limit: z.number().int().positive().max(100).optional(),
    skipSync: z.boolean().default(false),
    confirm: z.literal("promote").optional(),
  })
  .strict();

export type CatalogRebuildBody = z.infer<typeof catalogRebuildBodySchema>;

export type ParsedCatalogRebuildRequest =
  | { ok: true; value: CatalogRebuildBody }
  | { ok: false; error: string };

/**
 * 驗 body + 安全閘。純函式:
 *   - zod 硬驗(scope enum / limit 1-100 正整數 / 未知鍵拒絕)。
 *   - 真寫入閘:dryRun:false 必須額外帶 confirm:"promote" 字面,缺了拒絕
 *     (雙保險 — tRPC 版另有全量 confirm 閘,這裡是 script 通道自己的閘)。
 */
export function parseCatalogRebuildRequest(body: unknown): ParsedCatalogRebuildRequest {
  const parsed = catalogRebuildBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `invalid body — ${msg}` };
  }
  if (!parsed.data.dryRun && parsed.data.confirm !== "promote") {
    return {
      ok: false,
      error:
        "dryRun:false is a REAL catalog write — it requires confirm:\"promote\" (literal). Missing/typo → rejected.",
    };
  }
  return { ok: true, value: parsed.data };
}

export interface CatalogRebuildHandlerDeps {
  /**
   * token/IP/rate-limit 驗證(index.ts 的 verifyInternalAuth,LOCAL_SCRIPT_TOKEN)。
   * 失敗時它自己已送出 401/403/429/503,回 null → handler 直接短路。
   */
  verifyAuth: (req: Request, res: Response) => Promise<string | null>;
  /** rebuildCatalog(注入以便純測;預設 index.ts 註冊時給 dynamic import 版)。 */
  runRebuild: (scope: RebuildScope, opts: RebuildOptions) => Promise<RebuildReport>;
}

/** 組出 express handler(index.ts 註冊用;測試注入假 deps)。 */
export function makeCatalogRebuildHandler(deps: CatalogRebuildHandlerDeps) {
  return async (req: Request, res: Response) => {
    try {
      const ip = await deps.verifyAuth(req, res);
      if (!ip) return; // 401/403/429/503 已由 verifyAuth 送出

      const parsed = parseCatalogRebuildRequest(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }

      const { scope, dryRun, limit, skipSync } = parsed.value;
      logger.info(
        { scope, dryRun, limit, skipSync, ip },
        "[admin/catalog-rebuild] triggered",
      );
      const report = await deps.runRebuild(scope, { dryRun, limit, skipSync });
      return res.json(report);
    } catch (err) {
      logger.error({ err }, "[admin/catalog-rebuild] error");
      return res.status(500).json({ error: (err as Error).message });
    }
  };
}
