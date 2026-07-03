# PACK&GO 後端架構與規範（全文）

> 從 CLAUDE.md v1.3 抽出（原 §3、§4.2、§5.2-5.3、§6、§7、§8）。CLAUDE.md 只留紅線摘要，細節以本檔為準。

## 1. 架構事實

- 路由：Wouter（不是 React Router）。狀態：tRPC + React Query（無 Redux/Zustand）。UI：shadcn/ui（`@/components/ui/*`）。圖示：lucide-react。Markdown 渲染：`<Streamdown>`。
- API 層：tRPC。`server/routers.ts` 是 composition shell；domain API 一律放 `server/routers/<domain>.ts`，不往 shell 塞邏輯。
- DB：MySQL via Drizzle（schema 在 `drizzle/schema.ts`）。
- 認證：Google OAuth（`server/googleAuth.ts`）+ email/password；session 用自簽 JWT（`server/jwt.ts`）。需登入的 API 用 `protectedProcedure`。
- Admin：一律 `import { adminProcedure } from "../_core/trpc"`。它自帶 role check + 60 req/min/admin throttle（queries 不節流）。禁止在 admin router 自定義 procedure 繞過 rate-limit。
- 檔案儲存：Cloudflare R2（`server/storage.ts`，S3-compatible）。禁止 DB 存檔案 bytes，存 URL。
- LLM：只在 server 端經 `server/_core/llm.ts` 的 `invokeLLM`。LLM 快取 24h（同 prompt hash 直接回快取）。
- 日誌：`server/_core/*` 與 `server/agents/autonomous/*` 禁止 `console.*`，用 `import { logger } from "./logger"`（相對路徑）：`logger.info({ event, ...fields }, "message")`。
- Port：`process.env.PORT`，禁止硬編碼。

## 2. 敏感資料紅線（全文）

### 2.1 護照號加密
`bookingParticipants.passportNumber` 與 `visaApplications.passportNumber` 一律經 `server/_core/passportEncryption.ts` 進出。直接 `db.insert(...).values({passportNumber: ...})` 或 SELECT 後直接返回 = 明文落盤 = 事故。

正確路徑（都已包好加解密）：
```ts
await db.createVisaApplication({passportNumber, ...})
const app = await db.getVisaApplicationById(id)
await db.replaceBookingParticipants(bookingId, ...)
const ps = await db.getBookingParticipants(bookingId)
```
底層 envelope：`server/_core/tokenCrypto.ts`（AES-256-GCM，與 Gmail/Plaid tokens 共用）。

### 2.2 customerProfiles 先查再插
email/phone 在 DB 層無 unique 約束（故意的：允許多筆 NULL、多渠道客人）。任何新的 `db.insert(customerProfiles)` 之前必須先 SELECT 同 email/phone，找到就重用/認領，找不到才插。參考實作：
- `server/routers/agent/profiles.ts` 的 `upsertByIdentifier`（OR 多 identifier，最完整）
- `server/_core/customerAiSummary.ts` 的 `ensureProfileId`（先 userId、再認領同 email 訪客 row、最後才插）
- 事後補網：`server/_core/duplicateProfileScan.ts` 每週掃重複進 Jeff office inbox。那是備援不是防線。

## 3. AI 行程生成管線

```
WebScraperAgent → ContentAnalyzerAgent → [並行] ColorThemeAgent + ImagePromptAgent
  → [並行] ImageGeneration + Itinerary + Cost + Notice + Hotel + Meal + Flight agents
```
- 進度：BullMQ + Redis，前端每 3 秒輪詢 `trpc.tours.getGenerationStatus`。目標 <120 秒。
- 主控：`server/agents/masterAgent.ts`；進度：`server/agents/progressTracker.ts`。

## 4. i18n

- 框架：自定義 `client/src/i18n/`（`zh-TW.ts` 預設、`en.ts`）。用法 `const { t } = useTranslation()`。
- 「英文版顯示中文」修法：找到硬編碼中文 → 兩個語言檔都加 key → 替換為 `{t('key')}`。

## 5. API 錯誤慣例

