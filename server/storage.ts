// Storage helpers — Cloudflare R2 (S3-compatible) for Fly.io deployment.
//
// Replaces the legacy Manus Forge storage proxy. Public API unchanged:
//   storagePut(key, data, contentType) -> { key, url }
//   storageGet(key) -> { key, url }
//   storageImagePut(baseKey, buffer, options) -> OptimizedImageUrls
//
// URL strategy:
//   - If R2_PUBLIC_BASE_URL is set (e.g. a Cloudflare Custom Domain bound to the
//     bucket), uploads return <public-base>/<key> and reads return the same
//     direct URL — cacheable at the CDN.
//   - Otherwise we return a presigned GET URL (default 1 hour) for reads, and
//     on upload we also return a presigned URL so the caller always receives
//     something immediately usable without needing the bucket to be public.
//
// Requirements (server/_core/env.ts):
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET
//   R2_PUBLIC_BASE_URL (optional — enables direct, non-expiring URLs)

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { ENV } from "./_core/env";

// ──────────────────────────────────────────────────────────────────────────────
// Client (lazy-initialised so build/import doesn't fail if env is absent)
// ──────────────────────────────────────────────────────────────────────────────

let _client: S3Client | null = null;

function getR2Client(): { client: S3Client; bucket: string; publicBase: string } {
  if (!ENV.r2AccessKeyId || !ENV.r2SecretAccessKey || !ENV.r2Endpoint || !ENV.r2Bucket) {
    throw new Error(
      "R2 storage credentials missing. Required env vars: " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET."
    );
  }
  if (!_client) {
    _client = new S3Client({
      region: "auto", // R2 ignores region but SDK requires one
      endpoint: ENV.r2Endpoint,
      credentials: {
        accessKeyId: ENV.r2AccessKeyId,
        secretAccessKey: ENV.r2SecretAccessKey,
      },
      forcePathStyle: true, // safer for R2's endpoint format
    });
  }
  return {
    client: _client,
    bucket: ENV.r2Bucket,
    publicBase: ENV.r2PublicBaseUrl.replace(/\/+$/, ""),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Key + buffer helpers
// ──────────────────────────────────────────────────────────────────────────────

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function toNodeBuffer(data: Buffer | Uint8Array | string, contentType: string): Buffer {
  if (typeof data === "string") {
    // If caller passes JSON/text, encode as UTF-8. For binary, pass Buffer/Uint8Array.
    return Buffer.from(data, contentType.startsWith("text/") || contentType.includes("json") ? "utf8" : "binary");
  }
  if (Buffer.isBuffer(data)) return data;
  return Buffer.from(data);
}

async function buildReadUrl(key: string): Promise<string> {
  const { client, bucket, publicBase } = getR2Client();
  if (publicBase) {
    return `${publicBase}/${encodeURI(key)}`;
  }
  // v80.24: was 1-hour TTL but generationCache stores tour JSON (with these
  // URLs embedded) for 3 DAYS. After hour 1, every cache hit served broken
  // 403 images. Bumped to 7 days; a robust fix would require regenerating
  // URLs on cache read but that's a bigger refactor — production sites
  // that need long URL lifetime should set R2_PUBLIC_BASE_URL.
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  if (!publicBase && process.env.NODE_ENV === "production") {
    console.warn(
      "[storage] R2_PUBLIC_BASE_URL is unset in production; using 7-day presigned URLs. Set the public CDN URL for stable image references."
    );
  }
  return await getSignedUrl(client, cmd, { expiresIn: 7 * 24 * 60 * 60 });
}

/**
 * 2026-05-17 red-team round 3 — short-TTL presigned URL for sensitive
 * documents (passport scans, visa, medical records, insurance, etc.).
 *
 * Difference from storageGet:
 *   - Ignores R2_PUBLIC_BASE_URL — never returns a permanent public URL,
 *     even if the bucket has CDN. Sensitive docs MUST be ephemeral.
 *   - 5-minute TTL by default — long enough for one admin to load + view,
 *     short enough that screenshots / browser-history exposure has limited
 *     value.
 *   - Callers should regenerate the URL on every UI page-load, not cache.
 *
 * Use this for: customerDocuments.r2Url paths, any PII-laden file.
 * Don't use for tour images, marketing posters, public assets.
 */
export async function getSecureDocumentUrl(
  relKey: string,
  ttlSeconds: number = 300 // 5 minutes
): Promise<string> {
  const { client, bucket } = getR2Client();
  const key = normalizeKey(relKey);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return await getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const { client, bucket } = getR2Client();
  const key = normalizeKey(relKey);
  const body = toNodeBuffer(data, contentType);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const url = await buildReadUrl(key);
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const url = await buildReadUrl(key);
  return { key, url };
}

/**
 * Delete a single object from R2.
 * Round 72: added for masterAgent rollback — previously there was no way to
 * remove orphaned images from failed tour generations.
 *
 * Returns true if the delete succeeded, false otherwise (errors are swallowed
 * to prevent cascading failures during cleanup).
 */
export async function storageDelete(relKey: string): Promise<boolean> {
  try {
    const { client, bucket } = getR2Client();
    const key = normalizeKey(relKey);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    console.warn(`[storage] Failed to delete key "${relKey}":`, err);
    return false;
  }
}

/**
 * Delete multiple objects from R2 in a single call (up to 1000 keys per request).
 * Automatically chunks larger inputs.
 * Round 72: batched cleanup for masterAgent rollback.
 */
export async function storageDeleteMany(relKeys: string[]): Promise<{ deleted: number; failed: number }> {
  if (relKeys.length === 0) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;

  try {
    const { client, bucket } = getR2Client();
    const keys = relKeys.map(normalizeKey);

    // R2/S3 limit: 1000 keys per DeleteObjects call
    const CHUNK = 1000;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const batch = keys.slice(i, i + CHUNK);
      try {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: batch.map((Key) => ({ Key })),
              Quiet: true,
            },
          })
        );
        deleted += batch.length - (result.Errors?.length ?? 0);
        failed += result.Errors?.length ?? 0;
      } catch (err) {
        console.warn(`[storage] Batch delete failed for ${batch.length} keys:`, err);
        failed += batch.length;
      }
    }
  } catch (err) {
    console.warn(`[storage] storageDeleteMany setup failed:`, err);
    failed = relKeys.length;
  }

  return { deleted, failed };
}

