# 設計:PDF 附件解析可靠性(2026-07-15)

## 一、單一 adapter:`server/_core/pdfParse.ts`(新檔)

pdf-parse v2 的唯一入口。`attachmentParser.ts` 與 `server/agents/pdfTextExtractor.ts` 都改走這裡,消除兩處各自解析 pdf-parse 介面的漂移。

```ts
resolvePdfParseClass(mod): PdfParseCtor | null
  // 走 mod / mod.default / mod.default.default 找 `PDFParse` class(typeof function)。
  // 這次事故的教訓與上次(v1 雙層 default)同款:bundler interop 形狀不可猜,
  // 要 typeof 檢查 + 單元測試鎖住「真 module 解析得出」。

extractPdfTextPrimary(data, opts?): Promise<{ text, pageCount }>
  // new PDFParse({ data }) → getText({ first: PDF_MAX_PAGES }) → finally destroy()。
  // text 用 result.pages[].text 自行 join,不用 result.text:
  // v2 的 result.text 每頁夾 "-- N of M --" 頁標記,50 頁無字掃描件
  // 會累積 ~650 字純標記,騙過 40 字薄文字門檻、堵死 fallback。

PDF_MAX_PAGES = 50        // 與現行 max:50 一致
MIN_PDF_TEXT_CHARS = 40   // 薄文字門檻,與現行一致
```

實測(worktree 內真 pdf-parse@2.4.5):`mod.PDFParse` 為 class;合法文字 PDF 抽出全文;無字 PDF 的 `result.text` 只剩頁標記;壞 PDF 在 `getText` throw `InvalidPDFException`;v1 callable 呼叫 `fn is not a function` — 與正式站事故一致。

## 二、`attachmentParser.ts` PDF 路徑重排

現行:`parsePdf` throw → 外層 catch → `parse_error`(fallback 死路)。

改為 `parsePdfWithFallback(data, filename)`:

```
primary = extractPdfTextPrimary(data)     // throw 就記下 primaryError,不外拋
thin    = normalize(primaryText).length < MIN_PDF_TEXT_CHARS

primary 成功且不薄        → 用 primary 文字;總頁數 > 已解析頁數 → parseStatus=ok_truncated
                            + 頁數標記(Codex 14:07 §四.1:51 頁只讀 50 頁不得標 ok)
primary throw / 空 / 薄   → Claude 原生 PDF 備援(imageOcr.extractPdfText,已存在、永不 throw)
  備援 ok                 → 用備援文字
  備援失敗(兩路皆敗,一律 non-readable,Codex 14:07 P1-1):
    primary 曾 throw      → parse_error,parseError=「primary: <原因>; fallback: unreadable」(內部觀測用)
    primary 成功但空/薄   → 薄但非零 → parseStatus=partial(片段保留給 Jeff,gate 視為不可讀、強制升級)
                            0 字 → parse_error(兩路都試過,無可讀內容)
```

初版此處曾寫「薄但非零 → ok」,與 proposal「兩路皆敗才 parse_error」矛盾,經 Codex 14:07 複核退回;已改為上表 partial/parse_error,矛盾消除。

**圖片 OCR 失敗(P1-2)**:`extractImageText` 失敗一律 `parse_error`(text 空),不再回「系統暫時讀不出內容」placeholder 標 `ok` — 舊行為讓 gate 把真沒讀到的附件當可讀。

**附件存在證據(P1-3)**:新增 `not_processed` 狀態(存在但未解析)。三個來源:
1. `gmail.ts` hydration 整批失敗 → `buildHydrationFailureSentinels`(本地 part walk 重建檔名清單;walk 也失敗則單一泛型 sentinel,fail closed)。
2. 每封超過 5 個附件上限 → 第 6 個起以 not_processed sentinel 保留(舊行為只 log 就丟)。
3. spam 救回重播 → `spamBox.rebuildAttachmentSentinelsFromContent` 從落庫的【附件】摘要重建 sentinel(重播時無原始 bytes)。
三者都經 reply gate 強制升級,附件信永遠不會被當成無附件信。

**頁數截斷(§四.1)**:`extractPdfTextPrimary` 回傳 `parsedPages`;`pageCount > parsedPages` → `ok_truncated` + 「共 N 頁僅解析前 M 頁」標記。

