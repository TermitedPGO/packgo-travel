# M4 — 測試（Vitest）

檔案：`server/prerenderMiddleware.test.ts`（新增）
設計：[design.md §3-4](../design.md)；§9.5 紅線：ship code 必有對應 Vitest

## Checklist

### 純函式
- [ ] `isBot` — Googlebot / PerplexityBot / GPTBot / ClaudeBot / facebookexternalhit → true；Chrome / Safari / 空 UA → false；大小寫混合
- [ ] `shouldPrerender` — `/about-us` `/faq` `/tours/x` → true；`/api/trpc` `/app.js` `/logo.png` `/sitemap.xml` `/admin` `/profile` → false
- [ ] `cacheKey` — 帶版本前綴；不同 path 不同 key

### Middleware 決策樹（mock renderForBot + cache）
- [ ] flag off → `next()`，不渲染
- [ ] 非 GET（POST）→ `next()`
- [ ] 一般瀏覽器 UA → `next()`，不渲染
- [ ] bot + asset 路徑 → `next()`
- [ ] bot + cache HIT → 回快取 HTML、`X-Prerender: hit`、**不**呼叫 renderForBot
- [ ] bot + cache MISS → 呼叫 renderForBot、寫快取、回 HTML、`X-Prerender: miss`
- [ ] bot + renderForBot 回 null → `next()`（fallback）
- [ ] bot + renderForBot throw → `next()`，不 500
- [ ] Redis get throw → 當 miss 繼續（不 500）

### 渲染服務（mock pool）
- [ ] `renderForBot` 成功 → 回 HTML 字串，`releasePage` 被呼叫
- [ ] `acquirePage` throw → 回 null
- [ ] goto throw → 回 null 且 `releasePage` 仍被呼叫（finally）

## 完成定義

- `pnpm test` 全綠
- 不插真實 DB／不起真 Chrome（全 mock）
