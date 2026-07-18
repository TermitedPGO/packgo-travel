# PACK&GO 旅行社：AI 開發 Context（路由版）

> v2.1（owner: Fable 指揮；last_verified_at: 2026-07-12）。本檔只放「每個 session 都必須知道」的低漂移憲法與路由；動態事實（部署版本/旗標/批次）在 STATE.md，治理控制細節在 `docs/agent/60-evidence-and-ops.md`。
> 主 session 開工必讀 `docs/agent/STATE.md`（唯一狀態源）；執行者只讀派工單與所需規範。改本檔前先讀 `docs/agent/40-maintenance.md`。舊版備份：`docs/archive/`。

## 一、專案事實

| 項目 | 值 |
|------|-----|
| 專案 | PACK&GO 旅行社（一人公司，業主 Jeff） |
| 技術棧 | React 19 + Tailwind 4 + tRPC 11 + Drizzle ORM + MySQL + Wouter |
| 部署 | packgoplay.com（Fly.io app `packgo-travel`） |
| 語言 | 繁體中文預設、英文；用戶角色 `user` / `admin` |
| 本地限制 | 無 DATABASE_URL ≠ 可在 prod 試做（見紅線 9 與 `docs/agent/60-evidence-and-ops.md` §6）；記憶體吃緊，tsc OOM 用 `NODE_OPTIONS="--max-old-space-size=6144"` |

## 二、硬紅線（違反 = 立即停手回報，沒有例外）

1. 部署：prod 只能 `pnpm ship`。任何 session 直接 `flyctl deploy` = 違規。Jeff 說「給我 code」= 給他可貼終端的指令區塊，不是代跑。全文：`docs/standards/backend.md` §8。
2. 客人文件價格：供應商 invoice 金額是成本，絕不出現在客人文件上；出檔前逐項比對。任何報給客人的單價，先在供應商後台模擬訂單核對，flyer 文字不可信。
3. Trust 會計：客戶旅遊款項具信託責任，不得僅以出發日推導可提領或可認列。每筆信託轉出須綁定旅客/訂單、法定提領類型、金額、原始證據及 Jeff 核准；法律與會計時點依律師/CPA 矩陣，矩陣未定或證據不足即停手回報。帳號對應在受控財務 runbook，不進根文件。全文：`docs/agent/60-evidence-and-ops.md` §7。
4. 護照號：讀寫一律走 `server/db.ts` 包好的加密函式，直接 insert/select 明文 = 事故。全文：`docs/standards/backend.md` §2.1。
5. customerProfiles：insert 前先正規化查同 email/phone，命中視為「候選」非自動同一人；一對多、欄位衝突、高風險操作轉人工，用 transaction/constraint 防競態。全文：`docs/standards/backend.md` §2.2、`60-evidence-and-ops.md` §10。
6. 設計：所有可見 UI 元素必須有圓角（唯一例外全寬 Hero 背景圖）；像素對齊與密度節奏同級紅線。全文：`docs/standards/design.md`。
7. i18n：JSX 禁止硬編碼中文字串（動態資料庫內容除外），一律 `t('key')` 並同步 `zh-TW.ts` + `en.ts`。
8. LLM 只在 server 端經 `server/_core/llm.ts` 調用；前端禁止。
9. 正式 DB：runtime 身分禁 DDL；一般 session 不得改正式資料；prod 診斷預設唯讀+核准腳本+留 audit；重抓/回填/破壞性驗證先在隔離 clone，DDL 實測只打 canary。全文：`60-evidence-and-ops.md` §6。

## 三、開工路由（動手前先讀對的檔）

| 任務涉及 | 先讀 |
|----------|------|
| 前端 UI / 頁面 / 樣式 | `docs/standards/design.md` |
| 後端 / API / DB / schema / 檔案路徑查詢 | `docs/standards/backend.md` |
| 新 feature（≥30 行 code，或命中高風險類別：錢/帳/客戶承諾/PII/schema/權限/部署/對外訊息/批次資料，行數不論） | `docs/standards/workflow.md`，開 `docs/features/<name>/` 四件套 |
| 完成宣稱/狀態語言/WIP/證據安全/信託金流 | `docs/agent/60-evidence-and-ops.md`（治理單一事實源） |
| 派 subagent、選模型、大量讀取/掃描 | `docs/agent/10-dispatch.md` |
| 卡住、想重試、想問 Jeff、懷疑方向錯 | `docs/agent/20-judgment.md` |
| 委派任務要寫 prompt | `docs/agent/30-templates.md`（五種模板直接填空） |
| 修改 CLAUDE.md 或 docs/agent、docs/standards 本身 | `docs/agent/40-maintenance.md` |
| 新模型首次接手這個環境 | `docs/agent/50-letter.md`（讀一次即可） |
| 客人文件（報價/收據/機票/行程表） | 用對應 packgo-* skill，禁止自己從頭寫 HTML |
| Token 燒太快、對話太長 | `docs/agent/00-diagnosis.md` |

## 四、通用工作規則

- 驗證鏈：`tsc --noEmit` 0 錯 + 相關測試綠 → commit（Jeff 授權 green 即 commit），但 commit 只代表「已提交」非已合併/部署/啟用（狀態階梯見 60 §1）。高風險變更 commit 前需事實錨點+回滾/停用法+相稱驗證。新功能必有 Vitest；測試禁止插真實資料進 DB。
- 讀取紀律：一般 repo 掃描派 Explore 收摘要；但碰錢/客戶/schema/權限/正式狀態/完成宣稱，主指揮必親讀最小必要原文或原始輸出，摘要必附行號/query/輸出路徑,無引用摘要不得作高風險裁決依據。長產物（>50 行）寫檔傳路徑。
- 完成紀律：自己說完成不算完成。任何完成宣稱必附非空 evidence_reference（指向實際產物，非派工單/自述，見 60 §2）；宣告前按 20-judgment J2 自檢+核實才裁；高風險交付走三層驗證（60 §3）,fresh agent 是第二雙眼非獨立真相源。
- Session 紀律：>80 turns、換主題、或 feature 批次收完（commit + progress.md 回寫）就開新 session，靠文件交接。
- Edit 大改後 read-back 驗證；同一方法失敗 2 次禁止第 3 次原樣重試（見 judgment J4）。
- 對 Jeff 的回覆：不用破折號、不用 ** 粗體標記（他那端顯示原始符號）、中文回覆、短句直說。
