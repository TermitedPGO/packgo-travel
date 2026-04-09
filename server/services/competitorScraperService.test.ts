/**
 * competitorScraperService.test.ts
 * 競品監控爬蟲服務 — 單元測試
 *
 * 測試範圍：
 * - compareDepartures（比對新舊快照）
 * - generateAlerts（告警生成）
 * - extractNormGroupId（URL 解析）
 * - parseMarkdownForDepartures（Markdown 解析）
 */
import { describe, it, expect } from "vitest";
import {
  compareDepartures,
  generateAlerts,
  type PreviousDeparture,
  type DepartureInfo,
  type ChangeDetection,
} from "./competitorScraperService";

// ── compareDepartures ──────────────────────────────────────────

describe("compareDepartures", () => {
  const basePrev: PreviousDeparture[] = [
    {
      departureDate: "2026-06-01",
      adultPrice: 50000,
      availableSeats: 20,
      departureStatus: "open",
    },
    {
      departureDate: "2026-06-15",
      adultPrice: 55000,
      availableSeats: 10,
      departureStatus: "open",
    },
  ];

  it("should detect new departures", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 20, status: "open" },
      { departureDate: "2026-07-01", adultPrice: 48000, status: "open" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const newDep = changes.find((c) => c.type === "new_departure");
    expect(newDep).toBeDefined();
    expect(newDep!.departureDate).toBe("2026-07-01");
    expect(newDep!.newValue).toBe(48000);
    expect(newDep!.severity).toBe("info");
  });

  it("should detect price drop (< 10%)", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 48000, status: "open" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const drop = changes.find((c) => c.type === "price_drop");
    expect(drop).toBeDefined();
    expect(drop!.oldValue).toBe(50000);
    expect(drop!.newValue).toBe(48000);
    expect(drop!.severity).toBe("warning"); // 4% < 10%
  });

  it("should detect price drop (> 10%) as critical", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 40000, status: "open" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const drop = changes.find((c) => c.type === "price_drop");
    expect(drop).toBeDefined();
    expect(drop!.severity).toBe("critical"); // 20% > 10%
  });

  it("should detect price increase", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 55000, status: "open" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const increase = changes.find((c) => c.type === "price_increase");
    expect(increase).toBeDefined();
    expect(increase!.oldValue).toBe(50000);
    expect(increase!.newValue).toBe(55000);
    expect(increase!.severity).toBe("warning");
  });

  it("should detect sold out", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 0, status: "full" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const soldOut = changes.find((c) => c.type === "sold_out");
    expect(soldOut).toBeDefined();
    expect(soldOut!.severity).toBe("critical");
  });

  it("should not detect sold out if already full", () => {
    const prevFull: PreviousDeparture[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 0, departureStatus: "full" },
    ];
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 0, status: "full" },
    ];
    const changes = compareDepartures(prevFull, newDeps);
    const soldOut = changes.find((c) => c.type === "sold_out");
    expect(soldOut).toBeUndefined();
  });

  it("should detect low seats (< 5)", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 3, status: "open" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const lowSeats = changes.find((c) => c.type === "low_seats");
    expect(lowSeats).toBeDefined();
    expect(lowSeats!.newValue).toBe(3);
    expect(lowSeats!.severity).toBe("warning");
  });

  it("should not detect low seats if already low", () => {
    const prevLow: PreviousDeparture[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 3, departureStatus: "open" },
    ];
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 2, status: "open" },
    ];
    const changes = compareDepartures(prevLow, newDeps);
    const lowSeats = changes.find((c) => c.type === "low_seats");
    expect(lowSeats).toBeUndefined();
  });

  it("should detect guaranteed departure", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, status: "guaranteed" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const guaranteed = changes.find((c) => c.type === "guaranteed");
    expect(guaranteed).toBeDefined();
    expect(guaranteed!.severity).toBe("info");
  });

  it("should not detect guaranteed if already guaranteed", () => {
    const prevGuaranteed: PreviousDeparture[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 20, departureStatus: "guaranteed" },
    ];
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, status: "guaranteed" },
    ];
    const changes = compareDepartures(prevGuaranteed, newDeps);
    const guaranteed = changes.find((c) => c.type === "guaranteed");
    expect(guaranteed).toBeUndefined();
  });

  it("should detect tour cancelled", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, status: "cancelled" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const cancelled = changes.find((c) => c.type === "tour_cancelled");
    expect(cancelled).toBeDefined();
    expect(cancelled!.severity).toBe("critical");
  });

  it("should return empty array when no changes", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, availableSeats: 20, status: "open" },
      { departureDate: "2026-06-15", adultPrice: 55000, availableSeats: 10, status: "open" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    expect(changes).toHaveLength(0);
  });

  it("should handle empty previous departures (all new)", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, status: "open" },
      { departureDate: "2026-06-15", adultPrice: 55000, status: "open" },
    ];
    const changes = compareDepartures([], newDeps);
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.type === "new_departure")).toBe(true);
  });

  it("should handle empty new departures", () => {
    const changes = compareDepartures(basePrev, []);
    expect(changes).toHaveLength(0);
  });

  it("should detect multiple changes for same departure", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 35000, availableSeats: 3, status: "open" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    // Should detect both price_drop (critical, 30%) and low_seats
    const priceDrop = changes.find((c) => c.type === "price_drop");
    const lowSeats = changes.find((c) => c.type === "low_seats");
    expect(priceDrop).toBeDefined();
    expect(lowSeats).toBeDefined();
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it("should not detect price change when previous price is null", () => {
    const prevNoPrice: PreviousDeparture[] = [
      { departureDate: "2026-06-01", adultPrice: null, availableSeats: 20, departureStatus: "open" },
    ];
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", adultPrice: 50000, status: "open" },
    ];
    const changes = compareDepartures(prevNoPrice, newDeps);
    const priceChange = changes.find(
      (c) => c.type === "price_drop" || c.type === "price_increase"
    );
    expect(priceChange).toBeUndefined();
  });

  it("should not detect price change when new price is undefined", () => {
    const newDeps: DepartureInfo[] = [
      { departureDate: "2026-06-01", status: "open" },
    ];
    const changes = compareDepartures(basePrev, newDeps);
    const priceChange = changes.find(
      (c) => c.type === "price_drop" || c.type === "price_increase"
    );
    expect(priceChange).toBeUndefined();
  });
});

