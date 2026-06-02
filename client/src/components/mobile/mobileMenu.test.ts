import { describe, it, expect } from "vitest";
import { buildMenuGroups, type MenuAction } from "./mobileMenu";

const noop = () => {};
const actions: MenuAction[] = [
  { id: "bookings", label: "訂單", group: "工作台", onSelect: noop },
  { id: "tours", label: "行程", group: "工作台", onSelect: noop },
  { id: "bank-ledger", label: "交易明細", group: "帳本", onSelect: noop },
  { id: "agent-chat", label: "PACK&GO Agent", group: "Chat", onSelect: noop },
];

describe("buildMenuGroups", () => {
  it("groups all actions by domain, preserving order, when query is empty", () => {
    const groups = buildMenuGroups(actions, "");
    expect(groups.map(([g]) => g)).toEqual(["工作台", "帳本", "Chat"]);
    const workspace = groups.find(([g]) => g === "工作台")![1];
    expect(workspace.map((a) => a.id)).toEqual(["bookings", "tours"]);
  });

  it("filters by label case-insensitively (latin)", () => {
    const groups = buildMenuGroups(actions, "agent");
    expect(groups).toHaveLength(1);
    expect(groups[0][0]).toBe("Chat");
    expect(groups[0][1][0].id).toBe("agent-chat");
  });

  it("matches CJK label substrings", () => {
    const groups = buildMenuGroups(actions, "明細");
    expect(groups).toHaveLength(1);
    expect(groups[0][1][0].id).toBe("bank-ledger");
  });

  it("returns no groups when nothing matches", () => {
    expect(buildMenuGroups(actions, "zzzz")).toHaveLength(0);
  });

  it("ignores surrounding whitespace in the query", () => {
    const groups = buildMenuGroups(actions, "  行程  ");
    expect(groups).toHaveLength(1);
    expect(groups[0][1][0].id).toBe("tours");
  });
});
