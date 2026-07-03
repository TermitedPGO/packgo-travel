# Design — Phase2 每個數字有出處(2a 發票對帳 / 2b supplierCost 搬運 / 2c Plaid 收款建議)

> Stage2 設計文件(照 docs/standards/workflow.md)。對應 roadmap-100.md Phase2。三項都併進既有看門狗(`server/services/customOrderWatchdog.ts`)同一套 `WatchdogFinding` 聯集 + `watchdogForCustomer` endpoint + `DetailTabs.tsx` 面板,不另開新面板。

## 踩點研究結果

- **看門狗現況**:`customOrderWatchdog.ts` 已有 `OrderMarginFinding`(kind:"margin")跟 `OrderPromiseFinding`(kind:"promise")兩種純函式規則,`WatchdogFinding` 是兩者聯集。純函式風格:輸入已查好的資料、輸出 finding 或 null、缺資料就沉默不猜。endpoint 在 `server/routers/adminCustomerOrders.ts:171-181`(`watchdogForCustomer`),呼叫 `db.listCustomOrdersByProfile(profileId)`(`server/db/customOrder.ts:255-265`,回傳 `CustomOrder[]` 全欄位,無 join)後跑兩個 find*Issues 函式 concat 回傳。前端 `client/src/components/admin/customers/DetailTabs.tsx:78-148` 依 `f.kind` 分流渲染,i18n key 在 `admin.customers.watchdog.*`(zh-TW.ts:3459-3475 / en.ts:3496-3511)。新增 kind 照同一套慣例:`{kind}` 判別 + reason enum + 對應 i18n 子鍵。
- **customerDocuments**:`type` DB enum 只有 `["passport","visa","insurance","medical","other"]`(schema.ts:2799)——業務文件(報價/發票/確認書)一律落在 `type:"other"`,靠 `customOrderId`(schema.ts:2811)歸戶到訂單,無專屬 invoice type。`customerDocsText.ts` 的 `DocRef.kind` 是**顯示層**才賦予的語意標籤(quote/invoice/confirmation/...),不是 DB 欄位;`PII_KINDS`(passport/visa/insurance/medical)排除 OCR,`PDF_KINDS`(quote/invoice/confirmation)才走 PDF 解析。實作時對 `customOrderId` 底下、`type:"other"` 的文件呼叫 `extractDocTextCached` 需要自己組 `DocRef`,`kind` 傳一個會落在 `PDF_KINDS` 的值(如 `"invoice"`)才會真的解析——**實作前務必讀 `server/_core/customerDocsText.ts` 全文**確認這個機制,不要憑這裡的摘要猜。
- **bankTransactions**(schema.ts ~3040-3105):`amount` 正=支出、負=入帳(schema 註解親自證實,收款要取 `Math.abs()` 且只認負值)。有 `isoCurrencyCode`(預設 USD)、`isPending`、`excludeFromAccounting`、`archived` 欄位——比對時只認 `isPending=0`、`excludeFromAccounting=0`、`archived=0` 的交易,且只比對 `isoCurrencyCode==="USD"` 的訂單(非 USD 訂單此規則沉默跳過,不誤配)。**沒有**任何欄位連結 customOrders(`relatedBookingId`/`relatedInquiryId` 是給別的實體用的舊欄位),這次刻意不新增連結欄位——比對是即時查詢時算的建議,不落地存,Jeff 標記收款後該筆訂單那條腿(deposit/balance)自然不再被建議,不需要額外去重狀態。
- **recordPayment**:`server/routers/adminCustomerOrders.ts:637-676`,參數 `{orderId, kind:"deposit"|"balance", amount?, paidAt?, method?}`。前端入口 `client/src/components/admin/customers/CustomOrderDetail.tsx:315`。Plaid 建議卡只需要帶 `orderId` 讓現有 UI 導去該訂單,不新建收款 UI。
- **create_custom_order / update_custom_order**(`server/agents/autonomous/opsTools.ts`):**已經有** `supplierCost` 參數(361-384/419 行附近),但**完全沒有驗證**——這正是 2b 要收緊的缺口,不是從零新增欄位。`executeWriteTool` 呼叫鏈目前拿不到「這輪對話的 fileContext」(index.ts 的 `runOpsAgentStream` 呼叫沒有傳這個參數下去),但這不影響設計:改用 `sourceDocId`(customerDocuments.id)取代即時 fileContext——聊天框拖進來的檔案本來就會在同一輪被持久化成 `customerDocuments` row(`uploadedBy:"chat_upload"`,見 Phase1a 的 index.ts 536-590 那段既有邏輯),所以「這輪剛拖的」跟「之前上傳過的」供應商文件都已經有穩定的 `customerDocuments.id` 可以引用,不需要另外接線 fileContext。

## 2a:訂單金額對 invoice 看門狗

新 finding kind `"invoiceMismatch"`。

