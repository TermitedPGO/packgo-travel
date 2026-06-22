/**
 * sentMailFiling tests — the pure recipient parser (drives which customer a
 * sent mail files to) + graceful no-DB degradation. The gmail/storage
 * integration path follows the repo's Gmail-pipeline norm: verified live on
 * deploy, not unit-mocked.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));

import { parseRecipientEmails, runSentMailCapture, SENT_FILED_LABEL } from "./sentMailFiling";

describe("parseRecipientEmails", () => {
  it("extracts the address from a 'Name <email>' header", () => {
    expect(parseRecipientEmails("Jenny Chang <jenny.chang.info@gmail.com>")).toEqual([
      "jenny.chang.info@gmail.com",
    ]);
  });
  it("extracts multiple recipients, lowercases, and de-dupes", () => {
    expect(parseRecipientEmails("A <A@X.com>, b@y.com, a@x.com")).toEqual([
      "a@x.com",
      "b@y.com",
    ]);
  });
  it("returns [] for empty / null / no-email input", () => {
    expect(parseRecipientEmails("")).toEqual([]);
    expect(parseRecipientEmails(null)).toEqual([]);
    expect(parseRecipientEmails(undefined)).toEqual([]);
    expect(parseRecipientEmails("just some words, no address")).toEqual([]);
  });
  it("handles a plain address with no display name", () => {
    expect(parseRecipientEmails("foo.bar+tag@sub.domain.co")).toEqual(["foo.bar+tag@sub.domain.co"]);
  });
});

describe("runSentMailCapture — graceful no-DB", () => {
  it("returns zero counts when the DB is unavailable", async () => {
    expect(await runSentMailCapture(1)).toEqual({ scanned: 0, docsFiled: 0, interactions: 0 });
  });
});

describe("constants", () => {
  it("exposes the dedup label", () => {
    expect(SENT_FILED_LABEL).toBe("PackGoFiled");
  });
});
