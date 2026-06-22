/**
 * M0 — proves the ask-ops-stream SSE fix (design §一, customer-ai-sessions).
 *
 * Root cause of "對話框打字 15 秒沒回": the global compression() middleware was
 * Brotli-compressing the text/event-stream response, buffering tokens until the
 * stream ended. The fix sets `Cache-Control: no-cache, no-transform` on that one
 * response, which the compression middleware honors (skips compression entirely).
 *
 * This runs the REAL compression@1.8.1 middleware over a tiny express app with
 * two SSE routes — one with our no-transform header, one without — and asserts:
 *   1. the fixed route's response carries NO content-encoding (not compressed)
 *   2. the control route's response IS compressed (proves the test actually
 *      bites — without no-transform, SSE really does get compressed)
 *
 * Uses node:http as the client (NOT fetch) because http.get does not auto-
 * decompress, so the content-encoding header is preserved for assertion.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import compression from "compression";
import http from "node:http";
import type { AddressInfo } from "node:net";

const SSE_BODY =
  "data: " + JSON.stringify({ type: "token", text: "哈囉，這是一個 token" }) + "\n\n";

function startServer(): Promise<http.Server> {
  const app = express();
  // threshold 0 → even this tiny body qualifies for compression, so the control
  // route definitively compresses (makes the no-transform assertion meaningful).
  app.use(compression({ threshold: 0 }));

  // The fix: no-transform → compression skips this response.
  app.get("/sse-fixed", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.flushHeaders();
    res.write(SSE_BODY);
    res.end();
  });

  // Control (the old bug): no no-transform → compression compresses the stream.
  app.get("/sse-broken", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    res.write(SSE_BODY);
    res.end();
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function getContentEncoding(
  port: number,
  path: string,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { port, path, headers: { "Accept-Encoding": "br, gzip, deflate" } },
      (res) => {
        res.resume(); // drain the body so the socket closes
        resolve(res.headers["content-encoding"]);
      },
    );
    req.on("error", reject);
  });
}

describe("ask-ops-stream SSE compression (M0)", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = await startServer();
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server?.close();
  });

  it("does NOT compress the SSE response when Cache-Control has no-transform", async () => {
    const enc = await getContentEncoding(port, "/sse-fixed");
    expect(enc).toBeUndefined();
  });

  it("control: WOULD compress an SSE response without no-transform (test bites)", async () => {
    const enc = await getContentEncoding(port, "/sse-broken");
    expect(enc).toBeDefined();
    expect(["br", "gzip", "deflate"]).toContain(enc);
  });
});
