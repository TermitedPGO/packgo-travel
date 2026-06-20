# 客人頁 (AdminCustomers) — Design

> 從 prototype.html 驗證過的客人頁搬進 React。這是後台日常用最多的頁面。

## 佈局

三欄 layout（全都在 `h-screen` 內，sidebar 已佔 56px）：

```
┌─────────┬──────────────────────────┬──────────┐
│ 客人列表  │  詳情區（tabs）            │ AI 助手   │
│ 300px    │  flex-1                  │ 340px    │
│          │                          │          │
│ [搜尋框]  │ [頭部：avatar+name+按鈕]   │ [對話]    │
│ [Entry]  │ [Tab: 概覽/帳務/文件/歷史]   │          │
│ [Entry]  │ [Tab content]            │ [輸入框]  │
│ [Entry]  │                          │          │
└─────────┴──────────────────────────┴──────────┘
```

## 分模組

| 模組 | 檔案 | 職責 |
|------|------|------|
| Page shell | `pages/AdminCustomers.tsx` | 三欄 layout + state（selectedId） |
| Customer list | `components/admin/customers/CustomerList.tsx` | 搜尋 + 列表 entries |
| Customer detail | `components/admin/customers/CustomerDetail.tsx` | 頭部 + tab bar + tab panels |
| AI side chat | `components/admin/customers/CustomerChat.tsx` | 右側 AI 助手 + drafts |
| Mock data | `components/admin/customers/mockData.ts` | 8 位客人（從 prototype 搬） |

## 資料模型（mock，後面接 tRPC）

```ts
type Customer = {
  id: number
  name: string
  email: string
  phone: string
  initials: string
  color: string       // avatar bg
  textColor: string   // avatar text
  lastContact: string
  tag: 'inquiry' | 'pending' | 'active'
  tagLabel: string
  notifs: number
  aiSummary: { wants: string; actions: string; delivered: string }
  status: {
    type: 'action' | 'warn' | 'good'
    title: string
    desc: string
    btn: string | null
    act: string
    checklist: { label: string; s: 'done' | 'pending' | 'missing' | 'muted' }[]
    bundle: { icon: string; type: string; name: string }[] | null
  }
  drafts: Draft[]
  profile: { passport: string; pref: string; totalSpend: number; trips: number; vip: boolean; lang: string; source: string }
  orders: Order[]
  docs: Doc[]
  timeline: TimelineEntry[]
}
```

## 第一版範圍（M1）

只做結構 + mock data + 靜態展示。不接 tRPC、不接真 AI。

- CustomerList: 搜尋框 + 8 位客人 entries + active 狀態 + notification badge
- CustomerDetail 概覽 tab: AI summary card + status banner + checklist + profile strip
- CustomerDetail 帳務/文件/歷史 tabs: 靜態 render
- CustomerChat: 顯示 drafts（寄出按鈕 alert）+ 輸入框（mock echo）

## 不做（M2+）

- tRPC 接資料庫
- 真正的 AI 對話（接 invokeLLM）
- Email/微信/SMS 發送
- 檔案上傳/下載
- Drag & drop 排序