`resolvePdfParse`(v1 resolver)與其測試整組移除,由 adapter 的 `resolvePdfParseClass` 取代。

`buildFileContextText`(Jeff ops chat)parse_error 註記改為清楚的人工作業提示:「(這個檔系統兩種方式都讀不出來,請開原始檔確認)」— 到這裡一定是 primary+fallback 全敗,不是可重試狀態。

## 三、`pdfTextExtractor.ts`

`extractWithPdfParse` 改呼叫共用 adapter,回 `{ text, pageCount }`(pageCount 取 `TextResult.total`)。三層策略(pdf-parse → pdftotext → llm-direct)順序不變。

## 四、型別

移除 `@types/pdf-parse`(v1);pdf-parse@2.4.5 自帶 v2 型別(exports.types)。`pnpm install` 同步 lockfile(僅本地,未提交)。

## 五、customer-facing fail-closed 硬閘:`server/agents/autonomous/attachmentReplyGate.ts`(新檔,純函式)

```ts
READABLE_ATTACHMENT_STATUSES = { ok, ok_truncated }   // partial / not_processed 皆不可讀

evaluateAttachmentReplyGate({ attachments, draftReply, rawDraftReply? }) → {
  forceEscalate,            // 附件信恆 true(12:01 §五.1 機械暫停)
  escalationReason?,        // 狀態理由或「附件信一律人工」;命中時拼入「注意:…」文字
  dropDraft,                // 恆 false(12:01 §五.2 — matcher 無權丟稿,欄位僅介面相容)
  draftDropReason?,         // 恆不設
  verdict, riskHint?        // advisory 三態 + 命中片段(gate 回傳值;卡片端只以拼入
                            // escalationReason 的注意文字呈現,無 structured 欄位/視覺高亮)
}
```

規則(12:01 §五 現行版):
1. 信有任何附件 → `forceEscalate=true`,無條件。非 ok/ok_truncated(含 partial / not_processed)時理由列出檔名+狀態;全可讀時理由為「附件信一律由你確認後才回」。
2. 草稿措辭**只影響注意文字**:advisory 分類命中時在理由後拼入「注意:草稿裡『…』…」,草稿本體永遠保留。〔歷史:14:07–09:21 各代曾在命中時 `dropDraft=true` 丟稿;12:01 證明該規則同時毀掉「請勿重傳附件」等正常稿,已廢除。〕
3. 無附件 → 恆不動作(避免誤傷正常對話;無附件信的 auto-send 階梯照舊)。

**掃描時點(P1-4 lineage,現為 hint 品質)**:agent 層掃 **canonical draft**(`stripMarkdownForEmail` 後)——「無法\*\*解析\*\*」raw 掃不到,markdown 清理後才成完整危險詞;raw 同掃(belt-and-suspenders)。卡片上的草稿即**交給 `sendReplyInThread` 的同一份 canonical `bodyText`**(§5A chokepoint 在所有 augmentation 後 canonicalize,Jeff 確認後送出;MIME builder 另附固定 footer,客人實收 = bodyText + footer)。

**最終架構(Codex 12:01 §五)——附件信暫停 autonomous send;matcher 降為 advisory 卡片注意文字**

四代 matcher(字面清單 → 字元 gap → clause-local walk → 三態 unsafe/ambiguous/clean)各自通過自己的 fixtures,又各自被下一輪獨立 fresh 語料同時打穿兩個方向:封閉詞表外的危險改寫直達 `clean`("The attachment stumped our parser."),引用/否定/報告語境的正常句被判 `unsafe` 毀稿(「請勿重傳附件。」)。結論是架構性的:**regex 無法為自然語言作 customer-facing auto-send 的安全邊界**。09:21 輪文件所寫「真風險永不 clean」「未列動詞由 ambiguous 層兜底」已被 12:01 黑箱直接推翻,不再宣稱。改為兩條機械規則:

