/**
 * Inquiry counter — CRM 詢問次數側效,自 repurchaseCta.ts 拆出。
 *
 * 2026-07-26 R2(P0-1,Jeff 裁定不應有付費會員機制):
 * repurchaseCta.ts 的 Plus 試用推銷整組移除。該檔原本混著兩件事:
 *   一,對客推銷 Plus 十天試用(已裁定不得存在)
 *   二,users.inquiryCount 與 lastInquiryAt 的 CRM 計數(必須保留)
 * 本檔只承接第二件。行為與原 repurchaseCta.ts:61-89 相同:
 * 查無使用者時不動任何資料,查得到就 +1 並更新 lastInquiryAt。
 * 失敗絕不讓詢問管線跟著倒(non-fatal)。
 */
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "inquiryCounter" });

export interface RecordInquiryArgs {
  senderEmail: string;
}

export async function recordInquiry(args: RecordInquiryArgs): Promise<{
  recorded: boolean;
  reason: string;
}> {
  const senderEmail = args.senderEmail?.toLowerCase().trim();
  if (!senderEmail) return { recorded: false, reason: "no_email" };

  try {
    const { getDb } = await import("../db");
    const { users } = await import("../../drizzle/schema");
    const { eq, sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recorded: false, reason: "no_db" };

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, senderEmail))
      .limit(1);
    if (rows.length === 0) return { recorded: false, reason: "user_not_found" };

    await db
      .update(users)
      .set({
        inquiryCount: sql`${users.inquiryCount} + 1`,
        lastInquiryAt: new Date(),
      })
      .where(eq(users.id, rows[0].id));

    return { recorded: true, reason: "recorded" };
  } catch (err) {
    log.error({ err }, "[inquiryCounter] Failed (non-fatal)");
    return { recorded: false, reason: "error" };
  }
}
