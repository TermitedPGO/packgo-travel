/**
 * adminCustomers.ts — offline SQL 渲染形狀斷言(Wave1 Block A 派工單驗收項)。
 *
 * 只驗 buildGuestListQuery 的離線 SQL 形狀,不連真 DB、不 mock 任何東西 ——
 * 用 drizzle-orm/mysql-core 的 QueryBuilder(免連線)取代真 db 實例餵給
 * buildGuestListQuery,呼叫回傳查詢鏈物件的 .toSQL() 拿渲染後的 SQL 字串
 * 純字串斷言。這是「形狀不變」的迴歸測試 —— guestList 的 SQL 表達式本身
 * (含 lastContactSql 這段 GREATEST 運算式)在本次重構中一個字元都沒有被
 * 改動,只被搬進 buildGuestListQuery/runGuestListQuery 這兩支 exported 函式;
 * 這支測試把「搬移後渲染出的 SQL 長相跟搬移前一致」釘住,未來若有人不小心
 * 動到這段 SQL,這裡會先紅。
 *
 * QueryBuilder 與真 db 實例(MySql2Database)的型別參數不完全相容(select()
 * 回傳的 MySqlSelectBuilder 泛型第三個參數 "qb" vs "db" 不同),沒辦法讓
 * buildGuestListQuery 的參數型別直接接受兩者的 union 仍保有正確的方法鏈型別
 * (實測 tsc 對 union 呼叫鏈會在 orderBy/limit 這種多載鏈上失敗)。這裡改用
 * `as unknown as DrizzleDb` 的執行期 duck-typing 轉型 —— JS 是動態型別,
 * QueryBuilder 產生的鏈物件在執行期真的具備 select/from/where/orderBy/limit/
 * toSQL 這些方法,轉型只是說服編譯器,不影響執行期行為。
 *
 * ⚠ 與派工單原文描述的落差(如實記錄,未擴大解釋):派工單驗收項寫「確認渲染
 * 出的 SQL 字串裡 GREATEST( 只出現一次、有 AS 別名、關聯子查詢 WHERE 用完整
 * 表前綴」。但 guestList 現有的 lastContactSql(本次重構明文禁止改一個字元)
 * 其實沒有 `.as(...)` 別名 —— 它只在 `.orderBy(desc(lastContactSql))` 用,
 * 不同於 runGuestUnreadRankingQuery 那支「有 .as('lastContact') 別名」的安全
 * 寫法。下面只斷言「實際為真」的兩件事(GREATEST 只出現一次、關聯子查詢 WHERE
 * 用完整表前綴),不斷言 AS 別名的存在 —— 若要讓 guestList 也套用別名寫法,
 * 那是另一個任務(TiDB 硬化)的範圍,這裡不動手改。
 */
import { describe, it, expect } from "vitest";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import { buildGuestListQuery } from "./adminCustomers";

type DrizzleDb = Parameters<typeof buildGuestListQuery>[0];

describe("buildGuestListQuery — offline .toSQL() shape assertion (no DB connection)", () => {
  it("renders without throwing when fed an offline QueryBuilder (no real db needed)", async () => {
    const qb = new QueryBuilder();
    const { query } = await buildGuestListQuery(qb as unknown as DrizzleDb, {});
    expect(() => query.toSQL()).not.toThrow();
    const rendered = query.toSQL();
    expect(typeof rendered.sql).toBe("string");
    expect(rendered.sql.length).toBeGreaterThan(0);
  });

  it("GREATEST( appears exactly once — the lastContactSql expression is rendered a single time, not duplicated between SELECT and ORDER BY", async () => {
    const qb = new QueryBuilder();
    const { query } = await buildGuestListQuery(qb as unknown as DrizzleDb, {});
    const { sql } = query.toSQL();
    const occurrences = (sql.match(/GREATEST\(/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("the correlated subquery inside GREATEST uses a fully-qualified table prefix on both sides of the join condition (customerInteractions.customerProfileId = customerProfiles.id)", async () => {
    const qb = new QueryBuilder();
    const { query } = await buildGuestListQuery(qb as unknown as DrizzleDb, {});
    const { sql } = query.toSQL();
    expect(sql).toMatch(
      /`customerInteractions`\.`customerProfileId`\s*=\s*`customerProfiles`\.`id`/,
    );
  });

  it("GREATEST is rendered inside the ORDER BY clause (order by ... GREATEST(...) desc), not inside the SELECT column list — matches guestList's un-aliased lastContactSql usage", async () => {
    const qb = new QueryBuilder();
    const { query } = await buildGuestListQuery(qb as unknown as DrizzleDb, {});
    const { sql } = query.toSQL();
    const orderByIdx = sql.toLowerCase().indexOf("order by");
    const greatestIdx = sql.indexOf("GREATEST(");
    expect(orderByIdx).toBeGreaterThan(-1);
    expect(greatestIdx).toBeGreaterThan(orderByIdx);
    // and it is NOT present before "from" (i.e. not selected as a column)
    const fromIdx = sql.toLowerCase().indexOf(" from ");
    expect(fromIdx).toBeGreaterThan(-1);
    expect(greatestIdx).toBeGreaterThan(fromIdx);
  });

  it("renders a LIMIT 200 (the top-200 window guestList/customerUnreadCount both rely on)", async () => {
    const qb = new QueryBuilder();
    const { query } = await buildGuestListQuery(qb as unknown as DrizzleDb, {});
    const { sql } = query.toSQL();
    expect(sql.toLowerCase()).toMatch(/limit\s*\?/);
    const { params } = query.toSQL();
    expect(params.at(-1)).toBe(200);
  });
});