1. **附件信一律人工(§五.1)**:任何含附件的 customer email,`evaluateAttachmentReplyGate`/`finalizeAutonomousDraft` 機械回 `forceEscalate=true`,pipeline 同步壓 `shouldAutoReply=false`;`autoSendGate` 把 attachments 列為 **hard exclusion**(與退款/報價同級,`autoSendBlockAttachments` 政策鍵作廢,任何政策組合都開不了)。PDF 照常解析、照常產草稿,由 Jeff 在卡片上確認後經既有人工邊界送出。無附件信的 auto-send 階梯不受影響。
2. **matcher 只提示,不裁決(§五.2)**:`unsafe/ambiguous/clean` 與命中片段降為**卡片注意文字**(拼入 escalationReason 的「注意:草稿裡『…』看起來像把讀檔問題推給客人」純文字;`riskHint` 是 gate 回傳值欄位,未作 structured 欄位送卡、無 UI 視覺高亮)。它**永不丟稿、永不授權寄送**;`dropDraft/droppedDraft` 恆為 false(欄位保留為介面相容)。精確口徑:matcher 永不丟稿、bodyText 恆為 canonical body;純 markdown 殘渣(`---`/空 code fence/單一 U+FFFD)可被 canonicalizer 合法清成空字串,此時 pipeline 的 empty-body gate 擋住寄出。誤判兩個方向的代價都只剩注意文字品質。
3. 未來若要恢復附件信自動寄送,另立**受控回覆模板/結構化輸出 + shadow evidence** 專案,不在本批繼續用 regex 追詞(§五.5)。

**掃描副本正規化(僅供 advisory 掃描;客人原稿一個 byte 不動)**:HTML entity decode(**已列具名名稱約 30 個 + 全部 numeric 形式**——不是完整 HTML5 named entity 表,未列名稱原樣保留、可見地失效而非靜默;Codex 12:01 §六.3 口徑)→ tag 剝除(`<br>` 接回不造句界)→ NFKC(全形/相容字)→ `\p{Default_Ignorable_Code_Point}`+`\p{Cf}` 全類剝除(property 宣告非手列)→ 緊鄰 dash/apostrophe 摺疊(U+2013/U+02BC;U+0060 grave 刻意不摺)→ markdown 清理 → 簡繁高頻字摺疊 → CJK 空白/跨換行接回。12:01 獨立 25 句 Unicode/HTML 繞過探針 0 clean(§二.6),此層 PASS;完備性仍不作宣稱——現在也不需要,送出決策已與語言無關。

**advisory 分類器內部**(保留,因為有注意文字的卡片勝過沒有的):clause-local walk(subject → 授權修飾詞\* → predicate,報告動詞/新主詞斷開)+ 句級 smell 層(檔案指涉+失敗/重供語彙,良性 prover 逐 token 解釋)。已知召回與精確度**都有界**(12:01 fresh 語料:85 危險句 12 clean、60 正常句 8 unsafe)——這正是它只當提示的原因。

**〔以下 v3/v4 為歷史記錄:字元 gap 近似的調整過程,已由上方 batch-4 clause-local walk 整體取代。保留以說明每個對照句的來歷,不再代表現行綁定機制。〕**

**batch-3 對抗驗證輪(自發 red team,28 agents,24 發現/23 經反駁確認)後的 v3 調整**:
1. B 族拆兩層:B1(重傳/re-send 類動詞+緊鄰請求標記,全文掃)與 B2(提供/給/貼/打/paste/retype 等泛用動詞,**限本句**同時有檔案名詞或讀檔失敗語境才禁)——「請再提供出發日期」「我可以再提供幾個選項」是報價核心流程,不得誤殺;Codex 的「能否再提供一次?」因與「附件…沒有開成功」同句(逗號相連)仍命中。跨句 anaphora("The file won't open. Could you share it again?")由第一句的 A2 全文層攔下,verdict 是 draft 級不是句級。
2. 名詞集收斂:zh 排除 文件(簽證文件=旅客證件)、en 排除 document/image/photo(consulate cannot process your documents=正常簽證建議);C 族形容詞刪 empty/blank(護照 blank pages/empty beaches 是旅遊文句),補 空白/fuzzy/blurry/garbled。
3. 補漏(危險方向):extract/擷取 族(Codex 清單點名)、沒辦法讀取/解析、跑不出/顯示怪怪、come through、bare imperative「再傳一次給我」(B2 句內語境)、marker 緊鄰化(排除 "so we can resend the tickets" 我方寄送誤殺)。
4. 已記錄接受的殘餘誤殺(罕見交集,安全方向):「行李箱打不開」(附件信+行李建議同信)、機場 e-gate「讀不到晶片」、illegible 手寫建議。已記錄接受的殘餘漏放:泛用動詞跨句 anaphora 且全信無其他失敗句(自然語言的 regex 邊界,非 code 可完備)。
5. Pipeline 加固:finalize 丟稿同步回填 `decision.draftDropped`(卡片顯示結構化理由);autonomous send 前空 body 硬擋(不寄空信)。
6. 無檔名附件(17:40 P1-1 已取代此條的 attachmentId 判定):附件**身份**=非空 filename 或 Content-Disposition: attachment(大小寫不敏感),attachmentId 只是 bytes 存放位置,不是身份——見 §五B v2。

