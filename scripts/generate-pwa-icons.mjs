#!/usr/bin/env node
/**
 * v2 Wave 4 Module 4.1 — PWA icon set generator.
 *
 * Reads `client/public/images/logo-black-bag.webp` (the canonical
 * PACK&GO brand mark — 1452×1766) and outputs 5 PWA icon assets:
 *
 *   client/public/images/pwa/icon-192.png            (Android home screen)
 *   client/public/images/pwa/icon-512.png            (Android splash + share)
 *   client/public/images/pwa/icon-512-maskable.png   (Android adaptive icon w/ 10% safe-zone)
 *   client/public/images/pwa/apple-touch-icon-180.png (iOS home screen)
 *   client/public/images/pwa/apple-touch-icon-1024.png (App Store / iOS sharing fallback)
 *
 * Design decisions:
 *   - Source is the FULL logo (bag + plane + "PACK&GO 旅行社 TRAVEL AGENCY")
 *     cropped to bag-only since text becomes unreadable at 192×192.
 *     We crop to the top 1100/1766 = top ~62% of the source.
 *   - White background (NOT transparent — iOS rejects transparent icons).
 *   - Padded to square: bag is 4:5 portrait, we pad sides with white.
 *   - Maskable variant gets an extra 10% safe-zone padding so Android's
 *     adaptive-icon mask (which can crop up to 25% of each edge) doesn't
 *     clip the brand mark.
 *   - We do NOT pre-round the corners — iOS + Android apply OS-native
 *     masking. Per CLAUDE.md §2.1.
 *
 * Run:
 *   node scripts/generate-pwa-icons.mjs
 *
 * Idempotent — safe to re-run.
 */

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath handles non-ASCII (e.g. Chinese) path components — plain
// `new URL(".", import.meta.url).pathname` returns the URL-encoded form
// which sharp/fs then fail to open.
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const SOURCE = path.join(
  REPO_ROOT,
  "client/public/images/logo-black-bag.webp",
);
const OUT_DIR = path.join(REPO_ROOT, "client/public/images/pwa");

// The source is the full logo (bag + text). We crop to just the bag for
// the app icons (text would be unreadable at 192×192). Empirically the
// bag occupies the top ~1100 of 1766 pixels; the remaining 666 are text.
// Crop with a small bottom margin for breathing room.
async function loadBagCropped() {
  const meta = await sharp(SOURCE).metadata();
  const w = meta.width ?? 1452;
  const h = meta.height ?? 1766;
  // Top 62% of the source = just the bag.
  const cropHeight = Math.round(h * 0.62);
  return sharp(SOURCE)
    .extract({ left: 0, top: 0, width: w, height: cropHeight })
    .toBuffer();
}

/**
 * Place the brand mark on a square white canvas at the requested size.
 * If `safeZonePct` is > 0, the brand mark gets extra padding so the
 * Android adaptive-icon mask doesn't clip it.
 */
async function renderSquareIcon(
  bagBuffer,
  size,
  outputPath,
  { safeZonePct = 0 } = {},
) {
  // Inner content fills (1 - 2*safeZonePct) of the canvas.
  const innerSize = Math.round(size * (1 - 2 * safeZonePct));

  // Resize the bag to fit innerSize (preserving aspect), then composite
  // onto a white square canvas at size×size.
  const bagResized = await sharp(bagBuffer)
    .resize(innerSize, innerSize, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  const whiteCanvas = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  await sharp(whiteCanvas)
    .composite([
      {
        input: bagResized,
        gravity: "center",
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  const stat = await sharp(outputPath).metadata();
  console.log(
    `  ✓ ${path.basename(outputPath)} (${stat.width}×${stat.height})`,
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[pwa-icons] source: ${SOURCE}`);
  const bag = await loadBagCropped();

  console.log(`[pwa-icons] generating 5 icons into ${OUT_DIR}/`);

  // Standard PWA icons (no safe-zone padding — OS applies any masking)
  await renderSquareIcon(bag, 192, path.join(OUT_DIR, "icon-192.png"));
  await renderSquareIcon(bag, 512, path.join(OUT_DIR, "icon-512.png"));

  // Maskable variant — 10% safe-zone padding so Android's adaptive-icon
  // mask (up to 25% crop per edge) doesn't clip the brand mark.
  await renderSquareIcon(bag, 512, path.join(OUT_DIR, "icon-512-maskable.png"), {
    safeZonePct: 0.1,
  });

  // iOS apple-touch-icon (iOS applies its own rounded-corner mask)
  await renderSquareIcon(
    bag,
    180,
    path.join(OUT_DIR, "apple-touch-icon-180.png"),
  );
  await renderSquareIcon(
    bag,
    1024,
    path.join(OUT_DIR, "apple-touch-icon-1024.png"),
  );

  console.log("[pwa-icons] done");
}

main().catch((err) => {
  console.error("[pwa-icons] FAILED:", err.message);
  process.exit(1);
});