- `UNAUTHORIZED`：前端跳 `getLoginUrl()`。`FORBIDDEN`：需 admin。`NOT_FOUND`：顯示 404 頁。

## 6. 關鍵檔案路徑表

| 功能 | 檔案 |
|------|------|
| DB Schema | `drizzle/schema.ts` |
| tRPC shell / domains | `server/routers.ts` / `server/routers/<domain>.ts` |
| DB 查詢 | `server/db.ts`（shim + visa/inquiries/newsletter/affiliate + `getDb()`）+ `server/db/{booking,tour,user,search,accounting,customOrder}.ts`；voucher/packpoint 在 `_core/`；refund 在 `server/agents/autonomous/refundAgent.ts` + `server/services/skills/refundReceiptTemplate.ts`；auditLog 在 `_core/auditLog.ts` |
| Stripe webhook | `server/_core/stripeWebhook.ts` + `stripeWebhookIdempotency.ts` + table `stripeWebhookEvents` |
| Supplier sync（Lion+UV） | `server/services/supplierSync/{lion,uv,shared,reporting,index}.ts` |
| 護照加密 | `server/_core/tokenCrypto.ts` + `server/_core/passportEncryption.ts` |
| Sentry | `server/_core/sentry.ts` + `client/src/_core/SentryBoundary.tsx` |
| Pino 日誌 | `server/_core/logger.ts` + `correlationId.ts` |
| 健康檢查 | `server/_core/healthCheck.ts` + `/health` route + `system.health` query |
| Deploy guard | `scripts/safe-deploy.mjs`（`pnpm ship`）+ `scripts/safe-deploy.test.mjs`（`pnpm ship:test`） |
| PostHog 漏斗 | `client/src/_core/analytics.ts` |
| LLM | `server/_core/llm.ts` |
| R2 儲存 | `server/storage.ts` |
| 認證 hook | `client/src/_core/hooks/useAuth.ts` |
| 路由 | `client/src/App.tsx` + `server/_core/knownRoutes.ts`（SPA whitelist，server 端） |
| 全域樣式 | `client/src/index.css` |
| i18n | `client/src/i18n/zh-TW.ts` / `en.ts` |
| 行程詳情頁 | `client/src/pages/TourDetailPeony/` |
| Admin 行程 | `client/src/components/admin/ToursTab.tsx` + `admin/tours/*` |
| Admin agents | `client/src/components/admin/AutonomousAgentsTab.tsx` + `admin/agents/*` |
| 行程編輯 | `client/src/components/admin/TourEditDialog/`（目錄，入口 `index.tsx`） |
| Refactor 文檔 | `docs/refactor/*` |

## 7. 測試與 Checkpoint

- Vitest；後端測試放 `server/*.test.ts`；跑 `pnpm test`。禁止測試插真實資料進 DB。
- tsc OOM 時：`NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit`（本機記憶體吃緊，重型 transform 會 OOM）。
- 本地 checkout 無 DATABASE_URL：任何 DB 查寫、重抓資料要在 prod/Fly 上跑，本地只能改 code。
- Checkpoint 時機：新功能完成 / 重大 bug 修復 / 設計大調 / schema 變更。前置：tsc 0 錯、新功能有 Vitest、`docs/features/<name>/progress.md` 已回寫實際狀態（含「已部署 vN」）。

## 8. 部署（紅線，全文）

Prod 部署唯一路徑：`pnpm ship`（`scripts/safe-deploy.mjs`）。任何 session（含 AI）直接 `flyctl deploy` = 違規。
- Guard 七道門（依序獨立檢查，任一不過即拒絕）：① 分支 main ② working tree 乾淨 ③ 不落後 origin/main ④ 列出本次 migration ⑤ tsc 0 錯 ⑥ vitest 綠（`SKIP_DEPLOY_TESTS=1` 可略）⑦ `.deploy-approve` 內容 == `DEPLOY_TOKEN`。
- `.deploy-approve` 是 Jeff 手放的一次性 token，用完即焚。session 湊不出來，也不該試。
- Jeff 說「給我 code」= 給他可貼終端機的指令區塊（push → 放 token → pnpm ship），不是代跑。
