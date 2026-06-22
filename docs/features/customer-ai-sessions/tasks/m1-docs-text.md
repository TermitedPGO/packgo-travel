# M1 — 文件全文抽取 helper

目標:把一位客人的文件(報價/行程 PDF…)抽成可進 prompt 的文字。內文不另存(PII)。

輸入:`server/_core/attachmentParser.ts`(`parseAttachment`,含 PDF+OCR)、`server/storage.ts`(R2 讀)、`server/routers/adminCustomersDocs.ts`(doc 來源 + `signDocUrl`)。

產出:新檔 `server/_core/customerDocsText.ts`
- [ ] `buildCustomerDocsText(docs: DocRef[]): Promise<{ list; fullText; readCount }>`。
- [ ] 平行抽取;url=R2 key → 讀位元組;http(s) → fetch;不可讀/失敗跳過(degrade)。
- [ ] 單檔沿用 `MAX_TEXT_CHARS`;整體 `MAX_DOCS_TOTAL_CHARS`(60KB)截斷標記。
- [ ] helper 不碰 DB、不寫檔。回傳值只供呼叫端組 prompt。

測試 `customerDocsText.test.ts`:
- [ ] 清單格式化、總長截斷、空清單、無 url 跳過(注入 fake parser/reader)。

驗收:tsc 0 + 測試綠 → commit。
