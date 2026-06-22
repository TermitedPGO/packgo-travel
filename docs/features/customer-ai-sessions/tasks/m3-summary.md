# M3 — AI 摘要生成 + 快取 + cron

目標:真 AI 摘要(要什麼/做了什麼/給了什麼/下一步),背景算+快取+重算鈕。

輸入:M2 引擎、`server/_core/llm.ts`(`invokeLLM`,Haiku)、`server/queue.ts`(cron 模式)、`drizzle/schema.ts` customerProfiles。

產出:
- [ ] schema 加 `aiSummary: json`、`aiSummaryAt: timestamp` + migration SQL。
- [ ] `server/_core/customerAiSummary.ts`:`generateCustomerAiSummary` / `refreshAndStoreSummary`(ensure profile)。prompt 見 design §六,structured output 四欄。
- [ ] tRPC(adminProcedure):`customerAiSummary` query(讀快取+stale 判斷)、`refreshCustomerAiSummary` mutation。
- [ ] cron `scheduleDailyCustomerSummaries` + worker:篩「活躍+變動過」客人,限流,單筆失敗不炸批。

測試:
- [ ] `customerAiSummary.test.ts`:prompt 組裝、結果解析、stale 判斷(pure)、cron 篩選(pure)。
- [ ] 紅線:輸出無破折號/無成本/無 PII。

驗收:tsc 0 + 測試綠 → commit。**快取只存四欄結論,不存 PDF 原文。**
