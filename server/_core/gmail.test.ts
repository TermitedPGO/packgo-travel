/**
 * Tests for buildMimeReply (reply-attachments, 2026-06-15).
 *
 * Invariants:
 *   - no attachments → single text/plain part, byte-shape identical to the
 *     pre-attachment behavior (regression guard).
 *   - with attachments → multipart/mixed: body part first, one base64 part per
 *     file, proper closing boundary.
 *   - Chinese filename is RFC5987-encoded (filename*=UTF-8'') and round-trips.
 *   - base64 attachment content decodes back to the exact input bytes.
 *
 * googleapis / auth / env / crypto-token deps are mocked so importing gmail.ts
 * stays light (buildMimeReply itself touches none of them).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("googleapis", () => ({ google: {} }));
vi.mock("google-auth-library", () => ({ OAuth2Client: class {} }));
vi.mock("./env", () => ({ ENV: {} }));
vi.mock("./tokenCrypto", () => ({ decryptToken: (s: string) => s }));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  buildMimeReply,
  parseRfcMessageId,
  resolveDirection,
  type SendReplyInput,
} from "./gmail";

const BASE: SendReplyInput = {
  threadId: "t-1",
  toEmail: "jenny@example.com",
  subject: "行程詢問",
  bodyText: "Jenny 您好,報價如附件。",
  fromEmail: "support@packgoplay.com",
  confirmedAutoSendOk: true,
};

function boundaryOf(mime: string): string {
  const m = mime.match(/Content-Type: multipart\/mixed; boundary="([^"]+)"/);
  if (!m) throw new Error("no multipart boundary");
  return m[1];
}

/** Pull the base64 body of the first attachment part back into a Buffer. */
function firstAttachmentBytes(mime: string): Buffer {
  const boundary = boundaryOf(mime);
  const parts = mime.split(`--${boundary}`);
  const attPart = parts.find((p) => /Content-Disposition: attachment/.test(p));
  if (!attPart) throw new Error("no attachment part");
  const body = attPart.split("\r\n\r\n")[1] ?? "";
  return Buffer.from(body.replace(/\r\n/g, ""), "base64");
}

describe("parseRfcMessageId — cross-mailbox dedup key", () => {
  it("strips the surrounding angle brackets", () => {
    expect(parseRfcMessageId("<CADabc123@mail.gmail.com>", "gmail-internal-1")).toBe(
      "CADabc123@mail.gmail.com",
    );
  });
  it("trims whitespace around the header value", () => {
    expect(parseRfcMessageId("  <m-9@x>  ", "fallback")).toBe("m-9@x");
  });
  it("falls back to the Gmail internal id when the header is missing/blank", () => {
    expect(parseRfcMessageId(undefined, "gid-1")).toBe("gid-1");
    expect(parseRfcMessageId(null, "gid-2")).toBe("gid-2");
    expect(parseRfcMessageId("", "gid-3")).toBe("gid-3");
    expect(parseRfcMessageId("<>", "gid-4")).toBe("gid-4");
  });
  it("yields the SAME key for the same header seen in two mailboxes", () => {
    const header = "<unique-id@sender.example>";
    expect(parseRfcMessageId(header, "jeff-internal")).toBe(
      parseRfcMessageId(header, "support-internal"),
    );
  });
});

describe("resolveDirection — exact self-email match", () => {
  const self = "jeffhsieh09@gmail.com";
  it("marks a message FROM the connected account as outbound", () => {
    expect(resolveDirection("Jeff Hsieh <jeffhsieh09@gmail.com>", self)).toBe("outbound");
    expect(resolveDirection("jeffhsieh09@gmail.com", self)).toBe("outbound");
    expect(resolveDirection("JEFFHSIEH09@GMAIL.COM", self)).toBe("outbound"); // case-insensitive
  });
  it("marks a message from anyone else as inbound", () => {
    expect(resolveDirection("Jenny Chang <jenny.chang.info@gmail.com>", self)).toBe("inbound");
    expect(resolveDirection("eyoung@axt.com", self)).toBe("inbound");
  });
  it("does NOT use substring matching (display name containing self ≠ outbound)", () => {
    // A customer whose display text mentions the self address but sends from
    // their own address must stay inbound.
    expect(
      resolveDirection("jeffhsieh09@gmail.com via List <customer@evil.com>", self),
    ).toBe("inbound");
  });
  it("defaults to inbound when self email is blank or address unparseable", () => {
    expect(resolveDirection("jeffhsieh09@gmail.com", "")).toBe("inbound");
    expect(resolveDirection("no address here", self)).toBe("inbound");
  });
});

