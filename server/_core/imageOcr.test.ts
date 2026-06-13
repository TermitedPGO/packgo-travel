import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./llm", () => ({ invokeLLM: vi.fn() }));

import { invokeLLM } from "./llm";
import { extractImageText } from "./imageOcr";
import sharp from "sharp";

const invokeLLMMock = vi.mocked(invokeLLM);

/** A real (tiny) PNG so sharp decodes it and we reach the vision call. */
async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

const visionResponse = (content: string) =>
  ({ choices: [{ message: { content } }] }) as unknown as Awaited<ReturnType<typeof invokeLLM>>;

describe("extractImageText", () => {
  beforeEach(() => invokeLLMMock.mockReset());

  it("ok path: returns the vision-extracted text", async () => {
    invokeLLMMock.mockResolvedValueOnce(
      visionResponse("夏威夷 6 天精選團\n第一天:歐胡島市區\n起價 USD 1580"),
    );
    const r = await extractImageText(await tinyPng(), "poster.png");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("夏威夷");
    expect(r.text).toContain("USD 1580");
    expect(invokeLLMMock).toHaveBeenCalledTimes(1);
    // it sent an image_url block (vision), not just text
    const call = invokeLLMMock.mock.calls[0][0] as { messages: { content: unknown }[] };
    const content = call.messages[0].content as Array<{ type: string }>;
    expect(content.some((p) => p.type === "image_url")).toBe(true);
  });

  it("empty image: model says 無可辨識內容 → ok:false", async () => {
    invokeLLMMock.mockResolvedValueOnce(visionResponse("圖片無可辨識內容"));
    const r = await extractImageText(await tinyPng(), "blank.png");
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
  });

  it("corrupt image: sharp can't decode → ok:false, no vision call", async () => {
    const r = await extractImageText(Buffer.from("definitely not an image"), "junk.png");
    expect(r.ok).toBe(false);
    expect(invokeLLMMock).not.toHaveBeenCalled();
  });

  it("vision call throws → ok:false (never throws to caller)", async () => {
    invokeLLMMock.mockRejectedValueOnce(new Error("model 529 overloaded"));
    const r = await extractImageText(await tinyPng(), "poster.png");
    expect(r.ok).toBe(false);
  });
});
