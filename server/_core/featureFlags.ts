/**
 * featureFlags — single source of truth for runtime boolean flags.
 *
 * SECURITY_AUDIT_2026_05_14 P3-3: `process.env.X === "true"` was scattered
 * across the codebase. A typo in the env-var name (e.g.
 * `PLAID_TRUST_DEFERAL_ENABLED` — one R missing) silently evaluates to
 * `false`, which could silently disable a safety gate. Centralizing the
 * reads makes typos a TypeScript compile error.
 *
 * Add new flags here, never inline `process.env.*_ENABLED === "true"`
 * at call sites.
 *
 * Note: this module is read on every call (no caching). Fly secrets are
 * applied at boot via process.env, so changes require a redeploy — which
 * is what we want for flags that gate financial behavior (no surprise
 * mid-run flips). If you need hot-reloadable flags later, layer that on
 * top here.
 */

const isTrue = (v: string | undefined): boolean => v === "true";

/**
 * Master switch for the CST §17550 trust-deferral auto-match path. When
 * OFF, every customer payment is recognized as revenue on the booking
 * date (legacy behavior). When ON, deposits sit in `trustDeferredIncome`
 * until the matched departure date.
 *
 * Env: `PLAID_TRUST_DEFERRAL_ENABLED=true`
 */
export const trustDeferralEnabled = (): boolean =>
  isTrue(process.env.PLAID_TRUST_DEFERRAL_ENABLED);

/**
 * Number of integer days to subtract from the matched departure date
 * when recognizing trust revenue. 0 = recognize on the departure date
 * itself. Allows Jeff to tune a forward-looking buffer for CST audits
 * without code changes.
 *
 * Env: `PLAID_TRUST_RECOGNITION_OFFSET_DAYS` (integer, default 0)
 */
export const trustRecognitionOffsetDays = (): number => {
  const v = parseInt(process.env.PLAID_TRUST_RECOGNITION_OFFSET_DAYS ?? "0", 10);
  return Number.isFinite(v) && v >= 0 ? v : 0;
};

/**
 * Minimum auto-match confidence score below which a payment-to-booking
 * link is rejected (forced to manual review). 0-100. Lower = more
 * matches but more false positives.
 *
 * Env: `PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE` (integer 0-100, default 80)
 */
export const trustAutomatchMinConfidence = (): number => {
  const v = parseInt(
    process.env.PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE ?? "80",
    10
  );
  if (!Number.isFinite(v)) return 80;
  return Math.max(0, Math.min(100, v));
};

/**
 * Same-day match tolerance (USD) for the trustDeferralService heuristic
 * matcher (findBookingMatch): a bank-txn amount within this tolerance of a
 * candidate payment/deposit/total is treated as an amount match.
 *
 * Env: `PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD` (float >= 0, default 1.00)
 *
 * F1 塊B (2026-07-08) 收口:原本是 trustDeferralService.ts 裡的裸
 * process.env 讀取(SECURITY_AUDIT_2026_05_14 P3-3 點名的拼字風險缺口),
 * 搬進這支集中管理。
 *
 * ⚠ 非純收口,順手修了一個 falsy-zero bug(對抗審查 P2 點名,已在此誠實
 * 揭露而非隱藏):舊寫法是 `Math.max(0, parseFloat(env) || default)`,
 * `env='0'` 時 `parseFloat('0')===0` 是 falsy,`||` 會吃掉它退回
 * default——也就是說舊碼**不可能**透過環境變數把這個值設成 0,即使
 * 0 在數學上是合法值。新寫法用 `Number.isFinite(v) && v>=0` 判斷,`'0'`
 * 會正確回傳 `0`。此函式governs PLAID flag(預設 off)下的行為,目前零 prod
 * 影響;若未來有人真的想把這個值設 0,新行為才是正確、符合欄位語意的行為。
 */
export const trustAutomatchAmountWindowUsd = (): number => {
  const v = parseFloat(process.env.PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD ?? "1.00");
  return Number.isFinite(v) && v >= 0 ? v : 1.0;
};

/**
 * Date window (± days) the heuristic matcher searches for candidate
 * payments around a trust-account inflow's date.
 *
 * Env: `PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS` (integer >= 0, default 2)
 *
 * F1 塊B (2026-07-08) 收口,同上;同樣的 falsy-zero 修正也適用這裡
 * (`env='0'` 舊碼退回 2,新碼正確回 0)。
 */
