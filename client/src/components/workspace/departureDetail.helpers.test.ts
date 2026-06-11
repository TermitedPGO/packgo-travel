/**
 * departureDetail.helpers.test — batch 6 m2: readiness derivation logic.
 */
import { describe, it, expect } from "vitest";
import { deriveReadiness } from "./departureDetail.helpers";

describe("deriveReadiness", () => {
  const baseDep = { tourLeader: null, bookedSlots: 0, opsStatus: null };

  it("all pending when nothing is ready", () => {
    const r = deriveReadiness(baseDep, [], []);
    const statuses = r.filter((i) => i.status === "pending");
    expect(statuses.length).toBe(4);
    expect(r.find((i) => i.key === "notice")!.status).toBe("not_impl");
  });

  it("passport done when all participants have passport", () => {
    const r = deriveReadiness(
      baseDep,
      [{ passportNumber: "••••1234" }, { passportNumber: "••••5678" }],
      [],
    );
    expect(r.find((i) => i.key === "passport")!.status).toBe("done");
  });

  it("passport pending when any participant lacks passport", () => {
    const r = deriveReadiness(
      baseDep,
      [{ passportNumber: "••••1234" }, { passportNumber: null }],
      [],
    );
    expect(r.find((i) => i.key === "passport")!.status).toBe("pending");
  });

  it("supplier done when all bookings vendor_confirmed", () => {
    const r = deriveReadiness(
      baseDep,
      [],
      [{ supplierStatus: "vendor_confirmed" }, { supplierStatus: "vendor_confirmed" }],
    );
    expect(r.find((i) => i.key === "supplier")!.status).toBe("done");
  });

  it("supplier pending when any booking not confirmed", () => {
    const r = deriveReadiness(
      baseDep,
      [],
      [{ supplierStatus: "vendor_confirmed" }, { supplierStatus: "placed" }],
    );
    expect(r.find((i) => i.key === "supplier")!.status).toBe("pending");
  });

  it("leader done when tourLeader assigned", () => {
    const r = deriveReadiness({ ...baseDep, tourLeader: "John" }, [], []);
    expect(r.find((i) => i.key === "leader")!.status).toBe("done");
  });

  it("roster done when bookedSlots > 0", () => {
    const r = deriveReadiness({ ...baseDep, bookedSlots: 5 }, [], []);
    expect(r.find((i) => i.key === "roster")!.status).toBe("done");
  });

  it("notice is always not_impl (placeholder for m3)", () => {
    const r = deriveReadiness(
      { tourLeader: "A", bookedSlots: 10, opsStatus: "confirmed" },
      [{ passportNumber: "x" }],
      [{ supplierStatus: "vendor_confirmed" }],
    );
    expect(r.find((i) => i.key === "notice")!.status).toBe("not_impl");
  });
});
