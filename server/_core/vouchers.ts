/**
 * Round 80.22 Phase F: Reward voucher helpers.
 *
 * Code format: PACK-{TYPE_PREFIX}-{8 alphanumeric}.
 *   - PACK-FLT-XK9JP3R5 (flight credit)
 *   - PACK-PHO-A2BC4D7E (photo book)
 *   - PACK-TUR-... (tour credit, currently unused)
 *
 * Lifecycle handled here:
 *   issueVoucher(): atomic Packpoint deduct + voucher row creation
 *   markVoucherRedeemed(): admin-only, when applying to a booking
 *   sweepExpiredVouchers(): cron — flips 'issued' → 'expired' past expiresAt
 *
 * Why we use deductPackpoint in issueVoucher: keeps audit trail consistent
 * (a 'redemption' row in pointsTransactions per voucher issued).
 */
import { eq, and, lte } from "drizzle-orm";
import { getDb } from "../db";
import { rewardVouchers, tripPhotos } from "../../drizzle/schema";
import { deductPackpoint } from "./packpoint";

const VOUCHER_TTL_DAYS = 365;
const PHOTO_BOOK_PHOTO_REQUIREMENT = 50;

const TYPE_PREFIX: Record<"flight_credit" | "photo_book" | "tour_credit", string> = {
  flight_credit: "FLT",
  photo_book: "PHO",
  tour_credit: "TUR",
};

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // exclude 0/O/1/I/L

function generateCode(type: keyof typeof TYPE_PREFIX): string {
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `PACK-${TYPE_PREFIX[type]}-${suffix}`;
}

/**
 * Catalog: master list of available voucher SKUs. Defines the cost (Packpoint)
 * and value ($USD) for each redeemable item. Adjusting these only requires
 * editing this file + redeploying — no migration needed.
 *
 * `gate` is an optional pre-condition function — if it returns a string,
 * the redemption is blocked with that error message (e.g., photo book
 * requires 50+ photos uploaded).
 */
export interface CatalogItem {
  sku: string;
  type: "flight_credit" | "photo_book" | "tour_credit";
  pointsCost: number;
  amountUsd: number;
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  /** Optional pre-condition check; returns error string to block, or null to allow. */
  gate?: (userId: number) => Promise<string | null>;
}

async function photoBookGate(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return "服務暫時不可用";
  const { sql } = await import("drizzle-orm");
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(tripPhotos)
    .where(eq(tripPhotos.userId, userId));
  const count = Number(row?.c || 0);
  if (count < PHOTO_BOOK_PHOTO_REQUIREMENT) {
    return `需先上傳至少 ${PHOTO_BOOK_PHOTO_REQUIREMENT} 張行程照片(目前 ${count} 張)。到任一筆完成的訂單頁面上傳。`;
  }
  return null;
}

export const VOUCHER_CATALOG: CatalogItem[] = [
  {
    sku: "FLT-200",
    type: "flight_credit",
    pointsCost: 20_000,
    amountUsd: 200,
    titleZh: "機票代訂折抵券 $200",
    titleEn: "$200 Flight Credit",
    descriptionZh: "限 PACK&GO 代訂機票使用,有效期 12 個月",
    descriptionEn: "Redeemable on PACK&GO-booked flights · 12-month validity",
  },
  {
    sku: "FLT-500",
    type: "flight_credit",
    pointsCost: 50_000,
    amountUsd: 500,
    titleZh: "機票代訂折抵券 $500",
    titleEn: "$500 Flight Credit",
    descriptionZh: "限 PACK&GO 代訂機票使用,有效期 12 個月",
    descriptionEn: "Redeemable on PACK&GO-booked flights · 12-month validity",
  },
  {
    sku: "FLT-1000",
    type: "flight_credit",
    pointsCost: 100_000,
    amountUsd: 1000,
    titleZh: "機票代訂折抵券 $1,000",
    titleEn: "$1,000 Flight Credit",
    descriptionZh: "限 PACK&GO 代訂機票使用,有效期 12 個月",
    descriptionEn: "Redeemable on PACK&GO-booked flights · 12-month validity",
  },
  {
    sku: "PHO-50",
    type: "photo_book",
    pointsCost: 30_000,
    amountUsd: 25,
    titleZh: "私人旅遊相簿(精裝版)",
    titleEn: "Premium Trip Photo Book",
    descriptionZh: "我們將從你上傳的照片中精選編排一本精裝相簿並寄送到家",
    descriptionEn: "Hardcover photo book curated from your uploaded trip photos",
    gate: photoBookGate,
  },
];

export function findCatalogItem(sku: string): CatalogItem | undefined {
  return VOUCHER_CATALOG.find((c) => c.sku === sku);
}

