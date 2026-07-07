# E2E 全生命週期掃測 — 2026-07-07

> 測試帳號:Better way To survive / jeffhsieh0909@gmail.com / 會員卡 #2760017(userId 60001)。
> 一封案子從詢問走到結案,完整一圈。prod = v797(批十一 + 0112 migration 修復,release complete)。
> 只碰 0909 與本輪建立的測試單;不做真實付款(收款狀態用後台按鈕手動標);寄信只限 0909↔support@。
> DB 驗證走 flyctl 唯讀探針。UI 走 chrome MCP。

## 環境/設定

- **瀏覽器對應(FAIL→改正)**:業主指定 Browser 2(Windows)當 admin、Browser 1(macOS)當 0909 Gmail。實測 Browser 2 的 packgoplay 完全無登入(localStorage 無 token、admin tRPC batch 回 403、客人列表全空);Browser 1 才是已登入的 admin(admin.customerList 回 200 且含 0909)。**業主把兩台對調了**。改正:整輪都在 Browser 1 跑(packgoplay 分頁當 admin,Gmail 分頁當 0909),切分頁不切瀏覽器。switch_browser 兩次都逾時(沒人按 Connect),改用 deviceId 直接指定。
- 觀察:`/ops/customers/<id>` 深連結是 SPA 404(選客人是內部 state 不是路徑);客人列表搜尋比對 name/email,但列表為空時純是 403 造成,非過濾。testAccounts.ts 有列 2760017 但沒套進客人列表查詢(只用在稽核/canary)。

## 逐步結果

### Step 1 詢問落卡 — PASS
- 動作:0909 Gmail 寄新信給 support@,主旨「[E2E完單] 十月金門三日遊詢問,兩位大人」。Gmail「Message sent」確認。
- 驗(DB interaction 1380893):direction=inbound、channel=email、classification=**quote_request**、gmailThreadId 19f39d406fba66bf、內容為原文。→ 落卡✓、分類✓。
- 驗(紅點):profile 2760017 lastInboundAt 23:46:52 > jeffViewedAt 22:36:12 → 未讀成立;admin 列表「Better way To survive」置頂且有紅點。→ 紅點✓。

### Step 2a 回覆+承諾 — PASS(dueDate FAIL)
- 動作:pinned chat 指示草擬「答應 3 天內給完整報價」→ AI 出 FOLLOWUP 草稿(主旨「金門三日遊行程,3 天內給您」)→ 確認發送。
- 驗(外寄落卡,DB interaction 1380894):direction=outbound、channel=email、gmailThreadId **19f39d406fba66bf(同 inbound 串,是串內回覆)**、內容為 3 天承諾。→ PASS。
- 驗(承諾,DB customerPromises id 5):promiseText「我們會在 3 天內把兩位大人的完整行程和報價整理好給您過目」、rawDateText「3 天內」、extractedAt 有值。→ 承諾出現 PASS。
- 驗(dueDate=今天+3):**FAIL** — dueDate=null(應為 2026-07-09)。extractedAt 已跑完非 async pending,是「N 天內」相對日期沒被解成絕對日期(比對:絕對日「7/8」「7月20日」都有解;相對「3 天內」「今天」「7/8 之前」都 null)。AI 事後有主動問「要不要把跟進日設 7/10」→ 有補償提示但自動 dueDate 沒填。
- 驗(真相條翻等客人回):PARTIAL — 客人層級真相條仍「需跟進 · 詢問待回 / 該跟進了」,沒翻成字面「等客人回」(被既有 Napa 草稿單+未兌現承諾主導);金門串本身已回、待客人回,但客人層是聚合狀態。

