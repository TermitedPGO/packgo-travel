/**
 * coverage.test.ts — 登記紀律 grep 守門(硬化戰役 Wave 2 塊 C)。
 *
 * 仿 migrationBreakpoint.test.ts:枚舉 server/ 非測試檔裡「每一處 raw SQL 出現點」
 * ——`sql\`\`` 樣板(含泛型 `sql<T>\`\``)與 `db.execute(`——每一點都必須在 SQL 彩排
 * 登記表有條目(ENTRIES.sources)或在白名單(WHITELIST),否則紅。新增一處沒登記的
 * raw SQL,這裡先紅,逼人補登記,ship 前的 EXPLAIN 彩排才不會有盲區。
 *
 * 反向也守:登記表 / 白名單裡的每個 source 都必須對應到「現在真的存在」的 raw SQL
 * 出現點 —— 檔案被編輯、raw SQL 行號漂移時,舊 source 會變 stale,這裡也紅,逼人
 * 把登記表更新到跟現況一致(登記表必須追著真相跑)。
 *
 * 注意 regex:naive 的 `sql\`` 會漏掉泛型 `sql<Date>\``(型別參數夾在 sql 與反引號
 * 之間)—— 而 `sql<Date>` 正是 prod 已中招的 raw-sql-date naive 字串雷所在。這裡用
 * 廣義 `sql(<...>)?\`` 抓全,盤點口徑跟登記表一致。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getRegistry } from "./registry";

const serverDir = fileURLToPath(new URL("../../", import.meta.url)); // .../server/
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)); // repo root

// 一行只要「含」raw SQL 出現點就算一個 token(跟權威 grep 口徑一致)。
const SQL_TAG = /sql(<[^>]*>)?`/; // sql`  或  sql<T>`
const DB_EXECUTE = /db\.execute\(/;

/** 遞迴收 server/ 下所有 .ts(排除 .test.ts / .spec.ts / node_modules)。 */
function collectServerTsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules") continue;
        // 排除登記表自己這個目錄 —— registryEntries.ts 的 sql/note 內文會出現 "sql`" /
        // "db.execute(" 字樣(當資料),那不是 production 的 raw SQL 站,不該當 token。
        if (ent.name === "sqlRehearsal") continue;
        walk(p);
      } else if (
        ent.name.endsWith(".ts") &&
        !ent.name.endsWith(".test.ts") &&
        !ent.name.endsWith(".spec.ts")
      ) {
        out.push(p);
      }
    }
  };
  walk(serverDir);
  return out;
}

/** 掃出現況所有 raw SQL 出現點,回傳 "server/path.ts:line" 集合。 */
function scanLiveTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const file of collectServerTsFiles()) {
    const rel = relative(repoRoot, file).split("\\").join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // 跳過純註解行:`// ... sql\`...\``(如 plaidRouter.ts 那句「Drizzle chokes on
      // groupBy(sql\`COALESCE\`)」的說明)不是可執行 SQL,不該當 token。
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (SQL_TAG.test(line) || DB_EXECUTE.test(line)) {
        tokens.add(`${rel}:${i + 1}`);
      }
    });
  }
  return tokens;
}

describe("SQL 彩排登記紀律 — 每處 raw SQL 都要登記或白名單(Wave2 塊 C)", () => {
  const live = scanLiveTokens();
  const { entries, whitelist } = getRegistry();
  const covered = new Set<string>();
  for (const e of entries) for (const s of e.sources) covered.add(s);
  for (const w of whitelist) covered.add(w.source);

  it("有 raw SQL 出現點可掃(sanity;口徑沒壞)", () => {
    // Wave2 盤點時 server/ 的 raw SQL 出現點數量級在數百;低於這個代表 regex 壞了。
    expect(live.size).toBeGreaterThan(200);
  });

  it("每一處 raw SQL 出現點都在登記表或白名單(否則補登記)", () => {
    const unregistered = [...live].filter((t) => !covered.has(t)).sort();
    expect(
      unregistered,
      `以下 raw SQL 出現點沒登記(共 ${unregistered.length} 處)。每一處要嘛在 ` +
        `server/_core/sqlRehearsal/registryEntries.ts 加一條 { key, sources:["file:line"], cls, sql(裸語句), sampleParams },` +
        `要嘛在 registryWhitelist.ts 加一行理由(DDL / sql.raw 動態片段 / 片段常量 covered-by / SELECT 1 之類):\n` +
        unregistered.join("\n"),
    ).toEqual([]);
  });

  it("登記表 / 白名單裡沒有 stale source(行號漂移 → 更新登記表)", () => {
    const stale = [...covered].filter((s) => !live.has(s)).sort();
    expect(
      stale,
      `以下 source 指向的行現在已不是 raw SQL 出現點(檔案被改過、行號漂移,或條目該刪)。` +
        `把 registryEntries.ts / registryWhitelist.ts 的對應 source 更新到現況行號:\n` +
        stale.join("\n"),
    ).toEqual([]);
  });
});
