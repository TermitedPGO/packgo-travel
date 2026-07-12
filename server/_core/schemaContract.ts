/**
 * schemaContract.ts — 必要表存在契約(DB 硬化批,2026-07-12)。
 *
 * WHY: 2026-06-17 一次非正規 DDL(疑似對 prod DATABASE_URL 直跑 drizzle-kit push /
 * 手動 DROP)清空了 tours 等七張表,賣場對客零商品三週無告警(當時觀測神經未覆蓋
 * 「表還在不在」這個信號;release_command 退出 0 也騙過了部署)。事故報告:
 * docs/features/public-site/incident-20260617-tours-wipe.md。
 *
 * 這支模組把「一組災難級表必須存在」變成一條可被健康檢查與 ship 後煙霧讀到的
 * 機械信號。表被 DROP / TRUNCATE-then-never-written / rename 到別名時,健康檢查
 * (UptimeRobot 每 5 分鐘輪詢的 /health)會降級成 503、deploySmoke 第九臂會標紅,
 * 不再靠 Jeff 自己點開賣場才發現。
 *
 * ── 契約邊界(後人別誤讀)──────────────────────────────────────────
 *   - 這只查「表存不存在」(information_schema.tables),不查列數、不查 schema 欄位、
 *     不查資料正確性。表在但被清空(COUNT=0)這裡是綠的 —— 賣場零商品那條信號由
 *     deploySmoke 的 activeToursCount 臂顧(對客可見團數),兩者互補不重疊。
 *   - REQUIRED_TABLES 是刻意保守的「災難級」子集(見下),不是全 schema 清單。
 *     drizzle migration 若合法 rename / drop 了清單內的表,必須同步改這裡,否則
 *     健康檢查會紅 —— 這是刻意的:契約追著 schema 跑,不容默默漂移。
 * ────────────────────────────────────────────────────────────────────
 */

/**
 * 災難級必要表清單。收錄原則:此表若消失 = 對客賣場歸零、財務紅線帳失守、或
 * 客戶主資料遺失。全數於 2026-07-12 對 prod(TiDB test schema,93 表)實測存在。
 *
 *   - 2026-06-17 被清空的七張(事故直接受害者,復原後表身回來但曾整層消失):
 *     tours / bookings / payments / tourDepartures / tourReviews /
 *     catalogBatches / toursCatalogArchive
 *   - 客戶與訂單主資料:customerProfiles / customOrders / users / inquiries
 *   - 財務紅線(信託遞延、銀行流水):trustDeferredIncome / bankTransactions
 *   - migration 追蹤表(消失 = migrator 會重跑全部 migration,災難):__drizzle_migrations
 *   - 目錄重建的唯一來源(供應商鏡像層):supplierProducts / supplierProductDetails
 */
export const REQUIRED_TABLES = [
  "tours",
  "bookings",
  "payments",
  "tourDepartures",
  "tourReviews",
  "catalogBatches",
  "toursCatalogArchive",
  "customerProfiles",
  "customOrders",
  "users",
  "inquiries",
  "trustDeferredIncome",
  "bankTransactions",
  "__drizzle_migrations",
  "supplierProducts",
  "supplierProductDetails",
] as const;

export interface SchemaContractResult {
  /** true = REQUIRED_TABLES 全部存在。 */
  ok: boolean;
  /** 缺失的表名(REQUIRED_TABLES 裡、information_schema 查不到的)。 */
  missing: string[];
  /** 實際找到的必要表數量。 */
  presentCount: number;
  /** 契約檢查的必要表總數(= REQUIRED_TABLES.length)。 */
  checkedCount: number;
}

/**
 * 最小執行介面:只要有 `execute(query)` 即可。真 drizzle(MySql2Database)天然符合,
 * 測試可注入假物件而不必連 DB —— 讓契約邏輯的單測不需要真查詢。
 */
export interface SchemaExecutor {
  execute(query: unknown): Promise<unknown>;
}

/**
 * 從 db.execute 的回傳裡取出 rows 陣列。drizzle(mysql2)回 `[rows, fields]`;
 * 少數轉接層回 `{ rows }`。兩種都吃(比照 server/db/booking.ts 的既有正規化)。
 */
function extractRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return (result[0] as Array<Record<string, unknown>>) ?? [];
  const r = (result as { rows?: unknown })?.rows;
  return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
}

/**
 * 對當前連線的 schema(DATABASE())查 information_schema.tables,比對 REQUIRED_TABLES。
 * 純讀查詢(SELECT information_schema),零寫入。回傳缺失清單;呼叫端(healthCheck /
 * deploySmoke)決定如何把 !ok 變成 503 / 紅臂。
 *
 * 這裡「不 throw」缺表 —— 缺表是回傳值(missing 非空),讓 healthCheck 能把它變成
 * degraded 而非讓整個 /health 端點爆掉。真正的連線/查詢錯(DB 不可達)才會 throw,
 * 由呼叫端的 try/catch 記成該子檢查失敗。
 */
export async function assertSchemaContract(db: SchemaExecutor): Promise<SchemaContractResult> {
  const { sql } = await import("drizzle-orm");
  const result = await db.execute(sql`SELECT TABLE_NAME AS t FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()`);
  const present = new Set<string>();
  for (const row of extractRows(result)) {
    const name = (row.t ?? row.TABLE_NAME ?? row.table_name) as unknown;
    if (typeof name === "string") present.add(name);
  }
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  return {
    ok: missing.length === 0,
    missing,
    presentCount: REQUIRED_TABLES.length - missing.length,
    checkedCount: REQUIRED_TABLES.length,
  };
}
