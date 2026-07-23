# 信託硬邊界與唯一帳本 — 批次提案(docs-only,不施工)2026-07-17

> 指揮(Fable)撰。主題來源:Codex 2026-07-16 22:55 停止線「下一主題切到財務部門,先定信託法律/會計硬邊界與唯一帳本,再談 AR/AP、渠道整合與 AI advisor」;Jeff 2026-07-17 口頭「開工吧」。
> 【2026-07-17 12:22 更新】Codex 已回財報區 Phase 0 固定施工單(Codex/2026-07-17.md),拍板六條營運事實:單一 Owner Jeff(AI 為不可批准角色)、Phase 1 USD-only(非 USD fail-closed)、Trust-first 為營運意圖非法律裁定、Gross Bookings 與 Net Revenue 並列不雙計(正式 P&L 口徑待 principal/agent 產品矩陣與 CPA)、invoice 作 AP 證據來源(收到 ≠ 已批准)、單人不取消稽核。Phase 0 交付=number-contract-trust-first-20260717.md + design-trust-first-finance-reporting-20260717.md(同批完成);本提案的問題包與 gate 規格方向不變。
> 本批性質:**零 production code、零 migration、零 prod 連線**。產出=問題包清單與機械 gate 規格(見 §三/§四;獨立可寄版與獨立 gate 檔為 backlog,見 §六)、唯一帳本設計裁定請求。所有法律/會計定性歸律師/CPA(60-evidence-and-ops §7),工程只存可證事實。
> 排序聲明:本批不佔施工位,與 Codex 7/15 §八.3「Batch 1 後只做 Stripe-first Safe Booking Saga」裁定不衝突;本批產出的書面矩陣問題包正是 saga Stage 3 前置「IOLTA/信託書面矩陣落成機械 gate」(Codex 7/15 P0-10 複核原話:「正式 capture 前仍須律師/CPA/銀行對 IOLTA/信託的書面矩陣與機械 gate」)的推進器。

## 一、事實基準(全部親讀原文或親核 code,錨點如列)

先釘死三個常被混講的數字與三個未定事實,本批所有文字以此為準:

