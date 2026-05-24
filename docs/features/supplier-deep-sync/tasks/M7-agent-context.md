# M7 — InquiryAgent context wire

> Blocked by M5. Parallel with M6+M8.

## Goal
InquiryAgent reads supplier detail when matching tour candidates per design.md §6.

## Files
- `server/agents/InquiryAgent/buildSystemPrompt.ts` (extend) OR equivalent prompt builder
- `server/agents/InquiryAgent/InquiryAgent.test.ts` (extend with snapshot)
- `server/db/supplierDetail.ts` (new helper: `getSupplierProductDetail(id)`)

## Checklist
- [ ] Helper `getSupplierProductDetail(supplierProductId)` returns full detail row (with parsed JSON)
- [ ] InquiryAgent system prompt: for top 3 matched candidates (already exists in agent), fetch detail
- [ ] Inject itinerary days summary + price terms (included/excluded) into prompt
- [ ] Token budget: cap at 3 candidates × ~500 tokens each = ~1500 tokens added
- [ ] Skip detail if `itineraryParseStatus !== 'parsed'`
- [ ] Vitest snapshot: prompt with 3 candidates with detail vs without
- [ ] Manual smoke test: send InquiryAgent a "9 月東京 5 天 hotel 是什麼" query → expect concrete hotel names in reply

## Done when
- Snapshot test passes
- Smoke test answers correctly with hotel names from detail (not LLM 腦補)
