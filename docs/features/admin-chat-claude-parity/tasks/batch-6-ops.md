# 批6 — 營運(bookings/訂單 · departures/出團 · visa/簽證 · reviews · vouchers)

> Stage 3 task 文件。設計依據:後台_05_營運.html(5 畫面)+ redesign-39.md。
> 縮編拍板:ops-landing 砍 · reviews 變自動草稿待辦卡 · vouchers 在訂單卡內發。
> Screen ④ 客服 + Screen ⑤ 新客/spam = batch 1 已完成(escalation m3b + spamBox m3a),批6 不重做。

## 實況調查(2026-06-10)

### 關鍵架構發現
1. **Booking 卡目前零互動**:CustomerInbox booking 卡只顯示標題+狀態,無 click handler、無 detail view。
2. **Departure 數據齊全但 workspace 沒入口**:departureCalendar 回 slot/leader/opsStatus,但 WorkspaceCompany 只有 4 sub-tab(記帳/月報/行銷/供應商),缺出團。
3. **Visa 狀態機直接對應 mockup 6-step stepper**:9 states 映射(submitted=送件 · paid=付款 · documents_received=收文件 · processing=送領事館 · approved=核發 · completed=完成)。uploadedDocuments 是純 URL 陣列(無 per-type 後設資料)。
4. **Email 基建已有**:SendGrid + branded template + visa email service,可直接用於行前通知送信。
5. **Screen ④⑤ 已在批1**:escalation(m3b v687)+ spam(m3a v687),批6 不重做。

### 現有資產(可重用)
- `WorkspaceCard`(ws-ui)卡片文法 ✓
- `CustomerInbox`(批0-2):header + open items + flight/wechat/quote sections ✓
- `bookings.adminList / getById / listParticipants / getOrderPacket`(完整訂單 + 旅客名單含護照解密)✓
- `bookings.adminUpdateStatus / adminRefund`(碰錢 mutation,gated)✓
- `departures.getById / list` + `adminDepartures.departureCalendar` ✓
- `db.getActiveBookingsByDepartureId`(departure → bookings join)✓
- `tourGroupNotes`(per-departure 備註)✓
- `visa.*`(9 state machine + email sending on status change)✓
- `reviews.adminList / adminApprove / adminReject`(審核 + +50 PP)✓
- `vouchers.adminList / adminMarkRedeemed`(兌換 against booking)✓
- `sendInquiryReply` + `wrapInBrandTemplate`(branded email)✓
- `ReviewTaskDialog`(全文過目 + gated confirm)✓
- `invokeLLM`(server-only LLM 調用 + 24h cache)✓

### 缺口(GAP)
1. **Booking detail 不存在**:CustomerInbox booking 卡無 click → 無 detail sheet。BookingsTabV2(909 行)是 AdminV2 風格不適合搬。
2. **出團在 workspace 沒入口**:WorkspaceCompany 4 sub-tab,缺「出團」。
3. **行前通知無資料線**:無表、無擬稿 service、無 per-customer review queue。
4. **Visa 在 CustomerInbox 沒入口**:customerOpenItems 不含 visa 資料。
5. **Reviews 不在 commandCenter**:pending reviews 只在 reviews.adminList,不進 Today 待辦。
6. **Vouchers 與 booking 未連結 UI**:rewardVouchers 有 redeemedAgainstBookingId 但 workspace 不顯示。
7. **Readiness tracking 不存在**:需從 participants/opsStatus/tourLeader/preDepartureNotifications 推導。

## Jeff 拍板(2026-06-10)
- 行前通知:**v1 做**(agent 擬稿 + 逐位審核 + email 送出)
- 改期:**defer**(dialog 說明手動流程)
- Readiness chips:**derive + 手動混合**(不加 readiness migration)

## Milestones

### m1 — Booking detail in CustomerInbox(零新 schema) ✅
- [x] Booking 卡加 click → 開 `BookingDetailSheet`(273 行)+ `bookingDetail.helpers.tsx`(160 行)
- [x] 新 tRPC `bookings.adminGetDetail(bookingId)`:booking + participants(passport 末四碼)+ user vouchers
- [x] Header:行程名 · 出發日 · 訂單號 + status badges
- [x] 兩顆 status chips:付款(deposit/paid/unpaid/refunded)+ 供應商(not_placed→vendor_confirmed)
- [x] 黑底警示條:「客人付錢 ≠ 位子訂到」(paymentStatus !== 'unpaid' && supplier !== vendor_confirmed)
- [x] 旅客名單 table:passport 末四碼 + vault badge(手機卡片化 sm:hidden)
- [x] 付款明細:團費/訂金/尾款 + trust 註記
- [x] 動作列:改期(toast 說明手動流程)· 取消訂單(gated confirm → adminRefund)· 催尾款(onChaseBalance callback)
- [x] 取消 confirm dialog:退多少+原因 → gated adminRefund mutation
- [x] 已結訂單也能開(locked,無 action buttons)
- [x] Voucher 段(縮編):列客人 issued vouchers + 「兌換 against 此訂單」(adminMarkRedeemed)
- [x] i18n(~50 keys zh-TW + en)+ Vitest(status mapping + trust warning + locked state + 160 i18n key parity checks)

