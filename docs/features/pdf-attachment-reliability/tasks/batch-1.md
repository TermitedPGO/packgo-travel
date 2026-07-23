# 任務清單 batch-1:pdf-attachment-reliability 核心修復(2026-07-15)

> 原位於 feature 根目錄 tasks.md,依 repo workflow 慣例(tasks/*.md)移至本路徑(Codex 14:07 §六.3)。batch-2(fail-closed 窄修)見 tasks/batch-2.md。

- [x] T1 四件套文件(proposal/design/tasks/progress)
- [x] T2 regression tests 先行(先紅):
  - [x] T2.1 `server/_core/pdfTestFixture.ts` 自產 PDF fixture 生成器(零客戶資料)
  - [x] T2.2 `server/_core/pdfParse.test.ts` 真載入 pdf-parse@2.4.5 + adapter 測試
  - [x] T2.3 `attachmentParser.test.ts` 真 PDF 直呼 parseAttachment / throw→fallback / 薄→fallback / 兩路皆敗→parse_error
  - [x] T2.4 `server/_core/pdfAttachmentChain.test.ts` 真 PDF → parseAttachment → buildCustomerDocsText 整鏈
  - [x] T2.5 `attachmentReplyGate.test.ts` + `inquiryAgent.test.ts` fail-closed gate
  - [x] T2.6 跑一次確認紅燈(修復前):11 紅(5 檔全 FAIL),失敗原因與診斷一致
- [x] T3 實作:
  - [x] T3.1 `server/_core/pdfParse.ts` 單一 v2 adapter
  - [x] T3.2 `attachmentParser.ts` PDF 路徑 fallback 重排 + 移除 v1 resolver + ops chat 全敗註記
  - [x] T3.3 `pdfTextExtractor.ts` 改走共用 adapter
  - [x] T3.4 移除 `@types/pdf-parse` + pnpm install 同步 lockfile
  - [x] T3.5 `attachmentReplyGate.ts` 純函式硬閘 + `inquiryAgent.ts` 接線
- [x] T4 同一客戶 PDF 本機唯讀驗證:1 頁、textLength 1,160、parseStatus=ok、fallback 未用、整鏈 readCount=1
- [x] T5 完整驗收:focused 127/127 綠;pnpm check 0 錯;全套測試見 progress.md;diff 僅本批檔案
- [x] T6 通信:施工回報已寫 PACKGO_AI交流/Claude/2026-07-15.md(13:40 PDT)+ 00_索引.md 已更新;保持未提交,已交 Codex 複核(14:07 複核:核心解析 PASS、fail-closed FAIL,窄修入 batch-2)
