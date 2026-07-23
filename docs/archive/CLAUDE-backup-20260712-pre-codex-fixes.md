# PACK&GO 旅行社：AI 開發 Context（路由版）

> v2.0（2026-07-02 Fable 5 立制重寫）。本檔只放「每個 session 都必須知道」的內容；細節按下方路由表載入。
> 舊版全文備份：`docs/archive/CLAUDE-v1.3-backup-20260702.md`。改本檔前先讀 `docs/agent/40-maintenance.md`。

## 一、專案事實

| 項目 | 值 |
|------|-----|
| 專案 | PACK&GO 旅行社（一人公司，業主 Jeff） |
| 技術棧 | React 19 + Tailwind 4 + tRPC 11 + Drizzle ORM + MySQL + Wouter |
| 部署 | packgoplay.com（Fly.io app `packgo-travel`） |
| 語言 | 繁體中文預設、英文；用戶角色 `user` / `admin` |
| 本地限制 | 無 DATABASE_URL（DB 操作在 prod/Fly 跑）；記憶體吃緊，tsc OOM 用 `NODE_OPTIONS="--max-old-space-size=6144"` |

## 二、硬紅線（違反 = 立即停手回報，沒有例外）

1. 部署：prod 只能 `pnpm ship`。任何 session 直接 `flyctl deploy` = 違規。Jeff 說「給我 code」= 給他可貼終端的指令區塊，不是代跑。全文：`docs/standards/backend.md` §8。
2. 客人文件價格：供應商 invoice 金額是成本，絕不出現在客人文件上；出檔前逐項比對。任何報給客人的單價，先在供應商後台模擬訂單核對，flyer 文字不可信。
3. Trust 會計：Trust #5442 收的訂金不是營收；出發後轉 Operating #2174 才 recognize（加州 CST §17550）。帳務任務先確認這條。
4. 護照號：讀寫一律走 `server/db.ts` 包好的加密函式，直接 insert/select 明文 = 事故。全文：`docs/standards/backend.md` §2.1。
5. customerProfiles：insert 前必先查同 email/phone，找到就重用，找不到才插。全文：`docs/standards/backend.md` §2.2。
6. 設計：所有可見 UI 元素必須有圓角（唯一例外全寬 Hero 背景圖）；像素對齊與密度節奏同級紅線。全文：`docs/standards/design.md`。
7. i18n：JSX 禁止硬編碼中文字串（動態資料庫內容除外），一律 `t('key')` 並同步 `zh-TW.ts` + `en.ts`。
8. LLM 只在 server 端經 `server/_core/llm.ts` 調用；前端禁止。

## 三、開工路由（動手前先讀對的檔）

| 任務涉及 | 先讀 |
|----------|------|
| 前端 UI / 頁面 / 樣式 | `docs/standards/design.md` |
| 後端 / API / DB / schema / 檔案路徑查詢 | `docs/standards/backend.md` |
| 新 feature（≥30 行 code） | `docs/standards/workflow.md`，開 `docs/features/<name>/` 四件套 |
| 派 subagent、選模型、大量讀取/掃描 | `docs/agent/10-dispatch.md` |
| 卡住、想重試、想問 Jeff、懷疑方向錯 | `docs/agent/20-judgment.md` |
| 委派任務要寫 prompt | `docs/agent/30-templates.md`（五種模板直接填空） |
| 修改 CLAUDE.md 或 docs/agent、docs/standards 本身 | `docs/agent/40-maintenance.md` |
| 新模型首次接手這個環境 | `docs/agent/50-letter.md`（讀一次即可） |
| 客人文件（報價/收據/機票/行程表） | 用對應 packgo-* skill，禁止自己從頭寫 HTML |
| Token 燒太快、對話太長 | `docs/agent/00-diagnosis.md` |

## 四、通用工作規則

- 驗證鏈：`tsc --noEmit` 0 錯 + 相關測試綠 → 直接 commit，不用問（Jeff 授權 green 即 commit）。新功能必有 Vitest；測試禁止插真實資料進 DB。
- 讀取紀律：預期輸出 >100 行的讀取（掃 repo、多檔搜索、網頁全文）派 Explore subagent 只收結論；主對話只讀即將編輯的段落。長產物（>50 行）寫檔傳路徑，不貼進對話。
- 完成紀律：自己說完成不算完成。宣告完成前按 `docs/agent/20-judgment.md` J2 自檢；重要交付派 fresh subagent 驗收。
- Session 紀律：>80 turns、換主題、或 feature 批次收完（commit + progress.md 回寫）就開新 session，靠文件交接。
- Edit 大改後 read-back 驗證；同一方法失敗 2 次禁止第 3 次原樣重試（見 judgment J4）。
- 對 Jeff 的回覆：不用破折號、不用 ** 粗體標記（他那端顯示原始符號）、中文回覆、短句直說。
