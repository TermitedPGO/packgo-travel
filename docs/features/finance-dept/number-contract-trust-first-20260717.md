# Trust-first 數字契約(Phase 0,docs-only)2026-07-17(依 Codex 13:42 終驗返工,v3)

> base: origin/main@4e9199d0。本檔是 server-side metric contract 規格,不是已實作能力。
> 核心原則:**四軸互不推導** —— ①銀行實際現金位置 ②法律上應留在 Trust/可依法支出(律師軸) ③會計負債與收入認列(CPA 軸) ④稅務認列(獨立於帳面認列)。任何一軸不得替另一軸解除。付 invoice 只清 supplier payable,不清 contract liability;transferredAt(銀行轉出)不解除會計負債;recognizedAt 不證明可動錢;帳面認列不默認等於稅務認列。
> 「現況」欄一律指 **base 4e9199d0 的結構可讀性(code/schema inspection),非 runtime 探測**;歷史數字一律標 snapshot 日期(07-11 探針)。未定格 = unresolved + reasonCode,不補猜。

## 一、輸入 provenance、assurance 刻度、衍生指標 lineage

### 1.1 輸入 provenance 四類(標「這筆輸入哪來的」,無高低序)

| 類 | 名稱 | 定義 | 例 |
|----|------|------|-----|
| A | 外部 posted facts | 外部系統已 post、PACK&GO 不能改 | 銀行 posted 交易、Plaid 餘額、處理商已結算事件、收到的 invoice PDF(文件本身) |
| B | Jeff 核准會計真值 | Jeff 逐筆核准的會計事實 | claimedBy='jeff' link、approved invoice、逐筆核准認列(未來)、關帳 |
| C | 營運承諾 | 合約/訂單層承諾,尚非會計事實 | 合約價、供應商承諾、應收預期 |
| D | forecast/AI 建議 | AI 抽取/候選/建議/預測 | OCR 值、配對候選、分類建議、forecast |

### 1.2 assurance 刻度(P1-1 修正:provenance 是類型不是刻度,另立有序 enum)

`posted-fact > jeff-approved > operational > suggested > unverified-proxy`

映射:A+已對帳→posted-fact;B→jeff-approved;C→operational;D→suggested;任何以代理表推估的現況值→unverified-proxy。**合成規則:衍生指標 assurance = 全部組成中刻度最低者**(enum 有序,取序最低),不得高報。

### 1.3 衍生指標必帶欄位

`componentLineage`(組成輸入+各自 provenance/assurance)、`assurance`(依 1.2 合成)、`closedEligible` 與 `taxEligible`(兩個獨立欄位)。unverified-proxy 一律禁入 closed 與 tax truth。D 永不混入 A/B、永不回寫帳本;A→B 唯一通道是 Jeff 核准(append-only+audit)。

### 1.4 稅務軸最小契約(P0.5:不得只剩 taxEligible 布林)

每個可能入稅的指標須定義:稅務認列事件(event type)、金額口徑、期間(tax year,LA)、as-of。**現況全部 not-computable + RC-CPA(稅務時點矩陣未定);不得默認帳面認列 = 稅務認列**。taxEligible 欄只回答「結構上有無資格」,不回答「現在算不算得出」。

## 二、狀態模型(四正交軸)

| 軸 | 值域 |
|----|------|
| dataStatus | loading / ready / error / disconnected / not-configured |
| completeness | complete / partial / empty-filter / true-zero / not-computable / unsupported |
| freshness | fresh / stale |
| periodStatus | open / closed |

UI primary state 解析序:error > disconnected > not-configured > loading 任一命中即主態(附 reasonCode);否則由 completeness 呈現,freshness/periodStatus 以 badge 疊加。`closed + stale`、`partial + stale` 等組合合法。error ≠ true-zero ≠ empty-filter;來源失敗顯示「無法核實」,禁止 $0。

### reasonCode 註冊表