**batch-4 對抗驗證輪(自發 red team,4 攻擊 agent × 98 實測探針,每項發現另派 agent 對抗覆核)後的 v4 調整**:
1. 補漏放(全部逐字入測試):zh 開不了/開不出/出不來/沒跑出來/(看起來|看上去)怪怪/顯示有(點)狀況/開起來一片空白/看不(太)清楚(含「看不到…附件內容」動詞在前語序)/換個方式給我們/重新傳;簡體混寫(无法解析)以安全掃描端簡繁摺疊(非全表轉換)攔截;en 加 file-as-subject 動詞 come up/show(ing) up、went wrong with the file、having issues 謂語、can't make out/make sense of(雙語序)。
2. 修誤殺(全部逐字入測試):附(?!件|檔)(「麻煩再確認一下附件」)、寄(?!回)(「簽名後再寄回給我們」)、上傳到第三方網站/系統排除(「請再上傳大頭照到ESTA網站」)、太大(?!會|就)(「檔案太大會被退回」是上傳限制建議)、bare imperative 再寄/傳一次要求「給我(們)/過來」方向(「我明天再寄一份 PDF 報價給您」是我方寄送)、en bare fresh-copy 降 sentence-scope、(?<!上)傳 堵 backtracking 拆「上傳」繞 veto。
3. failure-context 語義收緊:sentence-scoped 泛用重供規則的「失敗語境」現要求**同句同時有失敗語與檔案名詞**("The payment didn't come through, could you send it again?" 是付款重試,不是檔案重供)。
4. collector 邊角:disposition token 去引號('"attachment"' 畸形郵件客戶端)、whitespace-only filename(name="   ")視為身份(Gmail 對非附件 part 一律 filename="",空白名=寄件端真的附了東西),顯示名 fallback。
5. 已記錄接受的殘餘(不修):get/fetch us another version 類(泛用取得動詞無失敗語境,設計上明文要求 failure context,verify agent 覆核判 refuted);先前輪殘餘照舊。

**raw parseError 不進 prompt(§四.2)**:`buildAttachmentsBlock` 只給 `parseStatus`;原始錯誤(如 `pdf-parse export is not callable`)只留 log 與 Jeff metadata,模型永遠拿不到可轉述給客人的內部錯誤字串。

接線在 `runInquiryAgent`(post-LLM、policy gate 同層),不在 gmailPipeline:所有 caller(gmailPipeline、commandCenter、demo、draftEval)一體受閘。效果鏈(12:01 現行版):

```
附件信       → forceEscalate=true(機械) → shouldEscalate=true → shouldAutoReply=false
             → autoSendGate:input.shouldEscalate → "draft";即使 agent 漏了,
               hasAttachments 也是 hard exclusion → "draft"(雙保險,語言無關)
riskHint     → escalationReason 拼入「注意:…」→ 卡片注意文字點出危險句;草稿永遠完整掛卡
(dropDraft   → 恆 false;draftDropped 僅語言 gate 仍會設,與 matcher 無關)
```

## 五A、最終送出 chokepoint:`finalizeAutonomousDraft`(Codex 16:02 P1-3)

Agent gate 之後 pipeline 還會 augment 草稿(Plus CTA append;CTA 原文刻意含 Markdown `**` 與 em dash),舊流程把 augmented 字串直接交給 `sendReplyInThread`——agent gate 核可的不是實際送出的 bytes。修法:

