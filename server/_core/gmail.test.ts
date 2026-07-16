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
// Inline-attachment tests route real bytes through the real attachmentParser;
// only the LLM vision layer is mocked (never call a model from unit tests).
vi.mock("./imageOcr", () => ({
  extractImageText: vi.fn(async () => ({ ok: true, text: "夏威夷海報文字 mock OCR" })),
  extractPdfText: vi.fn(async () => ({ ok: false, text: "" })),
}));

import {
  buildMimeReply,
  parseRfcMessageId,
  resolveDirection,
  listMessagesByIds,
  buildHydrationFailureSentinels,
  fetchRawAttachments,
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

// ──────────────────────────────────────────────────────────────────────
// Attachment existence evidence (Codex 14:07 P1-3, pdf-attachment-
// reliability): a whole-hydration failure or a per-message cap overflow
// must NEVER read as "no attachments" — the reply gate needs sentinels.
// ──────────────────────────────────────────────────────────────────────

describe("attachment existence evidence (Codex 14:07 P1-3)", () => {
  const b64url = (s: string) =>
    Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const attPart = (i: number) => ({
    filename: `file${i}.txt`,
    mimeType: "text/plain",
    body: { attachmentId: `att${i}`, size: 11 },
  });
  const buildFakeGmail = (payload: unknown) =>
    ({
      users: {
        messages: {
          get: vi.fn().mockResolvedValue({
            data: {
              id: "m1",
              threadId: "t1",
              labelIds: ["INBOX"],
              internalDate: "1750000000000",
              snippet: "",
              payload,
            },
          }),
          attachments: {
            get: vi.fn().mockResolvedValue({ data: { data: b64url("hello world") } }),
          },
        },
      },
    }) as any;

  it("6th+ attachment over the 5-cap becomes a not_processed sentinel, not a silent drop", async () => {
    const payload = {
      parts: [
        { mimeType: "text/plain", body: { data: b64url("body text") } },
        attPart(1),
        attPart(2),
        attPart(3),
        attPart(4),
        attPart(5),
        attPart(6),
      ],
    };
    const [msg] = await listMessagesByIds(buildFakeGmail(payload), ["m1"]);
    expect(msg.attachments).toHaveLength(6);
    expect(msg.attachments.filter((a) => a.parseStatus === "ok")).toHaveLength(5);
    const sentinel = msg.attachments[5];
    expect(sentinel.parseStatus).toBe("not_processed");
    expect(sentinel.filename).toBe("file6.txt");
    expect(sentinel.text).toBe("");
    expect(sentinel.parseError).toContain("cap");
  });

  it("whole-hydration failure yields fail-closed sentinels instead of attachments=[]", async () => {
    // A part whose property access throws makes the entire
    // fetchAndParseAttachments call die — the old code left attachments=[]
    // and the reply gate treated the email as attachment-free. (The trap
    // sits on `filename` — the identity field every walk must touch.)
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, "filename", {
      get() {
        throw new Error("boom hydration");
      },
      enumerable: true,
    });
    const payload = { parts: [evil] };
    const [msg] = await listMessagesByIds(buildFakeGmail(payload), ["m1"]);
    expect(msg.attachments.length).toBeGreaterThan(0);
    expect(msg.attachments.every((a) => a.parseStatus === "not_processed")).toBe(true);
  });

  it("buildHydrationFailureSentinels lists real filenames when the payload walk succeeds", () => {
    const payload = { parts: [attPart(1), attPart(2)] };
    const s = buildHydrationFailureSentinels(payload, new Error("import died"));
    expect(s).toHaveLength(2);
    expect(s[0].filename).toBe("file1.txt");
    expect(s.every((x) => x.parseStatus === "not_processed")).toBe(true);
    expect(s[0].parseError).toContain("import died");
    expect(s.every((x) => x.text === "")).toBe(true);
  });

  it("buildHydrationFailureSentinels falls back to one generic sentinel when even the walk fails", () => {
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, "filename", {
      get() {
        throw new Error("walker boom");
      },
      enumerable: true,
    });
    const s = buildHydrationFailureSentinels({ parts: [evil] }, new Error("orig"));
    expect(s).toHaveLength(1);
    expect(s[0].parseStatus).toBe("not_processed");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Inline body.data attachments (Codex 16:02 P1-1): Gmail puts small
// attachments' full content directly in body.data (no attachmentId).
// The old collector dropped them → attachments=[] → the reply gate and
// auto-send gate treated the email as attachment-free. Real bytes, real
// parser; only imageOcr (LLM) is mocked at module top.
// ──────────────────────────────────────────────────────────────────────

describe("inline body.data attachments (Codex 16:02 P1-1)", () => {
  const b64url = (buf: Buffer | string) =>
    (Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf-8"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const idPart = (i: number) => ({
    filename: `byid${i}.txt`,
    mimeType: "text/plain",
    body: { attachmentId: `att${i}`, size: 11 },
  });
  const inlinePart = (filename: string, mimeType: string, bytes: Buffer | string) => ({
    filename,
    mimeType,
    body: { data: b64url(bytes), size: Buffer.isBuffer(bytes) ? bytes.length : bytes.length },
  });
  const fakeGmail = (payload: unknown) =>
    ({
      users: {
        messages: {
          get: vi.fn().mockResolvedValue({
            data: {
              id: "m2",
              threadId: "t2",
              labelIds: ["INBOX"],
              internalDate: "1750000000000",
              snippet: "hello",
              payload,
            },
          }),
          attachments: {
            get: vi.fn().mockResolvedValue({ data: { data: b64url("hello world") } }),
          },
        },
      },
    }) as any;

  it("inline small.pdf (no attachmentId) is parsed with the REAL pdf pipeline — never an empty array", async () => {
    const { buildItineraryPdf } = await import("./pdfTestFixture");
    const payload = {
      parts: [
        { mimeType: "text/plain", body: { data: b64url("body text") } },
        inlinePart("small.pdf", "application/pdf", buildItineraryPdf()),
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m2"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("small.pdf");
    expect(msg.attachments[0].parseStatus).toBe("ok");
    expect(msg.attachments[0].text).toContain("PACKGO PARSER FIXTURE");
  });

  it("inline image goes through vision OCR like any other image attachment", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload = { parts: [inlinePart("poster.png", "image/png", png)] };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m2"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].parseStatus).toBe("ok");
    expect(msg.attachments[0].text).toContain("mock OCR");
  });

  it("mixed attachmentId + inline parts share the 5-cap; overflow keeps not_processed sentinels", async () => {
    const payload = {
      parts: [
        idPart(1),
        idPart(2),
        idPart(3),
        inlinePart("in1.txt", "text/plain", "inline one content"),
        inlinePart("in2.txt", "text/plain", "inline two content"),
        inlinePart("in3.txt", "text/plain", "inline three content"),
        idPart(4),
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m2"]);
    expect(msg.attachments).toHaveLength(7);
    expect(msg.attachments.filter((a) => a.parseStatus === "ok")).toHaveLength(5);
    const sentinels = msg.attachments.filter((a) => a.parseStatus === "not_processed");
    expect(sentinels.map((s) => s.filename)).toEqual(["in3.txt", "byid4.txt"]);
  });

  it("hydration-failure sentinels list inline parts too", () => {
    const evilInline = inlinePart("in.pdf", "application/pdf", "x");
    const s = buildHydrationFailureSentinels(
      { parts: [idPart(1), evilInline] },
      new Error("hydration died"),
    );
    expect(s.map((x) => x.filename)).toEqual(["byid1.txt", "in.pdf"]);
    expect(s.every((x) => x.parseStatus === "not_processed")).toBe(true);
  });

  it("nameless attachmentId part ('noname' attachment, Content-Disposition: attachment) is still collected — never attachment-free (batch-3 adversarial)", async () => {
    const payload = {
      parts: [
        { mimeType: "text/plain", body: { data: b64url("body") } },
        // Content-Disposition: attachment without a filename param —
        // Gmail stores it with an attachmentId but filename "". The
        // disposition header IS the identity (Codex 17:40 P1-1).
        {
          filename: "",
          mimeType: "application/pdf",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { attachmentId: "att-x", size: 99 },
        },
      ],
    };
    const gmail = fakeGmail(payload);
    const { buildItineraryPdf } = await import("./pdfTestFixture");
    gmail.users.messages.attachments.get.mockResolvedValue({
      data: { data: b64url(buildItineraryPdf()) },
    });
    const [msg] = await listMessagesByIds(gmail, ["m2"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toContain("未命名附件");
    expect(msg.attachments[0].parseStatus).toBe("ok");
  });

  it("nameless inline application/pdf with attachment disposition is collected; nameless text/calendar is NOT (invite furniture, even with attachment disposition)", async () => {
    const { buildItineraryPdf } = await import("./pdfTestFixture");
    const payload = {
      parts: [
        {
          filename: "",
          mimeType: "application/pdf",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { data: b64url(buildItineraryPdf()), size: 500 },
        },
        {
          filename: "",
          mimeType: "text/calendar",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { data: b64url("BEGIN:VCALENDAR"), size: 20 },
        },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m2"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].mimeType).toBe("application/pdf");
    expect(msg.attachments[0].parseStatus).toBe("ok");
  });

  it("fetchRawAttachments returns inline bytes for the receipt path", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4 tiny receipt fixture bytes", "latin1");
    const payload = { parts: [inlinePart("receipt.pdf", "application/pdf", pdfBytes)] };
    const raws = await fetchRawAttachments(fakeGmail(payload), "m2");
    expect(raws).toHaveLength(1);
    expect(raws[0].filename).toBe("receipt.pdf");
    expect(raws[0].bytes.equals(pdfBytes)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Attachment IDENTITY vs bytes LOCATION (Codex 17:40 P1-1): identity =
// non-empty filename OR Content-Disposition: attachment; attachmentId only
// says where the bytes live. The old collector both LOST attachments
// (named zero-byte → vanished → reply gate no-ops) and INVENTED them
// (externalized text/plain body → "attachment"). These fixtures are the
// real MIME shapes from the adversarial replay.
// ──────────────────────────────────────────────────────────────────────

describe("attachment identity vs bytes location (Codex 17:40 P1-1)", () => {
  const b64url = (s: Buffer | string) =>
    (Buffer.isBuffer(s) ? s : Buffer.from(s, "utf-8"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const fakeGmail = (payload: unknown) =>
    ({
      users: {
        messages: {
          get: vi.fn().mockResolvedValue({
            data: {
              id: "m3",
              threadId: "t3",
              labelIds: ["INBOX"],
              internalDate: "1750000000000",
              snippet: "",
              payload,
            },
          }),
          attachments: {
            get: vi.fn().mockResolvedValue({ data: { data: b64url("attached text bytes") } }),
          },
        },
      },
    }) as any;

  it("named zero-byte attachment (data:'', size 0) keeps its existence — parseStatus 'empty', never attachments=[]", async () => {
    const payload = {
      parts: [
        { mimeType: "text/plain", body: { data: b64url("body text") } },
        { filename: "a.pdf", mimeType: "application/pdf", body: { data: "", size: 0 } },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m3"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("a.pdf");
    expect(msg.attachments[0].parseStatus).toBe("empty");
  });

  it("named attachment with NO bytes anywhere (no attachmentId, no data) still yields an 'empty' ref", async () => {
    const payload = {
      parts: [{ filename: "ghost.pdf", mimeType: "application/pdf", body: { size: 0 } }],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m3"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].parseStatus).toBe("empty");
  });

  it("nameless Content-Disposition: attachment octet/text parts ARE collected (real 'noname' attachments)", async () => {
    const payload = {
      parts: [
        {
          filename: "",
          mimeType: "application/octet-stream",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { attachmentId: "att-oct", size: 19 },
        },
        {
          filename: "",
          mimeType: "text/plain",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { attachmentId: "att-txt", size: 19 },
        },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m3"]);
    expect(msg.attachments).toHaveLength(2);
    expect(msg.attachments.every((a) => a.filename.includes("未命名附件"))).toBe(true);
  });

  it("externalized text/plain BODY (attachmentId, nameless, no disposition) is NOT an attachment", async () => {
    const payload = {
      parts: [
        // Large message bodies get externalized: bytes behind an
        // attachmentId even though the part is the email's own body.
        { filename: "", mimeType: "text/plain", body: { attachmentId: "body-ext", size: 90000 } },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m3"]);
    expect(msg.attachments).toHaveLength(0);
  });

  it("nameless CID inline logo (Content-Disposition: inline) is NOT an attachment", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const payload = {
      parts: [
        {
          filename: "",
          mimeType: "image/png",
          headers: [
            { name: "Content-ID", value: "<logo@corp>" },
            { name: "Content-Disposition", value: "inline" },
          ],
          body: { data: b64url(png), size: png.length },
        },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m3"]);
    expect(msg.attachments).toHaveLength(0);
  });

  it("nameless protocol parts (pkcs7 signature) stay out even with an attachment disposition; a NAMED .ics is collected", async () => {
    const payload = {
      parts: [
        {
          filename: "",
          mimeType: "application/pkcs7-signature",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { attachmentId: "att-sig", size: 256 },
        },
        {
          filename: "invite.ics",
          mimeType: "text/calendar",
          body: { attachmentId: "att-ics", size: 40 },
        },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m3"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("invite.ics");
  });

  it("header name/value casing does not matter: CONTENT-DISPOSITION: ATTACHMENT collects", async () => {
    const payload = {
      parts: [
        {
          filename: "",
          mimeType: "text/plain",
          headers: [{ name: "CONTENT-DISPOSITION", value: "ATTACHMENT; FILENAME=x" }],
          body: { attachmentId: "att-case", size: 19 },
        },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m3"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toContain("未命名附件");
  });
});

// red-team v4 collector edge shapes (adversarially verified findings)
describe("collector edge shapes (red-team v4)", () => {
  const b64url = (s: Buffer | string) =>
    (Buffer.isBuffer(s) ? s : Buffer.from(s, "utf-8"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const fakeGmail = (payload: unknown) =>
    ({
      users: {
        messages: {
          get: vi.fn().mockResolvedValue({
            data: { id: "m4", threadId: "t4", labelIds: ["INBOX"], internalDate: "1750000000000", snippet: "", payload },
          }),
          attachments: {
            get: vi.fn().mockResolvedValue({ data: { data: b64url("attached bytes") } }),
          },
        },
      },
    }) as any;

  it("quoted disposition token ('\"attachment\"; …' from buggy mailers) still counts as identity", async () => {
    const payload = {
      parts: [
        {
          filename: "",
          mimeType: "application/pdf",
          headers: [{ name: "Content-Disposition", value: '"attachment"; filename="quote.pdf"' }],
          body: { attachmentId: "att-q", size: 900 },
        },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m4"]);
    expect(msg.attachments).toHaveLength(1);
  });

  it("whitespace-only filename (sender-set name='   ') is identity — existence preserved with fallback display name", async () => {
    const payload = {
      parts: [
        { filename: "   ", mimeType: "application/pdf", body: { attachmentId: "att-ws", size: 55000 } },
        // control: filename "" (Gmail's non-attachment marker) with no CD stays out
        { filename: "", mimeType: "text/plain", body: { attachmentId: "body-ext2", size: 90000 } },
      ],
    };
    const [msg] = await listMessagesByIds(fakeGmail(payload), ["m4"]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toContain("未命名附件");
  });
});
