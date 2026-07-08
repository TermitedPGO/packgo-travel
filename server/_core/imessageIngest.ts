/**
 * imessageIngest — write iMessage/SMS history (synced from Jeff's desktop
 * Mac's ~/Library/Messages/chat.db by scripts/imessage-sync.mjs) into
 * customerInteractions, so the customer-cockpit timeline includes desktop
 * texting that today is completely invisible to it.
 *
 * Phase1c (design-phase1bc.md §Phase1c). Two responsibilities live here:
 *   1. checkKnownPhones — the PRIVACY GATE. The local script must know, for a
 *      batch of phone numbers, which ones belong to a known customerProfile
 *      BEFORE it decides whether to send message text over the network at
 *      all. See scripts/imessage-sync.mjs's header comment for the full
 *      decision writeup (Jeff's hard privacy requirement: content for
 *      unclaimed phones must never leave the Mac).
 *   2. ingestImessageBatch — the actual write path. Phone → customerProfiles
 *      match (exact, via the SAME normalizePhoneForMatch used by Phase1b's
 *      dedup so both sides of the comparison use identical normalization),
 *      merge-pointer follow (a matched-but-since-merged card must not get a
 *      hidden write), externalId-based dedup (relies on the existing
 *      uq_ci_profile_external unique index — see drizzle/schema.ts's
 *      customerInteractions table — no new migration), and a touchLastInbound
 *      call on inbound hits so the unread dot picks these up like any other
 *      inbound channel.
 *
 * Every message is processed in its own try/catch — one malformed / DB-error
 * row must never abort the rest of the batch (this mirrors caseFileImport.ts's
 * per-interaction try/catch around the insert loop).
 */
import { createChildLogger } from "./logger";
import { reportFunnelError } from "./errorFunnel";
import { normalizePhoneForMatch } from "../db/customerProfile";
import { followMergePointer } from "./mergedProfile";
import { touchLastInbound } from "./customerUnread";

const log = createChildLogger({ module: "imessageIngest" });

export interface IngestMessage {
  externalId: string;
  phone: string;
  direction: "inbound" | "outbound";
  /** null for messages whose phone did not match a known customer — the
   * local script must never populate this for an unclaimed phone (privacy
   * requirement enforced client-side; server treats null as "no content
   * to store" regardless of match outcome). */
  text: string | null;
  /** ISO-8601 string, already converted from Apple epoch by the local
   * script via appleEpochToIso. Server does not touch Apple time formats. */
  occurredAtIso: string;
}

export interface IngestBatchResult {
  claimed: number;
  unclaimedPhones: string[];
  errors: number;
}

/**
 * Look up which of the given phone numbers belong to a known customerProfile.
 * This is the privacy gate the local sync script calls BEFORE deciding
 * whether to include message text in the ingest payload — see
 * scripts/imessage-sync.mjs. Uses the same normalizePhoneForMatch +
 * formatting-stripped SQL comparison as resolveOrIdentifyCustomer, so a
 * phone that dedups as "existing" there is guaranteed to come back known
 * here (same normalization, same comparison shape).
 *
 * Never throws on an empty/missing DB — returns no known phones (fail
 * closed: if we can't confirm a phone is known, the caller must NOT send its
 * text content).
 */
export async function checkKnownPhones(phones: string[]): Promise<string[]> {
  const cleaned = Array.from(
    new Set(phones.map((p) => (p ?? "").trim()).filter(Boolean)),
  );
  if (cleaned.length === 0) return [];

  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return [];

  const knownPhones: string[] = [];
  for (const phone of cleaned) {
    try {
      const id = await findCustomerProfileIdByPhone(db, phone);
      if (id !== null) knownPhones.push(phone);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[imessageIngest] checkKnownPhones lookup failed for one phone (continuing)",
      );
    }
  }
  return knownPhones;
}

/**
 * Shared phone→customerProfiles.id lookup (exact match on the same
 * normalized-phone SQL comparison shape used throughout this codebase's
 * dedup logic). Both checkKnownPhones (the privacy gate) and
 * resolveProfileIdByPhone (the write path) MUST use identical matching
 * logic — a divergence here would mean the check endpoint says "known" while
 * the ingest endpoint can't find the same profile, which is exactly the kind
 * of two-copies-drift risk CLAUDE.md flags from Phase1a. Do not duplicate
 * this query inline again; add parameters here instead.
 */
