# M6 — TourDetail rich content render

> Blocked by M5. Parallel with M7+M8.

## Goal
Render 4 new content sections in TourDetail page per design.md §5.

## Files
- `server/routers/toursRouter.ts` (extend: add `getSupplierDetail` query)
- `client/src/pages/TourDetailPeony.tsx` (extend with 4 new section components)
- `client/src/components/tour-detail/RealItineraryDays.tsx` (new)
- `client/src/components/tour-detail/PriceTermsSection.tsx` (new)
- `client/src/components/tour-detail/NoticesSection.tsx` (new)
- `client/src/components/tour-detail/OptionalItemsSection.tsx` (new)
- `client/src/locales/{zh-TW,en,ja,ko}.ts` (add new copy keys)

## Checklist
- [ ] tRPC: `tours.getSupplierDetail(supplierProductId)` returns `supplierProductDetails` row
- [ ] If tour has linked supplierProductId, fetch detail in TourDetailPeony useQuery
- [ ] `<RealItineraryDays>` renders day-by-day with attractions / hotels / meals — read `detail.itineraryParsed.days`
- [ ] `<PriceTermsSection>` renders included / excluded / payment / cancellation
- [ ] `<NoticesSection>` renders visa / insurance / baggage / general (rounded-xl cards)
- [ ] `<OptionalItemsSection>` renders list with price chips
- [ ] Fallback: if `parseStatus !== 'parsed'`, render existing LLM-生成 TourItinerary (no regression)
- [ ] All new copy in 4 locales (zh-TW / en / ja / ko) — pre-commit i18n parity check
- [ ] Round-corner規範: all cards `rounded-xl`, badges `rounded-md`, images `rounded-xl`
- [ ] Vitest: RTL tests for each new section with mock detail data + parseStatus enum coverage

## Done when
- 1 Lion + 1 UV tour page renders rich content end-to-end
- Fallback works for products without detail
- i18n 100% parity
