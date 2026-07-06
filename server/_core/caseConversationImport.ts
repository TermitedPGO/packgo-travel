/**
 * caseConversationImport — 批十一 塊C「案件對話紀錄進場」。
 *
 * 把案件夾 來源/ 裡的對話候選檔(.txt / .md,如 David 的「出票進度與訊息.md」這種帶日期的
 * 往來紀錄)逐檔餵給既有 chatLogImport 管線(importChatLogForCustomer)。所有安全機制都沿用
 * 那條:classifyAndExtractChatLog 判斷是不是對話紀錄(不是就 not_a_chat_log 跳過)、resolveEventDate
 * 未來日期防呆(未來日期一律不建互動)、認人守門(participantMatch)、(content, minute)去重。
 * 本檔只加「批次 + 從 folderName 解析客人卡」的薄協調層,不重造任何解析/日期邏輯。
 *
 * 範圍說明:案件資料.md 本身是結構化案件檔(表格/行程/報價),整檔餵給對話分類器會被判
 * not_a_chat_log,故不餵;真正的往來對話在 來源/ 的對話 .md,本檔覆蓋到。dry_run 走完
 * classify+build 但不寫入,回 would-import 預覽。
 */
import { createChildLogger } from "./logger";
import { caseImportTraceMarker, escapeLikePattern, LIKE_ESCAPE_CHAR } from "./caseFileImport";
import { importChatLogForCustomer, type ImportChatLogResult } from "./chatLogImport";

const log = createChildLogger({ module: "caseConversationImport" });

const CONVO_EXTENSIONS = new Set([".txt", ".md"]);

export function fileExtLower(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** 對話候選檔:來源/ 下的 .txt / .md(非隱藏檔)。classifier 再決定是不是真的對話紀錄。 */
export function isConversationCandidate(name: string): boolean {
  const n = name.trim();
  if (n.startsWith(".")) return false;
  return CONVO_EXTENSIONS.has(fileExtLower(n));
}

export interface CaseConvoFileInput {
  name: string;
  text: string;
}

export interface CaseConvoFileResult {
  name: string;
  status: ImportChatLogResult["status"];
  dryRun?: boolean;
  importedCount?: number;
  droppedCount?: number;
  note?: string;
  unverifiedNoName?: boolean;
}

export interface CaseConvoImportResult {
  status: "case_not_imported" | "db_unavailable" | "done" | "error";
  folderName: string;
  profileId?: number;
  customerName?: string | null;
  files?: CaseConvoFileResult[];
  totalImported?: number;
  warnings?: string[];
}

/**
 * 協調:folderName → 該案訂單的 customerProfileId + 客人名 → 逐檔(對話候選)過
 * importChatLogForCustomer。dry_run 只預覽不寫。整段 try/catch,失敗回 error。
 */
export async function importCaseConversations(
  params: { folderName: string; files: CaseConvoFileInput[] },
  mode: "dry_run" | "confirm",
): Promise<CaseConvoImportResult> {
  const { folderName, files } = params;
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { status: "db_unavailable", folderName };

    const { customOrders, customerProfiles } = await import("../../drizzle/schema");
    const { eq, sql } = await import("drizzle-orm");

    const [order] = await db
      .select({ customerProfileId: customOrders.customerProfileId })
      .from(customOrders)
      .where(sql`${customOrders.notes} LIKE ${`%${escapeLikePattern(caseImportTraceMarker(folderName))}%`} ESCAPE ${LIKE_ESCAPE_CHAR}`)
      .limit(1);
    if (!order) {
      return {
        status: "case_not_imported",
        folderName,
        warnings: ["找不到這個案件的訂單(先用 import-case-file 匯入案件資料.md)"],
      };
    }

    const [prof] = (await db
      .select({ name: customerProfiles.name })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, order.customerProfileId))
      .limit(1)) as Array<{ name: string | null }>;
    const customerName = prof?.name ?? null;

    const results: CaseConvoFileResult[] = [];
    let totalImported = 0;
    for (const f of files) {
      if (!isConversationCandidate(f.name)) continue;
      const r = await importChatLogForCustomer({
        customerProfileId: order.customerProfileId,
        text: f.text,
        filename: f.name,
        customerName,
        mode,
      });
      results.push({
        name: f.name,
        status: r.status,
        dryRun: r.dryRun,
        importedCount: r.importedCount,
        droppedCount: r.droppedCount,
        note: r.note,
        unverifiedNoName: r.unverifiedNoName,
      });
      if (r.status === "imported" && !r.dryRun) totalImported += r.importedCount ?? 0;
    }

    log.info({ folderName, profileId: order.customerProfileId, mode, files: results.length }, "[caseConversationImport] done");
    return { status: "done", folderName, profileId: order.customerProfileId, customerName, files: results, totalImported };
  } catch (err) {
    log.warn(
      { folderName, err: err instanceof Error ? err.message : String(err) },
      "[caseConversationImport] failed",
    );
    return { status: "error", folderName, warnings: [err instanceof Error ? err.message : String(err)] };
  }
}
