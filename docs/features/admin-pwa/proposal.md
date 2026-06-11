# 後台 PWA 完整計畫 (proposal)

> 2026-06-10 Jeff 拍板:後台走完整 PWA 計畫。
> 本計畫收「PWA 專屬工作」:殼、chat 卡片、polish、Capacitor gate。
> **workspace 頁面本身的手機適配不在這裡開計畫**,改為內建進 `docs/features/admin-chat-claude-parity/redesign-39.md` 的批3-8 驗收規則(見 P2)。
> 兩軌總綱與 UI/UX 鐵則:`docs/features/mobile-roadmap/proposal.md` §0 + §0.5。客人版姊妹計畫:`docs/features/customer-mobile/`。

## 1. 現狀盤點(別重做)

已建好且在線上:

| 東西 | 位置 | 狀態 |
|------|------|------|
| Service worker | `client/public/service-worker.js`(181 行) | 策略成熟:shell cache-first、tRPC network-first 不快取、圖 stale-while-revalidate;`CACHE_VERSION` 2026-06-09 |
| Manifest | `client/public/manifest.json` | 完整含 shortcuts;**theme_color 還是舊 teal #0D9488** |
| 手機元件 | `client/src/components/mobile/` | MobileShell、DailyCheckMobile、BankTriagePage(滑動分類)、ReceiptCameraFAB、GlobalSearchSheet、MobileMenuDrawer |
| chat-first | AdminV2 | Slice 1 快捷 chip ✅、Slice 2 chat-first shell ✅(2026-06-01);Slice 3 結構化卡片 ⏭ |

舊計畫 `docs/features/mobile/`(2026-05-22 Phase 0-7)已過時:Phase 0/1/2/5/6 實際已建但文件還標 Pending,已標 SUPERSEDED 指到本計畫。

## 2. 關鍵架構決策:workspace 手機適配做在哪一層

**拍板:responsive-first 做在 workspace 元件層本身 + Workspace.tsx 殼改造一次(sidebar 改 `<md` 抽屜)。不走 MobileShell、不開平行 mobile 元件樹、chat-first 不吃掉頁面。**

理由:

1. MobileShell 掛在 AdminV2 的 renderMobilePage 上;終點是 /admin 整個 flip 到 Workspace,AdminV2 連同手機殼屆時退役,投資全是丟棄成本。
2. ws-ui 卡片文法天生單欄(badge/body/warn/動作列縱向堆疊),批3-8 照 mockup 重做時加流動寬度幾乎免費;等 ship 完再回頭 retrofit 等於重開每一批。
3. chat-first 是互補不是替代:終點 10 頁裡「與 AI 對話」只是 1 頁;Slice 3 的結構化卡片重用 ws-ui 同一套卡片元件當 renderer,一份卡片代碼同時服務 chat 內嵌與 workspace 頁面。
4. 唯一真正壞掉的是殼:`Workspace.tsx` sidebar 寫死 `w-[248px] flex-shrink-0` + `h-screen flex` 橫排,390px 螢幕只剩 ~142px 內容區。

## 3. Phase 表

| Phase | 內容 | 大小 | 依賴 |
|-------|------|------|------|
| **P0 記帳** | 舊 `mobile/` 標 superseded ✅、`mobile-roadmap` 加指針 ✅、`redesign-39.md` 加手機驗收規則段 ✅、本計畫落檔 ✅ | XS(半天) | 無 |
| **P1 workspace 手機殼** | `Workspace.tsx` sidebar → `<md` 抽屜(抄 MobileMenuDrawer 模式)+ safe-area;retrofit 已上線面(WorkspaceToday / CustomerInbox / CustomerChat / WorkspaceCompany)至 360/390/430 過關 | M(2-3d) | 批2 ship 後(避免同檔衝突) |
| **P2 批3-8 手機驗收內建** | 規則不是工作:每批驗收 + 360/390/430 截圖 + 單欄無橫向捲動 + ≥44px(已寫進 redesign-39.md);桌面密集表格類(批3 帳本、批6 訂單)靠既有卡片化治理吸收,不另做手機表格;DailyCheckMobile / BankTriagePage / ReceiptCameraFAB 在對應批 **re-home 不重寫**(批3 財務:BankTriage 掛為記帳手機卡片視圖、ReceiptFAB 掛進 workspace 殼) | 每批 +10-15% | P0 |
| **P3 chat 結構化卡片(原 mobile-roadmap Slice 3)** | OpsAgent 回結構化區塊(非純 markdown)+ 前端 renderer **以 ws-ui 為卡片層**;與批2 m3 的 actions/cards gated 渲染合併成同一件事做一次,避免兩套 renderer | L(3-5d) | 批2 ship + **Jeff 指**(LARGE 不自動硬上) |
| **P4 PWA polish** | manifest `theme_color` #0D9488 → 黑(全站共用,客人版同受影響,方向一致)、maskable icon 核對、install 入口 UI(captureInstallPrompt 已在 main.tsx,補 workspace 內入口)、offline fallback 頁、SW 版本紀律寫進 ship checklist | S(1d) | 無,可搭 P1 同船 |
| **P5 Capacitor + FaceID gate** | 押後到 /admin flip 之後再包殼(否則包的是過渡品);native push(iOS 上 native push > web push)在此一併決策;客人版通知中心的 push 需求同場評估 | M(1-2d)+ Apple $99/yr | Apple 帳號 + 39 批 flip |

## 4. 不做

- 不重排桌面密集表格(撞「整齊密度」原則);手機呈現靠批3-8 卡片化吸收。
- 不做 web push(iOS 限制多,P5 與 native push 一起決策)。
- 後台與客人端維持兩個入口,不合併(mobile-roadmap §0 鐵則)。
