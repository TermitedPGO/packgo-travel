/**
 * Tests for the malformed-body JSON error middleware.
 *
 * Contract: body-parser-tagged errors answer JSON (right status, no stack);
 * every other error passes through next(err) untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { bodyParserErrorHandler } from "./bodyParserErrors";

function fakeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
  };
  return res;
}

const req = { path: "/api/trpc/commandCenter.retry" } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bodyParserErrorHandler", () => {
  it("answers 400 JSON for invalid JSON bodies (entity.parse.failed)", () => {
    const err = Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
      status: 400,
    });
    const res = fakeRes();
    const next = vi.fn();

    bodyParserErrorHandler(err, req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: { message: "Invalid request body", code: "BAD_REQUEST" },
    });
  });

  it("answers 413 PAYLOAD_TOO_LARGE for oversized bodies", () => {
    const err = Object.assign(new Error("too big"), {
      type: "entity.too.large",
      status: 413,
    });
    const res = fakeRes();
    const next = vi.fn();

    bodyParserErrorHandler(err, req, res, next);

    expect(res.statusCode).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(res.body.error.message).toBe("Request body too large");
  });

  it("never includes a stack in the response", () => {
    const err = Object.assign(new SyntaxError("boom"), {
      type: "entity.parse.failed",
      status: 400,
    });
    const res = fakeRes();

    bodyParserErrorHandler(err, req, res, vi.fn());

    expect(JSON.stringify(res.body)).not.toContain("stack");
    expect(JSON.stringify(res.body)).not.toContain("boom");
  });

  it("passes non-body-parser errors through to next(err)", () => {
    const err = new Error("some route exploded");
    const res = fakeRes();
    const next = vi.fn();

    bodyParserErrorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes errors with an unknown type tag through to next(err)", () => {
    const err = Object.assign(new Error("x"), { type: "something.else" });
    const res = fakeRes();
    const next = vi.fn();

    bodyParserErrorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("defaults to 400 when the error carries no status", () => {
    const err = Object.assign(new Error("aborted"), { type: "request.aborted" });
    const res = fakeRes();

    bodyParserErrorHandler(err, req, res, vi.fn());

    expect(res.statusCode).toBe(400);
  });
});