**新純函式**(`customOrderWatchdog.ts` 新增,同檔案不拆新檔,延續既有慣例):
- `extractInvoiceTotal(docText: string): number | null` — 純函式、零 LLM。用錨點詞(中英皆要:total / grand total / amount due / 合計 / 總金額 / 應付總額 / 總計)往後找最近的金額(支援 `$1,234.56`、`1234.56`、`NT$172,600` 等格式,先只認 USD $ 前綴或無前綴純數字,NT$/其他幣別直接跳過不比對——貨幣不同不能直接比大小)。同一份文字裡找到 0 個或找到 ≥2 個「不同數值」的候選就回 `null`(寧漏勿誤;找到多個但數值相同視為同一個候選,不算模糊)。
- `evaluateInvoiceMismatch(order: {id,orderNumber,title,status,totalPrice,currency}, invoiceTotals: number[]): OrderInvoiceMismatchFinding | null` — 純函式。`invoiceTotals` 是呼叫端已經對這張單底下每份文件跑過 `extractInvoiceTotal` 後,過濾掉 null、去重的結果陣列。若 `invoiceTotals.length !== 1`(0 個或彼此不同的多個)→ null。若唯一值與 `order.totalPrice` 差距 `< 1`(容差,四捨五入誤差)→ null。否則回 finding:`{kind:"invoiceMismatch", orderId, orderNumber, title, status, level:"yellow", systemAmount, documentAmount, currency}`。draft/cancelled 狀態跳過(同 `SKIP_STATUSES`)。

**Router 端**(`adminCustomerOrders.ts` 的 `watchdogForCustomer`):對 `listCustomOrdersByProfile` 拿到的每張非 draft/cancelled 訂單,查 `customerDocuments where customOrderId = order.id and type = "other"`,對每份文件呼叫 `extractDocTextCached`(讀 `customerDocsText.ts` 全文確認正確呼叫方式與 `DocRef` 組法),把抽出的 text 餵給 `extractInvoiceTotal`,結果陣列去重後丟給 `evaluateInvoiceMismatch`。

**驗收**:單元測試重現 scorecard 真實案例(系統 $6,635 vs 文件 $6,621.40 → 叫);文件跟系統金額吻合(差 < $1)→ 不叫;文件找不到明確總額(0 或多個不同候選)→ 不叫;非 USD 訂單 → 不叫。

## 2b:supplierCost 搬運(收緊既有未驗證欄位)

**衝突澄清**:schema.ts:2371 註解「supplierCost 手動、絕不自動填」的本意是禁止 LLM 憑空編造,不是禁止「搬運」已驗證存在於供應商文件裡的數字。這次精緻化規則,不是開放新欄位。

**新模組** `server/_core/supplierCostVerification.ts`:
- `verifyAmountInDocumentText(claimedAmount: number, docText: string): boolean` — 純函式。正規化 `docText` 裡所有看起來像金額的 token(去除 `$`/`,`/幣別代碼,轉 number),正規化 `claimedAmount`,兩者在 `0.01` 誤差內任一 token 相符即 `true`。找不到 → `false`。
- `resolveAndVerifySupplierCost(params: {claimedAmount: number, sourceDocId: number, customerProfileId: number}): Promise<{ok: true} | {ok: false, reason: string}>` — 會碰 DB 的協調函式:查 `customerDocuments` 該 `sourceDocId` 存在**且屬於同一個 `customerProfileId`**(跨客戶守門,防止 A 客人的單引用 B 客人的文件當佐證),抓文字(重用 `customerDocsText.ts` 或 `attachmentParser` 既有機制,不重寫解析),呼叫 `verifyAmountInDocumentText`。查無此文件、跨客戶、或數字對不上,一律回 `{ok:false, reason}` 附清楚原因(給 LLM 看的錯誤訊息,讓它知道要重試還是回報 Jeff)。

**接線**(`opsTools.ts` 的 `create_custom_order` / `update_custom_order`):
- input schema:`supplierCost` 保留;新增 `sourceDocId: number`(選填,但**當 `supplierCost` 有值時實質必填**——沒有 `sourceDocId` 就直接拒絕整個 supplierCost 欄位,不寫入,回錯誤訊息叫 LLM 補上或省略 supplierCost)。
- 執行邏輯:收到 `supplierCost` 且有 `sourceDocId` → 呼叫 `resolveAndVerifySupplierCost`;通過才把 `supplierCost` 放進要寫入 DB 的欄位;不通過 → 整個 tool 呼叫回傳結構化錯誤(不要整單失敗,`supplierCost` 以外的欄位可以正常寫入,只有 `supplierCost` 被拒;需要判斷這個部分成功的語意怎麼呈現給 Jeff,實作時參考 opsTools.ts 既有「部分欄位失敗」的處理慣例,若沒有既有慣例就整個工具呼叫回報「有欄位被拒」的清楚訊息,不要靜默丟棄)。
- 更新 `opsTools.ts` 裡兩個工具的 `description` 字串,明講新規則(supplierCost 必須附 sourceDocId 且會被 server 驗證,對不上會被拒)。
- 更新 `schema.ts:2371` 註解,反映「手動」的精確定義:透過 create/update_custom_order 且經文件驗證才可寫,任何自動 pipeline 不可寫。

