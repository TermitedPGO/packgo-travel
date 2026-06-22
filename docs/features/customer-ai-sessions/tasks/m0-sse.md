# M0 — SSE 關壓縮(對話框復活)

目標:打字後對話框立刻串流,不再盯 15 秒空白。根因見 design §一。

輸入:`server/_core/index.ts`(ask-ops-stream,SSE header ~line 455)、`node_modules/compression/index.js:298`(no-transform 判斷,已驗)。

步驟:
- [ ] header `Cache-Control` 由 `"no-cache"` 改 `"no-cache, no-transform"`。
- [ ] 寫測試驗 SSE 回應 header 含 `no-transform`(supertest 或抽 pure helper)。
- [ ] tsc 0 + 測試綠 → commit。

輸出:改 1 檔 + 1 測試。獨立可 ship。

驗收:prod 部署後實測對話框打字即見字(Jeff 端驗;此處先驗 header）。
