/**
 * Guard: the lanes/ per-lane file split stays split.
 *
 * lanes/index.tsx hit 852 lines (CLAUDE.md §9.6 red line: >300 lines must be
 * modularized) and was split into per-lane files on 2026-06-11. This test
 * scans SOURCE (readFileSync — no .tsx imports; vitest runs in node env
 * without a react plugin) and fails if:
 *   (a) any .ts/.tsx file in lanes/ creeps back above 300 lines, or
 *   (b) index.tsx stops exporting the three dispatcher names the two external
 *       importers (ReviewTaskDialog.tsx, AgentChatPage.tsx) resolve via
 *       "./lanes" / "@/components/admin-v2/CommandCenter/lanes".
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LANES_DIR = __dirname;
const MAX_LINES = 300;

const laneFiles = readdirSync(LANES_DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .sort();

describe("CommandCenter lanes split", () => {
  it("finds the per-lane files (scanner sanity)", () => {
    expect(laneFiles).toContain("index.tsx");
    expect(laneFiles).toContain("GenericPayloadPreview.tsx");
    expect(laneFiles).toContain("csLane.tsx");
    expect(laneFiles).toContain("quoteLane.tsx");
    expect(laneFiles).toContain("marketingLane.tsx");
    expect(laneFiles).toContain("financeLane.tsx");
  });

  it.each(laneFiles)(`%s stays ≤ ${MAX_LINES} lines`, (file) => {
    const lineCount = readFileSync(join(LANES_DIR, file), "utf8").split("\n").length;
    expect(
      lineCount,
      `${file} has ${lineCount} lines — split it (CLAUDE.md §9.6: >300 lines)`,
    ).toBeLessThanOrEqual(MAX_LINES);
  });

  it("index.tsx keeps the dispatcher exports external importers rely on", () => {
    const src = readFileSync(join(LANES_DIR, "index.tsx"), "utf8");
    expect(src).toContain("laneHasEditor");
    expect(src).toContain("LanePayloadPreview");
    expect(src).toContain("LanePayloadBody");
  });
});
