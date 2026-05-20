# v2 · Wave 4 · Module 4.15 — App Store + Google Play submission prep

> ⏸️ **DEFERRED to v3** — Apple Developer Program $99/yr + Google Play $25 not committed. Task content preserved for v3 re-activation; no execution in v2.

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L2 — Admin RN Expo, §Module 4.15) + risk register #4 (App Store review rejection)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** DEFERRED-V3 (Jeff decision 2026-05-19 — focus v2 on web + PWA; revisit RN admin app in v3 after mobile traffic + customer demand data lands)
**Est. effort:** 12 h AI + 4 h Jeff review (Apple/Google cert flow + listing copy + screenshots)
**Deploy window:** Week 6 of v2; submit 7 days before Jeff plans to use the app daily (risk register #4)

## Goal

Prepare and execute the first submissions to:

1. **App Store Connect (iOS)** — `com.packgo.admin` for the admin RN app, distribution via App Store (private listing or wide release per Jeff's choice).
2. **Google Play Console (Android)** — same bundle ID; internal testing track first, then production.

Outputs include: 1024×1024 store icons, screenshots (6.5"/5.5" iPhone, 12.9"/11" iPad if applicable, Pixel sizes Android), privacy policy URL on `packgo09.manus.space/privacy`, store listing copy (Chinese + English), demo credentials for reviewers, and the actual EAS Submit invocation.

**Risk register #4:** ~30% first-submission rejection rate. Mitigation: pre-submission HIG / Play Policy checklist + 7-day buffer.

## Pre-requisites

- **Modules 4.7-4.14 merged.** Full app runnable + Detox green.
- **Apple Developer Program enrollment** complete ($99/yr, ID verification 24-48h). Status confirmed by Jeff.
- **Google Play Console** enrollment complete ($25 one-time). Status confirmed.
- **EAS account** + production keystore credentials configured (Module 4.13 `eas credentials`).
- **Privacy policy** drafted (Jeff or supervisor).
- **App icon 1024×1024** exists (Module 4.1 source assets).

## Inputs (read these before executing)

- `packages/mobile/app.json` — current config; we update version + buildNumber.
- `packages/mobile/eas.json` — submit profile (Module 4.8 stub).
- Apple HIG checklist: https://developer.apple.com/design/human-interface-guidelines/
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play Policies: https://play.google.com/console/about/policies/

## Scope (what this module owns)

- ✅ `packages/mobile/store-assets/` — NEW dir:
  - `icon-1024.png` — App Store icon.
  - `screenshots-ios/` — 6.7" (e.g., iPhone 15 Pro Max), 6.5" (iPhone 11 Pro Max), 5.5" (iPhone 8 Plus) for iPad if supportsTablet true.
  - `screenshots-android/` — Pixel 7 (1080×1920) Pixel Fold (1080×2160).
  - `preview-videos/` (optional) — 15-30s app preview MP4s.
- ✅ `packages/mobile/store-assets/listings/zh-TW.md` and `en.md` — localized store listings.
- ✅ `client/public/privacy.html` (or route in Hono serving Markdown→HTML) — privacy policy page at `https://packgo09.manus.space/privacy`.
- ✅ `packages/mobile/eas.json` — production submit profile filled (appleId, ascAppId, googlePlayServiceAccountKeyPath).
- ✅ HIG/Play Policy pre-submission checklist in `packages/mobile/SUBMISSION_CHECKLIST.md`.
- ✅ Demo credentials seeded for reviewers (server-side).
- ❌ NOT in scope: any feature work; iOS in-app purchase (no IAP in admin app); marketing campaign (separate Jeff project).

## Procedure

### Phase 1 — Asset prep (~4h AI)

1. **App icon 1024×1024:** ensure `packages/mobile/store-assets/icon-1024.png` exists (from Module 4.1 source set, scale up if needed). Must be square, non-transparent, NOT pre-rounded.

2. **iOS screenshots (5 sizes minimum):**
   - 6.7" (1290×2796) — iPhone 15 Pro Max (REQUIRED).
   - 5.5" (1242×2208) — iPhone 8 Plus (REQUIRED).
   - 6.5" (1284×2778) — iPhone 11 Pro Max (REQUIRED if 6.7" not provided).
   - 12.9" iPad Pro (2048×2732) — only if `supportsTablet: true` in app.json (currently `false`, so skip).
   
   **Capture method:** boot iOS simulator at each device size, navigate through:
   - Screen 1: Login screen ("Sign in with Manus" button visible).
   - Screen 2: Inbox tab (3+ inquiries visible with skill-draft badges).
   - Screen 3: Inquiry detail with chat thread.
   - Screen 4: Bookings tab with status pills.
   - Screen 5: Booking detail with payment summary.
   
   5 screenshots × 3 sizes = 15 PNGs. Use Apple's Devices template overlay if Jeff wants frame-aware marketing screenshots.

3. **Android screenshots (Play Store):**
   - Phone: 1080×1920 minimum (Pixel 7 emulator works).
   - Tablet (7" or 10"): optional, skip for v2.
   - 5 screenshots same as iOS.

4. **Privacy policy page** — `client/public/privacy.html` (NEW, served by Vite from `client/public/`):
   ```html
   <!DOCTYPE html><html lang="zh-TW"><head><title>PACK&GO Privacy Policy</title></head><body>
   <h1>PACK&GO Privacy Policy</h1>
   <p>Last updated: 2026-05-19</p>
   <h2>What we collect</h2>
   <p>We collect: name, email, phone, address, passport info (for visa applications), payment info (via Stripe — we never store card numbers), and booking history.</p>
   <h2>How we use it</h2>
   <p>Booking processing, customer support, marketing emails (opt-out anytime).</p>
   <h2>Sharing</h2>
   <p>With tour operators (Lion Travel, UV) to fulfill bookings. With Stripe for payments. With Manus OAuth for login. Never sold.</p>
   <h2>Your rights (CCPA / GDPR-equivalent)</h2>
   <p>Email jeff@packgo.com to access, correct, or delete your data.</p>
   <h2>Data retention</h2>
   <p>Booking records retained 7 years for tax/audit purposes. Marketing data deleted on unsubscribe.</p>
   <h2>Security</h2>
   <p>HTTPS only. Tokens and passport numbers encrypted at-rest (AES-256-GCM).</p>
   <h2>Contact</h2>
   <p>jeff@packgo.com — PACK&GO LLC, Newark CA.</p>
   </body></html>
   ```
   Verify accessible at `https://packgo09.manus.space/privacy` post-deploy.

5. **Store listings (Chinese + English) — `packages/mobile/store-assets/listings/`:**

   **`zh-TW.md`:**
   ```markdown
   # PACK&GO Admin

   ## 副標 (30 chars)
   PACK&GO 旅行社後台管理

   ## 簡介 (170 chars)
   Pack&Go LLC 旅行社業主專用 — 隨身收件夾、AI agent 對話、客戶訂單管理，全程繁中介面，支援即時推播。

   ## 完整描述 (4000 chars max)
   專為旅行社業主設計的隨身後台 — 客人寄 email 你立刻知道,AI 已經幫你分類好 + 起草回信,只要一個 tap 確認送出。
   
   主要功能:
   - 統一收件夾:Gmail + 網站詢問 + 客製化團行程全部在一個 inbox
   - AI 自動分類:詢價、機票、退款、簽證,5 種子分類,正確率 92%
   - 一鍵生成 PDF:報價單、機票對比、簽證表格,自動寄給客人
   - 即時推播:客人訊息、付款成功、退款請求、agent 升級
   - 訂單管理:篩選狀態、查看明細、付款明細、寄催款 email
   - 安全:護照號碼遮罩、加密儲存、Manus OAuth 雙因素

   給 PACK&GO LLC 業主使用 — 一般客戶請使用 packgo09.manus.space 網站。
   ```

   **`en.md`:** mirror translation, 4000-char limit.

6. **Keywords (100 chars iOS, comma-separated):** `travel agency,admin,booking,inquiry,push notification,packgo,旅行社,後台`

### Phase 2 — Listing setup (~4h Jeff + 2h AI)

7. **Jeff in App Store Connect:**
   - Sign in to https://appstoreconnect.apple.com.
   - "My Apps" → "+" → New App → bundle ID `com.packgo.admin`.
   - Fill app name "PACK&GO Admin", primary language zh-TW.
   - Upload icon 1024×1024.
   - Add 5 screenshots × 3 device sizes.
   - Paste listing copy (zh-TW + en).
   - Set price tier: Free.
   - Set category: Business (primary), Travel (secondary).
   - **Demo account credentials for reviewer:** seed a `appstore-reviewer@packgo.test` user with admin role on staging → provide creds in App Review notes.
   - **App Privacy:** declare data collection (Name, Email, Phone, Other Sensitive Info → Passport; for "App Functionality" linked to user).
   - Submit for review when Phase 3 build is uploaded.

8. **Jeff in Google Play Console:**
   - Sign in to https://play.google.com/console.
   - Create app → package name `com.packgo.admin`.
   - Fill listing (mirror App Store copy).
   - Upload icon + screenshots.
   - **Internal testing track** first: invite Jeff's email + 5 test accounts.
   - Privacy policy URL: `https://packgo09.manus.space/privacy`.
   - Data safety form (Play equivalent of App Privacy): same answers.
   - Target audience: 18+, business users.
   - Content rating: complete IARC questionnaire.
   - Submit when build uploaded.

### Phase 3 — Build + submit (~2h)

9. **Production build via EAS:**
   ```bash
   cd packages/mobile
   eas build --profile production --platform all
   # ~25 min iOS + ~15 min Android
   ```

10. **Submit via EAS:**
    ```bash
    eas submit --profile production --platform ios
    eas submit --profile production --platform android --track internal
    ```
    Verify the iOS build appears in App Store Connect "TestFlight" tab + the Android AAB in Play Console "Internal testing".

### Phase 4 — Review wait + iteration (~7-14 days calendar)

11. **iOS review:** typically 24-48h. Common rejection reasons:
    - **2.1 Information Needed:** reviewer can't sign in → fix demo creds.
    - **5.1.1 Data Collection:** privacy declaration incomplete → revise App Privacy form.
    - **4.0 Design:** uses non-iOS UI patterns → unlikely with current React Native + brand-styled UI.
    - **4.2 Minimum Functionality:** "admin app for our own business" — usually OK but may be flagged as "private use". Mitigation: explain in review notes that it's a B2B internal tool for PACK&GO LLC.

12. **Android review:** typically 24-72h. Less strict than iOS. Common issues:
    - **Permissions justification:** notifications permission justification.
    - **Privacy policy reachability:** verify https URL responds.

13. **Iteration loop:**
    - If rejected: read review feedback → fix → re-submit. Each iteration is 1-3 days.
    - If approved: move from internal to production track when Jeff confident.

## Acceptance Criteria

- [ ] `packages/mobile/store-assets/icon-1024.png` exists (square, non-transparent, brand-accurate).
- [ ] `packages/mobile/store-assets/screenshots-ios/` has 15 PNGs (5 screens × 3 sizes).
- [ ] `packages/mobile/store-assets/screenshots-android/` has 5 PNGs (phone).
- [ ] `packages/mobile/store-assets/listings/zh-TW.md` and `en.md` complete + within character limits.
- [ ] `client/public/privacy.html` deployed and reachable at `https://packgo09.manus.space/privacy`.
- [ ] `packages/mobile/SUBMISSION_CHECKLIST.md` exists — Jeff signs off each item before submit.
- [ ] App Store Connect listing has all assets + listing + demo credentials.
- [ ] Google Play Console listing has all assets + listing + Data Safety form.
- [ ] `eas submit --profile production --platform ios` succeeds; build in TestFlight.
- [ ] `eas submit --profile production --platform android` succeeds; AAB in internal track.
- [ ] App Store review **accepted OR in active review** (acceptance not blocking module merge per v2-plan gate — "submitted" counts).
- [ ] Play Store **internal track live OR production submitted**.
- [ ] No regressions in existing `pnpm test`.

## Deliverable

- New: `packages/mobile/store-assets/icon-1024.png`, `packages/mobile/store-assets/screenshots-ios/*.png` (×15), `packages/mobile/store-assets/screenshots-android/*.png` (×5), `packages/mobile/store-assets/listings/zh-TW.md`, `packages/mobile/store-assets/listings/en.md`, `packages/mobile/SUBMISSION_CHECKLIST.md`, `client/public/privacy.html`
- Modified: `packages/mobile/eas.json` (production submit profile filled), `packages/mobile/app.json` (version bump to 1.0.0 + buildNumber 1)

**Commit message:**

```
chore(mobile-submit): Wave 4 module 4.15 — App Store + Play submission prep

- Store assets: icon-1024, 5×3 iOS screenshots, 5 Android screenshots
- Localized listings (zh-TW + en) within character limits
- Privacy policy at client/public/privacy.html → packgo09.manus.space/privacy
- eas.json production submit profile filled (appleId, ascAppId, GP service account)
- SUBMISSION_CHECKLIST.md per HIG / Play Policy pre-flight
- App version 1.0.0 / buildNumber 1
- Seeded appstore-reviewer demo account for App Review login

Risk #4 mitigation: 7-day buffer + HIG checklist + demo credentials documented

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.15
```

## Rollback

- Revert removes assets + listings + eas.json submit profile. No runtime impact.
- If iOS / Android listing already published: leaving Module 4.15 reverted does NOT remove the live listing — Jeff manually removes via App Store Connect / Play Console.
- Privacy policy page can stay deployed (harmless, no PII risk).

## Manual intervention

- **Jeff (CRITICAL, ~4 hours total):**
  - Apple Developer Program enrollment ($99/yr) if not already done — 30 min + 24-48h verification wait.
  - Google Play Console enrollment ($25) if not already done — 30 min + 24-48h verification.
  - App Store Connect listing setup (Step 7) — 1.5h.
  - Google Play Console listing setup (Step 8) — 1.5h.
  - Approve submission (Step 9-10).
  - Respond to review rejections if any (1-3 iterations × 30 min each).
  - Sign off on each line of `SUBMISSION_CHECKLIST.md` (Phase 1-3) — 30 min total.
- **Jeff (~30 min recurring):** for each rejection, read App Review reply + decide fix path.

## Test plan

**No Vitest** — this module is delivery, not behavior.

**Pre-submission checklist (Jeff signs off):**

- [ ] App icon: square, non-transparent, no rounded corners (iOS adds its own mask).
- [ ] Screenshots: no marketing watermarks; capture inside the app, not mockups.
- [ ] Privacy policy URL responds with content (curl test).
- [ ] Demo account works on production app (test by Jeff before submitting).
- [ ] Bundle ID matches App Store Connect listing exactly.
- [ ] Build version increments (don't submit version=1.0.0 twice).
- [ ] App Privacy form completed (data collection truthful).
- [ ] All HIG / Play Policy red-flag patterns checked: no hidden subscriptions, no misleading screenshots, no "test/debug" UI in screenshots.

**Manual review (post-submission):**
- iOS TestFlight: app installs + login works + 3 critical flows (inbox, send-reply, bookings) verified.
- Google Play internal testing: same.

## Decisions needed (Jeff)

1. **Apple Developer Program already enrolled?** — Confirm yes/no; if no, enroll IMMEDIATELY (24-48h verification). Block Phase 2 until done.
2. **Google Play Console already enrolled?** — Same.
3. **App availability** — public listing OR unlisted (link-only access)? Recommend: **unlisted** for v2 (internal admin tool); make public in v3 if PACK&GO scales to multi-staff. Lock before Phase 2.
4. **Category selection** — Business primary, Travel secondary recommended. Confirm.
5. **Age rating** — 18+ recommended (financial / admin tool, not for kids). Confirm.
6. **Marketing campaign** — out of scope, but flag if Jeff wants a "Coming Soon" mention on `packgo09.manus.space` post-approval.
7. **In-app purchase** — none planned. Confirm.
8. **AB-390 disclosure on store** — California recurring-billing disclosure law applies to website (membership), not admin app. Confirm no admin-app disclosures needed.
