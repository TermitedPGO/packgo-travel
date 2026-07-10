# 指揮交接檔(每批收尾由指揮更新,30 行封頂)
> 2026-07-09 by Fable
- prod:v806(2026-07-09 部署;閘6.5 SQL彩排首航 238/238;ship 後煙霧七臂指揮獨立重打全綠)。內含:Wave2 全案+cancel_booking P1 修復+F1 塊D/回爐三輪+observability 近7天口徑。判定檔:customer-cockpit/wave2-acceptance、finance-dept/f1-acceptance。
- 在飛:F1 session 收尾(兩個 dry-run → Jeff 點頭 → confirm + F1 走查六項)。
- 等 Jeff:dry-run 數字點頭;CPA §17550 問題;errorFunnel 48h soak 期間留意 inbox 卡。
- 鐵閘:STRIPE_TRUST_DEFERRAL_ENABLED 保持 OFF 直到 F2 P&L 接線;pnpm ship 只有 Jeff。
- 佇列:F2(Trust 合規結構化)→ F3(駕駛艙,藍本 design-proposals/B-final)→ F4(建議卡+省稅);硬化 Wave3(時間紀律);行程頁翻修(含地圖重做,保留狀態)。
- 慣例:執行者只讀自己的派工單;歷史在各 feature 的 archive/;本檔是唯一狀態源。
