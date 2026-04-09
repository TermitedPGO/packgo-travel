/**
 * Google Places Service
 * Searches for place photos using Google Places API (New).
 *
 * Priority: imageLibrary > PDF > Google Places > Unsplash
 * Cost estimate: ~$0.032/Text Search + ~$0.007/photo → ~$0.28/tour
 */

// API key is read per-call to support test environment variable overrides
const PLACES_BASE = "https://places.googleapis.com/v1";

export interface PlacePhoto {
  url: string;           // Full image URL (after redirect)
  attribution: string;   // Required Google attribution
  widthPx: number;
  heightPx: number;
}

// ── In-memory cache (24-hour TTL) ────────────────────────────────────────────
interface CacheEntry {
  photos: PlacePhoto[];
  expiresAt: number;
}
const photoCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCached(key: string): PlacePhoto[] | null {
  const entry = photoCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    photoCache.delete(key);
    return null;
  }
  return entry.photos;
}

function setCache(key: string, photos: PlacePhoto[]): void {
  photoCache.set(key, { photos, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Exported for testing ──────────────────────────────────────────────────────
export function clearPhotoCache(): void {
  photoCache.clear();
}

// ── Core implementation ───────────────────────────────────────────────────────

/**
 * Resolve the actual image URL from a Google Places photo reference.
 * The endpoint returns a 302 redirect; we follow it to get the real URL.
 */
async function resolvePhotoUrl(photoName: string, apiKey: string): Promise<string> {
  const mediaUrl = `${PLACES_BASE}/${photoName}/media?maxWidthPx=1200&skipHttpRedirect=true&key=${apiKey}`;
  const res = await fetch(mediaUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Photo media request failed: ${res.status}`);
  }
  // The API returns JSON with a photoUri when skipHttpRedirect=true
  const data = await res.json() as { photoUri?: string };
  if (data.photoUri) return data.photoUri;

  // Fallback: follow redirect manually
  const redirectUrl = `${PLACES_BASE}/${photoName}/media?maxWidthPx=1200&key=${apiKey}`;
  const redirectRes = await fetch(redirectUrl, { redirect: "follow" });
  return redirectRes.url;
}

/**
 * Search Google Places for photos of a given place name.
 *
 * @param placeName  Attraction or hotel name (e.g. "太魯閣國家公園")
 * @param maxPhotos  Max photos to return (default 3, to control cost)
 * @returns PlacePhoto[] or empty array on failure / missing API key
 */
export async function searchPlacePhotos(
  placeName: string,
  maxPhotos: number = 3
): Promise<PlacePhoto[]> {
  const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!GOOGLE_PLACES_API_KEY) {
    console.warn("[GooglePlaces] GOOGLE_PLACES_API_KEY not set – skipping");
    return [];
  }

  const cacheKey = `${placeName}:${maxPhotos}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[GooglePlaces] Cache hit for "${placeName}"`);
    return cached;
  }

  try {
    // Step 1: Text Search to find place_id and photos
    const searchRes = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
      },
      body: JSON.stringify({
        textQuery: placeName,
        maxResultCount: 1,
      }),
    });

    if (!searchRes.ok) {
      console.warn(`[GooglePlaces] Text Search failed (${searchRes.status}) for "${placeName}"`);
      return [];
    }

    const searchData = await searchRes.json() as {
      places?: Array<{
        id: string;
        displayName?: { text: string };
        photos?: Array<{
          name: string;
          widthPx: number;
          heightPx: number;
          authorAttributions?: Array<{ displayName: string }>;
        }>;
      }>;
    };

    const place = searchData.places?.[0];
    if (!place || !place.photos || place.photos.length === 0) {
      console.log(`[GooglePlaces] No photos found for "${placeName}"`);
      setCache(cacheKey, []);
      return [];
    }

    // Step 2: Resolve photo URLs (up to maxPhotos)
    const photosToFetch = place.photos.slice(0, maxPhotos);
    const results: PlacePhoto[] = [];

    for (const photo of photosToFetch) {
      try {
        const url = await resolvePhotoUrl(photo.name, GOOGLE_PLACES_API_KEY);
        const attribution =
          photo.authorAttributions?.[0]?.displayName ?? "Google Places";
        results.push({
          url,
          attribution,
          widthPx: photo.widthPx,
          heightPx: photo.heightPx,
        });
      } catch (photoErr) {
        console.warn(`[GooglePlaces] Failed to resolve photo URL for "${placeName}":`, photoErr);
      }
    }

    console.log(`[GooglePlaces] Found ${results.length} photo(s) for "${placeName}"`);
    setCache(cacheKey, results);
    return results;
  } catch (err) {
    console.warn(`[GooglePlaces] searchPlacePhotos error for "${placeName}":`, err);
    return [];
  }
}
