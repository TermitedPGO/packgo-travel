# M5 — 客戶頁 UI

依賴:M3。對應 design.md §5。

## Checklist

- [ ] client/src/components/admin/customers/CustomOrderSheet.tsx
  - [ ] Sheet width `w-full xl:max-w-2xl xl:rounded-l-xl overflow-y-auto`(CLAUDE.md §2.5)
  - [ ] header(orderNumber + status pill + 客名 + 訂單切換/新建)
  - [ ] 金額摘要卡(總/訂/尾/已收;admin-only supplierCost+margin 標「不上客人文件」)
  - [ ] 報價區 / 催款區(訂金尾款 + Square 連結 + 寄催款 + 標記已收)/ 確認書區
  - [ ] 送出類動作 confirm dialog gate
  - [ ] 全走 trpc.customerOrders.*
- [ ] CustomerDetail.tsx:三顆 header 按鈕 alert() → 開 Sheet(focus 對應區)
- [ ] DetailTabs.tsx OrdersTab:加「訂製單」section(trpc.customerOrders.listForCustomer),點列開 Sheet
- [ ] i18n zh-TW.ts + en.ts:所有新字串,parity

## 紅線

- 圓角全到位(卡 rounded-xl、按鈕 rounded-lg、badge rounded-md)。
- 禁硬編中文,全 t()。
- 黑白極簡高密度(admin 設計系統)。
