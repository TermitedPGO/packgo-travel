/**
 * 記帳 Agent 真實交易實測單 — READ-ONLY prod eval.
 *
 * 拿 prod 上 Jeff 親手分類過的真實交易(jeffOverrideCategory 非 null)當標準
 * 答案,跑 M2 的 preClassify() 看 agent 答對幾題、哪幾筆規則判錯、哪幾筆
 * 今天的規則仍接不住。輸出一份 markdown 實測單到 stdout。
 *
 * 執行(prod 機器,DATABASE_URL 指向 prod MySQL):
 *   fly ssh console -a packgo-travel -C "pnpm tsx server/scripts/accounting-eval.ts"
 *
 * 也可加年份過濾:
 *   fly ssh console -a packgo-travel -C "pnpm tsx server/scripts/accounting-eval.ts 2025"
 *
 * 安全:本腳本只跑 SELECT,絕不 UPDATE/INSERT/DELETE。純讀,不改帳、不改規則。
 * 發現的錯誤交 Jeff 決定要不要編進 accountingKnowledge.ts(不準猜、不自動 remap)。
 *
 * Exit code: 0 success / 1 query error.
 */
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { bankTransactions, linkedBankAccounts } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  foldEvalRows,
  toEvalMarkdown,
  type EvalRowLike,
} from "../services/accountingEvalService";

async function main() {
  const yearArg = process.argv[2];
  const year = yearArg && /^\d{4}$/.test(yearArg) ? yearArg : null;

  const db = await getDb();
  if (!db) {
    console.error("DB unavailable — DATABASE_URL not set?");
    process.exit(1);
  }

  // READ-ONLY: only rows Jeff has personally categorized are the answer key.
  // Excluded (non-business) rows carry no meaningful category prediction, so
  // skip them. Archived rows are kept — the eval spans full history.
  const where = [
    isNotNull(bankTransactions.jeffOverrideCategory),
    eq(bankTransactions.excludeFromAccounting, 0),
  ];
  if (year) {
    where.push(gte(bankTransactions.date, `${year}-01-01` as any));
    where.push(lte(bankTransactions.date, `${year}-12-31` as any));
  }

  const dbRows = await db
    .select({
      id: bankTransactions.id,
      date: bankTransactions.date,
      amount: bankTransactions.amount,
      merchantName: bankTransactions.merchantName,
      description: bankTransactions.description,
      originalDescription: bankTransactions.originalDescription,
      paymentMeta: bankTransactions.paymentMeta,
      agentCategory: bankTransactions.agentCategory,
      jeffOverrideCategory: bankTransactions.jeffOverrideCategory,
      accountName: linkedBankAccounts.accountName,
      accountType: linkedBankAccounts.accountType,
    })
    .from(bankTransactions)
    .leftJoin(
      linkedBankAccounts,
      eq(bankTransactions.linkedAccountId, linkedBankAccounts.id),
    )
    .where(and(...where))
    .orderBy(desc(bankTransactions.date));

  const rows: EvalRowLike[] = dbRows.map((r) => ({
    id: r.id,
    date: String(r.date),
    amount: r.amount as any,
    merchantName: r.merchantName,
    description: r.description,
    originalDescription: (r as any).originalDescription ?? null,
    paymentMeta: (r.paymentMeta as any) ?? null,
    accountName: r.accountName ?? null,
    accountType: (r.accountType as any) ?? null,
    agentCategory: r.agentCategory,
    jeffOverrideCategory: r.jeffOverrideCategory,
  }));

  const report = foldEvalRows(rows);
  const scope = year ? `(${year} 年)` : "(全部歷史)";
  console.log(`\n標準答案來源:prod jeffOverrideCategory ${scope}\n`);
  console.log(toEvalMarkdown(report));
  process.exit(0);
}

main().catch((err) => {
  console.error("accounting-eval failed:", err);
  process.exit(1);
});
