# T6 批八 — 客戶頁生成品牌文件(收據/報價摘要)直達草稿(2026-07-05)

> 派工單:`docs/features/customer-cockpit/dispatch-batch8.md`(Fable 2026-07-05 簽發)。
> 目標:Jeff 在客人 chat 說「出訂金收據」「出報價摘要」→ AI 從訂單取數、套 Jeff 品牌模板、
> 伺服器渲染 PDF、掛進審稿草稿,Jeff 按確認發送才寄出。三塊,每塊獨立 workflow 四階段
> (實作→對抗審查≥3路→修復→驗收),全套 vitest+tsc 綠才 commit;push;**未 ship**。

## 交付一句話

- **塊一 渲染基建**:三個 skill 模板搬進 `server/documentTemplates/`(字型改 prod 實證的 Noto、
  版面原樣保留);新增 `server/_core/customerDocumentRender.ts` —— fillTemplate + 三道閘(數字白名單 /
  成本防漏 / 佔位完整性)+ puppeteerPool 渲染 + 存 R2 `reply-attachments/` + 寫 customerDocuments。
- **塊二 generate_customer_document 工具**:進 opsTools WRITE_TOOLS(釘住客人才可用),input 無任何
  金額參數,金額由 code 從 `totalPrice` × 比例枚舉演算;完整性 / 誠實 / 幣別閘全在 render 內執行。
- **塊三 草稿掛附件**:EscalationReplyContext 加 `replyAttachments`;工具產出後把 {key, filename}
  掛進這位客人最近一張待審草稿的 context;寄出時(Jeff 按確認)PDF 隨信送出。**AI 不自動寄。**

## 硬紅線落點(對抗審查每路必驗)

1. **金額只來自訂單欄位**:工具 schema 無任何金額欄位(結構性保證,單元測試釘死);金額全由
   `computeReceiptAmounts(totalPrice, ratio)` code 演算。
2. **數字白名單閘**(`assertAmountWhitelist`):全文掃出的每個貨幣金額(US$ / US $ / USD / $ / 全形)
   必須 ⊆ 由訂單欄位推導的白名單(以 cents 比對),白名單外一個 = 整份擋下。
3. **成本防漏閘**(`assertNoCostLeak`):supplierCost 一律納入 forbidden;掛單 invoice 抽出的 total
   (`extractInvoiceTotal`)best-effort 一併納入;命中 = 整份擋下。
4. **缺料拒絕不佔位**:完整性閘(缺 totalPrice/title/departureDate 逐項列缺)+ 佔位完整性閘
   (殘留 `{{ }}` 即擋)+ 誠實閘(沒登記收訂金不准出「訂金已收」)。
5. **AI 不自動寄**:工具只存文件 + 掛待審草稿(readByJeff=0);寄出唯一路徑 = Jeff 按
   `commandCenter.escalationReply` 確認發送。
6. **客人文件永遠 USD**:`checkCurrencyGate` 非 USD 訂單直接拒絕並提示先換算。

## 對抗審查結果(每塊)

- **塊一**(4 路:白名單 bypass / 成本 bypass / 完整性誠實 / 設計保真+prod 打包):3 confirmed 全修 +
  自查再補 1 個。
  1. (HIGH) 白名單 regex 只認 `US$`+ASCII 數字,`US $500`/`USD 500`/`$500`/全形可繞過 → 改成多標記
     偵測 + cents 比對。
  2. (LOW) 成本閘只去逗號,`3 498`(空白千分位/NBSP)漏抓 → 折疊數字間分隔符。
  3. (LOW) 成本整數形不看 cents,3498.50 成本誤擋合法 3498.00 售價 → 整數形只在成本本身整數時用且
     不後接小數。
  4. (自查,關鍵)兩閘原本掃整份 HTML 含 8KB base64 logo,cost_leak 可能誤擊 logo 位元組 → 掃描前
     移除 data URI。
- **塊二**(4 路:金額無 LLM / 誠實幣別完整 / 成本 wiring / 不自動寄+存放):1 confirmed 修。
  - (LOW) paxCount 未驗證,2.5 / 999999 會印「人數 2.5 人」→ handler 強制正整數且上限 99,否則忽略。
- **塊三**(4 路:不自動寄 / 命名空間 / context 完整性 / merge dedup):2 confirmed 全修(不自動寄與
  命名空間安全兩路零缺陷)。
  1. (HIGH) `attachDocToPendingDraft` 原本只查 escalation row,但 Jeff 實際看到/會寄的草稿是
     escalation + observation + inquiry 三來源經 `isDraftCurrent` + `onlyNewestDraft` 選出的那張 ——
     掛錯 row 會讓 PDF 靜默不隨信送,工具卻回報「已掛」。修:改用與客戶頁相同的選法(escalation +
     observation 一起、套 isDraftCurrent + onlyNewestDraft)掛到現行那張;`observationDraftCard` 一併
     surface attachment chip(與 escalation 同條件)。
  2. (LOW) 每次產文件 key 帶毫秒時戳,dedup by key 擋不住「重出同種收據」→ 會疊兩份。修:掛附件時
     以 kind 取代同種舊 generated 附件(重出=覆蓋,不疊加)。

## 監工已代答裁示的落實 / 申報偏離

1. **字型走 Noto 不打包 STHeiti**:receipt/flight/quote 三模板 `@font-face` 一律改成 `@import Noto Sans TC`
   + body 列 `Noto Sans CJK TC`(Dockerfile 系統字型)fallback,照 `pdfGenerator.ts:99` 的 prod 實證路線。
   樣張已過 Jeff 眼(見驗收),中文正常、版面沒跑。
