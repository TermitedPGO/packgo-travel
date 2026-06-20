# M1: Dashboard 聚合 API

> 零件一。新 tRPC router `server/routers/dashboard.ts`，提供首頁四張卡片的數據。

## Checklist

- [ ] `getTodayActions` — 今日待辦清單
  - 未回覆詢問（inquiries status=new/in_progress，超過 24hr 標緊急）
  - 待確認訂單（bookings status=pending）
  - 待收款（bookings 已確認但 paid < total，超過 7 天標重要）
  - 今日/明日出發提醒（departures within 48hr）
  - 系統錯誤（最近 24hr agent 失敗）
  - 每項帶 priority（urgent/important/normal）、type、targetId（可跳轉）
  - 按 priority + 時間排序

- [ ] `getFinanceSummary` — 財務摘要
  - 本月營收（payments sum where status=completed, this month）
  - 待收款總額（bookings confirmed - payments completed）
  - Trust 餘額 / Operating 餘額（從 bankTransactions 或 accountingEntries）
  - 上月同期比較（optional，有就加）

- [ ] `getToursOverview` — 行程總覽
  - 上架行程數（tours status=active）
  - 按區域分布（GROUP BY destinationCountry 前 5 名）
  - 近期最多人訂的行程 top 3

- [ ] `getAgentStatus` — Agent 狀態
  - InquiryAgent：今日處理數（agentMessages where agentName like '%inquiry%', today）
  - OpsAgent：今日對話數（agentMessages where agentName='ops', today）
  - 供應商同步：最後同步時間 + 狀態（從 supplierSyncRuns 或 tourMonitorLogs）
  - 失敗數（最近 24hr agent errors）

- [ ] 寫 Vitest 測試 `server/routers/dashboard.test.ts`
- [ ] tsc --noEmit 0 errors

## 依賴

- 無外部依賴，純 DB 查詢
- 現有 table 全部夠用，不需新 migration

## 不做

- 不做前端 UI（那是組裝階段）
- 不做即時推送（先用 polling）
