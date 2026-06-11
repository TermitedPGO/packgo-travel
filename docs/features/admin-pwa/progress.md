# 後台 PWA progress(監工視角)

> 先讀 proposal.md(phase 表)、design.md(實作設計)。每 phase 動工前補 `tasks/p<N>-*.md`,完成更新本表。

## Phase 狀態

| Phase | 內容 | 大小 | 狀態 |
|-------|------|------|------|
| P0 | 記帳:舊文件 superseded、redesign-39 驗收規則、本計畫落檔 | XS | ✅ 2026-06-10 |
| P1 | workspace 手機殼(sidebar→抽屜 + retrofit 批0-2 面) | M | ⏳ 等批2 ship |
| P2 | 批3-8 手機驗收內建(規則已落 redesign-39) | 每批 +10-15% | ✅ 規則落檔;隨批執行 |
| P3 | chat 結構化卡片(ws-ui renderer) | L | ⏸ 等 Jeff 指 |
| P4 | PWA polish(manifest 黑、icon、install 入口、offline 頁) | S | ⏳ 可搭 P1 |
| P5 | Capacitor + FaceID + push 決策 | M + 外部依賴 | ⏸ gate:Apple 帳號 + /admin flip |

## 與客人版軌的交錯(2026-06-10 建議,一次一軌)

```
1. ship 批2(已 build 完)
2. admin-pwa P0 ✅ → P1+P4 一個 chunk(~3-4d)
3. customer-mobile C1 → C2(轉換流程優先)
4. admin 批6 → customer C3 → admin 批4 → customer C4
   → admin 批5、7 → customer C5 → admin 批3、8(P3 建議插批4 後)
5. P5 Capacitor:Apple 帳號到位 + /admin flip 後
```

## DoD(P1/P4 適用)

- [ ] tsc --noEmit 0 err + 純函式 Vitest
- [ ] 360/390/430 三寬截圖(盡力)+ Jeff prod 親驗
- [ ] 殼層字串 i18n 雙語
- [ ] ship 時 bump SW `CACHE_VERSION`
- [ ] 不與批2 未 ship 的檔案衝突

## 記錄

- 2026-06-10:補後台手機示意圖 `PackGo_示意圖/手機/後台_01_工作台手機殼.html`(5 張:今日待辦/抽屜/客戶 inbox/AI 對話卡片/記帳滑卡)。背景:_archive 清掉的 4 個舊後台手機圖是 chat-first 舊方向,workspace 新方向原本沒有手機圖;P1/P3/批3 視覺規格現已有依據。headless Chrome 截圖驗證過排版。
- 2026-06-10:P0 完成。計畫落檔(proposal/design/progress);`docs/features/mobile/` 三檔標 SUPERSEDED;`mobile-roadmap/proposal.md` 加兩軌指針;`redesign-39.md` 加批3-8 手機驗收規則。架構拍板:workspace 手機適配走元件層 responsive-first + 殼改抽屜,不走 MobileShell(AdminV2 退役時殼跟著丟)。
