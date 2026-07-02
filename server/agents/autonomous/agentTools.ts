/**
 * Round 81 — Agent tool use (function calling).
 *
 * Replaces "preload everything into context" with "let the agent decide
 * what to look up". Tools are read-only Drizzle queries against the
 * PACK&GO database — agents can call any of them mid-conversation when
 * they need data.
 *
 * Used by both runAgentChat (per-agent DM) and runOfficeAssistant (#全體).
 *
 * Adding a new tool:
 *   1. Add entry to TOOL_DEFS with Anthropic-compatible JSONSchema
 *   2. Add case in `executeTool()` that returns a JSON-serializable result
 *   3. Keep returns small — agents read these as text, big payloads waste tokens
 */

import { getDb } from "../../db";
import {
  tours,
  bookings,
  customerProfiles,
  customerInteractions,
  interactionOutcomes,
  agentPolicies,
  agentMessages,
  agentActivityLogs,
} from "../../../drizzle/schema";
import { eq, and, desc, or, sql, like } from "drizzle-orm";

// ────────────────────────────────────────────────────────────────────────
// Tool definitions — OpenAI-style (codebase normalizes to Anthropic format)
// ────────────────────────────────────────────────────────────────────────

const TOOL_FN_DEFS = [
  {
    name: "list_active_tours",
    description:
      "List active (狀態=active, 上架中) tours from the PACK&GO catalog. Use when Jeff asks about current tours or available products.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max number of tours (default 20, max 50)",
        },
        destination_contains: {
          type: "string",
          description: "Optional filter: only tours whose destinationCity OR title contains this string",
        },
      },
      required: [],
    },
  },
  {
    name: "get_customer_by_email",
    description:
      "Look up a customer profile + their most recent 10 interactions by email address. Use when Jeff mentions a specific customer.",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string" },
      },
      required: ["email"],
    },
  },
  {
    name: "list_recent_bookings",
    description:
      "List recent bookings (newest first). Use when Jeff asks about訂單 / 預訂.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max rows (default 15)" },
        status: {
          type: "string",
          description: "Optional status filter (e.g. 'pending' / 'paid' / 'cancelled')",
        },
      },
      required: [],
    },
  },
  {
    name: "list_agent_recent_outcomes",
    description:
      "Recent decisions/outcomes for a specific Round 81 agent. If you're the agent, this is your own action log. Includes Jeff override info.",
    parameters: {
      type: "object",
      properties: {
        agent_name: {
          type: "string",
          enum: ["inquiry", "review", "marketing", "followup", "refund", "self_retrospective"],
        },
        limit: { type: "integer", description: "Max rows (default 20)" },
      },
      required: ["agent_name"],
    },
  },
  {
    name: "list_pending_for_jeff",
    description:
      "Items waiting for Jeff's review across ALL Round 81 agents — escalations + low-confidence (conf < 70) that are not yet finalized. Use when Jeff asks 'what needs my attention'.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max rows (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "get_office_summary",
    description:
      "Aggregate snapshot of PACK&GO: total tours, active tours, recent inquiries (24h), pending items, per-agent 7d activity. Use as a quick orientation when Jeff asks general 'how are we doing'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_recent_general_failures",
    description:
      "Recent failed tooling agent runs (e.g. failed Lion bulk imports, AI generation errors). This is what makes the '等你看' counter on the header sometimes look high.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max rows (default 10)" },
      },
      required: [],
    },
  },
  {
    name: "search_tours",
    description:
      "Search tours by free-text query (matches title / destinationCity / productCode). Returns up to 15 matches.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", description: "Max rows (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_agent_active_policy",
    description:
      "Get the currently active policy (rules) for a specific Round 81 agent. Use when you need to check what rules another agent is following.",
    parameters: {
      type: "object",
      properties: {
        agent_name: {
          type: "string",
          enum: ["inquiry", "review", "marketing", "followup", "refund", "self_retrospective"],
        },
      },
      required: ["agent_name"],
    },
  },
];

/** OpenAI-style tool array passed to invokeLLM. */
export const AGENT_TOOL_DEFS = TOOL_FN_DEFS.map((fn) => ({
  type: "function" as const,
  function: fn,
}));

// ────────────────────────────────────────────────────────────────────────
// Executor
// ────────────────────────────────────────────────────────────────────────

export type ToolResult =
  | { ok: true; data: any }
  | { ok: false; error: string };

