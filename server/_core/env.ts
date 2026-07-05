// P0-3: Validate critical secrets at startup to prevent silent security failures
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.trim() === "") {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[Security] JWT_SECRET environment variable is not set or empty. " +
      "This is a critical security requirement. Please configure JWT_SECRET before starting in production."
    );
  } else {
    // Use stderr directly — env.ts is imported BEFORE logger.ts initializes
    // its pino instance, and there's no value in deferring this warning.
    process.stderr.write(
      "[Security Warning] JWT_SECRET is not set. Using empty string for development. This MUST be set in production.\n",
    );
  }
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: jwtSecret ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Direct-provider credentials (Fly.io deployment). Manus Forge proxy 已退役
  // (2026-07):forgeApiUrl/forgeApiKey 欄位與 BUILT_IN_FORGE_* secrets 皆已移除。
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // Cloudflare R2 (S3-compatible) object storage
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  r2Endpoint: process.env.R2_ENDPOINT ?? "",
  r2Bucket: process.env.R2_BUCKET ?? "",
  r2PublicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "",
  // Upstash Redis
  upstashRedisUrl: process.env.UPSTASH_REDIS_URL ?? "",
  // Google (Custom Search + Maps)
  googleApiKey: process.env.GOOGLE_API_KEY ?? "",
  googleCseId: process.env.GOOGLE_CSE_ID ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  // Round 80.20 → 80.21: Membership pricing — each tier has yearly + monthly
  // variants. Yearly is the discounted commitment (≈ 2 months free vs monthly).
  // Suggested: Plus $99/yr or $9.99/mo · Concierge $399/yr or $39.99/mo.
  stripePricePlusYearlyId: process.env.STRIPE_PRICE_PLUS_YEARLY_ID ?? process.env.STRIPE_PRICE_PLUS_ID ?? "",
  stripePricePlusMonthlyId: process.env.STRIPE_PRICE_PLUS_MONTHLY_ID ?? "",
  stripePriceConciergeYearlyId: process.env.STRIPE_PRICE_CONCIERGE_YEARLY_ID ?? process.env.STRIPE_PRICE_CONCIERGE_ID ?? "",
  stripePriceConciergeMonthlyId: process.env.STRIPE_PRICE_CONCIERGE_MONTHLY_ID ?? "",
  unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY ?? "",
  unsplashSecretKey: process.env.UNSPLASH_SECRET_KEY ?? "",
  // P0-4: Base URL for sitemap and other absolute URL generation
  baseUrl: process.env.BASE_URL ?? "https://packgoplay.com",
};
