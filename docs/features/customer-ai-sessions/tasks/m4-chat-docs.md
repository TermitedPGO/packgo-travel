# M4 — 對話框讀文件 + 客人 scope 走 Haiku

目標:對話框能回「行程第幾天去哪」(讀 PDF 全文),且快(Haiku)。依賴 M0+M1。

輸入:`server/_core/customerChatContext.ts`、`server/agents/autonomous/opsAgentStream.ts`、`server/_core/index.ts`(ask-ops-stream 呼叫處)、M1 helper、`OPS_CHAT_MODEL`。

步驟:
- [ ] `buildCustomerChatContext`/`buildGuestChatContext` 末尾併入 M1 的 docsList+docsFullText(放進 extraSystem)。放大 doc 全文上限(與既有 2400 pin 區塊分開)。
- [ ] `runOpsAgentStream` 收 `model?` 參數;ask-ops-stream 在 customerId/profileId 非空時傳 Haiku,全域 #ops 維持 Opus。
- [ ] 確認 extraSystem 仍落在 cached system block(prompt cache 抵銷每次全讀成本)。
- [ ] 維持唯讀(不新增寫入路徑)。

測試 `customerChatContext.test.ts`(擴充):
- [ ] doc 全文有併進 block、上限、guest vs registered。

驗收:tsc 0 + 測試綠 → commit。
