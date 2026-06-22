# 客戶 AI Sessions — Progress(監工總覽)

> 給監工看的單頁。狀態只認「tsc 0 + 測試綠 + 已 commit」,不認文件自稱完成(§9.4 鐵律)。

| 模組 | 內容 | 狀態 | commit |
|------|------|------|--------|
| M0 | SSE 關壓縮(對話框復活) | ⬜ todo | |
| M1 | 文件全文抽取 helper | ⬜ todo | |
| M2 | 客人 AI context 引擎 | ⬜ todo | |
| M3 | AI 摘要生成 + 快取 + cron | ⬜ todo | |
| M4 | 對話框讀文件 + Haiku | ⬜ todo | |
| M5 | 前端點亮(摘要/下一步/重算鈕) | ⬜ todo | |

狀態圖例:⬜ todo / 🟡 進行中 / ✅ 綠+commit / ⛔ 卡住

## 依賴順序
M0(獨立,先上)→ M1 → M2 → M3 → M5;M4 接 M0+M1。

## 紅線(每個 commit 前過)
tsc 0、對應 Vitest 綠、PII 不另存、成本不外洩、唯讀、不破折號、i18n 不硬編碼、adminProcedure。