### Step 2b 建報價單 — PASS
- 動作:pinned chat 指示建新報價單(金門三日遊,2 位大人,出發 2026-07-27,總價 980 美元)。AI 主動抓到「客人詢問是十月、你給 7/27 對不上」給 A/B 選項(良好防呆),我選 B(照 7/27)。
- 驗(DB customOrders id 11):orderNumber **ORD-2026-0011**、customerProfileId 2760017、category=quote、status=draft、title「Better way To survive 金門三日遊(2位大人)」、departureDate 2026-07-27✓、totalPrice 980.00 USD✓、quoteSentAt null、與 Napa(id 7)分開的新單✓。→ PASS。

### Step 3 出報價 — PARTIAL(附件 FAIL)
- 動作:active project 自動切到 ORD-2026-0011。pinned chat 指示產 quote summary → 產出「報價摘要_20260707.pdf」掛 ORD-2026-0011,存進客人文件(概覽 文件 0→1 份)。→ **PDF 進文件 PASS**。
- 動作:再指示「把報價摘要附上寄給客人」→ AI 出 FOLLOWUP 草稿(主旨「金門三日遊報價整理好了」,本文寫「總價 USD 980,附在信裡請您看看」)→ 確認發送。
- 驗(掛草稿寄出,DB interaction 1380895):direction=outbound、in-thread(19f39d406fba66bf)、本文為報價信。→ **寄出 PASS**。
- 驗(0909 收到附件):**FAIL** — 0909 收件匣收到「Re: 金門三日遊報價整理好了」,但**信裡沒有任何附件**(開信確認:無 PDF chip、無 paperclip;對照 Napa 舊信有 PDF chip)。信本文說「附在信裡」卻沒附。order11.quotePdfUrl 也是 null。→ 產了 PDF 也寄了信,但**PDF 沒真的掛進外寄郵件**。
- 驗(訂單 quoteSentAt):null(未標)。符合任務預期的「頁面手動標設計」,記錄不算 fail。
- 附記:外寄信 customOrderId=null(信沒自動掛到 ORD-2026-0011)。

### Step 4 客人同意 — PASS
- 動作:0909 Gmail 在同串回信「行程可以,請給付款資訊。謝謝。」(串內 reply)。
- 驗(落卡,DB interaction 1380896):direction=inbound、classification=booking_question、in-thread、內容為原文。→ 落卡 PASS。
- 驗(自動歸屬):**customOrderId=11** — 回信沿 thread 正確歸到金門單 ORD-2026-0011。→ 自動歸屬 PASS。
- 驗(紅點):lastInboundAt(00:27:17)> jeffViewedAt(00:12:51)→ 紅點成立;admin 列表 0909 置頂有紅點。→ PASS。
- 附記:Gmail pipeline 有延遲(送出到落卡約數分鐘,is:unread poll),非即時。

### Step 5 請款(訂金 50%) — PARTIAL(附件 FAIL + 金額沒進結構欄位)
- 動作:pinned chat 出請款單「預訂與支付單_20260707.pdf」(單 ORD-2026-0011),存進客人文件(文件 1→2 份),AI 出 FOLLOWUP 草稿(主旨「金門三日遊付款資訊」,本文「訂金是總價 50%,系統已算好寫在單上」)→ 確認發送。
- 驗(寄出,DB interaction 1380897):direction=outbound、**customOrderId=11(有掛到金門單)**、in-thread、本文為請款信。→ 寄出 PASS。
- 驗(0909 收到附件):**FAIL** — 0909 收到「Re: 金門三日遊付款資訊」,開信確認**沒有任何附件**。本文說「已把預訂與支付單附在這封信裡」卻沒附。**與 Step 3 同一個系統性 bug**。
- 驗($490 應由 code 算):**無法確認 + 疑似缺**。order11.depositAmount=null、balanceAmount=null、collectionSentAt=null。金額(50%=490)只在 PDF 上(而 PDF 又沒寄出),訂單結構欄位沒被填。信本文也沒寫出數字。
- 附記:出文件/寄信不會標訂單的 collectionSentAt(同 quoteSentAt),屬頁面手動標設計。

