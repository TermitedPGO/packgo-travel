/**
 * Batch P1b — publish command for the storefront contract layer.
 *
 * publishProductVersion() is the ONLY way content becomes publicly
 * visible: one atomic transaction that (a) verifies draft completeness,
 * (b) computes a canonical contentHash, (c) flips the previous published
 * productVersion(s) of the tour to 'superseded', and (d) publishes this
 * version together with its draft child itineraryVersions/feeContracts.
 *
 * ONE-PUBLISHED-PER-TOUR INVARIANT (P1a frozen contract): at most one
 * productVersions row per tour has status='published'. This module
 * enforces it at write time — the supersede UPDATE and the publish UPDATE
 * run in the same transaction, so no reader can ever observe two
 * published versions of a tour.
 *
 * APPEND-ONLY HISTORY: publishing never deletes rows. Children of
 * superseded versions are left untouched (the public read chain gates on
 * the PARENT's status, so stale children can never be served — see the
 * frozen ancestry rule in server/storefront/queries.ts).
 *
 * NO UNPUBLISH: an unpublish/supersede-without-replacement command is
 * deliberately NOT provided. Removing published content is done by
 * publishing a corrected NEW version (which supersedes the old one) —
 * a tour must never silently flip from "published" to "nothing" without
 * a versioned, auditable replacement. If a tour truly must disappear,
 * that is a tour-status decision (tours.status), not a contract-layer
 * mutation.
 */
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  feeContracts,
  feeItems,
  itineraryDays,
  itineraryStops,
  itineraryVersions,
  productVersions,
  type FeeContract,
  type FeeItem,
} from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";
import { buildFeeDisclosure } from "./feeDisclosure";
import { lockTourForWrite } from "./importDraft";

// ── Canonical content hash ───────────────────────────────────────────────

/**
 * Deterministic JSON canonicalization: object keys sorted, Dates as ISO
 * strings, undefined dropped. Key insertion order of the input can never
 * change the output.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(record[k])}`)
      .join(",")}}`;
  }
  return "null"; // functions/symbols cannot be content
}

/** sha256 hex over the canonical JSON of `payload` (stable key order). */
export function computeContentHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(payload)).digest("hex");
}

/**
 * Explicit code-point comparator: compares strings by UTF-16 code units
 * via `<`/`>`. NEVER localeCompare — its order depends on the runtime
 * locale/ICU build, which would make the contentHash environment-dependent.
 */
export function codePointCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Row shapes the payload builder needs (DB rows; surrogate ids are used
 *  only to JOIN children — they never enter the payload). */
export interface ContentHashRows {
  itineraryVersions: Array<Record<string, unknown>>;
  itineraryDays: Array<Record<string, unknown>>;
  itineraryStops: Array<Record<string, unknown>>;
  feeContracts: Array<{ contract: FeeContract; items: FeeItem[] }>;
}

/**
 * Sort mapped content entries by explicit keys (numbers numerically,
 * strings by code points), with the canonical JSON of the content itself
 * as the FINAL tie-breaker — so ordering is total and deterministic even
 * for duplicate natural keys (identical content ties are order-irrelevant
 * by definition; differing content ties get a stable canonical order).
 */
function sortByKeysThenContent<T>(
  entries: Array<{ content: T; keys: Array<string | number> }>,
): T[] {
  return entries
    .map((e) => ({ ...e, canonical: canonicalJsonStringify(e.content) }))
    .sort((a, b) => {
      for (let i = 0; i < a.keys.length; i++) {
        const ka = a.keys[i];
        const kb = b.keys[i];
        if (typeof ka === "number" && typeof kb === "number") {
          if (ka !== kb) return ka - kb;
        } else {
          const c = codePointCompare(String(ka), String(kb));
          if (c !== 0) return c;
        }
      }
      return codePointCompare(a.canonical, b.canonical);
    })
    .map((e) => e.content);
}

