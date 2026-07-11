/**
 * heroDedupe.test — 跨國同圖上架守門(Block B)純函式測。合成資料,不碰 DB。
 */

import { describe, it, expect } from "vitest";
import { dedupeHeroImagesAcrossCountries } from "./heroDedupe";
import type { PromotableTour } from "./promote";

const makeTour = (
  over: Partial<PromotableTour> & { fields?: Record<string, unknown> } = {},
): PromotableTour => ({
  tourId: 1,
  productCode: "P1",
  ...over,
  fields: {
    destinationCountry: "日本",
    heroImage: "https://images.unsplash.com/photo-x.jpg",
    imageUrl: "https://images.unsplash.com/photo-x.jpg",
    heroImageCredit: JSON.stringify({ name: "A", username: "a", profileUrl: "https://unsplash.com/@a" }),
    ...(over.fields ?? {}),
  },
});

describe("dedupeHeroImagesAcrossCountries", () => {
  it("different destinationCountry sharing the same hero url → the later one is nulled", () => {
    const first = makeTour({ tourId: 1, productCode: "P1", fields: { destinationCountry: "日本" } });
    const second = makeTour({ tourId: 2, productCode: "P2", fields: { destinationCountry: "杜拜" } });

    dedupeHeroImagesAcrossCountries([first, second]);

    expect(first.fields.heroImage).toBe("https://images.unsplash.com/photo-x.jpg");
    expect(second.fields.heroImage).toBeNull();
    expect(second.fields.imageUrl).toBeNull();
    expect(second.fields.heroImageCredit).toBeNull();
  });

  it("same destinationCountry sharing the same hero url → NOT forced null (left to resolver-level dedupe)", () => {
    const first = makeTour({ tourId: 1, productCode: "P1", fields: { destinationCountry: "日本" } });
    const second = makeTour({ tourId: 2, productCode: "P2", fields: { destinationCountry: "日本" } });

    dedupeHeroImagesAcrossCountries([first, second]);

    expect(first.fields.heroImage).toBe("https://images.unsplash.com/photo-x.jpg");
    expect(second.fields.heroImage).toBe("https://images.unsplash.com/photo-x.jpg");
  });

  it("different urls → untouched regardless of country", () => {
    const first = makeTour({
      tourId: 1,
      productCode: "P1",
      fields: { destinationCountry: "日本", heroImage: "https://images.unsplash.com/photo-a.jpg", imageUrl: "https://images.unsplash.com/photo-a.jpg" },
    });
    const second = makeTour({
      tourId: 2,
      productCode: "P2",
      fields: { destinationCountry: "杜拜", heroImage: "https://images.unsplash.com/photo-b.jpg", imageUrl: "https://images.unsplash.com/photo-b.jpg" },
    });

    dedupeHeroImagesAcrossCountries([first, second]);

    expect(first.fields.heroImage).toBe("https://images.unsplash.com/photo-a.jpg");
    expect(second.fields.heroImage).toBe("https://images.unsplash.com/photo-b.jpg");
  });

  it("tours with no heroImage this run (untouched fields) are skipped entirely", () => {
    const first = makeTour({ tourId: 1, productCode: "P1", fields: { destinationCountry: "日本" } });
    const noHero: PromotableTour = { tourId: 2, productCode: "P2", fields: { destinationCountry: "杜拜" } };

    expect(() => dedupeHeroImagesAcrossCountries([first, noHero])).not.toThrow();
    expect(first.fields.heroImage).toBe("https://images.unsplash.com/photo-x.jpg");
    expect(noHero.fields).not.toHaveProperty("heroImage");
  });

  it("missing destinationCountry on both sides is treated as its own shared category (not forced null against itself)", () => {
    const first = makeTour({ tourId: 1, productCode: "P1", fields: { destinationCountry: undefined } });
    const second = makeTour({ tourId: 2, productCode: "P2", fields: { destinationCountry: null } });

    dedupeHeroImagesAcrossCountries([first, second]);

    expect(first.fields.heroImage).toBe("https://images.unsplash.com/photo-x.jpg");
    expect(second.fields.heroImage).toBe("https://images.unsplash.com/photo-x.jpg");
  });
});
