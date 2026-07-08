/**
 * deploySmoke — Wave1 Block A(ship 後自動煙霧)。
 *
 * WHY: v794-v799 曾因 TiDB 對 GREATEST + 關聯子查詢 ORDER BY 的方言差異連環 500,
 * 客人列表 / 未讀徽章靜默壞掉兩天沒人發現(Ann 事故的根)。這支模組在每次
 * ship 後對「後台開機就會打」的一批核心讀查詢跑一輪真查詢,任一支拋錯就報
 * 出來,而不是等 Jeff 自己點開後台才發現壞了。
 *
 * 七臂全部唯讀,零寫入、零 mutation:
 *   1. customerList         — runCustomerListQuery(drizzleDb, {})
 *   2. guestList             — runGuestListQuery(drizzleDb, {})
 *   3. customerUnreadCount   — runRegisteredUnreadCountQuery + runGuestUnreadRankingQuery
 *   4. todayList             — loadTodayListItems()
 *   5. watchdogForCustomer   — 0909 測試客人:getUserByEmail → findCustomerProfileId
 *                               (動態解析,不硬編 TEST_ACCOUNT_0909_PROFILE_ID)→
 *                               listCustomOrdersByProfile
 *   6. commandCenter.approvalTasks — listApprovalTasks({})
 *   7. commandCenter.escalations   — listEscalations()
 *
 * 每一臂各自 try/catch + 計時(timeArm),一臂拋錯絕不中斷其餘臂 —— arms 陣列
 * 永遠回滿七筆(opts.simulateFail 時是八筆),失敗的臂帶 error,其餘欄位仍然
 * 完整。error 欄位格式 `${err.name}: ${err.message}`,截到前 200 字,絕不含
 * stack、絕不含任何客人資料(email/姓名/id 等一律不放進 error 字串或其他欄位)。
 *
 * DB 不可用(getDb() 回 null)時,各臂各自在自己的 fn 裡 throw,被 timeArm 接住
 * 記成失敗 —— 不會讓整支 runDeploySmoke 掛掉。
 */
import { createChildLogger } from "./logger";
import * as db from "../db";
import {
  runCustomerListQuery,
  runGuestListQuery,
  runRegisteredUnreadCountQuery,
  runGuestUnreadRankingQuery,
} from "../routers/adminCustomers";
import { loadTodayListItems } from "../routers/adminCustomerOrders";
import { TEST_ACCOUNT_0909_EMAIL } from "./testAccounts";
import { listApprovalTasks } from "./approvalTasks";
import { listEscalations } from "./escalationBox";

const log = createChildLogger({ module: "deploySmoke" });

/** Max chars kept in the `error` field — no stack, no customer data. */
const ERROR_MESSAGE_MAX_CHARS = 200;

export interface DeploySmokeArm {
  name: string;
  ok: boolean;
  ms: number;
  rowCount?: number;
  error?: string;
}

export interface DeploySmokeResult {
  ok: boolean;
  arms: DeploySmokeArm[];
}

/**
 * Run one smoke arm: time it, catch any throw, format a safe error string.
 * NEVER rethrows — always resolves to an Arm (ok:true or ok:false).
 */
async function timeArm(
  name: string,
  fn: () => Promise<{ rowCount: number }>,
): Promise<DeploySmokeArm> {
  const start = Date.now();
  try {
    const { rowCount } = await fn();
    return { name, ok: true, ms: Date.now() - start, rowCount };
  } catch (err) {
    const e = err as Partial<Error> | undefined;
    const errName = e?.name ?? "Error";
    const errMessage = e?.message ?? String(err);
    const error = `${errName}: ${errMessage}`.slice(0, ERROR_MESSAGE_MAX_CHARS);
    log.error({ arm: name, error }, "[deploySmoke] arm failed");
    return { name, ok: false, ms: Date.now() - start, error };
  }
}

/**
 * Ship 後自動煙霧:七臂依序跑(各自 try/catch,互不影響),回傳 { ok, arms }。
 * opts.simulateFail 為 true 時,額外在 arms 尾端 push 一筆固定失敗紀錄(用於
 * 紅路演練 — 驗證 endpoint → safe-deploy.mjs 這條「失敗要印紅字」的管線真的通),
 * 不影響真實七臂各自照跑。
 */
export async function runDeploySmoke(
  opts?: { simulateFail?: boolean },
): Promise<DeploySmokeResult> {
  const arms: DeploySmokeArm[] = [];

  arms.push(
    await timeArm("customerList", async () => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("database not available");
      const rows = await runCustomerListQuery(drizzleDb, {});
      return { rowCount: rows.length };
    }),
  );

  arms.push(
    await timeArm("guestList", async () => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("database not available");
      const rows = await runGuestListQuery(drizzleDb, {});
      return { rowCount: rows.length };
    }),
  );

  arms.push(
    await timeArm("customerUnreadCount", async () => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("database not available");
      const [registered, guests] = await Promise.all([
        runRegisteredUnreadCountQuery(drizzleDb),
        runGuestUnreadRankingQuery(drizzleDb),
      ]);
      return { rowCount: registered.length + guests.length };
    }),
  );

  arms.push(
    await timeArm("todayList", async () => {
      const items = await loadTodayListItems();
      return { rowCount: items.length };
    }),
  );

  arms.push(
    await timeArm("watchdogForCustomer", async () => {
      // 0909 測試客人 — profileId 一律動態解析(getUserByEmail → findCustomerProfileId),
      // 不可硬編 TEST_ACCOUNT_0909_PROFILE_ID(即使該常數存在)。找不到 user 或
      // 解析不到 profileId 都必須 throw,讓這一臂被記成 fail,不假裝成功回 0。
      const user = await db.getUserByEmail(TEST_ACCOUNT_0909_EMAIL);
      if (!user) throw new Error("0909 test account not found");
      const profileId = await db.findCustomerProfileId({ userId: user.id });
      if (profileId == null) throw new Error("0909 customer profile not resolved");
      const rows = await db.listCustomOrdersByProfile(profileId);
      return { rowCount: rows.length };
    }),
  );

  arms.push(
    await timeArm("commandCenter.approvalTasks", async () => {
      const tasks = await listApprovalTasks({});
      return { rowCount: tasks.length };
    }),
  );

  arms.push(
    await timeArm("commandCenter.escalations", async () => {
      const rows = await listEscalations();
      return { rowCount: rows.length };
    }),
  );

  if (opts?.simulateFail) {
    arms.push({
      name: "simulated",
      ok: false,
      ms: 0,
      error: "simulated failure (opts.simulateFail=true)",
    });
  }

  const ok = arms.every((a) => a.ok);
  return { ok, arms };
}
