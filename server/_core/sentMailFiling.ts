/**
 * sentMailFiling — 自動抓「我方寄出」的附件 + 把寄出訊息記進客戶往來。
 *
 * 起因(2026-06-22 Jeff):他常直接從 Gmail 寄報價 / 行程 PDF 給客人,這些
 * 從來沒進系統,客戶頁文件 tab 永遠空的;他自己的回信也不在對話裡(只看得到
 * 客人來信)。inbound pipeline 只處理「收到」的信。這支補 outbound:
 *   1. 掃 Gmail 寄件匣裡「有附件、尚未歸檔」的信(in:sent has:attachment)。
 *   2. 收件人 email 對到「既有」客戶 profile(只比對,不新建,避免供應商/雜信
 *      製造垃圾 profile)。
 *   3. 把符合的附件(pdf/docx/xlsx/圖檔等)存成 customerDocuments(文件 tab)。
 *   4. 給訊息打上 SENT_FILED_LABEL,下次查詢 -label 排除,避免重複歸檔
 *      (沿用 inbound markAsRead 同樣「打標記=已處理」的去重法)。
 *
 * gmail-full-thread-filing [6] 降級:這支不再寫 outbound customerInteraction —
 * 我方那一邊(含純文字回覆)改由 threadFiling.syncThreadToInteractions 一條路徑收齊
 * (claim-or-insert 冪等),避免和 thread sync 雙寫同一封。這裡只負責「附件 → R2 →
 * 文件 tab」這個 thread sync 不做的部分。
 *
 * 全程 best-effort:任何一步失敗都只 log、不中斷整批(寄信早就送出了,歸檔
 * 失敗不該變成錯誤)。附件存的是 R2 KEY(同 inbound),文件路由讀時簽短連結。
 */

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { createChildLogger } from "./logger";
import {
  gmailIntegration,
  customerProfiles,
  customerDocuments,
} from "../../drizzle/schema";
import {
  buildGmailClient,
  ensureLabel,
  applyLabel,
  listSentWithAttachments,
  fetchRawAttachments,
} from "./gmail";
import { storagePut } from "../storage";
import { isCustomerDocAttachment, customerDocR2Key } from "./customerDocFiling";
import { detectAttachmentKind } from "./attachmentParser";
import { reportFunnelError } from "./errorFunnel";

const log = createChildLogger({ module: "sentMailFiling" });

/** Bookkeeping label applied to sent messages once filed (dedup, + Jeff can see what was captured). */
export const SENT_FILED_LABEL = "PackGoFiled";

/** How far back to scan on the (label-gated) backfill, and per-run cap. */
const NEWER_THAN_DAYS = 90;
const MAX_PER_RUN = 25;

/**
 * Extract every email address from a To header like
 * `"Jenny Chang <jenny@x.com>, foo@bar.com"`. Lowercased + de-duplicated.
 */
export function parseRecipientEmails(toHeader: string | null | undefined): string[] {
  if (!toHeader) return [];
  const matches = toHeader.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(matches.map((e) => e.toLowerCase())));
}

export interface SentMailCaptureResult {
  scanned: number;
  docsFiled: number;
  /**
   * Always 0 since [6] — outbound interactions are now filed solely by
   * threadFiling's thread sync (no double-write). Kept for result-shape
   * stability (gmailPollWorker logs it).
   */
  interactions: number;
}

/**
 * Scan + file this integration's recent sent-with-attachment mail. Safe to call
 * every poll: the label gate makes it idempotent and it never throws.
 */
export async function runSentMailCapture(
  integrationId: number,
): Promise<SentMailCaptureResult> {
  const empty: SentMailCaptureResult = { scanned: 0, docsFiled: 0, interactions: 0 };
  const db = await getDb();
  if (!db) return empty;

  const [integration] = await db
    .select()
    .from(gmailIntegration)
    .where(eq(gmailIntegration.id, integrationId))
    .limit(1);
  if (!integration || integration.isActive !== 1) return empty;

  const gmail = buildGmailClient(integration);
  const labelId = await ensureLabel(gmail, SENT_FILED_LABEL);

  const messages = await listSentWithAttachments(gmail, {
    excludeLabel: SENT_FILED_LABEL,
    maxResults: MAX_PER_RUN,
    newerThanDays: NEWER_THAN_DAYS,
  });

  let docsFiled = 0;
  const interactions = 0; // [6] outbound interactions moved to threadFiling thread sync

  for (const msg of messages) {
    try {
      const emails = parseRecipientEmails(msg.to);
      const rawProfiles = emails.length
        ? await db
            .select({ id: customerProfiles.id, email: customerProfiles.email })
            .from(customerProfiles)
            .where(inArray(customerProfiles.email, emails))
        : [];
      // 0109:被併走的收件人卡 → 檔到最終卡;兩個收件地址若併到同一張卡,
      // 去重避免同一附件檔兩份。
      const profiles: Array<{ id: number; email: string | null }> = [];
      if (rawProfiles.length) {
        const { followMergePointer } = await import("./mergedProfile");
        const seen = new Set<number>();
        for (const p of rawProfiles) {
          const canonicalId = await followMergePointer(db, p.id);
          if (seen.has(canonicalId)) continue;
          seen.add(canonicalId);
          profiles.push({ ...p, id: canonicalId });
        }
      }

      if (profiles.length) {
        // Only pay the raw-bytes re-fetch when something actually qualifies.
        const wanted = (msg.attachments ?? []).some((a) =>
          isCustomerDocAttachment(a.kind, a.sizeBytes),
        );
        const raw = wanted ? await fetchRawAttachments(gmail, msg.id) : [];

        for (const p of profiles) {
          // ── file document attachments (same shape as the inbound path) ──
          for (const a of raw) {
            const kind = detectAttachmentKind(a.filename, a.mimeType);
            if (!isCustomerDocAttachment(kind, a.bytes.length)) continue;
            try {
              const key = customerDocR2Key(
                p.id,
                a.filename,
                Date.now(),
                Math.random().toString(36).slice(2, 8),
              );
              const put = await storagePut(
                key,
                a.bytes,
                a.mimeType || "application/octet-stream",
              );
              await db.insert(customerDocuments).values({
                customerProfileId: p.id,
                type: "other",
                fileName: a.filename.slice(0, 255),
                r2Url: put.key,
                uploadedBy: "email_sent",
              });
              docsFiled++;
            } catch (e) {
              log.warn(
                { err: e, profileId: p.id },
                "[sentMailFiling] one attachment failed (non-fatal)",
              );
              reportFunnelError({ source: "fail-open:sentMailFiling:attachmentUpload", err: e, context: { profileId: p.id, messageId: msg.id } }).catch(() => {});
            }
          }

          // [6] 降級:outbound customerInteraction 不再在此寫入 — 由 threadFiling 的
          // thread sync 一條路徑收齊我方訊息(避免雙寫)。這裡只做附件 → R2。
        }
      }

      // Label even when nothing matched, so we never rescan this message.
      await applyLabel(gmail, msg.id, labelId);
    } catch (e) {
      log.warn(
        { err: e, messageId: msg.id },
        "[sentMailFiling] message failed (non-fatal)",
      );
    }
  }

  return { scanned: messages.length, docsFiled, interactions };
}
