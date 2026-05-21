/**
 * Pipeline Phase: Rollback (error path)
 *
 * Extracted from masterAgent.ts during v2 Wave 2 Module 2.9 split. Best-effort
 * cleanup when a generation pipeline fails partway — walks partial result data,
 * harvests anything that looks like an R2 URL, and batch-deletes those keys.
 *
 * Round 72: the TODO placeholder that shipped in earlier rounds has been
 * replaced with real cleanup. Given how little state MasterAgent holds during
 * generation (it streams results back via the progress callback), we do a
 * best-effort sweep:
 *
 *   1. Walk partialData for anything that looks like an R2 URL
 *   2. Extract R2 keys via extractR2KeyFromUrl
 *   3. Batch-delete via storageDeleteMany (swallows errors)
 *
 * This is not transactional — if rollback itself fails partway, the caller
 * has already thrown the original error, so we only log and move on. The
 * deleted count lands in logs for audit / post-mortem.
 */

import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "masterAgent/rollback" });

/**
 * Walk partialData and delete any R2-hosted assets it references.
 *
 * @param partialData any object whose string leaves may contain R2 URLs
 *                    (tourData, raw LLM output, etc.)
 */
export async function rollback(partialData: any): Promise<void> {
  log.info({ event: "rollback.start" }, "[MasterAgent] Rolling back...");
  console.log("[MasterAgent] Rolling back...");

  try {
    const { storageDeleteMany, extractR2KeyFromUrl } = await import("../../storage");

    // Walk the partial data and harvest every string that looks like an R2 URL.
    const seen = new Set<string>();
    const keys: string[] = [];

    const walk = (value: any, depth = 0): void => {
      if (depth > 8) return; // defensive depth cap
      if (value == null) return;
      if (typeof value === "string") {
        // Try direct URL parse
        const key = extractR2KeyFromUrl(value);
        if (key && !seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
        // Also try parsing as JSON — image arrays are often stored stringified
        if (value.length > 2 && (value.startsWith("[") || value.startsWith("{"))) {
          try {
            walk(JSON.parse(value), depth + 1);
          } catch {
            // not JSON, ignore
          }
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }
      if (typeof value === "object") {
        for (const v of Object.values(value)) walk(v, depth + 1);
      }
    };

    walk(partialData);

    if (keys.length === 0) {
      log.info({ event: "rollback.no_assets" }, "[MasterAgent] Rollback: no R2 assets found in partialData");
      console.log("[MasterAgent] Rollback: no R2 assets found in partialData");
    } else {
      const result = await storageDeleteMany(keys);
      log.info(
        { event: "rollback.cleaned", deleted: result.deleted, total: keys.length, failed: result.failed },
        `[MasterAgent] Rollback: cleaned up ${result.deleted}/${keys.length} R2 objects (failed: ${result.failed})`
      );
      console.log(
        `[MasterAgent] Rollback: cleaned up ${result.deleted}/${keys.length} R2 objects (failed: ${result.failed})`
      );
    }
  } catch (err) {
    log.warn({ event: "rollback.error", err }, "[MasterAgent] Rollback encountered an error (non-fatal)");
    console.warn("[MasterAgent] Rollback encountered an error (non-fatal):", err);
  }

  console.log("[MasterAgent] Rollback completed");
}
