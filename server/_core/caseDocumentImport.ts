/**
 * caseDocumentImport — 批十一 塊A「案件夾文件進場」。
 *
 * 掃一個已匯入案件(caseFileImport 已建過訂單)的 交付/ 與 來源/ 子夾,把真實文件
 * 檔(PDF/Excel/Word/圖)逐檔上傳 R2 並寫一列 customerDocuments,掛到該案的訂單。
 * .md / .txt / .DS_Store / 隱藏檔一律跳過(那是案件工作筆記,由塊B 教訓 / 塊C 對話進場
 * 各自處理,不當客人文件歸檔)。
 *
 * ⛔ 架構級硬紅線(對抗審查必驗):案件文件的 R2 key 永遠走 customer-docs/ 前綴
 * (customerDocR2Key),絕不落在 reply-attachments/(那是寄信附件白名單 —— 只要不在那個
 * 前綴,resolveReplyAttachments 就會拒絕,供應商成本/invoice 便架構上不可能被誤寄給客人)。
 * assertNotOutboundKey 在每次上傳前硬擋一次,並有紅例單元測試。
 *
 * 冪等:同案(同訂單)同 fileName 的 case_import 文件只寫一次;重跑 confirm 不重複。
 * dry_run 只讀本地檔清單分類,不碰 R2/DB,回「每檔:型別 / 去向 / 大小 / 動作」。
 *
 * 三層職責(照 caseFileImport / chatLogImport pattern):純分類/計畫(classifyCaseDoc,
 * buildCaseDocPlan)+ 唯一碰 R2/DB 的協調函式(importCaseDocuments)。
 */
import { createChildLogger } from "./logger";
import { caseImportTraceMarker, escapeLikePattern, LIKE_ESCAPE_CHAR } from "./caseFileImport";
import { customerDocR2Key } from "./customerDocFiling";
import { REPLY_ATTACHMENT_KEY_PREFIX } from "./replyAttachments";

const log = createChildLogger({ module: "caseDocumentImport" });

export type CaseDocType = "passport" | "visa" | "insurance" | "medical" | "other";

/** 兩個要掃的子夾。 */
export const CASE_DOC_SUBFOLDERS = ["交付", "來源"] as const;
export type CaseDocSubfolder = (typeof CASE_DOC_SUBFOLDERS)[number];

/** 上傳為 customerDocuments 的文件副檔名(真實文件檔)。.md/.txt/隱藏檔不在此列。 */
const DOC_EXTENSIONS = new Set([
  ".pdf",
  ".xlsx",
  ".xls",
  ".docx",
  ".doc",
  ".csv",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".webp",
]);

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".csv": "text/csv",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".webp": "image/webp",
};

export function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

export function contentTypeForName(name: string): string {
  return CONTENT_TYPE_BY_EXT[fileExt(name)] ?? "application/octet-stream";
}

const PASSPORT_RE = /passport|護照|护照/i;
const VISA_RE = /visa|簽證|签证/i;
const INSURANCE_RE = /insurance|保險|保险/i;
const MEDICAL_RE = /medical|醫療|医疗|病歷|病历/i;

export interface CaseDocClassification {
  /** 是否要當文件上傳(false = 跳過:.md/.txt/隱藏檔/未知副檔名)。 */
  upload: boolean;
  /** 跳過原因(upload=false 時填),供 dry_run 誠實列出。 */
  skipReason?: "not_document_artifact" | "hidden_or_meta";
  type: CaseDocType;
  /** 供應商成本/來源類 = 內部文件(customer-docs/ 已保證不可外寄,這欄只是給人看的標記)。 */
  isInternalCost: boolean;
}

/**
 * Pure:依「子夾 + 檔名」分類。護照/簽證/保險/醫療 → 對應 PII type;其餘走 "other",
 * 來源/ 的非 PII 檔標 isInternalCost(供應商 invoice/報價/成本);交付/ 是給客人的產物,
 * 非內部成本。.md/.txt/.DS_Store/隱藏檔 → upload:false(工作筆記,不歸檔為客人文件)。
 */
