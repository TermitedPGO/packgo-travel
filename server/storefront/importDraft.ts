/**
 * Batch P1b — draft creation / import write paths for the storefront
 * contract tables (productVersions / itineraryVersions / itineraryDays /
 * itineraryStops / feeContracts / feeItems).
 *
 * Admin-only, called exclusively from server/routers/storefrontPublish.ts
 * (adminProcedure). The read-only public layer (queries.ts / storefront.ts)
 * is FROZEN and untouched — this module only writes DRAFT rows; the public
 * chain never sees them until publishProductVersion() flips statuses.
 *
 * HONESTY RULES (P1a frozen contracts, carried into the write path):
 *   - Imported drafts carry honest provenance. tours.dailyItinerary /
 *     tours.itineraryDetailed are AI-pipeline artifacts whose supplier
 *     provenance is NOT provable from the row itself, so EVERY import via
 *     this path is sourceStatus='demo_estimate' — never 'source_document',
 *     never 'supplier_confirmed'. Upgrading provenance is a separate,
 *     adjudicated future action, not an import side effect.
 *   - Imported meals make NO claim: every meal field is written as
 *     'pending' (待確認), regardless of any meal text in the source JSON
 *     (Jeff 2026-07-22 ruling — see the meal section note below).
 *   - Stays default propertyStatus='proposed_or_equivalent' (「同級」),
 *     bookingStatus='unconfirmed'. Star ratings parsed from text are
 *     system='unverified' + sourceStatus='itinerary_standard_unverified'.
 *   - Media is ALWAYS mediaSourceStatus/mediaStatus='demo_placeholder' +
 *     mediaRightsStatus='prototype_only'. Supplier image URLs present in
 *     the source JSON (image/imageAlt fields) are deliberately IGNORED —
 *     supplier images must never be copied into the customer-facing
 *     contract tables (紅線).
 *   - Unparseable input produces FEWER rows, never invented ones.
 *
 * SUPPLIER-COST FIREWALL (紅線): this module never reads
 *   supplierDepartures.agentPrice, any supplierCost-like column, or any
 *   supplier image column. The tours SELECT is a narrow explicit
 *   projection (id / productCode / dailyItinerary / itineraryDetailed),
 *   and every write input passes assertNoForbiddenPublicFields() so
 *   agentPrice/supplierCost keys can never be smuggled in at any depth.
 *
 * Fee import: contract sourceStatus is RESTRICTED to
 *   'demo_estimate' | 'supplier_quote' | 'awaiting_supplier_quote'.
 *   'confirmed' is deliberately NOT settable through this import path:
 *   confirmation asserts adjudicated supplier evidence (it unlocks the
 *   published-zero-fee gate in the frozen feeDisclosure module) and must
 *   come from a separate future confirmation action with its own audit
 *   trail — never from a bulk import.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  feeContracts,
  feeItems,
  itineraryDays,
  itineraryStops,
  itineraryVersions,
  productVersions,
  tours,
  type InsertItineraryDay,
  type InsertItineraryStop,
} from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";
import {
  assertNoForbiddenPublicFields,
  canonicalCurrencyCode,
} from "./availabilityBucket";

const ITINERARY_SCHEMA_VERSION = "packgo.itinerary.v1";

// ── Input schemas (single source of truth — the router reuses these) ─────

const idInput = z.number().int().positive().max(2_147_483_647);

/**
 * One draft fee line. `.strict()` is load-bearing: unknown keys —
 * including agentPrice / supplierCost or any other supplier-cost-shaped
 * field — are REJECTED, not silently stripped, so a caller that tries to
 * feed cost data through the fee import gets a loud validation error.
 *
 * sourceStatus deliberately EXCLUDES 'confirmed' (see module header).
 */
