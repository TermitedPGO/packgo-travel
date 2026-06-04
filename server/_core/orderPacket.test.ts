/**
 * Tests for the supplier order-packet CSV builder. The packet carries passport
 * data to the supplier, so the formatting must be correct (proper escaping so a
 * name with a comma can't shift columns and corrupt a passport field).
 */
import { describe, it, expect } from "vitest";
import { orderPacketToCsv, type OrderPacket } from "@shared/orderPacket";

const base: OrderPacket = {
  bookingId: 42,
  tourTitle: "Kansai 7-day",
  departureDate: "2026-08-01",
  supplier: "lion",
  supplierBookingRef: "UV-123",
  contactName: "Jeff Hsieh",
  contactEmail: "jeff@example.com",
  contactPhone: "+1-510-000-0000",
  pax: { adults: 2, childrenWithBed: 1, childrenNoBed: 0, infants: 0 },
  passengers: [
    {
      index: 1,
      type: "adult",
      lastName: "Hsieh",
      firstName: "Jeff",
      gender: "male",
      dateOfBirth: "1985-05-05",
      nationality: "USA",
      passportNumber: "X1234567",
      passportExpiry: "2030-01-01",
    },
  ],
};

describe("orderPacketToCsv", () => {
  it("includes the meta block + passenger header + a row per passenger", () => {
    const csv = orderPacketToCsv(base);
    expect(csv).toContain("Booking,#42");
    expect(csv).toContain("Tour,Kansai 7-day");
    expect(csv).toContain("Supplier Ref,UV-123");
    expect(csv).toContain("Passport No.");
    // the passenger row carries the (plaintext) passport for the supplier
    expect(csv).toContain("X1234567");
    expect(csv).toContain("1,adult,Hsieh,Jeff,male,1985-05-05,USA,X1234567,2030-01-01");
  });

  it("quotes cells containing commas so columns can't shift", () => {
    const csv = orderPacketToCsv({
      ...base,
      passengers: [{ ...base.passengers[0], lastName: "Smith, Jr.", firstName: "Al" }],
    });
    expect(csv).toContain('"Smith, Jr."');
    // the passport must still land in its own column, not be eaten by the comma
    expect(csv).toContain("X1234567,2030-01-01");
  });

  it("escapes embedded double quotes by doubling them", () => {
    const csv = orderPacketToCsv({
      ...base,
      passengers: [{ ...base.passengers[0], firstName: 'Al "Ace"' }],
    });
    expect(csv).toContain('"Al ""Ace"""');
  });

  it("handles zero passengers (still emits meta + header)", () => {
    const csv = orderPacketToCsv({ ...base, passengers: [] });
    expect(csv).toContain("Booking,#42");
    expect(csv).toContain("Passport No.");
  });

  it("renders missing optional fields as empty cells, not 'null'", () => {
    const csv = orderPacketToCsv({
      ...base,
      supplierBookingRef: null,
      passengers: [
        {
          index: 1,
          type: "infant",
          lastName: "Doe",
          firstName: "Baby",
          gender: null,
          dateOfBirth: null,
          nationality: null,
          passportNumber: null,
          passportExpiry: null,
        },
      ],
    });
    expect(csv).not.toContain("null");
    expect(csv).toContain("1,infant,Doe,Baby,,,,,");
  });
});
