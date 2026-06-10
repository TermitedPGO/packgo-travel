/**
 * escalationBox — escalation 進今日待辦的脊椎(批1 m3b).
 *
 * Agents escalate what they must not decide alone(客訴 / 退款 / 低信心詢問)
 * as agentMessages rows(messageType="escalation";B1 已把 title/body 寫成
 * 講人話)。Until now those only lived in the agent chat — this module
 * surfaces them in the workspace 需要你決定 bucket:
 *
 *   listEscalations        — every unread one(deliberately NOT windowed by
 *                            date: an old unread escalation must never
 *                            silently vanish)+ the most recent read ones,
 *                            dimmed, so a fresh ack stays visible/undoable.
 *   countUnreadEscalations — sidebar badge add-on for commandCenter.stats.
 *   ackEscalation          — 處理好了 toggle. Writes readByJeff — the SAME
 *                            state the agent-chat unread badge reads, so one
 *                            ack clears both surfaces (never two read-states
 *                            drifting apart).
 *
 * No send path on purpose: the suggested reply inside an escalation body is
 * NOT an approval task. Acting on it stays in Gmail / agent chat — this
 * module adds zero money-touching or customer-visible mutations.
 */
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { agentMessages, customerProfiles, users } from "../../drizzle/schema";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "escalationBox" });

/** Unread rows are capped only as a runaway safeguard, not a display window. */
const UNREAD_CAP = 50;
/** Read rows shown for undo context (dimmed at the bottom of the bucket). */
const READ_RECENT = 10;

export interface EscalationWho {
  /** Display name — registered user name, falling back to profile email. */
  label: string;
  /** users.id when the profile maps to a registered user; null = chip only. */
  userId: number | null;
}

export interface EscalationRow {
  id: number;
  agentName: string;
  title: string;
  body: string;
  /** InquiryAgent classification parsed from context JSON (null = unknown). */
  classification: string | null;
  priority: "low" | "normal" | "high" | "critical";
  read: boolean;
  createdAt: Date;
  who: EscalationWho | null;
}

/**
 * Best-effort classification out of the message's context JSON. The context
 * shape is owned by each agent and may drift — malformed JSON or a missing
 * field returns null rather than throwing.
 */
export function parseEscalationClassification(
  context: string | null,
): string | null {
  if (!context) return null;
  try {
    const parsed = JSON.parse(context);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const c = (parsed as Record<string, unknown>).classification;
      if (typeof c === "string" && c.trim()) return c.trim();
    }
  } catch {
    // fall through
  }
  return null;
}

type RawRow = {
  id: number;
  agentName: string;
  title: string;
  body: string;
  context: string | null;
  priority: "low" | "normal" | "high" | "critical";
  readByJeff: number;
  createdAt: Date;
  relatedCustomerProfileId: number | null;
};

/**
 * Unread escalations (all of them, newest first) + the most recent read ones.
 * Who is resolved relatedCustomerProfileId → customerProfiles → users with
 * two batched inArray lookups (zero per-row queries); a guest profile keeps
 * its email label with userId=null (chip without jump) — honest degradation,
 * same rule as approvalTaskWho.
 */
export async function listEscalations(): Promise<EscalationRow[]> {
  const db = await getDb();
  if (!db) {
    log.warn("[escalationBox] listEscalations: database not available");
    return [];
  }

  const baseSelect = {
    id: agentMessages.id,
    agentName: agentMessages.agentName,
    title: agentMessages.title,
    body: agentMessages.body,
    context: agentMessages.context,
    priority: agentMessages.priority,
    readByJeff: agentMessages.readByJeff,
    createdAt: agentMessages.createdAt,
    relatedCustomerProfileId: agentMessages.relatedCustomerProfileId,
  };

  const unread = (await db
    .select(baseSelect)
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.messageType, "escalation"),
        eq(agentMessages.readByJeff, 0),
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(UNREAD_CAP)) as RawRow[];

  const read = (await db
    .select(baseSelect)
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.messageType, "escalation"),
        eq(agentMessages.readByJeff, 1),
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(READ_RECENT)) as RawRow[];

  const rows = [...unread, ...read];

  const profileIds = [
    ...new Set(
      rows.flatMap((r) =>
        r.relatedCustomerProfileId != null
          ? [r.relatedCustomerProfileId]
          : [],
      ),
    ),
  ];

  const profileById = new Map<
    number,
    { id: number; userId: number | null; email: string | null }
  >();
  if (profileIds.length > 0) {
    const profiles = await db
      .select({
        id: customerProfiles.id,
        userId: customerProfiles.userId,
        email: customerProfiles.email,
      })
      .from(customerProfiles)
      .where(inArray(customerProfiles.id, profileIds));
    for (const p of profiles) profileById.set(p.id, p);
  }

  const userIds = [
    ...new Set(
      [...profileById.values()].flatMap((p) =>
        p.userId != null ? [p.userId] : [],
      ),
    ),
  ];
  const userById = new Map<number, { id: number; name: string | null }>();
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) userById.set(u.id, u);
  }

  return rows.map((r) => {
    const profile =
      r.relatedCustomerProfileId != null
        ? profileById.get(r.relatedCustomerProfileId)
        : undefined;
    const userName =
      profile?.userId != null
        ? userById.get(profile.userId)?.name?.trim()
        : undefined;
    const label = userName || profile?.email?.trim() || "";
    return {
      id: r.id,
      agentName: r.agentName,
      title: r.title,
      body: r.body,
      classification: parseEscalationClassification(r.context),
      priority: r.priority,
      read: r.readByJeff !== 0,
      createdAt: r.createdAt,
      who: label ? { label, userId: profile?.userId ?? null } : null,
    };
  });
}

/** Unread escalation count — additive field on commandCenter.stats. */
export async function countUnreadEscalations(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.messageType, "escalation"),
        eq(agentMessages.readByJeff, 0),
      ),
    );
  return Number(rows[0]?.c ?? 0);
}

/**
 * 處理好了 ⇆ 未處理 for one escalation. handled=true marks it read (also
 * clearing the agent-chat unread badge); handled=false puts it back. Throws
 * on a missing row or a non-escalation message so the toggle can never
 * silently mutate some other inbox message.
 */
export async function ackEscalation(
  messageId: number,
  handled: boolean,
): Promise<{ id: number; read: boolean }> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }
  const rows = await db
    .select({
      id: agentMessages.id,
      messageType: agentMessages.messageType,
    })
    .from(agentMessages)
    .where(eq(agentMessages.id, messageId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`Message ${messageId} not found`);
  }
  if (row.messageType !== "escalation") {
    throw new Error(`Message ${messageId} is not an escalation`);
  }

  await db
    .update(agentMessages)
    .set(
      handled
        ? { readByJeff: 1, readAt: new Date() }
        : { readByJeff: 0, readAt: null },
    )
    .where(eq(agentMessages.id, messageId));

  log.info({ messageId, handled }, "[escalationBox] escalation acked");
  return { id: messageId, read: handled };
}
