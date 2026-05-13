# Phase 4 — CST §17550 Trust Account Income Deferral

**Status:** Design doc — awaiting Jeff sanity-check before implementation.
**Author:** Claude (this session's planning)
**Last updated:** 2026-05-12
**Blocker:** Need Jeff to confirm the rules below match how he actually runs the trust account day-to-day.

---

## Background

PACK&GO is a California Seller of Travel under CA Business & Professions Code §17550 (CST). When a customer prepays for a tour, that money MUST live in a trust account until **the day the customer departs**. Only after departure does the money legally belong to PACK&GO (the operator can take it as revenue).

This affects bookkeeping in two ways:

1. **Income recognition timing.** A $5,000 booking made in November for a March departure shouldn't show up as November income — it's November "deferred revenue" (liability), recognized as income on the March departure date.

2. **Trust account reconciliation.** The CA Travel Consumer Restitution Fund + audits expect the trust balance to equal the sum of un-departed prepayments. Off by even a dollar and you're in trouble.

Today's system (post-Phase 3) ignores this. Every Plaid inflow flagged `income_booking` becomes immediate income in the P&L. For a small operator with mostly short-lead bookings the practical error is small, but it's wrong on paper and will fail an audit.

---

## What Phase 4 will do

When the AccountingAgent classifies a transaction as `income_booking` AND the originating account `isTrustAccount=true`, we don't put the money straight into P&L. Instead we:

1. **Defer:** Record the txn into a new table `trustDeferredIncome` with `linkedAccountId`, `bookingId` (best-effort match), `amount`, `depositDate`, `expectedRecognitionDate` (= booking's departureDate from `bookings` table).

2. **Recognize:** A daily cron job scans `trustDeferredIncome` for rows where `expectedRecognitionDate <= today AND recognizedAt IS NULL`, marks them recognized, and emits a synthetic accountingEntry / updates the P&L feed.

3. **Trust reconciliation:** New report `trust_account_reconciliation` that asserts `sum(linkedBankAccounts.currentBalance WHERE isTrustAccount=1) >= sum(trustDeferredIncome WHERE recognizedAt IS NULL)`. Off-by-one → notifyOwner alert.

---

## Jeff's answers (2026-05-13)

| Question | Jeff's answer | Implementation |
|---|---|---|
| Q1 全額 / 部分進信託 | **A**:全額(deposit + 尾款都進信託) | AccountingAgent 已自動處理 — 任何 income_booking + isTrustAccount=1 → 進 trustDeferredIncome |
| Q2 認列時機 | **A**:出發當天 00:00 | `PLAID_TRUST_RECOGNITION_OFFSET_DAYS=0`(預設值) |
| Q3 配對策略 + 信心門檻 | **4**:Hybrid 自動配 ≥80 + 手動隊列(80 threshold) | 已實作。`PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE=80` |
| Q4 取消 / no-show 處理 | 全退→reverseDeferral;部分退→reverseDeferral + 手續費認列;**no-show → 不 reverse,出發日照常認列** | reverseDeferral 是 admin 手動觸發;no-show 不調用 reverse,recognition cron 會在原本 expectedRecognitionDate 自動認列 |
| Q5 信託 ↔ Operating 轉帳 | **A**:客戶→Stripe→operating→Jeff 手動轉到 trust + cron 每天提醒「今天出發團要轉 $X 回 operating」 | Trust recognition cron 強化 — 同時在 notification 列出「今天該轉的金額」 |
| Q6 多階段付款 / 供應商先付 | **A**:$5000 全留信託到出發日,1/5 付供應商從 operating 暫墊,1/15 轉 $2000 回 operating + 認列 $3000 | 不需 code 變更 — agent 把供應商付款分類為 cogs_tour,從 operating 帳戶出,operating ↔ trust 轉帳分類為 transfer(不影響 P&L)。Jeff 出發日從 trust 轉錢回 operating 即可 |
| Q7 跨年邊界 | **B**:出發 ≤30 天內就當天認列(12/30 付款 1/5 出發 → 認列 2026)。短期出發直接 recognize on deposit date | 新增 `PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS=30`。Service 在 processTrustInflow 時檢查 (departure - deposit) ≤ window → expectedRecognitionDate = depositDate(立刻認列) |

**Status:** Phase 4 implementation matches all 7 answers. Ready to flip
`PLAID_TRUST_DEFERRAL_ENABLED=true`.

---

## Original questions (preserved for reference)

These are the rules I was GUESSING before Jeff answered. Each one now has
his confirmation above.

### Q1. What goes into the trust account?

- [ ] Every customer payment (full amount, regardless of size)
- [ ] Only the deposit; balance can go straight to operating
- [ ] Only customer payments for tours > $X days out
- [ ] Other: _________

### Q2. When does the money LEGALLY become PACK&GO's?

- [ ] Customer's departure date (calendar day they leave)
- [ ] Day after departure (so partial-refund disputes from day-of cancellations are handled)
- [ ] When the supplier is fully paid (vendor invoice settled)
- [ ] Other: _________

### Q3. Matching a Plaid inflow to a booking

Plaid sees "STRIPE TRANSFER $4,800 on 2026-01-15" — how do I match it to `bookings.id = 1234`?

Options:
1. **Heuristic:** Same-day amount match between Plaid inflow and `bookings.depositPaidAt` ± 1 day. Risk: ambiguous when 2 bookings hit the same day.
2. **Stripe metadata:** Plaid stores `description` from Stripe. If we pass `bookingId` in Stripe payment metadata, we can extract it.
3. **Jeff manual link:** Admin UI shows "unlinked trust inflow" and asks Jeff to pick the booking. Then save the link.
4. **Hybrid:** Auto-match high-confidence cases (single same-day same-amount); ask Jeff for ambiguous ones.

My recommendation: **#4**. Auto-link 80%, leave 20% for Jeff.

- [ ] OK with #4
- [ ] Prefer #1 / #2 / #3
- [ ] Different idea: _________

### Q4. What happens when the customer cancels?

- [ ] Refund processed → reverse the deferred entry, never recognize
- [ ] Partial refund + retain cancellation fee → recognize the fee on cancellation date, refund the rest
- [ ] No-show / no refund → recognize the full amount on the original departure date anyway

### Q5. Transfer between accounts

What does "Operating ↔ Trust" look like?

- [ ] Jeff manually transfers a booking deposit from operating to trust right after booking. (System treats this as `transfer`, no income recognition.)
- [ ] Stripe payout goes DIRECTLY to trust (auto-routing rule on the Stripe side). Then Jeff transfers from trust to operating on departure date.
- [ ] Hybrid / case-by-case: _________

**This is the most important question.** The CST audit will look at this flow. If you're doing something different from what I'm coding, the system will look correct but be lying.

### Q6. Multi-leg bookings

If customer pays $5,000 today for a March departure that has a $2,000 supplier deposit due in January:

- [ ] All $5,000 stays in trust until customer departs in March, then $2,000 expense to supplier from trust on Jan + $3,000 revenue to operating in March
- [ ] $2,000 leaves trust to supplier in January (accelerates COGS recognition); $3,000 still stays until March
- [ ] Different: _________

### Q7. Year-end edge case

December 30 customer pays $5,000 for January 5 departure. Recognized in Jan or Dec?

- [ ] Strictly by departure date → Jan (counts as 2027 income)
- [ ] If departure is within 30 days, recognize on deposit date → Dec (counts as 2026 income)
- [ ] Defer to CPA

This matters for which tax year the income lands in.

---

## What I'll implement once Jeff confirms

1. New schema: `trustDeferredIncome` table (migration 0071)
2. Modify `accountingAgent` flow: when category=income_booking AND isTrustAccount=true → write to trustDeferredIncome instead of just persisting on bankTransactions
3. Booking-matching service: `linkTrustInflowToBooking(transactionId)`
4. Daily cron `recognizeDeparturedTrustIncome` at 06:00 UTC (after Plaid sync)
5. Admin UI: 信託對帳 view under 財務 → 銀行帳戶 with unmatched trust inflows + their suggested booking links
6. P&L service: subtract deferred income from `income_booking` totals so the monthly P&L reflects recognition correctly
7. Year-end export: add `trust_account_deferred_at_year_end.csv` to the ZIP (snapshot of what's still in trust on Dec 31)

Estimate: 2-3 work days once questions above are answered.

---

## Why this is on hold

Per agreement at session start: "I同意這四點 — 4. Phase 4 sanity-check with fake booking before going live." That sanity check requires Jeff to:
1. Answer Q1-Q7 above
2. Create a fake booking in dev with departureDate in the past + a fake trust account txn
3. Watch the recognition cron run and confirm the entry shows up correctly in the P&L

I can't do steps 2-3 without Jeff. So the work above is paused.

---

## Suggested next action for Jeff

When you have 30 minutes:
1. Read this doc top-to-bottom
2. Answer Q1-Q7 in the spaces above (or comment in the doc)
3. Ping me ("Phase 4 ready") and I'll start implementing within 24h

Until then, the system runs WITHOUT trust deferral — every `income_booking` is recognized immediately. For PACK&GO's current scale and short-lead bookings this is fine for internal reporting but **must not be used for the official Schedule C without CPA review**.
