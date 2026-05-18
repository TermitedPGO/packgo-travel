# AI Advisor — Pricing & UX Spec

**Status:** Draft v1, awaiting Jeff approval.
**Owner:** Jeff Hsieh
**Last updated:** 2026-05-01
**Sibling doc:** [membership-plan.md](./membership-plan.md)

---

## TL;DR

Two tiers, **bundled into existing Membership Plus** — no separate AI-only SKU.

| Tier | Cost | AI advisor access |
|------|------|--------------------|
| 🆓 **Free / Visitor** | $0 | 5 messages / 30-day rolling window per IP (anon) or per account (logged-in) |
| 💎 **Plus member** | $99/yr (existing) | **Unlimited** AI advisor — no message cap, deeper responses, conversation memory |
| 💎 **Concierge member** | $399/yr (existing) | Unlimited + dedicated human advisor follow-up within 4 hours |

**Why bundle, not standalone $9.99 pass:**
- One Stripe product to maintain (Membership Plus already planned)
- Higher Plus value prop → drives membership conversion
- Avoids "I'll just pay $9.99 for one trip" cherry-picking that erodes annual revenue
- Simpler marketing: "AI 顧問 = 會員福利之一" not "AI 顧問 + 會員 + 機票..."

---

## Free tier — what it actually does

**Goal**: Let visitors try the advisor enough to feel value, then convert to Plus when planning seriously.

| Capability | Free | Plus |
|------------|------|------|
| Message cap | 5 / 30 days | unlimited |
| Response length | ≤ 250 chars | ≤ 1500 chars |
| Markdown / Streamdown | ❌ plain text | ✅ headers, lists, tables, links |
| Conversation memory | session-only (browser tab) | persists across sessions, devices |
| LLM model | Haiku ($0.25/1M tokens) | Sonnet ($3/1M tokens) |
| Skill triggers | ❌ disabled | ✅ enabled (skill-based personalization) |
| Suggested replies | ✅ enabled (drives engagement) | ✅ enabled |
| PDF itinerary export | ❌ | ✅ one-click |
| Cross-language | zh-TW only | zh-TW + zh-CN + en |

**Counter UI**: Subtle "本月剩 3/5 則" pill above input. Not aggressive. At 5/5: input disabled, paywall card appears in chat.

---

## Paywall trigger — UX rules

When free user hits 5/5:

1. Input field disabled with placeholder: "本月免費額度已用完"
2. Inline card in chat (NOT modal, not popover): "升級會員享無限 AI 顧問 → 看會員方案"
3. CTA button: secondary outline, links to `/membership`
4. **No dark patterns**: no countdown timer, no fake scarcity, no "只剩 1 名" messaging
5. Free quota resets every 30 days (rolling, not calendar month)

**Anonymous vs logged-in**:
- Anonymous: rate-limited by IP + cookie hash (cookie clears = fresh quota; trade-off accepted, churn cost minimal at this scale)
- Logged-in: rate-limited by user ID (cookie clearing doesn't help)

---

## Cost analysis (back-of-envelope)

Assume 1000 monthly visitors, 200 try the AI advisor:

**Free tier cost (Haiku)**:
- 200 users × 5 msgs × ~500 tokens out × $0.25/1M = **$0.125/month** ≈ free
- Rate-limit prevents abuse beyond 5

**Plus member cost (Sonnet)**:
- 50 Plus members × 30 msgs/mo × ~1500 tokens out × $3/1M = **$6.75/month**
- 50 × $99/yr ÷ 12 = $412/mo revenue → **AI cost = 1.6% of MRR** ✓

If a single Plus member abuses (1000 msgs/mo): cost = $4.50, still profitable. Hard cap at 100 msgs/day per account to avoid runaway.

---

## Implementation phases

### Phase 1 — Free tier rate limiting (~3 days)
- [ ] Add `aiAdvisorUsage` Drizzle table: `ipHash | userId | messageCount | windowStart`
- [ ] tRPC middleware: count message, check 5-msg limit, return `quotaExceeded: true`
- [ ] Update `AITravelAdvisorDialog.tsx`:
  - Add usage counter pill (visible at 3/5+)
  - Render paywall card when quotaExceeded
  - Disable input at limit
- [ ] Switch free-tier LLM call to Haiku in `server/services/aiQuoteService.ts`

### Phase 2 — Plus member benefits (~3 days)
- [ ] Check `user.tier === 'plus'` in middleware → bypass rate limit
- [ ] Plus members get Sonnet + Streamdown markdown rendering
- [ ] Add `subscriptionStatus` query to AI dialog header (show 💎 badge)
- [ ] Conversation memory: persist `aiAdvisorMessages` table per user

### Phase 3 — PDF export + Concierge handoff (~5 days)
- [ ] Plus: "Export this conversation as PDF itinerary" button
- [ ] Concierge: After 5+ messages, prompt "預約 Jeff 一對一諮詢" → ContactUs prefilled with chat summary

**Dependency**: Membership Plus tier must ship first (per `membership-plan.md` Phase 1 MVP).

---

## What this is NOT

- ❌ NOT a separate $9.99 AI-only subscription (rejected — fragments membership)
- ❌ NOT pay-per-message (rejected — micro-transactions hurt UX)
- ❌ NOT free-forever-unlimited (rejected — abuse + Anthropic bill)
- ❌ NOT GPT/Gemini under the hood (Claude only, per CLAUDE.md `server/_core/llm.ts`)

---

## Open questions for Jeff

1. **5 messages/month enough for free trial?** Could test 3 vs 5 vs 7 with A/B if traffic warrants
2. **Should anonymous users see the 💎 upgrade prompt or only logged-in?** (Current spec: both, anonymous gets "註冊 + 升級" combo CTA)
3. **Concierge tier — dedicated AI persona that always introduces itself as "Jeff's AI assistant"?** Or stay generic PACK&GO penguin?
4. **Decline policy**: if user chats for 4 messages then leaves, do unused 1 message rolls forward 30 days? (Current spec: yes, true rolling window)

---

## Decision log

- 2026-05-01: Bundled with Plus membership instead of standalone — Jeff approved one-vs-many SKU principle
- 2026-05-01: 5 messages/30-day-rolling-window chosen as free quota — generous enough to test, not abusable

