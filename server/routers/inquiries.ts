/**
 * Inquiries router — customer support intake (general + emergency) +
 * admin management + per-thread messaging.
 *
 * Extracted from server/routers.ts (Phase 4C · sub-PR 3 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 * Source range (verbatim from origin): L3850-4141.
 *
 * Procedures (8):
 *   list             – admin: all inquiries
 *   getById          – auth: owner-or-admin guard
 *   translate        – admin: v78q Sprint 9 #4 — translate subject+message
 *                      via translateEntity('inquiry', ...) registry
 *   create           – public: general inquiry, P1-3 hardened
 *                      (string caps + per-IP rate limit 5/10min)
 *   createEmergency  – public: separate intake for on-trip emergencies
 *                      (medical / flight / passport / safety / other),
 *                      P1-2 hardened: dual rate-limit (per-IP 3/15min +
 *                      per-email 5/hr), fire-and-forget notifyOwner
 *                      with 🆘 prefix
 *   updateStatus     – admin: status transition
 *   update           – admin: alias for updateStatus (backward compat)
 *   getMessages      – auth: owner-or-admin guard
 *   addMessage       – auth: owner-or-admin guard; senderType derived
 *                      from ctx.user.role
 *
 * Migration 0077 applied (2026-05-20): inquiryType "emergency" is now
 * a first-class enum value on the DB column. The prior
 * `inquiryType: "emergency" as "other"` cast in createEmergency has
 * been removed; rows are persisted with the correct enum value.
 *
 * Security notes (preserved from origin):
 *   - SECURITY_AUDIT_2026_05_14 P1-3: bounded string maxes + per-IP
 *     rate limit on general create
 *   - P1-2: dual rate-limit + 🆘 owner alert on emergency intake to
 *     stop bot floods through the emergency channel
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { checkRateLimit } from "../rateLimit";
import { reportFunnelError } from "../_core/errorFunnel";

/**
 * customer-cockpit 任務7a(2026-07-03)— 網站詢問表單送出時,確保這位聯絡人
 * 在 customerProfiles 有卡 + 補一筆 customerInteractions,紅點該亮的亮。
 * Fire-and-forget:絕不讓客人看得到的表單回應被這裡的失敗拖慢或搞壞。
 */
function ingestWebsiteInquiryContact(input: {
  userId?: number | null;
  customerEmail: string;
  customerPhone?: string | null;
  customerName: string;
  subject: string;
  message: string;
}): void {
  void (async () => {
    try {
      const { ensureCustomerProfileForWebsiteContact, recordWebsiteInteraction } =
        await import("../_core/websiteIntake");
      const profileId = await ensureCustomerProfileForWebsiteContact({
        userId: input.userId ?? null,
        email: input.customerEmail,
        phone: input.customerPhone ?? null,
        name: input.customerName,
      });
      if (profileId) {
        await recordWebsiteInteraction({
          profileId,
          direction: "inbound",
          content: `${input.subject}\n\n${input.message}`,
          // 2026-07-03 監工確認修復 — 原本只放 subject(prod 實例:時間軸只顯示
          // 「客製旅遊」,看不出客人實際問了什麼),補上訊息本文前 120 字。
          contentSummary: `${input.subject}:${input.message.slice(0, 120)}`,
          agentName: "website_inquiry",
        });
      }
    } catch (err) {
      console.error("[inquiries] website channel intake failed:", err);
      reportFunnelError({ source: "fail-open:inquiries:websiteChannelIntakeFailed:create" , err }).catch(() => {});
    }
  })();
}

