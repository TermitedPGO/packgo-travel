# M3: OpsAgent 工具層擴展

> 零件三。擴展 `server/agents/autonomous/opsTools.ts` 從 9 → ~25 工具。

## 現有 9 工具（保留不動）

1. count_records
2. aggregate_departures
3. search_tours
4. search_departures
5. search_bookings
6. search_customers
7. get_finance_summary
8. list_missing_receipts
9. search_supplier_inventory

## 新增：查詢工具（直接執行）

- [ ] `get_customer_timeline` — 取客人完整時間軸
  - 調用 m2 的 customerTimeline.getTimeline
  - 參數：customerName 或 email（先 search_customers 找 profileId）

- [ ] `get_customer_orders` — 取客人訂單+付款
  - 調用 m2 的 customerTimeline.getCustomerOrders

- [ ] `get_tour_availability` — 查即時餘位
  - UV: 調用 uvClient.getProductGroup(tourCode)
  - Lion: 調用 lionClient 查詢
  - 回傳：有位/有限/已滿 + 剩餘數

- [ ] `get_tour_pricing` — 查供應商直客價（注意：直客價可回傳，同業價/agentPrice 絕對不能回傳）
  - UV: uvClient.getProductTravelDetail
  - Lion: lionClient 價格查詢
  - 只回傳直客價（retail price），不回傳 agentPrice

- [ ] `get_dashboard_summary` — 今日待辦+財務+行程+agent 狀態
  - 調用 m1 的 dashboard 4 個 query
  - 濃縮成一段文字給 AI 做 context

- [ ] `get_departure_details` — 出發團詳情
  - 旅客名單（bookingParticipants via departureId）
  - 付款狀態
  - 特殊需求

## 新增：操作工具（需確認 [REQUIRES_CONFIRMATION]）

- [ ] `update_tour_status` — 上架/下架行程
  - 參數：tourId, newStatus (active/inactive)
  - 寫 audit log

- [ ] `delete_test_data` — 刪除假資料
  - 調用 adminCleanup 現有 mutations
  - dryRun 先顯示影響範圍

- [ ] `trigger_supplier_sync` — 手動觸發供應商同步
  - 調用 supplierSync 的 importAll 或 per-supplier import
  - 回傳：開始同步，預計 X 分鐘

- [ ] `confirm_payment` — 確認收款
  - 參數：bookingId, amount
  - 寫 payment record + 更新 booking status

- [ ] `send_departure_reminder` — 發出發前提醒
  - 參數：departureId
  - 觸發 preDepartureNotifications 邏輯

- [ ] `archive_customer` — 歸檔客人
  - 參數：profileId
  - 標記 isArchived（需確認是否要加欄位）

## 新增：文件生成工具（需確認）

- [ ] `generate_quote` — 生成報價單 PDF
  - 調用 skills/dispatcher → packgo-quote
  - 依賴 m4（skill port）完成
  - 參數：customerName, tourId/tourInfo, pax, price

- [ ] `generate_flight_ticket` — 生成機票確認單
  - 調用 packgo-flight-ticket skill
  - 依賴 skill port

- [ ] `draft_reply` — 草擬客人回覆
  - 直接用 LLM 生成（不需 skill）
  - 參數：customerContext, replyIntent
  - 回傳草稿文字，Jeff 確認後再寄

- [ ] `compare_tours` — 行程比較
  - 調用 packgo-tour-comparison skill（已 port）
  - 參數：region, filters

## System Prompt 更新

- [ ] 更新 `opsAgent.ts` system prompt
  - 明確區分 directTools vs confirmTools
  - 查詢類：直接調用，不需確認
  - 操作/文件類：先描述將要做什麼 + 影響範圍，等 Jeff 說「好」「做」「確認」才執行
  - 加入客人 context 感知（在客人頁的 AI 聊天自動帶入 profileId）

## 測試

- [ ] 寫 Vitest 測試 `server/agents/autonomous/opsTools.test.ts`
- [ ] 測試確認機制（mock 對話驗證 AI 不會跳過確認）
- [ ] tsc --noEmit 0 errors

## 依賴

- 依賴 m1（dashboard API）：get_dashboard_summary 工具需要
- 依賴 m2（timeline API）：get_customer_timeline / get_customer_orders 工具需要
- 依賴 m4（skill port）：generate_quote / generate_flight_ticket 工具需要（可先 stub）

## 不做

- 不做前端 UI
- agentPrice / 同業價絕對不透過任何工具回傳
