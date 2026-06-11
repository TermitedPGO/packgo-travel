/**
 * bodyParserErrors — JSON error responses for malformed request bodies.
 *
 * Without this, a non-JSON body on any /api route surfaces as Express's
 * default HTML error page (with a stack trace in development) because the
 * SyntaxError thrown by express.json() falls through to the default
 * handler. APIs should answer JSON with the right status and never leak
 * a stack.
 *
 * Surgical scope: only errors tagged by body-parser (`err.type`) are
 * handled here; everything else passes through `next(err)` so existing
 * error behavior is untouched.
 */

import type { NextFunction, Request, Response } from "express";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "bodyParserErrors" });

/** The failure tags body-parser puts on the errors it raises. */
const BODY_PARSER_ERROR_TYPES = new Set([
  "entity.parse.failed",
  "entity.too.large",
  "entity.verify.failed",
  "request.aborted",
  "request.size.invalid",
  "stream.encoding.set",
  "stream.not.readable",
  "parameters.too.many",
  "charset.unsupported",
  "encoding.unsupported",
]);

export function bodyParserErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const type = err?.type;
  if (typeof type !== "string" || !BODY_PARSER_ERROR_TYPES.has(type)) {
    next(err);
    return;
  }

  const status = Number(err.status ?? err.statusCode) || 400;
  log.warn(
    { type, status, path: req.path },
    "[bodyParserErrors] rejected malformed request body",
  );
  res.status(status).json({
    error: {
      message:
        type === "entity.too.large"
          ? "Request body too large"
          : "Invalid request body",
      code: status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
    },
  });
}
