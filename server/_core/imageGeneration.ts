/**
 * Image sourcing via Google Programmable Search (Custom Search JSON API).
 *
 * Replaces the legacy Manus Forge `ImageService/GenerateImage` (DALL-E) call.
 * Rationale: for a real-world travel agency we need *actual* photos of the
 * subject (e.g. a specific Taiwanese train "鳴日號"), not AI-imagined images
 * that may mislead customers and risk FTC "deceptive advertising" exposure.
 *
 * Strategy:
 *   1. Query Google CSE with `searchType=image&imgType=photo&safe=active`
 *   2. Try the top N results in order — download, validate, upload to R2
 *   3. Return the first successful R2 URL
 *   4. On total failure return `{ url: undefined }` so callers can fall back
 *
 * Caller contract is UNCHANGED — still `generateImage({prompt}) → {url}`.
 *
 * Env:
 *   GOOGLE_API_KEY  (required)
 *   GOOGLE_CSE_ID   (required — Programmable Search Engine ID, "cx")
 */

import { storagePut } from "server/storage";
import { ENV } from "./env";
import { redis } from "../redis";

export type GenerateImageOptions = {
  prompt: string;
  /** @deprecated Image editing is no longer supported (was Forge-only). Passed values are ignored. */
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
  /** Override the default 5 candidate results. */
  maxCandidates?: number;
};

export type GenerateImageResponse = {
  url?: string;
  /** The originating web page of the photo (for audit / attribution logging) */
  sourceUrl?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Google CSE search
// ──────────────────────────────────────────────────────────────────────────────

interface CseItem {
  link: string; // direct image URL
  mime?: string;
  image?: {
    contextLink?: string; // page the image was found on
    byteSize?: number;
    width?: number;
    height?: number;
    thumbnailLink?: string;
  };
}

async function searchCse(query: string, num: number): Promise<CseItem[]> {
  if (!ENV.googleApiKey || !ENV.googleCseId) {
    throw new Error(
      "Google CSE is not configured. Set GOOGLE_API_KEY and GOOGLE_CSE_ID."
    );
  }

  // 24-hour cache of query → result list (to stay under the 100-query/day free tier)
  const cacheKey = `cse:img:${Buffer.from(query).toString("base64")}:${num}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as CseItem[];
    }
  } catch {
    // Redis blip → just miss the cache
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", ENV.googleApiKey);
  url.searchParams.set("cx", ENV.googleCseId);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("imgType", "photo"); // exclude clipart / line art
  url.searchParams.set("safe", "active");
  url.searchParams.set("num", String(Math.min(Math.max(num, 1), 10))); // max 10 per query

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Google CSE search failed (${res.status} ${res.statusText}): ${body.substring(0, 200)}`
    );
  }

  const data = (await res.json()) as { items?: CseItem[] };
  const items = data.items ?? [];

  try {
    await redis.setex(cacheKey, 24 * 60 * 60, JSON.stringify(items));
  } catch {
    // non-fatal
  }

  return items;
}

// ──────────────────────────────────────────────────────────────────────────────
// Image download + validation
// ──────────────────────────────────────────────────────────────────────────────

const MIN_IMAGE_BYTES = 5 * 1024; // filter out tiny tracking pixels / 1x1 gifs

async function downloadImage(
  imageUrl: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        // Some CDNs block obvious bots; send a browser-ish UA
        "user-agent":
          "Mozilla/5.0 (compatible; PackGoImageFetcher/1.0; +https://packgo-travel.fly.dev)",
        accept: "image/*",
      },
      redirect: "follow",
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.startsWith("image/")) return null;

    const arr = await res.arrayBuffer();
    if (arr.byteLength < MIN_IMAGE_BYTES) return null;

    return { buffer: Buffer.from(arr), contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extensionFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  return "jpg";
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API (unchanged signature)
// ──────────────────────────────────────────────────────────────────────────────

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  if (options.originalImages && options.originalImages.length > 0) {
    console.warn(
      "[generateImage] originalImages is no longer supported after Forge removal; " +
        "falling back to prompt-only search."
    );
  }

  const query = (options.prompt ?? "").trim();
  if (!query) return { url: undefined };

  const candidates = options.maxCandidates ?? 5;
  let items: CseItem[];
  try {
    items = await searchCse(query, candidates);
  } catch (err) {
    console.error("[generateImage] CSE search error:", err);
    return { url: undefined };
  }

  if (items.length === 0) {
    console.warn(`[generateImage] no CSE results for query: ${query.substring(0, 80)}`);
    return { url: undefined };
  }

  for (const item of items) {
    const download = await downloadImage(item.link);
    if (!download) continue;

    const ext = extensionFromContentType(download.contentType);
    const key = `search-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    try {
      const { url } = await storagePut(key, download.buffer, download.contentType);
      console.log(
        `[generateImage] ✅ "${query.substring(0, 60)}" → ${url.substring(0, 60)}... (src: ${item.image?.contextLink ?? "unknown"})`
      );
      return { url, sourceUrl: item.image?.contextLink };
    } catch (err) {
      console.error("[generateImage] R2 upload error:", err);
      // try next candidate
    }
  }

  console.warn(
    `[generateImage] all ${items.length} candidates failed to download for query: ${query.substring(0, 80)}`
  );
  return { url: undefined };
}
