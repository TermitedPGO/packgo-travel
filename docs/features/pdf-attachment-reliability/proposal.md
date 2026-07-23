# PDF 附件解析可靠性修復(pdf-attachment-reliability)

> 狀態:P1 修復批(2026-07-15 起)。batch-1 核心解析 PASS(Codex 14:07);collector 與 final send PASS(Codex 22:14);wiring/Unicode PASS(Codex 12:01)。matcher 歷經四代(字面清單/字元 gap/clause-local/三態)均被下一輪獨立 fresh 語料打穿,Codex 12:01 裁定**停止補詞**:附件信一律暫停 autonomous send(autoSendGate hard exclusion)、matcher 降為 advisory(卡片注意文字,無權清稿或授權寄送);Codex 13:20 判 **production safety PASS、P0/P1 歸零**,剩 P2 regression 證據與文件真值機械收尾(本輪),完成後交提交前確認。Jeff 已授權本地修復+文件+測試;禁止 commit/push/deploy、禁連正式 Gmail、禁任何 production 寫入。全部保持未提交。batch-4 checklist 見 `tasks/batch-4.md`。
> 隔離:worktree `/Users/jeff/dev/網站-pdf-fix`,branch `pdf-attachment-parser-fix`,基準 `4c86254895afdc563e1c3f8a0aa599379508bfeb`。
> 診斷來源:Codex 2026-07-15 12:25 PDT【PDF 附件解析故障診斷】(PACKGO_AI交流/Codex/2026-07-15.md)。

## 一、問題(Codex 診斷結論,已交叉重現)

1. **客戶 PDF 本體正常。** Jeff 在客戶頁看到 `2026 November Taiwan Trip1.pdf`「無法解析」,但該檔 PDF 1.3、1 頁、未加密、非掃描件、13/13 字型嵌入,pypdf/pdfinfo/pdftotext 全部讀得出;R2 下載完整(144,340 bytes,`application/pdf`)。
2. **根因是套件 API 誤用。** repo 鎖定 `pdf-parse@2.4.5`,v2 只輸出 `PDFParse` class;但 `server/_core/attachmentParser.ts` 的 `resolvePdfParse` 仍按 v1 介面找 callable function(module 本身 / `default` / `default.default`),永遠回 `null`,隨即 throw `pdf-parse export is not callable`。所有走共用 `parseAttachment` 的 PDF 在真正讀內容前就死。
3. **primary throw 跳過 Claude fallback。** Claude 原生 PDF 備援只在 primary「成功但少於 40 字」時執行;primary 一 throw,外層 catch 直接回 `parse_error`,備援完全不跑。
4. **customer docs 只見檔名、不見全文。** Gmail 原始 bytes 照樣入 R2/customerDocuments,客戶頁 AI 看得到檔名;`customerDocsText` 靜默略過非 `ok/ok_truncated` 的內容 → 「有文件清單、沒有 PDF 全文」,AI 自行對外說「無法解析」。
5. **outbound customer draft 缺 code-level fail-closed gate。** InquiryAgent prompt 有文字指示「讀不到不得告訴客人」,但 `parse_error` 與錯誤字串原樣進 prompt;output 端沒有依 `parseStatus` 強制 escalation,也沒有攔「無法解析/請重傳」等失敗措辭。模型可能(且已經)把內部故障說給客人聽。
6. **型別漂移。** `package.json` 同時有 `pdf-parse@^2.4.5`(runtime)與 `@types/pdf-parse@^1.1.5`(v1 型別),types 與 runtime 不同版。
7. **測試假綠。** 既有 52/52 綠但:attachmentParser.test.ts 明寫不測真 PDF;resolver 測試只餵 v1 人造形狀,從未載入真 pdf-parse@2.4.5;customer-doc/chat 測試把 parser mock 成功,沒有真 PDF 整鏈測試。

## 二、本批修復範圍