export const feeItemDraftInputSchema = z
  .object({
    feeId: z.string().min(1).max(64),
    category: z.enum(["mandatory", "tips", "self", "optional"]),
    labelZh: z.string().min(1).max(255),
    labelEn: z.string().min(1).max(255),
    /** INTEGER ISO-4217 minor units (frozen money rule). Never floats. */
    amountMinorUnits: z
      .number()
      .int({ message: "amountMinorUnits must be an integer (minor units)" })
      .nonnegative(),
    currency: z.string().refine(
      (c) => {
        try {
          canonicalCurrencyCode(c);
          return true;
        } catch {
          return false;
        }
      },
      { message: "unknown or malformed ISO-4217 currency code (fail-closed)" },
    ),
    unit: z.enum(["per_person", "per_booking"]),
    includedInPackgoCharge: z.boolean().default(false),
    requiredForTrip: z.boolean().default(false),
    payeeType: z.enum([
      "airline",
      "government",
      "guide_and_driver",
      "leader_and_driver",
      "restaurant_or_traveler_choice",
      "packgo_or_hotel",
      "local_supplier",
      "ticket_supplier",
      "other",
    ]),
    paymentTiming: z.enum(["before_departure", "during_trip", "if_selected"]),
    // 'confirmed' NOT offered — import can only claim estimate/quote.
    sourceStatus: z.enum(["demo_estimate", "supplier_quote"]),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

const createFeeContractDraftBodySchema = z
  .object({
    tourId: idInput,
    productVersionId: idInput,
    contract: z
      .object({
        /** Stable public contract id; generated when omitted. */
        contractId: z.string().min(1).max(64).optional(),
        // 'confirmed' NOT settable via import — separate adjudicated action.
        sourceStatus: z.enum([
          "demo_estimate",
          "supplier_quote",
          "awaiting_supplier_quote",
        ]),
        originMarket: z.string().min(1).max(32).optional(),
        displayRegion: z.string().min(1).max(64).optional(),
        validFrom: z.date().optional(),
        validTo: z.date().optional(),
        destinationJurisdictions: z.array(z.string().min(2).max(8)).max(32).optional(),
      })
      .strict()
      // Window integrity (Codex 2026-07-21 P2-2, layer 1 of 2): a reversed
      // validity window (validFrom > validTo) can never match any date —
      // reject it at input time. publish.ts re-checks (defense in depth).
      .refine(
        (c) =>
          !(
            c.validFrom instanceof Date &&
            c.validTo instanceof Date &&
            c.validFrom.getTime() > c.validTo.getTime()
          ),
        { message: "reversed validity window: validFrom must be <= validTo" },
      ),
    fees: z
      .array(feeItemDraftInputSchema)
      .max(200)
      .superRefine((fees, ctx) => {
        const seen = new Set<string>();
        for (const fee of fees) {
          if (seen.has(fee.feeId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate feeId "${fee.feeId}" in one contract`,
            });
          }
          seen.add(fee.feeId);
        }
      }),
  })
  .strict();

/**
 * Shared exported ingress schema — the single schema BOTH the router
 * (server/routers/storefrontPublish.ts `.input(...)`) and this module's
 * createFeeContractDraft() parse with.
 *
 * FIREWALL LAYER 0 — RAW-preserving pre-parse deep scan at the REAL
 * ingress (Codex 2026-07-21 P2-1, round 3): tRPC runs `schema.parse(raw)`
 * in the router BEFORE the module ever sees input, so the module's own
 * raw scan alone cannot protect the admin path if `.strict()` ever
 * regressed to zod's default key-stripping (the router parse would strip
 * agentPrice/supplierCost and hand the module a pre-cleaned object).
 * This wrapper makes the FIRST parse anywhere — router or module — deep-
 * scan the ORIGINAL untouched object (frozen guard from
 * availabilityBucket.ts, every depth) before any zod object validation
 * can strip or coerce anything; only then is the value piped into the
 * strict body schema. Both layers stay load-bearing on their own:
 * removing this raw scan leaves `.strict()` rejecting cost keys (with a
 * different error identity), and reverting `.strict()` leaves this scan
 * rejecting them on the raw object.
 */
export const createFeeContractDraftInputSchema = z
  .unknown()
  .superRefine((raw, ctx) => {
    try {
      assertNoForbiddenPublicFields(raw);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden cost/seat field in raw fee contract input (raw ingress pre-parse deep scan): ${
          err instanceof Error ? err.message : String(err)
        }`,
        fatal: true,
      });
    }
  })
  .pipe(createFeeContractDraftBodySchema);

export type CreateFeeContractDraftInput = z.infer<
  typeof createFeeContractDraftInputSchema
>;

// ── Pure parse helpers (exported for direct unit testing) ────────────────

/**
 * Stable public itinerary id: sanitized tours.productCode, or TOUR-<id>
 * when no product code exists. Truncated so `<id>-D01` day ids fit the
 * 64-char column.
 */
export function deriveItineraryId(tour: { id: number; productCode: string | null }): string {
  const fromCode = (tour.productCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return fromCode || `TOUR-${tour.id}`;
}

/**
 * MEALS — ADJUDICATED NO-CLAIM MODEL (replaces the former mapMealText).
 *
 * Imports make NO meal claims. Free-text meal parsing was adjudicated OUT
 * (Jeff 2026-07-22 ruling after Codex rounds 1-5 showed adversarial
 * free-text classification cannot be made honest): every imported meal is
 * 'pending' until a human explicitly sets it in the admin backend
 * (separate batch). 'pending' = no claim — always honest.
 *
 * Concretely: the day-write path below stamps mealBreakfast / mealLunch /
 * mealDinner = 'pending' unconditionally, and the parser deliberately
 * never reads the source JSON's `meals` field at all.
 */

/**
 * Conservative star-rating parse from accommodation free text (e.g.
 * 「五星豪華酒店」/ "4-star"). Anything parsed is an UNVERIFIED claim.
 */
export function parseStayRating(accommodation: unknown): number | null {
  if (typeof accommodation !== "string") return null;
  const zh = accommodation.match(/([二三四五])\s*星/);
  if (zh) return { 二: 2, 三: 3, 四: 4, 五: 5 }[zh[1] as "二" | "三" | "四" | "五"] ?? null;
  const num = accommodation.match(/([2-5])\s*(?:星|[- ]?star)/i);
  return num ? Number(num[1]) : null;
}

export interface ParsedItineraryStop {
  title: string;
  description: string | null;
}

export interface ParsedItineraryDay {
  dayNumber: number;
  title: string | null;
  // NO meal fields: parsing makes no meal claims (adjudicated model above).
  accommodation: string | null;
  stops: ParsedItineraryStop[];
}

/** True when the accommodation text says "no hotel tonight" honestly. */
function isNoStay(accommodation: string | null): boolean {
  if (accommodation === null) return false;
  return /機上|夜宿機上|溫暖的家|甜蜜的家|home/i.test(accommodation);
}

/**
 * Defensive parse of tours.itineraryDetailed / tours.dailyItinerary
 * (JSON array of {day, title, activities:[{title, description, ...}],
 * meals:{breakfast,lunch,dinner}, accommodation} — see drizzle/schema.ts
 * tours column comments and server/agents/itineraryUnifiedAgent.ts).
 *
 * Honest-fewer-rows: entries without a valid positive integer `day`, or
 * with a duplicate day number, are SKIPPED — never assigned an invented
 * position. Activities without a non-empty title are skipped. meals /
 * image / imageAlt / price-ish fields in the JSON are ignored entirely
 * (meals per the adjudicated no-claim model above — never read).
 */
export function parseItineraryDays(raw: string | null): ParsedItineraryDay[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // Tolerate one level of double-encoding (legacy pipeline artifact).
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const days: ParsedItineraryDay[] = [];
  const seenDays = new Set<number>();
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    // Honest day validation (Codex 2026-07-21 P1-3): ONLY a genuine
    // positive-integer number, or a legacy plain-digit numeric string
    // (explicit /^[1-9][0-9]{0,2}$/ format — the AI pipeline historically
    // emitted "1"/"2"). Boolean / array / object / float / exotic-string
    // coercion is SKIPPED (fewer honest rows, never an invented Day 1).
    const rawDay = e.day;
    let dayNumber: number | null = null;
    if (typeof rawDay === "number" && Number.isInteger(rawDay) && rawDay > 0 && rawDay <= 365) {
      dayNumber = rawDay;
    } else if (typeof rawDay === "string" && /^[1-9][0-9]{0,2}$/.test(rawDay.trim())) {
      const n = Number(rawDay.trim());
      if (n <= 365) dayNumber = n;
    }
    if (dayNumber === null) continue;
    if (seenDays.has(dayNumber)) continue; // duplicate day claim — keep first
    seenDays.add(dayNumber);

    const stops: ParsedItineraryStop[] = [];
    if (Array.isArray(e.activities)) {
      for (const a of e.activities) {
        if (a === null || typeof a !== "object" || Array.isArray(a)) continue;
        const act = a as Record<string, unknown>;
        const title = typeof act.title === "string" ? act.title.trim() : "";
        if (!title) continue; // no honest name ⇒ no stop row
        stops.push({
          title: title.slice(0, 255),
          description:
            typeof act.description === "string" && act.description.trim() !== ""
              ? act.description.trim()
              : null,
        });
      }
    }
    days.push({
      dayNumber,
      title: typeof e.title === "string" && e.title.trim() !== "" ? e.title.trim() : null,
      accommodation:
        typeof e.accommodation === "string" && e.accommodation.trim() !== ""
          ? e.accommodation.trim()
          : null,
      stops,
    });
  }
  days.sort((a, b) => a.dayNumber - b.dayNumber);
  return days;
}

/** ASCII slug for stop ids; empty string when nothing survives. */
function asciiSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ── DB helpers ───────────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable — storefront draft writes require a database",
    });
  }
  return db;
}

