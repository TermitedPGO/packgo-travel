/**
 * preDepartureNotifications router — batch 6 m3.
 *
 * Admin-only CRUD for LLM-drafted pre-departure messages.
 * Generate → review each → approve (sends email) or skip.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { createChildLogger } from "../_core/logger";
import { reportFunnelError } from "../_core/errorFunnel";
import * as db from "../db";
import { eq, and, desc } from "drizzle-orm";

const log = createChildLogger({ module: "pre-departure-router" });

export const preDepartureNotificationsRouter = router({
  generate: adminProcedure
    .input(z.object({ departureId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { generatePreDepartureMessages } = await import(
        "../_core/preDepartureDraftService"
      );
      return generatePreDepartureMessages(input.departureId);
    }),

  list: adminProcedure
    .input(z.object({ departureId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { preDepartureNotifications } = await import("../../drizzle/schema");
      return drizzleDb
        .select()
        .from(preDepartureNotifications)
        .where(eq(preDepartureNotifications.departureId, input.departureId))
        .orderBy(desc(preDepartureNotifications.createdAt));
    }),

  approve: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const drizzleDb = (await db.getDb())!;
      const { preDepartureNotifications } = await import("../../drizzle/schema");

      const [row] = await drizzleDb
        .select()
        .from(preDepartureNotifications)
        .where(eq(preDepartureNotifications.id, input.id));

      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot approve: status is ${row.status}`,
        });
      }

      try {
        const { wrapInBrandTemplate } = await import(
          "../services/emailTemplateService"
        );
        const { getTransporter, EMAIL_FROM } = await import("../email/_shared");
        const transporter = getTransporter()!;

        const html = wrapInBrandTemplate({
          title: row.subject || "Pre-departure Notice",
          bodyHtml: `<p>${row.content.replace(/\n/g, "<br>")}</p>`,
        });

        await transporter.sendMail({
          from: EMAIL_FROM,
          to: row.recipientEmail,
          subject: row.subject || "Pre-departure Notice",
          html,
        });

        await drizzleDb
          .update(preDepartureNotifications)
          .set({
            status: "sent",
            sentAt: new Date(),
            approvedBy: ctx.user.id,
          })
          .where(eq(preDepartureNotifications.id, input.id));

        log.info(
          { id: input.id, to: row.recipientEmail },
          "pre-departure email sent",
        );
        return { ok: true, sent: true };
      } catch (err) {
        log.error({ err, id: input.id }, "email send failed, marking approved");
        reportFunnelError({ source: "fail-open:preDepartureNotifications:send", err, context: { id: input.id } }).catch(() => {});
        await drizzleDb
          .update(preDepartureNotifications)
          .set({ status: "approved", approvedBy: ctx.user.id })
          .where(eq(preDepartureNotifications.id, input.id));
        return { ok: true, sent: false };
      }
    }),

  edit: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        subject: z.string().max(256).optional(),
        content: z.string().max(10000),
      }),
    )
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { preDepartureNotifications } = await import("../../drizzle/schema");

      const updates: Record<string, unknown> = { content: input.content };
      if (input.subject !== undefined) updates.subject = input.subject;

      await drizzleDb
        .update(preDepartureNotifications)
        .set(updates)
        .where(
          and(
            eq(preDepartureNotifications.id, input.id),
            eq(preDepartureNotifications.status, "draft"),
          ),
        );

      return { ok: true };
    }),

  skip: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const drizzleDb = (await db.getDb())!;
      const { preDepartureNotifications } = await import("../../drizzle/schema");

      await drizzleDb
        .update(preDepartureNotifications)
        .set({ status: "skipped" })
        .where(
          and(
            eq(preDepartureNotifications.id, input.id),
            eq(preDepartureNotifications.status, "draft"),
          ),
        );

      return { ok: true };
    }),
});
