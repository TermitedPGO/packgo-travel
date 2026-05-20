# v2 · Wave 3 · Module 3.6 — Server-side port of `packgo-china-visa` skill

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.5 line 299)
**Audit ref:** v2-audit-2026-05-19.md §B line 128 ("Port packgo-china-visa")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 8h AI + 0min Jeff (no design decisions; mirrors Mac plugin)

## Goal

Port the `packgo-china-visa` skill from Jeff's Claude Code side (`~/.claude/skills/packgo-china-visa/`) to the server so the dispatcher (module 3.4) can execute it when InquiryAgent classifies a `visa_inquiry`. The skill generates a visa checklist + intake form PDF, pre-filled with customer data from `chinaVisaApplications` table if a profile match exists.

Mirror the canonical template style already in `server/services/skills/quoteTemplate.ts`:
- `chinaVisaTemplate.ts` — pure renderer (HTML → PDF via `renderHtmlToPdf`)
- `chinaVisa.ts` orchestrator in `server/agents/skills/` — wraps the renderer with the `SkillOrchestrator` interface (module 3.3)
- After landing, flip `isPorted: true` for `visa_inquiry` in the registry (module 3.2)

## Pre-requisites

- **Module 3.3** (SkillOrchestrator interface) — landed; this skill's orchestrator implements it.
- **Module 3.2** (registry) — landed; this module flips `isPorted` from false → true.
- Read access to the Mac plugin source (Jeff's side): `~/.claude/skills/packgo-china-visa/SKILL.md` + `references/template.html` etc. **If the sub-agent doesn't have shell access to the Mac, supervisor must provide the SKILL.md content inline at dispatch.**
- `server/services/skills/skillPdfService.ts` infra (already exists from quote/deposit ports).

## Inputs (read these before executing)

1. `server/services/skills/quoteTemplate.ts` — **canonical template style reference**. The new `chinaVisaTemplate.ts` should mirror its structure: input type, default constants, `renderXHtml(input): string` function, escape helpers, brand colors from `logoConstants.ts`.
2. `server/services/skills/skillPdfService.ts` — `renderHtmlToPdf` + `escapeHtml` + `LOGO_NAVY_B64`. Use these.
3. `server/services/skills/logoConstants.ts` — brand palette navy/gold.
4. `server/agents/skills/tourComparison.ts` lines 1-200 — example of how the orchestrator file is structured. Skill orchestrator extracts entities from `SkillContext.rawMessage`, calls the template renderer, returns `SkillResult`.
5. **Mac plugin SKILL.md** at `~/.claude/skills/packgo-china-visa/SKILL.md` (supervisor must provide if sub-agent lacks shell access). Key sections to mirror: required intake fields, document checklist, fee schedule, processing time table.
6. `drizzle/schema.ts` — search for `chinaVisaApplications` table. If exists, orchestrator can pre-fill from it.

## Scope (what this module owns)

- New file: `server/services/skills/chinaVisaTemplate.ts` (~250 LOC; pure renderer)
- New file: `server/agents/skills/chinaVisa.ts` (~150 LOC; orchestrator + entity extraction)
- Modified: `server/agents/skills/registry.ts` — flip `visa_inquiry` entry `isPorted: true` + wire `orchestrator: chinaVisaOrchestrator`
- Vitest: `server/services/skills/chinaVisaTemplate.test.ts` (snapshot + 1 missing-field case)
- Vitest: `server/agents/skills/chinaVisa.test.ts` (orchestrator: happy + entity-extraction-fail)

Does NOT:
- Touch InquiryAgent or gmailPipeline (module 3.4 handles dispatch)
- Modify any DB schema (uses existing `chinaVisaApplications` if present, or works without it)

## Procedure

1. **Read the Mac plugin SKILL.md** to enumerate:
   - All intake form fields (passport number, full name, DOB, nationality, occupation, employer, address in China, trip purpose, etc.)
   - Document checklist (passport scan, photo specs 33×48mm, bank statement, employment letter, etc.)
   - Fee table (express vs standard processing)
   - Processing time SLA (e.g., 4 business days standard, 24h express)
   - Bilingual labels (zh-TW + en) used in Jeff's current PDF

2. **Create `server/services/skills/chinaVisaTemplate.ts`** mirroring `quoteTemplate.ts` structure:
   ```ts
   import { escapeHtml, fmtNum, LOGO_NAVY_B64 } from "./skillPdfService";

   export type ChinaVisaInput = {
     applicantFullNameEn: string;
     applicantFullNameZh?: string;
     passportNumber?: string;          // optional — may be filled later
     dateOfBirth?: string;
     nationality: string;              // e.g., "USA"
     occupation?: string;
     employer?: string;
     addressInChina?: string;
     tripPurpose: "tourism" | "business" | "family_visit" | "other";
     intendedEntryDate?: string;
     intendedDurationDays?: number;
     processingTier: "standard" | "express";  // affects fee + SLA shown
     language: "zh-TW" | "en";         // checklist labels
     // Meta
     issuedDate?: string;              // defaults to today
     applicationCode?: string;         // PACK&GO-internal tracking code
   };

   const STANDARD_DOCUMENTS = [
     { zh: "護照正本(剩餘效期 6 個月以上)", en: "Original passport (≥ 6 months validity)" },
     { zh: "近 6 個月 2 吋彩色照片(33×48mm,白底)", en: "Recent 2-inch color photo (33×48mm, white background)" },
     { zh: "簽證申請表(已填妥)", en: "Completed visa application form" },
     { zh: "在職證明 / 學生證明", en: "Employment / student verification letter" },
     { zh: "銀行存款證明(USD $5,000 以上)", en: "Bank statement (USD $5,000+)" },
     { zh: "在中國行程證明(機票 + 飯店訂單)", en: "China itinerary proof (flight + hotel bookings)" },
     // ... mirror SKILL.md exactly
   ];

   const FEES_USD = {
     standard: 185,
     express: 285,
   };

   const SLAS = {
     standard: "4-7 business days",
     express: "1-2 business days",
   };

   export function renderChinaVisaHtml(input: ChinaVisaInput): string {
     // 2-page layout: page 1 intake form, page 2 checklist + fee + SLA
     // Mirror quoteTemplate.ts brand colors (navy header, gold accents)
     // ...
   }
   ```

3. **Create `server/agents/skills/chinaVisa.ts`** orchestrator:
   ```ts
   import { invokeLLM } from "../../_core/llm";
   import {
     renderChinaVisaHtml,
     type ChinaVisaInput,
   } from "../../services/skills/chinaVisaTemplate";
   import { renderHtmlToPdf } from "../../services/skills/skillPdfService";
   import type { SkillContext, SkillOrchestrator, SkillResult } from "./orchestrator";

   async function extractVisaIntake(ctx: SkillContext): Promise<Partial<ChinaVisaInput> | null> {
     // Use invokeLLM with a structured tool to extract:
     //   applicantFullNameEn, nationality, tripPurpose, intendedEntryDate
     // from ctx.rawMessage. If LLM returns < required fields, return null
     // so dispatcher escalates.
     // ...
   }

   function buildDraftBody(ctx: SkillContext, extracted: Partial<ChinaVisaInput>): string {
     // Brief markdown body summarizing what skill produced + asking customer
     // for missing fields if any (passport scan, photo, bank statement).
     // ...
   }

   export const chinaVisaOrchestrator: SkillOrchestrator = {
     id: "packgo-china-visa",
     async run(ctx: SkillContext): Promise<SkillResult> {
       try {
         const extracted = await extractVisaIntake(ctx);
         if (!extracted?.applicantFullNameEn || !extracted?.nationality) {
           return {
             ok: false,
             reason: "Could not extract minimum fields (name + nationality)",
             needsJeff: true,
           };
         }
         const html = renderChinaVisaHtml({
           applicantFullNameEn: extracted.applicantFullNameEn,
           nationality: extracted.nationality,
           tripPurpose: extracted.tripPurpose ?? "tourism",
           processingTier: "standard",
           language: ctx.language === "en" ? "en" : "zh-TW",
           ...extracted,
         });
         const pdf = await renderHtmlToPdf(html);
         return {
           ok: true,
           pdf,
           draftBody: buildDraftBody(ctx, extracted),
           meta: {
             applicantName: extracted.applicantFullNameEn,
             nationality: extracted.nationality,
             processingTier: "standard",
           },
         };
       } catch (err) {
         return {
           ok: false,
           reason: err instanceof Error ? err.message : String(err),
           needsJeff: true,
         };
       }
     },
   };
   ```

4. **Update `server/agents/skills/registry.ts`** — flip the `visa_inquiry` entry:
   ```ts
   ["visa_inquiry", {
     skillId: "packgo-china-visa",
     displayName: "中國簽證 (China Visa)",
     orchestrator: chinaVisaOrchestrator, // now imported
     isPorted: true,
   }],
   ```

5. **Write `chinaVisaTemplate.test.ts`** — 2 snapshot cases:
   - Happy: full input → renders HTML with all 6 checklist items + applicant name
   - Missing fields: passport number absent → renders with `[ 待補 / TBD ]` placeholder
   - Both cases assert: HTML contains brand logo + zh-TW labels by default

6. **Write `chinaVisa.test.ts`** — 3 orchestrator cases:
   - Happy: mocked LLM returns full extraction → `result.ok === true` with PDF buffer > 30KB
   - Insufficient extraction: LLM returns only name (no nationality) → `result.ok === false` + `needsJeff: true`
   - Renderer throw: mock `renderHtmlToPdf` to throw → caught + returns `{ok: false}`

7. **Verify final `pnpm tsc --noEmit` exits 0** — strict typing throughout.

## Acceptance Criteria

- [ ] `server/services/skills/chinaVisaTemplate.ts` exists with `renderChinaVisaHtml`
- [ ] `server/agents/skills/chinaVisa.ts` exists with `chinaVisaOrchestrator`
- [ ] `chinaVisaOrchestrator` conforms to `SkillOrchestrator` interface (tsc verifies)
- [ ] Registry entry for `visa_inquiry` now has `isPorted: true` + correct `orchestrator`
- [ ] Template handles missing fields gracefully (renders `[ 待補 ]` instead of crashing)
- [ ] Default language follows `ctx.language` (zh-TW if not English)
- [ ] PDF output > 30 KB (sanity check that content is non-trivial)
- [ ] `server/services/skills/chinaVisaTemplate.test.ts` exists with 2 passing cases — **§九 hard requirement**
- [ ] `server/agents/skills/chinaVisa.test.ts` exists with 3 passing cases — **§九 hard requirement**
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test chinaVisa` passes

## Deliverable

- New: `server/services/skills/chinaVisaTemplate.ts` (~250 LOC)
- New: `server/agents/skills/chinaVisa.ts` (~150 LOC)
- New: `server/services/skills/chinaVisaTemplate.test.ts` (~80 LOC, 2 cases)
- New: `server/agents/skills/chinaVisa.test.ts` (~120 LOC, 3 cases)
- Modified: `server/agents/skills/registry.ts` (1 entry flipped)

Commit message:
```
feat(agents): Wave 3 Module 3.6 — port packgo-china-visa skill to server

Mirrors quoteTemplate.ts pattern. Renderer (chinaVisaTemplate.ts) is pure
ChinaVisaInput → HTML. Orchestrator (chinaVisa.ts) extracts intake fields
from raw email via LLM tool-call, falls back to placeholder rows for any
missing field. Default zh-TW; English when ctx.language === "en".

Registry entry for visa_inquiry flipped isPorted: true; dispatcher (module
3.4) can now auto-dispatch on InquiryAgent visa_inquiry classification.

5 Vitest cases across renderer (2: snapshot + missing-field) and
orchestrator (3: happy / insufficient-extraction / renderer-throw) per
CLAUDE.md §九.

Refs: docs/refactor/tasks/v2-wave-3/module-3.6-port-packgo-china-visa.md
```

## Rollback

- Single revert. Restoring `isPorted: false` in registry sends visa_inquiry back to the escalation path.

## Manual intervention

- **None** if SKILL.md is provided to sub-agent.
- **YES escalate** if SKILL.md doesn't enumerate enough detail (e.g., fee schedule unclear) — supervisor pulls Jeff's actual PDFs as reference.

## Test plan

- 5 Vitest cases (renderer + orchestrator).
- Wave 3 gate: send a real `visa_inquiry` email to staging → check skillRuns table for the run, fetch the PDF from S3 path, eyeball it. Gate-level, not module-level.

## Decisions needed (Jeff)

1. **Default `processingTier`** — `standard` proposed. Jeff may prefer `express` as default to push higher-margin tier. Default: standard (customer can upgrade later).
2. **Bilingual mode** — current draft chooses one language based on `ctx.language`. Alternative: always render both languages side-by-side in a 2-column layout (Jeff's existing print PDFs may do this). Read SKILL.md to confirm; default to one-language for v2 simplicity.
3. **Fee inclusion in PDF** — proposed: fee shown next to processing tier. Jeff may prefer "Fee on consultation" placeholder. Default: numeric fee.

(Module proceeds with proposed defaults if Jeff defers.)
