# 還原演練 runbook（TiDB Cloud 備份還原到隔離 cluster）

> 批次：DB 硬化批。日期：2026-07-12。
> **狀態：runbook 已撰寫,待 Jeff 執行。** 本批未執行任何還原,絕不宣稱還原成功。
> 狀態階梯:runbook已撰寫(本檔) → 環境已準備 → 還原已執行 → 勾稽已完成 → RPO/RTO已實測 → 演練已結案。本批只到第一階。

上游動機:2026-06-17 tours 清空事故發生時,沒有人知道「備份保留多久、還原要多久、還原回來的資料對不對」。這份 runbook 把這三個未知數變成可演練、可記錄的流程。控制有效性要靠演練證明,不是靠「我們有備份」這句話。

---

## 一、前置:確認備份能力（查官方文件 + console 唯讀）

TiDB Cloud Serverless（本專案 `packgo-travel` 用的 v8.5.3-serverless）的備份/還原走 console。Jeff 先在 TiDB Cloud console 確認:

1. **自動備份保留窗**:cluster → Backup 頁,看 automatic backup 的保留天數(Serverless 通常有預設保留窗)與最舊可還原時間點。
2. **PITR（Point-in-time Recovery）是否可用**:若可用,記下可還原的時間範圍(這決定 RPO 下限)。
3. **還原目標**:TiDB Cloud 的還原是「還原成一個新 cluster」(或新 branch),不是原地覆蓋。這剛好符合「隔離 cluster」要求 —— 還原出來的東西跟正式 `packgo-travel` 完全隔離,勾稽完再決定要不要撈資料回去。

> 官方文件關鍵字(Jeff 查證用):TiDB Cloud「Back Up and Restore TiDB Cloud Serverless Data」、「Restore to a new cluster」、「Point-in-time Recovery」。實際 UI 步驟以 console 當下為準,不在此寫死(避免文件陳跡)。

---

## 二、演練步驟

### 2.1 觸發還原到隔離 cluster

1. console → `packgo-travel` → Backup。
2. 選一個備份點(或 PITR 時間點),**Restore 成一個新 cluster**,命名如 `packgo-restore-drill-<YYYYMMDD>`。
3. 記錄:所選備份點的時間戳 `T_backup`、按下還原的時間 `T_start`。
4. 等還原完成,記錄完成時間 `T_ready`。**RTO ≈ T_ready − T_start**。

### 2.2 取還原 cluster 的唯讀連線

還原完成後,console 給新 cluster 一組連線資訊。用**唯讀**方式連(勾稽只讀,不寫):

```bash
# 用 mysql client 或既有的 flyctl ssh + node 一次性探針(比照 scripts/ 的唯讀探針模式)。
# 連的是「還原出來的隔離 cluster」,不是正式 packgo-travel。
```

### 2.3 勾稽（還原後資料對不對）

對還原 cluster 跑以下唯讀勾稽,對照正式 cluster 的同一批數字(正式那邊也只跑唯讀 COUNT)：

```sql
-- 勾稽 A:16 張災難級表都在,且行數合理(對照 schemaContract 的 REQUIRED_TABLES)
SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'test'
  AND TABLE_NAME IN (
    'tours','bookings','payments','tourDepartures','tourReviews',
    'catalogBatches','toursCatalogArchive','customerProfiles','customOrders',
    'users','inquiries','trustDeferredIncome','bankTransactions',
    '__drizzle_migrations','supplierProducts','supplierProductDetails'
  )
ORDER BY TABLE_NAME;

-- 勾稽 B:精確行數(TABLE_ROWS 是估算,關鍵表用真 COUNT)
SELECT
  (SELECT COUNT(*) FROM test.customerProfiles)     AS customerProfiles,
  (SELECT COUNT(*) FROM test.customOrders)         AS customOrders,
  (SELECT COUNT(*) FROM test.trustDeferredIncome)  AS trustDeferredIncome,
  (SELECT COUNT(*) FROM test.bankTransactions)     AS bankTransactions,
  (SELECT COUNT(*) FROM test.supplierProducts)     AS supplierProducts,
  (SELECT COUNT(*) FROM test.__drizzle_migrations) AS migrations;

-- 勾稽 C:migration 進度一致(還原點的 migration 數 vs 正式當下)
SELECT COUNT(*) AS applied, MAX(created_at) AS latest FROM test.__drizzle_migrations;

-- 勾稽 D:財務紅線抽驗(信託遞延未認列筆數,對照正式)
SELECT COUNT(*) AS unrecognized
FROM test.trustDeferredIncome
WHERE recognizedAt IS NULL;
```

