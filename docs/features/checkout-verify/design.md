# checkout-verify — 設計

> Stage 2。2026-07-11。

## 模組劃分

| 模組 | 職責 |
|------|------|
| `server/services/checkoutVerification/types.ts` | 型別 + 擋單原因枚舉(10 種) |
| `server/services/checkoutVerification/helpers.ts` | 純函式:productCode 解析、本地曆日、人數/gross 複算、必付清單比較、逐呼叫逾時預算、UV 錯誤分類 |
| `server/services/checkoutVerification/snapshot.ts` | 頁面展示側明細載入(supplierProducts→supplierProductDetails)+ 揭露快照組裝 |
| `server/services/checkoutVerification/uvLiveChecks.ts` | 訂金路 live 驗證段 (a)(b)(c),絕不 throw |
| `server/services/checkoutVerification/index.ts` | 主流程 `verifyTourCheckout` + 觀測 log + re-exports |
| `server/db/booking.ts`(擴充) | `createCheckoutDisclosure` / `setCheckoutDisclosureSession` / `markCheckoutDisclosureCompleted` |
| `drizzle/schema.ts` + migration 0116 | `checkoutDisclosures` 表(append-only 稽核軌) |
| `server/routers/bookingsPayment.ts`(接線) | 旗標 → 驗證 → 存證 → Stripe → 回填 sessionId |
| `server/_core/stripeWebhook.ts`(接線) | checkout.session.completed 蓋章(post-commit fail-open) |
| `client/src/pages/BookingDetail.tsx` | PRECONDITION_FAILED → 「提交訂位需求」詢位卡 |

## 關鍵決策

1. 價格的「一把尺」:live 驗價用 `pickDepartureAdultPrice`(pt4→pt1,整數 USD)—— 與匯入管線同一函式,展示側 = `tourDepartures.adultPrice`,容差 $0(整數基準上任何差 = 擋)。
2. 必付費用比較:live `parseUvPriceTerms().excluded` 的 `必付:` 行 vs 頁面展示的 `supplierProductDetails.priceTermsParsed` 同格式行(同一 parser 產生),多重集合比較。頁面沒展示而 live 有 → 擋(客人沒被告知)。
3. 超收防護:以現行班期價 × 本單人數複算 gross,`booking.totalPrice > gross` → 擋;`< gross` 不擋(Packpoint 折抵合法路徑)但記錄進 grossGuard 供觀測。
4. 存證順序:驗證 → 落 `checkoutDisclosures`(status=session_created)→ 建 Stripe Session → 回填 sessionId。存證失敗不建 Session;回填失敗不回傳 URL(Session 60 分鐘自然過期)。驗證失敗也落列(verification_failed,無 sessionId)供漏斗。
5. 尾款(remaining):`supplierStatus === "vendor_confirmed"` 才放行(成約價,位子已確認,不重驗 live);否則擋 `balance_without_vendor_confirmation`。
6. 旗標語意:`TOUR_INSTANT_CHECKOUT_ENABLED` OFF(預設)= 全擋;ON = 驗證通過才建 Session。不存在「不驗證的 legacy 結帳」。
7. 逾時:逐呼叫 12s 預算(Promise.race),不等 uvClient 的 60s;逾時 = supplier_unreachable = 擋。
8. 前端契約:`error.data.code === "PRECONDITION_FAILED"` → 轉詢位 UI(BookingDetail 詢位卡 / 行程頁按鈕已在停止線 commit 轉詢位)。

## 資料流(訂金)

```
createCheckoutSession
  → flag gate → rate limit → booking/ownership/amount
  → getTourById + getDepartureById(缺 → 擋)
  → verifyTourCheckout
      remaining? → vendor_confirmed 檢查
      deposit  → resolveUvProductCode(非 UV → 擋)
               → tours.status / 幣別 USD 檢查
               → loadStoredSupplierDetail(頁面側必付+條款+新鮮度)
               → runUvLiveChecks: getProductMain → getProductGroup(該日) → getProductTravelDetail
  → fail → createCheckoutDisclosure(verification_failed) → PRECONDITION_FAILED
  → pass → createCheckoutDisclosure(session_created, snapshot+verification)
        → stripe.checkout.sessions.create(metadata.disclosure_id)
        → setCheckoutDisclosureSession(id, session.id) → 回 URL
webhook checkout.session.completed(post-commit)
  → markCheckoutDisclosureCompleted(sessionId, paymentIntentId)
```

## Migration 0116

`checkoutDisclosures`:bookingId / paymentType / status(verification_failed·session_created·completed)/ stripeSessionId / stripePaymentIntentId / snapshot JSON / verification JSON / verifiedAt / completedAt。CREATE TABLE IF NOT EXISTS(MIGRATION_PATTERNS Rule 1),.down.sql 附;journal `when`=1783791500000(> 前高水位 1783728001000,Rule 4 + migrationJournal.test 守門)。
