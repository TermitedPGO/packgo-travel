/**
 * Storage router — admin R2 healthcheck.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L4503-4536.
 *
 * Procedures (1):
 *   - healthcheck  – v78g: probe R2 put/get to surface bucket misconfig
 */

import { adminProcedure, router } from "../_core/trpc";

export const storageRouter = router({
    healthcheck: adminProcedure.query(async () => {
      const { storagePut, storageGet } = await import("../storage");
      const { ENV } = await import("../_core/env");
      const result: any = {
        bucket: ENV.r2Bucket,
        endpoint: ENV.r2Endpoint,
        publicBaseUrl: ENV.r2PublicBaseUrl || null,
        put: { ok: false, error: null as string | null, key: null as string | null },
        get: { ok: false, error: null as string | null, url: null as string | null },
      };
      const probeKey = `healthcheck/probe-${Date.now()}.txt`;
      try {
        const put = await storagePut(probeKey, Buffer.from("ok", "utf-8"), "text/plain");
        result.put.ok = true;
        result.put.key = put.key;
      } catch (err: any) {
        result.put.error = `${err?.name || "Error"}: ${err?.message?.slice(0, 200) || String(err).slice(0, 200)}`;
      }
      if (result.put.ok) {
        try {
          const get = await storageGet(probeKey);
          result.get.ok = true;
          result.get.url = get.url;
        } catch (err: any) {
          result.get.error = `${err?.name || "Error"}: ${err?.message?.slice(0, 200) || ""}`;
        }
      }
      result.summary = result.put.ok && result.get.ok
        ? "R2 storage is fully operational"
        : `R2 broken — fix: ${result.put.error || result.get.error}`;
      return result;
    }),
  });
