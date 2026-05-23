/**
 * adminCleanup router — review-and-bulk-delete for dev/test data.
 *
 * 2026-05-22 — Jeff: "把測試訊息都刪掉" and "行程明明只有 100 卻顯示 141"
 *
 * 3 candidate queries + 3 bulk-delete mutations. All read-only candidate
 * queries return preview rows so Jeff can review BEFORE deleting. Bulk
 * delete accepts an explicit ID list — never a "delete all candidates"
 * shortcut, to make accidental nukes impossible.
 *
 * Wired into routers.ts. Surfaces in /admin/v2 → 系統 → 清理 (new tab,
 * see CleanupTabV2).
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { and, eq, inArray, isNull, like, or, sql, lt, gt, lte } from "drizzle-orm";

export const adminCleanupRouter = router({
  // ──────────────────────────────────────────────────────────────────────
  // 1) Stale tours — active tours with zero bookings + likely test markers
  // ──────────────────────────────────────────────────────────────────────
  findStaleTours: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { tours, bookings } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return { rows: [], total: 0, criteriaNote: "DB unavailable" };

    // Get all active tours
    const all = await db
      .select({
        id: tours.id,
        title: tours.title,
        status: tours.status,
        destinationCountry: tours.destinationCountry,
        duration: tours.duration,
        price: tours.price,
        priceCurrency: tours.priceCurrency,
        featured: tours.featured,
        sourceUrl: tours.sourceUrl,
        createdAt: tours.createdAt,
      })
      .from(tours)
      .where(eq(tours.status, "active" as any));

    // Booking counts per tour (single query)
    const bookingCounts = await db
      .select({
        tourId: bookings.tourId,
        count: sql<number>`COUNT(*)`.as("count"),
      })
      .from(bookings)
      .groupBy(bookings.tourId);
    const countByTourId = new Map<number, number>();
    for (const r of bookingCounts) {
      countByTourId.set(r.tourId as number, Number(r.count));
    }

    // Heuristic score: higher = more likely stale/test
    const rows = all.map((t) => {
      const reasons: string[] = [];
      const bookingCount = countByTourId.get(t.id) ?? 0;

      if (bookingCount === 0) reasons.push("zero_bookings");

      const title = (t.title ?? "").toLowerCase();
      if (/test|測試|draft|草稿|temp|abc|xxx/i.test(title)) reasons.push("test_title");

      if (!t.sourceUrl) reasons.push("no_source_url");
      if (!t.duration || t.duration <= 0) reasons.push("invalid_duration");
      if (!t.price || t.price <= 0) reasons.push("invalid_price");

      const ageDays = t.createdAt
        ? (Date.now() - new Date(t.createdAt).getTime()) / 86400000
        : 999;
      if (ageDays > 90 && bookingCount === 0) reasons.push("old_unused_90d");

      return {
        id: t.id,
        title: t.title,
        status: t.status,
        destinationCountry: t.destinationCountry,
        duration: t.duration,
        price: t.price,
        priceCurrency: t.priceCurrency,
        featured: t.featured === 1,
        bookingCount,
        ageDays: Math.round(ageDays),
        createdAt: t.createdAt,
        reasons,
        // Score: # of stale reasons. >= 2 = strong candidate for cleanup
        score: reasons.length,
      };
    });

    // Sort by score desc — most-likely test data first
    rows.sort((a, b) => b.score - a.score);
    return {
      total: rows.length,
      candidates: rows.filter((r) => r.score >= 1).length,
      strongCandidates: rows.filter((r) => r.score >= 2).length,
      rows,
      criteriaNote:
        "Heuristic: zero bookings, test-keyword title, no sourceUrl, invalid fields, age > 90d with no bookings. " +
        "Score is # of triggered heuristics. Mark inactive (soft delete) recommended over hard delete.",
    };
  }),

  // Bulk soft-delete (status → 'inactive'). Accepts explicit ID list only.
  markToursInactive: adminProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const { tours } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const result = await db
        .update(tours)
        .set({ status: "inactive" as any })
        .where(inArray(tours.id, input.ids));

      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "admin.cleanup.markToursInactive",
        targetType: "tour",
        targetId: input.ids.join(","),
        changes: { count: input.ids.length },
      });

      return { affected: (result as any).affectedRows ?? input.ids.length };
    }),

  // ──────────────────────────────────────────────────────────────────────
  // 2) Test-looking inquiries
  // ──────────────────────────────────────────────────────────────────────
  findTestInquiries: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { inquiries } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return { rows: [], total: 0, criteriaNote: "DB unavailable" };

    const all = await db
      .select({
        id: inquiries.id,
        customerName: inquiries.customerName,
        customerEmail: inquiries.customerEmail,
        customerPhone: inquiries.customerPhone,
        subject: inquiries.subject,
        message: inquiries.message,
        status: inquiries.status,
        createdAt: inquiries.createdAt,
      })
      .from(inquiries);

    const rows = all.map((r) => {
      const reasons: string[] = [];
      const email = (r.customerEmail ?? "").toLowerCase();
      const name = (r.customerName ?? "").toLowerCase();
      const phone = r.customerPhone ?? "";

      if (/@test\.|@example\.|@dev\.|@localhost/i.test(email)) reasons.push("test_email");
      if (/jeff|test|測試|abc|xxx|^a$|^aaa$|^123$/i.test(name)) reasons.push("test_name");
      if (/123456|0000|1234567890|0987654321|0911-?000-?000/.test(phone))
        reasons.push("test_phone");
      const msg = (r.message ?? "").toLowerCase();
      if (msg.length > 0 && msg.length < 8 && /test|abc|hello|hi$|asdf/i.test(msg))
        reasons.push("test_message");

      return {
        id: r.id,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        customerPhone: r.customerPhone,
        subject: r.subject,
        message: (r.message ?? "").slice(0, 80),
        status: r.status,
        createdAt: r.createdAt,
        reasons,
        score: reasons.length,
      };
    });

    rows.sort((a, b) => b.score - a.score || (b.id - a.id));
    return {
      total: rows.length,
      candidates: rows.filter((r) => r.score >= 1).length,
      strongCandidates: rows.filter((r) => r.score >= 2).length,
      rows: rows.filter((r) => r.score >= 1), // only return candidates
      criteriaNote:
        "Heuristic: test-domain email, test-name, repeating-digit phone, short test message. Score >= 2 = strong.",
    };
  }),

  deleteInquiries: adminProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const { inquiries } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const result = await db
        .delete(inquiries)
        .where(inArray(inquiries.id, input.ids));

      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "admin.cleanup.deleteInquiries",
        targetType: "inquiry",
        targetId: input.ids.join(","),
        changes: { count: input.ids.length },
      });

      return { affected: (result as any).affectedRows ?? input.ids.length };
    }),

  // ──────────────────────────────────────────────────────────────────────
  // 3) Stale agent messages (development noise in Office Chat)
  // ──────────────────────────────────────────────────────────────────────
  findTestAgentMessages: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { agentMessages } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return { rows: [], total: 0, criteriaNote: "DB unavailable" };

    const all = await db
      .select({
        id: agentMessages.id,
        agentName: agentMessages.agentName,
        messageType: agentMessages.messageType,
        title: agentMessages.title,
        body: agentMessages.body,
        priority: agentMessages.priority,
        readByJeff: agentMessages.readByJeff,
        proposalDecision: agentMessages.proposalDecision,
        createdAt: agentMessages.createdAt,
      })
      .from(agentMessages);

    const rows = all.map((m) => {
      const reasons: string[] = [];
      const title = (m.title ?? "").toLowerCase();
      const body = (m.body ?? "").toLowerCase();

      if (/test|測試|debug|asdf|hello world|hello123/i.test(title)) reasons.push("test_title");
      if (body.length > 0 && body.length < 15) reasons.push("very_short_body");
      if (m.priority === "low" && m.readByJeff === 1 && m.proposalDecision === "rejected") {
        reasons.push("low_priority_read_rejected");
      }
      const ageDays = m.createdAt
        ? (Date.now() - new Date(m.createdAt).getTime()) / 86400000
        : 0;
      if (ageDays > 30 && m.readByJeff === 1 && m.proposalDecision !== "pending") {
        reasons.push("old_resolved_30d");
      }

      return {
        id: m.id,
        agentName: m.agentName,
        messageType: m.messageType,
        title: m.title,
        bodyPreview: (m.body ?? "").slice(0, 80),
        priority: m.priority,
        readByJeff: m.readByJeff === 1,
        proposalDecision: m.proposalDecision,
        createdAt: m.createdAt,
        ageDays: Math.round(ageDays),
        reasons,
        score: reasons.length,
      };
    });

    rows.sort((a, b) => b.score - a.score || (b.id - a.id));
    return {
      total: rows.length,
      candidates: rows.filter((r) => r.score >= 1).length,
      strongCandidates: rows.filter((r) => r.score >= 2).length,
      rows: rows.filter((r) => r.score >= 1),
      criteriaNote:
        "Heuristic: test-keyword title, very short body, low-priority+read+rejected, or old + resolved (>30d). Score >= 2 = strong.",
    };
  }),

  deleteAgentMessages: adminProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const { agentMessages } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const result = await db
        .delete(agentMessages)
        .where(inArray(agentMessages.id, input.ids));

      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "admin.cleanup.deleteAgentMessages",
        targetType: "agentMessage",
        targetId: input.ids.join(","),
        changes: { count: input.ids.length },
      });

      return { affected: (result as any).affectedRows ?? input.ids.length };
    }),

  /**
   * Nuke ALL agent messages from specified agents. For PACK&GO right now
   * this means catalog + inquiry agents (101 + 36 auto-generated test
   * messages from the supplier sync + inquiry routing pipelines). Always
   * keeps "ops" agent messages (Jeff's actual conversation history).
   *
   * Audit log captures the agent name list + delete count.
   */
  purgeAgentMessagesByAgent: adminProcedure
    .input(
      z.object({
        agentNames: z.array(z.string().min(1).max(64)).min(1).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const { agentMessages } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Safety: never let "ops" through this endpoint — Jeff's real
      // conversation history must be cleared via the explicit-IDs
      // deleteAgentMessages endpoint instead.
      const safeNames = input.agentNames.filter((n) => n !== "ops");
      if (safeNames.length === 0) {
        throw new Error("Cannot purge ops agent via this endpoint. Use deleteAgentMessages with explicit IDs.");
      }

      const result = await db
        .delete(agentMessages)
        .where(inArray(agentMessages.agentName, safeNames));

      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "admin.cleanup.purgeAgentMessagesByAgent",
        targetType: "agentMessage",
        targetId: safeNames.join(","),
        changes: {
          agentNames: safeNames,
          count: (result as any).affectedRows ?? 0,
        },
      });

      return {
        affected: (result as any).affectedRows ?? 0,
        purgedAgents: safeNames,
      };
    }),
});
