# checkout-verify batch-1 checklist(模式一 + 揭露存證)

- [x] 臨時停止線(先行 commit d212294,已合 main):旗標全擋 + 行程頁購買按鈕轉「提交訂位需求」
- [x] schema:`checkoutDisclosures` 表 + types
- [x] migration 0116(up + down + journal when 高水位;migrationJournal/migrationBreakpoint 守門綠)
- [x] db helpers:createCheckoutDisclosure / setCheckoutDisclosureSession / markCheckoutDisclosureCompleted
- [x] `checkoutVerification` 服務(5 模組,各 ≤300 行):UV live 驗在售/驗位/驗價($0 容差)/必付清單/超收防護/新鮮度;非 UV 擋;逾時 fail-closed;尾款 vendor_confirmed 閘
- [x] `createCheckoutSession` 接線:驗證 → 存證 → Stripe → sessionId 回填(每一步 fail-closed)
- [x] webhook 蓋章:checkout.session.completed → markCheckoutDisclosureCompleted(post-commit fail-open + errorFunnel)
- [x] 前端 fallback:BookingDetail PRECONDITION_FAILED → 詢位卡(inquiries.create,relatedTourId);i18n zh+en parity
- [x] 觀測:event=checkout_verification 結構化 log(outcome/reason/mode/elapsedMs)
- [x] 紅綠測試:服務 26 案 / router 8 案 / 停止線 2 案 / webhook 蓋章斷言進既有 9 案;新測試連跑 5 次穩
- [x] 既有測試不弱化:stripeWebhook.bookings+refunds、membership、bookings、inquiries、i18n 全綠
- [x] coverage.test.ts(SQL 彩排登記行號漂移已更新)、migrationJournal、migrationBreakpoint 綠
- [x] 驗收收案三小條(2026-07-11 指揮回令):flag docstring v2 語意、currency_missing 防呆+測試、必付格式漂移運維閘 runbook(runbook-flag-enable.md,探針三團實跑 aligned)
- [ ] prod 部署後:migration 0116 落表驗證(SHOW TABLES,MIGRATION_PATTERNS Rule 3)— 待 Jeff ship
- [ ] 旗標 `TOUR_INSTANT_CHECKOUT_ENABLED=true` 開啟時機 — Jeff 裁決,前置照 runbook-flag-enable.md 兩條運維閘