/**
 * Extract R2 storage key from a full URL.
 * Works for both public-base URLs and presigned URLs.
 * Returns null if the URL doesn't look like it belongs to our R2 bucket.
 *
 * Round 72: used by rollback to turn stored image URLs back into keys for deletion.
 */
export function extractR2KeyFromUrl(url: string): string | null {
  if (!url || typeof url !== "string") return null;

  try {
    const parsed = new URL(url);
    const publicBase = ENV.r2PublicBaseUrl.replace(/\/+$/, "");

    // Case 1: public base URL (e.g. https://cdn.packgo.com/tours/123/hero.webp)
    if (publicBase && url.startsWith(publicBase + "/")) {
      return decodeURI(url.slice(publicBase.length + 1).split("?")[0]);
    }

    // Case 2: R2 endpoint URL with bucket in path (presigned or direct)
    // Format: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>?<signed params>
    const path = parsed.pathname.replace(/^\/+/, "");
    const bucketPrefix = ENV.r2Bucket + "/";
    if (path.startsWith(bucketPrefix)) {
      return decodeURI(path.slice(bucketPrefix.length));
    }

    // Case 3: virtual-hosted style (bucket as subdomain)
    if (parsed.hostname.startsWith(ENV.r2Bucket + ".") && path.length > 0) {
      return decodeURI(path);
    }

    return null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Optimised image upload (sharp multi-size pipeline unchanged)
// ──────────────────────────────────────────────────────────────────────────────

import {
  optimizeImage,
  generateStorageKeys,
  getMimeType,
  type ImageOptimizationOptions,
} from "./imageOptimizer";

export interface OptimizedImageUrls {
  thumbnail: string;
  medium: string;
  large: string;
  original?: string;
}

/**
 * Upload an image with automatic optimization and multiple sizes.
 * @param baseKey - Base storage key without extension (e.g. "tours/123/image1")
 * @param imageBuffer - Input image buffer
 * @param options - Optimization options
 * @returns URLs for all generated sizes
 */
export async function storageImagePut(
  baseKey: string,
  imageBuffer: Buffer,
  options: ImageOptimizationOptions = {}
): Promise<OptimizedImageUrls> {
  const format = options.format || "webp";
  const mimeType = getMimeType(format);

  const optimized = await optimizeImage(imageBuffer, options);
  const keys = generateStorageKeys(baseKey, format);

  const [thumbnailResult, mediumResult, largeResult, originalResult] = await Promise.all([
    storagePut(keys.thumbnail, optimized.thumbnail, mimeType),
    storagePut(keys.medium, optimized.medium, mimeType),
    storagePut(keys.large, optimized.large, mimeType),
    optimized.original
      ? storagePut(keys.original!, optimized.original, mimeType)
      : Promise.resolve(null),
  ]);

  const urls: OptimizedImageUrls = {
    thumbnail: thumbnailResult.url,
    medium: mediumResult.url,
    large: largeResult.url,
  };

  if (originalResult) {
    urls.original = originalResult.url;
  }

  return urls;
}
