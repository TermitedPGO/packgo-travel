// server/_core/paymentProvider.ts — 金流付款連結介面(訂製單催款用)。
//
// 決策 D(design.md §〇/§4.3):本批「先抽介面、暫不接真 Square」。
// sendCollection 會先問 provider 要不要自動產生付款連結;ManualPaymentProvider
// 一律回 null,呼叫端就用 Jeff 手貼的連結。日後接真 Square 時新增一個
// SquarePaymentProvider(Payment Links API CreatePaymentLink,讀 SQUARE_ACCESS_TOKEN
// + SQUARE_LOCATION_ID),env 缺就 fall back 回 Manual,呼叫端完全不用改。
//
// 注意:這層只「產生付款連結」。錢有沒有真的收到,是 recordPayment 由 Jeff 手動
// 確認(真相在銀行 / Square),本介面不回報收款狀態。

export interface PaymentLinkArgs {
  amountCents: number;
  currency: string;
  orderNumber: string;
  /** 直客面描述(絕不含成本) */
  description: string;
}

export interface PaymentProvider {
  /** 回 null = 此 provider 不自動產生連結(由 Jeff 手貼)。 */
  createPaymentLink(args: PaymentLinkArgs): Promise<{ url: string } | null>;
}

/** 本批預設:不自動產生,Jeff 手貼 Square 連結。 */
export class ManualPaymentProvider implements PaymentProvider {
  async createPaymentLink(_args: PaymentLinkArgs): Promise<{ url: string } | null> {
    return null;
  }
}

let cached: PaymentProvider | null = null;

/**
 * 取得目前的 provider。本批一律 Manual。日後:
 *   if (process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID)
 *     return new SquarePaymentProvider(...);
 */
export function getPaymentProvider(): PaymentProvider {
  if (!cached) cached = new ManualPaymentProvider();
  return cached;
}

/** Test seam — reset the memoized provider. */
export function __resetPaymentProvider(): void {
  cached = null;
}