describe("buildMimeReply — no attachments (regression)", () => {
  it("is a single text/plain part, no multipart", () => {
    const mime = buildMimeReply(BASE);
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).not.toContain("multipart/mixed");
    expect(mime).toContain("Content-Transfer-Encoding: 8bit");
    expect(mime).toContain("Jenny 您好,報價如附件。");
    // contact footer appended, but never disclosing it's an AI reply (Jeff's call)
    expect(mime).not.toContain("PACK&GO AI 助理");
    expect(mime).not.toContain("自動回覆");
    expect(mime).toContain("+1 (510) 634-2307");
  });

  it("prefixes Re: and threads via In-Reply-To when given", () => {
    const mime = buildMimeReply({ ...BASE, inReplyToMessageId: "<m-9@mail>" });
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("In-Reply-To: <m-9@mail>");
    expect(mime).toContain("References: <m-9@mail>");
    // Subject is base64; decode it to confirm the Re: prefix
    const subjB64 = mime.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)![1];
    expect(Buffer.from(subjB64, "base64").toString("utf-8")).toBe("Re: 行程詢問");
  });

  it("does not double-prefix an existing Re:", () => {
    const mime = buildMimeReply({ ...BASE, subject: "Re: 行程詢問" });
    const subjB64 = mime.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)![1];
    expect(Buffer.from(subjB64, "base64").toString("utf-8")).toBe("Re: 行程詢問");
  });
});

describe("buildMimeReply — with attachments", () => {
  const pdfBytes = Buffer.from("%PDF-1.7\n報價單內容\n%%EOF", "utf-8");

  it("builds multipart/mixed with a body part + one attachment part", () => {
    const mime = buildMimeReply({
      ...BASE,
      attachments: [{ filename: "報價單.pdf", mimeType: "application/pdf", content: pdfBytes }],
    });
    const boundary = boundaryOf(mime);
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"'); // body part
    expect(mime).toContain("Content-Type: application/pdf;"); // attachment part
    expect(mime).toContain("Content-Transfer-Encoding: base64");
    // closing boundary present
    expect(mime.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("RFC5987-encodes a Chinese filename and it round-trips", () => {
    const mime = buildMimeReply({
      ...BASE,
      attachments: [{ filename: "報價單.pdf", mimeType: "application/pdf", content: pdfBytes }],
    });
    const m = mime.match(/filename\*=UTF-8''([^\r\n]+)/);
    expect(m).not.toBeNull();
    expect(decodeURIComponent(m![1])).toBe("報價單.pdf");
    // ascii fallback present too (non-ascii collapsed)
    expect(mime).toMatch(/filename="[^"]*\.pdf"/);
  });

  it("attachment base64 decodes back to the exact input bytes", () => {
    const mime = buildMimeReply({
      ...BASE,
      attachments: [{ filename: "報價單.pdf", mimeType: "application/pdf", content: pdfBytes }],
    });
    expect(firstAttachmentBytes(mime).equals(pdfBytes)).toBe(true);
  });

  it("supports multiple attachments (N parts + closing boundary)", () => {
    const mime = buildMimeReply({
      ...BASE,
      attachments: [
        { filename: "報價單.pdf", mimeType: "application/pdf", content: pdfBytes },
        { filename: "行程表.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: Buffer.from([1, 2, 3]) },
      ],
    });
    const boundary = boundaryOf(mime);
    const attachmentParts = mime.split(`--${boundary}`).filter((p) =>
      /Content-Disposition: attachment/.test(p),
    );
    expect(attachmentParts).toHaveLength(2);
    expect(mime).toContain("spreadsheetml.sheet");
  });
});

describe("buildMimeReply — footer 跟客人語言相容(2026-07-01 英文客人事件)", () => {
  // 6/26 事故:自動回覆本文英文,footer 卻掛死中文「本訊息由 PACK&GO AI 助理
  // 自動回覆…」(還帶破折號)。a0a22c4 已把 footer 精簡成單行語言中立聯絡資訊
  // (客人也不該被告知是 AI 寫的,見 requirements.md 硬邊界)。這組測試鎖住:
  // footer 永遠語言中立 — 純英文信的 footer 不得出現任何中文字、不得有破折號。
  it("純英文 body → footer 無任何 CJK 字(英文客人永遠不會收到中文 footer)", () => {
    const enBody =
      "Hi Leslie,\n\nThanks for reaching out. We will get back to you within 1-2 business days.\n\nJeff Hsieh";
    const mime = buildMimeReply({ ...BASE, bodyText: enBody });
    // body 之後附加的部分(= footer)不得引入中文
    const afterBody = mime.slice(mime.indexOf(enBody) + enBody.length);
    expect(/[一-鿿]/.test(afterBody)).toBe(false);
    expect(afterBody).toContain("+1 (510) 634-2307");
  });

  it("footer 無破折號(em/en dash)、無 AI 揭露(兩語言都適用)", () => {
    const mime = buildMimeReply(BASE);
    const afterBody = mime.slice(mime.indexOf(BASE.bodyText) + BASE.bodyText.length);
    expect(afterBody).not.toMatch(/—|–/);
    expect(afterBody).not.toContain("AI");
    expect(afterBody).not.toContain("自動回覆");
  });
});
