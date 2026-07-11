# 財務頁(/ops/finance,FinanceCockpit)體檢報告 2026-07-11

> 受檢:FinanceCockpit 組件家族(client/src/components/admin-v2/FinanceCockpit/*)。
> 模式:全程唯讀。prod 唯讀探針一次(flyctl ssh 容器內 mysql2 SELECT + backfill dry_run 端點,Bearer LOCAL_SCRIPT_TOKEN,零寫入)。
> 探針原文存 scratchpad ck-probe.cjs(node --check 0 err、無反引號/dollar-brace);本檔只留結論。
> 背景:F2 全案 v808 上線;prod 現況已到 v810(v809/v810 於 F3 收案後續刷)。health 四路 ok。
> 基準:F3 驗收 15 格 prod 探真(2026-07-10,progress.md §塊D 真數對比表)。

## 結論一句話

數字敢信,這頁可以當「唯讀真相儀表板」型的唯一看帳入口;但要當「唯一記帳(清 322 筆待認領)入口」還不敢，得先補三件事(200 筆天花板、批次認領、錯誤態),否則背帳清不動、還有 100+ 筆從 UI 搆不到。

---

## 第一節:數字真相(v808 後重對)

方法:今日(LA 2026-07-11)重跑 F3 同款唯讀探針,以 bankPLService.foldBankPLRows 相同折疊邏輯獨立重算,對 F3 15 格基準逐格比。generateBankPL 與頁面(financeKpi / profitLossReport)共用同一支 fold,兩個遞延項本月皆 0(見下),故獨立重算 = 頁面值,兩者一致。

### 15 格重驗表(基準 07-10 vs 今日 07-11)

| 格 | 基準 07-10 | 今日 07-11 | 變了? | 判讀 |
|---|---|---|---|---|
| 現金部位 #2174(available) | $2,034.03 | $2,034.03 | 否 | current 由 2034→1421 但 tile 取 available,未動 |
| 本月營收 income.total | $290.00 | $565.00 | 是 +$275 | 新訂金入帳,自然成長,非 v808 |
| 本月淨利 | −$238.97 | +$14.54 | 是(虧轉盈) | +$275 營收 − $21.49 OpEx = +$253.51 翻正 |
| COGS(tour+other) | $210.90 | $210.90 | 否 | tour 210 + other 0.9 |
| OpEx 逐項 | office 96.40 / travel 120.17 / software 101.50 | office 104.54 / travel 133.52 / software 101.50 | 是 +$21.49 | office/travel 新支出 |
| 退款列 | $0 | $0 | 否 | |
| Stripe 撥款 tile | $0 | $0 | 否 | |
| 內部轉帳 tile | 淨 +$0(4 筆,搬運 $13,540) | 淨 +$0(4 筆,搬運 $13,540) | 否 | netted 語義不變 |
| 待認領(真相列) | 321 筆 / $448,022 | 322 筆 / $448,297 | 是 +1 / +$275 | dry_run 內部一致(359 掃 − 37 自動 = 322) |
| Trust 主數字 matchedNotDeparted | $0 | $0 | 否 | 無已對應未出發列 |
| Trust 未對應 | $15,422(3 筆) | $15,422(3 筆) | 否 | 同三筆孤兒訂金 8,908/2,916/3,598 |
| Trust 待認列 departedPending | $0(0 筆) | $0(0 筆) | 否 | 認列卡續隱藏 |
| Trust 等式 outstanding | 0+0+15,422=15,422 | 0+0+15,422=15,422 | 否 | 恆真式成立 |
| Trust 餘額 / drift | $4,980 / −$10,442 | $4,980 / −$10,442 | 否 | 合規待查訊號未動 |
| 本年已認列(TaxDetail) | $0 | $0 | 否 | 全年零認列 |

### 「數字變了的格」判定

四格變:營收、淨利、OpEx、待認領。四格都是「一天資料自然成長」,不是 v808 修正也不是異常。營收 +$275 與 OpEx +$21.49 一減得淨利 +$253.51,虧轉盈;待認領 +$275 與新營收同源(同一筆新入帳既進 income_booking 又是未歸戶 pending,設計上兩概念分開,合理)。另引擎 link 由 14→16 筆,續在工作。

### 認列加回本月有沒有非零值(v808 重點)

有零。deferredIncomeSubtracted(本月存入減項)= $0;recognizedTrustIncome(本月認列加回)= $0。探針證據:trustDeferredIncome 表本月無 depositDate 落點、且全表「已認列未撤銷」列數 = 0(recognizedRows 空)。

合理性:合理但值得記一筆。PLAID_TRUST_DEFERRAL_ENABLED=true、v808 認列加回接線已 live,但目前對數字是 dormant(armed 但無料):三筆在管的信託訂金全部是未對應(無 bookingId)、存入於 7 月前、從未認列,所以減項與加回兩端都湊不到料,P&L 就是純毛額(income − cogs − opex)。換句話說 v808 這次口徑改動「上線即生效」但本月觀測值為 0,不是 bug,是沒有觸發條件。真正在該格上的錢($15,422 全未對應)正是 drift −$10,442 那條合規待查線的另一面。

### 本節小結

數字面乾淨:15 格今日全部對齊基準或屬正常一日成長,無 v808 引入的口徑異常。唯一「站著沒動」的風險是 Trust drift −$10,442(信託現金 $4,980 < 追蹤中未認列 $15,422),F3 已抓、頁面已用方向感知文案標「需查核」,但一天過去仍原地,建議優先查那三筆($8,908/$2,916/$3,598)。

---

## 第二節:工作流可用性(讀碼層)—— 清 322 筆待認領

一筆走完的步數(引擎有猜中候選的 happy path):

| 步 | 動作 |
|---|---|
| 1 | 在表列(最多 200 列)找到該筆 |
| 2 | 點候選 chip 預選(或直接跳 3) |
| 3 | 點「認領」開 ClaimDialog |
| 4 | dialog 內確認去向(chip 帶入)/ 金額預設全額 / 選填備註 |
| 5 | 點「確認」→ toast → listPending + pendingSummary 失效重抓 |

最快也要 chip → 認領 → 確認 三次點擊 + 一個 dialog 來回。沒有列上「一鍵接受引擎建議」;沒有批次;沒有鍵盤流;不記上次類別。322 筆 ≈ 千次點擊 + 322 個 dialog 來回。

三個最大摩擦點與各一具體改法(不實作):

| # | 摩擦點 | 證據 | 具體改法 |
|---|---|---|---|
| 1 | 200 筆硬天花板、無分頁 | listPending input `.max(200)`;PendingClaimsCard 傳 `{limit:200}`;pending 322 筆,卡頭顯示 322 但表身 ≤200 並標「僅顯示前 N 筆」;scanUnlinkedInflows 過濾後實際列數還更少 | scanUnlinkedInflows 已吃 limit,補 offset/cursor 與「載入下 200 筆」推進掃描窗,讓整條背帳搆得到;否則 100+ 筆永遠進不了視野 |
| 2 | 無一鍵接受、無批次認領 | claim mutation 只吃單一 bankTransactionId(全庫 grep 無 batchClaim/bulkClaim);happy path 仍要 3 點擊開 dialog 才能認一筆 | (a) 列上對「單一高信心候選」給直接「✓」一鍵認領全額;(b) 加 checkbox 多選 + 「選取批次歸同一類別」批次 mutation |
| 3 | 每筆認領觸發昂貴全量重抓 | ClaimDialog onSuccess `listPending.invalidate()` + `pendingSummary.invalidate()`;listPending 每次對掃到的每筆跑一次 processInboundTransaction dryRun(≤200 次候選比對),pendingSummary 走 runBackfillDryRun 全量掃(掃 359);清 322 筆 = 數萬次 dry-run 比對,每筆認領後列表都「卡一下」 | 認領成功後本地樂觀移除該列 + 延後/去抖 summary 刷新,取代每筆全量 invalidate-refetch;順手把「上次用的類別」記起來,省掉重複下拉 |

補充(第 4 個順手改):不記上次類別。ClaimDialog 每次開都重掛(key 重置),choice 從 null 起(除非帶入候選)。連續把 50 筆都歸 income_booking 時每筆重選一次類別。

---

## 第三節:死角掃描(FinanceCockpit 組件家族)

| 組件 / 卡 | 症狀 | 類型 | 說明 |
|---|---|---|---|
| TaxDetail「1040-ES 季繳」卡 | Q1–Q4 永遠 hardcode 顯「待建」 | render 了但永遠空 | 純佔位,後端無算法(誠實標,但天天佔一塊版面) |
| TaxDetail「Schedule C CSV」匯出鈕 | 永久 disabled + 「待建」標 | 死控制項 | 端點不存在,按不了 |
| TaxDetail 1099-NEC 卡 | 只判 isLoading 與空,無 isError | 錯誤態沒處理 | vendor1099List 若 error,`?? []` 讓它顯示「無 1099 廠商」而非「讀取失敗」,把錯當空 |
| TaxDetail KPI strip(4 格) | cur.data `?? 0`,無 loading/error 態 | 錯誤態沒處理 | profitLossReport 失敗時營收/淨利/Trust 四格靜默顯 $0(Schedule C 卡本身有 error 態,KPI strip 沒有) |
| TaxDetail「Trust 對稅時點」/「已排除」卡 | trustRecon / recognized query 無 error 態 | 錯誤態沒處理 | 失敗即顯 $0;現況本就全 $0,錯誤被永久性 $0 蓋掉 |
| TaxDetail「本年已認列」行 | 資料源通但實務恆 $0 | 永遠空(非 bug) | 全年零認列,故此行天天 $0 |
| RecognitionCard(待認列確認卡) | count===0(含 loading / error)一律 return null | loading/error 被吞 | 註解明講由 WorkColumn 承載空/錯;departedPending 現為 0 故卡本就恆隱藏,若 trustDeferredList error 也只是不出現,不報錯(可接受但留記) |
| TrustCard 逐團列 | 三段拆分吃 truth.trust(recon),逐團列吃 trustDeferredList | 潛在部分態 | 兩查詢分源;若 deferred 掛而 recon 通,拆分頭會顯非零 matched 但下方無逐團列。現況 matched=0 無影響,屬潛在不一致 |
| PLCard 檔頭註解 | 註「financeKpi 期間用 server 時鐘 UTC 切月」 | 陳述過期 | 實際 financeKpi 已於 F3 塊C 回爐 P2 改用 laToday(LA 曆月),與 PLCard 對齊;註解沒跟上,行為無誤 |

沒問題的(對照):TruthRow 四格 loading/error/stale 齊全;PendingClaimsCard loading/error/empty 齊全;PLCard loading/error/zeroMonth/stale 齊全;TrustCard loading/error/!enabled/allZero 齊全;AutoHandledCard loading/error 齊全。核心四格與工作區三卡的態機是穩的,死角集中在 TaxDetail(明細層)。

---

## 第四節:嫌棄清單候選(業主每天用五分鐘視角)

按影響排序;級別:P = F3-polish 小修、S = 結構動。

| # | 候選 | 影響 | 級別 |
|---|---|---|---|
| 1 | 待認領 200 筆天花板 → 122 筆搆不到,背帳清不完 | 高:直接卡住「唯一記帳入口」目標 | S |
| 2 | 無批次認領 / 無一鍵接受候選,一筆 3 點擊 | 高:322 筆的體力活 | S |
| 3 | 每筆認領後全量重抓(listPending ≤200 dry-run + pendingSummary 全掃),列表卡頓 | 高:清帳體感差、機器負載 | S |
| 4 | Trust drift −$10,442 三筆孤兒訂金,一天未動 | 高(合規非 UI):CST §17550,建議優先查 | S(查帳,非改碼) |
| 5 | ClaimDialog 不記上次類別,連續同類重選 | 中:重複勞動 | P |
| 6 | 1099-NEC / KPI strip / Trust 對稅時點錯誤態當空態 | 中:靜默 $0 會讓 Jeff 誤信「沒有」 | P |
| 7 | 1040-ES 季繳卡永久「待建」佔版面 | 中:每天看到空殼 | P(或暫收合) |
| 8 | Schedule C CSV 匯出鈕永久 disabled | 低-中:死控制項 | P(或暫隱藏) |
| 9 | PLCard 檔頭 UTC 切月註解過期(行為已對齊 LA) | 低:誤導後手工程師 | P |
| 10 | TaxDetail「去年」期間時,Schedule C 跟切、Trust 對稅時點固定本年,雙期並存易困惑(progress.md 已留待 Jeff 裁) | 低:語義小坑 | P |

小修(P)可併一波 F3-polish;結構動(S)的 1/2/3 是同一條命脈:把「清 322 筆」做成能一次坐下清完的動線(可達 + 批次 + 不卡頓)。第 4 是查帳動作不是改碼。

---

## 附:今日探針要點(唯讀,節制一次打點)

- 帳戶:#2174 current 1,421.03 / available 2,034.03(現金 tile 取 available);#5442 Trust current=available 4,980.00;另 #4899 / #9888 非 trust 不上駕駛艙。
- 本月 fold(獨立重算 = generateBankPL):income_booking 毛 565、cogs 210.90、opex 339.56、refunds 0、transfer 淨 0/搬運 13,540/4 筆、stripe 0、square 0;deferredThisMonth 0、recognized(全表)0 → income.total 565、netProfit +14.54(顯示四捨五入為 +$15、利潤率 2.6%)。
- Trust 未認列:3 列全未對應(bookingId NULL)8,908+2,916+3,598=15,422;matched/departed 皆 0;全帳戶未認列加總 3 筆/15,422(無哨兵、無非 trust 帳殘留)。
- 待認領 dry_run:掃 359、自動 small_inflow 37、pending 322 / $448,297(359−37=322 內部一致)。
- bankTransactionLinks 現有 16 筆 link。
