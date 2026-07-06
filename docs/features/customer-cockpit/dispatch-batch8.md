# 派工單:批八 — 客戶頁生成品牌文件(收據/機票單/報價摘要)直達草稿

> 監工(Fable)2026-07-05 簽發。目標:Jeff 在客人 chat 說「出訂金收據」「出機票確認單」,AI 從訂單取數、套品牌模板、伺服器渲染 PDF、掛進審稿草稿,Jeff 按確認發送才寄出。所有 file:line 錨點來自 2026-07-05 偵察,動手前 Read 確認。

## 必讀

`CLAUDE.md`、`docs/agent/30-templates.md`(T6+數字紀律)、桌面 `/Users/jeff/Desktop/Pack&Go/Skills/packgo-brand-core.md` 與三個 skill 的 SKILL.md(packgo-deposit-receipt / packgo-flight-ticket / packgo-quote)。

## 紀律

- main 上工作;每塊獨立 workflow 四階段(實作→對抗審查≥3路→修復→驗收);全套 vitest+tsc 綠才 commit;push;不 ship。
- T6 報告 `t6-report-<date>-batch8.md`,測試總結行原樣貼。
- 模板是 Jeff 的刻意設計:搬進 repo 時版面/字級/間距/黑白палitre 原樣保留,只改字型引用與資料佔位,不准重新設計(這是紅線,見 memory 不要改設計)。

## 硬紅線(對抗審查每路必驗)

1. 文件上的每一個金額都必須來自 customOrders 欄位(totalPrice、訂金比例演算),LLM 的 tool input 不准有任何金額參數。渲染前跑「數字白名單閘」:全文掃出的貨幣金額必須 ⊆ 由訂單欄位推導的白名單,出現白名單外金額=整份擋下。
2. 成本防漏閘(cost_leak_check 的 server 版):渲染文字若含該單 supplierCost 或掛單 invoice 文件抽出的金額(extractInvoiceTotal,customOrderWatchdog.ts:344)=整份擋下。兩閘都要有單元測試的紅例。
3. 完整性閘:訂單缺必填欄位(各文件種類各自定義:收據要 totalPrice/title/日期,機票要憑據文件)→ 拒絕生成並逐項列缺什麼,絕不佔位符湊(細節要查實不要佔位)。
4. AI 不自動寄:產物只進審稿草稿區,寄出唯一路徑=Jeff 按確認發送。
5. 客人文件永遠 USD 顯示(order.currency 非 USD 時工具拒絕並提示先換算,參考 exchangeRate router 既有 procedure)。

## 塊一:渲染基建

1. 模板搬家:三個 skill 的 `references/template.html` 搬進 `server/documentTemplates/`(receipt/flight/quote 各一資料夾),logo base64 assets(各 skill assets/ 下 *_b64.txt)一併搬。佔位方式維持 {{PLACEHOLDER}} 字串替換(收據 15+、機票 20+ 佔位已在模板內,見偵察)。
2. 字型:桌面模板的 `@font-face file:///System/Library/Fonts/STHeiti*.ttc` 在 Fly Linux 不存在,一律改成 prod 已實證的模式 —— 照 `server/pdfGenerator.ts:100`(Google Fonts Noto Sans TC import + Dockerfile 已裝 fonts-noto-cjk 系統字型 fallback)。tour PDF 已在 prod 用這條路正常出中文,照抄即可。首批樣張給 Jeff 過目字型觀感(見驗收)。
3. 共用渲染器 `server/_core/customerDocumentRender.ts`:fillTemplate(純函式,佔位替換+跑三道閘)→ puppeteerPool(`server/_core/puppeteerPool.ts`,acquirePage/releasePage,MAX_PAGES=2)→ PDF Buffer → R2。
4. 存放:R2 key 一律放 `reply-attachments/<profileId>/generated-<ts>-<kind>.pdf`(這個 prefix 是寄信附件的安全邊界,replyAttachments.ts 的 REPLY_ATTACHMENT_KEY_PREFIX 防外洩機制原樣沿用);同時寫一列 customerDocuments(uploadedBy='generated'、customOrderId 掛單、type 按種類),客人文件 tab 就看得到。

