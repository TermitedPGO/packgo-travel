# 客戶 AI Sessions — Progress(監工總覽)

> 給監工看的單頁。狀態只認「tsc 0 + 測試綠 + 已 commit」,不認文件自稱完成(§9.4 鐵律)。

| 模組 | 內容 | 狀態 | commit |
|------|------|------|--------|
| M0 | SSE 關壓縮(對話框復活) | ✅ 綠+commit | 3b6c1ed |
| M1 | 文件全文抽取 helper | ✅ 綠+commit | 38c70d6 |
| M2 | 共用 loadCustomerDocs(文件 tab + AI 引擎共用) | ✅ 綠+commit | 0508a73 |
| M3 | AI 摘要引擎 + 快取 + tRPC | ✅ 綠+commit | 43ea7ca |
| M3b | 摘要背景暖機 cron | ✅ 綠+commit | e24fb4d |
| M4 | 對話框讀文件 + Haiku | ✅ 綠+commit | 0508a73 |
| M5 | 前端點亮(摘要/下一步/重算鈕) | ✅ 綠+commit | 549eede |

三個積木全亮:AI 摘要 ✓ AI 下一步 ✓ 對話框(修好+讀文件)✓

## 診斷結論(改寫 proposal 猜測)
對話框「15 秒沒回」不是 DB/LLM stall(伺服器 1.3s 首 token、8.2s 答完)。真因是
全域 compression() 把 SSE 也 Brotli 壓了,token 卡在緩衝。修法:SSE 回應加
no-transform(M0)+ 客人 scope 改 Haiku(M4)。詳見 design.md §一。

## 待 Jeff 操作(本地無 DB,我不能代做)
- `pnpm ship` 部署。release_command 會跑 migration 0100(加 aiSummary/aiSummaryAt 欄)。
- 部署後實測對話框打字即見字 + 開 Jenny 卡看 AI 摘要/下一步是否點亮。

## 已知取捨(設計決策,非 bug)
- 護照/簽證/保險/醫療掃描:只列文件清單,不 OCR 進 prompt(PII + 成本)。報價/行程
  PDF 全讀。若 Jeff 要連護照也讀,改 customerDocsText.ts 的 PII_KINDS。
- 摘要 context 重用 chat context builder(含少量 chat-pin 指令);摘要品質若覺得薄,
  之後可抽純 data 層。

## 紅線(每個 commit 前過,全數守住)
tsc 0 ✓、對應 Vitest 綠 ✓、PII 不另存 ✓、成本不外洩 ✓、唯讀 ✓、不破折號 ✓、
i18n parity 0 ✓、adminProcedure ✓。
