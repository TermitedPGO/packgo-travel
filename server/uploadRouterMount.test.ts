/**
 * Regression test for the upload-router-intercepts-tRPC bug.
 *
 * What happened (2026-05-14 → 2026-05-22):
 *   - SECURITY_AUDIT_2026_05_14 P0 added `router.use(requireAuth|Admin)` to
 *     four upload routers (avatar, tour-image, general-image, pdf).
 *   - Those routers were mounted via `app.use("/api", router)` — broad mount.
 *   - Express runs router-level middleware on ANY request matching the mount
 *     prefix, even if no route inside the router matches. So every
 *     `/api/trpc/*` request hit requireAuth/Admin before reaching the tRPC
 *     handler at `app.use("/api/trpc", createExpressMiddleware(...))`.
 *   - Anonymous visitors → 401 "Login required". Non-admin users → 403.
 *   - Jeff hit this on 2026-05-22 after authenticating as
 *     support@packgoplay.com (non-admin workspace account).
 *
 * Fix: move auth from `router.use(...)` to per-route middleware. That way the
 * middleware only fires for the actual upload endpoint, and non-matching
 * paths fall through cleanly to subsequent app-level middleware (i.e. tRPC).
 *
 * This test asserts the bug shape (router-level use of requireAuth/Admin)
 * never returns. Express routers expose their middleware stack as
 * `router.stack`; we inspect it for unbound middleware that isn't tied to
 * a specific route.
 */

import { describe, it, expect } from "vitest";
import { avatarUploadRouter } from "./avatarUpload";
import { tourImageUploadRouter } from "./tourImageUpload";
import { generalImageUploadRouter } from "./generalImageUpload";
import { pdfUploadRouter } from "./pdfUpload";

/**
 * Express router internals: `.stack` is an array of "layers". Each layer has:
 *   - `route` (truthy) → tied to a specific path (.post/.get/etc)
 *   - `route` (undefined) → unbound middleware (.use)
 *
 * The bug shape is a layer with no `route` and a `handle` name matching
 * requireAuth / requireAdmin. Anything tied to `.route` is fine — that only
 * fires on its specific URL.
 */
function unboundMiddlewareNames(router: any): string[] {
  const stack = (router?.stack ?? []) as Array<{
    route?: unknown;
    handle?: { name?: string };
    name?: string;
  }>;
  return stack
    .filter((layer) => !layer.route)
    .map((layer) => layer.handle?.name ?? layer.name ?? "<anon>")
    .filter((n) => n !== "<anon>"); // anonymous helpers (multer etc.) are fine
}

describe("upload routers — no router-level auth middleware", () => {
  it("avatarUploadRouter has no router-level requireAuth/Admin", () => {
    const names = unboundMiddlewareNames(avatarUploadRouter);
    expect(names).not.toContain("requireAuth");
    expect(names).not.toContain("requireAdmin");
  });

  it("tourImageUploadRouter has no router-level requireAuth/Admin", () => {
    const names = unboundMiddlewareNames(tourImageUploadRouter);
    expect(names).not.toContain("requireAuth");
    expect(names).not.toContain("requireAdmin");
  });

  it("generalImageUploadRouter has no router-level requireAuth/Admin", () => {
    const names = unboundMiddlewareNames(generalImageUploadRouter);
    expect(names).not.toContain("requireAuth");
    expect(names).not.toContain("requireAdmin");
  });

  it("pdfUploadRouter has no router-level requireAuth/Admin", () => {
    const names = unboundMiddlewareNames(pdfUploadRouter);
    expect(names).not.toContain("requireAuth");
    expect(names).not.toContain("requireAdmin");
  });
});

describe("upload routers — per-route middleware applied", () => {
  /**
   * Per-route middleware is stored in `layer.route.stack`. We don't run the
   * routes — we just verify that the upload endpoints DO carry an auth layer
   * on their per-route stack, so we don't accidentally drop the security
   * check in the same fix.
   */
  function routeMiddlewareNames(router: any, path: string): string[] {
    const stack = (router?.stack ?? []) as Array<{
      route?: { path?: string; stack?: Array<{ handle?: { name?: string } }> };
    }>;
    const layer = stack.find((l) => l.route?.path === path);
    if (!layer?.route?.stack) return [];
    return layer.route.stack.map((s) => s.handle?.name ?? "");
  }

  it("avatarUploadRouter POST /upload-avatar still has requireAuth", () => {
    const mws = routeMiddlewareNames(avatarUploadRouter, "/upload-avatar");
    expect(mws).toContain("requireAuth");
  });

  it("tourImageUploadRouter POST /tours/:tourId/upload-image still has requireAdmin", () => {
    const mws = routeMiddlewareNames(
      tourImageUploadRouter,
      "/tours/:tourId/upload-image"
    );
    expect(mws).toContain("requireAdmin");
  });

  it("tourImageUploadRouter POST /tours/:tourId/upload-images still has requireAdmin", () => {
    const mws = routeMiddlewareNames(
      tourImageUploadRouter,
      "/tours/:tourId/upload-images"
    );
    expect(mws).toContain("requireAdmin");
  });

  it("tourImageUploadRouter GET /tours/image-sizes still has requireAdmin", () => {
    const mws = routeMiddlewareNames(
      tourImageUploadRouter,
      "/tours/image-sizes"
    );
    expect(mws).toContain("requireAdmin");
  });

  it("generalImageUploadRouter POST /upload/image still has requireAdmin", () => {
    const mws = routeMiddlewareNames(generalImageUploadRouter, "/upload/image");
    expect(mws).toContain("requireAdmin");
  });

  it("generalImageUploadRouter POST /upload/tour-image still has requireAdmin", () => {
    const mws = routeMiddlewareNames(
      generalImageUploadRouter,
      "/upload/tour-image"
    );
    expect(mws).toContain("requireAdmin");
  });

  it("pdfUploadRouter POST /pdf/upload still has requireAdmin", () => {
    const mws = routeMiddlewareNames(pdfUploadRouter, "/pdf/upload");
    expect(mws).toContain("requireAdmin");
  });

  it("pdfUploadRouter POST /pdf/upload-base64 still has requireAdmin", () => {
    const mws = routeMiddlewareNames(pdfUploadRouter, "/pdf/upload-base64");
    expect(mws).toContain("requireAdmin");
  });
});
