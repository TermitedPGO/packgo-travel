/**
 * Year-End Export Service (Phase 6).
 *
 * Given a tax year, produces a ZIP containing CSVs the CPA can use to
 * file Schedule C. Output:
 *
 *   {year}-packgo-taxprep/
 *     ├── all_transactions.csv          — every txn, full detail
 *     ├── schedule_c_summary.csv        — totals by Schedule C line
 *     ├── category_breakdown.csv        — totals by PACK&GO category
 *     ├── trust_account_reconciliation.csv — trust account txns only
 *     ├── vendor_payments_1099.csv      — payments to non-corp vendors > $600
 *     └── README.txt                    — what each file is, how the
 *                                         categorization works, links
 *                                         to Schedule C instructions
 *
 * Uploaded to R2 under `tax-export/{userId}/{year}.zip`. Returns a
 * pre-signed URL. The CPA can download once; we don't auto-email
 * because the URL is signed for hours-not-days and we want the admin
 * to copy the link into their preferred channel.
 *
 * IRS 1099-NEC threshold:
 *   $600 per recipient per year for non-corporation vendors. We surface
 *   any merchantName aggregating > $600 in cogs_* + expense_* with
 *   isLikelyCorporation=false. The "corp" heuristic is best-effort —
 *   marked clearly in the CSV so the CPA can correct manually.
 */

import JSZip from "jszip";
import { getDb } from "../db";
import {
  bankTransactions,
  linkedBankAccounts,
} from "../../drizzle/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { storagePut } from "../storage";
import { SCHEDULE_C_MAP } from "./bankPLService";
import type { AccountingCategory } from "../agents/autonomous/accountingAgent";

const IRS_1099_THRESHOLD = 600; // USD per recipient per year

// Best-effort: vendors that are corporations don't require 1099-NEC.
// Pattern match on common corp suffixes. CPA will verify.
const CORP_HINTS = [
  /\binc\.?$/i,
  /\bllc$/i,
  /\bcorporation$/i,
  /\bcorp\.?$/i,
  /\bcompany$/i,
  /\bco\.?$/i,
  /\bltd\.?$/i,
  // Big tech / payment processors we know are incorporated
  /^(stripe|google|amazon|aws|microsoft|adobe|anthropic|openai|cloudflare|vercel|github|meta|facebook|paypal|chase|capital one|bank of america|wells fargo)$/i,
];

function isLikelyCorporation(merchantName: string | null): boolean {
  if (!merchantName) return false;
  return CORP_HINTS.some((rx) => rx.test(merchantName.trim()));
}

/** CSV escape: quote-wrap and double internal quotes. */
function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

export interface YearEndExportResult {
  year: number;
  url: string;
  sizeBytes: number;
  filename: string;
  fileCounts: {
    transactions: number;
    vendors1099: number;
    trustAccountTxns: number;
  };
}

