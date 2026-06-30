# m4 — ProjectBar UI(標題列下方一排)

目標:客人名字 + 真相條下一排專案 chips,驅動詳情 + 聊天;雙擊改名。依賴 m1/m2。

## Checklist
- [ ] AdminCustomers.tsx:`activeProjectId` page state;切客人重設為預設(最新專案,無單→null=未分類)
- [ ] 新 client/src/components/admin/customers/ProjectBar.tsx
  - [ ] chips:專案新到舊(departureDate ?? createdAt)在左,`未分類` 虛線 chip 釘最右
  - [ ] active = bg-gray-900 text-white;其餘 border-gray-300;rounded-md(§2.1);text-[11px];黑白
  - [ ] orderNumber 灰小前綴 + title;hover 顯示日期;橫向可捲
  - [ ] 雙擊 active 專案 chip → inline input(rounded-lg)→ Enter/blur 呼 `customerOrders.update({orderId,title})`;空字串擋;Esc 取消;未分類不可改名
  - [ ] 改名 onSuccess invalidate listForCustomer + customerDetail
- [ ] CustomerDetail.tsx:收 activeProjectId + onSelectProject + onRenameProject,渲染 ProjectBar 於真相條下
- [ ] CustomerChat.tsx:收 activeProjectId(m2 已接 send/hydrate)
- [ ] i18n:`未分類`、改名相關文案 → zh-TW + en

## test
- [ ] adapters/ProjectBar:chip 排序、預設選最新、無單→未分類、切客人 reset

## 驗收
- 切 chip → 中間總覽脈絡 + 右聊天線同步換;雙擊改名即時反映。