1. `attachmentReplyGate.finalizeAutonomousDraft({draftReply, attachments})`(純函式):`stripMarkdownForEmail` 產生唯一 canonical `bodyText`,再對該字串重跑附件 status + 禁詞 verdict。
2. `gmailPipeline` 在 CTA(所有 autonomous augmentation)之後、`evaluateAutoSend` 之前呼叫;`decision.draftReply` 自此即 `bodyText`,直到 `sendReplyInThread` 不再被改寫——**送出的就是 gate 掃過的同一字串**(em dash 由 `normalizeUnicodeDashes` 一併正規化,CTA 分隔線變 ASCII)。
3. (12:01 版)附件存在 → `shouldEscalate=true` + `decision.shouldAutoReply=false`(§五.3,不留矛盾態),經 autoSendGate 的 escalated 路徑殺掉 real send;即使 agent 層 gate 未升級(regression 情境)、政策全開(`autoSendBlockAttachments=false`,已死的鍵),autoSendGate 的 attachments hard exclusion 仍擋 —— 送出決策與草稿語言完全無關。matcher verdict 只進 escalationReason 注意文字。
4. 責任邊界:本 chokepoint 管 **autonomous send**;Jeff 人工編輯/核准後寄出屬人為責任邊界,不在此閘範圍。

實證:`gmailPipeline.finalgate.test.ts` 走真 pipeline(`runGmailPipelineForMessageIds` → processOneEmail),斷言 (a) CTA path(無附件控制組)實際送出 body = `stripMarkdownForEmail(草稿+真 CTA 原文)`、零 `**`、零 em dash;(b) 12:01 §五.4 四案 — 可讀附件+乾淨草稿 / 可讀附件+matcher 判 clean 的危險句("The attachment stumped our parser.") / 已知 ambiguous("Can you send it again?",fixture 的 classifier verdict 於測內明確 assert,名實相符)/ 已知 unsafe — 全開政策+agent 拒升級下全部零送出、升級計數 >0、同一 decision reference 跑後 exact assert `shouldEscalate===true`/`shouldAutoReply===false`、escalation card 帶「建議回覆」與**完整 canonical 草稿 exact equality**(`stripMarkdownForEmail(草稿+真 CTA)`;`agentMessages.body` 含完整 expected 且 `context.draftReply === expected`);(c) inline/zero-byte sentinel 兩案卡片實 assert 檔名+parse status+人工理由,`context.attachments` 同步 assert;(d) 無附件信照送(暫停範圍只限附件)。

## 五B、附件身份與 bytes 位置分離(Codex 16:02 P1-1 → 17:40 P1-1 v2)

Gmail `MessagePart`/`MessagePartBody` 語意:`filename` 只在 part 是附件時出現;`attachmentId` 只表示 bytes 另存(沒有時 bytes 在 `body.data`);`data` 可以是空字串。**bytes 存放位置不是附件身份**——舊判定(attachmentId truthy 即收、body.data truthy 才收 inline)同時漏收(named zero-byte 消失 → attachments=[] → 附件閘 no-op)與誤收(externalized text/plain 正文被當附件、CID inline logo 被當附件)。

v2 判定(`collectAttachmentParts`):

1. **身份先行**:非空 `filename`,或 `Content-Disposition: attachment`(header 名與值均大小寫不敏感)→ semantic attachment;無檔名的 protocol part(text/calendar、PKCS7/PGP 簽章)即使掛 attachment disposition 也不收(邀請函/簽章是協定家具,收了會把每封邀請都升級;**具名**的 .ics 仍收)。
2. **bytes 其次**:attachmentId 有就走 attachments.get;否則 `body.data`(**空字串也保留**);兩者皆無 → ref 照樣存在,hydration 產 `parseStatus="empty"` → 附件閘升級。存在證據永不因 bytes 缺席而消失。
3. **排除**:無檔名且無 attachment disposition 的 part 一律不是附件——CID inline media、`Content-Disposition: inline`、externalized text/plain / text/html 正文(它們可帶 attachmentId)。

`fetchAndParseAttachments`(inquiry 路)與 `fetchRawAttachments`(receipt 路)共用此 collector;hydration sentinel 與 5-cap 溢出 sentinel 自動涵蓋。測試鎖真 MIME 形狀:named zero-byte、nameless CD:attachment(octet/text)、noname attachmentId 無 CD(=externalized body,不收)、CID inline logo、nameless PKCS7(掛 CD 也不收)/named .ics(收)、header 大小寫變體;另有全開 policy 真 pipeline 案證明 `parseStatus="empty"` 附件零送出。

