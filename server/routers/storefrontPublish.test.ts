/**
 * Batch P1b — storefrontPublish admin router tests.
 *
 * Repo pattern (adminCustomerOrders.test.ts / storefront.test.ts): mock
 * collaborators BEFORE importing the router, drive procedures via
 * createCaller. The zod input schemas stay REAL (importOriginal spread) so
 * the router-level validation — including the supplier-cost firewall on
 * fee input — is exercised for real; only the write modules are mocked.
 *
 * Module-level behavior (honest imports, atomic publish, contentHash) is
 * tested against the real modules in server/storefront/importDraft.test.ts
 * and server/storefront/publish.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));
vi.mock("../rateLimit", () => ({
  checkAdminMutationRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59 })),
}));
vi.mock("../_core/auditLog", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("../storefront/importDraft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storefront/importDraft")>();
  return {
    ...actual, // keeps the REAL zod schemas the router validates with
    createDraftProductVersion: vi.fn(),
    importItineraryDraft: vi.fn(),
    createFeeContractDraft: vi.fn(),
  };
});
vi.mock("../storefront/publish", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storefront/publish")>();
  return {
    ...actual,
    publishProductVersion: vi.fn(),
    listVersionsForTour: vi.fn(),
  };
});

import { audit } from "../_core/auditLog";
import { checkAdminMutationRateLimit } from "../rateLimit";
import {
  createDraftProductVersion,
  createFeeContractDraft,
  importItineraryDraft,
} from "../storefront/importDraft";
import { listVersionsForTour, publishProductVersion } from "../storefront/publish";
import { storefrontPublishRouter } from "./storefrontPublish";

function ctxWithUser(user: unknown) {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user,
    ip: "127.0.0.1",
  };
}
const adminCtx = () => ctxWithUser({ id: 1, email: "jeff@packgo.com", role: "admin" });
const adminCaller = () => (storefrontPublishRouter as any).createCaller(adminCtx());

async function expectForbidden(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: "FORBIDDEN" });
}

const validFeeInput = {
  tourId: 42,
  productVersionId: 10,
  contract: { sourceStatus: "supplier_quote" as const },
  fees: [
    {
      feeId: "guide-tips",
      category: "tips" as const,
      labelZh: "司導小費",
      labelEn: "Guide & driver tips",
      amountMinorUnits: 12_000,
      currency: "USD",
      unit: "per_person" as const,
      payeeType: "guide_and_driver" as const,
      paymentTiming: "during_trip" as const,
      sourceStatus: "supplier_quote" as const,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storefrontPublishRouter — structure", () => {
  it("exposes exactly the 5 admin procedures", () => {
    const procs = Object.keys((storefrontPublishRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "createDraftProductVersion",
        "createFeeContractDraft",
        "importItineraryDraft",
        "listVersions",
        "publishProductVersion",
      ].sort(),
    );
  });
});

describe("admin-only gate — every procedure rejects non-admin ctx", () => {
  const nonAdminContexts: Array<[string, unknown]> = [
    ["anonymous (user: null)", null],
    ["regular user", { id: 2, email: "user@example.com", role: "user" }],
  ];

  for (const [label, user] of nonAdminContexts) {
    it(`rejects ${label} with FORBIDDEN on all 5 procedures; no module is ever called`, async () => {
      const caller = (storefrontPublishRouter as any).createCaller(ctxWithUser(user));
      await expectForbidden(caller.createDraftProductVersion({ tourId: 42 }));
      await expectForbidden(caller.importItineraryDraft({ tourId: 42 }));
      await expectForbidden(caller.createFeeContractDraft(validFeeInput));
      await expectForbidden(caller.publishProductVersion({ productVersionId: 20 }));
      await expectForbidden(caller.listVersions({ tourId: 42 }));
      expect(createDraftProductVersion).not.toHaveBeenCalled();
      expect(importItineraryDraft).not.toHaveBeenCalled();
      expect(createFeeContractDraft).not.toHaveBeenCalled();
      expect(publishProductVersion).not.toHaveBeenCalled();
      expect(listVersionsForTour).not.toHaveBeenCalled();
    });
  }
});

describe("createDraftProductVersion", () => {
  it("passes tourId + ctx.user.id and writes the audit row (repo convention)", async () => {
    (createDraftProductVersion as any).mockResolvedValue({
      id: 99,
      tourId: 42,
      versionNumber: 3,
      status: "draft",
    });
    const result = await adminCaller().createDraftProductVersion({ tourId: 42 });
    expect(result).toMatchObject({ id: 99, versionNumber: 3 });
    expect(createDraftProductVersion).toHaveBeenCalledWith({ tourId: 42, createdBy: 1 });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "storefront.productVersion.createDraft",
        targetType: "productVersion",
        targetId: 99,
        changes: { tourId: 42, versionNumber: 3 },
      }),
    );
    // adminProcedure mutation throttle really ran (repo admin convention).
    expect(checkAdminMutationRateLimit).toHaveBeenCalled();
  });

  it("rejects invalid tourId at the input schema", async () => {
    await expect(adminCaller().createDraftProductVersion({ tourId: -1 })).rejects.toThrow();
    expect(createDraftProductVersion).not.toHaveBeenCalled();
  });
});

describe("importItineraryDraft", () => {
  it("passes tourId/productVersionId/createdBy and audits the import summary", async () => {
    (importItineraryDraft as any).mockResolvedValue({
      itineraryVersionId: 55,
      itineraryId: "26JO217BRC-T",
      versionNumber: 3,
      productVersionId: 10,
      sourceStatus: "demo_estimate",
      dayCount: 5,
      stopCount: 12,
      replacedExistingDraft: true,
    });
    const result = await adminCaller().importItineraryDraft({
      tourId: 42,
      productVersionId: 10,
    });
    expect(result.sourceStatus).toBe("demo_estimate");
    expect(importItineraryDraft).toHaveBeenCalledWith({
      tourId: 42,
      productVersionId: 10,
      createdBy: 1,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "storefront.itinerary.importDraft",
        targetType: "itineraryVersion",
        targetId: 55,
        changes: expect.objectContaining({
          sourceStatus: "demo_estimate",
          dayCount: 5,
          stopCount: 12,
          replacedExistingDraft: true,
        }),
      }),
    );
  });
});

describe("createFeeContractDraft — router-level firewall", () => {
  it("valid input reaches the module and audits", async () => {
    (createFeeContractDraft as any).mockResolvedValue({
      feeContractId: 77,
      contractId: "FEE-T42-PV10-1",
      productVersionId: 10,
      status: "draft",
      sourceStatus: "supplier_quote",
      itemCount: 1,
      replacedExistingDraft: false,
    });
    await adminCaller().createFeeContractDraft(validFeeInput);
    expect(createFeeContractDraft).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "storefront.feeContract.createDraft",
        targetType: "feeContract",
        targetId: 77,
      }),
    );
  });

  it("agentPrice smuggled into a fee line is rejected by the REAL input schema; module never called", async () => {
    await expect(
      adminCaller().createFeeContractDraft({
        ...validFeeInput,
        fees: [{ ...validFeeInput.fees[0], agentPrice: 999 } as any],
      }),
    ).rejects.toThrow();
    expect(createFeeContractDraft).not.toHaveBeenCalled();
  });

  it("supplierCost smuggled into the contract object is rejected; module never called", async () => {
    await expect(
      adminCaller().createFeeContractDraft({
        ...validFeeInput,
        contract: { sourceStatus: "supplier_quote", supplierCost: 500 } as any,
      }),
    ).rejects.toThrow();
    expect(createFeeContractDraft).not.toHaveBeenCalled();
  });

  it("'confirmed' sourceStatus is rejected at the input schema (separate adjudicated action)", async () => {
    await expect(
      adminCaller().createFeeContractDraft({
        ...validFeeInput,
        contract: { sourceStatus: "confirmed" } as any,
      }),
    ).rejects.toThrow();
    await expect(
      adminCaller().createFeeContractDraft({
        ...validFeeInput,
        fees: [{ ...validFeeInput.fees[0], sourceStatus: "confirmed" } as any],
      }),
    ).rejects.toThrow();
    expect(createFeeContractDraft).not.toHaveBeenCalled();
  });

  it("unknown currency and non-integer amounts are rejected at the input schema", async () => {
    await expect(
      adminCaller().createFeeContractDraft({
        ...validFeeInput,
        fees: [{ ...validFeeInput.fees[0], currency: "XXX" }],
      }),
    ).rejects.toThrow();
    await expect(
      adminCaller().createFeeContractDraft({
        ...validFeeInput,
        fees: [{ ...validFeeInput.fees[0], amountMinorUnits: 120.5 }],
      }),
    ).rejects.toThrow();
    expect(createFeeContractDraft).not.toHaveBeenCalled();
  });
});

describe("publishProductVersion", () => {
  it("passes productVersionId + publishedBy and audits hash + supersedes", async () => {
    const publishResult = {
      productVersionId: 20,
      tourId: 42,
      versionNumber: 2,
      contentHash: "a".repeat(64),
      publishedAt: new Date(),
      supersededProductVersionIds: [10],
      publishedItineraryVersionIds: [55],
      publishedFeeContractIds: [],
    };
    (publishProductVersion as any).mockResolvedValue(publishResult);
    const result = await adminCaller().publishProductVersion({ productVersionId: 20 });
    expect(result).toMatchObject({ productVersionId: 20, supersededProductVersionIds: [10] });
    expect(publishProductVersion).toHaveBeenCalledWith({
      productVersionId: 20,
      publishedBy: 1,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "storefront.productVersion.publish",
        targetType: "productVersion",
        targetId: 20,
        changes: expect.objectContaining({
          contentHash: "a".repeat(64),
          supersededProductVersionIds: [10],
        }),
      }),
    );
  });

  it("propagates module rejections (e.g. incomplete draft) unchanged", async () => {
    const { TRPCError } = await import("@trpc/server");
    (publishProductVersion as any).mockRejectedValue(
      new TRPCError({ code: "PRECONDITION_FAILED", message: "no itinerary version" }),
    );
    await expect(
      adminCaller().publishProductVersion({ productVersionId: 20 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("listVersions", () => {
  it("returns the module's full version history (admin may see drafts)", async () => {
    const history = [
      {
        productVersion: { id: 20, tourId: 42, versionNumber: 2, status: "draft" },
        itineraryVersions: [],
        feeContracts: [],
      },
    ];
    (listVersionsForTour as any).mockResolvedValue(history);
    const result = await adminCaller().listVersions({ tourId: 42 });
    expect(result).toEqual(history);
    expect(listVersionsForTour).toHaveBeenCalledWith(42);
  });
});
