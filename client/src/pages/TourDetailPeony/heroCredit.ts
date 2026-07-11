/**
 * TourDetailPeony / heroCredit — stock-photo attribution helpers (pure).
 *
 * tours.heroImageCredit holds a JSON string {name, username, profileUrl}
 * written by the catalog-rebuild pipeline when the hero is an Unsplash stock
 * photo (see server/services/catalogRebuild/stockPhotoResolver.ts). The
 * Unsplash API terms require a visible "Photo by {name} on Unsplash" credit
 * with links back, and the links must carry utm_source/utm_medium params per
 * the official attribution guideline.
 *
 * Pure module (no React) so the parse + no-credit-no-render logic is unit
 * testable in the node vitest environment.
 */

export interface HeroImageCredit {
  name: string;
  username: string;
  profileUrl: string;
}

/**
 * Parse tours.heroImageCredit. Returns null on: null/empty, bad JSON, or a
 * shape missing name/profileUrl — the UI renders the attribution line ONLY
 * when this returns non-null (no credit → no line, never a broken one).
 */
export function parseHeroImageCredit(raw: unknown): HeroImageCredit | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const v = JSON.parse(raw) as Partial<HeroImageCredit> | null;
    if (
      v &&
      typeof v.name === "string" &&
      v.name.trim().length > 0 &&
      typeof v.profileUrl === "string" &&
      v.profileUrl.startsWith("http")
    ) {
      return {
        name: v.name,
        username: typeof v.username === "string" ? v.username : "",
        profileUrl: v.profileUrl,
      };
    }
  } catch {
    /* malformed JSON → no attribution line */
  }
  return null;
}

/** Append the Unsplash-required referral params (official attribution guideline). */
export function withUnsplashUtm(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=packgo_travel&utm_medium=referral`;
}

/** Unsplash home link for the "on Unsplash" half of the credit line. */
export const UNSPLASH_HOME_URL = withUnsplashUtm("https://unsplash.com/");
