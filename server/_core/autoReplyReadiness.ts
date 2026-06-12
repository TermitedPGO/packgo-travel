/**
 * autoReplyReadiness — 信任階梯的成績單(email-auto-reply m3)。
 *
 * Per classification, over the last 14 days of cs-lane decisions:
 *   不改直接核准率 = approvedUnchanged / (approve 決定數 + rejected)
 * Evidence sources (m0-verified):
 *   - approvalTasks(lane=cs, decided)→ payload.classification + decision
 *   - adminAuditLog(action=approvalTask.approve)→ changes.payloadEdited
 *   - agentMessages observations → shadow(would_auto_send)counts
 *
 * 拍板(2026-06-12):達標 = 樣本 ≥20 且 不改率 ≥95%。達標只亮徽章,
 * 開不開永遠是 Jeff 在政策卡手動。
 */
import { and, eq, gte, inArray, like, or, desc } from "drizzle-orm";
import { getDb } from "../db";
import { approvalTasks, adminAuditLog, agentMessages } from "../../drizzle/schema";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "autoReplyReadiness" });

const WINDOW_DAYS = 14;
/** 拍板門檻。 */
export const READINESS_MIN_SAMPLE = 20;
export const READINESS_MIN_RATE = 0.95;

export interface DecisionRowLike {
  classification: string | null;
  /** approvalTasks.status after decision. */
  status: string;
  /** audit changes.payloadEdited for the approve action. */
  edited: boolean;
}

export interface ClassReadiness {
  classification: string;
  sample: number;
  approvedUnchanged: number;
  approvedEdited: number;
  rejected: number;
  /** approvedUnchanged / sample, 3dp. */
  unchangedRate: number;
  shadowCount: number;
  qualified: boolean;
}

/** Pure aggregation — unit-testable without a DB. */
export function computeReadiness(
  decisions: DecisionRowLike[],
  shadowByClass: Record<string, number>,
  minSample = READINESS_MIN_SAMPLE,
  minRate = READINESS_MIN_RATE,
): ClassReadiness[] {
  const byClass = new Map<
    string,
    { unchanged: number; edited: number; rejected: number }
  >();
  for (const d of decisions) {
    const cls = d.classification?.trim() || "(unknown)";
    const bucket = byClass.get(cls) ?? { unchanged: 0, edited: 0, rejected: 0 };
    if (d.status === "rejected") bucket.rejected++;
    // approved / sent / failed all mean Jeff APPROVED (sent/failed is the
    // executor result, not his judgement)
    else if (d.edited) bucket.edited++;
    else bucket.unchanged++;
    byClass.set(cls, bucket);
  }
  // classes that only have shadow evidence still appear (rate 0, sample 0)
  for (const cls of Object.keys(shadowByClass)) {
    if (!byClass.has(cls)) byClass.set(cls, { unchanged: 0, edited: 0, rejected: 0 });
  }

  const out: ClassReadiness[] = [];
  for (const [classification, b] of byClass) {
    const sample = b.unchanged + b.edited + b.rejected;
    const rate = sample > 0 ? Math.round((b.unchanged / sample) * 1000) / 1000 : 0;
    out.push({
      classification,
      sample,
      approvedUnchanged: b.unchanged,
      approvedEdited: b.edited,
      rejected: b.rejected,
      unchangedRate: rate,
      shadowCount: shadowByClass[classification] ?? 0,
      qualified: sample >= minSample && rate >= minRate,
    });
  }
  return out.sort((a, b) => b.sample - a.sample || a.classification.localeCompare(b.classification));
}

function parseClassification(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const p = JSON.parse(payload);
    if (p && typeof p === "object" && typeof p.classification === "string") {
      return p.classification;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function parseEditedFlag(changes: string | null): boolean {
  if (!changes) return false;
  try {
    const c = JSON.parse(changes);
    return c && typeof c === "object" && c.payloadEdited === true;
  } catch {
    return false;
  }
}

export async function getAutoReplyReadiness(): Promise<{
  windowDays: number;
  minSample: number;
  minRate: number;
  classes: ClassReadiness[];
}> {
  const db = await getDb();
  const empty = {
    windowDays: WINDOW_DAYS,
    minSample: READINESS_MIN_SAMPLE,
    minRate: READINESS_MIN_RATE,
    classes: [] as ClassReadiness[],
  };
  if (!db) {
    log.warn("[autoReplyReadiness] db unavailable");
    return empty;
  }
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const tasks = await db
    .select({
      id: approvalTasks.id,
      payload: approvalTasks.payload,
      status: approvalTasks.status,
    })
    .from(approvalTasks)
    .where(
      and(
        eq(approvalTasks.lane, "cs"),
        inArray(approvalTasks.status, ["approved", "sent", "failed", "rejected"]),
        gte(approvalTasks.decidedAt, since),
      ),
    )
    .limit(1000);

  const editedById = new Map<string, boolean>();
  if (tasks.length > 0) {
    const audits = await db
      .select({
        targetId: adminAuditLog.targetId,
        changes: adminAuditLog.changes,
      })
      .from(adminAuditLog)
      .where(
        and(
          eq(adminAuditLog.action, "approvalTask.approve"),
          gte(adminAuditLog.createdAt, since),
        ),
      )
      .limit(2000);
    for (const a of audits) {
      if (a.targetId != null) {
        editedById.set(String(a.targetId), parseEditedFlag(a.changes));
      }
    }
  }

  const decisions: DecisionRowLike[] = tasks.map((t) => ({
    classification: parseClassification(t.payload),
    status: t.status,
    edited: editedById.get(String(t.id)) === true,
  }));

  // shadow counts — scan recent observations (JSON field, counted in JS)
  const shadowByClass: Record<string, number> = {};
  const obs = await db
    .select({ context: agentMessages.context })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.agentName, "inquiry"),
        eq(agentMessages.messageType, "observation"),
        gte(agentMessages.createdAt, since),
        or(
          like(agentMessages.context, '%"sendOutcome":"would_auto_send"%'),
          like(agentMessages.context, '%"sendOutcome":"auto_replied"%'),
        ),
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(500);
  for (const o of obs) {
    try {
      const c = JSON.parse(o.context ?? "null");
      if (c && typeof c === "object" && typeof c.classification === "string") {
        shadowByClass[c.classification] = (shadowByClass[c.classification] ?? 0) + 1;
      }
    } catch {
      /* skip */
    }
  }

  return { ...empty, classes: computeReadiness(decisions, shadowByClass) };
}