// ── generateAlerts ─────────────────────────────────────────────

describe("generateAlerts", () => {
  it("should generate alerts from change detections", () => {
    const changes: ChangeDetection[] = [
      {
        type: "price_drop",
        departureDate: "2026-06-01",
        oldValue: 50000,
        newValue: 40000,
        message: "降價 NT$10,000",
        severity: "critical",
      },
      {
        type: "new_departure",
        departureDate: "2026-07-01",
        newValue: 48000,
        message: "新增出團日期",
        severity: "info",
      },
    ];

    const alerts = generateAlerts(42, "日本東京5日遊", changes);
    expect(alerts).toHaveLength(2);

    expect(alerts[0].competitorTourId).toBe(42);
    expect(alerts[0].alertType).toBe("price_drop");
    expect(alerts[0].title).toContain("日本東京5日遊");
    expect(alerts[0].title).toContain("降價通知");
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].metadata).toContain('"oldValue":50000');

    expect(alerts[1].alertType).toBe("new_departure");
    expect(alerts[1].severity).toBe("info");
  });

  it("should return empty array for no changes", () => {
    const alerts = generateAlerts(1, "Test Tour", []);
    expect(alerts).toHaveLength(0);
  });

  it("should include correct metadata JSON", () => {
    const changes: ChangeDetection[] = [
      {
        type: "sold_out",
        departureDate: "2026-08-01",
        oldValue: 5,
        newValue: 0,
        message: "已售罄",
        severity: "critical",
      },
    ];
    const alerts = generateAlerts(10, "韓國首爾4日遊", changes);
    const meta = JSON.parse(alerts[0].metadata);
    expect(meta.departureDate).toBe("2026-08-01");
    expect(meta.oldValue).toBe(5);
    expect(meta.newValue).toBe(0);
  });

  it("should map all alert types to correct labels", () => {
    const types: ChangeDetection["type"][] = [
      "price_drop",
      "price_increase",
      "low_seats",
      "sold_out",
      "new_departure",
      "tour_cancelled",
      "guaranteed",
    ];
    const changes: ChangeDetection[] = types.map((type) => ({
      type,
      departureDate: "2026-06-01",
      message: "test",
      severity: "info" as const,
    }));
    const alerts = generateAlerts(1, "Test", changes);
    expect(alerts).toHaveLength(7);

    const expectedLabels = [
      "降價通知",
      "漲價通知",
      "座位不足",
      "已售罄",
      "新增出團",
      "行程取消",
      "確認出團",
    ];
    alerts.forEach((alert, i) => {
      expect(alert.title).toContain(expectedLabels[i]);
    });
  });
});
