// server/db/customerProfile.ts — shared customer-identity resolution.
//
// Extracted (2026-07-02, Phase1b batch case-file import) from the dedup logic
// that already lived inline in server/agents/autonomous/opsTools.ts's
// create_customer tool (lines ~1667-1714). That tool's rule is the baseline
// for ANY code path that might create a customerProfiles row from an
// email/phone pair — email OR phone must be non-empty, and a duplicate is
// found via exact-email OR normalized-phone match. Two call sites (the ops
// agent tool, and the new case-file batch importer) must never carry two
// slightly-different copies of this rule — drift here silently creates
// duplicate or wrongly-merged customer cards. See docs/features/
// customer-cockpit/design-phase1bc.md §共用基礎設施.
//
// NOTE: opsTools.ts's create_customer tool itself is NOT rewired to call this
// (out of caution per task scope — that file's behavior must not change).
// This module is the equivalent logic, single-sourced for new callers; if a
// future pass wires create_customer to call this too, the two are already
// verified equivalent by construction (this file's logic is a straight
// extraction, not a redesign).

import { eq, or, sql } from "drizzle-orm";
import { customerProfiles, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { followMergePointer } from "../_core/mergedProfile";

/**
 * Normalize a phone number for duplicate matching. Strips pure formatting
 * (spaces / dashes / parens / dots) so "510-333-1234", "(510) 333.1234" and
 * "5103331234" all collide. Leading "+" is kept: "+1510…" vs "510…" genuinely
 * differ and we'd rather miss a match than merge two different people.
 *
 * Mirrors server/agents/autonomous/opsTools.ts's normalizePhoneForMatch
 * verbatim — kept as a second copy (not re-exported) because opsTools.ts is
 * off-limits for behavior changes per task scope, but the two MUST stay
 * byte-for-byte identical. Any edit here needs the same edit there.
 */
export function normalizePhoneForMatch(phone: string): string {
  return phone.replace(/[\s\-().]/g, "");
}

export type CustomerIdentityStatus =
  | "existing"
  | "creatable"
  | "blocked_no_identifier"
  | "blocked_registered_member";

export interface ResolvedCustomerIdentity {
  status: CustomerIdentityStatus;
  profileId?: number;
  matchedBy?: "email" | "phone";
  registeredUserId?: number;
}

/**
 * Resolve an {email, phone} pair against customerProfiles WITHOUT writing
 * anything. Same rule as create_customer: at least one of email/phone must
 * be non-empty, else blocked_no_identifier (this is intentional — a case with
 * no real contact info for the customer must not get a fabricated identity).
 * If either matches an existing row (email exact match OR normalized-phone
 * match), returns "existing" with the CANONICAL profileId (follows
 * mergedIntoProfileId pointers, same as create_customer's dedup does) plus
 * which field matched. Otherwise "creatable" — caller may insert a new row.
 *
 * Never throws on the "no DB" case — returns blocked_no_identifier only when
 * there is truly no identifier; a missing DB during a lookup is surfaced by
 * letting the caller's own try/catch handle it (this fn does its own
 * awaiting so an unavailable DB will reject like any other DB call site).
 */
export async function resolveOrIdentifyCustomer(params: {
  email: string | null;
  phone: string | null;
}): Promise<ResolvedCustomerIdentity> {
  // 2026-07-03 對抗審查(任務7 P2):.toLowerCase() 補在這裡,讓「查重」跟
  // websiteIntake.ts 的「建卡」用同一套大小寫正規化——原本這裡只 trim,
  // 建卡那邊卻 trim+lowercase,兩邊比對基準不一致,只是恰好被 DB 預設的
  // case-insensitive collation蓋住沒爆出來,不該依賴 collation 假設。
  const email = (params.email ?? "").trim().toLowerCase() || null;
  const phone = (params.phone ?? "").trim() || null;

  if (!email && !phone) {
    return { status: "blocked_no_identifier" };
  }

  const db = await getDb();
  if (!db) {
    // Local dev / no DATABASE_URL: cannot check for dupes, but we also must
    // not silently claim "creatable" against unknown state. Treat as blocked
    // so callers see an explicit reason rather than risking a duplicate
    // insert once run against the real DB.
    return { status: "blocked_no_identifier" };
  }

  const conds: any[] = [];
  if (email) conds.push(eq(customerProfiles.email, email));
  if (phone) {
    const normPhone = normalizePhoneForMatch(phone);
    conds.push(
      sql`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${customerProfiles.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ${normPhone}`,
    );
  }

  let [dup] = await db
    .select({ id: customerProfiles.id, email: customerProfiles.email, phone: customerProfiles.phone })
    .from(customerProfiles)
    .where(conds.length === 1 ? conds[0] : or(...conds))
    .orderBy(customerProfiles.createdAt)
    .limit(1);

  if (!dup) {
    // Registered-member guard — same rule as opsTools.ts's create_customer
    // (see that file's "email_exists_registered" comment): an email that
    // belongs to a `users` row must never spawn a guest customerProfiles
    // row. Without this, a batch import whose extracted customerEmail
    // happens to match a signed-up member's account email would create a
    // parallel guest card, splitting that member's history in two — the
    // exact failure mode create_customer's guard exists to prevent.
    if (email) {
      const [registered] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (registered) {
        return { status: "blocked_registered_member", registeredUserId: registered.id };
      }
    }
    return { status: "creatable" };
  }

  // Same merge-pointer follow as create_customer's dedup path — a hit on a
  // card that has since been merged away must resolve to the final card, or
  // this would silently write against a hidden/blocked profile.
  const canonicalId = await followMergePointer(db, dup.id);
  let matchedBy: "email" | "phone" = "email";
  if (email && dup.email && dup.email.toLowerCase() === email.toLowerCase()) {
    matchedBy = "email";
  } else if (phone && dup.phone) {
    const dupNorm = normalizePhoneForMatch(dup.phone);
    if (dupNorm === normalizePhoneForMatch(phone)) matchedBy = "phone";
  }

  return { status: "existing", profileId: canonicalId, matchedBy };
}
