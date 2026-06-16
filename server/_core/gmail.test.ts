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

import { buildMimeReply, type SendReplyInput } from "./gmail";

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

describe("buildMimeReply — no attachments (regression)", () => {
  it("is a single text/plain part, no multipart", () => {
    const mime = buildMimeReply(BASE);
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).not.toContain("multipart/mixed");
    expect(mime).toContain("Content-Transfer-Encoding: 8bit");
    expect(mime).toContain("Jenny 您好,報價如附件。");
    // disclaimer still appended
    expect(mime).toContain("PACK&GO AI 助理");
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
