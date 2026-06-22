# M2 — 客人 AI context 引擎

目標:唯一的「讀客人」入口。摘要 + 對話都吃它。只搬運真實資料。

輸入:`server/_core/customerChatContext.ts`(已有 registered+guest 撈法,抽共用)、M1 helper、doc 來源(adminCustomersDocs)。

產出:新檔 `server/_core/customerAiContext.ts`
- [ ] `buildCustomerAiContext(scope: {userId}|{profileId}): Promise<CustomerAiContext|null>`。
- [ ] 解析 scope;撈 profile/keyFacts/preferences、對話、訂單/詢問/報價、文件清單+全文(M1)。
- [ ] DB 掛 → null(degrade)。

測試 `customerAiContext.test.ts`:
- [ ] scope 解析(user/guest)、degrade-to-null、context 組裝(mock DB + fake docs)。

驗收:tsc 0 + 測試綠 → commit。
