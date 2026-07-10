# F3 財務駕駛艙 指揮驗收判定(2026-07-10 凌晨,Fable)

> 受驗:branch finance-f3 五 commit(86c241b→1527c98→249cfe3→57ed6df→9d1e5f2),已 fast-forward 併入 main。
> 模式:閉環夜間衝刺(Jeff 裁定):指揮派 opus agent 執行,每塊三路 opus 對抗驗收,FAIL 即回爐,四塊三輪回爐後全數通過。

## 判定:F3 全案 PASS,收官

- 塊A 殼+真相列:回爐一輪(Trust 口徑 P1:totalOutstanding→matchedNotDeparted 三段拆分,等式錨定恆真式)。
- 塊B 工作區:一次過(認領對話框含搜尋逃生口、分類鎖 SCHEDULE_C_MAP 枚舉 client+server 雙鎖、認列/撤銷全 audit、aging LA 曆日)。
- 塊C 兩本帳:回爐一輪(P1 scope 不一致:trustDeferredList unscope 對齊 reconciliation;P2 月界:financeKpi 統一 LA 曆月;registry sql join 同步/退款帶號/截斷尾註)。
- 塊D 稅務頁+收官:回爐一輪(vendor1099List/plMonthlyTrend 補純函式單測、探針原文留檔、drift 負向文案、毛收入 KPI、transfer gross 副字、1099 毛額註)。
- 真數對比:15 格 prod 探真 vs 頁面計算全勾;指揮獨立抽核 pending(321/$448,022)命中;探針原文+node --check 證據在 progress.md 附錄。
- 最終數字:全套 328 檔 4838 tests 綠(獨立重跑核實)、tsc 0、i18n parity 0 缺 0 硬編碼、designLint 5 斷言鏈真檔。

## 裁決記錄

1. Trust 等式錨在「未認列合計=三段之和」恆真式,銀行餘額勾稽走 drift 誠實顯示(B-final 的餘額等式是 drift=0 特例)。
2. trustDeferredList unscope(對齊 trustReconciliation 的 2026-05-22 unscope 理由,adminProcedure 守門,終結 support@ 看 $0 雷)。
3. financeKpi 期間改 LA 曆月(修正性行為變更,消費者掃過全數受益)。
4. 認列按鈕保留全量掃描語義,文案誠實化「執行認列掃描」。
5. transfer tile 淨額主值+搬運 gross 副字;TaxDetail 營收 KPI=毛收入 Line 1;1099 毛額註明。
6. 待認領 tile 同源(引擎 dry_run)即真相:pending 由引擎定義,無第二真相源,獨立性由 F1 引擎驗收背書。

## 給 Jeff 的真實發現(晨報同步)

- prod 本月實況:虧損月(淨利 −$238.97,營收 $290),頁面誠實顯示。
- Trust drift −$10,442:信託帳戶現金($4,980)低於追蹤中的未認列訂金($15,422)。兩種可能:那三筆未對應訂金($8,908/$2,916/$3,598)實際走了別的帳戶從未進 #5442,或訂金曾被提前轉出。頁面已用方向感知文案標「需查核」。這是駕駛艙上線第一天就抓到的真合規問題,建議優先查。

## PENDING(ship 後)

1. prod 截圖與 B-final 並排視覺複核(本機 dev server 起不了,designLint 源碼級斷言已綠)。
2. listAutoLinked 卡片數 vs 手查 smoke(v807 走查項)。
3. F3 輸入需求③的撤銷 UI 深化(unlink tRPC 已建,對帳明細層入口待 F-later)。
