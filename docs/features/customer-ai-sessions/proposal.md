# 客戶 AI Sessions — Stage 1 Proposal

> 狀態:Stage 1 草案。緣起:客戶頁很多「積木」是空的或規則算的,對 email-only 的
> 客人(像 Jenny)永遠寫不出真話。Jeff 拍板的心智模型:每位客人一個 session、
> 經驗共用、database 共用。先寫清楚再動工(CLAUDE.md §9.1)。
> 日期:2026-06-22(現況以當天 live 實測為準)

---

## 一、Jeff 的心智模型(架構基準)

> 「就好像每一位客人都有自己的 sessions,但經驗是共有的,以及 database。」

| 層 | 是什麼 | 對到系統 |
|----|--------|----------|
| 每位客人的 session | 在那位客人頁,AI 上下文只裝「這位客人」:她的信、訂單、文件、偏好。換客人就換上下文。 | 已有雛形:右側對話框用 `customerProfileId` 鎖範圍;`customerProfiles.aiNotes / keyFacts / preferences` 是這個 session 的長期記憶 |
| 經驗共用(同一顆腦) | 怎麼報價/催款/跟進、Jeff 口氣、Trust 規則、過去有效做法。不屬於任何客人,整間公司的 know-how。 | `server/agents/skills/*`、品牌規則、learnings;每個 session 都注入同一套 |
| Database 共用(同一份記憶) | 所有客人/訂單/文件/往來在同一個 DB。每 session 只讀自己那一塊,但底下同一份真相。 | MySQL(Drizzle)。寫進去的變成經驗養分 |

**那顆「AI 讀客人」引擎 = 針對一位客人:`{這位客人的資料(DB 撈)} + {共用經驗(skills/規則)}` → AI → `摘要 / 下一步 / 對話回答`。** 換客人換上下文,腦跟記憶不變。

---

## 二、現況盤點(2026-06-22 live 實測)

部署後實測 Jenny 這張卡:

**已是真的、會動(這批不碰):**
- 三顆按鈕(報價/催款/確認書)→ 訂製單,接好了。
- 文件 tab:**寄出附件自動歸檔已生效** — Jenny 文件 tab 現在有 4 份 PDF(含她兩份台灣行程/報價)。
- 對話:**雙向都有了** — 客人來信 + 「Jeff(我)」寄出的信都顯示。
- 帳務 / 歷史 tab:真資料。
- (小 bug 已修 2262064:補抓的寄出信原本全標「今天」,改用實際寄信時間。)

**還是空的 / 規則算的 / 壞的(這批要做):**
| 積木 | 現況 | 為何不對 |
|------|------|----------|
| AI 摘要(客人要什麼/做了什麼/給了什麼) | 規則算(只看正式 booking + 網站表單),Jenny 全靠 email → 顯示「沒有需求/尚無動作/尚未交付」 | 規則看不到 email + 文件 → 對 email-only 客人永遠空。要 AI 讀她實際資料 |
| AI 下一步建議 | 寫死 placeholder「跟進中(M2 自動生成)」 | 沒接 AI |
| 右側 AI 對話框「關於這位客戶」 | UI 接好,但**實測打字問它、等 15 秒沒回應** | 後端 stream 沒通/壞;且不會讀這位客人的文件 |

→ 三個壞的積木是**同一顆引擎**:AI 真的讀這位客人(信 + 訂單 + 文件)+ 套共用經驗。做一次,三個一起活。

---

## 三、範圍(這批做什麼)

把「AI 讀客人」引擎做出來,點亮三個積木:

1. **真 AI 摘要** — 取代規則版 `deriveAiSummary`:餵這位客人的(對話 + 訂單 + 文件清單 + 既有 keyFacts)給 LLM,產出 客人要什麼 / 做了什麼 / 給了什麼。
2. **真 AI 下一步建議** — 同一次生成順帶給「下一步該做什麼」(一句可執行)。
3. **AI 對話框修好 + 讀文件** — 先讓 `關於這位客戶` 的 stream 真的回(查為何 15 秒沒回);再讓它的上下文含這位客人的文件(報價/行程 PDF 摘要),不只文字對話。

共用經驗注入:摘要/對話的 system prompt 帶 Jeff 口氣 + 規則(不破折號、Trust §17550、成本不外洩)。

---

## 四、錢/法遵紅線(設計時不可違反)

