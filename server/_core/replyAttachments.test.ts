/**
 * Tests for replyAttachments — the shared attachment resolver both reply
 * paths funnel through.
 *
 * Invariants under test:
 *   - mime whitelist + size cap reject at presign (prepareReplyAttachmentUpload).
 *   - encodedSize matches base64's 4-per-3 padding.
 *   - resolveReplyAttachments: small files ride inline (Chinese filename intact);
 *     a file over the Gmail ceiling, or cumulative overflow, spills to a link.
 *   - keys outside reply-attachments/ throw (an outbound email can't exfiltrate
 *     an arbitrary R2 object).
 *   - appendDownloadLinksToBody adds a plain-text section only when there are
 *     links, with no em-dash / markdown.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ALLOWED_ATTACHMENT_MIME,
  GMAIL_MAX_ENCODED_BYTES,
  MAX_REPLY_ATTACHMENT_BYTES,
  ReplyAttachmentError,
  appendDownloadLinksToBody,
  buildReplyAttachmentKey,
  encodedSize,
  isAllowedAttachmentMime,
  prepareReplyAttachmentUpload,
  resolveReplyAttachments,
} from "./replyAttachments";

describe("isAllowedAttachmentMime", () => {
  it("accepts the whitelist (pdf / xlsx / xls / png / jpeg / webp)", () => {
    for (const m of ALLOWED_ATTACHMENT_MIME) expect(isAllowedAttachmentMime(m)).toBe(true);
    expect(isAllowedAttachmentMime("application/pdf")).toBe(true);
    expect(isAllowedAttachmentMime("APPLICATION/PDF")).toBe(true); // case-insensitive
    expect(isAllowedAttachmentMime("  image/png  ")).toBe(true); // trimmed
  });

  it("rejects executables / html / unknown", () => {
    expect(isAllowedAttachmentMime("application/x-msdownload")).toBe(false);
    expect(isAllowedAttachmentMime("text/html")).toBe(false);
    expect(isAllowedAttachmentMime("application/octet-stream")).toBe(false);
  });
});

describe("encodedSize", () => {
  it("matches base64's 4-chars-per-3-bytes padding", () => {
    expect(encodedSize(0)).toBe(0);
    expect(encodedSize(1)).toBe(4);
    expect(encodedSize(3)).toBe(4);
    expect(encodedSize(4)).toBe(8);
    expect(encodedSize(6)).toBe(8);
    expect(encodedSize(100)).toBe(136);
  });
});

describe("buildReplyAttachmentKey", () => {
  it("namespaces under reply-attachments/<profileId>/ and ascii-sanitises the name", () => {
    const key = buildReplyAttachmentKey("7", "報價單.pdf");
    expect(key.startsWith("reply-attachments/7/")).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
    // the Chinese base collapses to an ascii-safe placeholder in the KEY only
    expect(key).toMatch(/^reply-attachments\/7\/\d+-[a-z0-9]+-.+\.pdf$/);
  });

  it("non-numeric scope degrades to guest", () => {
    const key = buildReplyAttachmentKey("../etc", "x.png");
    expect(key.startsWith("reply-attachments/guest/")).toBe(true);
  });
});

describe("prepareReplyAttachmentUpload", () => {
  it("rejects a non-whitelisted mimeType (never presigns)", async () => {
    const presign = vi.fn();
    await expect(
      prepareReplyAttachmentUpload(
        { filename: "x.exe", mimeType: "application/x-msdownload", size: 100 },
        { presign },
      ),
    ).rejects.toBeInstanceOf(ReplyAttachmentError);
    expect(presign).not.toHaveBeenCalled();
  });

  it("rejects an oversize file (never presigns)", async () => {
    const presign = vi.fn();
    await expect(
      prepareReplyAttachmentUpload(
        { filename: "big.pdf", mimeType: "application/pdf", size: MAX_REPLY_ATTACHMENT_BYTES + 1 },
        { presign },
      ),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(presign).not.toHaveBeenCalled();
  });

  it("valid → presigns under the profile scope, returns the raw Chinese filename", async () => {
    const presign = vi
      .fn()
      .mockImplementation(async (key: string) => ({ key, putUrl: "https://r2/put?sig=1" }));
    const res = await prepareReplyAttachmentUpload(
      { filename: "報價單.pdf", mimeType: "application/pdf", size: 200_000, profileId: 7 },
      { presign },
    );
    expect(presign).toHaveBeenCalledTimes(1);
    const [keyArg, mimeArg] = presign.mock.calls[0];
    expect(keyArg.startsWith("reply-attachments/7/")).toBe(true);
    expect(mimeArg).toBe("application/pdf");
    expect(res.putUrl).toBe("https://r2/put?sig=1");
    expect(res.filename).toBe("報價單.pdf"); // raw name preserved for the email
  });

  it("no profileId → guest scope", async () => {
    const presign = vi.fn().mockResolvedValue({ key: "k", putUrl: "u" });
    await prepareReplyAttachmentUpload(
      { filename: "a.png", mimeType: "image/png", size: 10 },
      { presign },
    );
    expect(presign.mock.calls[0][0].startsWith("reply-attachments/guest/")).toBe(true);
  });
});

describe("resolveReplyAttachments", () => {
  const small = Buffer.alloc(1024, 1);

  it("small files ride inline; Chinese filename + mimeType preserved", async () => {
    const getBytes = vi.fn(async () => ({
      bytes: small,
      mimeType: "application/pdf",
      contentLength: small.length,
    }));
    const makeLink = vi.fn();
    const res = await resolveReplyAttachments(
      [
        { key: "reply-attachments/7/a-報價.pdf", filename: "報價單.pdf" },
        { key: "reply-attachments/7/b-行程.pdf", filename: "行程表.pdf" },
      ],
      { getBytes, makeLink },
    );
    expect(res.links).toHaveLength(0);
    expect(res.inline.map((a) => a.filename)).toEqual(["報價單.pdf", "行程表.pdf"]);
    expect(res.inline[0].content).toBe(small);
    expect(res.inline[0].mimeType).toBe("application/pdf");
    expect(makeLink).not.toHaveBeenCalled();
  });

  it("a single file over the Gmail ceiling becomes a download link", async () => {
    // 20MB raw → ~26.7MB encoded > 25MB ceiling
    const huge = Buffer.alloc(20 * 1024 * 1024, 7);
    const getBytes = vi.fn(async () => ({
      bytes: huge,
      mimeType: "application/pdf",
      contentLength: huge.length,
    }));
    const makeLink = vi.fn(async () => "https://r2/secure?sig=abc");
    const res = await resolveReplyAttachments(
      [{ key: "reply-attachments/guest/big.pdf", filename: "大檔案.pdf" }],
      { getBytes, makeLink },
    );
    expect(res.inline).toHaveLength(0);
    expect(res.links).toEqual([{ filename: "大檔案.pdf", url: "https://r2/secure?sig=abc" }]);
    expect(makeLink).toHaveBeenCalledWith("reply-attachments/guest/big.pdf");
  });

  it("cumulative overflow: the file that tips it past 25MB spills to a link, earlier ones stay inline", async () => {
    const big = Buffer.alloc(15 * 1024 * 1024, 1); // ~20MB encoded each
    const getBytes = vi.fn(async (key: string) => ({
      bytes: big,
      mimeType: "application/pdf",
      contentLength: big.length,
    }));
    const makeLink = vi.fn(async (key: string) => `https://r2/${key}`);
    const res = await resolveReplyAttachments(
      [
        { key: "reply-attachments/7/one.pdf", filename: "一.pdf" },
        { key: "reply-attachments/7/two.pdf", filename: "二.pdf" }, // 40MB encoded total → over
      ],
      { getBytes, makeLink },
    );
    expect(res.inline.map((a) => a.filename)).toEqual(["一.pdf"]);
    expect(res.links.map((l) => l.filename)).toEqual(["二.pdf"]);
    expect(encodedSize(big.length)).toBeLessThan(GMAIL_MAX_ENCODED_BYTES); // each alone fits
  });

  it("throws on a key outside the reply-attachments/ namespace", async () => {
    const getBytes = vi.fn();
    const makeLink = vi.fn();
    await expect(
      resolveReplyAttachments(
        [{ key: "customerDocuments/55/passport.jpg", filename: "passport.jpg" }],
        { getBytes, makeLink },
      ),
    ).rejects.toThrow(/out of namespace/);
    expect(getBytes).not.toHaveBeenCalled();
  });
});

describe("appendDownloadLinksToBody", () => {
  it("no links → body unchanged", () => {
    expect(appendDownloadLinksToBody("您好", [])).toBe("您好");
  });

  it("appends a plain-text section (no em-dash, no markdown)", () => {
    const out = appendDownloadLinksToBody("您好,附件如下。", [
      { filename: "報價單.pdf", url: "https://r2/x" },
    ]);
    expect(out).toContain("您好,附件如下。");
    expect(out).toContain("下載連結");
    expect(out).toContain("報價單.pdf: https://r2/x");
    expect(out).not.toContain("—"); // em-dash forbidden
    expect(out).not.toContain("**");
  });
});
