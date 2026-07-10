# F1 對帳引擎 指揮驗收判定(2026-07-09,Fable)

> 受驗:塊A/B/C(2026-07-08 pre-ship 審查後隨 v805 上線)+ 塊D 與六項回爐(3de1e67/0698dc3)+ round 3(24741e8)。
> 方法:塊D 四路 fresh 驗收 + round 3 兩路,全程唯讀;紅線路獨立重跑全套 vitest。

## 判定:F1 全案 PASS,收官

- 塊A 對帳引擎 / 塊B Stripe 遞延 flag / 塊C 防雙計:v805 已上線(pre-ship 審查含 opus 塊B 專審)。
- 塊D 衛生四件:recordPayment 'square' 回退移除(null 行為有測試釘)、三死 UI 元件零殘留、sandbox 清理三重防護(SQL 謂詞+JS 逐列複驗+BofA 黑名單,confirm ids 只出自 guarded scan)、0113 註解無 breakpoint 字面。
- 六項回爐:#1 wouldExceedAllocation 純函式+紅綠 8 例;#2 三態分派整合測試 8 例;#3 round 3 真修(見下);#4 豁免批准(見下);#5 migration 註解;#6 T6 紅線節。
- 紅線:STRIPE_TRUST_DEFERRAL_ENABLED 預設 OFF + byte-identical 測試原樣;confirm 路徑零自動觸發點;commit 無私貨。

## Round 3:isStripePayoutInflow 真修

- 探真(prod 唯讀):1612 筆交易 408 筆入帳,'stripe' 字樣四欄位零出現;真實處理商入帳 = Square(ACH CREDIT Square Inc SQ);Stripe 撥款尚未落 Plaid → 舊裸 stripe 謂詞零真陽性、純誤傷。
- 修法:hasWord(stripe) 錨點 + payout|transfer 撥款語境同現才命中;裸 stripe 落 pending_claim。不對稱取捨成立:漏抓可人工救回,誤標靜默虧錢。
- 殘留窗(P3 記錄,現況零曝險):姓 Stripe 客人 + descriptor 含 transfer 泛用字的雙重巧合仍會誤中;真 Stripe descriptor 落地時校準(選項:anchor+context 鄰接連語)。T6「誤標已消除」措辭偏強,以本檔為準:大幅縮小。

## 裁決記錄

1. auditLog 豁免(#4 + sandbox confirm):批准。依據:audit() 無 ctx.user 即靜默 no-op(假留痕),遞延表 matchMethod/notes/reversedAt 為實質追溯。條件:F2 派工單強制項 systemAudit()(LOCAL_SCRIPT_TOKEN 端點與 webhook 系統行為者留痕),defer/reverse/sandbox confirm 三處全接;sandbox confirm 執行輸出全文貼 progress.md。
2. Square 撥款雙計風險:採納執行者申報,進 F2 範圍(塊B/C 只蓋 Stripe,Square 若為 Checkout 處理商同款漏斗)。
3. sandbox 清理以謂詞取代派工單的「id 1-24」:追認,更安全的偏離。

## PENDING(v806 部署後)

1. sandbox 清理 dry-run → Jeff 點頭 → confirm(輸出貼 progress.md)。
2. 塊C 存量回填 dry-run → Jeff 點頭 → confirm。
3. F1 post-ship 走查六項(dispatch-f1.md)。

## F2 派工單必帶(彙總)

systemAudit() 三處全接、Square payout 對映與防雙計、Stripe 收入併表(payout 對映)、flag-ON 前置=P&L 接線(硬驗收)、部分退款遞延處理、isStripePayoutInflow descriptor 校準、CPA §17550 答覆落地、featureFlags 收口、損益卡缺 transfer/stripePayout 中性列的設計稿已修(B-final)照做。
