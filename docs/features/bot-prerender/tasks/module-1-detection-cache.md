# M1 — 偵測 + 快取 middleware

檔案：`server/_core/prerenderMiddleware.ts`（新增）
依賴：`server/redis.ts`（既有 ioredis client）、`server/_core/logger.ts`、M2 的 `renderForBot`
設計：[design.md §3](../design.md)

## Checklist

- [ ] `isBot(ua)` — 子字串、大小寫不敏感，名單見 design §3.1（搜尋 + AI 引擎 + 社群）
- [ ] `shouldPrerender(pathname)` — 跳過 /api、__manus__、sitemap/robots/health、有副檔名的 asset、私密頁（admin/profile/book/payment/…）
- [ ] `cacheKey(pathname)` — 帶 `FLY_MACHINE_VERSION || "v1"` 版本前綴
- [ ] Redis get/set 包成 `cacheGet`/`cacheSet`，**Redis 失敗一律吞掉當 miss，絕不 throw**
- [ ] `prerenderMiddleware(req,res,next)` 決策樹（design §3.4）：非 GET / 非 bot / !shouldPrerender / flag off → next()
- [ ] env gate `PRERENDER_ENABLED`（prod 預設開、dev 關）
- [ ] `?nocache=1` 旁路（仍需 bot UA）
- [ ] 回應加 `X-Prerender: hit|miss` header
- [ ] 渲染回 null（M2 失敗）→ `next()`（fallback 空殼）；catch 全包 → `next()`，**絕不 500**
- [ ] logger 結構化（`logger.info/error({event, pathname, ...})`），**不用 console.***

## 完成定義

- 純函式（isBot / shouldPrerender / cacheKey）有單元測試（M4）
- middleware 在 bot 命中時回快取、未命中時呼叫 `renderForBot` 並寫快取
- 任何 Redis / 渲染錯誤都 graceful（next 或 fallback）