| code | 意義 |
|------|------|
| RC-LAW | 律師矩陣未定(提領類型/required reserve/豁免/退款時鐘/法律適用性) |
| RC-CPA | CPA 矩陣未定(履約義務/認列/沖銷/稅務時點/principal-agent 會計後果) |
| RC-BOFA | BofA 帳戶書面釐清未回 |
| RC-AP | supplier invoice/AP ledger 未建 |
| RC-MATCH | 進帳配對 coverage 不足(07-11 snapshot:配對 0) |
| RC-EVENT | accepted event/immutable snapshot/取消 reversal 規則未定 |
| RC-DEDUP | 經濟事件唯一性(防雙計)constraint 未建 |
| RC-PROC | 處理商正本未導入 |
| RC-FOLD | 三 CPA 出口 canonical fold 未收斂 |
| RC-FROZEN | 認列/轉出 fail-closed 凍結中 |
| RC-CCY | 非 USD 處理未實作 |

## 三、金額表示契約

USD integer minor units(cents)為目標表示;現況 DECIMAL(14,2),Phase 1 遷移或以 scale=2 嚴格運算,**禁止 parseFloat 流水線**。單筆不捨入;比率/分攤 sum-before-round;呈現層才捨入。Plaid 符號約定只存在 A 層原始列,契約層一律正號金額+方向欄位。修正用 reversal/adjustment 列(append-only),禁止 update/delete。不變量:**對帳到 1 cent** —— drill-down 構成列之和與卡面數字誤差必須為 0,非 0 即 error 態。

## 四、KPI 契約矩陣(18 列,逐列 15 欄,不用「同上/繼承」)

15 欄固定:①用途 ②lineage(輸入+assurance) ③公式與不變量 ④canonical source ⑤期間與 LA 邊界 ⑥currency ⑦as-of ⑧coverage(分子/分母) ⑨排除集合 ⑩drill-down ⑪dataStatus ⑫completeness ⑬closedEligible ⑭taxEligible ⑮unresolved+reasonCode。

### 槽 1|Operating bank cash
①營運帳現在可動用多少。②A;assurance=posted-fact。③Σ availableBalance(營運白名單帳戶);available 為 null → fallback=currentBalance 並標 quality=degraded;與槽 2 帳戶集合零交集。④linkedBankAccounts(isActive=1,TRUST_OPERATING_ACCOUNT_MASKS 白名單)+ Plaid availableBalance。⑤點時值,無期間。⑥USD;非 USD 帳戶 unsupported(RC-CCY)。⑦逐帳戶 `lastSyncedAt`(drizzle/schema.ts:3144)。⑧分子=已同步白名單帳戶數/分母=白名單帳戶總數;任一 disconnected → partial。⑨isActive=0 帳戶(可列舉)。⑩逐帳戶餘額+最近交易。⑪base 4e9199d0 結構可讀;runtime 未探測。⑫complete(結構面)。⑬否。⑭否。⑮無。

### 槽 2|Trust bank cash
①信託指定帳戶現金位置(命名不斷言法律性質)。②A;assurance=posted-fact。③Σ **currentBalance(posted ledger)**(isTrustAccount=1);available 只作流動性 hint 另列;pending/hold 差額顯示。④linkedBankAccounts.isTrustAccount=1 + Plaid currentBalance。⑤點時值。⑥USD。⑦逐帳戶 lastSyncedAt。⑧分子=已同步 trust 帳戶數/分母=isTrustAccount=1 帳戶總數(07-11 snapshot:1 戶;runtime 未探測)。⑨無。⑩帳戶流水。⑪base 結構可讀;runtime 未探測。⑫complete(結構面)。⑬否。⑭否。⑮帳戶法律定性 RC-BOFA/RC-LAW(不影響 A 層「銀行有多少錢」,影響槽 3b/4 解讀)。

