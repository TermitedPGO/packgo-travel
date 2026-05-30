# Design — Runtime Bot-UA Dynamic Rendering

> Stage 2 of §9.1. 依賴 [proposal.md](./proposal.md)。模組拆分見 [tasks/](./tasks/)。

## 1. 架構總覽

```
                    ┌─────────────────────────────────────────────┐
  request ──────────►  Express middleware chain (index.ts)         │
                    │                                              │
                    │  ① /api/* tRPC          → 既有 router        │
                    │  ② /sitemap.xml /robots /healthz → 既有      │
                    │  ③ prerenderMiddleware  ← 新增（本功能）     │
                    │       │                                      │
                    │       ├─ 非 bot UA / asset / API → next()    │
                    │       ├─ bot + cache HIT  → 回快取 HTML       │
                    │       └─ bot + cache MISS → render → 快取 → 回 │
                    │  ④ serveStatic / setupVite（SPA 殼 fallback）│
                    └─────────────────────────────────────────────┘
                                    │ render（cache miss）
                                    ▼
            prerender.ts: acquirePage() → goto(127.0.0.1:PORT/path)
                          → 等 ready → page.content() → releasePage()
                                    │
                          puppeteerPool.ts（既有，並發上限 2）
```

**插入點：** [index.ts:808-810](../../../server/_core/index.ts)，在 `setupVite(app, server)` / `serveStatic(app)` **之前**、API + sitemap/robots/health **之後**。assets（.js/.css/.png…）由 middleware 放行 → 仍走 `express.static`。

## 2. 模組劃分

| 模組 | 檔案 | 職責 | 純度 |
|------|------|------|------|
| M1 偵測+快取 | `server/_core/prerenderMiddleware.ts` | bot UA 比對、路徑過濾、Redis get/set、env gate、組裝 middleware | 多為純函式，好測 |
| M2 渲染 | `server/_core/prerender.ts` | `renderForBot(path)`：用 pool 渲染、等 ready、剝 dev script、timeout、失敗回 null | 副作用（Puppeteer），mock pool 測 |
| M3 接線 | `server/_core/index.ts`（改） | 掛 middleware、env flag、order | 整合 |
| M4 測試 | `server/prerenderMiddleware.test.ts` | UA matcher / 路徑過濾 / cache key / 決策樹 / 失敗 fallback | Vitest |

> M2 依賴既有 [puppeteerPool.ts](../../../server/_core/puppeteerPool.ts)（`acquirePage` / `releasePage` / `shutdownPool` 已接 SIGTERM）。**不自己 launch browser。**

## 3. M1 — 偵測 + 快取（`prerenderMiddleware.ts`）

### 3.1 Bot UA 名單

```ts
// 大小寫不敏感，子字串比對。涵蓋搜尋 + AI 答案引擎 + 社群預覽。
const BOT_UA = [
  // 搜尋
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
  "yandexbot", "sogou", "exabot", "applebot", "ia_archiver",
  // AI 答案引擎（不跑 JS，這群是 AEO 主目標）
  "gptbot", "oai-searchbot", "chatgpt-user", "perplexitybot",
  "claudebot", "anthropic-ai", "claude-web", "google-extended",
  "ccbot", "cohere-ai", "bytespider", "amazonbot", "youbot",
  // 社群預覽（OG/Twitter card）
  "facebookexternalhit", "twitterbot", "linkedinbot", "slackbot",
  "telegrambot", "whatsapp", "discordbot", "pinterest",
];
function isBot(ua: string | undefined): boolean {
  if (!ua) return false;
  const l = ua.toLowerCase();
  return BOT_UA.some((b) => l.includes(b));
}
```

### 3.2 路徑過濾（只預渲染「會是 HTML 的頁面」）

```ts
// 跳過：API、靜態資源（有副檔名）、SEO/health 端點。
function shouldPrerender(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/__manus__")) return false;
  if (["/sitemap.xml", "/robots.txt", "/healthz", "/health"].includes(pathname)) return false;
  // 有副檔名（.js .css .png .webp .ico .json .map …）→ 是 asset，放行
  if (/\.[a-z0-9]+$/i.test(pathname)) return false;
  // 私密/無 SEO 價值頁不渲染（省資源 + 不外洩）
  if (/^\/(admin|profile|bookings?|book|payment|reset-password|forgot-password)\b/.test(pathname)) return false;
  return true;
}
```

> 私密頁直接放行 → bot 拿空殼即可（本來就 noindex）。省渲染資源、避免外洩會員資料。

### 3.3 Redis 快取

```ts
// key 帶版本，部署時 bump CACHE_VERSION（或用 FLY_MACHINE_VERSION）讓舊快取自然過期。
const CACHE_VERSION = process.env.FLY_MACHINE_VERSION || "v1";
const ttlSeconds = 60 * 60 * 24; // 24h
const key = (pathname: string) => `prerender:${CACHE_VERSION}:${pathname}`;
// 用既有 ioredis client（server/redis.ts）。get 失敗（Redis down）→ 當 miss，不可 throw。
```