/**
 * CANONICAL CONTENT-ONLY HASH PAYLOAD (Codex 2026-07-21 P1-4).
 *
 * Directly testable payload builder. Guarantees:
 *   - DB row order can NEVER change the payload: every collection is
 *     sorted with explicit code-point comparators and complete
 *     tie-breakers — itineraries by itineraryId, days by dayNumber then
 *     dayId, stops by sortOrder then stopId, contracts by contractId,
 *     fee items by feeId — each with the canonical JSON of the entry as
 *     final tie-breaker (total deterministic order, no localeCompare).
 *   - Content-only semantics: EXCLUDED are all DB surrogate row ids,
 *     tourId, product versionNumber, itinerary versionNumber, and every
 *     timestamp (createdAt/updatedAt/publishedAt). Identical
 *     customer-visible content in different versions of a tour yields
 *     the IDENTICAL hash (change detection / dedupe).
 *   - Any customer-visible field change changes the payload.
 */
export function buildContentHashPayload(rows: ContentHashRows): unknown {
  const daysByIvRowId = new Map<unknown, Array<Record<string, unknown>>>();
  for (const d of rows.itineraryDays) {
    const list = daysByIvRowId.get(d.itineraryVersionId) ?? [];
    list.push(d);
    daysByIvRowId.set(d.itineraryVersionId, list);
  }
  const stopsByDayRowId = new Map<unknown, Array<Record<string, unknown>>>();
  for (const s of rows.itineraryStops) {
    const list = stopsByDayRowId.get(s.itineraryDayId) ?? [];
    list.push(s);
    stopsByDayRowId.set(s.itineraryDayId, list);
  }

  const itineraries = sortByKeysThenContent(
    rows.itineraryVersions.map((iv) => {
      const days = sortByKeysThenContent(
        (daysByIvRowId.get(iv.id) ?? []).map((d) => {
          const stops = sortByKeysThenContent(
            (stopsByDayRowId.get(d.id) ?? []).map((s) => ({
              content: {
                stopId: s.stopId,
                name: s.name,
                nameEn: s.nameEn ?? null,
                kind: s.kind,
                summary: s.summary ?? null,
                lat: s.lat ?? null,
                lon: s.lon ?? null,
                sourceStatus: s.sourceStatus,
                visitStatus: s.visitStatus,
                imageAssetId: s.imageAssetId ?? null,
                mediaStatus: s.mediaStatus,
                sortOrder: s.sortOrder,
              },
              keys: [s.sortOrder as number, s.stopId as string],
            })),
          );
          return {
            content: {
              dayId: d.dayId,
              dayNumber: d.dayNumber,
              city: d.city ?? null,
              cityEn: d.cityEn ?? null,
              summary: d.summary ?? null,
              sourceStatus: d.sourceStatus,
              movementDurationMinutes: d.movementDurationMinutes ?? null,
              movementStatus: d.movementStatus,
              mealBreakfast: d.mealBreakfast,
              mealLunch: d.mealLunch,
              mealDinner: d.mealDinner,
              stayPropertyStatus: d.stayPropertyStatus,
              stayBookingStatus: d.stayBookingStatus,
              stayRatingValue: d.stayRatingValue ?? null,
              stayRatingSystem: d.stayRatingSystem ?? null,
              stayRatingSourceStatus: d.stayRatingSourceStatus ?? null,
              mediaSourceStatus: d.mediaSourceStatus,
              mediaRightsStatus: d.mediaRightsStatus,
              stops,
            },
            keys: [d.dayNumber as number, d.dayId as string],
          };
        }),
      );
      return {
        content: {
          // versionNumber deliberately EXCLUDED — lifecycle metadata.
          itineraryId: iv.itineraryId,
          schemaVersion: iv.schemaVersion,
          sourceStatus: iv.sourceStatus,
          originMarket: iv.originMarket ?? null,
          destinationJurisdictions: iv.destinationJurisdictions ?? null,
          days,
        },
        keys: [iv.itineraryId as string],
      };
    }),
  );

  const contracts = sortByKeysThenContent(
    rows.feeContracts.map(({ contract, items }) => {
      const sortedItems = sortByKeysThenContent(
        items.map((it) => ({
          content: {
            feeId: it.feeId,
            category: it.category,
            labelZh: it.labelZh,
            labelEn: it.labelEn,
            amountMinorUnits: it.amountMinorUnits,
            currency: it.currency,
            unit: it.unit,
            includedInPackgoCharge: it.includedInPackgoCharge,
            requiredForTrip: it.requiredForTrip,
            payeeType: it.payeeType,
            paymentTiming: it.paymentTiming,
            sourceStatus: it.sourceStatus,
            sortOrder: it.sortOrder,
          },
          keys: [it.feeId],
        })),
      );
      return {
        content: {
          contractId: contract.contractId,
          sourceStatus: contract.sourceStatus,
          originMarket: contract.originMarket ?? null,
          displayRegion: contract.displayRegion ?? null,
          destinationJurisdictions: contract.destinationJurisdictions ?? null,
          validFrom: contract.validFrom ?? null,
          validTo: contract.validTo ?? null,
          items: sortedItems,
        },
        keys: [contract.contractId],
      };
    }),
  );

  // NOTE: no productVersion block — tourId and versionNumber are DB/
  // lifecycle identity, not customer-visible content.
  return { itineraries, feeContracts: contracts };
}