/**
 * SHARED WRITE-SERIALIZATION CONVENTION (Codex 2026-07-21 P1-1).
 *
 * Every storefront-contract write flow — createDraftProductVersion,
 * importItineraryDraft, createFeeContractDraft, and publishProductVersion
 * (publish.ts imports this helper) — serializes on the SAME tour-level DB
 * lock: `SELECT … FROM tours WHERE id = ? FOR UPDATE`, taken as the FIRST
 * statement inside the write transaction. MySQL/TiDB compatible (plain
 * InnoDB row lock — no GET_LOCK, which TiDB historically lacked).
 *
 * Rules of the convention:
 *   1. Lock ordering is always the tours row FIRST, then children —
 *      callers must not take child row locks before calling this
 *      (deadlock freedom). A caller that only knows a productVersionId
 *      does a plain non-locking peek to learn the tourId, then locks.
 *   2. Every draft/status precondition read AFTER the lock uses
 *      FOR UPDATE too, so under REPEATABLE READ the checks see current
 *      committed data, not a stale snapshot.
 *   3. Two concurrent publishes of one tour, or a publish racing an
 *      import, therefore serialize: the second waits on this row lock
 *      and re-reads state the first has already committed.
 *
 * Doubles as the tour-existence check. The projection stays the narrow
 * explicit four columns — NEVER widen it to include supplier cost or
 * image columns (supplier-cost firewall, module header).
 */
