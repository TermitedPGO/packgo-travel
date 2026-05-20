/**
 * Correlation ID middleware + AsyncLocalStorage helper.
 *
 * Wave 1 Module 1.2 (2026-05-19) — every HTTP request gets a short, opaque
 * ID (8 chars from nanoid) that:
 *   1. Is mirrored back in the `x-request-id` response header so Jeff can
 *      take a customer report ("error at 14:23") + the request ID and grep
 *      it end-to-end through Fly logs.
 *   2. Is stored in AsyncLocalStorage so any code inside the request — tRPC
 *      handlers, db calls, BullMQ enqueues — can grab it via
 *      `getCorrelationId()` without prop-drilling through ctx.
 *   3. Is also written into the Sentry scope (`scope.setTag("correlationId",
 *      id)`) so when an error lands in Sentry, the tag links back to the
 *      original HTTP request for log correlation.
 *
 * Honors incoming `x-request-id` headers (preserves IDs from upstream proxies
 * / Cloudflare / load balancers).
 *
 * NOT a request log — that's pino-http, registered separately in index.ts.
 * This module ONLY tracks the ID.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { nanoid } from "nanoid";
import type { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";

type CorrelationStore = {
  correlationId: string;
};

const storage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Get the current request's correlation ID. Returns `undefined` outside an
 * HTTP request context (e.g. cron / startup code) — callers should fall back
 * to a fresh nanoid or an explicit "system" tag in that case.
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Express middleware that reads (or generates) a correlation ID, mirrors it
 * in the response header, tags Sentry, and runs the rest of the request
 * inside an AsyncLocalStorage context so `getCorrelationId()` works from
 * anywhere downstream.
 *
 * Register BEFORE any business middleware so the ID is available to all
 * downstream code.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers["x-request-id"];
  const incomingStr = Array.isArray(incoming) ? incoming[0] : incoming;
  const correlationId =
    typeof incomingStr === "string" && incomingStr.trim().length > 0
      ? incomingStr.trim().slice(0, 64) // cap at 64 chars to defend against header abuse
      : nanoid(8);

  // Mirror in response so the client / curl session sees it
  res.setHeader("x-request-id", correlationId);

  // Tag Sentry — every event captured during this request will carry this
  // tag, so Sentry → logs is a single grep.
  try {
    Sentry.getCurrentScope().setTag("correlationId", correlationId);
  } catch {
    // Sentry not initialized (e.g. dev without DSN) — silent no-op.
  }

  // Wrap the rest of the middleware chain in the ALS context.
  storage.run({ correlationId }, () => {
    next();
  });
}

/**
 * Test helper — synchronously run a function inside a correlation ID context.
 * Production callers should rely on `correlationIdMiddleware` instead.
 */
export function runWithCorrelationId<T>(
  correlationId: string,
  fn: () => T,
): T {
  return storage.run({ correlationId }, fn);
}
