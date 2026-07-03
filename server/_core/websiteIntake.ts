/**
 * websiteIntake — customer-cockpit 任務7「網站渠道進場」(2026-07-03)。
 *
 * 起因(監工稽核發現的 Phase1 遺漏):網站詢問表單、站內留言、訂票事件完全
 * 沒有跟 customerProfiles / customerInteractions 串起來 —— 這些客人在
 * /ops/customers 裡不存在(沒有真相條、沒有紅點、沒有時間軸),即使他們已經
 * 透過網站真實聯絡過我們。這支補齊「進場」這一步:
 *   a. ensureCustomerProfileForWebsiteContact — 確保這位聯絡人有
 *      customerProfiles 卡(email/phone 查重照 CLAUDE.md §4.2 紅線,重用不
 *      重建;email 撞到已註冊會員就掛在會員自己的卡上,絕不建平行訪客卡)。
 *   b. recordWebsiteInteraction — 寫一筆 customerInteractions 補時間軸,
 *      inbound 方向順手 touchLastInbound 讓紅點該亮的亮。
 *
 * 呼叫端一律 fire-and-forget:網站表單/訂票這些主流程(客人看得到的回應)
 * 絕不能被這裡的失敗拖慢或搞壞,任何錯誤只 log 吞掉。
 *
 *   c. formatBookingInteractionContent — 純函式,把訂票確定性事實(團名/
 *      出發日/人數/已付金額)組成時間軸文字,不是 LLM 生成。抽成純函式方便
 *      單元測試,不用整套 mock Stripe webhook 機制。
 */
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "websiteIntake" });

/**
 * 純函式:把訂票確定性事實組成客戶時間軸的一句話事件描述。所有欄位都是
 * DB 讀出來的事實,沒有任何推論/生成——departureLabel 缺值就不寫那段,
 * 人數欄位是 0 就不列,絕不塞「0 人」這種沒意義的字。
 */
export function formatBookingInteractionContent(params: {
  tourTitle: string;
  departureLabel: string | null;
  adults: number;
  children: number;
  infants: number;
  paymentKindZh: string;
  amount: number;
  currency: string;
}): string {
  const paxParts: string[] = [];
  if (params.adults) paxParts.push(`大人 ${params.adults}`);
  if (params.children) paxParts.push(`小孩 ${params.children}`);
  if (params.infants) paxParts.push(`嬰兒 ${params.infants}`);

  return (
    `訂了「${params.tourTitle}」` +
    (params.departureLabel ? `,出發日 ${params.departureLabel}` : "") +
    (paxParts.length ? `,${paxParts.join("、")}` : "") +
    `,已付${params.paymentKindZh} $${params.amount.toFixed(2)} ${params.currency.toUpperCase()}`
  );
}

/**
 * 解析/建立這位網站聯絡人的 customerProfiles 卡,回傳 profileId(查無/建立
 * 失敗回 null,呼叫端應該誠實跳過寫互動,不要硬塞)。
 *
 * - userId 有值(已登入會員送出表單/訂票):走 ensureProfileId —— 認領同
 *   email 的既有訪客卡,或建一張最小卡,絕不重複建卡。
 * - 否則(訪客):走 resolveOrIdentifyCustomer(email/phone 查重):
 *   - "existing" → 直接回既有卡號(已跟過 0109 合併指標,拿到的是最終卡)。
 *   - "blocked_registered_member" → 這個 email 其實是某會員的,掛回該會員
 *     自己的卡(ensureProfileId),絕不建平行訪客卡分裂歷史。
 *   - "creatable" → 補建一張訪客卡。
 *   - "blocked_no_identifier" → 理論上不會發生(呼叫端的 zod schema 已強制
 *     email 必填),誠實回 null 放棄,不硬塞假身分。
 */
export async function ensureCustomerProfileForWebsiteContact(params: {
  userId?: number | null;
  email: string;
  phone?: string | null;
  name?: string | null;
}): Promise<number | null> {
  try {
    if (params.userId) {
      const { ensureProfileId } = await import("./customerAiSummary");
      return await ensureProfileId({ userId: params.userId });
    }

    const { resolveOrIdentifyCustomer } = await import("../db/customerProfile");
    const resolved = await resolveOrIdentifyCustomer({
      email: params.email,
      phone: params.phone ?? null,
    });

    if (resolved.status === "existing") {
      return resolved.profileId ?? null;
    }
    if (resolved.status === "blocked_registered_member") {
      if (!resolved.registeredUserId) return null;
      const { ensureProfileId } = await import("./customerAiSummary");
      return await ensureProfileId({ userId: resolved.registeredUserId });
    }
    if (resolved.status === "creatable") {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return null;
      const { customerProfiles } = await import("../../drizzle/schema");
      const email = params.email.trim().toLowerCase();
      const res = await db.insert(customerProfiles).values({
        email: email || null,
        phone: params.phone?.trim() || null,
        name: params.name?.trim() || null,
        source: "web_form",
      } as any);
      const insertId = (res as unknown as [{ insertId: number }])?.[0]?.insertId;
      return insertId ? Number(insertId) : null;
    }
    // blocked_no_identifier
    return null;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), email: params.email },
      "[websiteIntake] ensureCustomerProfileForWebsiteContact failed (non-fatal)",
    );
    return null;
  }
}

/**
 * 寫一筆 channel="web_form" 的 customerInteractions,inbound 方向順手
 * touchLastInbound。絕不 throw,任何失敗只 log,呼叫端一律 fire-and-forget。
 */
export async function recordWebsiteInteraction(params: {
  profileId: number;
  direction: "inbound" | "outbound";
  content: string;
  contentSummary?: string | null;
  agentName: string;
  createdAt?: Date;
}): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return false;
    const { customerInteractions } = await import("../../drizzle/schema");
    const createdAt = params.createdAt ?? new Date();
    await db.insert(customerInteractions).values({
      customerProfileId: params.profileId,
      channel: "web_form",
      direction: params.direction,
      content: params.content.slice(0, 10_000),
      contentSummary: params.contentSummary?.slice(0, 500) ?? null,
      generatedBy: "human",
      agentName: params.agentName,
      createdAt,
    } as any);
    if (params.direction === "inbound") {
      const { touchLastInbound } = await import("./customerUnread");
      await touchLastInbound(db, params.profileId, createdAt);
    }
    return true;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), profileId: params.profileId },
      "[websiteIntake] recordWebsiteInteraction failed (non-fatal)",
    );
    return false;
  }
}
