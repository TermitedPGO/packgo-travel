/**
 * Unit tests for renderForBot (server/_core/prerender.ts). The shared
 * puppeteer pool is mocked, so no real Chromium is launched.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("./_core/puppeteerPool", () => ({
  acquirePage: vi.fn(),
  releasePage: vi.fn(),
}));
vi.mock("./_core/logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { acquirePage, releasePage } from "./_core/puppeteerPool";
import { renderForBot } from "./_core/prerender";

const mockAcquire = acquirePage as unknown as Mock;
const mockRelease = releasePage as unknown as Mock;

function fakePage(over: Record<string, unknown> = {}) {
  return {
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue("<html><body>ok ld+json</body></html>"),
    ...over,
  };
}

describe("renderForBot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns rendered HTML and releases the page", async () => {
    const page = fakePage();
    mockAcquire.mockResolvedValue(page);
    const html = await renderForBot("/about-us");
    expect(html).toContain("ld+json");
    expect(page.setUserAgent).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith(page);
  });

  it("navigates with domcontentloaded, never networkidle (live SPA never idles)", async () => {
    // Regression: a live React SPA polls (refetchInterval) and auto-advances
    // carousels (setInterval image swaps), so the network never goes idle.
    // networkidle0/2 would burn NAV_TIMEOUT then throw, killing every prerender
    // (prod symptom: bots got an empty shell, 0 schema). The DOM-based
    // waitForFunction is the real readiness gate, so goto must not wait on net.
    const page = fakePage();
    mockAcquire.mockResolvedValue(page);
    await renderForBot("/");
    const opts = (page.goto as Mock).mock.calls[0][1] as { waitUntil?: string };
    expect(opts.waitUntil).toBe("domcontentloaded");
    expect(opts.waitUntil).not.toMatch(/networkidle/);
  });

  it("uses a non-bot internal UA (loop guard)", async () => {
    const page = fakePage();
    mockAcquire.mockResolvedValue(page);
    await renderForBot("/");
    const ua = (page.setUserAgent as Mock).mock.calls[0][0] as string;
    expect(ua.toLowerCase()).not.toContain("bot");
  });

  it("returns null and does not release when acquire fails", async () => {
    mockAcquire.mockRejectedValue(new Error("no browser"));
    const html = await renderForBot("/faq");
    expect(html).toBeNull();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("returns null but still releases the page when goto throws", async () => {
    const page = fakePage({ goto: vi.fn().mockRejectedValue(new Error("nav fail")) });
    mockAcquire.mockResolvedValue(page);
    const html = await renderForBot("/tours");
    expect(html).toBeNull();
    expect(mockRelease).toHaveBeenCalledWith(page);
  });

  it("tolerates a ready-signal timeout and still returns content", async () => {
    const page = fakePage({
      waitForFunction: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    mockAcquire.mockResolvedValue(page);
    const html = await renderForBot("/");
    expect(html).toContain("ld+json");
    expect(page.content).toHaveBeenCalled();
  });

  it("strips dev artifacts from the serialized HTML", async () => {
    const page = fakePage({
      content: vi
        .fn()
        .mockResolvedValue(
          '<html><script src="/__manus__/debug-collector.js"></script>' +
            '<script src="/src/main.tsx?v=abc123"></script>ld+json</html>',
        ),
    });
    mockAcquire.mockResolvedValue(page);
    const html = (await renderForBot("/")) as string;
    expect(html).not.toContain("__manus__");
    expect(html).not.toContain("?v=abc123");
    expect(html).toContain("ld+json");
  });
});
