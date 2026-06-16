import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./llm", () => ({ invokeLLM: vi.fn() }));

import { invokeLLM } from "./llm";
import sharp from "sharp";
import {
  detectReceipt,
  parseReceiptResponse,
  pickReceiptAttachment,
  extractReceipt,
} from "./receiptExtractor";

const invokeLLMMock = vi.mocked(invokeLLM);
const visionResponse = (content: string) =>
  ({ choices: [{ message: { content } }] }) as unknown as Awaited<ReturnType<typeof invokeLLM>>;

// ── detectReceipt (pure rules gate) ─────────────────────────────────────────
describe("detectReceipt", () => {
  const pdf = { filename: "invoice_2026.pdf", mimeType: "application/pdf", kind: "pdf" };
  const img = { filename: "receipt.jpg", mimeType: "image/jpeg", kind: "image" };
  const docx = { filename: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

  it("PDF attachment + keyword in subject → receipt", () => {
    const r = detectReceipt({ subject: "Invoice #221 from 金宥旅行社", body: "請查收", attachments: [pdf] });
    expect(r.isReceipt).toBe(true);
  });

  it("image attachment + 發票 keyword in body → receipt", () => {
    const r = detectReceipt({ subject: "您好", body: "附上本次團費發票一張", attachments: [img] });
    expect(r.isReceipt).toBe(true);
  });

  it("keyword only in attachment filename still counts", () => {
    const r = detectReceipt({ subject: "hi", body: "see attached", attachments: [{ filename: "RECEIPT-9912.pdf", mimeType: "application/pdf" }] });
    expect(r.isReceipt).toBe(true);
  });

  it("no attachment → not a receipt (phase 1 needs the file)", () => {
    const r = detectReceipt({ subject: "Your invoice is ready", body: "total due 500", attachments: [] });
    expect(r.isReceipt).toBe(false);
    expect(r.reason).toBe("no-pdf-or-image-attachment");
  });

  it("attachment but no receipt keyword → not a receipt", () => {
    // neutral filename too — "確認" alone isn't a keyword; itinerary PDFs shouldn't trip it.
    const r = detectReceipt({
      subject: "團體行程確認",
      body: "這是行程表",
      attachments: [{ filename: "itinerary.pdf", mimeType: "application/pdf", kind: "pdf" }],
    });
    expect(r.isReceipt).toBe(false);
    expect(r.reason).toBe("no-receipt-keyword");
  });

  it("non-pdf/image attachment (docx) with keyword → not a receipt", () => {
    const r = detectReceipt({ subject: "invoice attached", body: "", attachments: [docx] });
    expect(r.isReceipt).toBe(false);
  });
});

// ── pickReceiptAttachment ───────────────────────────────────────────────────
describe("pickReceiptAttachment", () => {
  it("prefers PDF over image", () => {
    const picked = pickReceiptAttachment([
      { filename: "logo.png", mimeType: "image/png" },
      { filename: "invoice.pdf", mimeType: "application/pdf" },
    ]);
    expect(picked?.filename).toBe("invoice.pdf");
  });

  it("falls back to image when no PDF", () => {
    const picked = pickReceiptAttachment([{ filename: "receipt.jpeg", mimeType: "image/jpeg" }]);
    expect(picked?.filename).toBe("receipt.jpeg");
  });

  it("returns null when nothing usable", () => {
    expect(pickReceiptAttachment([])).toBeNull();
  });
});

// ── parseReceiptResponse (pure — the money-accuracy unit) ────────────────────
describe("parseReceiptResponse — real-receipt-shaped model outputs", () => {
  it("clean supplier invoice (numbers) → all fields, not flagged", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: true,
      vendor: "金宥旅行社 KIM YOU TRAVEL",
      amount: 4850.0,
      currency: "USD",
      date: "2026-06-10",
      description: "日本關西 5 日團 訂金 x2 人",
      confidence: 96,
    }));
    expect(r.vendor).toBe("金宥旅行社 KIM YOU TRAVEL");
    expect(r.amount).toBe(4850);
    expect(r.currency).toBe("USD");
    expect(r.receiptDate).toBe("2026-06-10");
    expect(r.needsReview).toBe(false);
  });

  it("amount as string with $ and thousands comma → parsed number", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: true, vendor: "Trip.com", amount: "$1,234.56", currency: "USD",
      date: "2026/05/22", description: "Hotel 2 nights", confidence: 90,
    }));
    expect(r.amount).toBe(1234.56);
    expect(r.receiptDate).toBe("2026-05-22"); // slash form normalized
    expect(r.needsReview).toBe(false);
  });

  it("TWD invoice with NT$ prefix → number + TWD", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: true, vendor: "雄獅旅遊", amount: "NT$ 45,000", currency: "TWD",
      date: "2026-04-01", description: "歐洲團 尾款", confidence: 88,
    }));
    expect(r.amount).toBe(45000);
    expect(r.currency).toBe("TWD");
    expect(r.needsReview).toBe(false);
  });

  it("JPY integer amount", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: true, vendor: "地接社 Osaka DMC", amount: 88000, currency: "jpy",
      date: "2026-06-01", description: "巴士 + 導遊 3 天", confidence: 92,
    }));
    expect(r.amount).toBe(88000);
    expect(r.currency).toBe("JPY"); // upper-cased
    expect(r.needsReview).toBe(false);
  });

  it("missing amount → needsReview (do not guess)", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: true, vendor: "Some Vendor", amount: null, currency: "USD",
      date: "2026-06-10", description: "blurry total", confidence: 70,
    }));
    expect(r.amount).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it("missing/ambiguous currency → needsReview", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: true, vendor: "Cafe", amount: 25.5, currency: null,
      date: "2026-06-10", description: "lunch", confidence: 85,
    }));
    expect(r.currency).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it("currency that isn't a 3-letter code is rejected (no symbol guessing)", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: true, vendor: "Shop", amount: 10, currency: "$",
      date: "2026-06-10", description: "x", confidence: 80,
    }));
    expect(r.currency).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it("is_receipt false → needsReview", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: false, vendor: null, amount: null, currency: null,
      date: null, description: "this is a newsletter", confidence: 95,
    }));
    expect(r.isReceipt).toBe(false);
    expect(r.needsReview).toBe(true);
  });

  it("low confidence below threshold → needsReview even if fields present", () => {
    const r = parseReceiptResponse(JSON.stringify({
      is_receipt: true, vendor: "V", amount: 100, currency: "USD",
      date: "2026-06-10", description: "x", confidence: 40,
    }));
    expect(r.needsReview).toBe(true);
  });

  it("tolerates ```json fences / surrounding prose", () => {
    const r = parseReceiptResponse(
      "Here is the data:\n```json\n" +
      JSON.stringify({ is_receipt: true, vendor: " V", amount: 12.3, currency: "EUR", date: "2026-06-10", description: "x", confidence: 99 }) +
      "\n```\nDone.",
    );
    expect(r.amount).toBe(12.3);
    expect(r.currency).toBe("EUR");
    expect(r.needsReview).toBe(false);
  });

  it("garbage / non-JSON → safe fallback, needsReview, amount null", () => {
    const r = parseReceiptResponse("I could not read the attachment, sorry.");
    expect(r.amount).toBeNull();
    expect(r.vendor).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it("empty string → fallback", () => {
    const r = parseReceiptResponse("");
    expect(r.needsReview).toBe(true);
    expect(r.amount).toBeNull();
  });

  it("confidence is clamped to 0..100", () => {
    const hi = parseReceiptResponse(JSON.stringify({ is_receipt: true, vendor: "V", amount: 1, currency: "USD", date: "2026-06-10", description: "x", confidence: 150 }));
    expect(hi.confidence).toBe(100);
    const lo = parseReceiptResponse(JSON.stringify({ is_receipt: true, vendor: "V", amount: 1, currency: "USD", date: "2026-06-10", description: "x", confidence: -5 }));
    expect(lo.confidence).toBe(0);
  });

  it("zero/negative amount is rejected (not a real expense)", () => {
    const z = parseReceiptResponse(JSON.stringify({ is_receipt: true, vendor: "V", amount: 0, currency: "USD", date: "2026-06-10", description: "x", confidence: 90 }));
    expect(z.amount).toBeNull();
    expect(z.needsReview).toBe(true);
  });

  it("placeholder strings (N/A, 未知) treated as null", () => {
    const r = parseReceiptResponse(JSON.stringify({ is_receipt: true, vendor: "未知", amount: 50, currency: "USD", date: "2026-06-10", description: "N/A", confidence: 80 }));
    expect(r.vendor).toBeNull();
    expect(r.description).toBeNull();
    expect(r.needsReview).toBe(true); // vendor null
  });
});