### Step 6 收訂金 — PARTIAL(標記 PASS;收據被 LLM 事故擋)
- 動作:帳務頁 ORD-2026-0011 → 催款/訂金 → 記一筆收款 金額 490、日期今天 → 標記已收。→ 摘要「已收 $490」、單狀態變「已收訂金 / 部分付款」。→ **手動標訂金 PASS**($490 由我手填,因 depositAmount 沒被 code 算,見 Step 5)。
- 動作:chat 指示出訂金收據 → **BLOCKED**。AI 回傳原始 Anthropic 400:「Your credit balance is too low to access the Anthropic API…purchase credits.」→ 誠實閘結果無法驗(被上游 LLM 事故擋在生成前)。

### ⛔ 事故 F4(CRITICAL,prod 現況)— Anthropic API 額度耗盡,全站 LLM 掛掉
- Step 2/3/5 的 chat 生成都還正常,Step 6 生成收據時 API 餘額歸零。錯誤原文:invalid_request_error「credit balance is too low」。
- 影響面:不只 E2E 收據。prod 所有 LLM 功能都受影響 —— 客服/ops chat、自動回信草稿、文件生成、tour 生成、校準、以及 **Step 10 畢業條件的 caseLearnings 蒸餾(distillCaseLearning 用 LLM)**。真實客人此刻拿不到 AI 回覆。
- 非暫時性(是帳務餘額狀態,retry 無用)。需 Jeff 儘快 Plans & Billing 加值。
- 對本輪 E2E:LLM 相關步驟(6 收據、8 尾款收據、10 蒸餾)全被擋;純按鈕/伺服器計算步驟(標收款、推進狀態、看門狗、todayList、標結案)仍可跑。

### 事故 F4 後續:Jeff 加值 → LLM 恢復,從 Step 6 續跑
- 重下訂金收據指令,不再回 credit error,AI 正常生成 → 誠實閘在收款後放行(付款已標 → 允許出收據)。Step 6 收據補完 PASS(見下)。
- 收尾補記:兩台瀏覽器連線在等待期間又重置一次,第三台 macOS Chrome 冒出來;仍用 deviceId 0179fb63 直接選回原 admin 台續跑。switch_browser 三次都逾時。

### Step 6(續)訂金收據 — PASS
- interaction 1380898 outbound、customOrderId=11、in-thread,本文「訂金 USD 490 我們已經收到囉!隨信附上訂金收據 PDF」。誠實閘 PASS(收款後才允許出收據)。附件延續 F3(未逐一再開信,系統性已成立)。

### Step 7 承諾兌現 — PASS
- pinned chat 指示把「3 天內給完整報價」承諾標已兌現 → AI「✓ 已標記承諾 #5 為已兌現」。驗:DB promise id 5 fulfilledAt=2026-07-07T02:37:10(從 open 清單消失)。→ PASS。
- 附記:AI 主動浮出這位客人另有兩則未兌現承諾(7/8、7/20,其實是 Napa/優勝美地的),問要不要一起標 —— 良好但略過度(把不同單的承諾當成同一件),我拒絕未標。

### Step 8 尾款+確認 — PARTIAL(付清收據 PASS;confirmed/completed 皆 BLOCKED)
- 標尾款:帳務頁/尾款/記一筆收款 490 → 標記已收。已收 $980、狀態 paid、depositPaidAmount+balancePaidAmount 各 490、balancePaidAt 有值。→ 標尾款 PASS。金額在 depositPaidAmount/balancePaidAmount(不是 depositAmount,depositAmount 仍 null)。
- 付清收據:interaction 1380899 outbound、in-thread,本文「全款 USD 980 都到帳。隨信附上付清收據 PDF」。誠實閘 PASS。→ paid_receipt 寄出 PASS。(送出鈕在串流中會位移,點了三次才中;非致命但 UX 卡。)
- **推進到 confirmed:BLOCKED(F5)**。AI 說 ORD-2026-0011 是訂製單,update_booking_status 只改團期 booking、update_custom_order 只改內容欄位,**沒有工具能改訂製單的 confirmed/completed/cancelled 狀態**;要手動在帳務頁標。但帳務頁抽屜整個看過(編輯內容/報價/催款/確認書/取消訂單)**沒有「標記完成/結案」按鈕**;confirmed 只能靠上傳確認書 PDF 按「送出確認書」,而系統**沒有出發確認書產生器**(只有 4 種:deposit_receipt/payment_request/paid_receipt/quote_summary)。
- **看門狗零誤報**:待補(下一步查)。