export async function lockTourForWrite(tx: DrizzleTx, tourId: number) {
  const rows = await tx
    .select({
      id: tours.id,
      productCode: tours.productCode,
      dailyItinerary: tours.dailyItinerary,
      itineraryDetailed: tours.itineraryDetailed,
    })
    .from(tours)
    .where(eq(tours.id, tourId))
    .limit(1)
    .for("update");
  const tour = rows[0];
  if (!tour) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Tour ${tourId} not found` });
  }
  return tour;
}

async function requireDraftProductVersion(
  db: DrizzleTx,
  tourId: number,
  productVersionId?: number,
) {
  if (productVersionId !== undefined) {
    const rows = await db
      .select()
      .from(productVersions)
      .where(eq(productVersions.id, productVersionId))
      .limit(1)
      .for("update"); // post-lock status check must see current data
    const pv = rows[0];
    if (!pv) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `productVersion ${productVersionId} not found`,
      });
    }
    if (pv.tourId !== tourId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `productVersion ${productVersionId} does not belong to tour ${tourId}`,
      });
    }
    if (pv.status !== "draft") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `productVersion ${productVersionId} is '${pv.status}' — only draft versions accept imports (publish a corrected NEW version instead)`,
      });
    }
    return pv;
  }
  const rows = await db
    .select()
    .from(productVersions)
    .where(and(eq(productVersions.tourId, tourId), eq(productVersions.status, "draft")))
    .orderBy(desc(productVersions.versionNumber))
    .limit(1)
    .for("update"); // post-lock status check must see current data
  const pv = rows[0];
  if (!pv) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Tour ${tourId} has no draft productVersion — call createDraftProductVersion first`,
    });
  }
  return pv;
}

// ── 1. Draft product version ─────────────────────────────────────────────

export interface CreatedDraftProductVersion {
  id: number;
  tourId: number;
  versionNumber: number;
  status: "draft";
}

/**
 * Create the next draft productVersion for a tour (versionNumber =
 * previous max + 1, status 'draft'). Errors when the tour is missing.
 *
 * Runs inside one transaction under the shared tour-level write lock
 * (lockTourForWrite), so the max-versionNumber read and the insert
 * cannot race another create/import/publish of the same tour.
 */