1. 共用 PDF parser 改用 pdf-parse v2 正確介面:`new PDFParse({ data })` → `getText({ first: 50 })` → `finally destroy()`。
2. 移除 v1 的 `@types/pdf-parse`,runtime 與 types 同版(v2 自帶型別)。
3. `attachmentParser` 與 `pdfTextExtractor` 收斂到單一 adapter(`server/_core/pdfParse.ts`),不再各自維護互相漂移的 pdf-parse 介面。
4. primary throw、空文字、薄文字一律進 Claude 原生 PDF 備援;**兩路皆失敗一律回 non-readable status**(primary 曾 throw 或 0 字 → `parse_error`;薄但非零 → `partial`,片段保留但 gate 視為不可讀),錯誤原因保留在 `parseError`(內部可觀測),絕不進客戶文案或 LLM prompt。圖片 OCR 失敗同樣 `parse_error`,不再以 placeholder 標 `ok`。超過 50 頁上限 → `ok_truncated` + 頁數標記。(Codex 14:07 P1-1/P1-2/§四.1 窄修)
5. customer-facing email 路徑的機械收口(Codex 12:01 §五,取代歷代措辭 matcher 閘):**任何含附件的信一律 `shouldEscalate=true`、`shouldAutoReply=false`,`autoSendGate` 將 attachments 列為 hard exclusion**(與退款/報價同級,政策鍵開不了)——PDF 照常解析、照常產草稿,由 Jeff 確認後送出;無附件信的 auto-send 階梯不變。措辭 matcher 降為 **advisory**:三態 verdict 與命中片段只拼入卡片 escalationReason 的「注意:…」純文字(非 structured 欄位、無 UI 視覺高亮)點出危險句,永不丟稿、永不授權寄送(regex 經四輪獨立語料證明無法作自然語言的安全邊界)。卡片上的草稿是 **canonical draft**(僅 `stripMarkdownForEmail`;掃描正規化絕不進 bodyText),MIME builder 送出時另附固定 footer。附件存在證據全鏈保留:hydration 整批失敗、超過 5 個附件上限、spam 救回重播都以 `not_processed` sentinel 進 gate,附件信不得被當成無附件信(P1-3)。恢復附件自動寄送屬未來獨立專案(受控模板/結構化輸出+shadow evidence)。
6. Jeff 內部聊天(ops chat fileContext)對完全失敗的檔案給清楚的人工作業提示(開原始檔),不把系統可重試的工作推回 Jeff — 系統先自動走 fallback,全敗才提示。
7. 真 PDF regression tests(先寫、先紅、後修):真載入 pdf-parse@2.4.5、自產無客戶資料 PDF fixture、fallback 路徑、真 PDF → parseAttachment → customer docs 整鏈、fail-closed gate。

## 三、驗收條件

1. 新 regression tests 修復前紅、修復後綠。
2. `pnpm check`(tsc)0 錯;全套 vitest 綠。
3. 本機同一客戶 PDF(`/Users/jeff/Desktop/1784141847979-4zkloe-2026_November_Taiwan_Trip1.pdf`)唯讀驗證:`parseStatus=ok`、文字非空;只回報頁數/textLength/parseStatus/是否用 fallback 等非內容型技術結果。
4. 非本批檔案零修改;`git diff --check` 乾淨。
5. (12:01 版)任何含附件的信強制 escalation、`shouldAutoReply=false`、autonomous send 為零;草稿(含危險措辭者)完整保稿給 Jeff,危險句以卡片注意文字點出,由 Jeff 編修後人工送出。附件非 ok/ok_truncated 時卡片另列檔名+狀態理由。

## 四、禁止事項(本批停止線)

- 禁 deploy、禁 commit、禁 push、禁 stage 以外的 git 狀態變更宣稱。
- 禁連正式 Gmail、禁任何 production 寫入(DB/R2/API)。
- 客戶 PDF:不複製進 repo、內容不寫入 fixture/log/AI 交流/回報;只回報非內容型技術數字。不需請客人重傳(失敗內容未進成功文字快取,修後重跑同一 R2 檔即可)。
- 不動:主工作樹既有修改、網站-sagadocs、safe-booking-saga-docs 分支、inquiries.ts 電話 hotfix、Safe Booking Saga 文件、其他未授權功能。
- 不修改 Codex 通信原文。
