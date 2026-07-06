/**
 * Guard against the migration-0112 deploy failure class (2026-07-06).
 *
 * The drizzle mysql2 migrator splits every migration file on the literal string
 * `--> statement-breakpoint`. If that literal appears INSIDE a `-- comment` line
 * (e.g. a note that says "每句之間放 --> statement-breakpoint"), the migrator
 * splits in the middle of the comment. The chunk after the split then begins
 * with the prose that followed the marker — which is no longer commented out —
 * so TiDB tries to parse it as SQL and dies with ER_PARSE_ERROR (errno 1064).
 *
 * This is exactly how 0112_case_learnings_source_folder.sql broke release v795/
 * v796: `ALTER TABLE caseLearnings MODIFY COLUMN sourceOrderId INT NULL` never
 * ran — the parse error on the orphaned prose aborted the whole transaction.
 *
 * The old drizzle format `ALTER ...;--> statement-breakpoint` (marker after the
 * semicolon on a SQL line) is fine: it splits cleanly right after the statement,
 * so we only flag the marker when it is embedded in a COMMENT line.
 *
 * See docs/MIGRATION_PATTERNS.md Rule 2 (statement-breakpoint).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MARK = "--> statement-breakpoint";
const drizzleDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

describe("migration statement-breakpoint hygiene (MIGRATION_PATTERNS Rule 2)", () => {
  const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));

  it("has migration files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no migration embeds the breakpoint marker inside a comment line", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(join(drizzleDir, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        const t = line.trim();
        // Only a *comment* line that contains the marker but isn't the
        // standalone marker itself severs a comment and orphans prose as SQL.
        if (t.startsWith("--") && t !== MARK && t.includes(MARK)) {
          offenders.push(`${f}:${i + 1}  ${t.slice(0, 100)}`);
        }
      });
    }
    expect(
      offenders,
      `A comment line contains "${MARK}". The migrator will split there and feed the ` +
        `text after it to TiDB as raw SQL (ER_PARSE_ERROR). Reword the comment so it ` +
        `does not contain the literal marker:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every chunk between breakpoints is a single well-formed statement (0112 regression)", () => {
    // Simulate the migrator's split and confirm each chunk, after stripping
    // comment + blank lines, is empty or begins with a SQL keyword — never
    // stray prose like "（migrator 靠這個切句）。".
    const KEYWORD = /^(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|RENAME|TRUNCATE|SET|GRANT|REVOKE)\b/i;
    const malformed: string[] = [];
    for (const f of files) {
      const chunks = readFileSync(join(drizzleDir, f), "utf8").split(MARK);
      chunks.forEach((chunk, ci) => {
        const exec = chunk
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith("--"))
          .join(" ")
          .trim();
        if (exec.length > 0 && !KEYWORD.test(exec)) {
          malformed.push(`${f} chunk[${ci}]: ${exec.slice(0, 100)}`);
        }
      });
    }
    expect(
      malformed,
      `A post-split chunk does not start with a SQL keyword (orphaned prose or bad ` +
        `breakpoint placement):\n${malformed.join("\n")}`,
    ).toEqual([]);
  });
});