**驗收**:測試覆蓋「數字在文件裡→收」「數字不在文件裡→拒」「sourceDocId 指向別的客人的文件→拒(跨客戶守門)」「非聊天路徑嘗試寫 supplierCost→不可能」——最後一條用 grep/型別檢查證明:除了這兩個工具的 handler,repo 裡沒有其他地方對 `customOrders.supplierCost` 賦值(審查階段要做這個 grep,不是靠型別系統天然擋,因為 Drizzle 的 update/insert 型別本來就允許這個欄位,守門靠的是「只有這兩個 code path 會被呼叫到」這個事實,審查要驗證這件事)。

## 2c:Plaid 收款建議

新 finding kind `"paymentMatch"`。

**新純函式**(`customOrderWatchdog.ts` 新增):
- `OrderPaymentMatchFinding = {kind:"paymentMatch", orderId, orderNumber, title, status, level:"yellow", legKind:"deposit"|"balance"|"total", matchedAmount, transactionDate, accountMask: string|null, candidateOrderIds: number[]}` — `candidateOrderIds` 平常是 `[orderId]` 自己;多單同額時列出這個客人底下所有同額候選的 orderId,UI 才能誠實顯示「這筆入帳可能是這幾張單其中一張」。
- `matchPaymentsToOrders(orders: OrderPaymentMatchInput[], transactions: BankTransactionInput[]): OrderPaymentMatchFinding[]` — 純函式。`orders` 已過濾好(呼叫端只傳 draft/cancelled 以外、幣別 USD 的單);`transactions` 已過濾好(呼叫端只傳 `amount<0`、`isPending=0`、`excludeFromAccounting=0`、`archived=0`、近 30 天)。對每張單決定要對比的「未收金額」:`depositPaidAt` 為空且 `depositAmount` 有值 → 目標是 depositAmount,`legKind:"deposit"`;否則 `balancePaidAt` 為空且 `balanceAmount` 有值 → 目標 balanceAmount,`legKind:"balance"`;都沒有分期欄位但 `totalPrice` 有值且訂單未整體標記收款(status 不是 confirmed 之後——用既有 status 語意判斷「這張單財務上還沒收完」)→ 目標 totalPrice,`legKind:"total"`。找 `Math.abs(txn.amount)` 與目標金額誤差 `<0.01` 的交易;一張單可能命中多筆交易(理論上只該有一筆,若真的命中多筆,規則用**最近日期**那筆,理由記在程式碼註解裡,不要沉默丟棄也不要都列——多筆交易同額對同一張單是資料異常但不是「該問 Jeff 選哪張單」的那種模糊,跟「多單同額」是不同的模糊來源,不要混在一起處理);同一筆交易金額如果同時吻合這個客人底下超過一張未收款訂單,對每張命中的單都各出一條 finding,`candidateOrderIds` 列出全部同額的 orderId 讓 Jeff 自己判斷是哪張單。
- 已經標記收款的那條腿(對應 `depositPaidAt`/`balancePaidAt` 已非空)永不再被建議——這是純函式輸入端就先排除(呼叫端不把已收款的單放進 `orders` 陣列,或函式內部自己判斷,兩者擇一,實作時選較不容易漏的那個)。

**Router 端**:`watchdogForCustomer` 加查 `bankTransactions`(近 30 天、`amount<0`、`isPending=0`、`excludeFromAccounting=0`、`archived=0`,查詢用既有 `idx_account_date` 或等效索引欄位,不用管哪個 `linkedAccountId`,公司所有連結帳戶都要看),把這個客人的訂單(過濾 USD + 未全額收款)跟這批交易一起餵給 `matchPaymentsToOrders`。

**UI**:卡片文字含金額+日期+帳戶末四碼(`accountMask`),點擊導去該筆訂單(沿用既有訂單導航,不新建 UI 動作;`recordPayment` 是 Jeff 在訂單頁自己點,AI 絕不預填/自動標記)。

**驗收**:測試覆蓋 amount 正負號方向(正=支出不匹配、負=入帳才匹配)、同額多單列出全部候選、已收款那條腿不再叫、無吻合金額沉默、非 USD 訂單沉默跳過、`isPending`/`excludeFromAccounting`/`archived` 任一為真的交易不參與比對。

## 實作順序與檔案衝突規避

2a 跟 2c 都會改到同一組檔案(`customOrderWatchdog.ts`、`adminCustomerOrders.ts` 的 `watchdogForCustomer`、`DetailTabs.tsx`、zh-TW.ts/en.ts 的 watchdog 區塊)——**依序做,不平行**,2a 先做完 commit,2c 才動工(讀到 2a 已經加過的新 kind 分支,照同樣 pattern 加自己的,不要互相覆蓋)。2b 改的是完全不同的檔案(`opsTools.ts`、`schema.ts` 註解、新檔 `supplierCostVerification.ts`),可以在 2a/2c 之間任何時候做,這次一樣依序排在 2a 之後、2c 之前,單純圖簡單好追蹤,不是因為有依賴。
