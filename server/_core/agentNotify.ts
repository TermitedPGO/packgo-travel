/**
 * Round 81 / 2026-05-17 — Generic agentMessages notification helper.
 *
 * Every agent that wants to surface activity in Jeff's #channel chat
 * (ChatsTab admin tab) should call this helper instead of writing to
 * the agentMessages table directly. Keeps the message shape consistent
 * and gives us a single seam to add WebSocket push, mobile push, or
 * notifyOwner email cc later without touching N agents.
 *
 * Usage:
 *   import { notifyAgentMessage } from "./_core/agentNotify";
 *   await notifyAgentMessage({
 *     agentName: "inquiry",
 *     messageType: "question",
 *     title: "客戶問素食 — 是否加 35% surcharge?",
 *     body: "...",
 *     priority: "high",
 *     relatedCustomerProfileId: profile.id,
 *   });
 *
 * Failure semantics:
 *   - Never throws. agentMessages is a UX-affordance layer; a write
 *     failure should NOT break the agent's primary task. Logs and
 *     swallows.
 *   - If priority is 'critical', also fires notifyOwner (email + Jeff's
 *     phone) as a fallback so a DB outage doesn't silence emergencies.
 */
import { notifyOwner } from "./notification";

export type AgentMessageType =
  | "observation"
  | "proposal"
  | "question"
  | "alert"
  | "escalation"
  | "digest";

export type AgentMessagePriority = "low" | "normal" | "high" | "critical";

export interface NotifyAgentMessageArgs {
  /** Channel name in ChatsTab. Use one of the known agent slugs. */
  agentName: string;
  messageType: AgentMessageType;
  /** Short summary, ≤200 chars. Shown as the message header. */
  title: string;
  /** Body of the message — supports plain text with newlines. */
  body: string;
  priority?: AgentMessagePriority;
  /** Optional structured context (JSON serialisable) — shown as collapsible. */
  context?: unknown;
  /** Cross-references for navigation; all optional. */
  relatedOutcomeId?: number;
  relatedInteractionId?: number;
  relatedCustomerProfileId?: number;
}

export async function notifyAgentMessage(args: NotifyAgentMessageArgs): Promise<void> {
  const priority = args.priority ?? "normal";

  // 1. Best-effort write to agentMessages
  try {
    const { getDb } = await import("../db");
    const { agentMessages } = await import("../../drizzle/schema");
    const db = await getDb();
    if (db) {
      await db.insert(agentMessages).values({
        agentName: args.agentName,
        senderRole: "agent",
        messageType: args.messageType,
        title: args.title.slice(0, 200),
        body: args.body,
        context: args.context ? JSON.stringify(args.context) : null,
        priority,
        relatedOutcomeId: args.relatedOutcomeId ?? null,
        relatedInteractionId: args.relatedInteractionId ?? null,
        relatedCustomerProfileId: args.relatedCustomerProfileId ?? null,
      } as any);
      console.log(
        `[agentNotify] ${args.agentName}/${args.messageType}/${priority}: ${args.title.slice(0, 80)}`
      );
    }
  } catch (err) {
    console.error(
      `[agentNotify] DB insert failed for ${args.agentName}/${args.messageType}:`,
      (err as Error).message
    );
    // Don't throw — agent's primary task should still complete.
  }

  // 2. Critical-priority fallback — email Jeff directly so a DB outage
  //    can't silence emergencies. notifyOwner uses Gmail SMTP and has
  //    its own error handling.
  if (priority === "critical") {
    try {
      await notifyOwner({
        title: `🚨 ${args.agentName.toUpperCase()}: ${args.title}`,
        content: args.body,
      });
    } catch (err) {
      console.error("[agentNotify] critical-fallback email also failed:", (err as Error).message);
    }
  }
}
