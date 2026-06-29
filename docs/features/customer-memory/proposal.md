# 客人專屬記憶 — Proposal (Stage 1)

## 目標 (Goal)
讓每個客人有一份「會長大的記憶」,AI 每次跟 Jeff 聊到或幫這個客人擬訊息時，都先讀它。
結果：AI 真的懂這個客人（吃素、怕高、喜歡高樓層、討厭紅眼班機…），擬出來的草稿自動貼合，
不用 Jeff 每次提醒。

> 用詞校正：這是「上下文記憶」(context / RAG)，不是「訓練模型」。同樣的效果，但機制是
> 每次讀一份檔，不是去 fine-tune。所以沒有訓練成本、改一次就生效。

## 現況 (Input — 已有 7 成)
- `customerProfiles.aiNotes / keyFacts / preferences` 欄位已存在。
- `customerPreferenceExtractor.ts`：Jeff 回信後自動抽取、累積式合併（不覆蓋），含反編造鐵律。
- 「AI 客人理解」面板（`customerLearnedPreferences` query）顯示給 Jeff 看。
- 聊天框已會釘住客人身分 + 訂單 + 詢問 + 報價 + 近期來信 + 文件。

## 真正的缺口 (The gap)
`server/_core/customerChatContext.ts` 的 `formatCustomerContext()` **沒有**把
`aiNotes / keyFacts / preferences` 餵進 AI 的釘住上下文。
→ AI 學了，秀給 Jeff，但聊天/擬稿時讀不到。記憶迴路是斷的。

## 範圍 (Output)
**Phase 1（核心，必做）**：把 keyFacts / preferences / aiNotes 餵進釘住的上下文，
註冊客人 + email 訪客都要。用獨立 cache block，省 token。
**Phase 2（選做，後續）**：抽取改成「收到客人來訊也跑」+「排程定時跑」，
不只 Jeff 回信後才跑，讓記憶在 Jeff 還沒回時也保持新；重客人放寬 last-20 視窗。

## 邊界 (符合 admin AI boundary)
- **硬事實**（keyFacts + preferences，例如「吃素」「怕高」）：可流進擬給客人的草稿。
- **軟觀察**（aiNotes，「似乎/可能…」）：只給 Jeff 參考，**絕不**當成事實寫進客人草稿。
- 沿用 extractor 既有的反編造鐵律：沒明講的日期/金額/人數不准進記憶。

## 不做 (Non-goals)
- 不 fine-tune 模型。
- 不在這個 feature 裡接社群管道（LINE/WhatsApp 是後面獨立 feature；記憶會自動吃它們的訊息）。
- 不自動寄信（草稿一律 Jeff 審）。
