/**
 * gmailAccountRouting — 純路由邏輯測試(probe 注入,不碰 Gmail)。
 *
 * 鎖的行為(2026-07-02 P0:多 Gmail 帳號回信路由):
 *   - 單帳號 fast path 完全不 probe(零額外 API call,行為同修前)。
 *   - 多帳號依傳入順序 probe,第一個擁有 thread 的帳號勝出並短路。
 *   - probe 炸掉(invalid_grant / 網路)記進 probeErrors 繼續試下一個,
 *     絕不因一個帳號壞掉放棄整條路由。
 *   - 全部沒有 → none,checked / probeErrors 誠實分列。
 *   - isGmailNotFoundError 只認 404 / "Requested entity was not found",
 *     其他錯誤不可吞(吞掉會把壞 token 誤讀成「不是這帳號的信」)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  resolveThreadOwner,
  isGmailNotFoundError,
  describeNoThreadOwner,
} from "./gmailAccountRouting";

const acct = (emailAddress: string) => ({ emailAddress });

describe("resolveThreadOwner", () => {
  it("no accounts → no_accounts (probe never called)", async () => {
    const probe = vi.fn();
    const r = await resolveThreadOwner([], probe);
    expect(r.kind).toBe("no_accounts");
    expect(probe).not.toHaveBeenCalled();
  });

  it("single account → single fast path, NO probe", async () => {
    const probe = vi.fn();
    const only = acct("support@packgoplay.com");
    const r = await resolveThreadOwner([only], probe);
    expect(r).toEqual({ kind: "single", integration: only });
    expect(probe).not.toHaveBeenCalled();
  });

  it("first account owns → owner after exactly one probe (short-circuit)", async () => {
    const a = acct("a@x.com");
    const b = acct("b@y.com");
    const probe = vi.fn(async () => true);
    const r = await resolveThreadOwner([a, b], probe);
    expect(r).toEqual({ kind: "owner", integration: a });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(a);
  });

  it("second account owns → probes in order, picks the second", async () => {
    const a = acct("a@x.com");
    const b = acct("b@y.com");
    const probe = vi.fn(async (i: { emailAddress: string }) => i === b);
    const r = await resolveThreadOwner([a, b], probe);
    expect(r).toEqual({ kind: "owner", integration: b });
    expect(probe.mock.calls.map((c) => c[0])).toEqual([a, b]);
  });

  it("nobody owns → none with the checked emails in probe order", async () => {
    const probe = vi.fn(async () => false);
    const r = await resolveThreadOwner([acct("a@x.com"), acct("b@y.com")], probe);
    expect(r).toEqual({
      kind: "none",
      checked: ["a@x.com", "b@y.com"],
      probeErrors: [],
    });
  });

  it("probe error on one account is recorded and the NEXT still wins", async () => {
    const a = acct("dead@x.com");
    const b = acct("alive@y.com");
    const probe = vi.fn(async (i: { emailAddress: string }) => {
      if (i === a) throw new Error("invalid_grant");
      return true;
    });
    const r = await resolveThreadOwner([a, b], probe);
    expect(r).toEqual({ kind: "owner", integration: b });
  });

  it("all probes fail/miss → none splits checked vs probeErrors honestly", async () => {
    const a = acct("dead@x.com");
    const b = acct("empty@y.com");
    const probe = vi.fn(async (i: { emailAddress: string }) => {
      if (i === a) throw new Error("invalid_grant: token revoked");
      return false;
    });
    const r = await resolveThreadOwner([a, b], probe);
    expect(r.kind).toBe("none");
    if (r.kind === "none") {
      expect(r.checked).toEqual(["empty@y.com"]);
      expect(r.probeErrors).toEqual([
        { emailAddress: "dead@x.com", message: "invalid_grant: token revoked" },
      ]);
    }
  });

  it("non-Error throw is stringified into probeErrors (never crashes routing)", async () => {
    const r = await resolveThreadOwner(
      [acct("a@x.com"), acct("b@y.com")],
      async (i) => {
        if (i.emailAddress === "a@x.com") throw "boom";
        return false;
      },
    );
    expect(r.kind).toBe("none");
    if (r.kind === "none") {
      expect(r.probeErrors[0]).toEqual({ emailAddress: "a@x.com", message: "boom" });
    }
  });
});

describe("isGmailNotFoundError", () => {
  it("matches GaxiosError shapes: numeric code / string code / response.status", () => {
    expect(isGmailNotFoundError({ code: 404 })).toBe(true);
    expect(isGmailNotFoundError({ code: "404" })).toBe(true);
    expect(isGmailNotFoundError({ status: 404 })).toBe(true);
    expect(isGmailNotFoundError({ response: { status: 404 } })).toBe(true);
  });

  it("matches the canonical message regardless of case/punctuation", () => {
    expect(
      isGmailNotFoundError(new Error("Requested entity was not found.")),
    ).toBe(true);
  });

  it("does NOT swallow auth / transient errors", () => {
    expect(isGmailNotFoundError(new Error("invalid_grant"))).toBe(false);
    expect(isGmailNotFoundError({ code: 500 })).toBe(false);
    expect(isGmailNotFoundError({ response: { status: 429 } })).toBe(false);
    expect(isGmailNotFoundError(new Error("socket hang up"))).toBe(false);
  });

  it("null / undefined / primitives → false", () => {
    expect(isGmailNotFoundError(null)).toBe(false);
    expect(isGmailNotFoundError(undefined)).toBe(false);
    expect(isGmailNotFoundError("404")).toBe(false);
  });
});

describe("describeNoThreadOwner", () => {
  it("names every checked account", () => {
    const msg = describeNoThreadOwner(["a@x.com", "b@y.com"], []);
    expect(msg).toContain("a@x.com");
    expect(msg).toContain("b@y.com");
    expect(msg).toContain("沒有寄出");
  });

  it("separates unprobeable accounts from checked ones", () => {
    const msg = describeNoThreadOwner(
      ["a@x.com"],
      [{ emailAddress: "dead@y.com", message: "invalid_grant" }],
    );
    expect(msg).toContain("已檢查:a@x.com");
    expect(msg).toContain("無法檢查:dead@y.com");
  });
});
