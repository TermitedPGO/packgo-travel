# 指揮交接檔(每批收尾由指揮更新,30 行封頂)
> 2026-07-11 by Fable
- prod:v810(R4 必付真修 + 分艙 Phase 0 + 臨時停止線)。v808=F2 財務合規全案(四輪驗收 PASS);v809=線三重建前置 R1-R3。
- 線三現況:試批 16 團 live 且已用 v810 刷新(updatedAt 核實;25 進 9 被門檻正確擋),等 Jeff 驗貨 → UV 全量約 475 + 首頁精選層;雄獅橋接已修好待試批。checkout-verify 大批(UV 結帳前即時驗位驗價 + 付款前揭露存證,migration 0116 預授權)施工中,完成後 v811 恢復「驗證通過才可訂」;現按鈕=提交訂位需求,伺服器 fail-closed 擋 tour 即時收款(flag TOUR_INSTANT_CHECKOUT_ENABLED 預設 OFF)。
- 分艙:plan.md 四階段;Phase 0 完(OFF byte-identical);Phase 1+ 等 Jeff 點頭域名(packgoplay.com=客人站/ops.packgoplay.com=後台)+ 開第二 Fly app。指揮已裁:同源反代寫入/分階段收緊唯讀/Redis 共用。P3 備忘:掃描守門前綴擴充、upload-chat-image 收編。
- 外部 AI 交流:兩輪存檔(external-exchange-round1/2*),分歧歸零。重要採納:交易三模式(即時可訂/授權後確認/詢位制,按供應商能力)、可展示/可索引/可收款三態(稀疏頁 noindex)、DB 硬化驗收規格(實測 DDL 被拒/真實還原演練/RPO-RTO)、郵件放權分層樣本、容量指標組(北極星=每小時 Jeff 稀缺時間貢獻毛利)、「證據就緒等 Jeff」佇列限流。
- 財務:v808 走查四項 PASS;PLAID 遞延 flag prod 實為 ON(Jeff 裁決維持,認列加回已生效);STRIPE flag 保持 OFF;看門狗首跑 7/13 週一 12:00 UTC(預期叫一次 drift 卡)。F4 省稅顧問凍結至 CPA 矩陣+差異查核完成。
- 等 Jeff:①驗貨 16 團(主閘,點頭放 UV 全量)②分艙域名點頭 ③TiDB 備份保留期看一眼 ④通道波次點頭 ⑤Windows 規格三個數 ⑥Trust drift 六桶查核結果(指揮跑)後的處置 ⑦321 筆分批認領節奏 ⑧CPA 判斷矩陣送出。
- 待指揮(預授權,依序):checkout-verify 驗收 → DB 權限隔離+還原演練批(驗收規格照 round2 第六節)→ 信託差異六桶查核 → 雄獅試批 → 行程頁翻修+路線圖設計提案(多引擎競比,Codex 參賽)。
- 鐵閘:pnpm ship 只有 Jeff;AI 不動錢;prod schema 只准 tracked migration;供應商成本/圖不上客面。
- 慣例:執行者只讀自己的派工單;歷史在各 feature archive/;本檔是唯一狀態源。
