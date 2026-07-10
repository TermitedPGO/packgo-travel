/**
 * sandboxResidueCleanup — F1 對帳引擎 塊D 衛生(2026-07-09).
 *
 * Plaid sandbox 測試殘留清理:早期接 Plaid 時用 sandbox 產生的假帳戶
 * (institutionName='First Platypus Bank',Plaid sandbox 的招牌假銀行),
 * 全部 isActive=0 且掛了一批假 bankTransactions,汙染帳戶清單與統計。
 *
 * ⛔ 硬紅線(三重防護,任一不過就中止,絕不刪錯):
 *   1. SQL WHERE 只選 institutionName='First Platypus Bank' AND isActive=0。
 *   2. JS 層逐列複驗:每個要刪的帳戶名字必須精確等於 'First Platypus Bank'
 *      且 isActive===0;只要有一列不符就整批中止(防 SQL 寫錯的第二道牆)。
 *   3. 黑名單:掃描結果若出現任何名字含 bofa / bank of america(不分大小寫)
 *      就中止 —— BofA 四個真帳戶一根毛都不准碰。
 * dry_run 只報數,Jeff 點頭才 confirm(dispatch 明文,LOCAL_SCRIPT_TOKEN 慣例)。
 */

import { getDb } from "../db";
import { linkedBankAccounts, bankTransactions } from "../../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createChildLogger } from "../_core/logger";
import { systemAudit } from "../_core/auditLog";

const log = createChildLogger({ module: "sandboxResidueCleanup" });

/** Plaid sandbox 假銀行的精確名字。只有這個名字 + isActive=0 的帳戶會被碰。 */
const SANDBOX_INSTITUTION = "First Platypus Bank";
/** 黑名單:掃描結果一旦出現這些字樣就整批中止(BofA 保護)。 */
const NEVER_TOUCH_PATTERNS = ["bofa", "bank of america"] as const;

export interface SandboxAccountRow {
  id: number;
  institutionName: string;
  accountName: string;
  isActive: number;
}

export interface SandboxCleanupReport {
  accountCount: number;
  transactionCount: number;
  accounts: SandboxAccountRow[];
  /** confirm 模式才有:實際刪除的帳戶/交易筆數。dry_run 為 null。 */
  deletedAccounts: number | null;
  deletedTransactions: number | null;
}

/**
 * 三重防護的 JS 層複驗(純函式,可單測)。回傳可安全刪除的帳戶 id 陣列;
 * 只要有任一列不符合(名字不精確等於 sandbox、isActive 非 0、或命中 BofA
 * 黑名單)就 throw,呼叫端整批中止,不做部分刪除。
 */
export function assertOnlySandboxRows(rows: SandboxAccountRow[]): number[] {
  for (const r of rows) {
    const nameLower = r.institutionName.toLowerCase();
    for (const bad of NEVER_TOUCH_PATTERNS) {
      if (nameLower.includes(bad)) {
        throw new Error(
          `[sandboxResidueCleanup] 中止:掃描結果含疑似真實銀行帳戶(id=${r.id}, name="${r.institutionName}")—— 絕不刪除`,
        );
      }
    }
    if (r.institutionName !== SANDBOX_INSTITUTION) {
      throw new Error(
        `[sandboxResidueCleanup] 中止:帳戶 id=${r.id} 名字 "${r.institutionName}" 不精確等於 "${SANDBOX_INSTITUTION}"`,
      );
    }
    if (r.isActive !== 0) {
      throw new Error(
        `[sandboxResidueCleanup] 中止:帳戶 id=${r.id} isActive=${r.isActive} 非 0(可能是使用中的帳戶)`,
      );
    }
  }
  return rows.map((r) => r.id);
}

async function scan(): Promise<{ accounts: SandboxAccountRow[]; ids: number[]; txnCount: number }> {
  const db = await getDb();
  if (!db) return { accounts: [], ids: [], txnCount: 0 };

  const accounts = await db
    .select({
      id: linkedBankAccounts.id,
      institutionName: linkedBankAccounts.institutionName,
      accountName: linkedBankAccounts.accountName,
      isActive: linkedBankAccounts.isActive,
    })
    .from(linkedBankAccounts)
    .where(
      and(
        eq(linkedBankAccounts.institutionName, SANDBOX_INSTITUTION),
        eq(linkedBankAccounts.isActive, 0),
      ),
    );

  // JS 層複驗(第二/三道防護)。不符就 throw,呼叫端不進 confirm。
  const ids = assertOnlySandboxRows(accounts as SandboxAccountRow[]);

  let txnCount = 0;
  if (ids.length > 0) {
    const txns = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(inArray(bankTransactions.linkedAccountId, ids));
    txnCount = txns.length;
  }

  return { accounts: accounts as SandboxAccountRow[], ids, txnCount };
}

/** dry_run:只掃描報數,不刪。confirm 前先看這份數字給 Jeff。 */
export async function runSandboxCleanupDryRun(): Promise<SandboxCleanupReport> {
  const { accounts, txnCount } = await scan();
  return {
    accountCount: accounts.length,
    transactionCount: txnCount,
    accounts,
    deletedAccounts: null,
    deletedTransactions: null,
  };
}

/** confirm:先刪掛的 bankTransactions,再刪 linkedBankAccounts(FK 順序)。 */
export async function runSandboxCleanupConfirm(): Promise<SandboxCleanupReport> {
  const { accounts, ids, txnCount } = await scan();

  if (ids.length === 0) {
    return { accountCount: 0, transactionCount: 0, accounts: [], deletedAccounts: 0, deletedTransactions: 0 };
  }

  const db = await getDb();
  if (!db) return { accountCount: accounts.length, transactionCount: txnCount, accounts, deletedAccounts: 0, deletedTransactions: 0 };

  // 交易 → 帳戶 的順序刪(FK 依賴)。ids 已通過三重防護複驗。
  await db.transaction(async (tx: any) => {
    await tx.delete(bankTransactions).where(inArray(bankTransactions.linkedAccountId, ids));
    await tx.delete(linkedBankAccounts).where(inArray(linkedBankAccounts.id, ids));
  });

  log.info(
    { deletedAccounts: ids.length, deletedTransactions: txnCount, accountIds: ids },
    "[sandboxResidueCleanup] confirm — First Platypus sandbox residue deleted (BofA untouched)",
  );

  // F2 塊A:LOCAL_SCRIPT_TOKEN confirm 端點的破壞性寫入(刪帳戶+交易)必留系統
  // 稽核軌(無 ctx.user)。fire-and-forget + .catch 雙保險,絕不影響刪除主流程回傳。
  void systemAudit("system:sandboxCleanup", "sandbox.cleanup_confirm", "First Platypus Bank", {
    deletedAccounts: ids.length,
    deletedTransactions: txnCount,
    accountIds: ids,
  }).catch(() => {});

  return {
    accountCount: accounts.length,
    transactionCount: txnCount,
    accounts,
    deletedAccounts: ids.length,
    deletedTransactions: txnCount,
  };
}
