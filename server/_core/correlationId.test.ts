/**
 * Tests for correlationId middleware + AsyncLocalStorage roundtrip.
 *
 * Module 1.2 of v2 Wave 1.
 */

import { describe, expect, it, vi } from "vitest";
import {
  correlationIdMiddleware,
  getCorrelationId,
  runWithCorrelationId,
} from "./correlationId";

type FakeReq = {
  headers: Record<string, string | string[] | undefined>;
};

function makeRes() {
  const headers: Record<string, string | number | readonly string[]> = {};
  return {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = value;
    },
    get header() {
      return headers;
    },
  };
}

describe("correlationIdMiddleware", () => {
  it("preserves an existing x-request-id header", () => {
    const req: FakeReq = { headers: { "x-request-id": "client-supplied-id" } };
    const res = makeRes();
    let captured: string | undefined;
    const next = vi.fn(() => {
      captured = getCorrelationId();
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    correlationIdMiddleware(req as any, res as any, next);

    expect(captured).toBe("client-supplied-id");
    expect(res.header["x-request-id"]).toBe("client-supplied-id");
    expect(next).toHaveBeenCalledOnce();
  });

  it("generates a fresh id when header absent", () => {
    const req: FakeReq = { headers: {} };
    const res = makeRes();
    let captured: string | undefined;
    const next = vi.fn(() => {
      captured = getCorrelationId();
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    correlationIdMiddleware(req as any, res as any, next);

    expect(captured).toBeTypeOf("string");
    expect(captured!.length).toBe(8); // nanoid(8)
    expect(res.header["x-request-id"]).toBe(captured);
  });

  it("AsyncLocalStorage roundtrip — getCorrelationId returns the bound value", () => {
    let observed: string | undefined;
    runWithCorrelationId("test-roundtrip-123", () => {
      observed = getCorrelationId();
    });
    expect(observed).toBe("test-roundtrip-123");

    // Outside the run, no context — returns undefined.
    expect(getCorrelationId()).toBeUndefined();
  });
});
