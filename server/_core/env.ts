// P0-3: Validate critical secrets at startup to prevent silent security failures
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.trim() === "") {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[Security] JWT_SECRET environment variable is not set or empty. " +
      "This is a critical security requirement. Please configure JWT_SECRET before starting in production."
    );
  } else {
    console.warn(
      "[Security Warning] JWT_SECRET is not set. Using empty string for development. " +
      "This MUST be set in production."
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
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY ?? "",
  unsplashSecretKey: process.env.UNSPLASH_SECRET_KEY ?? "",
  // P0-4: Base URL for sitemap and other absolute URL generation
  baseUrl: process.env.BASE_URL ?? "https://packgo-d3xjbq67.manus.space",
};

// FIX-02: Startup validation for critical and optional env vars
const REQUIRED_IN_PRODUCTION = ['DATABASE_URL', 'JWT_SECRET'] as const;
if (ENV.isProduction) {
  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  const WARN_VARS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'UNSPLASH_ACCESS_KEY'];
  for (const key of WARN_VARS) {
    if (!process.env[key]) {
      console.warn(`[ENV] Warning: ${key} is not set. Related features will be disabled.`);
    }
  }
}
