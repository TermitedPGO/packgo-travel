# Progress — Bot-UA Dynamic Rendering

> 給監工 agent 看的總覽。**監工不信此檔自我宣稱、不看實作細節，只收子 agent 結論並獨立驗證**（§9.4 鐵律）。

## 狀態：Stage 4 實作完成，待部署驗證

| Stage | 產出 | 狀態 |
|-------|------|------|
| 1 需求 | [proposal.md](./proposal.md) | ✅ |
| 2 設計 | [design.md](./design.md) | ✅ |
| 3 任務 | [tasks/](./tasks/) ×4 | ✅ |
| 4 實作 | M1-M4 | ✅ 2026-05-29 |

## 模組進度

| 模組 | 檔案 | 狀態 | 驗證 |
|------|------|------|------|
| M1 偵測+快取 | `server/_core/prerenderMiddleware.ts` | ✅ | 15 單元測試 |
| M2 渲染 | `server/_core/prerender.ts` | ✅ | 6 mock-pool 測試 |
| M3 接線 | `server/_core/index.ts`（+import +`app.use`） | ✅ | tsc 0 error |
| M4 測試 | `server/prerenderMiddleware.test.ts` + `server/prerender.test.ts` | ✅ | 21/21 綠 |

## 紅線檢查（§9.5-9.6）

- [x] `pnpm check`（tsc 0 error）
- [x] `pnpm test` 新檔 21/21 綠
- [x] 無 console.*（用 logger child）
- [x] 渲染失敗一律 graceful（render→null→next；catch→next；**絕不 500 爬蟲**）
- [x] 一般 UA 行為**完全不變**（非 bot → 立即 next()）

## ⚠️ 尚未做的驗證（誠實標注）

**本地無法跑端到端真渲染** —— puppeteer-core 預設 `CHROMIUM_PATH=/usr/bin/chromium`，Mac 上不存在；且 dev server 開機需 DATABASE_URL/JWT_SECRET 等。Chromium **只存在於 Fly prod image**。
→ 真正的「raw HTML 有 ld+json」驗證**只能在部署後**用下方 curl 確認。單元測試只證明決策樹 + pool 互動邏輯正確，**不證明** Chrome 真的渲染出 schema。

## 上線驗證（成功標準，proposal §成功標準）

```bash
curl -sL -A "Googlebot"     https://packgoplay.com/         | grep -c 'ld+json'   # > 0
curl -sL -A "PerplexityBot" https://packgoplay.com/about-us | grep -c 'ld+json'   # > 0
curl -sL -A "Googlebot"     https://packgoplay.com/faq      | grep -i description  # 有
curl -sI -A "Googlebot"     https://packgoplay.com/         | grep -i X-Prerender  # hit/miss
# 對照：一般 UA 應仍是空殼
curl -sL https://packgoplay.com/ | grep -c 'ld+json'                              # 仍 0（真人走 SPA）
```

## Rollback

`fly secrets set PRERENDER_ENABLED=0` → 即時退回現狀，零碼變更。

## 備註

- Chromium + CJK 字型已在 prod image、Redis 已在跑、puppeteerPool 已存在 → 不需新依賴/build/router 變更。
- 上線後：更新 memory `project_seo_clientside_invisible`（該記憶註明「prerender 上線即作廢」），並讓 packgo-ai-citation agent 重跑 baseline 量 citation 改善。

---
## 2026-07-01 部署查證(Claude)
已上線且驗證生效:Googlebot UA 打 https://packgoplay.com/ 拿到 86KB prerendered HTML(含完整 title/內容),一般 UA 拿 6KB SPA shell,分流正確。prod = v771。本檔先前「待部署驗證」狀態已過期。後續:更新 memory project_seo_clientside_invisible、跑 packgo-ai-citation baseline。