### 槽 3a|Accounting contract liability(會計客戶合約負債)【CPA 軸】
①會計口徑下對客戶尚未履約的合約負債。②目標 B;現況 proxy=trustDeferredIncome 未認列未撤銷列(system 自動建);assurance=unverified-proxy。③**CPA 核准之「transaction price allocated to unsatisfied performance obligations − 已履約/已認列 − 核准 credit/refund」**(P0 修法 1);**不得以「全部收到的現金」當共同 base**——agent 模式 transaction price=公司報酬(例 $2,000),客戶款中代轉供應商部分($8,000)屬 **supplier payable/pass-through liability(獨立負債,見槽 7)**,付供應商只清該負債,不清本槽;principal 模式 transaction price 可為全額(例 $10,000)。**transferredAt(銀行轉出)不解除本負債**(canonical query plaidRouter.ts:1894-1908 亦只排 recognizedAt/reversedAt,不排 transferredAt)。④目標=唯一帳本配對閉環+逐筆認列紀錄+產品矩陣參數表;現況 proxy=trustDeferredIncome(recognizedAt IS NULL AND reversedAt IS NULL)。⑤點時值(逐單滾動);期間視圖 LA。⑥USD。⑦proxy 查詢時刻+底層 lastSyncedAt。⑧分子=proxy 覆蓋之客戶收款/分母=全部客戶收款;07-11 snapshot 分子近零(3 列)。⑨reversed 列、recognized 列(**不排 transferredAt**)。⑩逐單/逐 proxy 列。⑪ready(proxy 結構可讀)。⑫**partial(unverified-proxy,已知嚴重低估;且 agent/principal 拆分未定,proxy 無法忠實表達 transaction price 口徑 → 正式值 not-computable)**。⑬否。⑭否(稅務軸 not-computable,RC-CPA)。⑮RC-CPA(主:履約義務/transaction price 矩陣)、RC-MATCH、RC-FROZEN。

### 槽 3b|Trust required reserve(法定應留信託額)【律師軸】
①依律師矩陣此刻法律上必須留在信託的金額。②目標 B(律師矩陣參數+逐筆法律義務);assurance=N/A(not-computable)。③待律師矩陣(哪些收款計入、合法出帳/退款何時解除);不得以會計認列或出發日推導。④待建(轉出核准物件+矩陣參數表)。⑤點時值。⑥USD。⑦N/A(not-computable)。⑧N/A(not-computable)。⑨N/A。⑩N/A。⑪not-configured。⑫**not-computable**。⑬否。⑭否。⑮**RC-LAW(主)**、RC-BOFA、RC-MATCH。矩陣未定前顯示「未定(RC-LAW)」,禁止任何數字。

### 槽 4|Trust coverage(信託覆蓋)
①信託現金是否足額覆蓋法定應留額。②組成=槽 2(posted-fact)+槽 3b(not-computable);assurance=合成最低=N/A(not-computable)。③Trust bank cash(current)− Trust required reserve;減項只能是律師矩陣 required reserve。④槽 2 + 槽 3b 的 source(後者待建)。⑤點時值。⑥USD。⑦繼受槽 2 lastSyncedAt 與槽 3b N/A → 整體 N/A。⑧N/A(not-computable)。⑨N/A。⑩N/A(可下鑽槽 2 組成)。⑪not-configured(缺 3b)。⑫**not-computable(RC-LAW)**。⑬否。⑭否。⑮RC-LAW、RC-BOFA。歷史 −$10,442 = 2026-07-11 snapshot、tracked-unrecognized proxy 口徑之 historical operational drift(監控卡可續存,必標 proxy+snapshot),不升格合規公式。

### 槽 5|Gross Bookings(成交總額 KPI)
①期間客戶成交合約總額;**不得自動進 revenue**(principal 定性下同額可經槽 8b 的 B 層政策成為 recognized revenue,非本 KPI 相加)。②C;assurance=operational。③待定:accepted event、immutable price snapshot、取消/改價 reversal、customOrders×bookings 跨表唯一、USD filter 五規則未定。④customOrders + bookings(規則定後)。⑤LA 曆月(accepted event 錨,未定)。⑥USD;legacy TWD → unsupported 桶(RC-CCY)。⑦查詢時刻。⑧N/A(not-computable)。⑨draft/cancelled(規則待定)。⑩逐單。⑪ready(表結構可讀)。⑫**not-computable**。⑬否。⑭否。⑮RC-EVENT、RC-DEDUP、RC-CCY。

### 槽 6|Supplier Commitments(供應商承諾額)
①已確認訂單對供應商的承諾成本(未 invoice 化)。②C;assurance=operational。③Σ supplierCost(承諾狀態;invoice 核准後轉槽 7);承諾狀態機未建。④customOrders/bookings supplierCost 欄(現僅毛利參考用,無狀態機)。⑤點時值。⑥USD。⑦查詢時刻。⑧分子=有 supplierCost 之已確認單/分母=全部已確認單(缺值單列缺口數)。⑨cancelled。⑩逐單。⑪**not-configured**(狀態機未建)。⑫not-computable。⑬否。⑭否。⑮RC-AP、RC-EVENT。

