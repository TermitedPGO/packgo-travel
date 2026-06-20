# M2: 客人時間軸 API

> 零件二。新 tRPC router `server/routers/customerTimeline.ts`，統一查詢一個客人的所有互動。

## Checklist

- [ ] `getTimeline` — 統一時間軸
  - input: `{ profileId: number, limit?: number (default 30), cursor?: string }`
  - 6 個資料來源合併：
    1. `customerInteractions`（email 來往，帶 direction）
    2. `inquiries`（經 customerEmail 關聯到 profile）
    3. `customerDocuments`（報價單、護照、簽證文件）
    4. `bookings`（訂單建立，經 userId 或 customerEmail 關聯）
    5. `payments`（付款記錄，經 bookingId 再關聯）
    6. `customerChatMessages`（AI 聊天記錄）
  - 每筆事件統一格式：`{ id, type, timestamp, title, detail?, metadata? }`
  - 按 timestamp DESC 排序
  - cursor-based 分頁（用 timestamp + id 組合做 cursor）

- [ ] `getCustomerOrders` — 客人訂單摘要
  - input: `{ profileId: number }`
  - 查該客人所有 bookings + 每筆的 payments sum
  - output: `{ orders: [{ id, tourTitle, departureDate, pax, totalPrice, paidAmount, status }] }`

- [ ] `getCustomerFiles` — 客人檔案列表
  - input: `{ profileId: number }`
  - 查 `customerDocuments` where customerProfileId
  - output: `{ files: [{ id, fileName, fileType, fileUrl, uploadedAt }] }`

- [ ] `uploadCustomerFile` — 上傳檔案到客人名下
  - input: `{ profileId: number, fileName: string, fileUrl: string, fileType: string }`
  - 寫一筆 `customerDocuments`
  - 檔案本身走 R2 presigned URL（前端直傳），這裡只存 metadata

- [ ] 寫 Vitest 測試 `server/routers/customerTimeline.test.ts`
- [ ] tsc --noEmit 0 errors

## 技術決策

- **不用 UNION ALL**（各 table schema 差太多）。改用 6 個獨立 query，server 端 merge sort。
- Cursor 格式：`"{timestamp_ms}_{type}_{id}"`，decode 後用 WHERE timestamp < ? 分頁。
- 客人關聯方式：profileId → customerProfiles.email → 關聯 inquiries.customerEmail / bookings (via users.email)

## 依賴

- 需要確認 customerProfiles → bookings 的關聯路徑（可能需要 join users table）
- 不需新 migration

## 不做

- 不做前端 UI
- 不做 WebSocket 即時更新
