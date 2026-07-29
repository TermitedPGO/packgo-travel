import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/**/*.test.ts",
      "client/**/*.spec.ts",
    ],
    // Run test files sequentially to avoid Redis race conditions between parallel tests
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
        // 2026-07-28: worker heap raised above node's default cap.
        //
        // server/_core/auditChain.test.ts (R13 adminAuditLog 直接寫入者 guard)
        // needs one whole-repo `ts.createProgram` to prove its contract, and that
        // single Program does not fit under node's default old-space cap on an
        // 8 GB box (2,096 MiB). Measured on a bare node process, one Program over
        // the 1,039 canonical files (6,001 SourceFiles) reaches ~2,102 MiB right
        // after createProgram and ~2,676 MiB once the guard has resolved the
        // schema symbol and walked every file; an independent probe measured
        // ~2,106 / ~2,576 MiB. Without this cap the fork dies mid-file with
        // "Worker exited unexpectedly": the run ends at exit 1 with
        // "Errors 1 error", but the summary still reads "382 passed", one file
        // and 14 guard tests short of what was collected. Re-checked after the
        // R20-1 refactor cut the guard to a single Program: still 42/55 then OOM
        // under the default cap, so this is not optional.
        // 4096 is the chosen cap, not a measured minimum: 3072 and 3584 were
        // never tested. Known cost: the guard's baseline phase coincides with a
        // markedly higher system-wide swap-out rate on an 8 GB machine (vm_stat
        // is per-system, not per-PID, so it is not attributed to this fork alone).
        // See PACKGO_AI交流 網站專案 2026-07-28.
        execArgv: ["--max-old-space-size=4096"],
      },
    },
  },
});
