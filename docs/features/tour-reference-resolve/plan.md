# Tour 解析接線 — proposal + design + tasks(精簡合一)

> 起因 2026-06-13 Jeff:客人講 YG7/黃石團,AI 寫草稿時對 tour 庫零存取 → 腦補。
> spike(73863d5)已證明關鍵字解析對真名錄有效。本 feature 把解析器接進 InquiryAgent。

## 目標
InquiryAgent 寫草稿前先解析客人信裡的團指涉 → 候選團塞進 prompt,讓草稿「講真的團 / 對不上就老實問」,
不再腦補;解析到的團 id 貼到 escalation 卡,Jeff 一鍵跳去那團報價。

## 鐵律邊界(不可違反)
- AI 仍絕不報價。候選團是「給草稿措辭用 + 給 Jeff 報價用」,草稿可講「我們有黃石的團」,
  但不可講價格、不可保證有位。報價/比較類照舊 escalate + 人工。
- draft 狀態的團(未上架)不可對客人講「我們有這個團」當成可賣;只給 Jeff 看(卡片),
  草稿措辭保守(「黃石這邊我幫您看一下細節」)。active 團才可具體講。
- 解析失敗(unknownCodes、無候選)→ 草稿老實問客人,不假裝。

## Milestones

### m1 — resolveFromEmail(DB-backed,bounded) ✅
- [x] tourReferenceResolver 加 `resolveFromEmail(text)`:先抽 code tokens + 地點詞(JS,cheap),
      有才查 DB(tours WHERE title/destinationCity LIKE 詞 OR productCode/sourceUrl LIKE 碼,
      active 優先,cap 60),再跑純 resolveTourReferences 排序。零詞零碼 → 不查、回空。
- [x] export 抽詞 helper 供測試;Vitest(抽詞、短路不碰 DB、12 tests green)

### m2 — 接進 InquiryAgent 草稿 ✅
- [x] InquiryAgentInput 加 `tourCandidates?: {id,title,status,via,terms?}[]` + `unknownTourCodes?`
- [x] system prompt 加【現有相關團 — 怎麼用】block(active 可具名講、draft 只 Jeff 看保守措辭、
      不報價不保證、未知碼老實問);user prompt 加資料層【現有相關團】+【查不到的團號】block
- [x] gmailPipeline:runInquiryAgent 前 resolveFromEmail(subject+body,best-effort 不阻斷),
      結果傳入;escalation context 加 resolvedTours{id,title,status} + unknownTourCodes(供卡片跳轉)
- [x] Vitest(prompt block 組裝:無候選乾淨、active/draft 標籤、未知碼;14 tests green)

### m3 — escalation 卡顯示解析到的團
- [ ] escalationBox EscalationRow 加 resolvedTours(從 context.resolvedTourIds 撈 title/status)
- [ ] TodayEscalationCard:顯示「相關團:黃石 5 日 #123(去看)」chip → 開 /tour/:id(或 workspace 行程庫)
- [ ] i18n · Vitest

## DoD
- [ ] tsc 0 · 全套綠 · i18n parity
- [ ] 鐵律:草稿零報價(既有 post-LLM 黑名單 + prompt 雙守);draft 團不對客人當可賣
- [ ] Jeff 親驗:寄一封「黃石團 7 月」測試信 → 草稿提到真候選 + 卡片顯示團可跳轉