// ── Publish ──────────────────────────────────────────────────────────────

export interface PublishProductVersionResult {
  productVersionId: number;
  tourId: number;
  versionNumber: number;
  contentHash: string;
  publishedAt: Date;
  supersededProductVersionIds: number[];
  publishedItineraryVersionIds: number[];
  publishedFeeContractIds: number[];
}

/** Interval overlap with NULL = open-ended bound (matches isContractValidOn). */
function windowsOverlap(
  a: { validFrom: Date | null; validTo: Date | null },
  b: { validFrom: Date | null; validTo: Date | null },
): boolean {
  const aFrom = a.validFrom ? new Date(a.validFrom).getTime() : -Infinity;
  const aTo = a.validTo ? new Date(a.validTo).getTime() : Infinity;
  const bFrom = b.validFrom ? new Date(b.validFrom).getTime() : -Infinity;
  const bTo = b.validTo ? new Date(b.validTo).getTime() : Infinity;
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Atomically publish a draft productVersion.
 *
 * Completeness gates (all fail-closed, transaction rolls back):
 *   1. the version exists and is status='draft' (published ⇒ no-op error,
 *      superseded ⇒ error — corrections are a NEW version);
 *   2. it has at least one draft/published itineraryVersion (a product
 *      with no itinerary contract is not publishable);
 *   3. every non-awaiting fee contract being published must produce a
 *      status='published' disclosure through the FROZEN
 *      buildFeeDisclosure (single currency, valid codes, no unevidenced
 *      zero totals). An 'awaiting_supplier_quote' contract is honest and
 *      publishable — the public simply sees the awaiting shape;
 *   4. publishable fee contracts must not have overlapping validity
 *      windows (the frozen "one date-valid contract per date" invariant,
 *      enforced at write time).
 */
export async function publishProductVersion(params: {
  productVersionId: number;
  publishedBy: number;
}): Promise<PublishProductVersionResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable — publish requires a database",
    });
  }

  return db.transaction(async (tx: DrizzleTx) => {
    // Non-locking peek: learn the tourId only. The lock ORDER of the
    // shared serialization convention is always the tours row first
    // (deadlock freedom) — so no row lock may be taken before it.
    const peekRows = await tx
      .select()
      .from(productVersions)
      .where(eq(productVersions.id, params.productVersionId))
      .limit(1);
    const peek = peekRows[0];
    if (!peek) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `productVersion ${params.productVersionId} not found`,
      });
    }

    // Shared tour-level write lock (same convention as create/import —
    // see lockTourForWrite in importDraft.ts). Serializes concurrent
    // publishes of one tour and publish-vs-import interleavings.
    await lockTourForWrite(tx, peek.tourId);

    // RE-READ after acquiring the lock (FOR UPDATE ⇒ current committed
    // data, not the transaction's earlier snapshot): every status gate
    // below runs against the state a concurrent writer left behind.
    const pvRows = await tx
      .select()
      .from(productVersions)
      .where(eq(productVersions.id, params.productVersionId))
      .limit(1)
      .for("update");
    const pv = pvRows[0];
    if (!pv) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `productVersion ${params.productVersionId} not found`,
      });
    }
    if (pv.status === "published") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `productVersion ${pv.id} is already published`,
      });
    }
    if (pv.status === "superseded") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `productVersion ${pv.id} is superseded — publish a new draft version instead`,
      });
    }

    // Gate 2: at least one itinerary contract under this version.
    // All child reads below are locking reads (FOR UPDATE): the rows that
    // feed validation and the contentHash are exactly the rows the child
    // UPDATEs will flip — no snapshot skew, no unvalidated stragglers.
    const ivRows = await tx
      .select()
      .from(itineraryVersions)
      .where(eq(itineraryVersions.productVersionId, pv.id))
      .for("update");
    const eligibleIvs = ivRows.filter(
      (iv: { status: string }) => iv.status === "draft" || iv.status === "published",
    );
    if (eligibleIvs.length === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `productVersion ${pv.id} has no itinerary version — import an itinerary draft before publishing`,
      });
    }

    const ivIds = eligibleIvs.map((iv: { id: number }) => iv.id);
    const dayRows = await tx
      .select()
      .from(itineraryDays)
      .where(inArray(itineraryDays.itineraryVersionId, ivIds))
      .for("update");
    const dayIds = dayRows.map((d: { id: number }) => d.id);
    const stopRows =
      dayIds.length > 0
        ? await tx
            .select()
            .from(itineraryStops)
            .where(inArray(itineraryStops.itineraryDayId, dayIds))
            .for("update")
        : [];

    // Gates 3+4: fee contracts (optional) must be honestly publishable.
    const contractRows = await tx
      .select()
      .from(feeContracts)
      .where(eq(feeContracts.productVersionId, pv.id))
      .for("update");
    const eligibleContracts: Array<{ contract: FeeContract; items: FeeItem[] }> = [];
    for (const contract of contractRows as FeeContract[]) {
      if (contract.status !== "draft" && contract.status !== "published") continue;
      const items = (await tx
        .select()
        .from(feeItems)
        .where(eq(feeItems.feeContractId, contract.id))
        .for("update")) as FeeItem[];
      // Window integrity, layer 2 of 2 (defense in depth behind the zod
      // input refine): a reversed window can never be date-valid — a
      // published dead contract would be an unresolvable customer claim.
      if (
        contract.validFrom &&
        contract.validTo &&
        new Date(contract.validFrom).getTime() > new Date(contract.validTo).getTime()
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `feeContract ${contract.contractId} has a reversed validity window (validFrom > validTo) — fix the draft before publishing`,
        });
      }
      if (contract.sourceStatus !== "awaiting_supplier_quote") {
        // The FROZEN disclosure builder is the validator: anything it
        // fails-closed to 'awaiting' (bad currency, mixed currencies,
        // no lines, unevidenced zero) is NOT publishable as a quote.
        const disclosure = buildFeeDisclosure(contract, items);
        if (disclosure.status !== "published") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `feeContract ${contract.contractId} fails fee-disclosure validation (incomplete, invalid currency, mixed currencies, or unevidenced zero totals) — fix the draft or mark it awaiting_supplier_quote`,
          });
        }
      }
      eligibleContracts.push({ contract, items });
    }
    for (let i = 0; i < eligibleContracts.length; i++) {
      for (let j = i + 1; j < eligibleContracts.length; j++) {
        if (windowsOverlap(eligibleContracts[i].contract, eligibleContracts[j].contract)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `feeContracts ${eligibleContracts[i].contract.contractId} and ${eligibleContracts[j].contract.contractId} have overlapping validity windows — at most one contract may be date-valid per departure date`,
          });
        }
      }
    }

    // Canonical content-only hash via the directly-testable builder:
    // deterministic code-point ordering with complete tie-breakers; no
    // row ids, no tourId, no versionNumbers, no timestamps (see
    // buildContentHashPayload docs).
    const contentHash = computeContentHash(
      buildContentHashPayload({
        itineraryVersions: eligibleIvs,
        itineraryDays: dayRows,
        itineraryStops: stopRows,
        feeContracts: eligibleContracts,
      }),
    );
    const publishedAt = new Date();

    // Supersede: the one-published-per-tour invariant. Only the PARENT
    // rows flip — children of superseded versions stay untouched
    // (append-only history; the public chain gates on the parent).
    const previouslyPublished = await tx
      .select({ id: productVersions.id })
      .from(productVersions)
      .where(
        and(eq(productVersions.tourId, pv.tourId), eq(productVersions.status, "published")),
      )
      .for("update"); // probe runs under the tour lock; must see current data
    const supersededProductVersionIds = previouslyPublished.map(
      (r: { id: number }) => r.id,
    );
    if (supersededProductVersionIds.length > 0) {
      await tx
        .update(productVersions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(productVersions.tourId, pv.tourId),
            eq(productVersions.status, "published"),
          ),
        );
    }

    // Child transitions — same transaction as the parent flip. Each
    // UPDATE is scoped to the EXACT validated/hashed row ids AND
    // status-conditioned, so a row this transaction did not validate can
    // never be swept into the flip (Codex 2026-07-21 P1-1).
    const draftIvIds = eligibleIvs
      .filter((iv: { status: string }) => iv.status === "draft")
      .map((iv: { id: number }) => iv.id);
    if (draftIvIds.length > 0) {
      const ivResult = await tx
        .update(itineraryVersions)
        .set({ status: "published" })
        .where(
          and(
            inArray(itineraryVersions.id, draftIvIds),
            eq(itineraryVersions.productVersionId, pv.id),
            eq(itineraryVersions.status, "draft"),
          ),
        );
      const ivAffected = Number((ivResult as any)?.[0]?.affectedRows ?? NaN);
      if (ivAffected !== draftIvIds.length) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `publish aborted: expected to publish ${draftIvIds.length} itinerary version(s) but ${ivAffected} row(s) matched — state changed concurrently`,
        });
      }
    }
    const draftContractIds = eligibleContracts
      .filter(({ contract }) => contract.status === "draft")
      .map(({ contract }) => contract.id);
    if (draftContractIds.length > 0) {
      const fcResult = await tx
        .update(feeContracts)
        .set({ status: "published" })
        .where(
          and(
            inArray(feeContracts.id, draftContractIds),
            eq(feeContracts.productVersionId, pv.id),
            eq(feeContracts.status, "draft"),
          ),
        );
      const fcAffected = Number((fcResult as any)?.[0]?.affectedRows ?? NaN);
      if (fcAffected !== draftContractIds.length) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `publish aborted: expected to publish ${draftContractIds.length} fee contract(s) but ${fcAffected} row(s) matched — state changed concurrently`,
        });
      }
    }

    // Parent flip: status='draft' is part of the WHERE and the affected
    // row count is verified — if anything raced past the gates, exactly
    // zero rows match and the whole transaction rolls back.
    const parentResult = await tx
      .update(productVersions)
      .set({ status: "published", publishedAt, contentHash })
      .where(and(eq(productVersions.id, pv.id), eq(productVersions.status, "draft")));
    const parentAffected = Number((parentResult as any)?.[0]?.affectedRows ?? NaN);
    if (parentAffected !== 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `publish aborted: productVersion ${pv.id} was not in 'draft' at write time (affected ${parentAffected} rows) — a concurrent publish/import changed it`,
      });
    }

    return {
      productVersionId: pv.id,
      tourId: pv.tourId,
      versionNumber: pv.versionNumber,
      contentHash,
      publishedAt,
      supersededProductVersionIds,
      publishedItineraryVersionIds: draftIvIds,
      publishedFeeContractIds: draftContractIds,
    };
  });
}

