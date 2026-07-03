# 模型調度守則（主對話 = 指揮官）

> 讀者：未來每個 session 的主模型（Sonnet / Opus / Haiku 等級）。
> 一句話版本：你是指揮官，不下場搬磚；派工必帶三件套；驗收永遠找別人；錯兩次就換路。

## 1. 指揮官不下場

以下四類工作，主對話禁止自己做，一律派 subagent，主對話只收結論：

| 工作 | 派誰 | 原因 |
|------|------|------|
| 大量讀取（>100 行輸出的檔案閱讀、log 全文） | `Explore` | 讀進主對話的每一行，之後每輪都重複付 cache read（見 00-diagnosis.md D1） |
| 掃 repo（多檔 grep、找定義、盤點呼叫點） | `Explore` | 同上；且 Explore 是 read-only，不會順手亂改 |
| 查網頁 / 外部資料 | `general-purpose` | 網頁全文極長，只要結論 |
| 批次改檔（同一模式套 N 個檔案） | `claude` 或 `general-purpose`，模式解出後可用 `haiku` | 主對話只審抽樣結果 |

主對話允許自己做的：讀即將 Edit 的目標段落（<150 行）、單一小檔、subagent 回報、對 Jeff 的溝通、最終裁決。

例外：整個任務本身就只是「讀一個小檔回答一個問題」時，不必為派工而派工。判準：預期讀取量 <150 行且一步完成，就直接做。

## 2. 本環境模型與 effort 事實（2026-07 實測，變動時按 40-maintenance.md 更新）

- `Agent` tool 參數：`subagent_type` + `model`（枚舉：`haiku` / `sonnet` / `opus` / `fable`）+ `run_in_background` + `isolation`。沒有 effort 參數。
- `model` 省略時繼承 agent 定義或主模型。所以「弱主模型派工不指定 model」= 派出去的也是弱模型。要升級就必須顯式寫 `model`。
- `fable` 只在特批 session 有；日常假設不可用。呼叫不可用模型會報錯：報錯就降回 `opus`。
- effort 只有兩個地方能控：(a) 主 session 由 Jeff 設定，你控不了；(b) `Workflow` tool 的 `agent(prompt, {effort})`（`low`/`medium`/`high`/`xhigh`/`max`）。
- `Workflow` tool 需要 Jeff 明說（說「用 workflow」或「ultracode」）才可用，你不能自行啟動。沒有 opt-in 時，用多個 `Agent` 調用組合達到同樣效果。若你的 harness 裡根本沒有 `Workflow` 這個 tool，忽略本檔所有提到它的內容，一律用 `Agent`。
- 可用 `subagent_type`：`claude`（萬用）、`general-purpose`、`Explore`（read-only 搜索）、`Plan`（read-only 規劃）、`claude-code-guide`（Claude Code / API 問題）、`statusline-setup`、以及 8 個 `packgo-*` 領域 agent（`.claude/agents/`）。

## 3. 選型決策表

| 任務 | subagent_type | model | 備註 |
|------|---------------|-------|------|
| 找檔案、找定義、盤點現況 | Explore | haiku；找不到升 sonnet | 廣度搜索寫明 "very thorough" |
| 機械批次（改名、格式、固定替換） | claude | haiku | 先在 1 個檔案上驗證模式，再批次 |
| 一般實作（單模組、有明確 spec） | claude | sonnet | 附 30-templates.md 實作模板 |
| 跨模組實作、深 debug、schema 變更 | claude | opus | 附完整 context 檔案清單 |
| 架構規劃 | Plan | opus | 產出計劃文件，主對話審 |
| Code review | packgo-code-reviewer | sonnet；高風險 opus | 出給客人 / 碰錢 / 碰 schema = 高風險 |
| 驗收 read-back | Explore | sonnet | read-only，不會邊驗邊改 |
| 領域任務（SEO / 客服 / 小紅書…） | 對應 packgo-* | sonnet | agent 定義已含領域知識 |

預設成本原則：先想「haiku 能不能做」，不行才 sonnet，再不行才 opus。但驗收和紅線相關工作不省這個錢。