export async function generateYearEndExport(opts: {
  userId: number;
  year: number;
}): Promise<YearEndExportResult> {
  const { userId, year } = opts;
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Pull all transactions in window for this user (incl. excluded, so the
  // CSV is a complete audit trail; the CPA can filter).
  const rows = await db
    .select({
      id: bankTransactions.id,
      date: bankTransactions.date,
      authorizedDate: bankTransactions.authorizedDate,
      amount: bankTransactions.amount,
      isoCurrencyCode: bankTransactions.isoCurrencyCode,
      merchantName: bankTransactions.merchantName,
      description: bankTransactions.description,
      paymentChannel: bankTransactions.paymentChannel,
      plaidCategoryPrimary: bankTransactions.plaidCategoryPrimary,
      plaidCategoryDetailed: bankTransactions.plaidCategoryDetailed,
      agentCategory: bankTransactions.agentCategory,
      agentConfidence: bankTransactions.agentConfidence,
      jeffOverrideCategory: bankTransactions.jeffOverrideCategory,
      jeffOverrideReason: bankTransactions.jeffOverrideReason,
      excludeFromAccounting: bankTransactions.excludeFromAccounting,
      excludeReason: bankTransactions.excludeReason,
      isPending: bankTransactions.isPending,
      institutionName: linkedBankAccounts.institutionName,
      accountName: linkedBankAccounts.accountName,
      accountMask: linkedBankAccounts.accountMask,
      accountType: linkedBankAccounts.accountType,
      isTrustAccount: linkedBankAccounts.isTrustAccount,
      ownerUserId: linkedBankAccounts.userId,
    })
    .from(bankTransactions)
    .leftJoin(
      linkedBankAccounts,
      eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
    )
    .where(
      and(
        eq(linkedBankAccounts.userId, userId),
        gte(bankTransactions.date, start as any),
        lte(bankTransactions.date, end as any)
      )
    )
    .orderBy(bankTransactions.date);

  // ── 1. all_transactions.csv ─────────────────────────────────────────────
  const allTxnsHeader = csvRow([
    "id",
    "date",
    "authorized_date",
    "amount",
    "currency",
    "merchant",
    "description",
    "channel",
    "plaid_pfc_primary",
    "plaid_pfc_detailed",
    "agent_category",
    "agent_confidence",
    "jeff_override_category",
    "jeff_override_reason",
    "final_category",
    "schedule_c_line",
    "excluded",
    "exclude_reason",
    "is_pending",
    "institution",
    "account_name",
    "account_mask",
    "account_type",
    "is_trust_account",
  ]);
  const allTxnsLines = [allTxnsHeader];
  for (const r of rows) {
    const finalCat = (r.jeffOverrideCategory ?? r.agentCategory) as
      | AccountingCategory
      | null;
    const schedC = finalCat ? SCHEDULE_C_MAP[finalCat] ?? "" : "";
    allTxnsLines.push(
      csvRow([
        r.id,
        r.date,
        r.authorizedDate ?? "",
        r.amount,
        r.isoCurrencyCode,
        r.merchantName ?? "",
        r.description ?? "",
        r.paymentChannel ?? "",
        r.plaidCategoryPrimary ?? "",
        r.plaidCategoryDetailed ?? "",
        r.agentCategory ?? "",
        r.agentConfidence ?? "",
        r.jeffOverrideCategory ?? "",
        r.jeffOverrideReason ?? "",
        finalCat ?? "",
        schedC,
        r.excludeFromAccounting === 1 ? "yes" : "",
        r.excludeReason ?? "",
        r.isPending === 1 ? "yes" : "",
        r.institutionName ?? "",
        r.accountName ?? "",
        r.accountMask ?? "",
        r.accountType ?? "",
        r.isTrustAccount === 1 ? "yes" : "",
      ])
    );
  }

  // ── 2. schedule_c_summary.csv ──────────────────────────────────────────
  // Sum amounts by Schedule C line (signed: positive = expense, negative = income).
  const byScheduleC = new Map<string, { line: string; total: number; count: number }>();
  for (const r of rows) {
    if (r.excludeFromAccounting === 1) continue;
    if (r.isPending === 1) continue;
    const cat = (r.jeffOverrideCategory ?? r.agentCategory) as
      | AccountingCategory
      | null;
    if (!cat) continue;
    if (cat === "transfer" || cat === "other_review") continue;
    const line = SCHEDULE_C_MAP[cat] ?? "(unknown)";
    const amt = parseFloat(r.amount as any) || 0;
    const slot = byScheduleC.get(line) ?? { line, total: 0, count: 0 };
    slot.total += amt;
    slot.count++;
    byScheduleC.set(line, slot);
  }
  const schedCLines = [csvRow(["schedule_c_line", "total_signed", "abs_total", "transaction_count"])];
  for (const v of byScheduleC.values()) {
    schedCLines.push(
      csvRow([v.line, v.total.toFixed(2), Math.abs(v.total).toFixed(2), v.count])
    );
  }

  // ── 3. category_breakdown.csv ──────────────────────────────────────────
  const byCat = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    if (r.excludeFromAccounting === 1) continue;
    if (r.isPending === 1) continue;
    const cat = (r.jeffOverrideCategory ?? r.agentCategory) ?? "(uncategorized)";
    const amt = parseFloat(r.amount as any) || 0;
    const slot = byCat.get(cat) ?? { total: 0, count: 0 };
    slot.total += amt;
    slot.count++;
    byCat.set(cat, slot);
  }
  const catLines = [csvRow(["category", "total_signed", "abs_total", "count"])];
  for (const [cat, v] of byCat.entries()) {
    catLines.push(csvRow([cat, v.total.toFixed(2), Math.abs(v.total).toFixed(2), v.count]));
  }

  // ── 4. trust_account_reconciliation.csv ────────────────────────────────
  const trustLines = [
    csvRow(["date", "amount", "merchant", "description", "category", "schedule_c_line", "excluded"]),
  ];
  let trustAccountTxns = 0;
  for (const r of rows) {
    if (r.isTrustAccount !== 1) continue;
    trustAccountTxns++;
    const cat = (r.jeffOverrideCategory ?? r.agentCategory) as
      | AccountingCategory
      | null;
    trustLines.push(
      csvRow([
        r.date,
        r.amount,
        r.merchantName ?? "",
        r.description ?? "",
        cat ?? "",
        cat ? SCHEDULE_C_MAP[cat] ?? "" : "",
        r.excludeFromAccounting === 1 ? "yes" : "",
      ])
    );
  }

  // ── 5. vendor_payments_1099.csv ────────────────────────────────────────
  const vendorTotals = new Map<
    string,
    { total: number; count: number; isLikelyCorp: boolean }
  >();
  for (const r of rows) {
    if (r.excludeFromAccounting === 1) continue;
    if (r.isPending === 1) continue;
    if (!r.merchantName) continue;
    const cat = (r.jeffOverrideCategory ?? r.agentCategory) as
      | AccountingCategory
      | null;
    // Only count outflows that count toward 1099 (cogs + expenses, not refund/transfer/income)
    if (
      !cat ||
      cat === "transfer" ||
      cat === "other_review" ||
      cat === "refund" ||
      cat === "income_booking"
    )
      continue;
    const amt = parseFloat(r.amount as any) || 0;
    if (amt <= 0) continue; // Only outflows (vendor PAID)
    const key = r.merchantName.trim();
    const slot = vendorTotals.get(key) ?? {
      total: 0,
      count: 0,
      isLikelyCorp: isLikelyCorporation(key),
    };
    slot.total += amt;
    slot.count++;
    vendorTotals.set(key, slot);
  }
  const vendor1099Lines = [
    csvRow([
      "vendor",
      "total_paid",
      "transaction_count",
      "is_likely_corp",
      "requires_1099_NEC",
    ]),
  ];
  let vendors1099 = 0;
  for (const [vendor, v] of Array.from(vendorTotals.entries()).sort(
    ([, a], [, b]) => b.total - a.total
  )) {
    const requires = v.total >= IRS_1099_THRESHOLD && !v.isLikelyCorp;
    if (requires) vendors1099++;
    if (v.total >= IRS_1099_THRESHOLD) {
      vendor1099Lines.push(
        csvRow([
          vendor,
          v.total.toFixed(2),
          v.count,
          v.isLikelyCorp ? "yes" : "no",
          requires ? "YES — file 1099-NEC" : "no (corp or under threshold)",
        ])
      );
    }
  }

  // ── 6. README.txt ──────────────────────────────────────────────────────
  const readme = `PACK&GO LLC — ${year} 報稅資料匯出
Generated by Plaid-driven bookkeeping system on ${new Date().toISOString()}

===== Files =====

all_transactions.csv
  完整交易明細,${rows.length} 筆。包含 Plaid 同步進來的所有銀行+信用卡交易。
  欄位:
    - final_category 是 Jeff override > AccountingAgent 分類的結果
    - schedule_c_line 是對應到 IRS Schedule C 報稅行號
    - excluded=yes 表示 Jeff 標記排除(個人項目等),不計入 P&L
    - is_pending=yes 表示尚未結算,通常會在下次同步更新最終金額

schedule_c_summary.csv
  按 Schedule C 行號彙總。CPA 直接填表。
  - total_signed: Plaid 慣例 +outflow / -inflow (CPA 注意)
  - abs_total: 絕對值,大多數情況 CPA 想看的數字

category_breakdown.csv
  按 PACK&GO 10 類別彙總。Cross-check schedule_c_summary 用。

trust_account_reconciliation.csv
  信託帳戶交易明細 (CST §17550 合規)。${trustAccountTxns} 筆。
  注意: Phase 4 (信託 deferral 邏輯) 尚未上線,目前所有信託入帳即計入收入。
  CPA 如需處理 trust 帳務,可從這檔自行調整出發日期前後的歸屬。

vendor_payments_1099.csv
  年內付給單一供應商 ≥ \$${IRS_1099_THRESHOLD} 的明細。${vendors1099} 個供應商
  系統判斷需要寄發 1099-NEC。is_likely_corp 是基於商家名稱關鍵字
  (Inc, LLC, Corp 等) 的最佳猜測 — CPA 請人工 verify。

===== AccountingAgent 分類邏輯 =====

10 個類別:
  cogs_tour          - 旅行團直接成本 (供應商付款) → Schedule C Line 4
  cogs_other         - 其他直接成本 (Stripe 手續費等) → Schedule C Line 4
  expense_marketing  - 行銷支出 → Schedule C Line 8
  expense_software   - 軟體訂閱 → Schedule C Line 18
  expense_office     - 辦公支出 → Schedule C Line 18
  expense_travel     - 商務差旅 → Schedule C Line 24a
  income_booking     - 預訂收入 → Schedule C Line 1
  refund             - 退款 → Schedule C Line 2 (net 在 Line 1 上)
  transfer           - 內部轉帳,不影響損益
  other_review       - Agent 信心不足,等 Jeff 確認

Agent 信心 (agent_confidence 欄位):
  >= 80: 自動套用
  60-79: 套用但會 flag review (在 admin UI 上)
  < 60:  強制 = other_review,Jeff 必須人工分類

===== 已知 limitations =====

1. 信託 deferral 尚未上線。如果你預付了 2026/3 的團費,系統會把
   2025/12 的入帳算成 2025 的 income。CPA 看 trust_account_reconciliation
   自行調整。

2. Agent 可能誤判個人項目。Jeff 應在 admin UI 上 review_needed 的交易,
   標記 excludeFromAccounting=yes 排除個人消費。

3. 多幣別:大多數交易是 USD。少數外幣交易已記入 amount 欄位的原幣值,
   CPA 如需轉 USD,請用 IRS 年度平均匯率。

===== 聯絡 =====
有問題: jeffhsieh09@gmail.com
`;

  // ── Build ZIP ──────────────────────────────────────────────────────────
  const zip = new JSZip();
  const folder = zip.folder(`${year}-packgo-taxprep`);
  if (!folder) throw new Error("Failed to create ZIP folder");
  folder.file("all_transactions.csv", allTxnsLines.join("\n") + "\n");
  folder.file("schedule_c_summary.csv", schedCLines.join("\n") + "\n");
  folder.file("category_breakdown.csv", catLines.join("\n") + "\n");
  folder.file(
    "trust_account_reconciliation.csv",
    trustLines.join("\n") + "\n"
  );
  folder.file("vendor_payments_1099.csv", vendor1099Lines.join("\n") + "\n");
  folder.file("README.txt", readme);

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // Upload to R2 under per-user namespace
  const filename = `${year}-packgo-taxprep.zip`;
  const key = `tax-export/${userId}/${filename}`;
  const { url } = await storagePut(key, zipBuffer, "application/zip");

  return {
    year,
    url,
    sizeBytes: zipBuffer.length,
    filename,
    fileCounts: {
      transactions: rows.length,
      vendors1099,
      trustAccountTxns,
    },
  };
}
