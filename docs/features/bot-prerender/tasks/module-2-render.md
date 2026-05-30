# M2 — 渲染服務

檔案：`server/_core/prerender.ts`（新增）
依賴：`server/_core/puppeteerPool.ts`（既有 `acquirePage`/`releasePage`）、`logger.ts`
設計：[design.md §4](../design.md)

## Checklist

- [ ] `renderForBot(pathname): Promise<string | null>`
- [ ] target = `http://127.0.0.1:${process.env.PORT || "8080"}${pathname}`（同 server，真 DB 資料）
- [ ] `acquirePage()` 取 page；try/finally 確保 `releasePage(page)` **永遠**歸還 slot
- [ ] `page.setUserAgent("PackgoPrerender/1.0 …")` — **非 bot UA**，避免內部請求被 middleware 再攔（無限迴圈防護）
- [ ] `page.setViewport({width:1280,height:900})`
- [ ] `page.goto(target, { waitUntil: "networkidle2", timeout: 12000 })`
- [ ] `page.waitForFunction(...)` 等 `#root` 有子節點 **且** 有 `script[type="application/ld+json"]`，timeout 8000，`.catch()` 容忍（至少回 networkidle 後 HTML）
- [ ] `stripDevArtifacts(html)` — 移 `?v=` cache-bust、dev-only 注入（prod 通常已無，但保險）
- [ ] 任何 throw → log + 回 `null`（middleware 負責 fallback）

## 風險點（design §6）

- 共用 pool 的 2 個 slot；timeout 短防卡死
- waitUntil networkidle2（容忍 ≤2 長連線）避開輪詢頁

## 完成定義

- 給定一個本地 server，`renderForBot("/")` 回的 HTML 含 ld+json 且 `#root` 非空
- 渲染失敗（如 pool throw）回 null 而非 throw
- 測試以 mock `acquirePage`/`releasePage` 驗證 finally 歸還 + 失敗回 null
