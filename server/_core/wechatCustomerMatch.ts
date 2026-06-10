/**
 * wechatCustomerMatch — 微信歸戶 lookup (批2 m5).
 *
 * OA inbound carries a fromOpenId; customerProfiles stores wechatId per
 * customer. When they match AND the profile is linked to a registered user,
 * the wechat message lands in that customer's workspace timeline. Honest
 * degradation: no match / guest profile / db down → null (message stays
 * unassigned, 人工補配 later).
 */
import { eq, and, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { customerProfiles } from "../../drizzle/schema";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "wechatCustomerMatch" });

export async function findCustomerUserIdByOpenId(
  openId: string | null | undefined,
): Promise<number | null> {
  const id = openId?.trim();
  if (!id) return null;
  const db = await getDb();
  if (!db) {
    log.warn("[wechatCustomerMatch] db unavailable — message stays unassigned");
    return null;
  }
  const rows = await db
    .select({ userId: customerProfiles.userId })
    .from(customerProfiles)
    .where(
      and(
        eq(customerProfiles.wechatId, id),
        isNotNull(customerProfiles.userId),
      ),
    )
    .limit(1);
  return rows[0]?.userId ?? null;
}
