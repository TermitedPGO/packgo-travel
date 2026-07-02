/**
 * mergedProfile — follow customerProfiles.mergedIntoProfileId to the canonical
 * card (migration 0109).
 *
 * When Jeff merges a 同案聯絡人 (merge_into_customer), the source card is
 * hidden (status=blocked) and gets a structured pointer to the target. Every
 * FILING entrance that resolves a profile by email must then follow the
 * pointer before writing — otherwise mail from the merged-away address lands
 * on a hidden card and never surfaces in the customer list (no unread dot, no
 * row). 2026-07-02, found while preparing the leslie → Emerald (AXT) merge.
 *
 * Split pure-core / db-wrapper so the hop-and-cycle logic is unit-testable
 * without a database (same pattern as followupDraftProducer helpers).
 */
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "mergedProfile" });

/** Hard cap on pointer hops — a merge chain deeper than this is data damage,
 * not a real workflow; stop and use the last sane id instead of looping. */
export const MERGE_POINTER_MAX_HOPS = 5;

/**
 * Pure core: walk `start` through `lookup` until the pointer runs out.
 * `lookup` distinguishes MISSING ROW (undefined — the card was hard-deleted)
 * from NO POINTER (null — the card exists and is canonical). A dangling
 * pointer must NOT resolve to the deleted id: filing to a nonexistent
 * profile makes mail invisible on every surface (review P2),so we back up
 * to the last id whose row actually existed. Self-pointers and cycles stop
 * at the last card before the repeat; the hop cap stops runaway chains.
 */
export function followMergePointerCore(
  start: number,
  lookup: (id: number) => number | null | undefined,
  maxHops: number = MERGE_POINTER_MAX_HOPS,
): number {
  const visited = new Set<number>([start]);
  let current = start;
  let lastExisting = start; // best-effort fallback if even `start` has no row
  for (let hop = 0; hop < maxHops; hop++) {
    const next = lookup(current);
    if (next === undefined) return current === start ? start : lastExisting;
    lastExisting = current;
    if (next === null || next === current || visited.has(next)) return current;
    visited.add(next);
    current = next;
  }
  return current;
}

type DbLike = {
  select: (...args: any[]) => any;
};

/**
 * DB wrapper: resolve `profileId` to its canonical card. One small SELECT per
 * hop; 0 extra queries for the common case is NOT possible (we must look at
 * the row), but callers that already loaded the row can use the pure core
 * directly. Any db error degrades to returning the input id — filing must
 * never break because the pointer lookup hiccuped.
 */
export async function followMergePointer(db: DbLike, profileId: number): Promise<number> {
  try {
    const { customerProfiles } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const visited = new Set<number>([profileId]);
    let current = profileId;
    let lastExisting = profileId;
    for (let hop = 0; hop < MERGE_POINTER_MAX_HOPS; hop++) {
      const [row] = await db
        .select({ next: customerProfiles.mergedIntoProfileId })
        .from(customerProfiles)
        .where(eq(customerProfiles.id, current))
        .limit(1);
      // row missing = the card was hard-deleted → dangling pointer;back up
      // to the last card that exists instead of filing into a ghost id.
      if (!row) return current === profileId ? profileId : lastExisting;
      lastExisting = current;
      const next = row.next ?? null;
      if (next === null || next === current || visited.has(next)) return current;
      visited.add(next);
      current = next;
    }
    return current;
  } catch (err) {
    log.warn({ err, profileId }, "[mergedProfile] pointer lookup failed, using original id");
    return profileId;
  }
}