### m2 — Departure 出團 in 全公司(零新 schema) ✅
- [x] WorkspaceCompany 加第 5 sub-tab「出團」(sidebar + tab bar both updated)
- [x] 出團清單 DepartureList.tsx(125 行):departureCalendar 按時間排序
- [x] 每列:行程名 · 出發日 · T-N badge · 已報/總位 · opsStatus · tourLeader
- [x] Click → DepartureDetailSheet(225 行)+ departureDetail.helpers.ts(86 行)
- [x] 5 readiness chips(derived):護照齊 · 供應商確認 · 行前通知(not_impl placeholder for m3) · 領隊指派 · 名單核對
- [x] 黑底提示:「還缺 N 項」(missing count from pending readiness items)
- [x] 旅客名單 table:跨 bookings all participants,passport 末四碼(手機卡片化 sm:hidden)
- [x] 「匯出名單 CSV」前端下載(client-side blob)
- [x] 備註段(tourGroupNotes 唯讀,desc by createdAt limit 20)
- [x] 新 tRPC admin.departureDetail(departureId):departure + bookings + masked participants + groupNotes
- [x] i18n(27 keys zh-TW + en)+ Vitest(8 readiness tests + 187 i18n key parity checks)

### m3 — 行前通知(LARGE;新 migration + LLM 擬稿 + email 送出) ✅
- [x] migration 0094 新表 `preDepartureNotifications`(departureId · bookingId · userId · recipientName · recipientEmail · subject · content · status[draft/approved/sent/skipped] · sentAt · approvedBy · createdAt)
- [x] drizzle schema 加 preDepartureNotifications table definition
- [x] LLM 擬稿 service: `server/_core/preDepartureDraftService.ts`(139 行):generatePreDepartureMessages(departureId) — 冪等 · claude-haiku-4-5 · per-customer · 雙語 prompt
- [x] tRPC router `preDepartureNotifications.*`(146 行,adminProcedure):generate / list / approve / edit / skip
- [x] Email:approve → branded template via SendGrid → status=sent;失敗 → status=approved(不 block)
- [x] PreDepartureNotices.tsx(210 行):黑底鎖條 · generate button · per-customer card · approve confirm · edit inline · skip · sent badge
- [x] DepartureDetailSheet 整合 PreDepartureNotices + readiness chip 自動更新(all sent/skipped → done)
- [x] i18n(16 keys + cancel key = 17 keys zh-TW + en)+ Vitest(router 5 procedures + 203 i18n parity checks)

### m4 — Visa stepper in CustomerInbox(零新 schema) ✅
- [x] customerOpenItems 加 `openVisas`(visaApplications by userId,active statuses)
- [x] CustomerInbox 加 visa section(照 flight/wechat pattern)
- [x] Visa card:簽證類型 + 狀態 badge + click → detail 展開
- [x] 6-step stepper(mapping existing statuses)
- [x] 護照安心條(黑底鎖 bar):「護照已加密,用完即刪,末四碼」
- [x] 文件檢查:uploadedDocuments count + 「已上傳 N 份文件」(無 per-type,誠實留 gap)
- [x] 「要文件」:onRequestDocs callback(不自動送)
- [x] adminNotes 段(唯讀)+ trackingNumber
- [x] 已結案 visa:customerOpenItems 只查 active statuses,completed 自然不出現
- [x] i18n(20 keys zh-TW + en)+ Vitest(11 tests: stepper mapping + doc count parsing)

### m5 — Reviews as Today cards(零新 schema) ✅
- [x] WorkspaceToday 加 reviews.adminList(status=pending) query,合併進「需要你決定」bucket
- [x] TodayReviewCard.tsx(149 行):rating stars + excerpt + tour title + author
- [x] 展開 → 完整評價內文 + [核准 (+50PP)] / [拒絕(填理由)]
- [x] 核准 → reviews.adminApprove(+50 Packpoint,existing mutation)
- [x] 拒絕 → reviews.adminReject(理由,min 3 chars)
- [x] 處理好了 → workspace.setDisposition(kind="review",新增到 WORKSPACE_ITEM_KINDS)
- [x] i18n(10 keys zh-TW + en)+ Vitest(9 tests: star rendering + excerpt + disposition kinds)

## 碰錢動作一覽(只重排版,零新路徑)
| 動作 | 既有 mutation | 批6 UI |
|------|-------------|--------|
| 取消訂單退款 | bookings.adminRefund | BookingDetailSheet confirm dialog |
| 評價 +50PP | reviews.adminApprove | ReviewTaskDialog |
| Voucher 標記兌換 | vouchers.adminMarkRedeemed | BookingDetailSheet voucher 段 |

## 驗證(每 milestone)
- tsc 0;vitest 綠;新元件零硬編碼中文;Sheet padding 守 §2.5。
- 手機:360/390/430px 無爆版;卡片 w-full min-w-0;點擊區 ≥ 44px;表格→手機卡片化。
- ship 後 curl bundle 標誌;Jeff prod 親驗。