async function findCustomerProfileIdByPhone(
  db: any,
  phone: string,
): Promise<number | null> {
  const { customerProfiles } = await import("../../drizzle/schema");
  const { sql } = await import("drizzle-orm");

  const normPhone = normalizePhoneForMatch(phone);
  const [row] = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(
      sql`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${customerProfiles.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ${normPhone}`,
    )
    .limit(1);
  return row ? row.id : null;
}

/**
 * Resolve a single phone to a canonical (merge-pointer-followed)
 * customerProfiles.id, or null if there is no match. Exact match only
 * (design doc explicitly says "不用 fuzzy") on the same normalized-phone SQL
 * comparison shape used throughout this codebase's dedup logic.
 */
async function resolveProfileIdByPhone(
  db: any,
  phone: string,
): Promise<number | null> {
  const id = await findCustomerProfileIdByPhone(db, phone);
  if (id === null) return null;

  // Follow the merge pointer — a phone match on a card that has since been
  // merged away must resolve to the final/canonical card (same rule as
  // resolveOrIdentifyCustomer and every other FILING entrance).
  return followMergePointer(db, id);
}

/**
 * Ingest a batch of iMessage/SMS rows into customerInteractions.
 *
 * Per message:
 *   - Normalize phone, look up customerProfiles (exact match), follow merge
 *     pointer.
 *   - No match → do NOT write to the DB. Add phone to unclaimedPhones and
 *     move on (server never persists content for phones it can't claim —
 *     this is enforced here as defense-in-depth even though the local
 *     script's privacy gate should already have stripped text for these).
 *   - Match → insert customerInteractions(channel:"sms", ...), relying on
 *     the existing uq_ci_profile_external unique index
 *     (customerProfileId, externalId) for idempotent dedup on repeat
 *     ingests (duplicate-key errors are swallowed as "already ingested",
 *     not counted as an error).
 *   - inbound hit → touchLastInbound (best-effort, per that function's own
 *     contract — it never throws).
 *
 * Every message is independently try/caught; a failure increments `errors`
 * and the loop continues.
 */
export async function ingestImessageBatch(
  messages: IngestMessage[],
): Promise<IngestBatchResult> {
  const result: IngestBatchResult = { claimed: 0, unclaimedPhones: [], errors: 0 };
  if (!Array.isArray(messages) || messages.length === 0) return result;

  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) {
    // No DB available (local dev). Do not silently pretend success — every
    // message counts as unclaimed-by-phone-lookup-unavailable so the caller
    // sees an honest signal instead of a false "all claimed".
    for (const m of messages) {
      if (m?.phone) result.unclaimedPhones.push(m.phone);
    }
    return result;
  }

  const { customerInteractions } = await import("../../drizzle/schema");

  for (const message of messages) {
    try {
      if (!message || typeof message.phone !== "string" || !message.phone.trim()) {
        result.errors++;
        continue;
      }

      const profileId = await resolveProfileIdByPhone(db, message.phone);
      if (!profileId) {
        result.unclaimedPhones.push(message.phone);
        continue;
      }

      const createdAt = new Date(message.occurredAtIso);
      if (Number.isNaN(createdAt.getTime())) {
        result.errors++;
        continue;
      }

      try {
        await db.insert(customerInteractions).values({
          customerProfileId: profileId,
          channel: "sms",
          direction: message.direction,
          content: message.text ?? "",
          generatedBy: "human",
          agentName: "imessage_sync",
          externalId: message.externalId,
          createdAt,
        } as any);
        result.claimed++;
      } catch (err) {
        // Duplicate-key on (customerProfileId, externalId) means this
        // message was already ingested by a prior run — that's success, not
        // an error, per the design doc's "重跑腳本不重複 ingest" requirement.
        const msg = err instanceof Error ? err.message : String(err);
        if (/duplicate|unique|uq_ci_profile_external/i.test(msg)) {
          result.claimed++;
        } else {
          log.warn({ err: msg, externalId: message.externalId }, "[imessageIngest] insert failed");
          reportFunnelError({
            source: "fail-open:imessageIngest:insertCustomerInteraction",
            err,
            context: { externalId: message.externalId },
          }).catch(() => {});
          result.errors++;
          continue;
        }
      }

      if (message.direction === "inbound") {
        await touchLastInbound(db, profileId, createdAt);
      }
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[imessageIngest] one message failed to process (continuing)",
      );
      reportFunnelError({
        source: "fail-open:imessageIngest:processMessage",
        err,
      }).catch(() => {});
      result.errors++;
    }
  }

  return result;
}
