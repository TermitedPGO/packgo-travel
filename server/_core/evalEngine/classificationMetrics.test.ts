import { describe, it, expect } from "vitest";
import { computeReport, formatReport, type Labeled } from "./classificationMetrics";

type Bin = "customer" | "non-customer";

describe("computeReport", () => {
  it("scores a perfect binary classifier as 1.0 across the board", () => {
    const rows: Labeled<Bin>[] = [
      { truth: "customer", predicted: "customer" },
      { truth: "customer", predicted: "customer" },
      { truth: "non-customer", predicted: "non-customer" },
    ];
    const r = computeReport(rows, { positiveClass: "customer" });
    expect(r.accuracy).toBe(1);
    expect(r.perClass.customer.precision).toBe(1);
    expect(r.perClass.customer.recall).toBe(1);
    expect(r.perClass.customer.f1).toBe(1);
    expect(r.macroF1).toBe(1);
  });

  it("returns null (not 0) for recall when the class has no true examples", () => {
    // The real support@ situation: every email is non-customer and the
    // classifier agrees. Customer recall has no denominator.
    const rows: Labeled<Bin>[] = Array.from({ length: 88 }, () => ({
      truth: "non-customer" as Bin,
      predicted: "non-customer" as Bin,
    }));
    const r = computeReport(rows, { positiveClass: "customer" });
    expect(r.positive!.support).toBe(0);
    expect(r.positive!.recall).toBeNull(); // not measurable
    expect(r.positive!.precision).toBeNull(); // predicted 0 customers
    expect(r.positive!.f1).toBeNull();
    expect(r.accuracy).toBe(1); // trivially correct on non-customers
    // The honest signal must reach the human-readable output too.
    expect(formatReport(r)).toContain("not measurable");
  });

  it("computes precision/recall/f1 from a known confusion count", () => {
    // 3 true customers: 2 caught (tp), 1 missed (fn). 1 non-customer flagged as customer (fp).
    const rows: Labeled<Bin>[] = [
      { truth: "customer", predicted: "customer" },
      { truth: "customer", predicted: "customer" },
      { truth: "customer", predicted: "non-customer" },
      { truth: "non-customer", predicted: "customer" },
      { truth: "non-customer", predicted: "non-customer" },
      { truth: "non-customer", predicted: "non-customer" },
    ];
    const r = computeReport(rows, { positiveClass: "customer" });
    const c = r.perClass.customer;
    expect(c.tp).toBe(2);
    expect(c.fp).toBe(1);
    expect(c.fn).toBe(1);
    expect(c.precision).toBeCloseTo(2 / 3, 6);
    expect(c.recall).toBeCloseTo(2 / 3, 6);
    expect(c.f1).toBeCloseTo(2 / 3, 6);
    expect(r.accuracy).toBeCloseTo(4 / 6, 6);
    expect(r.confusion.customer["non-customer"]).toBe(1); // the missed customer
    expect(r.confusion["non-customer"].customer).toBe(1); // the false alarm
  });

  it("gives null precision when a class is never predicted, recall still defined", () => {
    const rows: Labeled<Bin>[] = [
      { truth: "customer", predicted: "non-customer" }, // missed
      { truth: "non-customer", predicted: "non-customer" },
    ];
    const r = computeReport(rows, { positiveClass: "customer" });
    expect(r.perClass.customer.precision).toBeNull(); // predicted customer 0 times
    expect(r.perClass.customer.recall).toBe(0); // 1 true customer, caught 0
    expect(r.perClass.customer.f1).toBeNull(); // precision null -> f1 null
  });

  it("handles empty input without NaN", () => {
    const r = computeReport([] as Labeled<Bin>[], { positiveClass: "customer" });
    expect(r.n).toBe(0);
    expect(r.accuracy).toBeNull();
    expect(r.macroF1).toBeNull();
    expect(r.positive!.support).toBe(0);
    expect(r.positive!.recall).toBeNull();
  });

  it("is generic over multi-class subtype labels", () => {
    type Sub = "spam" | "newsletter" | "customer" | "notification";
    const rows: Labeled<Sub>[] = [
      { truth: "spam", predicted: "spam" },
      { truth: "newsletter", predicted: "spam" }, // confused
      { truth: "customer", predicted: "customer" },
      { truth: "notification", predicted: "notification" },
    ];
    const r = computeReport(rows);
    expect(r.classes).toEqual(["customer", "newsletter", "notification", "spam"]);
    expect(r.perClass.spam.precision).toBeCloseTo(1 / 2, 6); // 2 predicted spam, 1 correct
    expect(r.perClass.newsletter.recall).toBe(0); // its 1 example went to spam
    expect(r.confusion.newsletter.spam).toBe(1);
  });
});

describe("formatReport", () => {
  it("renders a stable, PII-free block with the priority class line and no em dashes", () => {
    const rows: Labeled<Bin>[] = [
      { truth: "customer", predicted: "customer" },
      { truth: "non-customer", predicted: "customer" },
    ];
    const out = formatReport(computeReport(rows, { positiveClass: "customer" }), { title: "TEST" });
    expect(out).toContain("TEST");
    expect(out).toContain('priority class "customer"');
    expect(out).toContain("confusion");
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("—"); // Jeff's rule: no em dashes, even in tooling output
  });
});
