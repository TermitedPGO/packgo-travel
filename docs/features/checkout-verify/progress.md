# checkout-verify — progress

> 監工看這份。回寫實際狀態,不寫期望狀態。

## 2026-07-10 · 先行 commit(臨時停止線)

- `d212294`(branch checkout-verify,已由指揮合進 main,隨 v810 上線):
  旗標 `TOUR_INSTANT_CHECKOUT_ENABLED`(預設 OFF=全擋)+ 行程頁購買按鈕轉「提交訂位需求」(InquiryMode reserve)。

## 2026-07-11 · batch-1(模式一「即時驗證後請款」+ 揭露存證)

- 已合 main 最新(79c2f1c)再施工;無衝突。
- 交付:`checkoutDisclosures` 表(migration 0116 + down + journal)、`server/services/checkoutVerification/`(5 模組)、
  `createCheckoutSession` 驗證+存證接線、webhook 蓋章、BookingDetail 詢位 fallback、觀測 log。
- 驗證:tsc 0 錯(NODE_OPTIONS=6144);相關測試兩輪綠(第二輪 14 檔 163 passed / 24 skipped DB-gated);
  新錢路測試連跑 5 次穩;coverage.test.ts / migrationJournal / migrationBreakpoint / i18n parity 綠。
- 狀態:code 進 checkout-verify 分支,未合 main、未部署。
- 已知限制(詳 batch-1 完工報告):
  1. booking.totalPrice < 現行 gross(如供應商漲價後的舊單)不擋只記錄(Packpoint 折抵同 pattern 無法區分);
  2. 尾款不重驗 live(vendor_confirmed 即成約價);
  3. business-logic.test.ts 的 DB-gated checkout 測試在有 DATABASE_URL 環境會寫一列 disclosure(綁測試 booking,同檔既有 bookings.create 寫入 pattern);
  4. 模式二/三、三態商品狀態不在本批。
- 待 Jeff:merge 裁決、部署後 0116 落表驗證(Rule 3)、旗標開啟時機。