export const inquiriesRouter = router({
    // Get all inquiries (admin only)
    list: adminProcedure.query(async () => {
      return await db.getAllInquiries();
    }),

    // Get single inquiry
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const inquiry = await db.getInquiryById(input.id);
        if (!inquiry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inquiry not found",
          });
        }
        // Check if user owns this inquiry or is admin
        if (inquiry.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to view this inquiry",
          });
        }
        return inquiry;
      }),

    /**
     * v78q Sprint 9 #4: Translate inquiry subject + message for admin readability.
     * Goes through translateEntity('inquiry', ...) which uses the registry +
     * skip-if-unchanged. Returns the translated fields (admin can see ZH original
     * + EN translation side-by-side).
     */
    translate: adminProcedure
      .input(z.object({
        id: z.number(),
        targetLanguage: z.enum(["en"]).default("en"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { translateEntity } = await import("../translation");
        const result = await translateEntity(
          "inquiry",
          input.id,
          [input.targetLanguage as any],
          "zh-TW" as any,
          ctx.user.id
        );
        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.errors.join("; ") || "Translation failed",
          });
        }
        // Read back the saved translation rows
        const db2 = await import("../db").then((m) => m.getDb());
        if (!db2) return { translated: {} };
        const { translations: tTable } = await import("../../drizzle/schema");
        const { and: _and, eq: _eq } = await import("drizzle-orm");
        const rows = await db2.select().from(tTable).where(
          _and(
            _eq(tTable.entityType, "inquiry" as any),
            _eq(tTable.entityId, input.id),
            _eq(tTable.targetLanguage, input.targetLanguage)
          )
        );
        const translated: Record<string, string> = {};
        for (const r of rows as any[]) {
          translated[r.fieldName] = r.translatedText;
        }
        return { translated };
      }),

    // Create new inquiry.
    //
    // SECURITY_AUDIT_2026_05_14 P1-3 hardening:
    //   - All string fields capped with .max() so a malicious 50 MB submit
    //     no longer fits.
    //   - Per-IP rate limit (5 per 10 min) blocks bot floods.
    create: publicProcedure
      .input(
        z.object({
          customerName: z.string().min(1).max(100),
          customerEmail: z.string().email().max(320),
          customerPhone: z.string().max(40).optional(),
          subject: z.string().min(1).max(200),
          message: z.string().min(1).max(5000),
          // Tour-page redesign (migration 0088): optional structured context
          // when the inquiry is raised from a tour page's action area. The
          // qualitative wizard buckets are stored as language-neutral keys; the
          // human-readable summary is already folded into `message` client-side
          // (buildInquiryInput) so InquiryAgent needs no change.
          inquiryType: z.enum(["general", "custom_tour"]).default("general"),
          relatedTourId: z.number().int().positive().optional(),
          wizardAnswers: z
            .object({
              people: z.enum(["1-2", "3-5", "6+"]),
              timeframe: z.enum(["soon", "school_break", "discuss"]),
              budget: z.enum(["economy", "comfort", "luxury"]),
            })
            .partial()
            .optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const ip = ctx.ip || "unknown";
        const rl = await checkRateLimit({
          key: `inquiry:create:ip:${ip}`,
          limit: 5,
          window: 600, // 10 minutes
        });
        if (!rl.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "提交過於頻繁，請稍後再試。",
          });
        }
        // inquiryType comes from input (defaults to "general"); relatedTourId +
        // wizardAnswers ride along via ...input when present (migration 0088).
        const inquiry = await db.createInquiry({
          ...input,
          userId: ctx.user?.id,
          status: "new",
        });
        ingestWebsiteInquiryContact({
          userId: ctx.user?.id ?? null,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone ?? null,
          customerName: input.customerName,
          subject: input.subject,
          message: input.message,
        });
        return inquiry;
      }),

    /**
     * Emergency intake — for customers currently on a trip needing
     * urgent help (medical, missed flight, lost passport, etc.).
     *
     * QA audit 2026-05-11 Phase 5 found PACK&GO had no dedicated
     * emergency channel — the same ContactUs form handled both "I
     * want to book a tour" and "I'm in Iceland at 3am with no
     * passport". This procedure routes emergencies through a
     * separate intake that:
     *   1. Tags inquiryType="emergency" so admin Inbox sorts them up
     *   2. Immediately calls notifyOwner with [緊急] title prefix so
     *      Jeff's email gets a high-priority signal (and his email
     *      client likely flags it red)
     *   3. Captures the customer's current location for context
     */
    createEmergency: publicProcedure
      .input(
        z.object({
          customerName: z.string().min(1).max(100),
          customerEmail: z.string().email().max(320),
          customerPhone: z.string().min(1).max(40),
          currentLocation: z.string().min(1).max(200),
          severity: z.enum(["medical", "flight", "passport", "safety", "other"]),
          message: z.string().min(1).max(5000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // SECURITY_AUDIT_2026_05_14 P1-2: this procedure was unlimited and
        // synchronously fires notifyOwner. An attacker could flood Jeff's
        // inbox with 🆘 emails — the very channel meant for real
        // emergencies. Layer two rate limits so real emergencies (rare,
        // genuine) still pass while bot abuse hits a wall:
        //   - Per-IP: 3 per 15 min  (someone abroad with one phone)
        //   - Per-email: 5 per hour (catches stolen-IP bypass)
        const ip = ctx.ip || "unknown";
        const ipRl = await checkRateLimit({
          key: `inquiry:emergency:ip:${ip}`,
          limit: 3,
          window: 900,
        });
        if (!ipRl.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "提交過於頻繁，若為真實緊急情況請直接撥打 +1-510-789-9999。",
          });
        }
        const emailRl = await checkRateLimit({
          key: `inquiry:emergency:email:${input.customerEmail.toLowerCase()}`,
          limit: 5,
          window: 3600,
        });
        if (!emailRl.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "提交過於頻繁，若為真實緊急情況請直接撥打 +1-510-789-9999。",
          });
        }

        const severityLabel: Record<typeof input.severity, string> = {
          medical: "醫療緊急",
          flight: "班機問題",
          passport: "證件遺失",
          safety: "人身安全",
          other: "其他緊急",
        };
        const labelZh = severityLabel[input.severity];

        const inquiry = await db.createInquiry({
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          subject: `[緊急 · ${labelZh}] ${input.currentLocation}`,
          message: input.message,
          inquiryType: "emergency",
          userId: ctx.user?.id,
          status: "new",
        });

        // Fire-and-forget owner notification — never block the
        // customer-facing response on the email send.
        const { notifyOwner } = await import("../_core/notification");
        notifyOwner({
          title: `🆘 [緊急 · ${labelZh}] ${input.customerName} @ ${input.currentLocation}`,
          content:
            `客戶: ${input.customerName}\n` +
            `Email: ${input.customerEmail}\n` +
            `電話: ${input.customerPhone}\n` +
            `位置: ${input.currentLocation}\n` +
            `性質: ${labelZh}\n\n` +
            `訊息:\n${input.message}\n\n` +
            `Inquiry ID: ${inquiry?.id ?? "?"}\n` +
            `請盡快撥打客戶電話。`,
        }).catch((err) =>
          console.error("[inquiries.createEmergency] notifyOwner failed:", err)
        );

        ingestWebsiteInquiryContact({
          userId: ctx.user?.id ?? null,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          customerName: input.customerName,
          subject: `[緊急 · ${labelZh}] ${input.currentLocation}`,
          message: input.message,
        });

        return inquiry;
      }),

    // Update inquiry status (admin only)
    updateStatus: adminProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["new", "in_progress", "replied", "resolved", "closed"]),
        })
      )
      .mutation(async ({ input }) => {
        const { id, status } = input;
        return await db.updateInquiry(id, { status });
      }),

    // Alias for updateStatus (for backward compatibility)
    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["new", "in_progress", "replied", "resolved", "closed"]),
        })
      )
      .mutation(async ({ input }) => {
        const { id, status } = input;
        return await db.updateInquiry(id, { status });
      }),

    // Get messages for an inquiry
    getMessages: protectedProcedure
      .input(z.object({ inquiryId: z.number() }))
      .query(async ({ ctx, input }) => {
        const inquiry = await db.getInquiryById(input.inquiryId);
        if (!inquiry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inquiry not found",
          });
        }
        // Check if user owns this inquiry or is admin
        if (inquiry.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to view these messages",
          });
        }
        return await db.getInquiryMessages(input.inquiryId);
      }),

    // Add message to inquiry
    addMessage: protectedProcedure
      .input(
        z.object({
          inquiryId: z.number(),
          message: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const inquiry = await db.getInquiryById(input.inquiryId);
        if (!inquiry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inquiry not found",
          });
        }
        // Check if user owns this inquiry or is admin
        if (inquiry.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You don't have permission to add messages to this inquiry",
          });
        }
        const isAdmin = ctx.user.role === "admin";

        // When an ADMIN replies, the reply must be persisted AND emailed to
        // the customer AND the thread advanced to "replied" — the exact same
        // work the 指揮中心 審核箱 executor does on approve. That shared logic
        // lives in server/_core/inquiryReply.ts so both callers stay in lock-
        // step (never copy-pasted + drifting). Email is best-effort: a bounce
        // does NOT fail the mutation (the reply is already persisted by the
        // helper before the send).
        if (isAdmin) {
          const { sendAdminInquiryReply } = await import("../_core/inquiryReply");
          const res = await sendAdminInquiryReply({
            inquiryId: input.inquiryId,
            body: input.message,
            senderId: ctx.user.id,
          });
          return {
            id: res.messageId,
            inquiryId: input.inquiryId,
            senderId: ctx.user.id,
            senderType: "admin" as const,
            message: input.message,
            emailSent: res.emailSent,
          };
        }

        // Customer posting to their own thread: persist only, never email.
        const created = await db.createInquiryMessage({
          inquiryId: input.inquiryId,
          senderId: ctx.user.id,
          senderType: "customer",
          message: input.message,
        });
        // customer-cockpit 任務7b(2026-07-03)— 站內留言也要進客戶頁時間軸,
        // 不是只有 email 渠道才算往來。Fire-and-forget,絕不影響訊息已經
        // 成功送出這件事本身。
        void (async () => {
          try {
            const { ensureCustomerProfileForWebsiteContact, recordWebsiteInteraction } =
              await import("../_core/websiteIntake");
            const profileId = await ensureCustomerProfileForWebsiteContact({
              userId: ctx.user.id,
              email: inquiry.customerEmail,
              phone: inquiry.customerPhone ?? null,
              name: inquiry.customerName,
            });
            if (profileId) {
              await recordWebsiteInteraction({
                profileId,
                direction: "inbound",
                content: input.message,
                // 2026-07-03 監工確認修復(同 create procedure 那條)— 原本只放
                // 主旨,時間軸看不出客人這則留言實際說了什麼,補上本文前 120 字。
                contentSummary: `站內留言:${input.message.slice(0, 120)}`,
                agentName: "website_inquiry_message",
              });
            }
          } catch (err) {
            console.error("[inquiries.addMessage] website channel intake failed:", err);
            reportFunnelError({ source: "fail-open:inquiries:websiteChannelIntakeFailed:addMessage", err }).catch(() => {});
          }
        })();
        return { ...created, emailSent: false };
       }),
  });
