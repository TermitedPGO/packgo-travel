# 進度:pdf-attachment-reliability

## 2026-07-15(batch-1:核心修復)

- 接手 Codex 12:25 PDT 診斷(根因:pdf-parse@2.4.5 v2 class API 被當 v1 callable 用;primary throw 跳過 Claude fallback;customer docs 只見檔名;outbound draft 無 code-level fail-closed gate;@types v1 漂移;既有測試假綠不載真 pdf-parse)。
- 隔離 worktree `/Users/jeff/dev/網站-pdf-fix` + branch `pdf-attachment-parser-fix` 自 `4c862548` 建立,pnpm install 完成。
- 實測確認(worktree 真 pdf-parse@2.4.5):`mod.PDFParse` 為 class、v1 callable 呼叫失敗與正式站錯誤一致、壞 PDF throw `InvalidPDFException`、無字 PDF 的 `result.text` 含 `-- N of M --` 頁標記(→ adapter 改用 pages[].text join,避免多頁掃描件標記騙過薄文字門檻)。
- 四件套建立(proposal/design/tasks/progress)。
- 測試先行:11 案紅/5 檔 FAIL(真 PDF 直呼 parseAttachment 回 parse_error、整鏈 readCount=0、gate 模組不存在),失敗形態與診斷一致。(此「修前紅燈」為施工紀錄自述、施工時間錨;無 durable 原始輸出,不作 Codex gate 證據 — Codex 14:07 §六.5 口徑。)
- 實作完成:
  - `server/_core/pdfParse.ts` 單一 v2 adapter(`new PDFParse({data})` → `getText({first:50})` → `finally destroy()`;`resolvePdfParseClass` 對真模組單測;文字取 `pages[].text` join,濾除 v2 頁標記防多頁掃描件騙過薄文字門檻)。
  - `attachmentParser.ts` `parsePdfWithFallback`:primary throw/空/薄 → Claude 備援;兩路皆敗才 parse_error(parseError 只進 log);v1 resolver 移除。ops chat parse_error 註記改「請開原始檔確認」(全敗才出現)。
  - `pdfTextExtractor.ts` 改走共用 adapter。
  - `attachmentReplyGate.ts` 純函式硬閘接進 `runInquiryAgent`:非 ok/ok_truncated 附件 → shouldEscalate=true、shouldAutoReply=false;草稿命中 forbidden-phrase → 整稿丟棄+升級。
  - `@types/pdf-parse` 移除,lockfile 同步。
- 驗收(全部實跑):focused 8 檔 127/127 綠;`pnpm check` 0 錯;全套 vitest 356 檔/5,205 tests 綠、0 敗;`git diff --check` 乾淨;變更為本批 **7 tracked modified + 10 untracked = 17 檔**(untracked 含 6 個新 code/test 檔 + 4 份 feature docs;原「7 modified + 7 new」把未展開目錄當單一 status 條目,依 Codex 14:07 §六.1 更正);主樹/sagadocs/inquiries.ts hotfix 零污染。
- 同一客戶 PDF 唯讀驗證(非內容型):144,340 bytes、1 頁、primary 1,160 字、parseStatus=ok、fallback 未用、整鏈 readCount=1/fullText 1,178 字。與 Codex 診斷量測(1,176 字)吻合(差額=濾除的頁標記)。不需請客人重傳。
- 施工回報已寫 PACKGO_AI交流/Claude/2026-07-15.md(13:40 PDT),索引已更新。
- Codex 14:07 PDT production-code 複核:**核心解析 PASS(adapter/收斂/同一客戶 PDF 重驗/隔離全過);fail-closed FAIL**,退四個 P1(薄文字仍標 ok/OCR 失敗標 ok/附件存在事實消失/禁詞掃 raw 非 canonical)+三次要(51 頁截斷/parseError 進 prompt/禁詞閘位置)+docs 校正,固定窄修清單見 Codex §五。

## 2026-07-15(batch-2:fail-closed 固定窄修,依 Codex 14:07 §五)