export async function createDraftProductVersion(params: {
  tourId: number;
  createdBy: number;
}): Promise<CreatedDraftProductVersion> {
  const db = await requireDb();
  return db.transaction(async (tx: DrizzleTx) => {
    await lockTourForWrite(tx, params.tourId);

    const latest = await tx
      .select({ versionNumber: productVersions.versionNumber })
      .from(productVersions)
      .where(eq(productVersions.tourId, params.tourId))
      .orderBy(desc(productVersions.versionNumber))
      .limit(1)
      .for("update");
    const versionNumber = (latest[0]?.versionNumber ?? 0) + 1;

    const result = await tx.insert(productVersions).values({
      tourId: params.tourId,
      versionNumber,
      status: "draft",
      createdBy: params.createdBy,
    });
    const id = Number(result[0].insertId);
    return { id, tourId: params.tourId, versionNumber, status: "draft" };
  });
}

// ── 2. Itinerary draft import ────────────────────────────────────────────

export interface ImportItineraryDraftResult {
  itineraryVersionId: number;
  itineraryId: string;
  versionNumber: number;
  productVersionId: number;
  sourceStatus: "demo_estimate";
  dayCount: number;
  stopCount: number;
  /** true when a prior draft itineraryVersion's children were replaced. */
  replacedExistingDraft: boolean;
}

/**
 * Import the tour's existing dailyItinerary/itineraryDetailed JSON into a
 * DRAFT itineraryVersion (+ days + stops) under a draft productVersion.
 *
 * Idempotent per version: when the target draft productVersion already
 * has a draft itineraryVersion, THAT draft's children (days + stops) are
 * deleted and re-created inside one transaction; the itineraryVersion row
 * and its versionNumber are reused. Published/superseded versions and
 * their children are never touched (append-only history).
 */
