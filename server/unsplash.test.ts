/**
 * Vitest test to validate Unsplash API credentials
 */

import { describe, it, expect } from "vitest";

describe.skipIf(!process.env.UNSPLASH_ACCESS_KEY)("Unsplash API", () => {
  it("should validate Unsplash API credentials", async () => {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    
    expect(accessKey).toBeDefined();
    expect(accessKey).not.toBe("");
    
    // Test API by searching for a simple query
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=switzerland&per_page=1`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
        },
      }
    );
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty("results");
    expect(Array.isArray(data.results)).toBe(true);
    
    console.log("[Unsplash Test] API credentials validated successfully");
    console.log(`[Unsplash Test] Found ${data.total} images for query "switzerland"`);
  });
});
