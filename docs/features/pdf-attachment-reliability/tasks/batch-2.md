# 任務清單 batch-2:fail-closed 固定窄修(2026-07-15,依 Codex 14:07 複核)

> 來源:Codex 14:07 PDT【PDF 附件解析 P1 修復 production-code 複核】§五固定窄修清單。核心 adapter(batch-1)已 PASS 不重寫;本批只修 fail-closed 缺口與對應測試。

- [x] B2-T1 統一解析真相(P1-1/P1-2/§四.1):
  - [x] 薄文字+fallback 失敗 → `partial`(片段保留,gate 不可讀);0 字+fallback 失敗 → `parse_error`
  - [x] 圖片 OCR 失敗 → `parse_error`(移除 placeholder 標 ok)
  - [x] `extractPdfTextPrimary` 回傳 `parsedPages`;>50 頁 → `ok_truncated` + 頁數標記
  - [x] `attachmentParser.test.ts` 兩處鎖錯行為的測試改鎖新語意
- [x] B2-T2 附件存在證據(P1-3):
  - [x] `gmail.ts` hydration 整批失敗 → `buildHydrationFailureSentinels`(walk 重建檔名;walk 再敗 → 單一泛型 sentinel)
  - [x] 超過 5 個附件上限 → 溢出部分以 `not_processed` sentinel 保留
  - [x] `spamBox.ts` 救回重播 → `rebuildAttachmentSentinelsFromContent` 從【附件】摘要重建 sentinel 傳入 agent
- [x] B2-T3 禁詞 gate(P1-4/§四.3):
  - [x] 掃 canonical draft(stripMarkdownForEmail 後)+ raw 雙掃;回傳統一用 canonical
  - [x] 兩層句型:SELF_EVIDENT 全文掃;CONTEXT_REQUIRED 限檔案語境視窗(句+前句)
  - [x] 補漏網句型(沒有成功讀出來/麻煩再寄/unreadable/reattach);false-positive 控制組(visa center cannot process/檔期/再寄一份報價)
- [x] B2-T4 raw `parseError` 不進 customer-draft prompt(§四.2):`buildAttachmentsBlock` 只給 parseStatus
- [x] B2-T5 regression tests(Codex §五.5 全列):薄文字+fallback fail、image OCR fail、hydration throw、6+ attachments、spam-rescue 重播、markdown 拆詞、漏網句型+false-positive 控制組、51 頁截斷
- [x] B2-T6 docs 校正(§六):progress 檔數口徑、T6 勾選一致、tasks 移 tasks/、proposal/design 矛盾消除、「修前 11 紅」降級為施工時間錨
- [x] B2-T7 驗收+通信:focused 146/146、pnpm check 0 錯、全套 356 檔/5,231 tests 0 敗(第一輪 noEmDashGuard 抓到新字串 em dash,改 ASCII 後重跑全綠)、diff --check 乾淨、status-stat 與格式掃描零命中、同一客戶 PDF 唯讀驗證與 Codex 14:07 數字一致;回報已寫 Claude 通信+索引;保持未提交,交 Codex 終驗