**P2 follow-up(記錄,不在本批施工)**:
1. cap 只限「解析」前 5 份,但所有 overflow sentinel 檔名都會進 prompt;極端多附件可能 prompt 膨脹。後續可做 bounded aggregate sentinel(如「另有 N 件未處理」單一條目),Codex 16:02 §四已裁本輪不得為此擴大架構。
2. (batch-3 對抗驗證發現,屬已通過架構,不重開)`MIN_PDF_TEXT_CHARS=40` 薄文字門檻:多頁掃描件若頁首頁尾/浮水印文字層超過 40 字,primary 視為完整讀取不進備援;後續可評估按頁均字數或頁覆蓋率判薄。
3. (同上)XLSX/DOCX 解析出僅剩工作表名/空白段落的「骨架」時仍標 ok;後續可加內容密度檢查。

skill dispatcher 在 pipeline 中 gate on `shouldEscalate`,亦被覆蓋。Jeff 卡片照常顯示附件 ✗ 狀態(既有 attachmentLine),誠實呈現系統狀態;因 parser 已先自動 fallback,到卡片的失敗都是兩路全敗,符合「系統先重試、全敗才給人工提示」。

## 六、測試設計(先紅後綠)

fixture 生成器 `server/_core/pdfTestFixture.ts`:程式自產最小合法 PDF(Helvetica、ASCII 合成行程文字,零客戶資料),含「有字版」與「無字版」。不放二進位 fixture 進 repo。

| # | 測試 | 檔案 | 修前 |
|---|---|---|---|
| 1 | 真 pdf-parse@2.4.5 module 解析出 PDFParse class(不准 mock v1 shape) | pdfParse.test.ts | 新 |
| 2 | 合法文字 PDF → `extractPdfTextPrimary` → 文字非空、pageCount=1 | pdfParse.test.ts | 新 |
| 3 | 合法文字 PDF → 真 `parseAttachment` → `parseStatus=ok`、text 非空、fallback 未被叫 | attachmentParser.test.ts | 紅(現回 parse_error) |
| 4 | 壞 PDF(primary throw)→ 進 Claude fallback(mock ok)→ ok | attachmentParser.test.ts | 紅(fallback 不跑) |
| 5 | 無字 PDF(primary 空/薄)→ 進 fallback(mock ok)→ ok | attachmentParser.test.ts | 紅 |
| 6 | primary throw + fallback 失敗 → 才回 `parse_error`,parseError 保留原因 | attachmentParser.test.ts | 紅(訊息不同) |
| 7 | 真 PDF → `parseAttachment` → `buildCustomerDocsText`:readCount>0、fullText 非空 | pdfAttachmentChain.test.ts | 紅 |
| 8 | 附件非 ok/ok_truncated → escalation 帶檔名+狀態、shouldAutoReply=false | attachmentReplyGate.test.ts + inquiryAgent.test.ts | 紅(模組不存在) |
| 9 | (12:01 改)危險措辭 → 升級+**保稿**+卡片注意文字(歷史:曾丟稿,已廢除) | 同上 | 改鎖新契約 |
| 10 | (12:01 改)附件全 ok + 乾淨草稿 → **仍升級**(附件信一律人工),草稿完整;無附件+乾淨 → 不升級(控制組) | 同上 | 改鎖新契約 |
| 11 | inline body.data 附件(PDF/image/混合 cap/raw 路/hydration sentinel) | gmail.test.ts | 新(batch-3) |
| 12 | advisory hint 品質:歷輪語料 — 危險句 verdict≠clean、日常句 =clean、危險詞彙相鄰良性句 ≠unsafe、對照組/Unicode-HTML bypass | attachmentReplyGate.test.ts | 新(batch-3 起累積) |
| 13 | 最終送出 chokepoint:CTA 後實際 body canonical(無附件控制組照送);12:01 §五.4 四案(乾淨/matcher-clean 危險句/ambiguous/unsafe)全開政策零送出+卡片帶完整草稿;sentinel status reason 照浮 | gmailPipeline.finalgate.test.ts | 新(batch-3 起累積) |
| 14 | autoSendGate:hasAttachments = hard exclusion,`autoSendBlockAttachments=false` 開不了 | autoSendGate.test.ts + finalgate | 新(12:01) |

LLM 邊界:fallback 測試 mock `./imageOcr`(不打真 LLM);pdf-parse 一律真載入。測試不插真實資料進 DB(全純函式/注入 IO)。
