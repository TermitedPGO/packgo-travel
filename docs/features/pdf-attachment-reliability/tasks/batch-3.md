# 任務清單 batch-3:三 P1 blocker 窄修(2026-07-15,依 Codex 16:02 終驗)

> 來源:Codex 16:02 PDT【PDF fail-closed production-code 終驗】§四固定窄修清單。核心 parser、partial/not_processed 狀態、51 頁截斷、parseError 出 prompt 均已 PASS 不重開;本批只修三個仍可實際繞過 fail-closed 的 P1 與文件數字。

- [x] B3-T1 inline attachment(P1-1):
  - [x] `collectAttachmentParts` 收 `filename + (attachmentId 或 body.data)`(`AttachmentPartRef` 雙型)
  - [x] `fetchAndParseAttachments` inline 直接 base64url decode;`fetchRawAttachments`(receipt 路)同步支援
  - [x] hydration sentinel 識別 inline part(collector 共用,自動涵蓋)
  - [x] 回歸測試:inline PDF(真 pdf-parse)、inline image(mock OCR)、attachmentId+inline 混合 cap 溢出 sentinel、raw 路 inline bytes、hydration sentinel 含 inline
- [x] B3-T2 禁詞規則(P1-2):
  - [x] 修 `成功讀?` optional 漏洞(動詞必填)
  - [x] resend/change-format/open/process 類綁「我方讀檔失敗」關係語境:A2 檔案名詞鄰接、B 請求方向標記;移除前句共現視窗
  - [x] Codex 五反例全攔、五正例全放,入測試(不只補單一字串)
- [x] B3-T3 最終送出閘(P1-3):
  - [x] `finalizeAutonomousDraft`(canonicalize + re-gate 唯一 bodyText)
  - [x] pipeline CTA 後呼叫,同一字串交 `sendReplyInThread`;`buildUpgradeCta` 抽出供真 CTA 原文測試
  - [x] pipeline regression:CTA 後實際 body canonical/gate、inline sentinel+全開政策零送出、控制組照送
  - [x] 人工 Jeff 編輯路徑責任邊界記入 design §五A
- [x] B3-T4 docs:964→965 更正;design §五/§五A/§五B 宣稱與實作一致;P2 prompt 膨脹 follow-up 記錄不施工
- [x] B3-T5 自發對抗驗證輪(28 agents 四視角 + 逐項反駁):危險方向 8 項修復(extract 族/沒辦法讀取/空白等句型/noname 附件/無檔名 inline/draftDropped 回填/空 body 硬擋)、核心流程誤殺 8 組修復(matcher v3:B1/B2 拆層+名詞集收斂+marker 緊鄰)、正反例全入測試;已通過架構與罕見殘餘記錄不修(design §五/P2)
- [x] B3-T6 驗收+通信:tsc 0 錯、focused 10 檔綠、全套 357 檔/5,259 tests 0 敗、客戶 PDF 唯讀驗證一致、git scope/diff/格式全過;回報已寫 Claude 通信+索引;未提交,交 Codex 最後機械終驗
