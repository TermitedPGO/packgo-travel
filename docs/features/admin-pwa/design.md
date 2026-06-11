# 後台 PWA (design)

> 先讀 proposal.md(phase 表與架構決策)。本檔 = 各 phase 的實作設計。動工前每 phase 再開 `tasks/p<N>-*.md`。
> **視覺規格**:`/Users/jeff/Desktop/PackGo_示意圖/手機/後台_01_工作台手機殼.html`(2026-06-10 畫,5 張:今日待辦/抽屜/客戶 inbox/AI 對話卡片/記帳滑卡,卡片文法與桌面 ws-ui 同一套)。

## P1 workspace 手機殼

**目標**:手機開 `/workspace` 不跑版,今日待辦 + 客戶 inbox 能看能點。畫面照視覺規格 ①②③。

改動面(兩檔為主):

| 檔 | 現狀 | 改法 |
|----|------|------|
| `client/src/pages/Workspace.tsx` | `h-screen flex` + sidebar `w-[248px] flex-shrink-0` 寫死 | `<md`:sidebar 隱藏,改頂部 bar(高 56px:≡ 鈕 + 頁名 + 必要 badge),≡ 開全幅抽屜;`md+` 維持現狀 |
| `client/src/components/workspace/WorkspaceSidebar.tsx` | 桌面固定欄 | 內容重用,包進抽屜容器(overlay + `fixed inset-y-0 left-0` 滑入);選單項點擊區 ≥44px |

- 抽屜模式抄 `client/src/components/mobile/MobileMenuDrawer.tsx` 既有寫法,不新發明。
- safe-area:`env(safe-area-inset-top/bottom)` 進殼層 padding。
- retrofit 已上線面:WorkspaceToday、CustomerInbox、CustomerChat、WorkspaceCompany 四面過 360/390/430 三寬(重點:卡片 `w-full min-w-0`、長字 truncate、動作列 wrap、輸入 `text-base`)。
- ws-ui primitives(`card.tsx` / `layout.tsx` / `chips.tsx`)在這一步加好流動寬度,之後批3-8 自動繼承。

**驗證**:tsc 0 err + 純函式 Vitest(抽屜開合 state)+ 三寬截圖盡力;workspace 有登入牆,最終 Jeff prod 親驗(批1 已誠實記錄此限制,雙層驗收)。

## P2 批3-8 手機驗收內建(規則,非獨立工作)

- 已寫進 `redesign-39.md`「手機驗收規則」段:每批 DoD + 三寬截圖 + 單欄無橫向捲動 + ≥44px + 輸入 ≥16px。
- 表格類頁面(批3 帳本、批6 訂單列表)本來就要照設計治理卡片化;卡片化 = 手機化,不另做手機版表格。
- re-home 對照(不重寫,搬家):

| 既有手機元件 | 去處 | 批 |
|--------------|------|----|
| BankTriagePage(滑動分類) | 財務頁記帳的手機卡片視圖 | 批3 |
| ReceiptCameraFAB | workspace 殼層 FAB | 批3 |
| DailyCheckMobile | 內容已被今日待辦吸收,確認無遺漏後退役 | 批1 已上線,P1 時核對 |
| GlobalSearchSheet | workspace 頂部 bar 搜尋入口 | P1 或批6 |

## P3 chat 結構化卡片(原 Slice 3)

- **後端**:OpsAgent 回傳結構化區塊(card/action 描述,非純 markdown)。批2 m3 已把 actions/cards 持久化(不渲染),這裡接上渲染,等於做完同一件事的後半。
- **前端**:renderer 以 `client/src/components/workspace/ws-ui/` 為卡片層;chat 內嵌卡與 workspace 頁面卡同一份代碼。
- 紅線:碰錢動作(報價/退款)在卡片上只到「過目層」,執行仍走既有確認流程。
- LARGE 級,**Jeff 指了才動**。

## P4 PWA polish

- `client/public/manifest.json`:`theme_color` #0D9488 → `#000000`(全站共用,客人版 PWA 同步變黑,與黑白語言一致;commit message 註明雙軌變更)。
- maskable icon 核對:`icon-512-maskable.png` 實際留白是否合格(maskable.app 檢查)。
- install 入口:main.tsx 已 captureInstallPrompt,補 workspace 內可見入口(設定區一行,不打擾)。
- offline fallback:SW 加離線頁(黑白一句話 + 重試鈕),不動 tRPC 不快取原則。
- ship checklist 加一行:「動了 client 殼 → bump `CACHE_VERSION`」。

## P5 Capacitor + FaceID(gate,不排程)

- 前置:Apple 開發者帳號 $99/yr + Xcode + /admin flip 完成。
- 形態:Capacitor 載 packgoplay.com(server.url),一份 code 兩用;FaceID 鎖 app 殼。
- push 決策點:native push(APNs)vs web push,連同客人版通知中心的 push 需求一起評估。

## 風險

1. **SW cache**:每次 ship bump `CACHE_VERSION`;Jeff 親驗前 hard refresh(prod 驗證先清 SW + cache,既有教訓)。
2. **與批2 同檔衝突**:P1 動 Workspace.tsx / WorkspaceSidebar.tsx,批2 ship 前不動工。
3. **manifest 全站共用**:theme_color 變更影響客人版,P4 落地時知會。
4. **登入牆**:workspace 手機視覺無法本機截圖驗證,雙層驗收(截圖盡力 + Jeff prod 親驗)。
5. **i18n**:殼層新字串(選單/離線頁)雙語 key,不硬編碼。
