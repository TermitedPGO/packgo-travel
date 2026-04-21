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
  // Presigned GET, 1-hour TTL
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return await getSignedUrl(client, cmd, { expiresIn: 3600 });
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
