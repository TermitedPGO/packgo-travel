# M3 — 接線進 Express

檔案：`server/_core/index.ts`（改）
設計：[design.md §5](../design.md)

## Checklist

- [ ] `import { prerenderMiddleware } from "./prerenderMiddleware";`
- [ ] 在 `setupVite(app, server)` / `serveStatic(app)` **之前**（約 [index.ts:805](../../../server/_core/index.ts)）掛 `app.use(prerenderMiddleware);`
- [ ] 確認順序：API（tRPC）→ sitemap/robots/healthz → **prerenderMiddleware** → setupVite/serveStatic
- [ ] env flag `PRERENDER_ENABLED` 預設邏輯：`NODE_ENV==="production"` 時開，否則關（middleware 內部判斷即可，不必改 fly.toml；要關就 `fly secrets set PRERENDER_ENABLED=0`）
- [ ] 確認 `shutdownPool` 已在 SIGTERM handler（既有，無需改）

## 注意

- 不要掛在 `express.static` 之後 —— asset 已被 `shouldPrerender` 副檔名規則放行，但 middleware 要在 SPA fallback（`app.use("*")`）之前才能攔到 /about-us 這類「無副檔名」HTML 路由。
- 不碰 build script、不碰 vite.config、不碰 Dockerfile（Chromium 已在 image）。

## 完成定義

- 本地 `PRERENDER_ENABLED=1 pnpm dev`，bot UA curl 命中預渲染，一般 UA 不受影響
- `pnpm check` 0 error