- 統一解析真相:薄文字+fallback 雙敗 → 新狀態 `partial`(片段保留,gate 不可讀);0 字雙敗 → `parse_error`;圖片 OCR 失敗 → `parse_error`(移除 placeholder 標 ok);>50 頁 → `ok_truncated` + 頁數標記(`extractPdfTextPrimary` 新增 `parsedPages`)。鎖錯行為的兩個舊測試改鎖新語意。
- 附件存在證據:新狀態 `not_processed` 三來源全接 —— gmail hydration 整批失敗(`buildHydrationFailureSentinels`,walk 重建檔名,walk 再敗給單一泛型 sentinel)、超過 5 個附件上限(溢出保留 sentinel,不再只 log)、spam 救回重播(`rebuildAttachmentSentinelsFromContent` 從【附件】摘要重建)。全部經 reply gate 強制升級。
- 禁詞 gate:改掃 canonical draft(stripMarkdownForEmail 後)+ raw 雙掃;句型重構為 SELF_EVIDENT(全文掃)+ CONTEXT_REQUIRED(限檔案語境視窗)兩層;補漏網句型(沒有成功讀出來/麻煩再寄/unreadable/reattach),false-positive 控制組(visa center cannot process/檔期/再寄一份報價)入測試。
- raw `parseError` 移出 customer-draft prompt(`buildAttachmentsBlock` 只給 parseStatus);unreadable placeholder 改不含禁詞措辭。
- docs 校正:檔數口徑更正、T6 勾選與通信一致、tasks.md 移 `tasks/batch-1.md` + 本批 `tasks/batch-2.md`、proposal §二.4/5 與 design §二/§五矛盾消除、「修前 11 紅」降級為施工時間錨。
- Regression tests(Codex §五.5 全列):focused 7 檔 146/146 綠(薄文字+fallback fail→partial、OCR fail→parse_error、hydration throw sentinel、6+ attachments sentinel、spam-rescue 重播 sentinel、markdown 拆詞攔截、漏網句型+false-positive 控制組、51 頁截斷+50 頁不誤標)。
- 同一客戶 PDF 唯讀重驗(非內容型):144,340 bytes、1 頁、parsedPages 1/1、primary 1,160 字、parseStatus=ok、parseError=null、無需備援 —— 與 Codex 14:07 §二.3 量測一致,健康路徑零回歸。
- 驗收(實跑):`pnpm check`(tsc)0 錯;`git diff --check` 乾淨;staged 0;本批共 11 tracked modified + 11 untracked(6 code/test + 5 docs)= 22 檔,tracked 858 insertions/103 deletions,untracked 965 行(原誤記 964,依 Codex 16:02 §四.4 以實跑真值更正;batch-2 收尾時 wc 實測 965);11 份 untracked trailing-whitespace/衝突標記零命中;主樹、sagadocs、inquiries.ts 電話 hotfix 零污染。
- 全套 vitest:第一輪 5,230 綠/1 敗 —— 敗的是 repo 既有 `noEmDashGuard`(gmail.ts 內我新加的 cap sentinel 字串用了 em dash,守門測試如實抓到);改 ASCII hyphen 後重跑全套 **356 檔 passed/11 skipped,5,231 tests passed/90 skipped,0 failed**(190s)。第一輪失敗誠實記錄,不隱藏。
- Codex 16:02 PDT 終驗:**核心修復與上一輪狀態窄修 PASS;3 個 P1 blocker(inline body.data 附件消失/禁詞 matcher 漏放+誤殺/最終送出未 re-canonicalize)+ 964→965 文件校正,整批 FAIL 暫不准提交**,固定窄修清單見 Codex §四。

## 2026-07-15(batch-3:三 P1 blocker 窄修,依 Codex 16:02 §四)

- **P1-1 inline 附件**:`collectAttachmentParts` 依 Gmail MessagePartBody 規格改收 `filename + (attachmentId 或 body.data)` 兩型;`fetchAndParseAttachments`(inquiry)與 `fetchRawAttachments`(receipt)對 inline part 直接 base64url decode;hydration sentinel 與 cap 溢出 sentinel 自動涵蓋。小型 inline PDF/圖片不再消失成空陣列繞過附件閘。
- **P1-2 禁詞 matcher 關係語境重寫**:移除「同句/前句出現檔案名詞即禁」共現視窗;改四族結構(A1 自含讀檔失敗/A2 檔案名詞鄰接含糊動詞/B 請求方向標記+重供動詞/C 名詞內建怪罪句)。修掉 `成功讀?` optional 漏洞(「這次付款沒有成功」不再誤殺);Codex 五反例(did not open+fresh copy/won't open+share again/wasn't able to open the PDF+uploading once more/沒有開成功+再提供一次/PDF 看不到內容+再給我一次)全攔,五正例(付款沒有成功/簽證還沒成功出來/file clerk cannot process/附件已收到。再寄一份報價/The PDF explains…cannot process)全放,全部入測試。
- **P1-3 最終送出 chokepoint**:新純函式 `finalizeAutonomousDraft`(canonicalize + re-gate);pipeline 在 CTA 後、autoSendGate 前呼叫,`decision.draftReply` 自此即送出 bodyText,同一字串交 `sendReplyInThread`;`repurchaseCta` 抽出 `buildUpgradeCta` 供測試以真 CTA 原文驗證(`**` 與 em dash 全被 canonicalize 消掉)。pipeline regression(`gmailPipeline.finalgate.test.ts`,真 runGmailPipelineForMessageIds 路徑):CTA 後實際送出 body=canonical 同 bytes;inline sentinel+全開政策+agent 不升級仍零送出;可讀+乾淨照送。
- **Docs**:progress 964→965 更正;design §五 matcher 描述改關係語境版;「同一份 bytes」宣稱改由 §五A chokepoint + pipeline 測試實證背書;§五B 記 inline 設計;P2 prompt 膨脹記 follow-up 不施工(Codex 裁定)。
- **自發對抗驗證輪**(交 Codex 前 red team:28 agents 四視角攻擊+逐項反駁,24 發現/23 確認):
  - 修(危險方向):extract/擷取 族缺席(Codex 清單點名)、沒辦法讀取、空白/跑不出/顯示怪怪/fuzzy/come-through 句型、bare imperative「再傳一次給我」、無檔名 attachmentId 附件消失(noname 附件)、無檔名 inline PDF/圖片、finalize 丟稿未回填 draftDropped、空 body 可自動寄出。
  - 修(誤殺核心流程):「請再提供出發日期」/「可以再提供選項」(報價流程)、consulate cannot process your documents、give us a call again、we can resend the tickets、travel document damaged、簽證文件有問題、截圖上看不到出發日期、paste the confirmation number —— matcher v3:B 族拆 B1/B2(B2 限本句檔案語境)、名詞集收斂(zh 除文件,en 除 document/image/photo)、marker 緊鄰化。全部正反例入測試。
  - 記錄不修(已通過架構/罕見殘餘):40 字薄文字門檻、XLSX/DOCX 骨架 ok(入 P2 follow-up);行李箱打不開/e-gate 讀不到/illegible 手寫(殘餘誤殺,安全方向,design §五 已記)。
