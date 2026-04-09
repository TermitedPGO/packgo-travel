import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Mirrors the saveFromPreview tourData schema from routers.ts
 * Tests that .strip() correctly removes unknown fields and that
 * preview-only fields (featureImages, executionReport) are defined in schema.
 */
const tourDataSchema = z.object({
  title: z.string().min(1).max(255),
  destination: z.string().max(255).optional(),
  destinationCountry: z.string().max(255).optional(),
  destinationCity: z.string().max(255).optional(),
  description: z.string().max(50000).optional(),
  price: z.number().gt(0).optional(),
  duration: z.number().min(1).max(365).optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  category: z.enum(["group", "custom", "package", "cruise", "theme"]).optional(),
  status: z.enum(["active", "inactive", "soldout"]).optional(),
  poeticTitle: z.string().max(255).optional(),
  poeticSubtitle: z.string().max(500).optional(),
  poeticContent: z.string().max(5000).optional(),
  heroSubtitle: z.string().max(500).optional(),
  keyFeatures: z.string().max(10000).optional(),
  hotels: z.string().max(10000).optional(),
  meals: z.string().max(10000).optional(),
  flights: z.string().max(5000).optional(),
  costExplanation: z.string().max(10000).optional(),
  noticeDetailed: z.string().max(10000).optional(),
  itineraryDetailed: z.string().max(50000).optional(),
  colorTheme: z.string().max(1000).optional(),
  transportationType: z.string().max(100).optional(),
  transportationName: z.string().max(100).optional(),
  highlights: z.string().max(10000).optional(),
  includes: z.string().max(10000).optional(),
  excludes: z.string().max(10000).optional(),
  notes: z.string().max(10000).optional(),
  heroImage: z.string().max(500).optional(),
  // Preview-only fields (will be stripped before saving)
  featureImages: z.unknown().optional(),
  executionReport: z.unknown().optional(),
}).strip();

describe("saveFromPreview tourData schema (.strip())", () => {
  it("accepts a minimal valid payload with only title", () => {
    const result = tourDataSchema.safeParse({ title: "Test Tour" });
    expect(result.success).toBe(true);
  });

  it("accepts a full valid payload", () => {
    const result = tourDataSchema.safeParse({
      title: "花蓮鳴日號之旅",
      destination: "花蓮",
      destinationCountry: "台灣",
      price: 25000,
      duration: 3,
      category: "package",
      status: "active",
    });
    expect(result.success).toBe(true);
  });

  it("strips unknown fields not in schema", () => {
    const result = tourDataSchema.safeParse({
      title: "Test Tour",
      unknownField: "should be stripped",
      anotherExtra: 12345,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknownField).toBeUndefined();
      expect((result.data as any).anotherExtra).toBeUndefined();
    }
  });

  it("keeps featureImages and executionReport in parsed data (they are defined in schema)", () => {
    const result = tourDataSchema.safeParse({
      title: "Test Tour",
      featureImages: ["img1.jpg", "img2.jpg"],
      executionReport: { status: "done" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.featureImages).toEqual(["img1.jpg", "img2.jpg"]);
      expect(result.data.executionReport).toEqual({ status: "done" });
    }
  });

  it("rejects empty title", () => {
    const result = tourDataSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects price <= 0", () => {
    const result = tourDataSchema.safeParse({ title: "Test", price: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category enum value", () => {
    const result = tourDataSchema.safeParse({ title: "Test", category: "invalid_category" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status enum value", () => {
    const result = tourDataSchema.safeParse({ title: "Test", status: "pending" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for imageUrl (allows clearing the field)", () => {
    const result = tourDataSchema.safeParse({ title: "Test", imageUrl: "" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL for imageUrl", () => {
    const result = tourDataSchema.safeParse({ title: "Test", imageUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects duration out of range", () => {
    const result = tourDataSchema.safeParse({ title: "Test", duration: 0 });
    expect(result.success).toBe(false);
    const result2 = tourDataSchema.safeParse({ title: "Test", duration: 366 });
    expect(result2.success).toBe(false);
  });
});
