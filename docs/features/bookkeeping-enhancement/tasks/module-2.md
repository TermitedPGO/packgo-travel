# M2 — Agent 知識庫 + 業主身分

harness #69 · design.md §M2 · 待 M1

## 目標
把 Jeff 今年人工修正過的知識編成永久規則，先做確定性 pre-classifier 再注入 prompt。**只編已確認的，不猜。**

## Checklist

### A. 知識庫模組
- [x] 建 `server/agents/autonomous/accountingKnowledge.ts`
  - [x] `OWNER_IDENTITIES`（CHUN FU HSIEH / 謝俊甫 / 變體；lowercase 比對）
  - [x] `KNOWN_OUTFLOW_VENDORS`（Jupiter Legend→cogs_tour、Ann→cogs_tour…，含 note）
  - [x] `MEMO_HINTS`（china visa / visa / trips fees… → income_booking，medium confidence）
  - [x] `WF_CARD_RULE`（Wells Fargo 卡消費 = 幫客人訂機票 → cogs_tour；card 來源才套）
  - [x] `preClassify(input): PreClassifyResult`

### B. 排序（嚴格）
- [x] 業主身分 FIRST（命中 → transfer, conf 95，覆蓋 memo）
- [x] 已知 outflow 廠商（conf 90）
- [x] memo 提示（conf 65，仍進待審）
- [x] 未知對方進帳 → null（不猜）→ LLM → 不確定則 other_review

### C. 接線
- [x] `accountingAgentService.classifyOne`：先 preClassify
  - [x] conf ≥ 90 → 直接用，跳過 LLM（省錢）
  - [x] < 90 → hint 注入 prompt 再讓 LLM 定
  - [x] 未命中 → 現狀純 LLM
- [x] `accountingAgent.buildSystem()`：注入 OWNER + VENDOR 摘要
  - [x] 靜態摘要放 system prompt（byte 穩定，**不破壞 prompt cache**；task #61 教訓）

### 驗收
- [x] `tsc --noEmit` 0 error
- [x] Vitest：業主名→transfer；Jupiter Legend→cogs_tour；無記名進帳→null（不猜income）；大小寫變體命中（17/17 綠）
- [x] 確認 prompt cache 仍命中（靜態摘要在 system prompt，dynamic hint 在 user prompt）