### Step 10 結案 — BLOCKED(F6,畢業條件卡住)
- 想標 completed → AI 明說 update_custom_order 不能改狀態,得手動帳務頁標;但 UI 抽屜沒有 completed/結案控制項。→ **訂製單無 UI/AI 路徑可達 completed**。
- 因為學習閉環(distillCaseLearning)是在訂單 completed 時 fire,completed 達不到 → **本輪畢業條件(蒸餾一條教訓進 caseLearnings)無法透過正常流程觸發驗證**。(正用 subagent 查 code 確認 completed 到底怎麼設、蒸餾怎麼觸發。)

### Step 10 結案 + 學習閉環(畢業條件) — 機制 PASS,乾淨案不產列(需另備有教訓的案子)
- Jeff 授權後,用後台自己的 `customerOrders.updateStatus` admin mutation(他的登入 session、只碰測試單 11、走網站自己的 API)照狀態機把單走 paid→confirmed→departed→completed(三步都 HTTP 200)。order 11 status=completed。
- 學習閉環驗證(探針查 caseLearnings):**sourceOrderId=11 沒有列**。查因:distillCaseLearning 有 fire(completed 觸發 triggerCaseLearningDistillation)且有跑(prod log 無任何 `[caseLearning]` 錯誤:無 extract call failed / empty LLM response / distill failed);caseLearning.ts:128/155 的 `hasLesson=false` → buildCaseLearningRow 回 null → reason no_lesson → 不寫列。
- 結論:**學習閉環機制正常(completed→蒸餾 fire→跑→評估)。本輪金門是乾淨交易(詢問→報價→付款→結案,全程無踩坑),LLM 正確判定「無教訓」故不產列 —— 這是正確行為,非 bug**。對照 order 6(Wu 複雜大團)有 3 列真教訓。**畢業條件的字面「產一列」要用「有真教訓/踩坑」的案子才驗得到;乾淨案驗不出列**。這本身是個發現(F7:E2E 用乾淨案無法產生蒸餾列)。
- 去識別化:因無列,無法驗 lesson 去識別化(留待有教訓的案子)。
- confirmedAt/recognizedAt 仍 null:狀態機轉移只設 status 欄位,不設 confirmedAt 時間戳(confirmedAt 是確認書流程設的);Trust 認列(recognizedAt)狀態機不碰(caseLearning 註解:這層不做 Trust 分錄),符合 §17550 出發後才 recognize 的紅線 —— 沒有誤認列。

### Step 9 出發倒數看門狗 — 未完整跑(順序取捨)
- 因為要驗畢業條件必須先把單走到 completed(step 10),做完 step 10 後這張單已 completed,不再適合當「未來出發的活躍單」測倒數。故 step 9(改出發日 T+5 驗 T-7 倒數)未在本張單上跑,記為未完成。
- Step 8 的「看門狗零誤報」附帶觀察:金門單概覽在我已即時回信後仍顯示「有超過 48 小時未回覆的詢問 · 建議今天處理」——**疑似誤報**(該串剛回、待客人回)。待查是否聚合到別串或計算沒扣掉最新外寄。列為觀察。

---

## 總結