- SQL 彩排登記表:repurchaseCta/gmailPipeline 行號漂移依守門測試指示同步(`registryEntries.ts` 三處 source 行號,機械更新無 SQL 變更)。
- 驗收(實跑):`pnpm check` 0 錯;focused 10 檔全綠;全套 vitest **357 檔 passed/11 skipped,5,259 tests passed/90 skipped,0 failed**(141s);同一客戶 PDF 唯讀重驗 144,340 bytes/1 頁/parsedPages 1/1/1,160 字/ok/無需備援,健康路徑零回歸;`git diff --check` 乾淨、staged 0;本批 **14 tracked modified + 13 untracked = 27 檔**,tracked 1,148 insertions/135 deletions,untracked 1,569 行,格式掃描零命中;主樹(20 條目)/sagadocs(19 條目)/inquiries.ts 電話 hotfix(diff 0)零污染。
- Codex 17:40 PDT 機械終驗:**P1-3 final send chokepoint PASS(不再重開);仍退兩個 P1 — collector 把 bytes 位置誤當附件身份(named zero-byte 消失/externalized 正文與 CID inline 誤收)、matcher 漏 curly apostrophe/zero-width/no-readable-text 等正常 LLM 措辭並誤殺旅遊句;整批 FAIL 暫不准提交**,固定五項窄修清單見 Codex §四。

## 2026-07-15(batch-4 第一趟:兩 P1 blocker 窄修,依 Codex 17:40 §四)

> Codex 22:14 終驗結果:本趟 **collector(P1-1)PASS、matcher(P1-2)FAIL**。以下 P1-2 的「安全正規化+關係綁定收緊」是字元 gap 近似,22:14 證明既漏放(rendered blank)又誤殺(PDF 中寫著飯店無法處理),由第二趟 clause-local 重寫取代;collector 與測試 MIME 形狀不重開。

- **P1-1 collector 身份/bytes 分離**:`collectAttachmentParts` 重寫 — 附件身份 = 非空 `filename` 或大小寫不敏感 `Content-Disposition: attachment`(值去引號,容畸形郵件客戶端);attachmentId 只是 bytes 位置;身份成立後才取 bytes(attachmentId 或 body.data,**空字串保留**);byte-less ref 存活 → hydration 產 `parseStatus="empty"` → 附件閘升級。無檔名+無 attachment disposition 一律不收(CID inline logo、CD:inline media、externalized text/plain / text/html 正文);無檔名 protocol part(calendar/PKCS7/PGP)掛 attachment disposition 也不收,具名 .ics 收。whitespace-only filename 視為身份(Gmail 非附件 part 一律 filename="")。design §五B v2。
- **P1-2 matcher 安全正規化+關係綁定收緊**:新 `normalizeForSafetyScan`(僅安全掃描副本,送出原稿不動):curly apostrophe/引號→ASCII、零寬/格式字元剝除、CJK 字間空白移除、非換行空白收斂、簡繁高頻字摺疊;句界切分補全形 ！？;。Codex 六句 curly/零寬/no-readable-text 原字節逐字入測試(前輪測試曾悄悄以 ASCII 代寫,已改正並在 design 記錄);「附件似乎無法讀出文字」等補 pattern;B 族 send-again 綁檔案受詞或失敗語境;C 族改謂語/前修飾綁定(「PDF 說明飯店有問題」「The scan shows a damaged passport」不再誤殺);「請再提供出發日期」誤殺根因(動詞組的「發」吃掉「出發」)以 (?<!出)發 修正。
- **測試鎖真 MIME 形狀**:named zero-byte(data:"" 與完全無 bytes 兩型)、nameless CD:attachment octet/text、noname attachmentId 無 CD(=externalized body,不收)、CID inline logo、nameless PKCS7 掛 CD 不收/具名 .ics 收、header 大小寫變體(CONTENT-DISPOSITION: ATTACHMENT);全開 policy 真 pipeline 案:`parseStatus="empty"` 附件(修正後 collector 對 zero-byte/noname 的產物)+ agent 不升級 → 零送出。
- **自發對抗驗證輪 v4**(交 Codex 前 red team:4 攻擊 agent × 98 實測探針,每項發現另派 agent 對抗覆核;7 個覆核 agent 因額度中斷,其發現由指揮親自實測定案):
  - 修(漏放,全部逐字入測試):zh 開不了/出不來/沒跑出來/看起來怪怪/顯示有(點)狀況/開起來一片空白/看不(太)清楚(含動詞在前語序)/換個方式給我們/重新傳/簡體无法解析(掃描端簡繁摺疊);en having issues/went wrong with the PDF/isn't showing up/won't come up/make out/make sense of。
  - 修(誤殺,全部逐字入測試):麻煩再確認一下附件(附(?!件|檔))、簽名後再寄回(寄(?!回))、再上傳大頭照到ESTA網站(第三方站排除)、檔案太大會被退回(條件式建議)、我明天再寄一份 PDF 報價給您(bare imperative 要求「給我們/過來」方向)、I'll attach a fresh copy(降 sentence-scope)、payment didn't come through + send again(failure-context 收緊為失敗語+檔案名詞同句)。
  - 記錄不修:get us another version 類(覆核判 refuted,泛用取得動詞依設計要求失敗語境);先前輪殘餘照舊。