export const trustAutomatchDateWindowDays = (): number => {
  const v = parseInt(process.env.PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS ?? "2", 10);
  return Number.isFinite(v) && v >= 0 ? v : 2;
};

/**
 * When a booking's departure is within this many days of the deposit date,
 * recognize income on the deposit date instead of deferring to departure
 * (keeps short-lead bookings from crossing year-end attribution). Set to 0
 * to disable early recognition (strict departure-date attribution).
 *
 * Env: `PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS` (integer >= 0, default 30)
 *
 * F1 塊B (2026-07-08) 收口,同上。這支的 falsy-zero 修正影響最大:文件本來
 * 就寫「設 0 停用早鳥認列」,但舊碼的 `||30` 讓 `env='0'` 實際上永遠回 30——
 * 文件宣稱的行為在舊碼裡從未真的成立過。新碼修正後,`'0'` 才會真的停用。
 */
export const trustEarlyRecognitionWindowDays = (): number => {
  const v = parseInt(process.env.PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS ?? "30", 10);
  return Number.isFinite(v) && v >= 0 ? v : 30;
};

/**
 * Master switch for routing Stripe tour-checkout income through the same
 * CST §17550 deferral ledger as Plaid trust-account inflows, instead of
 * recognizing it immediately at checkout. OFF (default) preserves the
 * current byte-identical behavior — CPA has not yet ruled on whether
 * Stripe-collected deposits fall under trust-account regulation; flipping
 * this is a business/legal decision, not a code change (dispatch-f1.md 塊B).
 *
 * Scope: tour bookings only. Visa service payments are never deferred by
 * this flag (visa is a service fee, not a customer trust deposit).
 *
 * Env: `STRIPE_TRUST_DEFERRAL_ENABLED=true`
 */
export const stripeTrustDeferralEnabled = (): boolean =>
  isTrue(process.env.STRIPE_TRUST_DEFERRAL_ENABLED);

/**
 * 臨時停止線 (2026-07-10, Jeff 裁決 · 外部顧問第二輪審計 §二/§三). Tour 類
 * 「結帳即請款」在付款前尚無即時驗價、驗位與揭露存證,先擋下來:OFF (預設)
 * = 擋,createCheckoutSession 對 tour booking 回結構化錯誤,前端轉「提交訂位
 * 需求」詢位流。ON = 放行舊即時請款行為。
 *
 * 作用域:僅 tour booking 的 createCheckoutSession (server/routers/
 * bookingsPayment.ts)。visa / membership 結帳走各自 router,完全不受此旗標
 * 影響。
 *
 * 退場:checkout-verify 批的即時驗證(驗商品在售/驗位/驗價/揭露存證)上線後,
 * 這個「無條件擋」由「驗證通過才建 session」的條件擋取代,本旗標即可退役。
 *
 * Env: `TOUR_INSTANT_CHECKOUT_ENABLED=true`
 */
export const tourInstantCheckoutEnabled = (): boolean =>
  isTrue(process.env.TOUR_INSTANT_CHECKOUT_ENABLED);

/**
 * STOREFRONT_MODE — same-image split-role flag (feature: storefront-split,
 * Phase 0). When SET, this process runs as the customer-facing storefront:
 * it serves the SPA + bot-prerender + the public tRPC surface, but starts
 * NO BullMQ workers, NO cron schedulers, and does NOT mount backend-only
 * Express endpoints (Stripe/Plaid/Gmail-push webhooks, /api/internal/*,
 * /api/admin/*, the OpsAgent SSE, and the Gmail-pipeline OAuth routes).
 *
 * When UNSET (default = ops/backend role), behavior is byte-identical to
 * before this flag existed — every worker/cron starts and every endpoint
 * mounts. Phase 0 only adds this gate; it does not deploy anything.
 *
 * Convention note: the other flags in this module use the strict `=== "true"`
 * form (see `isTrue`). This flag intentionally also accepts `"1"` because the
 * split blueprint provisions it in fly secrets as `STOREFRONT_MODE=1`
 * (docs/features/storefront-split/plan.md §Phase 1). Accepting both keeps the
 * flag robust to whichever literal is set while staying opt-in (any other
 * value, including unset, → false → ops role).
 *
 * Env: `STOREFRONT_MODE=1`
 */
export const storefrontMode = (): boolean => {
  const v = process.env.STOREFRONT_MODE;
  return v === "1" || v === "true";
};
