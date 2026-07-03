# 制度檔案維護協議

> 讀者：未來的主模型。這套制度（CLAUDE.md + docs/agent/ + docs/standards/）必須能被你安全地更新，否則半年後就是一堆過時文件。本檔定義怎麼改不會改壞。

## 1. 分區：什麼你能直接改，什麼要先問

- 綠區（直接改，改完 commit）：
  - `docs/standards/*` 的事實層：檔案路徑表、指令、架構描述（跟著 code 變就更新）
  - `docs/standards/workflow.md` §6 教訓存檔：追加新教訓（格式見 §3）
  - `docs/agent/20-judgment.md` 的正例/反例：可以補新例子（判準本體不動）
  - `docs/agent/10-dispatch.md` §2 環境事實：模型陣容 / 工具實測變了就更新，標日期
  - `docs/agent/50-letter.md` 的交接附錄區：session 中斷時寫交接
- 黃區（先用 AskUserQuestion 給 Jeff 看 diff，同意才改）：
  - `CLAUDE.md` 任何內容
  - `20-judgment.md` 的判準本體、`10-dispatch.md` 的閾值（錯 2 次升級、回報 30 行上限等）
  - `30-templates.md` 的三件套結構
- 紅區（除非 Jeff 主動下令，否則不碰）：
  - 刪除任何紅線、刪除 `docs/archive/` 的備份
  - 任何「把驗證要求放寬」的編輯：把「必須」改成「建議」、把「禁止」改成「盡量避免」、提高重試上限。**特別警告：如果你想改規則的動機是「這條規則擋住了我現在的任務」，這 100% 是紅區。規則擋你通常是規則對。**

## 2. 改前備份 + 改後可讀性驗證

1. 改 `CLAUDE.md` 或 `docs/agent/*` 前：`cp <檔案> docs/archive/<檔名>-backup-YYYYMMDD.md`（同日多次改只留第一份）
2. 改完派一個 fresh subagent（model: haiku）讀改後的段落，問它：「按這條規則，遇到【具體場景】你會怎麼做？」haiku 複述不出正確動作 = 規則寫得不夠明確，改寫到它能複述為止。制度的讀者是弱模型，這個測試不可省
3. Commit message 用 `docs(agent): ...` 前綴，一句話說明改了哪條、為什麼

## 3. 踩坑教訓寫回流程（學習迴圈的檔案版）

事故修完後，回答一個問題：這是個案還是模式？
- 個案（特定 feature 的特定 bug）→ 寫進該 feature 的 `progress.md`，制度檔不動
- 模式（同類錯誤會再犯）→ 按對象寫回：
  - 技術規範類 → `docs/standards/` 對應檔對應節
  - 判斷類（該問沒問、該停沒停、自驗放行了壞東西）→ `20-judgment.md` 對應判準下追加正例或反例（一條 ≤3 行）
  - 教訓格式：`日期 + 病徵一句話 + 根因一句話 + 規則化一句話`。禁止把事故完整敘事貼進制度檔
- Jeff 的個人偏好與跨專案教訓 → 仍走 memory 機制（`~/.claude/.../memory/`），不進 repo

## 4. 膨脹閾值（超過就精簡，精簡也是黃區以上要問的動作除外如下）

| 檔案 | 閾值 | 動作 |
|------|------|------|
| CLAUDE.md | >120 行 | 抽細節到 standards（黃區：先問） |
| 任一 standards 檔 | >250 行 | 拆檔或把過時節移 docs/archive/（綠區） |
| workflow.md §6 教訓存檔 | >15 條 | 合併同類，老的移 docs/archive/（綠區） |
| MEMORY.md 索引 | >80 行 | 跑 `anthropic-skills:consolidate-memory` skill（綠區，但刪 memory 內容前逐條確認仍正確） |
| settings.local.json permissions | 一次性垃圾條目堆積 | 提醒 Jeff 跑 `/fewer-permission-prompts` 或手動清（不要自己動 settings） |

## 5. 單一事實源原則

同一條規則只允許一個檔案有全文，其他位置一律寫引用（`見 xxx.md §n`）。發現兩處全文時：保留較完整的一份，另一處改成指針。最容易漂移的兩對：CLAUDE.md 紅線摘要 vs standards 全文（摘要可以短，但不可與全文矛盾）；dispatch §8 並行三條件 vs workflow.md（workflow 已改為指針，保持）。

## 6. Harness 變動偵測（每次大版本更新後做一次）

觸發：模型陣容變了、Agent/Workflow tool 參數變了、出現新工具、cache 機制變了。
動作：用一個 30 秒小任務實測（例：派一個 haiku Explore 讀 README 回一句話），確認 model 枚舉和行為，把實測結果寫進 `10-dispatch.md` §2 並標日期。憑印象更新 = 禁止；`00-diagnosis.md` 的數據若因 harness 改版失效，在該檔頂部加一行「部分失效，見 dispatch §2」，不重寫舊診斷。

## 7. 制度健康檢查（低頻，Jeff 說「檢查制度」時跑）

派一個 fresh subagent（model: sonnet）做四件事：(a) 抽查 5 條規則問「路徑/指令還存在嗎」（防過時）；(b) 找互相矛盾的規則對；(c) 找最近 20 個 commit 中違反制度的實例（防形同虛設）；(d) 回報哪條規則從來沒被用過（候選刪除）。結果給 Jeff 裁決，不自動改。
