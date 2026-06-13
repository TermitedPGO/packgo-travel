/**
 * autoReplyBox — 自動回覆留底卡的脊椎(email-auto-reply m2)。
 *
 * gmailPipeline posts ONE observation agentMessage per processed email; the
 * ones whose context carries sendOutcome auto_replied / would_auto_send are
 * the 信任階梯's evidence trail:
 *   - auto_replied     → Stage B 已自動寄出(留底,可跟進更正)
 *   - would_auto_send  → Stage A 影子(本來會自動回,實際沒寄)
 *
 * This module lists them for the 今日待辦 box. Dismissing a card =
 * readByJeff (via the generic agent.replyToMessage markRead), so it shares
 * the same read-state as the agent-chat channel — one ack clears both.
 */
import { eq, and, desc, gte, or, like, sql } from "drizzle-orm";
import { getDb } from "../db";
import { agentMessages } from "../../drizzle/schema";
import { createChildLogger } from "./logger";
import { stripMarkdownForEmail } from "./plainTextReply";

const log = createChildLogger({ module: "autoReplyBox" });

const WINDOW_DAYS = 7;
const CAP = 30;

export type AutoReplyCardKind = "sent" | "shadow";

export interface AutoReplyCard {
  id: number;
  kind: AutoReplyCardKind;
  title: string;
  classification: string | null;
  confidence: number | null;
  customerEmail: string | null;
  subject: string | null;
  draftReply: string | null;
  read: boolean;
  createdAt: Date;
  /** 跟進更正 available (context carries the Gmail reply target). */
  replyable: boolean;
}

/**
 * Pure parse of an observation's context JSON → card fields, or null when
 * the row isn't an auto-reply/shadow record (or context is malformed).
 */
export function parseAutoReplyCard(
  context: string | null,
): Omit<AutoReplyCard, "id" | "title" | "read" | "createdAt"> | null {
  if (!context) return null;
  let p: Record<string, unknown>;
  try {
    const parsed = JSON.parse(context);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    p = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const outcome = p.sendOutcome;
  if (outcome !== "auto_replied" && outcome !== "would_auto_send") return null;
  const customerEmail =
    typeof p.customerEmail === "string" && p.customerEmail
      ? p.customerEmail
      : null;
  const gmailThreadId =
    typeof p.gmailThreadId === "string" && p.gmailThreadId
      ? p.gmailThreadId
      : null;
  return {
    kind: outcome === "auto_replied" ? "sent" : "shadow",
    classification:
      typeof p.classification === "string" ? p.classification : null,
    confidence: typeof p.confidence === "number" ? p.confidence : null,
    customerEmail,
    subject: typeof p.subject === "string" ? p.subject : null,
    // 2026-06-13 — strip markdown on read (same as escalationBox): clean
    // the card preview + the 跟進更正 prefill even for pre-fix stored drafts.
    draftReply:
      typeof p.draftReply === "string" && p.draftReply.trim()
        ? stripMarkdownForEmail(p.draftReply)
        : null,
    replyable: customerEmail != null && gmailThreadId != null,
  };
}

/** Last 7 days of auto-reply / shadow cards, unread first then newest. */
export async function listAutoReplyCards(): Promise<AutoReplyCard[]> {
  const db = await getDb();
  if (!db) {
    log.warn("[autoReplyBox] db unavailable");
    return [];
  }
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: agentMessages.id,
      title: agentMessages.title,
      context: agentMessages.context,
      readByJeff: agentMessages.readByJeff,
      createdAt: agentMessages.createdAt,
    })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.agentName, "inquiry"),
        eq(agentMessages.messageType, "observation"),
        gte(agentMessages.createdAt, since),
        // cheap pre-filter; the real check is the parse below
        or(
          like(agentMessages.context, '%"sendOutcome":"auto_replied"%'),
          like(agentMessages.context, '%"sendOutcome":"would_auto_send"%'),
        ),
      ),
    )
    .orderBy(
      sql`${agentMessages.readByJeff} ASC`,
      desc(agentMessages.createdAt),
    )
    .limit(CAP);

  const cards: AutoReplyCard[] = [];
  for (const r of rows) {
    const parsed = parseAutoReplyCard(r.context);
    if (!parsed) continue;
    cards.push({
      id: r.id,
      title: r.title,
      read: r.readByJeff !== 0,
      createdAt: r.createdAt,
      ...parsed,
    });
  }
  return cards;
}
