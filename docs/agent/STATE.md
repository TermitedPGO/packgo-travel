# 指揮交接檔(每批收尾由指揮更新,30 行封頂)
> 2026-07-10 by Fable
- prod:v807(2026-07-10 部署;F3 財務駕駛艙 /ops/finance + 月報 tab;15 格 prod 真數對比全勾)。判定檔:finance-dept/f3-acceptance-20260710.md。
- F2 財務合規全案結案(2026-07-10,閉環八 commit d6c5394→6fa8d88,已併 main 待 ship v808):塊A systemAudit 四接線、塊B 認列閉環(migration 0114+轉帳偵測+看門狗+§17550)、塊C Square 對映(不接自動分類裁定+LLM 後衛 RATIFIED)、塊D flag 收口(P&L+稅表/財報/趨勢四口徑對稱接線、部分退款擋下轉人工、feature-flags.md 清點)。指揮四輪驗收(塊際三路×2+收官兩路+補丁單路)全 PASS;全套 338 檔 4954 測綠。
- v808 內含 migration 0114(trustDeferredIncome 加 transferredAt/transferBankTransactionId,release_command 自動跑,有 down)。
- ship 後走查(指揮辦):D1 看門狗首跑(watchdog 首叫 drift 一次)、trust-transfer-detect dry_run、square 謂詞對 prod 19 筆命中率、flag OFF 探針、feature-flags.md 走查單 2b 四口徑同數。
- 在飛:無(等 Jeff ship v808)。
- 等 Jeff:①ship v808 ②裁決五題:TiDB 備份保留期查一眼/商品圖三選一(供應商圖-無圖-AI 生圖)/目錄重建 go/通道波次(0 內部合併→1 LINE→2 Meta→3 WeChat OA→4 iMessage 只收)/iMessage 桌面腳本裝否 ③Trust drift -$10,442 查核 ④321 筆/$448,022 分批認領節奏 ⑤CPA §17550;Square ACH HOLD ±$3,106 歸類看一眼。
- 鐵閘:兩遞延 flag 保持 OFF,翻 flag = Jeff 單獨裁決(前置與走查單在 finance-dept/feature-flags.md);pnpm ship 只有 Jeff;prod schema 只准 tracked migration 經 release_command。
- 佇列:F3-polish(Jeff 嫌棄清單)→ F4(建議卡+省稅);線二通道 Wave0 內部合併(candidate,等波次拍板);線三目錄重建(等圖片+go 裁決);硬化 Wave3。
- 慣例:執行者只讀自己的派工單;歷史在各 feature 的 archive/;本檔是唯一狀態源。