- 驗收(實跑):`NODE_OPTIONS=--max-old-space-size=4096 tsc --noEmit` 0 錯;focused(gmail 37 + attachmentReplyGate 84 + finalgate 5)全綠;全套 vitest 見通信最終數字;`git diff --check` 乾淨、staged 0;red-team 臨時測試檔全數清除;主樹/sagadocs/電話 hotfix 零污染。
- **狀態:第一趟停止,交 Codex,22:14 終驗判 collector PASS / matcher FAIL(見下段)。**

## 2026-07-15(batch-4 第二趟:matcher 關係綁定重寫,依 Codex 22:14 §四)

> Codex 09:21(2026-07-16)終驗結果:本趟固定案例 PASS,但**自然語序、關係綁定與 Unicode 仍 FAIL**——A3 全文掃描推翻 clause-local 設計、A2/B 仍是受詞尾端共現、Unicode 手列範圍可繞過。以下「重寫為 clause-local walk」「安全正規化完備」「自我對抗覆核」是當時自述,已被 09:21 獨立黑箱(小語料 12 漏放 1 誤殺;壓力語料 136 漏放 26 誤殺)推翻,由第三趟三態 gate 取代。本段保留為歷史記錄。

- Codex 22:14 終驗結論:collector(P1-1)與 final autonomous send 均 PASS 不重開;唯一 production blocker 是 `attachmentReplyGate.ts` 仍以字元 gap 近似關係,漏放危險句(rendered blank/載入失敗/沒有顯示出來/沒有內容)又誤殺核心旅遊句(PDF 中寫著飯店無法處理/scan is of an empty beach/附件顯示護照損壞/PDF 已收到請再傳旅客姓名)。本趟只修 matcher、其測試與對應 docs;collector/parser/CTA/send pipeline 全凍結。
- **根因**:`${檔案名詞}${0–6 字 gap}${缺陷詞}` — gap 不是關係。同一條規則既攔「附件打不開」也吃「中寫著飯店」當 gap,又因 rendered 不在字面清單而漏放。加同義詞讓誤殺更多,加寬 gap 更快。
- **重寫為 clause-local walk**:逐句(逗號亦切句)走 subject → (授權修飾詞封閉清單)* → predicate;清單外任一 token(報告動詞 寫著/顯示+NP/shows/is of、新主詞 飯店/clerk)立即斷開綁定 —— 這個斷開就是關係檢查。三條授權 A 族(A1 file-as-subject+defect predicate、A2 our-agent+read-verb+受詞區含檔案名詞/回指代名詞、A3 純機器讀檔動詞 self-contained 唯一非關係例外);B 族重供必證明受詞是附件(受詞區判定:含檔案名詞禁/明確非檔案受詞放/省略只 presuppositional 重傳禁),句中他處檔案名詞不算證據。
- **安全正規化完備**(僅掃描副本,送出原稿不動):Markdown/HTML(tag/具名+數字 entity/粗體/斜體/刪除線/inline code/link)canonicalize → Unicode hyphen 家族(U+2010–2012/U+2212/U+FF0D,`re‑send` 與 `&#x2012;` entity 皆攔)→ curly quotes → format/bidi/variation selector(U+2066–2069/U+061C/U+180E/U+FE0F/零寬/BOM,以 code-point 宣告)→ 簡繁高頻字摺疊(无法解析)→ CJK 字間空白移除。char-fold 以 code-point 表宣告(非字面字元,避免不可見字元被編輯器誤刪);U+0060 grave 刻意不摺(markdown inline-code 語法,摺成 apostrophe 反會拆 `解析` 繞過)。fold 跑在 canonicalize 前後兩側(`&#x2012;` 解碼後不被 em-dash 規則改成逗號)。
- **durable test(走 exported `finalizeAutonomousDraft` 黑箱,非只測 regex helper)**:Codex 四漏放 + 四核心控制組逐字入案;7 組 minimal contrast(同檔案名詞、同缺陷詞,只改語意關係,應放行);正規化 bypass 以 14 個 format/bidi code-point + 5 個 hyphen code-point + 9 種 markup 逐一構造(前輪 43/43 綠曾悄悄以 ASCII look-alike 代寫,本輪以 `String.fromCharCode` 鎖真字節)。A3 邊界對照(無法解析擋 / 無法處理放)明文入案。
- **自我對抗覆核(交 Codex 前,黑箱)**:9 P1 漏放全擋、4 控制組 + 6 minimal contrast 全放、5 種 bypass(零寬/U+2011/HTML/strikethrough/entity)全擋;39 句 normal + 14 句 leak 廣掃 0 誤判;另 24 句全新未入測試的真實旅遊句 100% 存活(誤殺是歷輪反覆失敗面,故加大 FP 樣本)。發現並修兩處自曝漏放:zh 模糊/糊掉、en "too" 未列入 hedge 致 "is too fuzzy" 漏。
- 驗收(全部實跑):focused **attachmentReplyGate 143 + gmail 37 + finalgate 5 = 185/185 綠**;`NODE_OPTIONS=--max-old-space-size=4096 pnpm check` **exit 0、零錯**(4GB heap 未 OOM);全套 vitest **357 檔 passed/11 skipped,5,369 tests passed/90 skipped,0 failed**(148s);`git diff --check` 乾淨、staged 0;untracked trailing-whitespace/衝突標記零命中;red-team 臨時檔全清。
- 本趟 session 只動 6 檔(mtime 實證):`attachmentReplyGate.ts`(524→967 行,clause-local 重寫)、`attachmentReplyGate.test.ts`(+3 describe 區塊)、proposal/design/progress/新增 `tasks/batch-4.md`。全 branch scope:base `4c862548`,**14 tracked modified + 14 untracked = 28 檔**,tracked 1,419 insertions/143 deletions,untracked 交驗時真值 **2,650 行**(當時誤記 2,638:先計數後又編輯 docs,未重測,依 Codex 09:21 §四.6 更正),staged 0,`inquiries.ts` diff 0;主樹/sagadocs/電話 hotfix 零污染。
- **狀態:交 Codex,09:21 判固定案例 PASS / 自然語序仍 FAIL(見下段)。**

