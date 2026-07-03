import { describe, it, expect } from "vitest";
import {
  evaluateFollowUpDue,
  evaluateQuoteExpiring,
  commitmentToTodayItem,
  evaluateDepartureCountdown,
  evaluateBalanceDue,
} from "./todayList";

const TODAY = "2026-07-02";

describe("evaluateFollowUpDue", () => {
  it("triggers when followUpDate <= today", () => {
    const item = evaluateFollowUpDue(
      { id: 1, userId: null, name: "陳先生", followUpDate: "2026-07-01" },
      TODAY,
    );
    expect(item).not.toBeNull();
    expect(item?.category).toBe("followUpDue");
    expect(item?.customerProfileId).toBe(1);
    expect(item?.oneLiner).toContain("陳先生");
  });

  it("triggers when followUpDate === today (boundary)", () => {
    const item = evaluateFollowUpDue(
      { id: 2, userId: null, name: null, followUpDate: TODAY },
      TODAY,
    );
    expect(item).not.toBeNull();
  });

  it("does not trigger when followUpDate is in the future", () => {
    const item = evaluateFollowUpDue(
      { id: 3, userId: null, name: "王小姐", followUpDate: "2026-07-03" },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("returns null when followUpDate is null (missing field, no guessing)", () => {
    const item = evaluateFollowUpDue({ id: 4, userId: null, name: "李先生", followUpDate: null }, TODAY);
    expect(item).toBeNull();
  });

  it("handles null name gracefully", () => {
    const item = evaluateFollowUpDue({ id: 5, userId: null, name: null, followUpDate: "2026-06-01" }, TODAY);
    expect(item).not.toBeNull();
    expect(item?.customerName).toBeNull();
  });
});

describe("evaluateQuoteExpiring", () => {
  const base = {
    customerProfileId: 10,
    userId: null as number | null,
    customerName: "張先生",
    lastInboundAt: null as string | null,
  };

  it("returns null when quoteSentAt is null (missing field)", () => {
    const item = evaluateQuoteExpiring(
      { ...base, quoteSentAt: null },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("returns null when customer already replied after quoteSentAt", () => {
    const item = evaluateQuoteExpiring(
      { ...base, quoteSentAt: "2026-06-01", lastInboundAt: "2026-06-15" },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("returns null when customer replied exactly on quoteSentAt day", () => {
    const item = evaluateQuoteExpiring(
      { ...base, quoteSentAt: "2026-06-01", lastInboundAt: "2026-06-01" },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("boundary: exactly 10 days does not trigger (still early)", () => {
    // TODAY - 10 days = 2026-06-22
    const item = evaluateQuoteExpiring(
      { ...base, quoteSentAt: "2026-06-22" },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("boundary: exactly 11 days triggers 'days left'", () => {
    // TODAY - 11 days = 2026-06-21
    const item = evaluateQuoteExpiring(
      { ...base, quoteSentAt: "2026-06-21" },
      TODAY,
    );
    expect(item).not.toBeNull();
    expect(item?.oneLiner).toContain("還剩");
    expect(item?.oneLiner).toContain("3"); // 14 - 11 = 3 days left
  });

  it("boundary: exactly 13 days shows days-left variant", () => {
    // TODAY - 13 days = 2026-06-19
    const item = evaluateQuoteExpiring(
      { ...base, quoteSentAt: "2026-06-19" },
      TODAY,
    );
    expect(item).not.toBeNull();
    expect(item?.oneLiner).toContain("還剩");
    expect(item?.oneLiner).toContain("1"); // 14 - 13 = 1 day left
  });

  it("boundary: exactly 14 days shows expired variant", () => {
    // TODAY - 14 days = 2026-06-18
    const item = evaluateQuoteExpiring(
      { ...base, quoteSentAt: "2026-06-18" },
      TODAY,
    );
    expect(item).not.toBeNull();
    expect(item?.oneLiner).toContain("已過效期");
  });

  it("well past expiry still triggers expired variant", () => {
    const item = evaluateQuoteExpiring(
      { ...base, quoteSentAt: "2026-05-01" },
      TODAY,
    );
    expect(item).not.toBeNull();
    expect(item?.oneLiner).toContain("已過效期");
  });
});

describe("commitmentToTodayItem", () => {
  it("converts a commitment finding into a TodayListItem shape", () => {
    const item = commitmentToTodayItem(
      { customerProfileId: 7, promiseText: "週五可取件", daysOverdue: 3 },
      "林先生",
    );
    expect(item.category).toBe("commitment");
    expect(item.customerProfileId).toBe(7);
    expect(item.customerName).toBe("林先生");
    expect(item.oneLiner).toContain("週五可取件");
    expect(item.oneLiner).toContain("3");
  });

  it("handles null customerName", () => {
    const item = commitmentToTodayItem(
      { customerProfileId: 8, promiseText: "明天發報價", daysOverdue: 1 },
      null,
    );
    expect(item.customerName).toBeNull();
    expect(item.oneLiner).toContain("明天發報價");
  });

  it("defaults userId to null when not passed, accepts it when passed", () => {
    const noUserId = commitmentToTodayItem(
      { customerProfileId: 9, promiseText: "週三回電", daysOverdue: 2 },
      "陳小姐",
    );
    expect(noUserId.userId).toBeNull();

    const withUserId = commitmentToTodayItem(
      { customerProfileId: 9, promiseText: "週三回電", daysOverdue: 2 },
      "陳小姐",
      55,
    );
    expect(withUserId.userId).toBe(55);
  });
});

describe("evaluateDepartureCountdown", () => {
  const base = { customerProfileId: 20, userId: null as number | null, customerName: "黃先生" };

  it("returns null when departureDate is null (missing field)", () => {
    const item = evaluateDepartureCountdown({ ...base, departureDate: null }, TODAY);
    expect(item).toBeNull();
  });

  it("boundary: exactly 29 days does not trigger", () => {
    const item = evaluateDepartureCountdown(
      { ...base, departureDate: "2026-07-31" },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("boundary: exactly 30 days triggers", () => {
    const item = evaluateDepartureCountdown(
      { ...base, departureDate: "2026-08-01" },
      TODAY,
    );
    expect(item).not.toBeNull();
    expect(item?.oneLiner).toContain("30");
  });

  it("boundary: exactly 31 days does not trigger", () => {
    const item = evaluateDepartureCountdown(
      { ...base, departureDate: "2026-08-02" },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("boundary: exactly 6 days does not trigger", () => {
    const item = evaluateDepartureCountdown(
      { ...base, departureDate: "2026-07-08" },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("boundary: exactly 7 days triggers", () => {
    const item = evaluateDepartureCountdown(
      { ...base, departureDate: "2026-07-09" },
      TODAY,
    );
    expect(item).not.toBeNull();
    expect(item?.oneLiner).toContain("7");
  });

  it("boundary: exactly 8 days does not trigger", () => {
    const item = evaluateDepartureCountdown(
      { ...base, departureDate: "2026-07-10" },
      TODAY,
    );
    expect(item).toBeNull();
  });

  it("a mid-range day (e.g. 15 days) does not trigger — precise window only", () => {
    const item = evaluateDepartureCountdown(
      { ...base, departureDate: "2026-07-17" },
      TODAY,
    );
    expect(item).toBeNull();
  });
});

describe("evaluateBalanceDue", () => {
  const base = {
    customerProfileId: 30,
    userId: null as number | null,
    customerName: "吳小姐",
    totalPrice: "5000",
    depositPaidAt: "2026-06-01",
    balancePaidAt: null as string | null,
    departureDate: "2026-07-15", // 13 days from TODAY
  };

  it("triggers a normal case within the 30-day window", () => {
    const item = evaluateBalanceDue(base, TODAY);
    expect(item).not.toBeNull();
    expect(item?.oneLiner).toContain("尾款");
  });

  it("returns null when totalPrice is missing", () => {
    const item = evaluateBalanceDue({ ...base, totalPrice: null }, TODAY);
    expect(item).toBeNull();
  });

  it("returns null when deposit not yet paid", () => {
    const item = evaluateBalanceDue({ ...base, depositPaidAt: null }, TODAY);
    expect(item).toBeNull();
  });

  it("returns null when balance already paid", () => {
    const item = evaluateBalanceDue({ ...base, balancePaidAt: "2026-06-20" }, TODAY);
    expect(item).toBeNull();
  });

  it("returns null when departureDate is missing", () => {
    const item = evaluateBalanceDue({ ...base, departureDate: null }, TODAY);
    expect(item).toBeNull();
  });

  it("returns null when departure already passed", () => {
    const item = evaluateBalanceDue({ ...base, departureDate: "2026-07-01" }, TODAY);
    expect(item).toBeNull();
  });

  it("boundary: exactly 30 days out triggers", () => {
    const item = evaluateBalanceDue({ ...base, departureDate: "2026-08-01" }, TODAY);
    expect(item).not.toBeNull();
  });

  it("boundary: exactly 31 days out does not trigger", () => {
    const item = evaluateBalanceDue({ ...base, departureDate: "2026-08-02" }, TODAY);
    expect(item).toBeNull();
  });

  it("boundary: exactly 0 days out (departs today) triggers", () => {
    const item = evaluateBalanceDue({ ...base, departureDate: TODAY }, TODAY);
    expect(item).not.toBeNull();
  });

  it("accepts numeric totalPrice too", () => {
    const item = evaluateBalanceDue({ ...base, totalPrice: 5000 }, TODAY);
    expect(item).not.toBeNull();
  });
});
