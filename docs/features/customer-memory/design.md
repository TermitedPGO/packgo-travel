# 客人專屬記憶 — Design (Stage 2)

## 概要
一個改動點打通迴路：把已抽好的 `aiNotes / keyFacts / preferences` 餵進
`customerChatContext` 釘住的上下文。抽取端已存在，不重寫。

## 模組劃分

### M1 — 記憶進上下文（Phase 1 核心）
**檔**：`server/_core/customerChatContext.ts`
- `CustomerContextData` 加 `memory?: { keyFacts: string|null; preferences: object|null; aiNotes: string|null }`。
- `formatCustomerContext()` 新增一段「【這位客人的記憶】」：
  - keyFacts：逐條列（已是 `- 事實` 格式）。
  - preferences：壓成一行可讀摘要（食/宿/步調/興趣/避免/願望）。
  - aiNotes：放在「【軟性觀察，只供 Jeff 參考，勿寫進給客人的文字】」標籤下。
- IO 端 `buildCustomerChatContext()`（註冊客人，用 userId）+ guest 版（用 email/profileId）
  各補一個 `customerProfiles` 查詢拿這三欄。
- 邊界字串：在 keyFacts/preferences 後寫「擬給客人的草稿可據此（吃素就避葷、怕高就別排高空）」；
  在 aiNotes 段寫「這是推測，不准當事實寫給客人」。
- Token：memory 另起一個 block，掛 `cache_control: ephemeral`（跟現有 system prompt 同模式），
  避免每輪重付。BLOCK_CAP 不動主 block，memory 另算上限 ~1200 字。

### M2 — 抽取保鮮（Phase 2 選做，待 Jeff 點頭）
**檔**：`server/_core/customerPreferenceExtractor.ts` + `gmailPipeline.ts`
- 現在只在 Jeff 回信後 `extractAfterReply`。改成：收到「客人來訊」也排一次抽取
  （fire-and-forget，去重鎖避免同客人並跑）。
- 排程：每日掃「最近有新訊息但記憶過期」的客人，補抽。
- 重客人放寬 last-20 視窗（分批摘要）。
- 注意：本機無 DATABASE_URL/ANTHROPIC_API_KEY，抽取只在 prod 跑得動，本地只能測格式。

## 依賴關係
M1 完全獨立、可單獨上線（最高 CP）。M2 依賴 M1 無，但價值低於 M1，分開做。

## 測試
- `customerChatContext.test.ts`：加 case — 有 memory 時 block 含 keyFacts/preferences；
  aiNotes 在「軟性觀察」標籤下；無 memory 時不出現該段；超量截斷正確。
- 不在測試打真 DB / 真 LLM（沿用既有 mock）。

## 驗證
1. `tsc --noEmit` 0 error。
2. 既有 + 新測試綠。
3. prod：開一個有 keyFacts 的客人 chat，問「幫他擬個回信」→ AI 回覆有用到記憶（例如主動避葷）。

## 風險
- 釘太多 → context 變大：用獨立 cache block + 上限頂住。
- 軟觀察外洩給客人：靠標籤 + 既有反編造鐵律雙保險；M1 上線後抽一兩封草稿人工驗。