`?nocache=1` 旁路（僅供除錯，仍要求 bot UA）強制重渲染。

### 3.4 Middleware 決策樹

```
prerenderMiddleware(req, res, next):
  if (!PRERENDER_ENABLED)                 → next()
  if (req.method !== "GET")               → next()
  if (!isBot(req.headers["user-agent"]))  → next()
  pathname = req.path
  if (!shouldPrerender(pathname))         → next()
  try:
    if (!nocache) html = await cacheGet(key(pathname))
    if (html)  → res.set("X-Prerender","hit").send(html); return
    html = await renderForBot(pathname)        // M2，含 timeout
    if (!html) → next()                        // 渲染失敗：degrade 回空殼，絕不 500
    await cacheSet(key, html, ttl)             // 失敗只 log，不影響回應
    res.set("X-Prerender","miss").send(html)
  catch (err):
    log.error({err, pathname}, "prerender failed"); next()   // 永遠 graceful
```

`X-Prerender: hit|miss` header 方便 curl 驗證 + 監控命中率。

## 4. M2 — 渲染（`prerender.ts`）

```ts
export async function renderForBot(pathname: string): Promise<string | null> {
  const PORT = process.env.PORT || "8080";
  const target = `http://127.0.0.1:${PORT}${pathname}`;
  let page: Page | null = null;
  try {
    page = await acquirePage();                       // 既有 pool，並發上限 2
    // 重要：UA 不可在 bot 名單內，否則內部請求又被 middleware 攔 → 無限迴圈。
    await page.setUserAgent("PackgoPrerender/1.0 (+headless-internal)");
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(target, { waitUntil: "networkidle2", timeout: 12000 });
    // 等 React 掛載 + SEO helmet 注入：#root 有子節點 + 有 ld+json。
    await page.waitForFunction(
      () => {
        const root = document.getElementById("root");
        const hasContent = !!root && root.children.length > 0;
        const hasSchema = !!document.querySelector('script[type="application/ld+json"]');
        return hasContent && hasSchema;
      },
      { timeout: 8000 }
    ).catch(() => { /* 容忍：至少回 networkidle 後的 HTML */ });
    let html = await page.content();
    html = stripDevArtifacts(html);                   // 移開發注入 + ?v= cache-bust
    return html;
  } catch (err) {
    log.error({ err, pathname }, "renderForBot failed");
    return null;                                       // middleware 會 fallback
  } finally {
    if (page) await releasePage(page);                // 永遠歸還 slot
  }
}
```

**設計決策：**
- `waitUntil: networkidle2`（容忍 ≤2 個長連線，避開輪詢頁卡死）+ `waitForFunction` 等 schema 真的注入，雙保險。兩個 timeout 都短（12s / 8s）→ bot 不會被拖太久，超時就回當下 HTML。
- 渲染目標是 `127.0.0.1:PORT`（同一台 server）→ 真 DB 資料、tour 詳情頁也能渲染。
- `setUserAgent` 用非-bot UA → 內部請求被 middleware 放行、正常跑 SPA → **無迴圈**。
- 失敗一律回 `null`，middleware fallback 回空殼。爬蟲永遠不會收到 500。

## 5. M3 — 接線（`index.ts`）

```ts
import { prerenderMiddleware } from "./prerenderMiddleware";
// … 在 setupVite/serveStatic 之前（約 line 805）：
app.use(prerenderMiddleware);
if (process.env.NODE_ENV === "development") { await setupVite(app, server); }
else { serveStatic(app); }
```

env flag：`PRERENDER_ENABLED`（預設：prod 開、dev 關）。`shutdownPool` 已在 SIGTERM 接好，無需再加。

## 6. 記憶體 / 並發策略（1GB VM）

- pool `MAX_PAGES=2`，與 PDF 共用 → 全機最多 2 個 Chrome page，OOM 風險受控。
- Redis 快取 24h → 第一次爬某 URL 才渲染，之後 cache-hit 不碰 pool。穩態渲染次數 ≈ 0。
- 兩個 render timeout（12s/8s）防卡死占 slot。
- 風險：大量未快取 URL 同時被爬（如首次 sitemap 全站爬）會排隊。可接受（爬蟲容忍延遲）；必要時 phase 2 加「只快取、背景補渲染」的 stale-while-revalidate。

## 7. 驗證計畫（對應成功標準）

1. `pnpm check`（tsc 0 error）+ `pnpm test`（M4 全綠）。
2. 本地：`PRERENDER_ENABLED=1` 起 server，`curl -A "Googlebot" localhost:8080/ | grep -c ld+json` > 0；`curl`（一般 UA）仍回空殼。
3. 部署後對 /、/about-us、/faq、/tours、某 /tours/:id 跑成功標準的 curl；確認 `X-Prerender` header。
4. 監控：Fly 記憶體曲線、`X-Prerender` hit 率、Sentry 有無 render error 爆量。

## 8. Rollback

`fly secrets set PRERENDER_ENABLED=0` → middleware 立即全 `next()`，退回現狀。零碼變更即可關閉。
