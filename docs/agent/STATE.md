# 指揮交接檔(每批收尾由指揮更新,30 行封頂)
> 2026-07-09 by Fable
- prod:v805(2026-07-09 部署,Wave1 觀測神經 + F1 對帳引擎 A/B/C)。
- main 待 ship(=v806):Wave2 全案(SQL 彩排閘+cancel_booking P1 修復+P3 九條)+ F1 全案(塊D+回爐三輪)+ observability 近7天口徑 + 歸檔制度。兩案指揮驗收 PASS 收官(判定檔:customer-cockpit/wave2-acceptance、finance-dept/f1-acceptance)。
- 在飛:無(全線收官,等 ship)。
- 等 Jeff:ship v806;ship 後 sandbox 清理與塊C 回填兩個 dry-run 點頭 + F1 走查;CPA §17550 問題。
- 鐵閘:STRIPE_TRUST_DEFERRAL_ENABLED 保持 OFF 直到 F2 P&L 接線;pnpm ship 只有 Jeff。
- 佇列:F2(Trust 合規結構化)→ F3(駕駛艙,藍本 design-proposals/B-final)→ F4(建議卡+省稅);硬化 Wave3(時間紀律);行程頁翻修(含地圖重做,保留狀態)。
- 慣例:執行者只讀自己的派工單;歷史在各 feature 的 archive/;本檔是唯一狀態源。
