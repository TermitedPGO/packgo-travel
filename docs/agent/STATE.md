# 指揮交接檔(每批收尾由指揮更新,30 行封頂)
> 2026-07-10 by Fable
- prod:v808(2026-07-10 部署;F2 財務合規全案八 commit + migration 0114 經 release 套用;閘 6.5 SQL 彩排 238/238)。F2 內容:塊A systemAudit、塊B 認列閉環+轉帳偵測+看門狗、塊C Square 對映(不接自動分類+LLM 後衛 RATIFIED)、塊D flag 收口(P&L+稅表/財報/趨勢四口徑對稱、部分退款擋下轉人工、feature-flags.md)。指揮四輪驗收全 PASS;全套 338 檔 4958 測綠(ship 時)。
- v808 走查完:四項 PASS;真發現 PLAID 遞延 flag prod 實為 ON(既有,Jeff 裁決維持開,v808 認列加回即刻生效);看門狗首跑 7/13 週一 12:00 UTC(預期叫一次 drift 卡)。報告 finance-dept/v808-walkthrough-20260710.md。
- prod v809(R1-R3);試批已跑:16 團 live(25 進 9 被門檻擋),價格核對過、圖+署名齊,煙霧八臂全綠。待 ship v810:R4 必付真修(現 16 團費用區是舊解析,v810 後指揮重跑試批刷新)+ 分艙 Phase 0(STOREFRONT_MODE 旗標,OFF byte-identical,驗收 PASS 已併 main)。
- 分艙:藍圖 storefront-split/plan.md(四階段);Phase 0 完;Phase 1+ 等 Jeff 點頭域名(packgoplay.com=客人站/ops.packgoplay.com=後台)與開第二 Fly app;指揮已裁:同源反代寫入、分階段收緊唯讀、Redis 共用。P3 備忘:掃描守門前綴白名單擴充、upload-chat-image 收編。
- 外部 AI 交流:第一輪雙向存檔(external-exchange-round1*);八條採納進 BACKLOG;Jeff 裁分歧一=控團成本成立一半,下訂模式定型(驗位/請款時點)升線三硬前置。
- 供給裁決現況:Jeff 驗 16 團 → UV 全量與精選層並行案等最終點頭;貨架放量綁每單 Jeff 分鐘數量測。
- 基建改案(2026-07-10):Mac mini 延後;Windows 常駐工位(docs/infra/windows-resident-setup.md,等 Jeff 規格回報)+ MacBook 回家補課(iMessage 增量,Wave4 時實作)。
- 等 Jeff:①ship v808 ②裁決五題:TiDB 備份保留期查一眼/商品圖三選一(供應商圖-無圖-AI 生圖)/目錄重建 go/通道波次(0 內部合併→1 LINE→2 Meta→3 WeChat OA→4 iMessage 只收)/iMessage 桌面腳本裝否 ③Trust drift -$10,442 查核 ④321 筆/$448,022 分批認領節奏 ⑤CPA §17550;Square ACH HOLD ±$3,106 歸類看一眼。
- 鐵閘:兩遞延 flag 保持 OFF,翻 flag = Jeff 單獨裁決(前置與走查單在 finance-dept/feature-flags.md);pnpm ship 只有 Jeff;prod schema 只准 tracked migration 經 release_command。
- 佇列:F3-polish(Jeff 嫌棄清單)→ F4(建議卡+省稅);線二通道 Wave0 內部合併(candidate,等波次拍板);線三目錄重建(等圖片+go 裁決);硬化 Wave3。
- 慣例:執行者只讀自己的派工單;歷史在各 feature 的 archive/;本檔是唯一狀態源。