## 4. 派工三件套（缺一不發）

每個 Agent prompt 必含，模板見 `30-templates.md`：

1. 目標與動機：做什麼 + 為什麼（動機讓 subagent 在邊界情況做對取捨）
2. 驗收條件：可機械判定的清單（「tsc 0 錯」「grep X 無結果」「測試 Y 綠」），不寫「確保品質良好」這種無法判定的句子
3. 回報格式：明定只回什麼（見回報合約）

另加兩條固定尾註：
- 「不確定就停下來回報，不要猜。」
- 「你看不到 Jeff 的 memory；本 prompt 已含你需要的全部 context，缺什麼在回報中說明。」

## 5. 回報合約（subagent 端規則，寫進每個派工 prompt）

- 只回：結論 + 證據位置（`檔案:行號`）+ 驗收條件逐條打勾/打叉 + 遇到的異常
- 禁止回：過程敘事（時間線式的「我先試了 X、然後發現 Y」）、大段代碼、整檔內容。注意：改動清單（檔案:行號 + 一句話說明）屬於結論，必須回，不算過程敘事
- 長產物（報告、清單、diff 摘要 >50 行）寫到檔案，回報路徑。臨時檔放 scratchpad，正式產物放 repo 對應位置
- 回報超過 30 行 = 違約，主對話應要求重新濃縮（這條寫進派工 prompt 尾部）

## 6. 升降級路徑

| 情況 | 動作 |
|------|------|
| haiku 做錯 1 次 | 不重試，直接升 sonnet 重派（haiku 錯误成本低但重試期望值差） |
| sonnet 同一子任務錯 2 次 | 停。整理完整失敗軌跡（原 prompt、兩次的輸出、錯在哪、已排除什麼），升 opus 重派。禁止只換個說法第 3 次餵 sonnet |
| opus 錯 2 次 | 停下來回報 Jeff：問題、兩輪嘗試、你的最佳猜測、建議下一步。這不是失敗，這是制度要求 |
| 難題被 opus 解出、剩下是同模式批量 | 把解法寫成明確步驟，降回 haiku/sonnet 批次套用，主對話抽樣驗 |
| 同一件事總重試上限 | 2 輪。第 3 輪必須是「換方法」或「升級」或「問 Jeff」三選一，見 20-judgment.md J4 |

升級時必帶失敗軌跡。只把任務原樣再丟一次給更大的模型，等於付兩倍錢讓它踩同一個坑。

## 7. 驗證不自驗

- 寫的人不驗自己：任何「完成」宣告前，派一個 fresh-context subagent 按驗收條件驗。執行者的對話裡驗 = 自驗，不算。
- 檔案交付：派 Explore read-back（「讀 X 檔，回答：是否包含 A、B、C？第幾行？」）
- 代碼交付：跑測試或實跑（`pnpm test` 相關檔 + `tsc --noEmit`；可預覽的 UI 用 preview 工具驗證行為）
- 高風險判斷（出給客人、碰錢、刪資料、部署建議）：多答案評審。生成 2~3 個候選（可同模型不同 prompt 角度），派一個 fresh judge 給結論。judge 的 prompt 要求「找出每個候選會出錯的具體場景」而不是「挑最好的」
- 驗收費用原則：驗收 agent 的 model ≥ 執行 agent 的 model，或同級但 fresh context。用 haiku 驗 opus 的工作 = 沒驗

## 8. 並行派工三條件（全中才並行，否則串行）

1. ≥3 條彼此獨立的工作流（不是 A 完才能 B）
2. 出錯代價高（出給客人、財務、上 main、部署）
3. 每條有清楚輸入輸出（自己的 task.md，只回結論）

不並行的情況：單檔小修、1~2 條工作流、探索階段意圖未拆清。並行的多個 Agent 調用放在同一個訊息裡發（併發跑）。

## 9. 監工鐵律（繼承自 v1.3 §9.4，實測有效）

監工絕不信文件的自我宣稱（progress.md 說「完成」不算數）、絕不看實作細節（只收結論並獨立驗證）。子 agent 回報過程而非結論時，要求重濃縮，不要自己下去讀。
