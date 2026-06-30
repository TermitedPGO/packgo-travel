/**
 * duplicateProfileScan — periodic reconciliation for the duplicate-customer-
 * profile bug class (audit 2026-06-30, after the Emerald Young incident:
 * customerProfiles has no DB-level UNIQUE constraint on email/phone — both are
 * nullable and intentionally allow multiple NULLs / multi-channel customers, so
 * a hard unique index isn't viable. Every insert site relies on application
 * code remembering to select-by-identity before insert (see CLAUDE.md §4.2);
 * this scan is the backstop that catches it when one slips through anyway).
 *
 * Mirrors followupScan.ts's shape: pure grouping logic (unit-tested) + an
 * executor that reads the real table and posts ONE digest into Jeff's office
 * inbox (agentMessages) — never auto-merges, never touches customer data. Jeff
 * decides whether/how to merge (the older profile usually has the real
 * history; a brand-new duplicate with zero attached data is usually safe to
 * delete, same as the Emerald cleanup).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Don't re-post the same unresolved backlog more than once a week. */
const DEDUP_DAYS = 7;
/** Cap how many groups list in one digest body so it stays scannable. */
const DIGEST_CAP = 20;

export type ProfileIdentityRow = {
  id: number;
  email: string | null;
  phone: string | null;
  createdAt: Date;
};

export type DuplicateGroup = {
  field: "email" | "phone";
  /** The shared, normalized value. */
  key: string;
  /** profileIds sharing this value, oldest first (oldest = usually the real one). */
  profileIds: number[];
};

/**
 * Pure: group profiles sharing a non-empty email OR phone (normalized:
 * trimmed + lowercased). Only groups of size >= 2 are duplicates. A profile
 * can appear in both an email-group and a phone-group — reported once per
 * field since they may point at different merge candidates.
 */
export function findDuplicateProfileGroups(
  rows: ProfileIdentityRow[],
): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const field of ["email", "phone"] as const) {
    const byKey = new Map<string, ProfileIdentityRow[]>();
    for (const r of rows) {
      const key = (r[field] ?? "").trim().toLowerCase();
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(r);
      byKey.set(key, list);
    }
    for (const [key, list] of byKey) {
      if (list.length < 2) continue;
      const sorted = [...list].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      groups.push({ field, key, profileIds: sorted.map((r) => r.id) });
    }
  }
  return groups;
}

/** Pure: format the digest body posted to agentMessages. */
export function formatDuplicateDigest(groups: DuplicateGroup[]): string {
  const shown = groups.slice(0, DIGEST_CAP);
  const lines = shown.map(
    (g) =>
      `${g.field === "email" ? "Email" : "電話"} ${g.key}:profile #${g.profileIds.join("、#")}`,
  );
  const extra = groups.length - shown.length;
  return (
    `同一個 email 或電話對到多筆客人檔案,可能是重複建檔(像 Emerald Young 那次)。` +
    `最舊那筆(列在最前面)通常是真的、有歷史的那筆;新的那筆若打開來看沒有任何訂單/` +
    `對話,刪掉就好。\n\n${lines.join("\n")}` +
    (extra > 0 ? `\n…還有 ${extra} 組未列出` : "")
  );
}

export type Db = NonNullable<
  Awaited<ReturnType<typeof import("../db").getDb>>
>;

export interface DuplicateProfileScanResult {
  groups: number;
  posted: boolean;
}

/**
 * Weekly executor: scan all customerProfiles, find duplicate groups, post ONE
 * digest into Jeff's office inbox if any are found AND nothing was already
 * posted within DEDUP_DAYS (a coarse re-notify guard — groups are rare enough
 * that per-group dedup state isn't worth the complexity; this is a gentle
 * weekly reminder, not an alarm).
 */
export async function runDuplicateProfileScan(
  db: Db,
): Promise<DuplicateProfileScanResult> {
  const { customerProfiles, agentMessages } = await import(
    "../../drizzle/schema"
  );
  const { and, eq, gte } = await import("drizzle-orm");

  const rows = (await db
    .select({
      id: customerProfiles.id,
      email: customerProfiles.email,
      phone: customerProfiles.phone,
      createdAt: customerProfiles.createdAt,
    })
    .from(customerProfiles)) as ProfileIdentityRow[];

  const groups = findDuplicateProfileGroups(rows);
  if (groups.length === 0) return { groups: 0, posted: false };

  const dedupSince = new Date(Date.now() - DEDUP_DAYS * DAY_MS);
  const recent = await db
    .select({ id: agentMessages.id })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.agentName, "data-integrity"),
        gte(agentMessages.createdAt, dedupSince),
      ),
    )
    .limit(1);
  if (recent.length > 0) return { groups: groups.length, posted: false };

  await db.insert(agentMessages).values({
    agentName: "data-integrity",
    senderRole: "agent",
    messageType: "alert",
    title: `發現 ${groups.length} 組可能重複的客人檔案`,
    body: formatDuplicateDigest(groups),
    priority: "low",
  });
  return { groups: groups.length, posted: true };
}
