# 指揮交接檔(每批收尾由指揮更新,30 行封頂)
> 2026-07-09 by Fable
- prod:v805(2026-07-09 部署,Wave1 觀測神經 + F1 對帳引擎 A/B/C)。
- main 未 ship 存貨:Wave2 SQL 彩排閘(本機 ship 即生效)+ observability 近7天口徑(要部署)+ F1 塊D/回爐 + 財務設計定稿文件。
- 在飛:Wave2 session(gmail-poll 清理[Jeff 已授權] + opsActions.ts:390 P1 修復 + 驗收 P3 九條);F1 驗收中(指揮)。
- 等 Jeff:sandbox 清理 dry-run 點頭、塊C 回填 dry-run 點頭、合批 ship、CPA §17550 問題。
- 鐵閘:STRIPE_TRUST_DEFERRAL_ENABLED 保持 OFF 直到 F2 P&L 接線;pnpm ship 只有 Jeff。
- 佇列:F2(Trust 合規結構化)→ F3(駕駛艙,藍本 design-proposals/B-final)→ F4(建議卡+省稅);硬化 Wave3(時間紀律);行程頁翻修(含地圖重做,保留狀態)。
- 慣例:執行者只讀自己的派工單;歷史在各 feature 的 archive/;本檔是唯一狀態源。