### 槽 7|Approved AP / supplier payable(含 pass-through)
①Jeff 核准後的供應商應付+**agent 模式 pass-through customer funds obligation(客戶款中代轉供應商部分,自收款起即獨立負債,invoice 核准後併入 AP 流;是否/何時歸類 pass-through 依 CPA 定性)**——與槽 3a 是**不同負債**,付供應商只清本槽(P0 修法 2)。②B(approved 起);received/needs_review 抽取值=D;assurance=jeff-approved(結構建成後)。③三軸(design §四):document/due/payment;**rawRemaining = total − net allocations(allocations − reversals);remainingDue = max(0, rawRemaining);overpaidAmount = max(0, −rawRemaining)**(P1-5);disputed 另列 exposure,不從 obligation 靜默消失;總覽並列 undisputed due 與 disputed exposure。④未來 invoice/AP 表+allocation 表。⑤點時值+due 視圖(dueDate,LA 日界)。⑥USD。⑦表查詢時刻。⑧分子=有完整 invoice 的應付/分母=全部已知供應商義務(含 pass-through 估計)。⑨void(留列不刪,排除於 due)。⑩逐 invoice+逐 allocation。⑪**not-configured(RC-AP)**。⑫not-computable。⑬結構+CPA 時點後 approved 面可;現況否。⑭現況否(RC-CPA)。⑮RC-AP、RC-CPA。

### 槽 8a|Company Compensation(公司報酬)
①管理報表看 PACK&GO 實得(commission/service fee/markup)。②C;assurance=operational。③**正式期間 KPI:not-computable(RC-EVENT+RC-AP,期間集合繼承槽 5 未定規則)**(P1-2)。現況營運代理改名 **Raw quoted-margin proxy**:Σ(合約價 − supplierCost),**只納入 price 與 supplierCost 皆 non-null 的單**;缺成本單列筆數/金額為顯性缺口。④customOrders/bookings(proxy)。⑤proxy 無正式期間錨(查詢時點全量);正式版 LA 曆月待 RC-EVENT。⑥USD。⑦查詢時刻。⑧proxy 分子=雙欄 non-null 單數/分母=全部非 cancelled 單數;缺成本單另列。⑨cancelled、缺 price 或缺 supplierCost 單(列舉)。⑩逐單(含被排除單清單)。⑪ready(proxy)。⑫**partial(proxy)/正式 not-computable**。⑬否。⑭否。⑮RC-EVENT、RC-AP。

### 槽 8b|Recognized Revenue(正式認列收入)
①正式 P&L revenue 行。②B;assurance=jeff-approved(建成後)。③逐產品依 principal/agent 矩陣(agent=transaction price=報酬;principal=gross),由逐筆 B 層認列事件推導。④未來逐筆認列紀錄+產品矩陣參數表(現況不存在;認列凍結)。⑤LA 曆月(認列事件日)。⑥USD。⑦認列紀錄查詢時刻。⑧分子=已認列金額/分母=期間應認列金額(CPA 口徑;現兩者皆 N/A)。⑨reversed 認列(沖銷列)。⑩逐認列事件。⑪not-configured。⑫**not-computable(RC-CPA、RC-FROZEN)**。⑬是(建成後,唯一 revenue 真值);現況否。⑭結構上是;現況 not-computable(RC-CPA,稅務時點另定)。⑮RC-CPA(主)、RC-FROZEN、RC-MATCH。

### 槽 8c|Direct Supplier Cost / COGS
①正式 P&L 成本行(principal 定性產品)。②目標 B(核准 AP+認列配比);現況代理=銀行側分類;assurance=現況 unverified-proxy 至 jeff-approved 混層。③正式:依產品矩陣與認列配比(RC-CPA);現況代理:Σ effective category ∈ {cogs_tour, cogs_other} 出帳(jeffOverride=jeff-approved;僅 agentCategory=suggested)。④bankTransactions+分類欄(代理);未來認列配比紀錄。⑤LA 曆月(交易日;正式版=認列配比期間)。⑥USD(RC-CCY 風險)。⑦lastSyncedAt。⑧分子=Jeff 已核分類金額/分母=COGS 集合全額(AI 段列建議)。⑨excludeFromAccounting、pending 鏡像、refund、transfer。⑩逐交易。⑪ready(代理)。⑫partial(分類分層未落地)。⑬代理否;結構後是。⑭代理否;結構後依 RC-CPA。⑮RC-CPA、RC-AP。