export async function importItineraryDraft(params: {
  tourId: number;
  productVersionId?: number;
  createdBy: number;
}): Promise<ImportItineraryDraftResult> {
  const db = await requireDb();

  return db.transaction(async (tx: DrizzleTx) => {
    // Serialization convention: tour lock FIRST, then every precondition
    // is (re-)read inside the transaction — a publish committed while we
    // waited on the lock is seen here and rejects the import (no draft
    // child can slip in under an already-published parent).
    const tour = await lockTourForWrite(tx, params.tourId);
    const pv = await requireDraftProductVersion(tx, params.tourId, params.productVersionId);

    const itineraryId = deriveItineraryId(tour);
    // Prefer the richer itineraryDetailed; fall back to dailyItinerary
    // (server/db/tour.ts mirrors the two columns). Both unparseable ⇒ [].
    let parsedDays = parseItineraryDays(tour.itineraryDetailed);
    if (parsedDays.length === 0) parsedDays = parseItineraryDays(tour.dailyItinerary);

    const existingDrafts = await tx
      .select()
      .from(itineraryVersions)
      .where(
        and(
          eq(itineraryVersions.productVersionId, pv.id),
          eq(itineraryVersions.status, "draft"),
        ),
      )
      .orderBy(desc(itineraryVersions.versionNumber))
      .limit(1)
      .for("update");
    const existingDraft = existingDrafts[0];

    let itineraryVersionId: number;
    let versionNumber: number;
    let replacedExistingDraft = false;

    if (existingDraft) {
      // Idempotent re-import: replace THIS draft version's children only.
      itineraryVersionId = existingDraft.id;
      versionNumber = existingDraft.versionNumber;
      replacedExistingDraft = true;
      const oldDays = await tx
        .select({ id: itineraryDays.id })
        .from(itineraryDays)
        .where(eq(itineraryDays.itineraryVersionId, itineraryVersionId))
        .for("update");
      const oldDayIds = oldDays.map((d: { id: number }) => d.id);
      if (oldDayIds.length > 0) {
        await tx
          .delete(itineraryStops)
          .where(inArray(itineraryStops.itineraryDayId, oldDayIds));
        await tx
          .delete(itineraryDays)
          .where(eq(itineraryDays.itineraryVersionId, itineraryVersionId));
      }
      // Re-imports stay honest: provenance is re-stamped demo_estimate.
      await tx
        .update(itineraryVersions)
        .set({ sourceStatus: "demo_estimate", schemaVersion: ITINERARY_SCHEMA_VERSION })
        .where(eq(itineraryVersions.id, itineraryVersionId));
    } else {
      const latest = await tx
        .select({ versionNumber: itineraryVersions.versionNumber })
        .from(itineraryVersions)
        .where(eq(itineraryVersions.itineraryId, itineraryId))
        .orderBy(desc(itineraryVersions.versionNumber))
        .limit(1)
        .for("update");
      versionNumber = (latest[0]?.versionNumber ?? 0) + 1;
      const inserted = await tx.insert(itineraryVersions).values({
        productVersionId: pv.id,
        schemaVersion: ITINERARY_SCHEMA_VERSION,
        itineraryId,
        versionNumber,
        // Not provably supplier-sourced ⇒ honest demo_estimate (header).
        sourceStatus: "demo_estimate",
        status: "draft",
      });
      itineraryVersionId = Number(inserted[0].insertId);
    }

    let stopCount = 0;
    for (const day of parsedDays) {
      const dayId = `${itineraryId}-D${String(day.dayNumber).padStart(2, "0")}`;
      const noStay = isNoStay(day.accommodation);
      const ratingValue = noStay ? null : parseStayRating(day.accommodation);
      const dayValues: InsertItineraryDay = {
        itineraryVersionId,
        dayId,
        dayNumber: day.dayNumber,
        city: null, // not reliably parseable from the blob — no claim made
        cityEn: null,
        summary: day.title,
        sourceStatus: "demo_estimate",
        movementDurationMinutes: null, // never guessed
        movementStatus: "pending",
        // Adjudicated no-claim model (Jeff 2026-07-22): meal text in the
        // source JSON is never parsed and never claimed — a human sets
        // 含/不含/機上 in the admin backend (separate batch).
        mealBreakfast: "pending",
        mealLunch: "pending",
        mealDinner: "pending",
        stayPropertyStatus: noStay ? "not_applicable" : "proposed_or_equivalent",
        stayBookingStatus: noStay ? "not_applicable" : "unconfirmed",
        stayRatingValue: ratingValue,
        stayRatingSystem: ratingValue !== null ? "unverified" : null,
        stayRatingSourceStatus:
          ratingValue !== null ? "itinerary_standard_unverified" : null,
        stayRatingVerifiedAt: null,
        mediaSourceStatus: "demo_placeholder",
        mediaRightsStatus: "prototype_only",
      };
      const dayResult = await tx.insert(itineraryDays).values(dayValues);
      const dayRowId = Number(dayResult[0].insertId);

      const usedStopIds = new Set<string>();
      for (let i = 0; i < day.stops.length; i++) {
        const stop = day.stops[i];
        let stopId = `d${day.dayNumber}-${asciiSlug(stop.title) || `s${i + 1}`}`.slice(0, 64);
        if (usedStopIds.has(stopId)) stopId = `${stopId.slice(0, 58)}-${i + 1}`;
        usedStopIds.add(stopId);
        const stopValues: InsertItineraryStop = {
          itineraryDayId: dayRowId,
          stopId,
          name: stop.title,
          nameEn: null,
          kind: "sight",
          summary: stop.description,
          lat: null, // coordinates are never guessed
          lon: null,
          sourceStatus: "pending",
          // Route membership is a claim — unconfirmed unless source-documented.
          visitStatus: "route_or_stop_unconfirmed",
          imageAssetId: null, // supplier/source images are NEVER copied in
          mediaStatus: "demo_placeholder",
          sortOrder: i,
        };
        await tx.insert(itineraryStops).values(stopValues);
        stopCount++;
      }
    }

    return {
      itineraryVersionId,
      itineraryId,
      versionNumber,
      productVersionId: pv.id,
      sourceStatus: "demo_estimate" as const,
      dayCount: parsedDays.length,
      stopCount,
      replacedExistingDraft,
    };
  });
}

// ── 3. Fee contract draft ────────────────────────────────────────────────

export interface CreateFeeContractDraftResult {
  feeContractId: number;
  contractId: string;
  productVersionId: number;
  status: "draft";
  sourceStatus: "demo_estimate" | "supplier_quote" | "awaiting_supplier_quote";
  itemCount: number;
  replacedExistingDraft: boolean;
}

/**
 * Create (or idempotently replace, when the same contractId already
 * exists as a draft on the same productVersion) a DRAFT fee contract with
 * validated fee lines. All money is integer ISO-4217 minor units; currency
 * codes go through the frozen canonicalCurrencyCode (unknown ⇒ reject).
 */