判定:還原 cluster 的數字與正式當下**同量級且合理**(允許 T_backup 到現在的正常增量差),才算勾稽通過。任何關鍵表在還原 cluster 為 0 或遠低於正式 = 還原有問題,不結案。

### 2.4 記錄 RPO/RTO

| 指標 | 定義 | 本次實測 |
|------|------|----------|
| RPO（可容忍資料遺失窗）| 最近可還原點到「事故發生時刻」的最大間隔 = `now − T_backup`(或 PITR 粒度) | ____（待實測填）|
| RTO（還原耗時）| `T_ready − T_start` | ____（待實測填）|
| 備份保留窗 | console 顯示的最舊可還原時間到現在 | ____（待實測填）|
| 勾稽結果 | A/B/C/D 是否全通過 | ____（待實測填）|

### 2.5 收尾

- 勾稽通過後,還原 cluster **暫留**(不立即刪),供事故時真的撈資料回去。演練場景可在記錄完 RPO/RTO 後刪除隔離 cluster(避免長期計費)。
- **刪除隔離 cluster = 破壞性操作,由 Jeff 手動在 console 執行**,本 runbook 不代刪、不自動化。

---

## 三、兩個偵測情境（演練要能抓到這兩類事故）

還原能力只是一半;另一半是「壞了要有人知道」。這兩個情境對照既有觀測神經,補齊還原演練要驗的偵測點:

### 情境 1:部分刪除（像 2026-06-17,某幾張表被清空,不是整庫掛掉）

- **偵測**:`/health` 的 `schema` 子檢查 + deploySmoke 第九臂 `schemaContract`(本批新建)。任一必要表被 DROP/清空重建 → `/health` 降級 503,UptimeRobot 告警;ship 後煙霧第九臂標紅列出缺哪張。事故當下賣場對客團數歸零另有 `activeToursCount` 臂顧。
- **演練驗證**:在**還原 cluster**(不是正式)上,由有 DDL 權限的身分 DROP 一張非關鍵表,對還原 cluster 跑 `assertSchemaContract` 等價查詢,確認 missing 清單抓得到。驗完該 cluster 直接丟棄。
- **RPO/RTO 對應**:確認從偵測到告警、到能還原回被刪的表,總時間在可接受範圍。

### 情境 2:單一供應商停更（供給鏡像層某來源靜默斷更,資料沒被刪但變陳舊）

- **偵測缺口**:目前 schema 契約只驗「表在不在」,不驗「表夠不夠新」。單一供應商(如某個 LionTravel 來源)停更,`supplierProducts` 表還在、schemaContract 綠,但該來源的資料凍在某天。
- **演練驗證(唯讀勾稽,可對正式跑)**:
  ```sql
  -- 每個來源的最新更新時間;某來源遠落後 = 疑似停更
  SELECT source, COUNT(*) AS n, MAX(updatedAt) AS freshest
  FROM test.supplierProducts
  GROUP BY source
  ORDER BY freshest ASC;
  ```
  某 source 的 `freshest` 明顯落後其他 source(例如落後 > N 天)= 疑似該供應商停更。
- **建議後續(非本批)**:把「每來源最新更新時間」做成一條觀測信號(deploySmoke 加臂或週稽核),讓單供應商停更也有告警。此為 follow-up,列 progress。

---

## 四、狀態聲明

本 runbook 已撰寫完成。**尚未執行任何還原、尚未取得 RPO/RTO 實測值、尚未勾稽。** 表格內 `____` 待 Jeff 實跑後回填。演練結案(六階全綠)前,不得對外宣稱「還原能力已驗證」。
