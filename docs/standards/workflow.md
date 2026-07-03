# 開發工作流（Vibe Coding 4 階段）

> 從 CLAUDE.md v1.3 §9 抽出並精簡。並行調度與模型選擇已移到 `docs/agent/10-dispatch.md`，本檔不重複。

## 1. Feature ≥ 30 行代碼必走 4 階段

在 `docs/features/<feature-name>/` 建立：
```
proposal.md   ← Stage 1 需求（要解什麼、為誰、驗收長怎樣）
design.md     ← Stage 2 設計（模組劃分、依賴、資料流）
tasks/*.md    ← Stage 3 每模組獨立 checklist
progress.md   ← Stage 3 總覽（監工看這份；完成後回寫實際狀態含「已部署 vN」）
```
Stage 1-3 跑完才准寫 code。階段交接建議換新 session，資訊靠文件傳遞，不靠對話記憶。

行數怎麼算：本次變更新增 + 修改的總行數，跨檔加總；拿不準就當 feature 走。小修（<30 行、單檔、無 schema 變更）不必開 feature 資料夾，但仍要走 tsc + 測試 + commit 規則。

## 2. 每個任務 prompt 四部分

1. 目標（要達成什麼）
2. 輸入（既有檔案、限制、context）
3. 輸出（寫到哪、什麼格式）
4. 步驟（含「不確定就問，不要猜」）

Jeff 一句話帶過時，主模型自己補齊另外三部分再執行；補不齊的部分用 AskUserQuestion 問，不腦補。

## 3. 主動發問

遇到 ambiguous 需求直接用 AskUserQuestion，不要「先做做看」。何時該問、何時不該問的判準見 `docs/agent/20-judgment.md` J3。

## 4. 紅線（違反就回頭補）

- ship code 沒寫對應 Vitest
- 新檔案 > 300 行沒拆模組（存量大檔不追殺，按 churn 熱度排程拆）
- commit 前沒跑 `tsc --noEmit`
- session > 80 turns 還在同一對話（該開新 session 用文件交接）
- 用 Edit 大改後沒 Read 驗證
- 該發問時用腦補代替

## 5. 何時開新對話

- 4 階段任一交接時
- session > 80 turns
- 換完全不同 feature / 主題
- 發現自己在往回捲找三十輪前的內容（token 已在燒，見 `docs/agent/00-diagnosis.md` D1）

## 6. 歷史教訓存檔

- 2026-05-29 bookkeeping 收尾：progress.md 自稱「全部完成可上線」，並行驗證仍抓到 1 個 P0（硬編碼中文）+ 3 個漂移測試。文件自稱 ready 不可信，一律獨立驗證。
- 2026-06-08 v672：發生未授權自主部署，因此立 deploy guard（見 `docs/standards/backend.md` §8）。
- 2026-06-30 Emerald Young 重複客人：insert 前沒查重，因此立 customerProfiles 先查再插（見 `docs/standards/backend.md` §2.2）。
- 2026-07-02 repo 公開暴露客人 PII：packgo-travel 自 2 月起為 public，8+ 文檔含真實客人姓名、20 個 commit 提及客人（幸 0 fork 無散播）。規則：含客人可識別資訊的內容只進 private repo；任何 repo 轉 public 前先掃 PII（grep 客人名 + secret 模式）與供應商逆向代碼。
