/**
 * Vouchers router — reward-voucher catalog + customer redeem/list + admin tools.
 *
 * Extracted from server/routers.ts (Phase 4D · sub-PR 4 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1, P0-2 — SOLO REVIEW
 * money-path PR). Source range (verbatim from origin): L937-1102.
 *
 * Procedures (5):
 *   - catalog          (public)    – voucher catalog with gate-state evaluation
 *   - redeem           (protected) – customer redeems Packpoint for a voucher
 *   - myVouchers       (protected) – list current user's own vouchers
 *   - adminList        (admin)     – list all vouchers with filters
 *   - adminMarkRedeemed (admin)    – mark a voucher as used
 *
 * Behavioral coverage: voucher consume + redeem flows have additional
 * coverage in server/_core/vouchers.test.ts (issueVoucher / markVoucherRedeemed
 * unit tests). This Phase 4D extraction is STRUCTURAL only — no procedure
 * body changes.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const vouchersRouter = router({
    /**
     * Public catalog with optional gate-state evaluation (e.g. photo book
     * shows "you need 50 photos, have 37" copy when user is logged in).
     */
    catalog: publicProcedure.query(async ({ ctx }) => {
      const { VOUCHER_CATALOG } = await import("../_core/vouchers");
      const userId = ctx.user?.id;
      // Attach gate-blocked status per item
      const items = await Promise.all(
        VOUCHER_CATALOG.map(async (item) => {
          let gateBlocked: string | null = null;
          if (item.gate && userId) {
            try {
              gateBlocked = await item.gate(userId);
            } catch {
              gateBlocked = null;
            }
          }
          return {
            sku: item.sku,
            type: item.type,
            pointsCost: item.pointsCost,
            amountUsd: item.amountUsd,
            titleZh: item.titleZh,
            titleEn: item.titleEn,
            descriptionZh: item.descriptionZh,
            descriptionEn: item.descriptionEn,
            gateBlocked,
          };
        })
      );
      return items;
    }),

    /** Customer redeems Packpoint for a voucher. */
    redeem: protectedProcedure
      .input(z.object({ sku: z.string().max(32) }))
      .mutation(async ({ ctx, input }) => {
        const { issueVoucher } = await import("../_core/vouchers");
        // Pre-check: does user have enough points?
        const userBalance = (ctx.user as any).packpointBalance ?? 0;
        const { findCatalogItem } = await import("../_core/vouchers");
        const item = findCatalogItem(input.sku);
        if (!item) {
          throw new TRPCError({ code: "NOT_FOUND", message: "兌換項目不存在" });
        }
        if (userBalance < item.pointsCost) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Packpoint 不足(需要 ${item.pointsCost.toLocaleString()},目前 ${userBalance.toLocaleString()})`,
          });
        }
        const result = await issueVoucher({ userId: ctx.user.id, sku: input.sku });
        if (!result.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
        }

        // Round 80.22 Phase G: email the code to the customer (best-effort)
        try {
          const { sendVoucherIssuedEmail } = await import("../email");
          // Detect language: check user.preferredLocale or ctx
          const lang =
            ((ctx.user as any).customerLanguage as "zh-TW" | "en" | undefined) ?? "zh-TW";
          await sendVoucherIssuedEmail({
            customerEmail: ctx.user.email,
            customerName: ctx.user.name || ctx.user.email.split("@")[0],
            voucherCode: result.data.code,
            voucherTitle: lang === "en" ? item.titleEn : item.titleZh,
            amountUsd: result.data.amountUsd,
            pointsCost: result.data.pointsCost,
            expiresAt: result.data.expiresAt,
            language: lang,
          });
        } catch (err) {
          // Don't fail the redemption — code is still in the UI
          console.error("[vouchers.redeem] Email failed:", err);
        }

        return result.data;
      }),

    /** List current user's own vouchers. */
    myVouchers: protectedProcedure.query(async ({ ctx }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return [];
      const { rewardVouchers } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return await drizzleDb
        .select()
        .from(rewardVouchers)
        .where(eq(rewardVouchers.userId, ctx.user.id))
        .orderBy(desc(rewardVouchers.createdAt));
    }),

    /** Admin: list all vouchers with filters. */
    adminList: adminProcedure
      .input(
        z.object({
          status: z.enum(["issued", "redeemed", "expired", "voided", "all"]).default("all"),
          type: z.enum(["flight_credit", "photo_book", "tour_credit", "all"]).default("all"),
          limit: z.number().int().positive().max(200).default(50),
          cursor: z.number().int().optional(),
        })
      )
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { items: [], nextCursor: null };
        const { rewardVouchers, users: usersTable } = await import("../../drizzle/schema");
        const { eq, and, lt, desc } = await import("drizzle-orm");
        const filters = [];
        if (input.status !== "all") filters.push(eq(rewardVouchers.status, input.status));
        if (input.type !== "all") filters.push(eq(rewardVouchers.type, input.type));
        if (input.cursor) filters.push(lt(rewardVouchers.id, input.cursor));
        const whereClause = filters.length ? and(...filters) : undefined;
        const rows = await drizzleDb
          .select({
            id: rewardVouchers.id,
            userId: rewardVouchers.userId,
            authorName: usersTable.name,
            authorEmail: usersTable.email,
            type: rewardVouchers.type,
            code: rewardVouchers.code,
            amountUsd: rewardVouchers.amountUsd,
            pointsCost: rewardVouchers.pointsCost,
            status: rewardVouchers.status,
            expiresAt: rewardVouchers.expiresAt,
            redeemedAt: rewardVouchers.redeemedAt,
            redeemedAgainstBookingId: rewardVouchers.redeemedAgainstBookingId,
            notes: rewardVouchers.notes,
            createdAt: rewardVouchers.createdAt,
          })
          .from(rewardVouchers)
          .leftJoin(usersTable, eq(rewardVouchers.userId, usersTable.id))
          .where(whereClause)
          .orderBy(desc(rewardVouchers.id))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
      }),

    /** Admin: mark a voucher as redeemed (used). */
    adminMarkRedeemed: adminProcedure
      .input(
        z.object({
          voucherId: z.number().int().positive(),
          bookingId: z.number().int().positive().optional(),
          notes: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { markVoucherRedeemed } = await import("../_core/vouchers");
        const result = await markVoucherRedeemed({
          voucherId: input.voucherId,
          adminId: ctx.user.id,
          bookingId: input.bookingId,
          notes: input.notes,
        });
        if (!result.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
        }
        return { ok: true };
      }),
  });
