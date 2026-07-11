# 同庫分艙 storefront-split — 執行進度

> 對應藍圖 `docs/features/storefront-split/plan.md`。逐階段回寫,不倒填。
> 工作區:git worktree `/Users/jeff/Desktop/網站-split`,分支 `storefront-split`(從 origin/main)。

## Phase 0:加 STOREFRONT_MODE 閘(不改行為)

**狀態:✅ code 完成、tsc 0 錯、相關測試兩輪綠。分支 push,未合 main、未部署、未建 Fly app。**

旗標未設(ops 角色,= 現狀)時行為 byte-identical:所有 worker/cron 照起、所有端點照掛。
`STOREFRONT_MODE=1`(或 `true`)時 = storefront 角色:worker 不起、cron 不起、後台專屬端點不掛,
公開面(SPA + tRPC appRouter + bot-prerender + Google 登入)照常 serve。

### 交付清單

新增:
- `server/_core/storefrontBootPlan.ts` — 純函式 `buildStorefrontBootPlan(isStorefront?)` 回傳
  boot 決策物件(`startWorkers`/`startCron`/`mountBackendEndpoints`/`mountPublicSurface`);
  `BACKEND_ONLY_ENDPOINTS` 文件化後台端點清單。index.ts 直接消費這些欄位 gate 每個區塊,
  所以「決策」是可測純函式,不必 boot server。
- `server/_core/storefrontBootPlan.test.ts`(7 tests)— OFF/ON 兩向契約 + 旗標讀取 + 清單防漂移。
- `server/_core/index.storefront.test.ts`(9 tests)— 原始碼掃描斷言 index.ts 真的把每個後台端點
  導進 gate(仿 migrationBreakpoint / sqlRehearsal coverage 的守門慣例):沒有裸 `app.post/get/all`
  掛後台路徑、worker 已從靜態 import 改 gated 動態 import、cron 尾段被 `startCron` 包住、
  公開面維持裸掛。

修改:
- `server/_core/featureFlags.ts` — 加 `storefrontMode()`。照本檔既有 flag 慣例(集中讀、call site
  禁裸讀 process.env),但刻意同時接受 `"1"` 與 `"true"`:藍圖 fly secrets 用 `STOREFRONT_MODE=1`,
  而本檔其他 flag 用 `=== "true"`,兩者都收才不會因值不同而靜默失效(偏離申報見下)。
- `server/_core/featureFlags.test.ts` — 加 `storefrontMode` 4 case(未設/`1`/`true`/其他值),既有測試不動。
- `server/_core/index.ts` — Phase 0 gate:
  1. `import "../worker"`(舊 L42 靜態 top-level)→ 刪除,改成 startServer() 開頭 `if (bootPlan.startWorkers) await import("../worker")` 的 gated 動態 import(plan §2.3 唯一必動掛載點)。
  2. startServer() 開頭建 `bootPlan` + 三個 backend-only registrar(`backendPost`/`backendGet`/`backendAll`,storefront 模式 no-op)。
  3. 三支 webhook(stripe/plaid/gmail-push)、OpsAgent SSE(ask-ops-stream)、`/api/internal/*`(3)、`/api/admin/*`(15)共 22 支改走 registrar。
  4. `initializeGmailOAuth(app)` 用 `mountBackendEndpoints` 包;`initializeGoogleAuth(app)`(客人登入)維持裸掛。
  5. cron/worker 尾段(zombie-cleanup → supplierSync,318 行)整段包 `if (bootPlan.startCron) { }`。

### 掛載點逐一裁決

| 掛載點 | Phase 0 處置 | 理由 |
|--------|-------------|------|
| `import "../worker"`(worker 消費者) | gated 動態 import | plan §2.3 唯一必改;storefront 不起 worker |
| cron/worker 尾段(~20 worker + scheduleXxx) | 整段 `startCron` 包 | plan §1.7 全關 |
| stripe/plaid/gmail-push webhook | `backendPost`(gate) | plan §4.3 三支 webhook 留 ops |
| ask-ops-stream SSE | `backendAll`(gate) | 純後台 OpsAgent |
| `/api/internal/*`(test-generate/bulk-import-lion/test-status) | `backendPost`/`backendGet`(gate) | script-token,不該在客人站 |
| `/api/admin/*`(15 支) | `backendPost`(gate) | script-token,不該在客人站 |
| `initializeGmailOAuth` | gate | email pipeline OAuth，純後台 |
| `initializeGoogleAuth` | 不 gate | 客人登入,公開面 |
| `/api/upload-chat-image` | 不 gate（留） | 非 Phase 0 明列;adminProcedure 式 role check 自保 |
| upload routers / progressRouter / aiChatStreamRouter | 不 gate（留） | 非 Phase 0 明列;plan 路線(i)靠 procedure 自保 |
| `/api/aiQuotes/:id/view`、`/api/invoices/:id/view`、sitemap | 不 gate（留） | 客人公開/需登入頁 |
| tRPC appRouter / prerender / serveStatic | 不 gate（留） | plan 路線(i):整個 appRouter 掛,靠 adminProcedure 自保 |

### 自測證據

- tsc:`NODE_OPTIONS="--max-old-space-size=6144" tsc --noEmit` → 0 錯。
- vitest(兩輪綠):`featureFlags.test.ts`(18)+ `storefrontBootPlan.test.ts`(7)+ `index.storefront.test.ts`(9)+ `sqlRehearsal/coverage.test.ts`(3)= 4 files / 37 tests passed。
- coverage.test.ts:綠。index.ts 無 raw SQL token、registryEntries/whitelist 無 index.ts 參照,318 行 cron 重排未造成 SQL 登記漂移(不需改 registryEntries)。
- 地雷 #7:本批只動 `server/_core/*.ts`(全在 tsconfig include),未動 `scripts/`、未把 executable code 嵌進字串,故 tsc 為有效證據;另附 vitest 實跑。

### 偏離申報

- `storefrontMode()` 接受 `"1"` 與 `"true"` 兩值(本檔其他 flag 只認 `"true"`)。原因:藍圖 Phase 1 明文 fly secrets 用 `STOREFRONT_MODE=1`;若只認 `"true"`,部署時設 `=1` 會靜默回 ops 角色(= bug)。兩值都收、其餘一律 false(嚴格 opt-in)。已在 flag 註解與測試點名。
- worker import 從 module top-level 位移到 startServer() 開頭(仍在 boot 路徑、仍 boot 即起)。這是 plan §2.3/§6 明文指定的改法,行為視為不變。

### 待 Jeff / 後續階段(不在 Phase 0)

- 本分支未合 main、未 `pnpm ship`、未 `fly apps create`、未動 DNS/secrets。
- 裁決門 A–E(域名拓樸、session 模型、唯讀時程、Redis、tRPC 批次)仍待 Jeff,屬 Phase 1+。