export async function createFeeContractDraft(
  rawInput: CreateFeeContractDraftInput,
): Promise<CreateFeeContractDraftResult> {
  // FIREWALL LAYER 1 — independent pre-parse deep scan (Codex 2026-07-21
  // P2-1): the RAW input is deep-scanned BEFORE any zod parse, so
  // agentPrice/supplierCost/seat keys are rejected even if `.strict()`
  // ever regressed to zod's default key-stripping. The frozen guard from
  // availabilityBucket.ts walks EVERY depth of the raw object.
  try {
    assertNoForbiddenPublicFields(rawInput);
  } catch (err) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Forbidden cost/seat field in raw fee contract input (pre-parse deep scan): ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
  // FIREWALL LAYER 2 — zod `.strict()`: unknown keys (cost-shaped or not)
  // are rejected, not stripped. Re-parse even when the router already
  // did: this module is the single enforcement point ('confirmed'
  // unreachable, unknown keys rejected). Each layer bears load alone.
  const parsedResult = createFeeContractDraftInputSchema.safeParse(rawInput);
  if (!parsedResult.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid fee contract draft input: ${parsedResult.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    });
  }
  const input = parsedResult.data;
  // Belt-and-suspenders: the PARSED data is scanned too (a zod transform
  // could theoretically reintroduce a key; the write values must be clean).
  assertNoForbiddenPublicFields(input);
  // Frozen fail-closed currency table — throws on anything unknown.
  for (const fee of input.fees) canonicalCurrencyCode(fee.currency);

  const db = await requireDb();

  return db.transaction(async (tx: DrizzleTx) => {
    // Shared tour-level write lock; preconditions re-read under it.
    await lockTourForWrite(tx, input.tourId);
    const pv = await requireDraftProductVersion(tx, input.tourId, input.productVersionId);

    const existingContracts = await tx
      .select()
      .from(feeContracts)
      .where(eq(feeContracts.productVersionId, pv.id))
      .for("update");

    let contractId = input.contract.contractId;
    let existingDraft: { id: number } | undefined;
    if (contractId) {
      const match = existingContracts.find(
        (c: { id: number; contractId: string; status: string }) =>
          c.contractId === contractId,
      );
      if (match && match.status !== "draft") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `feeContract ${contractId} is '${match.status}' — corrections go through a NEW version`,
        });
      }
      existingDraft = match;
    } else {
      contractId = `FEE-T${input.tourId}-PV${pv.id}-${existingContracts.length + 1}`;
    }

    let feeContractRowId: number;
    let replacedExistingDraft = false;
    const contractValues = {
      productVersionId: pv.id,
      originMarket: input.contract.originMarket ?? "US-CA",
      destinationJurisdictions: input.contract.destinationJurisdictions ?? null,
      displayRegion: input.contract.displayRegion ?? null,
      validFrom: input.contract.validFrom ?? null,
      validTo: input.contract.validTo ?? null,
      sourceStatus: input.contract.sourceStatus,
      status: "draft" as const,
    };
    if (existingDraft) {
      replacedExistingDraft = true;
      feeContractRowId = existingDraft.id;
      await tx.update(feeContracts).set(contractValues).where(eq(feeContracts.id, feeContractRowId));
      await tx.delete(feeItems).where(eq(feeItems.feeContractId, feeContractRowId));
    } else {
      const inserted = await tx
        .insert(feeContracts)
        .values({ contractId, ...contractValues });
      feeContractRowId = Number(inserted[0].insertId);
    }

    for (let i = 0; i < input.fees.length; i++) {
      const fee = input.fees[i];
      await tx.insert(feeItems).values({
        feeContractId: feeContractRowId,
        feeId: fee.feeId,
        category: fee.category,
        labelZh: fee.labelZh,
        labelEn: fee.labelEn,
        amountMinorUnits: fee.amountMinorUnits,
        currency: canonicalCurrencyCode(fee.currency),
        unit: fee.unit,
        includedInPackgoCharge: fee.includedInPackgoCharge,
        requiredForTrip: fee.requiredForTrip,
        payeeType: fee.payeeType,
        paymentTiming: fee.paymentTiming,
        sourceStatus: fee.sourceStatus,
        sortOrder: fee.sortOrder ?? i,
      });
    }

    return {
      feeContractId: feeContractRowId,
      contractId,
      productVersionId: pv.id,
      status: "draft" as const,
      sourceStatus: input.contract.sourceStatus,
      itemCount: input.fees.length,
      replacedExistingDraft,
    };
  });
}
