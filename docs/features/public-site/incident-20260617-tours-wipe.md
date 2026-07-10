# 事故報告:2026-06-17 tours 等七表清空(2026-07-10 發現,Fable)

## 事實(prod 唯讀探真,三方證據)

- 空表(COUNT=0 且 Auto_increment=0,即此表身被重建後從未寫入):tours、bookings、payments、tourDepartures、tourReviews、catalogBatches、toursCatalogArchive。
- 完好:supplierProducts 7,600、supplierProductDetails 6,007、customerProfiles 178、customOrders(真實業務)、users 3、inquiries、trustDeferredIncome、bankTransactions 等。
- 時間鎖定:tours 與兩張全新表(catalogBatches/toursCatalogArchive)的 create_time 同一秒 = 2026-06-17 21:47:09 UTC(LA 14:47)。
- 未走正規流程:__drizzle_migrations 最後一筆在 20 小時前;adminAuditLog(332 筆完整)自 05-27 後零 tour 相關動作。app 內所有會動 tours 的 mutation 都有留痕,查無。
- 同日旁證:gmail-poll 33 筆失敗(16:10-21:30 UTC,gmailIntegrations 查詢失敗)與 DDL 窗口重合 — 上週清掉的那批歷史 failed 正是本事故的另一個症狀;0097 migration(catalogBatches+toursCatalogArchive+tours.batchId)當日 commit(f182ee7)。

## 判讀(假說,無法百分百坐實執行者與指令)

開發目錄重抓 chunk-1 時,對 prod DATABASE_URL 直接執行了 drizzle-kit push 或手動 DDL(非 release_command 的 tracked migration),過程 drop+recreate 了 tours 與關聯表。5,640 團(含日本 1,205 已上架)連同表身消失;此後三週 promoteBatch pipeline 從未在 prod 觸發(catalogBatches=0),賣場持續零團,無任何告警(當時觀測神經尚未建成;今日的 deploySmoke/errorFunnel 也未覆蓋「對客商品數」這個信號)。

## 損失評估

- 確定損失:策展層 tours 5,640 筆(含 enrichment 落在 tours 的部分:翻譯/改寫/圖ates 需重跑,llmCache 或可省部分)、tourDepartures/tourReviews。
- 待 Jeff 確認:bookings/payments 是否曾有真客人資料(既有記錄顯示真實業務走 customOrders,bookings 疑似僅測試資料且 5/17 已批刪;若曾有真單,此為客戶資料損失,等級升高)。
- 供應商鏡像層完好 → 可重建。

## 復原路徑

1. [Jeff 立即] TiDB Cloud 控制台查備份/PITR 保留期。事故已 23 天,大概率超出保留窗,但值得一分鐘確認;若有 6-17 前備份,策展層可直接撈回。
2. [主路徑] 目錄重建:catalogRebuild pipeline(staging→completeness 門檻→promote,含快照可回滾)正是為此而建且從未跑過。從 supplierProducts 鏡像重建 → 校準 → 分批 promote,日本區先行。需出重建計畫(批次大小、LLM 成本估算、品質門檻)= 線三新首項。
3. 觀測補課:deploySmoke 加第八臂「對客 active tours > 0」,賣場歸零永不再無聲(進下一批)。

## 預防(制度化,待寫進 CLAUDE.md 紅線)

prod 資料庫的 schema 變更只准經 tracked migration 由 release_command 執行;任何 session/人對 prod 跑 drizzle-kit push、手動 DDL = 違規。本地開發用本地/staging 庫,嚴禁把 prod DATABASE_URL 放進本地 env。