### 槽 8d|Gross Profit(毛利)
①正式毛利(8b − 8c)。②組成=槽 8b+8c;assurance=合成最低=N/A(not-computable)。③槽 8b − 槽 8c(同期間同口徑);組成任一 not-computable 即 not-computable。④槽 8b/8c source。⑤LA 曆月。⑥USD。⑦繼受組成(現 N/A)。⑧N/A(not-computable)。⑨同組成。⑩下鑽 8b/8c。⑪not-configured。⑫not-computable(RC-CPA)。⑬結構後是;現況否。⑭結構後依 RC-CPA;現況否。⑮RC-CPA、RC-FROZEN。

### 槽 9|Take Rate
①報酬率 KPI。②組成=槽 8a proxy+槽 5;assurance=合成最低=N/A(not-computable)。③**分子固定=Company Compensation,分母=Gross Bookings**;分母 0 或任一組成 not-computable → 顯示「—」+reasonCode,不得造數;不隨 principal/agent 認列法改變分子。④槽 8a/5 source。⑤同組成(LA 曆月,待 RC-EVENT)。⑥USD。⑦繼受組成。⑧N/A(not-computable)。⑨同組成。⑩下鑽分子分母。⑪ready(可渲染「—」)。⑫**not-computable(RC-EVENT 傳染)**。⑬否。⑭否。⑮RC-EVENT、RC-AP。

### 槽 10|Operating Expenses(營運費用)
①期間營運支出(不含 COGS)。②A(交易)+分類層(jeffOverride=jeff-approved/agentCategory=suggested);assurance=分段標示。③金額公式:Σ 出帳 where effective category ∈ 營運費用白名單;**排除集合(有理由的 exclusion,非缺口):COGS 全集(cogs_tour、cogs_other,bankPLService.ts:62-69)、refund、transfer、processor payout(stripe_payout/square_payout)、excludeFromAccounting、pending 鏡像**(P1-4);合計卡分列「Jeff 已核/AI 建議/未分類」。④bankTransactions+分類欄。⑤LA 曆月(交易日)。⑥USD(RC-CCY 風險)。⑦lastSyncedAt。⑧**分類 coverage 與金額公式分開**:分子=已獲 Jeff 核准分類之 eligible 出帳金額/分母=**eligible operating outflows**(排除集合不入分母)。⑨前述排除集合(逐類列舉附理由)。⑩逐交易。⑪ready。⑫partial(AI 建議段佔比大)。⑬僅 jeff-approved 段且關帳後;現況否。⑭同左,且稅務時點 RC-CPA。⑮RC-DEDUP、RC-CCY。

### 槽 11|Net Income(淨利)
①CPA 口徑期間淨利。②組成=槽 8b−8c−10;assurance=合成最低=N/A(not-computable)。③8b − 8c − 10(B 層、關帳口徑);組成任一 not-computable 即 not-computable,顯示「無法核實」,禁止 $0 或 gross 湊數。④組成 source。⑤LA 曆月/曆年。⑥USD。⑦繼受組成(現 N/A)。⑧N/A(not-computable)。⑨同組成。⑩下鑽三組成。⑪not-configured。⑫**not-computable(RC-CPA、RC-FROZEN、RC-FOLD)**。⑬關帳後是;現況否。⑭關帳後依 RC-CPA;現況否。⑮RC-CPA、RC-FROZEN、RC-FOLD。既有畫面 netProfit 為管理參考(混層),Phase 1 重標。

### 槽 12|Refund liability / open disputes
①應退未退款項+處理商未決爭議。②B(義務成立)/C(潛在);assurance=現況 N/A(not-configured)。③Σ(成立退款義務 − 已退)+逐筆爭議;義務成立時點=RC-LAW(退款時鐘)。④未來退款義務紀錄(義務判定屬律師軸;付款側退款 ledger 歸 Batch 1/saga)+處理商爭議正本(未導入)。⑤點時值+期間視圖(LA)。⑥USD。⑦N/A(來源未建)。⑧N/A(not-computable);處理商側「DB 無」顯示「無資料來源」,**不得解讀為 0**。⑨N/A。⑩逐義務/逐爭議(未來)。⑪**not-configured**。⑫not-computable。⑬否。⑭否。⑮RC-LAW、RC-PROC。

