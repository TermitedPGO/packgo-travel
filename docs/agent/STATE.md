# 指揮交接檔(每批收尾由指揮更新,30 行封頂)
> 2026-07-09 by Fable
- prod:v806(2026-07-09 部署;閘6.5 SQL彩排首航 238/238;ship 後煙霧七臂指揮獨立重打全綠)。內含:Wave2 全案+cancel_booking P1 修復+F1 塊D/回爐三輪+observability 近7天口徑。判定檔:customer-cockpit/wave2-acceptance、finance-dept/f1-acceptance。
- F1 全案結案(2026-07-09 最終簽收):sandbox 清理 confirm 24帳戶+104交易、BofA 完好、指揮獨立複掃零殘渣;塊C 回填 no-op;走查六項過。追溯在 finance-dept/progress.md。
- 在飛:無。
- 等 Jeff:①存量回填 confirm 何時跑(53 筆 small_inflow 自動掛+聚合卡)②320 筆/$447,732 存量待認領分批處理 ③CPA §17550 問題 ④(可選)登入後補一張待認領截圖。
- soak 中:errorFunnel 48h(第一個自然錯誤要落卡)、SQL 彩排閘與 D1 新口徑下週一首驗。
- 鐵閘:STRIPE_TRUST_DEFERRAL_ENABLED 保持 OFF 直到 F2 P&L 接線;pnpm ship 只有 Jeff。
- 佇列:F2(Trust 合規結構化)→ F3(駕駛艙,藍本 design-proposals/B-final)→ F4(建議卡+省稅);硬化 Wave3(時間紀律);行程頁翻修(含地圖重做,保留狀態)。
- 慣例:執行者只讀自己的派工單;歷史在各 feature 的 archive/;本檔是唯一狀態源。