## 2026-07-16(batch-4 第三趟:三態 gate,依 Codex 09:21 §四)

> Codex 12:01 終驗結果:wiring/Unicode PASS,但**三態 matcher 仍 FAIL**(fresh 語料 85 危險句 12 clean、60 正常句 8 unsafe 毀稿)。本段的「310/310 零漏放零誤殺」「日常流量全保留」是執行者自述(語料只存 session scratchpad,非可重現 artifact),已被 12:01 獨立黑箱推翻,不作 gate 證據;「HTML named+numeric entity 完整 decode」實為**已列約 30 個具名名稱 + 全部 numeric 形式**,未列名稱原樣保留。12:01 裁定停止補詞,改附件信一律人工(見下段)。本段保留為歷史記錄。

- Codex 09:21 終驗結論:22:14 固定案例全 PASS,但獨立黑箱(小語料 12 漏放 1 誤殺;壓力語料 136 漏放 26 誤殺)證明 clause-local 第一版仍靠封閉詞表與尾端共現,自然改寫同時大量漏放與誤殺;A3 全文掃描推翻 clause-local 設計且舊測試把錯誤行為鎖成預期;Unicode 手列範圍可被 U+034F/U+2065/U+E0001/全形/entity/U+2013/U+02BC 繞過。本趟只修 matcher、其測試與 docs;collector/parser/CTA/pipeline/final send 持續凍結,pipeline 接線零修改(verdict 欄 additive)。
- **核心改法(§四.1):二元 regex 改三態 `unsafe | ambiguous | clean`。** 不再假裝 regex 能完備理解自然語言:能證明推責/重供 → 丟稿+升級;有附件/失敗/重供語境但關係判不準 → **草稿保留、禁 auto-send、交 Jeff**;能證明無風險才放行。這打破歷輪「收緊就漏放、放寬就誤殺」的二元權衡 —— 精確度住在 unsafe 層(誤殺=毀稿,必須證明),召回住在 ambiguous 層(誤報=Jeff 多看一眼,詞彙可以放寬)。
- **移除 draft-wide A3(§四.2)**:解析/讀取/unreadable 同過 clause+報告語境判定;把錯誤行為鎖成預期的舊測試改鎖正確邊界(附件說明領事館無法解析→放;我們無法解析您的附件→擋)。
- **A2/B 族有界關係(§四.3)**:把/將 提賓式(限 再/重新 + 排除轉寄/檔內物/給您/第三方站)、代名詞最近先行詞解析(付款→放、檔案→擋、無先行詞+transit/檔案動詞→ambiguous)、報告 frame 在檔案名詞前(沖印店說→放)且我方 sayer 除外(系統顯示檔案太大→擋)、裸站名第三方目的地(ESTA網站顯示逾時)、顯示 依補語二義劃分(顯示護照損壞=報告、顯示不出來=失敗、顯示狀況良好=正面)。
- **property-based 正規化(§四.4,僅掃描副本)**:NFKC → `\p{Default_Ignorable_Code_Point}`+`\p{Cf}` 全類剝除(非手列)→ 緊鄰 dash/apostrophe 摺疊(U+2013/U+02BC)→ HTML entity decode(約 30 個已列 named + 全部 numeric 形式;不可見 entity 直接映空,原始碼零不可見字元)→ `<br>` 接回不造句界 → 簡繁摺疊;U+034F/U+2065/U+E0001/全形ＰＤＦ/&ZeroWidthSpace;/U+2013/U+02BC 逐字入測試。完備性不作宣稱,先天不完備由 ambiguous 層兜底。
- **smell 層(ambiguous 召回)**:句級 檔案指涉(名詞/代名詞先行詞/您附的/attached/scanned/單數 the document)+ 失敗語彙(V不X 潛在補語/敗損詞/當機吃掉 crash chok spins)或重供語彙 → ambiguous;良性 prover(報告動詞、缺陷+內容名詞、資訊受詞、第三方目的地、我方寄送、條件句、模糊+成因說明)逐 token 解釋,全解釋才 clean。
- **自發 red-team(4 agents × 310 fresh 探針:135 leak + 175 benign,全走 exported finalizer/classify 黑箱)**:過程抓到 7 類根因並修(`shows?(?!\s+up)` backtracking 使 show 裸配、`reads?` 無 \b 吃掉 "our reader"、裡是/中是 誤作報告動詞、V不X 缺 起/下 後綴、smell 檔案指涉過窄、把/將 規則過寬 6 種誤殺、顯示 二義)。終態 **310/310:0 漏放(leak 全非 clean)、0 誤殺(benign 全非 unsafe)**;代表性案例(29+1 hedged leaks、20 benign、2 past-incident ambiguous)固化入 durable test。
- **誤動率誠實量測**:對抗性挖掘的 benign 語料(故意堆危險詞彙,最壞情況)clean=133/ambiguous=42/unsafe=0;日常報價語料(無缺陷詞彙)20/20 clean —— 正常流量 auto-reply 全保留,危險詞彙鄰近句降級 Jeff 過目,漏放零。
- 已知殘餘(記錄不修):nominalized 過往事件(檔案打不開的問題已處理好)與規格加購(再傳一張兩吋照片)落 ambiguous 屬設計內;transit-blame 措辭(got lost in transit)多數經失敗語彙+檔案指涉入 ambiguous。
- 驗收(全部實跑):focused matcher **240/240**、+gmail 37+finalgate 5+inquiryAgent 40(合計 322/322);6 個 red-team 語料 310/310;`NODE_OPTIONS=--max-old-space-size=4096 pnpm check` 第一輪 exit 2(property-escape regex literal 的 u flag 撞 pre-ES6 target,TS1501;先前單檔驗證誤用 --target es2022 沒抓到),改 constructor 形式(310 探針+240 案重放行為不變)後 **exit 0 零錯**,誠實記錄;全套 vitest **357 檔 passed/11 skipped,5,466 tests passed/90 skipped,0 failed**(156s);`git diff --check` 乾淨、staged 0;`attachmentReplyGate.ts` 原始碼零不可見字元(entity 值全改映空,不再有字面零寬字);red-team 臨時檔全清。
- 本趟 session 只動 6 檔:matcher(967→1,092 行)、test(925→926 行,240 案)、proposal/design/progress/tasks-batch-4。全 branch scope:base `4c862548`,**14 tracked modified + 14 untracked = 28 檔**,tracked 1,419 insertions/143 deletions,untracked 3,105 行(本數字為所有文件定稿後 wc 實測;此替換為等行數 in-line 填值,不影響計數),staged 0,`inquiries.ts` diff 0;主樹/sagadocs/電話 hotfix 零污染。
- **狀態:交 Codex,12:01 判 wiring/Unicode PASS / matcher 仍 FAIL,裁定停止補詞(見下段)。**

