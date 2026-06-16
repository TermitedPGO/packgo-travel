/**
 * Tests for the reply-attachments storage helpers added 2026-06-15:
 *   - storageGetBytes  → reads R2 object bytes + content type via the SDK v3
 *     streaming Body helper.
 *   - storageCreatePresignedPut → presigns a PUT with the ContentType baked in.
 *
 * The AWS SDK client + presigner + env are mocked so the test exercises our
 * logic, not network/R2. imageOptimizer is mocked to keep sharp out of the
 * test process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above all top-level consts, so shared mock fns must be
// declared in vi.hoisted() to dodge the temporal-dead-zone reference error.
const { sendMock, getSignedUrlMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: sendMock })),
  // Commands just capture their input so we can assert on it.
  GetObjectCommand: vi.fn((input) => ({ __type: "GetObject", input })),
  PutObjectCommand: vi.fn((input) => ({ __type: "PutObject", input })),
  DeleteObjectCommand: vi.fn((input) => ({ __type: "DeleteObject", input })),
  DeleteObjectsCommand: vi.fn((input) => ({ __type: "DeleteObjects", input })),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

vi.mock("./_core/env", () => ({
  ENV: {
    r2AccessKeyId: "ak",
    r2SecretAccessKey: "sk",
    r2Endpoint: "https://acct.r2.cloudflarestorage.com",
    r2Bucket: "packgo",
    r2PublicBaseUrl: "",
  },
}));

// Keep sharp out of the test process.
vi.mock("./imageOptimizer", () => ({
  optimizeImage: vi.fn(),
  generateStorageKeys: vi.fn(),
  getMimeType: vi.fn(),
}));

import {
  storageGetBytes,
  storageCreatePresignedPut,
} from "./storage";
import { PutObjectCommand } from "@aws-sdk/client-s3";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storageGetBytes", () => {
  it("returns bytes + mimeType + contentLength from the R2 object", async () => {
    const payload = Buffer.from("hello pdf bytes", "utf-8");
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(payload) },
      ContentType: "application/pdf",
      ContentLength: payload.length,
    });

    const res = await storageGetBytes("reply-attachments/7/q.pdf");
    expect(res.bytes.equals(payload)).toBe(true);
    expect(res.mimeType).toBe("application/pdf");
    expect(res.contentLength).toBe(payload.length);
  });

  it("falls back to octet-stream + buffer length when headers are absent", async () => {
    const payload = Buffer.from([1, 2, 3, 4]);
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(payload) },
    });
    const res = await storageGetBytes("reply-attachments/guest/x");
    expect(res.mimeType).toBe("application/octet-stream");
    expect(res.contentLength).toBe(4);
  });

  it("throws when the object has no body", async () => {
    sendMock.mockResolvedValue({ Body: undefined });
    await expect(storageGetBytes("reply-attachments/7/missing")).rejects.toThrow(
      /empty body/,
    );
  });
});

describe("storageCreatePresignedPut", () => {
  it("presigns a PUT with the ContentType baked into the command", async () => {
    getSignedUrlMock.mockResolvedValue("https://r2/put?sig=xyz");
    const res = await storageCreatePresignedPut(
      "reply-attachments/7/q.pdf",
      "application/pdf",
    );
    expect(res).toEqual({ key: "reply-attachments/7/q.pdf", putUrl: "https://r2/put?sig=xyz" });
    // the signed command carried the bucket/key/contentType
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "packgo",
      Key: "reply-attachments/7/q.pdf",
      ContentType: "application/pdf",
    });
    // default TTL passed to getSignedUrl
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ __type: "PutObject" }),
      { expiresIn: 300 },
    );
  });

  it("normalises a leading slash off the key", async () => {
    getSignedUrlMock.mockResolvedValue("u");
    const res = await storageCreatePresignedPut("/reply-attachments/7/a.png", "image/png");
    expect(res.key).toBe("reply-attachments/7/a.png");
  });
});
