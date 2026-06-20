# Admin Layout 骨架 — Design

> 從 prototype.html 驗證過的 pattern 搬進 React。這是第一塊積木，後面所有功能往裡面塞。

## 目標

把 AdminShell (sidebar) + page routing 擴充到完整 5 頁結構，匹配 prototype。

## Sidebar Nav (5 + 1)

| 順序 | icon | label | route | i18n key |
|------|------|-------|-------|----------|
| 1 | Home | 首頁 | /ops | admin.navHome |
| 2 | Users | 客人 | /ops/customers | admin.navCustomers |
| 3 | Map | 行程庫 | /ops/tours | admin.navTours |
| 4 | DollarSign | 財務 | /ops/finance | admin.navFinance |
| 5 | Megaphone | 行銷 | /ops/marketing | admin.navMarketing |
| --- | Settings | 設定 | /ops/settings | admin.navSettings |

## 檔案結構

```
client/src/
  layouts/
    AdminShell.tsx        ← 擴充 NAV array + 所有 icon
  pages/
    AdminHome.tsx         ← 已存在，不動
    AdminCustomers.tsx    ← placeholder
    AdminTours.tsx        ← placeholder  
    AdminFinance.tsx      ← placeholder
    AdminMarketing.tsx    ← placeholder
    AdminSettings.tsx     ← placeholder
  App.tsx                 ← 加 /ops/* nested routes
```

## Routing 方式

Wouter nested route：`/ops` 是 AdminShell，內部子路由 match path suffix。

```tsx
<Route path="/ops/:rest*">
  <AdminShell>
    <Route path="/ops" component={AdminHome} />
    <Route path="/ops/customers" component={AdminCustomers} />
    <Route path="/ops/tours" component={AdminTours} />
    <Route path="/ops/finance" component={AdminFinance} />
    <Route path="/ops/marketing" component={AdminMarketing} />
    <Route path="/ops/settings" component={AdminSettings} />
  </AdminShell>
</Route>
```

## Placeholder Page Pattern

每個 placeholder page 統一格式：page title + "建置中" 提示 + 連回 prototype 的開發 link。
讓 Jeff 可以在真的 app 裡點來點去，看到骨架已經搭好。

## 不做

- 不做任何資料 fetch（mock only）
- 不做響應式（Jeff MacBook 1440px only）
- 不碰現有 /workspace 或 /admin 路由