### 槽 13|AR due / overdue(應收/逾期)
①客戶應付未付(訂金/尾款);overdue 由 dueDate+LA 日界。②C+配對核銷(B);assurance=operational(核銷面 unverified,配對 0)。③Σ(合約應付 − 已配對收款),分 not_due/due_today/overdue。④customOrders 收款欄+bankTransactionLinks。⑤點時值+due 視圖(LA 日界)。⑥USD。⑦查詢時刻+lastSyncedAt(核銷面)。⑧分子=有配對核銷的單/分母=全部在途單(07-11 snapshot:分子 0)。⑨cancelled。⑩逐單。⑪ready。⑫**partial(RC-MATCH)**。⑬否。⑭否。⑮RC-MATCH。

### 槽 14|Unmatched / uncategorized(誠實度指標,P1-4 重寫)
①其他指標可信度 gate;永駐總覽例外區。②組成分層:交易=A(posted-fact);link 依 claimedBy 分層(jeff=jeff-approved/system=suggested);assurance=分桶標示,整體=最低桶。③**兩個口徑分列**:(a) raw operational remaining = Σ 逐交易 max(0, abs(amount) − Σ 現存 allocations),範圍=**inflow 與 outflow 皆計**(與 coverage 同口徑),依現存 link 可算;(b) Jeff-verified close-eligible remaining(append-only、reversal-aware)= **target / not-configured + RC-DEDUP** —— base 4e9199d0 的 bankTransactionLinks 無 reversedAt/reversal 欄,unlink 直接 DELETE(bankTransactionLinks.ts:394-396),此口徑**今天無法由所列來源重建**;未來 source=append-only allocation reversal 列/表(Phase 1 設計),**audit log 不得冒充 money truth**。valid allocation(target 口徑)定義:未 reversed、正數、Σ ≤ abs(amount);**超額分配 = error 態**(對帳到 1 cent 不變量)。resolution status(matched/partially-matched/unresolved/transfer-neutral/excluded)與 match method(auto:<rule>/manual)**分軸**,manual 是方法不是狀態。pending 交易分桶另列不入分母;archived/excluded 附理由列舉;reversal 列沖減。④(a) 口徑:bankTransactions+bankTransactionLinks(amountAllocated,claimedBy);(b) 口徑:未來 append-only allocation reversal source(未建)。⑤點時值+期間視圖(LA)。⑥USD;non-USD 分桶。⑦lastSyncedAt。⑧分子=fully-matched 金額(依口徑 a/b 各算)/分母=eligible 交易總額(排除 pending/excluded/non-USD,各桶另列)。⑨pending、excludeFromAccounting、non-USD(全部顯性分桶,非黑洞)。⑩逐交易+逐 allocation(含 claimedBy 與 reversal)。⑪(a) ready;(b) **not-configured**。⑫(a) partial(RC-DEDUP、RC-MATCH 未閉;不得標 complete);(b) **not-computable**。⑬否。⑭否。⑮RC-DEDUP、RC-MATCH。歷史:07-11 snapshot 待認領 322 筆/$448,297。

## 五、示例(P0 修法 4):$10,000 客戶款/$8,000 供應商/$2,000 公司報酬,agent 與 principal 兩條完整時間線

事件:T0 客戶付 $10,000 入信託指定帳戶;T1 供應商 invoice $8,000 核准;T2 付供應商 $8,000;T3 服務完成、逐筆核准認列。欄位各軸獨立;Trust required reserve 全程未定(RC-LAW);Tax recognition 全程未定(RC-CPA,不默認=帳面)。金額單位 USD。

### 5.1 agent 模式(transaction price = $2,000;$8,000 為 pass-through)

