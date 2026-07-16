# 任務清單 batch-4:collector + matcher 關係綁定(2026-07-15 起)

> batch-4 的 feature-scope 是 Codex 17:40 退回的兩個 P1(collector 身份/bytes 分離、customer-facing matcher 關係綁定)。
> 分三趟收:第一趟(17:40 round)修 collector v2 + matcher gap 近似 v4;Codex 22:14 判 **collector PASS、matcher FAIL**(gap 不是關係)。
> 第二趟(22:14 round,T5–T9)重寫 matcher 為 clause-local walk;Codex 09:21(2026-07-16)判 **固定案例 PASS,自然語序/關係/Unicode 仍 FAIL**(二元 regex 假裝完備)。
> 第三趟(09:21 round,T11 起)改三態 gate + property-based 正規化;collector/final send 持續凍結。

## 第一趟(Codex 17:40 §四 — collector PASS / matcher 後被 22:14 判 FAIL)

- [x] B4-T1 collector 身份/bytes 分離(P1-1,Codex 22:14 確認 PASS,不重開):
  - [x] 附件身份 = 非空 `filename` 或大小寫不敏感 `Content-Disposition: attachment`(值去引號)
  - [x] attachmentId 只是 bytes 位置;身份成立才取 bytes(attachmentId 或 body.data,空字串保留)→ byte-less 存活成 `empty` → 附件閘升級
  - [x] CID inline logo / CD:inline media / externalized text 正文不收;無檔名 protocol part 掛 CD 不收、具名 .ics 收;whitespace-only filename 視為身份
  - [x] 測試鎖真 MIME 形狀(named zero-byte 兩型、nameless CD octet/text、noname attachmentId、header 大小寫變體)
- [~] B4-T2 matcher gap 近似 v4(P1-2,**22:14 判 FAIL,由第二趟取代**):安全正規化雛形 + 四族 gap 綁定 + red-team v4 逐字案。gap 綁定被 22:14 證明既漏放(rendered blank)又誤殺(PDF 中寫著飯店無法處理);正規化覆蓋不全(U+2011 / bidi / markdown)。保留為歷史,不再是現行機制。

## 第二趟(Codex 22:14 §四 — matcher clause-local 重寫)

- [x] B4-T5 廢除字元 gap,改 clause-local walk(§四.1):
  - [x] 逐句(逗號亦切句)走 subject → (授權修飾詞封閉清單)\* → predicate;清單外 token(報告動詞/新主詞)立即斷開綁定
  - [x] A1 file-as-subject + defect predicate;A2 our-agent + read-verb + **受詞區含檔案名詞/回指代名詞**;A3 純機器讀檔動詞 self-contained(唯一非關係例外,明文記錄)
  - [x] B 族重供:動詞後受詞區判定 — 含檔案名詞→禁、明確非檔案受詞→放、省略→只 presuppositional 重傳動詞禁;句中他處檔案名詞不算證據