### 通過率(11 步,逐項)
- Step 1 詢問落卡:**PASS**
- Step 2a 回覆+承諾:**PASS**(dueDate FAIL:相對日期沒解;真相條 PARTIAL)
- Step 2b 建報價單:**PASS**
- Step 3 出報價:**PARTIAL**(PDF 進文件+寄出 PASS;**附件 FAIL**)
- Step 4 客人同意:**PASS**(自動歸屬正確)
- Step 5 請款:**PARTIAL**(生成+寄出 PASS;**附件 FAIL**;金額沒進結構欄位)
- Step 6 收訂金+收據:**PASS**(手動標訂金 PASS;誠實閘 PASS)
- Step 7 承諾兌現:**PASS**
- Step 8 尾款+付清收據:**PARTIAL**(付清收據 PASS;**confirmed BLOCKED**)
- Step 9 出發倒數:**未完整跑**(順序取捨)
- Step 10 結案+學習閉環:**機制 PASS,乾淨案不產列**(畢業條件字面未達,但非 bug)
- 中途事故:Anthropic API 額度耗盡(F4),Jeff 加值後恢復。

粗估:核心流程(詢問→建單→報價→同意→請款→收款→收據→承諾→付清)大致走得通;卡在「附件沒真寄」「confirmed/completed 無 UI 路徑」「乾淨案不產蒸餾列」。

### 最該修前三名
1. **F3 報價/請款/收據信的附件沒真的寄出(系統性,最高)**。生成 PDF、存文件、信本文都寫「附在信裡」,但外寄郵件實際沒帶附件(quote、payment_request 兩份都親眼開信確認沒附)。客人收到說有附件卻沒附 —— 直接傷客戶信任+沒拿到報價/請款單。
2. **F6 訂製單沒有任何 UI/AI 路徑可標 confirmed / completed**。`customerOrders.updateStatus` mutation 沒接到任何前端按鈕,AI 也沒工具;等於訂製單走不完生命週期,學習閉環(distillCaseLearning)在正常後台流程永遠不會被觸發。訂製單是主力業務,影響大。
3. **F1 相對日期承諾 dueDate 解成 null**(「3 天內」「今天」→ null,絕對日期正常)。承諾沒 dueDate → 看門狗追不了時效;AI 有補償提示但沒自動填。

### 其他發現
- F4:Anthropic API 額度會耗盡把全站 LLM 打掛(已加值恢復);建議設餘額告警。
- F5:沒有「出發確認書」產生器(只有 4 種文件型);確認書只能手動上傳 PDF。
- F7:E2E 用乾淨案無法驗蒸餾產列(要有真踩坑的案子)。
- depositAmount 欄位不填(金額只在 depositPaidAmount/balancePaidAmount);quoteSentAt/collectionSentAt 出文件時不標(頁面手動標設計)。
- 業主兩台瀏覽器對調(Browser 2 無 admin session);switch_browser 屢逾時(改 deviceId 直選)。
- 客人列表搜尋找不到 name=null 的客人(2760017);/ops/customers/:id 深連結是 SPA 404。
- pinned chat 送出鈕在 AI 串流中會位移,常點不中(UX 卡)。
- 疑似看門狗誤報:剛回信仍顯示「48 小時未回覆」。

### 環境
prod v797(批十一 + 0112 修復)。全程只碰 0909(#2760017)測試帳號與本輪建立的 ORD-2026-0011。無真實付款(收款用後台按鈕手動標)。寄信只 0909↔support@。訂單保留 completed(0909 已排除統計)。

## Findings(累積)
- F-setup:業主 admin/0909 兩台瀏覽器對調;Browser 2 無 admin session(403)。已改正在 Browser 1 跑。
- F1(承諾相對日期):「3 天內」等相對日期承諾 dueDate 解成 null(應 today+3)。承諾無 dueDate → 看門狗無法追時效。絕對日期正常。AI 有補償式提示但未自動填。
- F2(真相條聚合):回覆單一串後客人層真相條未翻「等客人回」(被其他未結項聚合成「需跟進」)。屬設計取捨,記錄待議。
