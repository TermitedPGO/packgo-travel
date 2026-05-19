/**
 * supplierSyncService — re-export shim.
 *
 * The implementation lives in ./supplierSync/. This shim exists so the
 * four pre-existing import sites
 *   - server/routers/suppliersRouter.ts
 *   - server/queues/supplierSyncQueue.ts
 *   - server/_core/index.ts (comment ref only)
 *   - server/services/uvBulkImportService.ts (comment ref only)
 * don't need rewrites during the Phase 5A refactor (audit P1-10).
 *
 * The 810-LOC monolith was split into supplierSync/{shared,lion,uv,
 * reporting,index}.ts. Delete this shim in v2 once all importers point
 * at supplierSync/ directly.
 */
export {
  syncLionCatalog,
  syncUvCatalog,
  syncAllSuppliers,
  getRecentSyncRuns,
  getSuppliersOverview,
  type SyncResult,
} from "./supplierSync";
