/**
 * Guard against the "migration file exists on disk but is missing from
 * _journal.json" failure class (0079_skill_runs, discovered 2026-07-11).
 *
 * The drizzle mysql2 migrator (scripts/migrate.mjs → readMigrationFiles)
 * ONLY reads migrations listed in `drizzle/meta/_journal.json`. A NNNN_*.sql
 * file that is present on disk but has no journal entry is invisible to the
 * migrator — it is silently never applied in prod. 0079_skill_runs.sql sat
 * unlisted for weeks: `skillRuns` never existed in the DB, so every
 * `dispatchSkillFromInquiry()` insert threw, was swallowed, and the
 * dispatcher fell back to `skillRunId = 0` (defeating retry idempotency).
 *
 * The inverse is worse-but-louder: a journal entry whose file is missing
 * makes `readMigrationFiles` throw "No file … found" and aborts the ENTIRE
 * release migration.
 *
 * This test asserts a bijection between up-migration files
 * (drizzle/NNNN_*.sql, excluding .down.sql) and _journal.json entries (by
 * tag), plus idx contiguity so a dropped/misnumbered entry can't hide. The
 * historical 0060/0061 renumber gap is exempted by explicit whitelist.
 *
 * See docs/MIGRATION_PATTERNS.md (Rule 4 covers the sibling `when` bug).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const drizzleDir = fileURLToPath(new URL("../../drizzle", import.meta.url));
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
);

/**
 * idx values intentionally absent from _journal.json. During early
 * development a batch was renumbered, leaving 0060/0061 with no SQL file and
 * no journal entry. These are historical and must never be "backfilled".
 * ANY other hole is a bug (a dropped or misnumbered entry). If you ever add
 * a genuinely-new intentional gap, add it here WITH a reason.
 */
const IDX_GAP_WHITELIST = new Set<number>([60, 61]);

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
  version: string;
}

const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: JournalEntry[];
};
const journalTags = journal.entries.map((e) => e.tag).sort();

const fileTags = readdirSync(drizzleDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.endsWith(".down.sql"))
  .map((f) => f.slice(0, -".sql".length))
  .sort();

describe("migration journal ↔ file bijection (MIGRATION_PATTERNS)", () => {
  it("has migrations to scan", () => {
    expect(fileTags.length).toBeGreaterThan(0);
    expect(journal.entries.length).toBeGreaterThan(0);
  });

  it("every up-migration .sql file has a _journal.json entry", () => {
    const missing = fileTags.filter((t) => !journalTags.includes(t));
    expect(
      missing,
      `These migration files exist on disk but are ABSENT from _journal.json, ` +
        `so the drizzle migrator will NEVER apply them in prod (the ` +
        `0079_skill_runs failure class). Add a journal entry with a \`when\` ` +
        `strictly greater than the current max (see MIGRATION_PATTERNS Rule 4):\n` +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("every _journal.json entry has an up-migration .sql file", () => {
    const orphan = journalTags.filter((t) => !fileTags.includes(t));
    expect(
      orphan,
      `These _journal.json entries reference a .sql file that does not exist. ` +
        `readMigrationFiles() throws "No file … found" and aborts the whole ` +
        `release migration:\n${orphan.join("\n")}`,
    ).toEqual([]);
  });

  it("has no duplicate idx or tag", () => {
    const idxs = journal.entries.map((e) => e.idx);
    const dupIdx = idxs.filter((v, i) => idxs.indexOf(v) !== i);
    const dupTag = journalTags.filter((v, i) => journalTags.indexOf(v) !== i);
    expect(dupIdx, "duplicate idx in _journal.json").toEqual([]);
    expect(dupTag, "duplicate tag in _journal.json").toEqual([]);
  });

  it("idx values are contiguous except whitelisted historical gaps", () => {
    const present = new Set(journal.entries.map((e) => e.idx));
    const maxIdx = Math.max(...present);
    const holes: number[] = [];
    for (let i = 0; i <= maxIdx; i++) {
      if (!present.has(i) && !IDX_GAP_WHITELIST.has(i)) holes.push(i);
    }
    expect(
      holes,
      `Unexpected idx hole(s) in _journal.json — an entry was dropped or ` +
        `misnumbered. If a hole is genuinely intentional, add it to ` +
        `IDX_GAP_WHITELIST with a reason. Holes: ${holes.join(", ")}`,
    ).toEqual([]);
  });

  it("no whitelisted-gap idx has silently reappeared (stale whitelist)", () => {
    // If a 0060_*.sql / entry is ever added, the whitelist is stale and would
    // mask a real future hole — force it to be pruned.
    const allTags = [...new Set([...fileTags, ...journalTags])];
    const resurrected = [...IDX_GAP_WHITELIST].filter((i) => {
      const prefix = `${String(i).padStart(4, "0")}_`;
      return allTags.some((t) => t.startsWith(prefix));
    });
    expect(
      resurrected,
      `A whitelisted-gap idx now has a file/entry; remove it from ` +
        `IDX_GAP_WHITELIST: ${resurrected.join(", ")}`,
    ).toEqual([]);
  });
});
