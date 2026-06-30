/**
 * duplicateProfileScan tests — the pure `findDuplicateProfileGroups` (where
 * the "which profiles are probably the same person" logic lives) and
 * `formatDuplicateDigest`. The DB read + inbox-post executor
 * (runDuplicateProfileScan) is verified live, matching followupScan.test.ts's
 * convention (only the pure logic is unit-tested).
 */
import { describe, it, expect } from "vitest";
import {
  findDuplicateProfileGroups,
  formatDuplicateDigest,
  type ProfileIdentityRow,
} from "./duplicateProfileScan";

const row = (
  id: number,
  email: string | null,
  phone: string | null,
  daysAgo: number,
): ProfileIdentityRow => ({
  id,
  email,
  phone,
  createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
});

describe("findDuplicateProfileGroups", () => {
  it("flags two profiles sharing the same email, oldest first (the real one)", () => {
    const rows = [
      row(2760030, "eyoung@axt.com", null, 1), // newer — the accidental dup
      row(2760016, "eyoung@axt.com", null, 30), // older — the real one, has history
    ];
    const groups = findDuplicateProfileGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].field).toBe("email");
    expect(groups[0].key).toBe("eyoung@axt.com");
    expect(groups[0].profileIds).toEqual([2760016, 2760030]); // oldest first
  });

  it("is case-insensitive and trims whitespace when matching email", () => {
    const rows = [
      row(1, "Mei@Example.com", null, 5),
      row(2, "  mei@example.com  ", null, 1),
    ];
    expect(findDuplicateProfileGroups(rows)).toHaveLength(1);
  });

  it("flags duplicates by phone too, independently of email", () => {
    const rows = [
      row(1, "a@x.com", "555-1234", 5),
      row(2, "b@x.com", "555-1234", 1),
    ];
    const groups = findDuplicateProfileGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].field).toBe("phone");
  });

  it("a profile can appear in both an email-group and a phone-group (reported once per field)", () => {
    const rows = [
      row(1, "shared@x.com", "555-1234", 10),
      row(2, "shared@x.com", "999-9999", 5), // shares email with 1
      row(3, "other@x.com", "555-1234", 1), // shares phone with 1
    ];
    const groups = findDuplicateProfileGroups(rows);
    expect(groups).toHaveLength(2);
    const emailGroup = groups.find((g) => g.field === "email")!;
    const phoneGroup = groups.find((g) => g.field === "phone")!;
    expect(emailGroup.profileIds).toEqual([1, 2]);
    expect(phoneGroup.profileIds).toEqual([1, 3]);
  });

  it("ignores null/empty email and phone entirely (never groups two blanks together)", () => {
    const rows = [
      row(1, null, null, 5),
      row(2, "", "", 1),
      row(3, null, null, 2),
    ];
    expect(findDuplicateProfileGroups(rows)).toEqual([]);
  });

  it("a single profile with a unique email/phone is never flagged", () => {
    const rows = [row(1, "solo@x.com", "111-1111", 5)];
    expect(findDuplicateProfileGroups(rows)).toEqual([]);
  });

  it("three-way duplicate groups all three ids, oldest first", () => {
    const rows = [
      row(30, "x@x.com", null, 1),
      row(10, "x@x.com", null, 20),
      row(20, "x@x.com", null, 10),
    ];
    const groups = findDuplicateProfileGroups(rows);
    expect(groups[0].profileIds).toEqual([10, 20, 30]);
  });
});

describe("formatDuplicateDigest", () => {
  it("lists each group with field label + profile ids", () => {
    const body = formatDuplicateDigest([
      { field: "email", key: "eyoung@axt.com", profileIds: [2760016, 2760030] },
    ]);
    expect(body).toContain("Email eyoung@axt.com");
    expect(body).toContain("#2760016");
    expect(body).toContain("#2760030");
  });

  it("caps the listed groups and notes how many more exist", () => {
    const groups = Array.from({ length: 25 }, (_, i) => ({
      field: "email" as const,
      key: `c${i}@x.com`,
      profileIds: [i, i + 1000],
    }));
    const body = formatDuplicateDigest(groups);
    expect(body).toContain("c0@x.com");
    expect(body).not.toContain("c24@x.com"); // beyond the cap
    expect(body).toContain("還有 5 組未列出");
  });
});
