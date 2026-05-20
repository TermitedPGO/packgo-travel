import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { checkAdminMutationRateLimit } from "../rateLimit";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "trpc" });

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next, type } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    // QA audit 2026-05-11 Phase 6 P0: throttle admin mutations so a
    // compromised admin session can't be used for 1000s of destructive
    // ops/sec (delete tours, refund bookings, etc.). Queries stay
    // unthrottled — they're read-only and Jeff hits the dashboard often.
    if (type === "mutation") {
      const limit = await checkAdminMutationRateLimit(ctx.user.id);
      if (!limit.allowed) {
        log.warn(
          { userId: ctx.user.id },
          "[adminProcedure] mutation rate limit exceeded",
        );
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Admin 操作過於頻繁,請稍候再試",
        });
      }
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