1. **−$10,442 是餘額 drift,不是掃出金額**:drift = 信託帳現金 $4,980 − 追蹤中未認列 $15,422。掃往 Operating 的鐵證金額是 $8,908(#1 全額,三筆掃款分毫對上),合併推算掃出 $12,424,區間上限 $15,422(嚴格讀法:2026-07-11 snapshot 餘額全為營運週轉金)。錢全程可追,第六桶(真短缺)$0。evidence: trust-drift-audit-20260711.md §四。
2. **帳戶定性三說並存,未定**:①DB 標籤「Living Trust Account」(個人生前信託,drift-audit §二);②銀行正本印「California IOLTA Trust Accounts / Public Service Trust Account」(律師信託名義,STATE.md 銀行正本段);③§17550.15 要求的客款信託帳(功能定義)。BofA 書面釐清(等 Jeff 清單①)前,**本批任何文件不得斷言帳戶法律性質**,只准列三說並存。
3. **收款框架是全部進帳,非五通道**:期間進帳 400 筆 $477,548,五通道僅佔金額 29.1%;手機拍存 $64,599 + 支票 + 電匯在框架外,信託三筆正是手機拍存。配對到訂單者 **0 筆**(唯一 16 筆 link 全是 small_inflow 類別 tag)。唯一帳本第一個要解的是配對,不是接新源。evidence: channel-aggregate-20260712.md §0/§4/§5。
4. **停掃款聲明已生效**:2026-07-12 Jeff 第零步聲明生效,結案六條 1-2 生效、3-6 待(每筆轉出事前核准+法定類型、無核准轉出 P0 卡、月度 close、CPA 覆核)。evidence: trust-remediation-declaration.md。
5. **機械閘現況(親核 origin/main@4e9199d0)**:trustTransferWriteGate.isTrustTransferWriteApproved() 硬回 false,翻閘前提=CPA 認列矩陣+律師提領矩陣+Jeff 逐條裁定(trustTransferWriteGate.ts:18-20,檔頭註解);轉帳偵測強制 dry-run(trustTransferDetection.ts:345);manual_backfill 閘後拒絕(:576-583);HTTP 端點只放 dry_run,confirm/manual_backfill 403;認列全庫零寫入者,recognizeReadyDepartures 已整個移除,scanRecognitionDue 純掃描 propose-only,「逐筆核准」端點刻意未建(trust-recognition-fail-closed 批裁定的 fail-closed 態,非缺陷)。
6. **內部法規問題盤點已完成(非法律意見)**:ca-sot-law-reading-20260712.md 是法規原文的工程判讀,已把 §17550.15(c) 提領窮舉五款、工程可做 A1-A6、律師定案 B1-B7 盤點成清單;所有定性與措辭最終由律師定案。A1(停掃款)已由聲明覆蓋;A2(三筆指認)等 Jeff;A4(三筆 link 勾稽)、A5(揭露欄位)、A6(出帳閘)屬後續施工批;B1-B7 是本批問題包主體。

## 二、非目標與凍結(先說不做什麼)

1. 不解凍 trustTransferWriteGate、不建 recognizedAt 寫入者、不動認列停擺。矩陣未定,一切照停。
2. 不建第二套 money truth。payment_attempt / payment_operation / durable outbox / 退款 ledger / server-verified success 屬 **Batch 1 與 Safe Booking Saga** 範圍(付款未來流,Codex 7/15 §七 Batch 1 清單),本批一概不碰、不重定義。
3. 不動 Batch 0 範圍:cstTrust「TCRF 參與者」措辭與法條讀本的矛盾(讀本 §八:參加 TCRF 不免除信託帳義務)屬 Codex 7/15 Batch 0 第 6 項「撤下或限縮無證據宣稱」的一部分,本批只登記事實,不搶工。
4. 不連 prod、不跑探針、不驗旗標 runtime 值。現況數字沿用既有證據文件並標時點。
5. 不寄任何對外信件。三份問題包全部 Jeff 過目、由 Jeff 寄。

## 三、硬邊界:三份問題包(本批主交付)

問題包定位:把「矩陣未定」從一句話變成可寄出的具體問題清單,每題附法條/事實錨點與「答案將決定哪個機械 gate 參數」。措辭定稿權在律師(B6)。

### 3.1 問題包 A — 加州旅遊業律師(基底:law-reading B1-B7)

| # | 問題 | 答案決定的 gate |
|---|------|----------------|
| A-1 | PACK&GO 是否落入 §17550.16 任一豁免(小額轉付/Deposit Plan/Escrow Plan)?(B1) | 信託義務樣態;若豁免,硬邊界整組參數重定 |
| A-2 | TCRF 參與者身分與註冊現況;是否以 bond 替代信託帳?(B2) | §17550.13 揭露走 (G)(K) 或 (J);checkout 揭露文案 gate |
| A-3 | 三筆提前掃款定性(時點/混同 vs 挪用);§17550.14 3天/30天退款時鐘是否已觸發、對哪幾單?(B3) | 補回信託的金額與期限 gate;退款義務清單 |
| A-4 | 補回信託能否消除既往責任;是否/何時/如何向 DOJ/AG 揭露?(B4) | 補救 runbook 的順序與停止線 |
| A-5 | 個人 Living Trust 帳(銀行正本印 IOLTA 名義)當信託帳是否 per se 違規;正解是另開客款專用信託帳還是 bond?(B5,與 BofA 包 C 聯動) | 帳戶遷移 runbook;新帳開戶要件 |
| A-6 | §17550.13 (E)(F)(J)/(G)(K) 各句合規措辭定稿(B6) | checkout 揭露欄位的最終文字 |
| A-7 | AB 1758 若通過對上述條號義務的影響(B7) | 全矩陣的法規版本錨 |
| A-8 | §17550.15(c)(1)-(5) 逐款:PACK&GO 各類實際出帳(付供應商/佣金/退款)分別落哪款、各需何種憑證才算該款? | 轉出核准物件的「法定提領類型」enum 與證據要件 gate |
| A-9 | Stripe/Square 信用卡收單是否落入 §17550 信託監管?(法律適用性,13:42 P1-6 自 CPA 包移入;原 blueprint 待裁1) | STRIPE_TRUST_DEFERRAL_ENABLED 的法律前提 |

### 3.2 問題包 B — CPA(基底:F1-F3 已知限制與 blueprint 待裁)

| # | 問題 | 答案決定的 gate |
|---|------|----------------|
| B-1 | 管理認列與稅務認列的時點矩陣:出發日/服務提供日/憑證交付日/供應商付清日,四者各自對認列的意義?(60 §7 四件事分離) | 逐筆核准端點的認列資格參數;expectedRecognitionDate 語意 |
| B-2 | 承 A-9 法律分類確定後:信用卡收單的會計/稅務處理後果(遞延口徑、fee 淨額 vs 毛額、認列時點)?(13:42 P1-6:法律適用性歸律師,CPA 只答後果) | STRIPE_TRUST_DEFERRAL_ENABLED 確定後的會計參數 |
| B-3 | 部分退款的遞延沖銷:按比例還是全額擋人工?已認列後退款的沖銷分錄怎麼記?(F2 塊D 明文留 CPA) | 部分退款 gate 從「擋下轉人工」變參數化 |
| B-4 | flag 轉態基線日:flag OFF 期間認列的歷史列,翻 ON 後的月度口徑怎麼定?(F2 已知限制) | totalDeferredForUser/月度加回的基線參數 |
| B-5 | 信託月度 close 的最小儀式與 CPA 獨立覆核範圍(補救聲明結案六條 5/6) | 月結核對的驗收定義 |
| B-6 | 過水期間(2026-01 至 06)的帳務補記:三筆認列/補回的分錄與稅務處理 | 三筆的最終處置動作 |
| B-7 | principal/agent 產品矩陣:每類產品(自組團/代理團/機票/簽證/客製)正式 P&L 採 gross 還是 net?(Codex 7/17 施工單 §一.4) | P&L revenue 行口徑;數字契約槽 8b 的 B 層算法 |

### 3.3 問題包 C — BofA(基底:STATE.md 等 Jeff①,Jeff 親自問)

產品類型/所有權/利息歸屬/是否 IOLTA 報送(書面);若需另開客款專用信託帳:開戶要件、AG 申報帳號(§17550.21(f))、不可撤回查帳同意書(§17550.15(f)(2))的辦理方式。書面確認前不關帳、不搬錢、不改名(STATE.md 既定)。

## 四、硬邊界:機械 gate 規格(規格不施工;目標:矩陣答覆後盡量只調參數)

沿用 F2 先例「認列時點做成單一常數/函式」(dispatch-f2.md:28)為設計目標;**此為 target 非保證 —— 律師/CPA/BofA 的答覆可能要求改資料結構,屆時結構變更走正常設計審,不得為守住「只調參數」而扭曲答覆**。四件套規格:

1. **轉出核准物件(新表規格,暫名 trustWithdrawalApprovals)**:一列=一筆核准的信託轉出,五要素缺一不可 —— 旅客/訂單綁定、法定提領類型(enum 存 §17550.15(c)(1)-(5) 之律師確認值,**無預設值,無法自動填**)、金額、原始證據 pointer(供應商 invoice/退款單據/compensation 證據;「憑證交付證明」僅為 supporting evidence,**不能單獨建立 withdrawal eligibility**,可否成為正式 evidence type 屬 RC-LAW 待律師確認)、Jeff 核准(admin session + audit)。append-only,修正用沖銷列。今天 schema 全庫無此結構(親核:grep trustTransfers/withdrawal/transferApproval 於 server+drizzle = 0 命中;transferredAt 只是遞延列上兩個欄位,承載不了紅線 3 五要素)。
2. **法定可提領維度**:現況轉出資格唯一鍵在 recognizedAt(會計認列),但 §17550.15(c) 沒有「會計已認列即可轉」這款 —— 這正是 trustTransferWriteGate 檔頭自己寫明的停擺理由。修正方向:法定可提領由核准物件的 (c) 款+證據決定,與 recognizedAt 脫鉤;四時點(銀行現金移動/法律可提領/管理認列/稅務認列)各自獨立欄位可證。
3. **逐筆認列核准端點**:維持刻意未建。建造前提=CPA 認列矩陣(問題包 B-1)定稿。建造時比照 F3 先例(全部 Jeff 按+audit,AI 零自動)。
4. **信託帳出帳閘(law-reading A6)**:trust 帳任何出帳須對應核准物件,無對應即出 P0 卡(補救聲明結案六條第 4 條的系統面)。施工歸後續批,規格本批定。

## 五、唯一帳本:定義、邊界、裁定請求

### 5.1 定義(收款落地側,非付款流側)

唯一帳本 = **bankTransactions(權威帳,blueprint 既裁)+ bankTransactionLinks(配對)+ trustDeferredIncome(信託生命週期)+ 轉出核准物件(§四)** 的閉環。覆蓋「全部進帳」:每筆銀行進帳要嘛配對到單、要嘛有待認領卡(F1 完成判準),信託相關款項四軸獨立記錄(銀行現金移動/法律可提領/管理認列/稅務認列,各自事件與 as-of,互不推導;無單一線性路徑)。

### 5.2 首要工作是配對,不是接源(排序,施工歸後續批)

1. 三筆信託訂金與其掃款的 link 勾稽(law-reading A4)= 首批真實測資(blueprint 待裁3 原案),等 Jeff A2 指認後做。
2. claim 流:finance-page-checkup(07-11)所列三缺口(200 筆上限/無批次認領/全量 invalidate)**已在 base 4e9199d0 閉合為歷史**——batchClaim 已建(server/routers/bankTransactionLinks.ts:332,Jeff 手動勾選後親按)、cursor 分頁與局部 cache 失效已在(PendingClaimsCard 親核);不列 current gap。
3. 通道接入序沿用 channel-aggregate §6.2:Zelle(資料已在,建歸因規則)→ Square(API 正本)→ Stripe(封閉 rail)→ PayPal → Venmo(先問有無在用)。處理商正本一律需 Jeff 平台導出,DB 側「DB 無」不得解讀為「金額為 0」。

### 5.3 邊界裁定請求(交 Codex,本批不自裁)

1. **表歸屬矛盾**:saga design.md 啟用閘 3(:384)把 payment_attempt/operation/outbox 標為「Batch 1 schema」,§17.1(:434-440)又列為 saga 自己的 schema 缺口。請 Codex 裁誰建表並回寫兩處。本批立場:無論誰建,**它們是付款流帳本,不屬唯一帳本批**;唯一帳本只管已落地銀行的錢與信託生命週期,兩者以「錢是否已離開/進入 PACK&GO 銀行帳戶」切界。
2. **saga §十六每日 reconciliation vs F1 對帳引擎**:建議同一引擎擴充(F1 的 scan/claim 流加 provider ledger 比對源),不另建;請 Codex 裁。
3. **Q4b 耦合**:capture 後退款 SLA/partial/fee 承擔已明文「與 Batch 1 退款 ledger 一併定案」,唯一帳本批不搶裁。

## 六、交付物與驗收(2026-07-17 13:04 複核後更正)

Phase 0 固定交付=固定四檔(本提案一致性收斂、number-contract、design、progress 追加),依 Codex 12:22 施工單 §三;repo 外只准 Claude 通信檔與索引。

backlog(**未授權新檔,不在 Phase 0 交付**,待 Codex 另裁授權後才做):①問題包 A/B/C 可寄版獨立檔(Jeff 過目後寄;系統不寄;驗收=每題法條/事實錨點+gate 映射,零法律定性斷言) ②機械 gate 規格獨立檔(§四細化)。

STATE.md/journal 不在固定範圍,不得作為本批交付動作(2026-07-17 曾因舊版本節指示越界寫入 STATE.md 一句,已依 Codex P1-8 精確刪除復原;本節即當時錯誤指示的更正)。

## 七、等 Jeff(重申現有,不新增)

①BofA 書面釐清(問題包 C 是現成問題清單) ②三筆訂金指認訂單與出發日(A2,決定 A-3/B-6 答案的事實前提) ③選定律師/CPA 並寄出問題包 A/B ④CC-B 64 筆 CSV 位置(證據保全收尾)。

## 八、風險與誠實標記

1. 本提案現況宣稱基於 2026-07-08 至 07-12 證據文件與 origin/main@4e9199d0 code 親核;prod 當日 runtime 值(旗標/root 身分)未重驗,依 STATE.md 部署證據分級。
2. F2 塊A/塊B 的落地證據(migration 0114 實跑、systemAudit 四處接線 commit)未逐一回查,引用時以 schema 親核為準(transferredAt/transferBankTransactionId 欄位在,drizzle/schema.ts:3284-3285@origin/main)。
3. yearEndExport/taxCsv/auditExport 三匯出的防雙計規則自 07-08 標 [V] 至今未逐行讀,列入機械 gate 規格(backlog 檔)的前置閱讀清單。