export function classifyCaseDoc(subfolder: CaseDocSubfolder, name: string): CaseDocClassification {
  const base = name.trim();
  if (base.startsWith(".")) {
    return { upload: false, skipReason: "hidden_or_meta", type: "other", isInternalCost: false };
  }
  const ext = fileExt(base);
  if (!DOC_EXTENSIONS.has(ext)) {
    // .md（案件工作筆記,塊B/C 處理)、.txt、其他非文件檔一律不當客人文件歸檔。
    return { upload: false, skipReason: "not_document_artifact", type: "other", isInternalCost: false };
  }
  if (PASSPORT_RE.test(base)) return { upload: true, type: "passport", isInternalCost: false };
  if (VISA_RE.test(base)) return { upload: true, type: "visa", isInternalCost: false };
  if (INSURANCE_RE.test(base)) return { upload: true, type: "insurance", isInternalCost: false };
  if (MEDICAL_RE.test(base)) return { upload: true, type: "medical", isInternalCost: false };
  // 非 PII:來源/ = 供應商/內部素材(成本);交付/ = 給客人的產物。
  return { upload: true, type: "other", isInternalCost: subfolder === "來源" };
}

/**
 * ⛔ 硬紅線守門:案件文件的 key 絕不可落在 reply-attachments/ 前綴(寄信附件白名單)。
 * 每次上傳前呼叫;命中就 throw,寧可整批擋下也不讓供應商成本文件有一絲被外寄的可能。
 */
export function assertNotOutboundKey(key: string): void {
  if (key.startsWith(REPLY_ATTACHMENT_KEY_PREFIX)) {
    throw new Error(
      `caseDocumentImport 架構紅線違反:案件文件 key 落在寄信附件白名單前綴 (${key}) —— 供應商成本文件不可能被外寄,一律走 customer-docs/`,
    );
  }
}

// ── 檔案輸入 + 計畫(純)──────────────────────────────────────────────────────

export interface CaseDocFileInput {
  /** 子夾:交付 或 來源。 */
  subfolder: CaseDocSubfolder;
  /** 原始檔名(中文保留)。 */
  name: string;
  /** 檔案大小(bytes),dry_run 用來預覽,不需解 base64。 */
  sizeBytes: number;
  /** 檔案內容 base64(confirm 才需要;dry_run 可省)。 */
  base64?: string;
}

export type CaseDocAction = "upload" | "skip_duplicate" | "skip_not_document";

export interface CaseDocPlanEntry {
  subfolder: CaseDocSubfolder;
  name: string;
  sizeBytes: number;
  type: CaseDocType;
  isInternalCost: boolean;
  action: CaseDocAction;
}

/**
 * Pure:把檔案清單 + 「已匯入的 fileName 集合」組成計畫。已存在(同 fileName)→
 * skip_duplicate;非文件檔 → skip_not_document;其餘 → upload。dry_run 直接回這個。
 */
export function buildCaseDocPlan(
  files: CaseDocFileInput[],
  alreadyImportedFileNames: Set<string>,
): CaseDocPlanEntry[] {
  return files.map((f) => {
    const cls = classifyCaseDoc(f.subfolder, f.name);
    let action: CaseDocAction;
    if (!cls.upload) action = "skip_not_document";
    else if (alreadyImportedFileNames.has(f.name.slice(0, 255))) action = "skip_duplicate";
    else action = "upload";
    return {
      subfolder: f.subfolder,
      name: f.name,
      sizeBytes: f.sizeBytes,
      type: cls.type,
      isInternalCost: cls.isInternalCost,
      action,
    };
  });
}

export interface CaseDocPlanStats {
  total: number;
  toUpload: number;
  skippedDuplicate: number;
  skippedNotDocument: number;
}

export function summarizeCaseDocPlan(plan: CaseDocPlanEntry[]): CaseDocPlanStats {
  return {
    total: plan.length,
    toUpload: plan.filter((p) => p.action === "upload").length,
    skippedDuplicate: plan.filter((p) => p.action === "skip_duplicate").length,
    skippedNotDocument: plan.filter((p) => p.action === "skip_not_document").length,
  };
}

// ── 協調函式(唯一碰 R2/DB)──────────────────────────────────────────────────

export interface CaseDocImportResult {
  status: "case_not_imported" | "db_unavailable" | "dry_run" | "imported" | "error";
  folderName: string;
  orderId?: number;
  profileId?: number;
  plan?: CaseDocPlanEntry[];
  stats?: CaseDocPlanStats;
  uploaded?: number;
  warnings?: string[];
}