2. **quote v1 只出單頁摘要**:44KB 逐日圖文版(需行程資料源 + hero 照)列 v2,已搬進
   `server/documentTemplates/quote/`(字型已改)備用;quote_summary v1 用**新的單頁模板**
   `server/documentTemplates/quote-summary/`,**沿用收據的品牌骨架 CSS(Jeff 現有設計語言),非新設計**。
3. **一份實體兩處引用**:實體存 `reply-attachments/<profileId>/generated-<ts>-<kind>.pdf`;
   customerDocuments.r2Url 存同一 key(signDocUrl 讀時簽短效 URL),draft.replyAttachments 也引用同 key。
4. **機票單無憑據=拒絕**:見下方偏離 —— flight_ticket 本批**順延**(裁示5 授權),工具 enum 不含它,
   傳入直接拒絕。
5. **時間吃緊 flight_ticket 順延**:採用。本批出 deposit_receipt / payment_request / paid_receipt /
   quote_summary(最常用)。

### 需 Fable 裁示的偏離(2 項)

- **A. customerDocuments.type 用 `"other"`**:既有 enum 是 `["passport","visa","insurance","medical","other"]`,
  無 receipt/quote/flight。加 enum 值要 schema migration(prod ALTER),派工單未授權 schema 變更,故
  generated 文件一律 `type:"other"` + `uploadedBy:"generated"` + 檔名區分(客人文件 tab 看得到)。
  **建議 follow-up**:若要在 tab 分類顯示收據/報價,再開一批做 enum migration。
- **B. 塊三「沒有草稿就生成一張」只做一半**:實作了「有現成待審草稿就掛上去」(常見流:客人來信 →
  待審草稿 → 出收據 → 掛上 → Jeff 確認寄)。**沒有現成草稿時,本批不自動 fabricate 一張草稿**,而是
  誠實回報「文件已存進客人文件,回覆客人時再手動掛」。原因:escalation 回信基建是 thread-bound
  (sendReplyInThread 需 gmailThreadId),硬湊一張沒 thread 的草稿要嘛不能寄、要嘛得回進一條不相干的
  舊 thread,風險高於價值。**建議 follow-up**:若要「主動出文件並新建外寄草稿」,需一條獨立的
  new-email(非 reply-in-thread)草稿路,列下一批。

### 其他申報

- **Dockerfile 加一行 COPY**:`server/documentTemplates` 未在既有 runtime COPY 清單(esbuild bundle .ts 但
  不含 .html/.txt 資料檔),故加 `COPY --from=builder /app/server/documentTemplates ./server/documentTemplates`。
  這是塊一渲染基建在 prod 讓渲染器讀得到模板的必要打包步驟。渲染器用 `process.cwd()`(WORKDIR /app)
  相對路徑讀。
- **條款**:模板預設付款/取消條款帶入,Jeff 可用 payTerms/cancelTerms 參數覆寫(原樣帶入他的文字);
  **LLM 不得自行生成條款**。工具回覆一律提醒 Jeff 依該客人合約確認條款(brand-core §6:預設常錯)。
- **invoice-total 成本閘為 best-effort**:讀不到/解析不出掛單 invoice 不擋合法收據;supplierCost 才是硬防線。

## 驗收

1. **單元**(全綠):三道閘紅綠例(白名單外擋 / supplierCost 出現擋 / 缺欄位拒絕 / 佔位殘留擋)、
   收據三態金額演算、誠實/幣別閘、閘門強化四項(替代寫法 / 空白千分位 / cents 誤擋 / base64)、
   工具驗證拒絕(無客人 / 非法 kind 含 flight_ticket / 缺 ratio / 非法 orderId)+ 金額無參數結構性保證、
   塊三 replyAttachments 命名空間解析 + 草稿卡攤 key。
2. **樣張**(`docs/features/customer-cockpit/batch8-samples/`,假資料不落 DB):deposit_receipt /
   payment_request / paid_receipt / quote_summary 各一份 PDF,已 commit。肉眼過 deposit_receipt +
   quote_summary:黑白骨架、Noto 中文正常、版面單頁沒跑、金額對(7,196.00 / 3,598.00)、成本 3,498
   不出現、誠實 badge 正確。
3. **prod E2E(ship 後監工做)**:0909 測試單走 deposit_receipt(未收款態應被誠實閘拒絕)→
   payment_request 成功 → 掛草稿 → Jeff 確認發送 → 0909 收到帶 PDF 的信。

## 驗證(數字紀律,原樣貼)

```
 Test Files  292 passed | 11 skipped (303)
      Tests  4330 passed | 90 skipped (4420)
```

`tsc --noEmit` 0 錯(pre-commit + pre-push)。i18n 100% parity(未動 client JSX i18n)。

## Commit(branch → push origin/main)

- 塊一 渲染基建:`f6333e6`
- 塊二 工具 + 塊三 草稿掛附件(共用 opsTools.ts,合一 commit):`8b3f7ac`
- 樣張 PDF + 本報告 + progress:本 docs commit

## 待 Jeff

- `pnpm ship`(本批已 commit + push origin/main,未 ship)。
- ship 後 prod E2E(見驗收 3)。
- 裁示兩偏離(type enum migration / 塊三新建草稿路)給 Fable 決定是否列後續批。