// ── Admin read: full version history for a tour ──────────────────────────

export interface TourVersionListEntry {
  productVersion: typeof productVersions.$inferSelect;
  itineraryVersions: (typeof itineraryVersions.$inferSelect)[];
  feeContracts: FeeContract[];
}

/**
 * All versions of a tour (drafts included) with their child
 * itineraryVersions and feeContracts — admin-only view. These six tables
 * NEVER contain supplier cost/seat fields by construction (P1a frozen
 * schema), so returning full rows leaks nothing.
 */
export async function listVersionsForTour(tourId: number): Promise<TourVersionListEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const pvRows = await db
    .select()
    .from(productVersions)
    .where(eq(productVersions.tourId, tourId))
    .orderBy(desc(productVersions.versionNumber));
  if (pvRows.length === 0) return [];
  const pvIds = pvRows.map((r) => r.id);
  const ivRows = await db
    .select()
    .from(itineraryVersions)
    .where(inArray(itineraryVersions.productVersionId, pvIds));
  const fcRows = await db
    .select()
    .from(feeContracts)
    .where(inArray(feeContracts.productVersionId, pvIds));
  return pvRows.map((pv) => ({
    productVersion: pv,
    itineraryVersions: ivRows.filter((iv) => iv.productVersionId === pv.id),
    feeContracts: (fcRows as FeeContract[]).filter((fc) => fc.productVersionId === pv.id),
  }));
}