| 時點 | Trust 現金 | Operating 現金 | Trust required reserve(律師軸) | Contract liability(3a) | Supplier payable/pass-through 總帳(其中 approved AP 為 memo/subledger,**不得相加**) | 負債合計(總帳,AP 子帳不重計) | Book revenue(8b) | Tax recognition |
|------|-----------|---------------|-------------------------------|------------------------|---------------------------------------------------------|------------------------------|------------------|-----------------|
| T0 收款 | +10,000 | 0 | 未定(RC-LAW) | 2,000 | 8,000(pass-through 成立,CPA 定性;AP 0) | 10,000 | 0 | 未定(RC-CPA) |
| T1 invoice 核准 | 10,000 | 0 | 未定(RC-LAW) | 2,000 | 8,000(其中 approved AP 8,000,同一義務之子帳) | 10,000 | 0 | 未定(RC-CPA) |
| T2 付供應商 | 2,000(若律師矩陣允許自 Trust 支付;否則自 Operating,Trust 不變) | 依付款來源 | 未定(RC-LAW) | **2,000(付款不清本欄)** | **0(付款清本欄;AP 同步 0)** | 2,000 | 0 | 未定(RC-CPA) |
| T3 履約+認列 $2,000 | 2,000 | — | 未定(RC-LAW) | **0(履約認列清)** | 0 | **0** | 2,000 | 未定(RC-CPA) |

終態:contract liability 0、supplier payable 0(含 AP 子帳)—— 全部負債歸零;銀行剩 $2,000 為 A 層事實;法律應留額與稅務認列各自待矩陣。**銀行轉出(transferredAt)在任何一步都不出現在負債欄位的解除邏輯裡。**

### 5.2 principal 模式(transaction price = $10,000)

| 時點 | Trust 現金 | Operating 現金 | Trust required reserve(律師軸) | Contract liability(3a) | Supplier payable 總帳(其中 approved AP 為 memo/subledger,**不得相加**) | 負債合計(總帳,AP 子帳不重計) | Book revenue(8b) | COGS(8c) | Tax recognition |
|------|-----------|---------------|-------------------------------|------------------------|---------------------------------------------------------|------------------------------|------------------|----------|-----------------|
| T0 收款 | +10,000 | 0 | 未定(RC-LAW) | 10,000 | 0 | 10,000 | 0 | 0 | 未定(RC-CPA) |
| T1 invoice 核准 | 10,000 | 0 | 未定(RC-LAW) | 10,000 | 8,000(其中 approved AP 8,000) | 18,000(對客戶+對供應商為兩個不同對象的義務,借方另有遞延成本資產,非重複計) | 0 | 0(認列配比待 CPA) | 未定(RC-CPA) |
| T2 付供應商 | 2,000(來源同 5.1 註) | 依付款來源 | 未定(RC-LAW) | **10,000(付款不清)** | **0** | 10,000 | 0 | 0 | 未定(RC-CPA) |
| T3 履約+認列 $10,000 | 2,000 | — | 未定(RC-LAW) | **0** | 0 | **0** | 10,000 | 8,000(配比認列) | 未定(RC-CPA) |

終態:全部負債歸零;revenue $10,000、COGS $8,000、毛利 $2,000(與 agent 模式毛利相同,revenue 行差 5 倍);Take Rate 兩種模式恆為 2,000/10,000 = 20%(分子固定槽 8a)。每類產品採哪套由 principal/agent 矩陣與 CPA 定案(RC-CPA)。

**不變量(兩表共用)**:supplier payable 總帳與 approved AP 是同一義務的總帳與子帳,任一時點負債合計只計總帳一次,禁止相加;「負債合計」欄逐時點機械核加總(agent:10,000→10,000→2,000→0;principal:10,000→18,000→10,000→0)。

## 六、與既有結構映射(Phase 1 落點,本輪不動)

- A 層已有:bankTransactions、linkedBankAccounts(lastSyncedAt)、trustDeferredIncome(proxy)、checkoutDisclosures(揭露存證,非 money truth)。
- B 層已有:bankTransactionLinks(claimedBy='jeff';claim/batchClaim 皆 Jeff 按)、jeffOverrideCategory;缺:invoice/AP+allocation 表、逐筆認列、轉出核准物件、關帳物件、律師/CPA 矩陣參數表、pass-through 負債結構。
- C 層已有:customOrders/bookings 合約欄;缺:accepted event/snapshot/承諾狀態機。
- D 層已有:agentCategory、配對候選、approvalTasks。
- 付款未來流(payment_attempt/operation/outbox、付款側退款 ledger)歸 Batch 1/Safe Booking Saga,不屬本契約。
