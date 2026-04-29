# PACK&GO Membership Program — Planning Doc

**Status:** Planning. Not implemented.
**Owner:** Jeff Hsieh (single-person shop)
**Last updated:** 2026-04-28

## Why a membership program

PACK&GO is a high-touch travel concierge competing with mass-market players (Trip.com,
Lion Travel) by being the boutique alternative for North-American Chinese diaspora.
Membership gives:

1. **Repeat-customer leverage**: Travel is annual, not weekly — without a membership tie,
   we have one-shot relationships. A membership keeps the brand top-of-mind year-round.
2. **Differentiation**: Lion / 雄獅 has a points program (L.I.O.N. 雄獅幣 1 點 = 1 元).
   Without a comparable program, returning customers default to the bigger player.
3. **Cash-flow predictability**: Annual fee = recurring revenue independent of booking
   seasonality.

## Tier design (proposed)

| Tier | Annual fee | Benefits |
|---|---|---|
| **Free** | $0 | Email newsletter, post-trip photo book (one per year), early-access tour announcements (24h before public) |
| **PACK&GO Plus** | $99/yr | All free + 5% off all bookings, no-fee booking changes within 60d of departure, priority support (response < 4h), exclusive twice-a-year private group tour |
| **PACK&GO Concierge** | $399/yr | All Plus + 10% off, free flight rebooking once/yr, dedicated travel advisor, white-glove airport service (paired with Trip.com affiliate program) |

Pricing rationale:
- $99 break-even: customer must save ≥$99 in any 1 trip (tours average $3K-5K, so 5% = $150-250)
- $399 break-even: 1 trip per year (10% × $4K avg = $400)

## What's already in place

| Feature | File / Module | Notes |
|---|---|---|
| User account + login (Manus OAuth) | `server/_core/cookies.ts`, `client/_core/hooks/useAuth.ts` | Foundation ready |
| Booking history per user | `server/routers.ts` `bookings.list` | Per-user query exists |
| Newsletter subscriptions | `drizzle/schema.ts` `newsletterSubscribers` | Free tier benefit ready |
| Discount code engine | `server/email.ts` (BACK5, REVIEW5) | Plug in 5%/10% codes for Plus/Concierge |
| Booking cancellation | `server/routers.ts` `bookings.cancel` | Need to add "no-fee" rule based on tier |

## What's missing

### Phase 1 (MVP, ~1 week)
- [ ] Add `tier` enum field to `users` table: `'free' | 'plus' | 'concierge'`
- [ ] Add `tierExpiresAt` timestamp
- [ ] Create `/membership` landing page with tier comparison table
- [ ] Stripe subscription product (recurring annual)
- [ ] On successful subscription webhook → set `users.tier`, expiry +1y
- [ ] Apply automatic discount in checkout based on tier (booking total × 0.95 for Plus, ×0.90 for Concierge)

### Phase 2 (~1 month)
- [ ] Tier badge in header (replace "Login/Register" with tier indicator when logged in)
- [ ] Member-only tour pricing display ("Members save $X")
- [ ] Email automation: tier-renewal reminder 14d before expiry
- [ ] Concierge dashboard (admin view to see all paying members)
- [ ] Annual photo book generation (PDF mailed each Dec — for free + above tiers)

### Phase 3 (~3 months)
- [ ] Referral bonus: each referred friend who books = 1 month free Plus
- [ ] Private members-only tours (1-2 per year, exclusive itineraries)
- [ ] Loyalty points (every $100 spent = 1 point, 100 points = $50 voucher)
- [ ] Mobile app push notifications for member exclusives

## Risks / decisions to make

1. **Pricing sensitivity**: $99 / $399 is high-anchor compared to Lion's free L.I.O.N. program.
   Consider $49 entry tier ("PACK&GO Light") for low-frequency customers.

2. **Stripe recurring complexity**: webhook handling for tier upgrades, downgrades,
   refunds, failed payments. Already handle payment webhooks for booking deposits, so
   incremental complexity is low.

3. **Operational load**: "priority support < 4h" SLA needs to be honored — at single-person
   scale, may break during travel busy seasons. Soft-launch to 50 members first.

4. **Cannibalization**: 10% discount on Concierge means we eat margin on highest-value
   customers. Verify tour cost structure has 10%+ headroom — current estimate: avg margin
   is 18-25% on group tours, so 10% off still leaves 8-15% — tight but workable.

5. **Legal**: California Seller of Travel rules (CST #2166984) may have specific
   disclosures for prepaid memberships. Consult before launching paid tier.

## Suggested launch sequence

1. Week 1: Build Phase 1 MVP (free tier first, then Plus)
2. Week 2: Soft-launch Plus to 20 existing high-value customers manually
3. Week 4: Open Plus public + announce in newsletter
4. Month 3: Launch Concierge if Plus has 30+ paid members
5. Month 6: Phase 2 features (renewal automation, member-only pricing display)

## Out of scope (for now)

- Multi-user families (1 membership = multiple travelers under same account) — too
  complex for v1
- Cross-border tier (US member traveling from Asia) — defer until international
  expansion
- Mobile app — web-only at launch
- Crypto/Web3 stuff — none