export async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<ToolResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database unavailable" };

  try {
    switch (name) {
      case "list_active_tours": {
        const limit = Math.min(args.limit ?? 20, 50);
        const dest = args.destination_contains?.trim();
        const conds: any[] = [eq(tours.status, "active")];
        if (dest) {
          conds.push(
            or(
              like(tours.destinationCity, `%${dest}%`),
              like(tours.destinationCountry, `%${dest}%`),
              like(tours.title, `%${dest}%`)
            )
          );
        }
        const rows = await db
          .select({
            id: tours.id,
            title: tours.title,
            duration: tours.duration,
            destinationCity: tours.destinationCity,
            destinationCountry: tours.destinationCountry,
            price: tours.price,
            priceCurrency: tours.priceCurrency,
            productCode: tours.productCode,
          })
          .from(tours)
          .where(and(...conds))
          .orderBy(desc(tours.id))
          .limit(limit);
        return { ok: true, data: { count: rows.length, tours: rows } };
      }

      case "search_tours": {
        const q = String(args.query ?? "").trim();
        const limit = Math.min(args.limit ?? 10, 15);
        if (!q) return { ok: false, error: "query is required" };
        const rows = await db
          .select({
            id: tours.id,
            title: tours.title,
            destinationCity: tours.destinationCity,
            destinationCountry: tours.destinationCountry,
            duration: tours.duration,
            price: tours.price,
            priceCurrency: tours.priceCurrency,
            status: tours.status,
            productCode: tours.productCode,
          })
          .from(tours)
          .where(
            or(
              like(tours.title, `%${q}%`),
              like(tours.destinationCity, `%${q}%`),
              like(tours.destinationCountry, `%${q}%`),
              like(tours.productCode, `%${q}%`)
            )
          )
          .orderBy(desc(tours.id))
          .limit(limit);
        return { ok: true, data: { count: rows.length, tours: rows } };
      }

      case "get_customer_by_email": {
        const email = String(args.email ?? "").trim().toLowerCase();
        if (!email) return { ok: false, error: "email is required" };
        let [profile] = await db
          .select()
          .from(customerProfiles)
          .where(eq(customerProfiles.email, email))
          .limit(1);
        if (profile) {
          // 0109:這個 email 的卡已被併走 → 回合併後的最終卡(歷史都在那)。
          const { followMergePointer } = await import("../../_core/mergedProfile");
          const canonicalId = await followMergePointer(db, profile.id);
          if (canonicalId !== profile.id) {
            const [canonical] = await db
              .select()
              .from(customerProfiles)
              .where(eq(customerProfiles.id, canonicalId))
              .limit(1);
            if (canonical) profile = canonical;
          }
        }
        if (!profile) {
          return { ok: true, data: { found: false, email } };
        }
        const interactions = await db
          .select({
            id: customerInteractions.id,
            channel: customerInteractions.channel,
            direction: customerInteractions.direction,
            classification: customerInteractions.classification,
            sentiment: customerInteractions.sentiment,
            contentSummary: customerInteractions.contentSummary,
            createdAt: customerInteractions.createdAt,
          })
          .from(customerInteractions)
          .where(eq(customerInteractions.customerProfileId, profile.id))
          .orderBy(desc(customerInteractions.createdAt))
          .limit(10);
        return {
          ok: true,
          data: {
            found: true,
            profile: {
              id: profile.id,
              email: profile.email,
              phone: profile.phone,
              preferredLanguage: profile.preferredLanguage,
              vipScore: profile.vipScore,
              bookingCount: profile.bookingCount,
              totalSpend: profile.totalSpend,
              aiNotes: profile.aiNotes?.slice(0, 500),
              status: profile.status,
              createdAt: profile.createdAt,
            },
            recentInteractions: interactions,
          },
        };
      }

      case "list_recent_bookings": {
        const limit = Math.min(args.limit ?? 15, 30);
        const conds: any[] = [];
        if (args.status) conds.push(eq(bookings.bookingStatus, args.status));
        // Note: projection keys (left-hand side) are the agent-facing tool API
        // names — preserved for prompt stability. Right-hand side references
        // the canonical schema column names.
        const query = db
          .select({
            id: bookings.id,
            tourId: bookings.tourId,
            userId: bookings.userId,
            status: bookings.bookingStatus,
            totalPrice: bookings.totalPrice,
            adults: bookings.numberOfAdults,
            createdAt: bookings.createdAt,
            contactEmail: bookings.customerEmail,
            contactName: bookings.customerName,
          })
          .from(bookings)
          .orderBy(desc(bookings.createdAt))
          .limit(limit);
        const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
        return { ok: true, data: { count: rows.length, bookings: rows } };
      }

      case "list_agent_recent_outcomes": {
        const agentName = String(args.agent_name ?? "");
        const limit = Math.min(args.limit ?? 20, 50);
        if (!agentName) return { ok: false, error: "agent_name is required" };
        const rows = await db
          .select({
            id: interactionOutcomes.id,
            actionTaken: interactionOutcomes.actionTaken,
            confidence: interactionOutcomes.confidence,
            customerSentiment: interactionOutcomes.customerSentiment,
            customerReplied: interactionOutcomes.customerReplied,
            customerBooked: interactionOutcomes.customerBooked,
            refundRequested: interactionOutcomes.refundRequested,
            jeffOverride: interactionOutcomes.jeffOverride,
            jeffOverrideReason: interactionOutcomes.jeffOverrideReason,
            outcomeFinalized: interactionOutcomes.outcomeFinalized,
            createdAt: interactionOutcomes.createdAt,
          })
          .from(interactionOutcomes)
          .where(eq(interactionOutcomes.agentName, agentName))
          .orderBy(desc(interactionOutcomes.createdAt))
          .limit(limit);
        return { ok: true, data: { count: rows.length, outcomes: rows } };
      }

      case "list_pending_for_jeff": {
        const limit = Math.min(args.limit ?? 20, 50);
        const rows = await db
          .select({
            id: interactionOutcomes.id,
            agentName: interactionOutcomes.agentName,
            actionTaken: interactionOutcomes.actionTaken,
            confidence: interactionOutcomes.confidence,
            createdAt: interactionOutcomes.createdAt,
          })
          .from(interactionOutcomes)
          .where(
            and(
              eq(interactionOutcomes.outcomeFinalized, 0),
              or(
                sql`${interactionOutcomes.actionTaken} LIKE '%escalate%'`,
                sql`${interactionOutcomes.confidence} < 70`
              )
            )
          )
          .orderBy(desc(interactionOutcomes.createdAt))
          .limit(limit);
        return { ok: true, data: { count: rows.length, items: rows } };
      }

      case "get_office_summary": {
        const now = new Date();
        const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [{ totalTours } = { totalTours: 0 }] = await db
          .select({ totalTours: sql<number>`COUNT(*)` })
          .from(tours);
        const [{ activeTours } = { activeTours: 0 }] = await db
          .select({ activeTours: sql<number>`COUNT(*)` })
          .from(tours)
          .where(eq(tours.status, "active"));
        const [{ inq24 } = { inq24: 0 }] = await db
          .select({ inq24: sql<number>`COUNT(*)` })
          .from(customerInteractions)
          .where(
            and(
              eq(customerInteractions.direction, "inbound"),
              sql`${customerInteractions.createdAt} >= ${since24h}`
            )
          );
        const [{ pending } = { pending: 0 }] = await db
          .select({ pending: sql<number>`COUNT(*)` })
          .from(interactionOutcomes)
          .where(
            and(
              eq(interactionOutcomes.outcomeFinalized, 0),
              or(
                sql`${interactionOutcomes.actionTaken} LIKE '%escalate%'`,
                sql`${interactionOutcomes.confidence} < 70`
              )
            )
          );
        const [{ failed7d } = { failed7d: 0 }] = await db
          .select({ failed7d: sql<number>`COUNT(*)` })
          .from(agentActivityLogs)
          .where(
            and(
              eq(agentActivityLogs.status, "failed"),
              sql`${agentActivityLogs.startedAt} >= ${since7d}`
            )
          );
        const per7d = await db
          .select({
            agentName: interactionOutcomes.agentName,
            actions: sql<number>`COUNT(*)`,
            auto: sql<number>`SUM(CASE WHEN ${interactionOutcomes.actionTaken} NOT LIKE '%escalate%' THEN 1 ELSE 0 END)`,
            esc: sql<number>`SUM(CASE WHEN ${interactionOutcomes.actionTaken} LIKE '%escalate%' THEN 1 ELSE 0 END)`,
            overrides: sql<number>`SUM(${interactionOutcomes.jeffOverride})`,
          })
          .from(interactionOutcomes)
          .where(sql`${interactionOutcomes.createdAt} >= ${since7d}`)
          .groupBy(interactionOutcomes.agentName);

        return {
          ok: true,
          data: {
            totalTours: Number(totalTours ?? 0),
            activeTours: Number(activeTours ?? 0),
            recentInquiries24h: Number(inq24 ?? 0),
            pendingForJeffRound81: Number(pending ?? 0),
            failedToolingTasks7d: Number(failed7d ?? 0),
            per7d: per7d.map((r) => ({
              agent: r.agentName,
              actions: Number(r.actions ?? 0),
              auto: Number(r.auto ?? 0),
              escalations: Number(r.esc ?? 0),
              overrides: Number(r.overrides ?? 0),
            })),
          },
        };
      }

      case "list_recent_general_failures": {
        const limit = Math.min(args.limit ?? 10, 20);
        const rows = await db
          .select({
            id: agentActivityLogs.id,
            agentName: agentActivityLogs.agentName,
            agentKey: agentActivityLogs.agentKey,
            taskType: agentActivityLogs.taskType,
            taskTitle: agentActivityLogs.taskTitle,
            errorMessage: agentActivityLogs.errorMessage,
            startedAt: agentActivityLogs.startedAt,
          })
          .from(agentActivityLogs)
          .where(eq(agentActivityLogs.status, "failed"))
          .orderBy(desc(agentActivityLogs.startedAt))
          .limit(limit);
        return { ok: true, data: { count: rows.length, failures: rows } };
      }

      case "get_agent_active_policy": {
        const agentName = String(args.agent_name ?? "");
        if (!agentName) return { ok: false, error: "agent_name is required" };
        const [row] = await db
          .select({
            version: agentPolicies.version,
            rules: agentPolicies.rules,
            createdBy: agentPolicies.createdBy,
            reasonNote: agentPolicies.reasonNote,
            createdAt: agentPolicies.createdAt,
          })
          .from(agentPolicies)
          .where(and(eq(agentPolicies.agentName, agentName), eq(agentPolicies.active, 1)))
          .limit(1);
        if (!row) {
          return { ok: true, data: { found: false, agentName } };
        }
        return { ok: true, data: { found: true, ...row } };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