- [x] B4-T6 逐字鎖 Codex 四漏放 + 四核心旅遊控制組(§四.2),每危險句配只改關係的 minimal contrast:
  - [x] 漏放全擋:The PDF rendered blank / 附件載入失敗 / PDF 沒有顯示出來 / 附件沒有內容(+ file wouldn't open / not displaying / get the PDF to open / has no content / 無法正常解析)
  - [x] 控制組全放:The scan is of an empty beach / PDF 中寫著飯店無法處理提前入住 / 附件顯示護照損壞 / PDF 已收到請再傳旅客姓名
  - [x] 7 組 minimal contrast(同名詞同缺陷詞,只改關係)全入 durable test
- [x] B4-T7 安全正規化完備(§四.3,僅掃描副本,送出原稿不動):
  - [x] Unicode format/bidi(U+2066–2069 / U+061C / U+180E / U+FE0F / 零寬 / BOM)以 code-point 宣告逐一測
  - [x] Unicode hyphen 家族(U+2010–2012 / U+2212 / U+FF0D)→ ASCII,`re‑send` 攔;含 `&#x2012;` entity 解碼後仍攔
  - [x] Markdown / HTML canonicalization(tag / 具名+數字 entity / 粗體 / 斜體 / 刪除線 / inline code / link)後掃描
  - [x] 簡繁高頻字摺疊(无法解析)
- [x] B4-T8 驗收走 exported `finalizeAutonomousDraft` 黑箱(§四.4),不只測 regex helper:
  - [x] focused matcher tests(黑箱 + minimal contrast + 正規化 bypass)
  - [x] `NODE_OPTIONS=--max-old-space-size=4096 pnpm check` exit 0
  - [x] 全套 vitest
  - [x] `git diff --check` + untracked 格式/衝突標記掃描
- [x] B4-T9 docs 降回事實(§四.5):design §禁詞關係綁定結構改 clause-local 版、v3/v4 gap 段標為歷史;proposal 狀態同步 batch-4、「同一份 bytes」改「交 `sendReplyInThread` 的同一 canonical `bodyText` + MIME footer」;progress 22:14 段;本 batch-4.md 建立
- [x] B4-T10 交 Codex 22:14 後終驗 → 09:21 回覆:固定案例 PASS,但自然語序/關係綁定/Unicode 仍 FAIL,退第三趟

## 第三趟(Codex 09:21 §四 — 三態 gate)

- [x] B4-T11 二元 regex 改三態 `unsafe | ambiguous | clean`(§四.1):證明推責/重供 → 丟稿+升級;有語境但關係判不準 → 草稿保留、禁 auto-send、交 Jeff;證明無風險才放行。`AttachmentReplyGateResult`/`FinalizeAutonomousDraftResult` 增 `verdict` 欄(additive,callers 不變)
- [x] B4-T12 移除 draft-wide A3 例外(§四.2):解析/讀取/unreadable 同樣過 clause+報告語境+主客體判定;修正鎖錯行為的舊測試並加同詞 minimal contrast(附件說明領事館無法解析→放 / 我們無法解析您的附件→擋)
- [x] B4-T13 A2/B 族有界 agent–verb–object–destination 判定(§四.3):把/將 提賓、代名詞最近先行詞解析(付款→放/檔案→擋/無先行詞+transit→ambiguous)、第三方目的地(含裸站名「ESTA網站顯示逾時」)、給您=我方寄送、報告 frame 在檔案名詞前(沖印店說)且我方 sayer 除外(系統顯示檔案太大仍擋)
- [x] B4-T14 property-based 正規化(§四.4):NFKC → `\p{Default_Ignorable_Code_Point}`+`\p{Cf}` 全類剝除 → 緊鄰 dash/apostrophe 摺疊 → HTML entity decode(已列約 30 個具名名稱 + 全部 numeric 形式,非完整 HTML5 named 表 — 12:01 §六.3 口徑)→ markup canonicalize;逐字鎖 U+034F/U+2065/U+E0001/fullwidth ＰＤＦ/&ZeroWidthSpace;/U+2013/U+02BC
- [x] B4-T15 durable exported-finalizer tests(§四.5):09:21 九漏放+七誤殺+paired contrasts 全入;三態不變量(ambiguous 保稿+禁送)明文入案
- [x] B4-T16 自發 red-team(4 agents,310 fresh 探針:135 leak + 175 benign,zh/en 各攻 paraphrase 與誤殺):終態自測 310/310(執行者自述,語料在 session scratchpad 非可重現 artifact;12:01 獨立 fresh 語料仍測得 12 clean 漏放/8 unsafe 毀稿,故不作 gate 證據);代表性 hedged leaks(30)與 benign(20+2)固化入 durable test;過程發現並修 7 類根因(show(?:s) backtracking、reads? 無 \b 吃掉 reader、裡是 誤作報告、V不X 缺 起/下、smell 檔案指涉過窄、把/將 過寬、顯示 語境二義)
- [x] B4-T17 docs 降回事實(§四.6):proposal:23 正規化只在掃描副本、design 三態+不宣稱完備、progress 22:14 段標 superseded、untracked 真值更正、本檔 T10 改「22:14 後終驗」
- [x] B4-T18 交 Codex 09:21 後終驗 → 12:01 回覆:wiring/Unicode PASS,自然語言 clean 漏放與 unsafe 毀稿仍 FAIL,裁定停止補詞

## 第四趟(Codex 12:01 §五 — 附件信一律人工,matcher 降級)

- [x] B4-T19 autoSendGate attachments 改 hard exclusion(§五.1):`hasAttachments` 無條件 draft,`autoSendBlockAttachments` 政策鍵作廢(欄位保留僅為 admin UI 形狀,值恆 true)
- [x] B4-T20 matcher 降為 advisory(§五.2):`evaluateAttachmentReplyGate` 對任何附件信機械 `forceEscalate=true`;`dropDraft/droppedDraft` 恆 false;matcher 永不丟稿,`finalizeAutonomousDraft` 的 bodyText 恆為 canonical(純 Markdown 殘渣可被 canonicalizer 合法清成空,由 pipeline empty-body gate 擋寄,13:20 口徑);verdict+`riskHint` 只作卡片注意文字(拼入 escalationReason 純文字,非 structured 送卡、無視覺高亮)與 gate 回傳觀測
- [x] B4-T21 pipeline 不變量(§五.3):finalizer 升級同步 `decision.shouldAutoReply=false`;dead droppedDraft 分支移除
- [x] B4-T22 四案真 pipeline regression(§五.4):乾淨草稿/matcher-clean 危險句/ambiguous/unsafe 四形全零送出、卡片帶完整草稿(agentMessages.body 捕捉實證)、無附件控制組照送、status reason 照浮
- [x] B4-T23 docs 降回事實(§五.5+§六):附件信暫停 autonomous send 明寫;matcher 降 advisory;被推翻宣稱移除;entity/corpus 口徑降級;索引錯序修正
- [x] B4-T24 交 Codex 12:01 後終驗 → 13:20 回覆:**production safety PASS,P0/P1 歸零**;只退 P2 regression 證據與文件真值,凍結全部安全架構

## 第五趟(Codex 13:20 §三/§四 — P2 機械收尾,production 架構凍結)

- [x] B4-T25 finalgate 四案 assertion 補強(§三):同一 decision reference exact assert `shouldEscalate===true`/`shouldAutoReply===false`;完整 canonical(草稿+真 CTA)exact equality 入 `agentMessages.body` 與 `context.draftReply`;sentinel 兩案 assert 檔名+status+人工理由+context.attachments;ambiguous fixture 改真 ambiguous 句("Can you send it again?")且各 fixture 的 classifier verdict 測內明確 assert
- [x] B4-T26 inquiryAgent.ts stale comments 同步(§四.2,零行為):fail-closed/丟稿/同 bytes 措辭改 any-attachment+advisory 注意文字
- [x] B4-T27 docs 真值(§四):proposal 驗收條件 5 改保稿人工;riskHint 全面改稱「卡片注意文字」不宣稱 structured/視覺高亮;finalizer 口徑精確化(matcher 永不丟稿;markdown 殘渣可合法清空由 empty-body gate 擋);progress:84 歷史段 entity 字面降級;9 檔→12 檔更正
- [x] B4-T28 交 Codex 13:20 後提交前確認(未 commit/push/deploy,停止線) → 14:58 Codex 最後機械終驗 PASS:P0/P1/P2 歸零,focused 336、typecheck 0、全套 5,467 tests 0 敗,scope/格式/隔離/零佔用全吻合
