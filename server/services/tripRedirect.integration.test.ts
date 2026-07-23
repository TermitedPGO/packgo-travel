/**
 * Full Express-middleware-order tests for /go/trip/:source (Codex P1-2).
 *
 * The unit tests call the handler directly and so can never catch middleware-order
 * bugs — the previous round's access-log PII and body-parser 400 both lived there.
 * These tests run a REAL express app over a REAL HTTP listener, mounted in the same
 * order production uses (mountTripRedirect BEFORE access logger and body parsers),
 * and a source-contract case pins that order in _core/index.ts itself.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

const createAffiliateClick = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({ createAffiliateClick }));
const checkAtomicRateLimit = vi.hoisted(() => vi.fn());
vi.mock("../rateLimit", () => ({ checkAtomicRateLimit }));

import { mountTripRedirect } from "./tripRedirect";
import { APPROVED_HOMEPAGE_ENTRY } from "./affiliateLinkService";

/** Everything a later access logger would see. Empty for /go/trip = nothing logged. */
const accessLogLines: string[] = [];

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  // PRODUCTION ORDER (see _core/index.ts): redirect route first…
  mountTripRedirect(app);
  // …then the access logger (stand-in for pino-http: captures url + query the same
  // way pino serializes req), then the body parsers.
  app.use((req, _res, next) => {
    accessLogLines.push(JSON.stringify({ url: req.url, query: req.query }));
    next();
  });
  app.use(express.json());
  // Control route BEHIND logger+parser, proving they are alive for everything else.
  app.get("/control", (_req, res) => { res.status(200).send("ok"); });

  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  accessLogLines.length = 0;
  createAffiliateClick.mockReset().mockResolvedValue(undefined);
  checkAtomicRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 59, resetAt: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** GET with an arbitrary raw body — fetch() forbids GET bodies, node:http does not. */
function rawGet(urlPath: string, body?: string): Promise<{ status: number; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${urlPath}`,
      { method: "GET", headers: body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {} },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("/go/trip through the real middleware chain", () => {
  it("PII planted in the query string never reaches the access logger (Codex P1-2)", async () => {
    const { status, location } = await rawGet(
      "/go/trip/flight_search?referrer=amy.lee%40example.com&phone=6265550134&target=https%3A%2F%2Fevil.test",
    );
    expect(status).toBe(302);
    expect(location).toBe(APPROVED_HOMEPAGE_ENTRY);
    // The route ends the request before the logger middleware ever runs:
    expect(accessLogLines).toHaveLength(0);
  });

  it("a malformed JSON GET body cannot 400 before the handler (Codex P1-2)", async () => {
    const { status, location } = await rawGet("/go/trip/hotel_search", "{not json!!");
    expect(status).toBe(302);
    expect(location).toBe(APPROVED_HOMEPAGE_ENTRY);
    expect(accessLogLines).toHaveLength(0);
  });

  it.each(["flight_search", "hotel_search", "tour_flight", "tour_hotel"])(
    "%s → 302 to the exact approved entry over real HTTP",
    async (source) => {
      const { status, location } = await rawGet(`/go/trip/${source}`);
      expect(status).toBe(302);
      expect(location).toBe(APPROVED_HOMEPAGE_ENTRY);
    },
  );

  it("unknown source → 400 over real HTTP, and still nothing in the access log", async () => {
    const { status, location } = await rawGet("/go/trip/paypal_me?email=jeff%40example.com");
    expect(status).toBe(400);
    expect(location).toBeUndefined();
    expect(accessLogLines).toHaveLength(0);
  });

  it("control: the logger and body parser ARE alive for every other route", async () => {
    const { status } = await rawGet("/control?q=1");
    expect(status).toBe(200);
    expect(accessLogLines).toHaveLength(1);
    expect(accessLogLines[0]).toContain("/control");
  });
});

describe("production mounting order (source contract on _core/index.ts)", () => {
  it("mounts the redirect route before pino-http and before the body parsers", () => {
    const src = readFileSync(path.resolve(__dirname, "../_core/index.ts"), "utf-8");
    const mountAt = src.indexOf("mountTripRedirect(app)");
    const pinoAt = src.indexOf("pinoHttp(");
    const jsonAt = src.indexOf("express.json(");
    expect(mountAt).toBeGreaterThan(-1);
    expect(pinoAt).toBeGreaterThan(-1);
    expect(jsonAt).toBeGreaterThan(-1);
    expect(mountAt).toBeLessThan(pinoAt);
    expect(mountAt).toBeLessThan(jsonAt);
  });

  it("no second /go/trip mount exists anywhere in the server entry", () => {
    const src = readFileSync(path.resolve(__dirname, "../_core/index.ts"), "utf-8");
    // The route is registered exactly once, via the shared mount function; no
    // literal app.get duplicate that could be mounted at a different position.
    expect(src.match(/app\.get\(["']\/go\/trip/g) ?? []).toHaveLength(0);
    expect(src.match(/mountTripRedirect\(app\)/g)).toHaveLength(1);
  });
});