- AI 摘要/對話**只搬運**這位客人的真實資料,不杜撰價格/事實(admin_ai_boundary)。
- **成本絕不出現**在任何客人面輸出(摘要/下一步是 admin 內部看,可提 margin;但若日後給客人,絕不帶成本)。
- 客人面文字走 Jeff 口氣、不破折號、不打勾。
- 訂金≠營收(§17550)的判斷不靠 AI 腦補,靠 DB 既有欄位。
- AI 對話框是**唯讀**(現況註解已寫「never sends or edits」)— 保持唯讀,不讓它代寄/代改。

---

## 五、Jeff 已拍板(2026-06-22)

1. **摘要何時算 = 背景算 + 快取 + 重算鈕**。背景定期算存(`aiNotes` 或新欄),開卡讀快取(秒開),旁邊「重新整理」即時重算。
2. **文件深度 = 檔名+類型 + 連 PDF 內容(1+2)**。AI 要看得到文件清單,也要讀進 PDF 內容(抽文字/OCR),能回「行程第幾天去哪」。→ 需要 PDF 文字抽取 pipeline 餵進 AI 上下文。
3. **LLM = 便宜快的(Haiku 等)**。摘要/對話用便宜快的,搬運事實不需最豪模型。
4. **AI 對話框沒回**:仍待診斷(後端 stream / LLM key / Opus gotchas,memory:reference_opus_llm_gotchas)。Stage 2 第一件事就是查它為何 15 秒沒回。

> §四.2 OCR 抽 PDF 內容會碰客人文件 PII,抽出的文字只進 AI 上下文(prompt),不另存明文。

---

## 六、非目標(這批不做)

- 不重做訂製單 / 文件歸檔 / 對話(已動且 OK)。
- 不讓 AI 自動寄信/改單(對話框維持唯讀)。
- 不做跨客人的「經驗學習」訓練(共用經驗先用既有 skills/規則注入,不新訓練)。
- PDF 全文 RAG / 向量檢索(若 §五.3 選「只檔名」就不碰)。

---

## 七、下一步

Jeff 已點頭(2026-06-22),AI 引擎在**新 session** 做。進 Stage 2 design(模組劃分、prompt 設計、快取策略、診斷 AI 對話框)→ Stage 3 拆模組 → Stage 4 寫。

## 八、Stage 2 起點:code 入口(新 session 直接看這裡,不用重找)

| 積木 | 現在的 code | 要做的 |
|------|------------|--------|
| AI 摘要(規則版) | `client/src/components/admin/customers/adapters.ts:195` `deriveAiSummary`(+ `useCustomerData.ts:263` 也呼叫一份) | 換成讀「背景算好的 AI 摘要快取」;規則版可留作 fallback |
| AI 下一步 placeholder | i18n `zh-TW.ts:3367` `aiPending: '跟進中(M2 自動生成)'`、`:3366` `aiNextStep` | 接 AI 生成的一句下一步 |
| AI 對話框(壞的) | `server/_core/index.ts:320` `GET /api/agent/ask-ops-stream`,**:493 有 90s timeout、log「DB or LLM call stalled」** | 15 秒沒回 = 卡在 DB 或 LLM call,不是路由不見。先看 prod log 這行有沒有跳;再查那段 DB 撈/LLM 呼叫為何 stall(Opus gotchas:memory `reference_opus_llm_gotchas`) |
| 客人長期記憶 | `drizzle/schema.ts:2714` `aiNotes`、`:2724` `keyFacts`、`preferences`(CustomerProfileExtractor 背景更新) | 摘要快取可存這裡,或新加欄;keyFacts 可當 AI 上下文輸入 |
| LLM 呼叫 | `server/_core/llm.ts:692` `invokeLLM`(已有 24h cache、prompt caching) | 摘要/對話走這支,model 帶便宜快的(Haiku) |
| 文件(要抽 PDF 文字) | `customerDocuments`(R2 KEY)、`server/storage.ts` 讀、`server/_core/attachmentParser.ts` 已有 kind 偵測 | 新增 PDF 文字抽取(§五.2 決定要讀內容);抽出文字只進 prompt 不另存(§四 PII) |
| 共用經驗注入 | `server/agents/skills/*`、品牌規則 | 摘要/對話 system prompt 帶 Jeff 口氣 + 紅線 |

**新 session 第一步建議**:先查 prod log 確認 `ask-ops-stream` 到底卡在哪(DB 還是 LLM),那是最快點亮對話框的線頭,也順帶驗證整條 AI 上下文撈得到資料。