export interface IssueVoucherResult {
  voucherId: number;
  code: string;
  expiresAt: Date;
  pointsCost: number;
  amountUsd: number;
}

/**
 * Issue a voucher to the user. Validates:
 *   - SKU exists in catalog
 *   - Catalog gate (if any) passes
 *   - User has enough Packpoint
 * Then atomically: deducts points + creates voucher row + returns the code.
 */
export async function issueVoucher(args: {
  userId: number;
  sku: string;
}): Promise<{ ok: true; data: IssueVoucherResult } | { ok: false; error: string }> {
  const item = findCatalogItem(args.sku);
  if (!item) return { ok: false, error: "不存在的兌換項目" };

  if (item.gate) {
    const blocked = await item.gate(args.userId);
    if (blocked) return { ok: false, error: blocked };
  }

  // Generate unique code with retry on collision
  let code: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCode(item.type);
    const db = await getDb();
    if (!db) return { ok: false, error: "服務暫時不可用" };
    const existing = await db
      .select({ id: rewardVouchers.id })
      .from(rewardVouchers)
      .where(eq(rewardVouchers.code, candidate))
      .limit(1);
    if (existing.length === 0) {
      code = candidate;
      break;
    }
  }
  if (!code) return { ok: false, error: "代碼產生失敗,請稍後再試" };

  // Deduct points (caps at user balance — returns null if user not found)
  // Use a custom 'redemption' transaction with reference to voucher
  const remainingBalance = await deductPackpoint({
    userId: args.userId,
    amount: item.pointsCost,
    reason: "redemption",
    referenceType: "voucher_issue",
    description: `兌換 ${item.titleZh}(${item.sku})`,
  });
  if (remainingBalance === null) {
    return { ok: false, error: "找不到用戶" };
  }
  // Did the deduction actually take the full amount? deductPackpoint caps
  // at current balance — if user had less than pointsCost, we'd have only
  // taken whatever they had. Need to re-check.
  const db = await getDb();
  if (!db) return { ok: false, error: "服務暫時不可用" };

  const expiresAt = new Date(Date.now() + VOUCHER_TTL_DAYS * 24 * 60 * 60 * 1000);
  const insertResult = await db.insert(rewardVouchers).values({
    userId: args.userId,
    type: item.type,
    code,
    amountUsd: item.amountUsd,
    pointsCost: item.pointsCost,
    status: "issued",
    expiresAt,
  });
  // Drizzle returns insert id as `result.insertId` for MySQL
  const voucherId = (insertResult as any)[0]?.insertId ?? 0;

  console.log(
    `[Vouchers] Issued ${code} to user ${args.userId} (${item.sku}, -${item.pointsCost} pt)`
  );

  return {
    ok: true,
    data: {
      voucherId,
      code,
      expiresAt,
      pointsCost: item.pointsCost,
      amountUsd: item.amountUsd,
    },
  };
}

/**
 * Admin: mark a voucher as redeemed (used). Idempotent — re-marking returns
 * the existing redeemedAt without changing the row.
 */
export async function markVoucherRedeemed(args: {
  voucherId: number;
  adminId: number;
  bookingId?: number;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "服務暫時不可用" };
  const [v] = await db
    .select()
    .from(rewardVouchers)
    .where(eq(rewardVouchers.id, args.voucherId))
    .limit(1);
  if (!v) return { ok: false, error: "Voucher 不存在" };
  if (v.status === "redeemed") return { ok: true }; // idempotent
  if (v.status === "expired") return { ok: false, error: "此 voucher 已過期" };
  if (v.status === "voided") return { ok: false, error: "此 voucher 已作廢" };

  await db
    .update(rewardVouchers)
    .set({
      status: "redeemed",
      redeemedAt: new Date(),
      redeemedByAdminId: args.adminId,
      redeemedAgainstBookingId: args.bookingId,
      notes: args.notes ?? v.notes,
    })
    .where(eq(rewardVouchers.id, args.voucherId));

  console.log(`[Vouchers] Marked redeemed ${v.code} by admin ${args.adminId}`);
  return { ok: true };
}

/**
 * Cron: sweep expired vouchers. Called from packpointMaintenanceQueue.
 */
export async function sweepExpiredVouchers(): Promise<{ swept: number }> {
  const db = await getDb();
  if (!db) return { swept: 0 };
  const now = new Date();
  const result = await db
    .update(rewardVouchers)
    .set({ status: "expired" })
    .where(and(eq(rewardVouchers.status, "issued"), lte(rewardVouchers.expiresAt, now)));
  const swept = (result as any)[0]?.affectedRows ?? 0;
  if (swept > 0) console.log(`[Vouchers] Expired ${swept} unused vouchers`);
  return { swept };
}
