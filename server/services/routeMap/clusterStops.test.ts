/**
 * clusterStops — outlier detection for tour route maps.
 *
 * 2026-05-22 fix: two-tier algorithm (median+3000km → nearest-neighbour
 * isolation) so trans-continent departure/return airports get pulled
 * out of the rendered map regardless of distance from cluster median.
 */
import { describe, expect, it } from "vitest";
import { clusterStops } from "./renderer";

type Stop = { day: number; name: string; lat: number; lng: number };

describe("clusterStops — outlier detection", () => {
  it("returns all stops as primary when tour is short (<=4 stops)", () => {
    const stops: Stop[] = [
      { day: 1, name: "東京", lat: 35.67, lng: 139.65 },
      { day: 2, name: "京都", lat: 35.01, lng: 135.77 },
      { day: 3, name: "大阪", lat: 34.69, lng: 135.5 },
    ];
    expect(clusterStops(stops)).toEqual({ primary: stops, outliers: [] });
  });

  it("flags trans-continent departure airport (Tier 1: >3000km from median)", () => {
    // 5 Europe stops + Taipei departure
    const stops: Stop[] = [
      { day: 1, name: "台北", lat: 25.05, lng: 121.5 },
      { day: 2, name: "蘇黎世", lat: 47.37, lng: 8.55 },
      { day: 3, name: "盧森", lat: 47.05, lng: 8.31 },
      { day: 4, name: "因特拉肯", lat: 46.69, lng: 7.86 },
      { day: 5, name: "伯恩", lat: 46.95, lng: 7.45 },
      { day: 6, name: "日內瓦", lat: 46.2, lng: 6.15 },
    ];
    const { primary, outliers } = clusterStops(stops);
    expect(outliers.map((s) => s.name)).toEqual(["台北"]);
    expect(primary.length).toBe(5);
  });

  it("flags regional-haul outlier (Tier 2: within 3000km but isolated from cluster)", () => {
    // 8 Japan stops (cluster span ~300km) + 高雄 (1,800km away — within
    // 3000km of median but >>cluster's own NN distance, so it should be
    // flagged as outlier by the new Tier-2 nearest-neighbour test).
    const stops: Stop[] = [
      { day: 1, name: "大阪", lat: 34.69, lng: 135.5 },
      { day: 2, name: "近江八幡", lat: 35.13, lng: 136.1 },
      { day: 3, name: "金澤", lat: 36.58, lng: 136.65 },
      { day: 4, name: "立山黑部", lat: 36.57, lng: 137.62 },
      { day: 5, name: "高山", lat: 36.14, lng: 137.25 },
      { day: 6, name: "名古屋", lat: 35.18, lng: 136.91 },
      { day: 7, name: "鳥羽", lat: 34.48, lng: 136.84 },
      { day: 8, name: "那智勝浦", lat: 33.62, lng: 135.93 },
      { day: 10, name: "高雄", lat: 22.63, lng: 120.3 },
    ];
    const { primary, outliers } = clusterStops(stops);
    expect(outliers.map((s) => s.name)).toEqual(["高雄"]);
    expect(primary.length).toBe(8);
  });

  it("preserves tight intra-city clusters (no false-positive outliers)", () => {
    // Tokyo-only tour: 6 stops within a 30km radius. NN distances all
    // small, no isolation. Tier 2's 500km floor prevents any from being
    // flagged.
    const stops: Stop[] = [
      { day: 1, name: "東京站", lat: 35.68, lng: 139.77 },
      { day: 2, name: "淺草", lat: 35.71, lng: 139.8 },
      { day: 3, name: "新宿", lat: 35.69, lng: 139.7 },
      { day: 4, name: "澀谷", lat: 35.66, lng: 139.7 },
      { day: 5, name: "原宿", lat: 35.67, lng: 139.7 },
      { day: 6, name: "上野", lat: 35.71, lng: 139.78 },
    ];
    const { primary, outliers } = clusterStops(stops);
    expect(outliers.length).toBe(0);
    expect(primary.length).toBe(6);
  });

  it("does not evict if removing isolated stops would leave <3 primary", () => {
    // Pathological case: tour with 5 stops where 3 are isolated. We
    // shouldn't strip to a 2-stop primary cluster. Algorithm keeps all
    // as primary in that case.
    const stops: Stop[] = [
      { day: 1, name: "A", lat: 25, lng: 121 },     // Taiwan
      { day: 2, name: "B", lat: 25.1, lng: 121.1 }, // Taiwan
      { day: 3, name: "C", lat: 47, lng: 8 },       // Switzerland
      { day: 4, name: "D", lat: 47.1, lng: 8.1 },   // Switzerland
      { day: 5, name: "E", lat: 47.2, lng: 8.2 },   // Switzerland
    ];
    const { primary, outliers } = clusterStops(stops);
    // The cluster filter (Tier 1) drops the 2 Taiwan stops if they're
    // far enough; what we're testing is that Tier 2 doesn't *also*
    // evict more stops from a viable cluster. Acceptable: either Tier 1
    // catches Taiwan (preferred) or both clusters preserved.
    expect(primary.length).toBeGreaterThanOrEqual(3);
    expect(primary.length + outliers.length).toBe(5);
  });
});