## 2026-07-16(batch-4 第四趟:附件信一律人工 + matcher 降級,依 Codex 12:01 §五)

- Codex 12:01 終驗結論:三態傳遞與 Unicode/HTML 正規化 PASS(獨立 25 句繞過探針 0 clean);但 fresh 語料證明封閉詞表外的危險改寫仍直達 clean(85 句 12 clean,如 "The attachment stumped our parser."),寬規則命中的 unsafe 又無法被否定/引用翻案(60 正常句 8 unsafe 毀稿,如「請勿重傳附件。」)。裁定:**問題是 regex 架構無法可靠理解自然語言,停止補詞**,改兩條機械規則收口。
- **§五.1 附件信一律人工**:`evaluateAttachmentReplyGate`/`finalizeAutonomousDraft` 對任何含附件的信機械回 `forceEscalate=true`(可讀+乾淨草稿也升級);`autoSendGate` 把 attachments 改為 **hard exclusion**(`autoSendBlockAttachments` 政策鍵作廢,保留欄位僅為 admin UI 形狀相容,值恆 true)。PDF 照常解析產草稿,Jeff 卡片確認後送出;無附件信 auto-send 階梯不變。
- **§五.2 matcher 降為 advisory**:verdict 與命中片段只作**卡片注意文字**(拼入 escalationReason 的「注意:草稿裡『…』看起來像把讀檔問題推給客人」純文字;`riskHint` 為 gate 回傳值欄位,未作 structured 欄位送卡、無 UI 視覺高亮);`dropDraft/droppedDraft` 恆 false(介面相容,呼叫端 drop 分支變 dead code);`finalizeAutonomousDraft` 永不丟稿、bodyText 恆為 canonical(純 markdown 殘渣可被 canonicalizer 合法清成空,pipeline empty-body gate 擋寄出)。agent 層(runInquiryAgent)零修改自動繼承(forceEscalate 已導出 shouldAutoReply=false)。
- **§五.3 pipeline 不變量**:finalizer 強制升級時同步 `decision.shouldAutoReply=false`,消除 shouldEscalate=true/shouldAutoReply=true 矛盾態(12:01 P2-1);dead 的 droppedDraft 分支移除。
- **§五.4 四案真 pipeline regression**(`gmailPipeline.finalgate.test.ts`,fully-open policy + `autoSendBlockAttachments=false`(已死的繞道)+ agent 拒升級):可讀附件+乾淨草稿 / 可讀附件+**matcher 判 clean 的未知危險句**("The attachment stumped our parser." — 暫停照樣攔,這就是重點)/ 已知 ambiguous / 已知 unsafe——四案全部 `sendReplyInThread` 零呼叫、`totalEscalated>0`、escalation card 帶「建議回覆」區塊且含完整草稿(以 fakeDb insert 捕捉 `agentMessages.body` 實證,非只 finalizer unit);無附件控制組照送;non-readable status reason 照樣浮出。
- **測試改鎖新契約**:matcher suite 重寫為「機械暫停 + advisory 品質」兩層(235 案):歷輪全部語料保留,危險句改鎖 verdict≠clean(注意文字不失手)、日常句 verdict=clean、危險詞彙相鄰良性句 verdict≠unsafe(不掛假警報)、對照組/正規化 bypass 照鎖;`inquiryAgent.test.ts` 三案改鎖「升級+保稿+注意文字」,新增無附件控制組。
- **§六 docs-integrity**:design 移除被推翻的「真風險永不 clean/未列動詞由 ambiguous 兜底」,§五重寫為暫停+advisory 終局;named entity 宣稱三處降為「已列名稱+numeric」;第三趟 310-corpus 宣稱降為執行者自述;proposal 狀態/§二.5 同步;索引重複/錯序列修正。
- 驗收(全部實跑):focused matcher 235 + finalgate 9 + autoSendGate 14 + inquiryAgent 41 + gmail 37 = **336/336**;`NODE_OPTIONS=--max-old-space-size=4096 pnpm check` **exit 0、零錯**(4GB heap);全套 vitest 第一輪 2 敗(SQL 彩排守門抓到 gmailPipeline 行號漂移,見上)、登記表同步後重跑 **357 檔 passed/11 skipped,5,467 tests passed/90 skipped,0 failed**;`git diff --check` 乾淨、staged 0。
- 本趟 session 動 12 檔(8 code/test + 4 docs;原記 9 檔漏數 autoSendGate.test/registryEntries 與 docs 拆列,依 Codex 13:20 §四.6 更正):`attachmentReplyGate.ts`(demote)、`attachmentReplyGate.test.ts`(重寫)、`autoSendGate.ts`(hard exclusion)、`autoSendGate.test.ts`(+死繞道案)、`gmailPipeline.ts`(shouldAutoReply=false+dead branch 移除)、`gmailPipeline.finalgate.test.ts`(四案)、`inquiryAgent.test.ts`(新契約)、`registryEntries.ts`(SQL 彩排登記表兩處行號漂移,守門測試如實抓到後機械同步,batch-3 同款先例、無 SQL 變更;全套第一輪因此 2 敗,誠實記錄)+ proposal/design/progress/tasks-batch-4(docs)。`autoSendGate.ts`/`gmailPipeline.ts`/`inquiryAgent.test.ts`/`finalgate.test.ts` 為 12:01 §五 明文授權的接線點,非擅自擴scope。全 branch scope:base `4c862548`,**16 tracked modified + 14 untracked = 30 檔**,tracked 1,456 insertions/146 deletions,untracked 2,842 行(定稿後 wc 實測、等行數 in-line 填值),staged 0,`inquiries.ts` diff 0;主樹/sagadocs/電話 hotfix 零污染。
- **狀態:交 Codex,13:20 判 production safety PASS、P0/P1 歸零,剩 P2 機械收尾(見下段)。**