## 塊二:generate_customer_document 工具

- 加進 opsTools.ts WRITE_TOOLS(L264-550 末尾,名字進 WRITE_TOOL_NAMES L574),只在釘住語境提供(A5 同款 gating)。
- input:kind(deposit_receipt | payment_request | paid_receipt | flight_ticket | quote_summary)、orderId、可選文案欄(備註/稱呼,純文字,禁金額)。executeWriteTool 既有所有權驗證(orderBelongsToProfiles)沿用。
- 資料源:
  - 收據三態(同一模板,差 {{TITLE}}/{{BADGE_TEXT}}/{{EXTRA_SECTIONS}},見 deposit-receipt SKILL.md):金額全部由 totalPrice+訂金比例(工具參數只准收比例枚舉如 30%/50%,金額 code 算)推導;收款狀態對照 depositPaidAt/balancePaidAt 決定可出哪一態(沒收訂金不准出「訂金已收」收據=誠實閘)。
  - flight_ticket:機票欄位(航班/時間/艙等/行李/退改)必須來自掛在該單的憑據文件(供應商確認單/票面,customerDocuments.customOrderId)抽取,工具回應要附「來源文件名」;價格=order.totalPrice。無憑據文件=拒絕生成(完整性閘)。
  - quote_summary:v1 只做單頁報價摘要(行程名/日期/人數若有/總價/條款),不做 44KB 逐日圖文版(那需要行程資料源,列 v2)。
- 條款區:收據/報價的付款與取消條款從模板預設帶入,允許 Jeff 文案參數覆寫;絕不由 LLM 自行生成條款。

## 塊三:草稿掛附件

- 偵察現狀:CustomerDraft.attachments string[] 已存在(adminCustomerDrafts.ts:32,134)但所有來源填 [];前端已會渲染(CustomerChat.tsx:643-656);sendEscalationReply 已收 attachments 參數(escalationBox.ts:613-641)。
- 要做:EscalationReplyContext(escalationBox.ts:91-108)加 attachments 欄;generate_customer_document 產出後把 {key, filename} 寫進當前客人的待審草稿卡(有現成草稿就掛上去,沒有就生成一張帶簡短說明信文案的草稿);寄出路徑把 context.attachments 傳進 sendEscalationReply。附件 key 必須通過 REPLY_ATTACHMENT_KEY_PREFIX 檢查(塊一的存放規則已保證)。

## 驗收

1. 單元:三道閘紅綠例(白名單外金額擋、supplierCost 出現擋、缺欄位拒絕)、收據三態金額演算、佔位替換完整性(殘留 {{ 即 fail)。
2. 樣張:對一張假資料訂單各 kind 產一份 PDF 存 `docs/features/customer-cockpit/batch8-samples/`(commit 進 repo),給 Jeff 肉眼過:黑白骨架、中文字型、版面沒跑。樣張假資料不落 DB。
3. prod E2E(ship 後監工做,報告裡標注):0909 測試單走一遍 deposit_receipt(未收款態應拒絕出「已收」)→ payment_request 成功 → 草稿掛附件 → Jeff 確認發送 → 0909 信箱收到帶 PDF 的信。

## 監工已代答的裁示

1. 字型走 prod 實證的 Noto 路線,不打包 STHeiti;樣張過 Jeff 眼後若字型觀感不合再議打包。
2. quote 逐日圖文版(含 hero 照片)列 v2,本批只出 quote_summary 單頁。
3. 生成文件同時進 customerDocuments(uploadedBy='generated')與 reply-attachments prefix,一份實體兩處引用可接受(以 reply-attachments 為實體)。
4. 機票單無憑據文件=拒絕,不准從對話文字猜航班資訊。
5. 時間吃緊時塊二的 flight_ticket 可順延下批,收據三態+quote_summary 優先(最常用)。