// ── extractReceipt (LLM mocked) ─────────────────────────────────────────────
describe("extractReceipt", () => {
  beforeEach(() => invokeLLMMock.mockReset());

  it("PDF path: reads fields + sends a PDF document block (no sharp)", async () => {
    invokeLLMMock.mockResolvedValueOnce(visionResponse(JSON.stringify({
      is_receipt: true, vendor: "金宥旅行社", amount: 4850, currency: "USD",
      date: "2026-06-10", description: "日本團訂金", confidence: 95,
    })));
    const r = await extractReceipt({
      subject: "Invoice", from: "billing@kimyou.com", body: "請查收",
      attachments: [{ filename: "invoice.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4 fake") }],
    });
    expect(r.amount).toBe(4850);
    expect(r.needsReview).toBe(false);
    const call = invokeLLMMock.mock.calls[0][0] as { messages: { role: string; content: unknown }[] };
    // user message is messages[1] (messages[0] is the system prompt)
    const content = call.messages[1].content as Array<{ type: string; file_url?: { mime_type: string } }>;
    expect(content.find((p) => p.type === "file_url")?.file_url?.mime_type).toBe("application/pdf");
  });

  it("image path: downscales via sharp + sends image_url block", async () => {
    invokeLLMMock.mockResolvedValueOnce(visionResponse(JSON.stringify({
      is_receipt: true, vendor: "Cafe Roma", amount: 18.9, currency: "USD",
      date: "2026-06-12", description: "lunch", confidence: 91,
    })));
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 220, g: 220, b: 220 } } }).png().toBuffer();
    const r = await extractReceipt({
      subject: "receipt", from: "x@cafe.com", body: "",
      attachments: [{ filename: "receipt.png", mimeType: "image/png", bytes: png }],
    });
    expect(r.amount).toBe(18.9);
    const call = invokeLLMMock.mock.calls[0][0] as { messages: { content: unknown }[] };
    const content = call.messages[1].content as Array<{ type: string }>;
    expect(content.some((p) => p.type === "image_url")).toBe(true);
  });

  it("no usable attachment → needsReview, no LLM call", async () => {
    const r = await extractReceipt({ subject: "x", from: "a@b.com", body: "", attachments: [] });
    expect(r.needsReview).toBe(true);
    expect(invokeLLMMock).not.toHaveBeenCalled();
  });

  it("vision call throws → needsReview (never throws to caller)", async () => {
    invokeLLMMock.mockRejectedValueOnce(new Error("model 529 overloaded"));
    const r = await extractReceipt({
      subject: "Invoice", from: "x@y.com", body: "",
      attachments: [{ filename: "invoice.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF fake") }],
    });
    expect(r.needsReview).toBe(true);
    expect(r.amount).toBeNull();
  });

  it("corrupt image (sharp can't decode) → needsReview, no LLM call", async () => {
    const r = await extractReceipt({
      subject: "receipt", from: "x@y.com", body: "",
      attachments: [{ filename: "broken.png", mimeType: "image/png", bytes: Buffer.from("not an image") }],
    });
    expect(r.needsReview).toBe(true);
    expect(invokeLLMMock).not.toHaveBeenCalled();
  });
});
