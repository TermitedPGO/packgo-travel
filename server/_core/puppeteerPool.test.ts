/**
 * Unit tests for the shared Puppeteer pool (server/_core/puppeteerPool.ts).
 * puppeteer-core is mocked so no real Chromium is launched. Each test gets a
 * fresh module instance (vi.resetModules) because the pool keeps singleton
 * state (browser, launching latch, activePagesCount) at module scope.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const launch = vi.fn();

vi.mock("puppeteer-core", () => ({
  default: { launch },
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function fakePage() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
  };
}

function fakeBrowser(page = fakePage()) {
  return {
    connected: true,
    on: vi.fn(),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function freshPool() {
  return import("./puppeteerPool");
}

describe("warmUp", () => {
  beforeEach(() => {
    // mockReset clears call history AND implementation AND the *Once queue, so
    // each test starts from a pristine launch mock.
    launch.mockReset();
    vi.resetModules();
  });

  it("launches Chromium once and cycles a page (renderer subprocess warmed too)", async () => {
    const page = fakePage();
    const browser = fakeBrowser(page);
    launch.mockResolvedValue(browser);

    const pool = await freshPool();
    await pool.warmUp();

    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newPage).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1); // page released, slot freed
  });

  it("never throws when the launch fails (fire-and-forget boot contract)", async () => {
    launch.mockRejectedValue(new Error("no chromium at CHROMIUM_PATH"));
    const pool = await freshPool();
    await expect(pool.warmUp()).resolves.toBeUndefined();
  });

  it("recovers after a failed launch — the `launching` latch is cleared, not poisoned", async () => {
    // Regression: ensureBrowser used to set `launching = null` only on the
    // success path, so a single failed launch left the latch holding a rejected
    // promise that every later ensureBrowser() returned — permanently bricking
    // the pool until a process restart. Moving the first launch to boot (warmUp)
    // made a transient boot failure able to break every real request, so the
    // latch must clear on failure too.
    launch.mockRejectedValueOnce(new Error("transient boot failure"));
    const pool = await freshPool();

    await pool.warmUp(); // swallows the failure
    expect(launch).toHaveBeenCalledTimes(1);

    // Second attempt MUST retry (proving the latch was cleared) and succeed.
    const page = fakePage();
    const browser = fakeBrowser(page);
    launch.mockResolvedValue(browser);

    await pool.warmUp();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(browser.newPage).toHaveBeenCalledTimes(1);
  });

  it("reuses the warmed browser on the next acquire (no second launch within TTL)", async () => {
    const browser = fakeBrowser();
    launch.mockResolvedValue(browser);

    const pool = await freshPool();
    await pool.warmUp(); // launch #1
    const page = await pool.acquirePage(); // should reuse, not relaunch
    await pool.releasePage(page);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newPage).toHaveBeenCalledTimes(2); // warm cycle + this acquire
  });
});