/**
 * 協調:folderName → 用 caseFileImport 的 trace marker 找到該案訂單(customerProfileId +
 * orderId)→ dry_run 回計畫;confirm 逐檔上傳(customer-docs/ key,硬擋 outbound 前綴)+
 * 寫 customerDocuments(uploadedBy='case_import',掛單)。整段 try/catch,失敗回 error。
 * now/rand 可注入以便測試。
 */
export async function importCaseDocuments(
  params: { folderName: string; files: CaseDocFileInput[] },
  mode: "dry_run" | "confirm",
  deps?: { now?: () => number; rand?: () => string },
): Promise<CaseDocImportResult> {
  const { folderName, files } = params;
  const warnings: string[] = [];
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { status: "db_unavailable", folderName };

    const { customOrders, customerDocuments } = await import("../../drizzle/schema");
    const { and, eq, sql } = await import("drizzle-orm");

    // 用與 caseFileImport 完全相同的 folderName trace marker 找該案訂單。
    const likePattern = `%${escapeLikePattern(caseImportTraceMarker(folderName))}%`;
    const [order] = await db
      .select({ id: customOrders.id, customerProfileId: customOrders.customerProfileId })
      .from(customOrders)
      .where(sql`${customOrders.notes} LIKE ${likePattern} ESCAPE ${LIKE_ESCAPE_CHAR}`)
      .limit(1);
    if (!order) {
      return {
        status: "case_not_imported",
        folderName,
        warnings: ["找不到這個案件的訂單(先用 import-case-file 匯入案件資料.md 才能掛文件)"],
      };
    }

    // 冪等:這張單已經 case_import 過的 fileName。
    const existing = (await db
      .select({ fileName: customerDocuments.fileName })
      .from(customerDocuments)
      .where(
        and(
          eq(customerDocuments.customOrderId, order.id),
          eq(customerDocuments.uploadedBy, "case_import"),
        ),
      )) as Array<{ fileName: string | null }>;
    const alreadyImported = new Set(
      existing.map((e) => e.fileName).filter((n): n is string => n != null),
    );

    const plan = buildCaseDocPlan(files, alreadyImported);
    const stats = summarizeCaseDocPlan(plan);

    if (mode === "dry_run") {
      return { status: "dry_run", folderName, orderId: order.id, profileId: order.customerProfileId, plan, stats };
    }

    const { storagePut } = await import("../storage");
    const now = deps?.now ?? (() => Date.now());
    const rand = deps?.rand ?? (() => Math.random().toString(36).slice(2, 8));

    let uploaded = 0;
    for (let i = 0; i < files.length; i++) {
      const entry = plan[i];
      if (entry.action !== "upload") continue;
      const f = files[i];
      if (!f.base64) {
        warnings.push(`${f.name}:confirm 缺 base64 內容,跳過`);
        continue;
      }
      const cls = classifyCaseDoc(f.subfolder, f.name);
      const key = customerDocR2Key(order.customerProfileId, f.name, now(), rand());
      assertNotOutboundKey(key); // ⛔ 硬紅線:永遠不可能是 reply-attachments/
      const buffer = Buffer.from(f.base64, "base64");
      const put = await storagePut(key, buffer, contentTypeForName(f.name));
      assertNotOutboundKey(put.key); // storagePut normalizeKey 後再驗一次
      await db.insert(customerDocuments).values({
        customerProfileId: order.customerProfileId,
        customOrderId: order.id,
        type: cls.type,
        fileName: f.name.slice(0, 255),
        r2Url: put.key, // 存 KEY(signDocUrl 讀時簽短效 URL);永遠不外寄
        uploadedBy: "case_import",
      });
      uploaded++;
    }

    log.info({ folderName, orderId: order.id, uploaded, stats }, "[caseDocumentImport] imported");
    return {
      status: "imported",
      folderName,
      orderId: order.id,
      profileId: order.customerProfileId,
      plan,
      stats,
      uploaded,
      ...(warnings.length ? { warnings } : {}),
    };
  } catch (err) {
    log.warn(
      { folderName, err: err instanceof Error ? err.message : String(err) },
      "[caseDocumentImport] failed",
    );
    return { status: "error", folderName, warnings: [err instanceof Error ? err.message : String(err)] };
  }
}