## 2026-07-16(batch-4 第五趟:P2 機械收尾,依 Codex 13:20 §三/§四;production 架構凍結)

- Codex 13:20 終驗:**production safety PASS,P0/P1 歸零** —— 附件信機械升級+shouldAutoReply=false、autoSendGate hard exclusion 雙重封死、卡片保留 canonical draft,獨立黑箱(18 草稿×7 狀態、32 政策組合、54 交叉案)全零送出零丟稿。已知反例("stumped our parser" 判 clean、我方寄送句判 ambiguous)都安全降級,證明架構收口有效。本趟只收 P2:regression assertion 補強 + 文件真值,§五凍結全部安全架構(parser/collector/attachmentReplyGate/autoSendGate/gmailPipeline/sender),不准再補詞。
- **P2-1 finalgate assertion 補強(只改 `gmailPipeline.finalgate.test.ts`)**:四案保留同一 decision reference,跑後 exact assert `shouldEscalate===true`/`shouldAutoReply===false`;完整 canonical(`stripMarkdownForEmail(草稿+真 CTA)`)exact equality 同時入 `agentMessages.body`(contains 完整 expected)與 `JSON.parse(context).draftReply === expected`;sentinel 兩案捕捉卡片 assert 檔名+parse status+人工理由(「讀不出來」)+`context.attachments`;ambiguous fixture 由 "Thanks for the details. Can you send it again?"(實為 clean —— 前句 details 被代名詞先行詞解析吸走)改為真 ambiguous 的 "Can you send it again?",且四個 fixture 的 classifier verdict 全部測內明確 assert,名實相符。
- **P2-2 文件/註解真值**:proposal 驗收條件 5 改「附件信一律保稿人工、危險句卡片注意文字、send 0」;inquiryAgent.ts 三處 stale comments 同步(any-attachment+advisory,零行為);riskHint 全面改稱**卡片注意文字**(gate 回傳值欄位,未作 structured 送卡、無 UI 視覺高亮);finalizer 口徑精確化(matcher 永不丟稿、bodyText 恆 canonical;純 markdown 殘渣可被 canonicalizer 合法清成空,pipeline empty-body gate 擋寄出);progress 第三趟歷史段 entity 字面同步降級(前註已寫,段內字面不再矛盾);上趟「動 9 檔」更正為 **12 檔**(8 code/test + 4 docs)。
- 驗收(全部實跑):focused 5 檔 **336/336**(matcher 235+finalgate 9+autoSendGate 14+inquiryAgent 41+gmail 37);`NODE_OPTIONS=--max-old-space-size=4096 pnpm check` **exit 0、零錯**;全套 vitest **357 檔 passed/11 skipped,5,467 tests passed/90 skipped,0 failed**(224s);`git diff --check` 乾淨、staged 0;逐條 grep 舊宣稱(高亮/完整 decode/無外露失敗措辭/丟稿)零殘留(歷史段落之外)。
- 本趟 session 動 6 檔(13:20 §五 固定清單內):`gmailPipeline.finalgate.test.ts`、`inquiryAgent.ts`(僅註解)+ proposal/design/progress/tasks-batch-4。全 branch scope:base `4c862548`,**16 tracked modified + 14 untracked = 30 檔**,tracked 1,459 insertions/146 deletions,untracked 2,912 行(定稿後 wc 實測、等行數 in-line 填值),staged 0,`inquiries.ts` diff 0;主樹/sagadocs/電話 hotfix 零污染。
- 7/15 殘留的兩組唯讀 tsx probe process(Codex §六點名 PID 60691/76420):命令行即證據(`tsx -e "import { detectReceipt } …"`/`tsx -e "import { listMessagesByIds, fetchR…"`,為 batch-1/2 施工期的本 feature 唯讀驗證探針,無寫入、無 git lock),本趟複查時兩組 PID(含同組 60224/60660/61154/75958/76386/76419/76421)已全部自行結束 —— ps 全空、全機零 `tsx -e` 殘留、無 git lock,不需終止;至此可宣稱零 process occupancy。
- **狀態:全部未 commit/未 push/未 deploy,停止,交 Codex 提交前確認。**

## 2026-07-16(批次閉環:Codex 15:02 終驗 PASS + Jeff 提交)

- Codex 15:02 PDT 最終確認:**PASS,P0 0/P1 0/P2 0**,B4-T28 由 Codex 親勾;13:20 production safety、regression assertions 與 14:13 四處 docs-integrity 全部閉合,取得本地提交前機械資格。
- Jeff 親自提交:commit **`2c420f57`** 於 branch `pdf-attachment-parser-fix`(30 檔,4,371 insertions/146 deletions;pre-commit tsc 0 錯 + i18n parity 7,922 keys 100%)。
- 狀態階梯:**已提交,未合併、未部署、未啟用**。併 main 與部署(`pnpm ship`)另行裁定;上線即行為變更 —— 附件信全部改走 Jeff 卡片確認,不再自動回覆。
- 本段於 commit 後補寫(批次閉環記錄,做完即寫),為 worktree 目前唯一未提交變更。
