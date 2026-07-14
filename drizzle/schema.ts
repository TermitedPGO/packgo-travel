import { bigint, boolean, date, decimal, int, json, mediumtext, mysqlEnum, mysqlTable, text, timestamp, varchar, unique, index } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. Now optional for traditional auth. */
  openId: varchar("openId", { length: 64 }).unique(),
  /** Google OAuth identifier. Unique per user. */
  googleId: varchar("googleId", { length: 255 }).unique(),
  /** Password hash for traditional auth (bcrypt) */
  password: varchar("password", { length: 255 }),
  /** Token for password reset */
  resetPasswordToken: varchar("resetPasswordToken", { length: 255 }),
  /** Expiration time for password reset token */
  resetPasswordExpires: timestamp("resetPasswordExpires"),
  name: text("name"),
  email: varchar("email", { length: 320 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  address: text("address"),
  avatar: varchar("avatar", { length: 512 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),

  /**
   * Round 80.19: Membership tier — drives AI Advisor rate-limit bypass,
   * tour discounts, priority support. Populated by Stripe webhook on
   * subscription create / update / cancel. See docs/membership-plan.md.
   * Free → 5 AI advisor messages / 30 days, normal pricing.
   * Plus → unlimited AI advisor, Packpoint 5x earn rate, no-fee changes within 60d.
   * Concierge → unlimited AI advisor, Packpoint 10x earn rate, dedicated advisor.
   */
  tier: mysqlEnum("tier", ["free", "plus", "concierge"]).default("free").notNull(),
  /** Stripe subscription ID (for webhook lookup). Null for free tier. */
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  /** Stripe customer ID (one-to-one with user; reused across subscriptions) */
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  /** When the current paid tier expires. Null for free tier. */
  tierExpiresAt: timestamp("tierExpiresAt"),

  /**
   * Round 80.22: Packpoint balance (loyalty points).
   * 100 Packpoint = $1 USD redemption. Earned via bookings × tier × tour
   * multipliers, or via engagement bonuses (signup +50, review +50, refer
   * +500, birthday +100). Redeemed at checkout to offset booking cost.
   * Authoritative source is the running sum of pointsTransactions, but
   * we cache the balance here for fast queries (Header badge, profile).
   */
  packpointBalance: int("packpointBalance").default(0).notNull(),
  /** Lifetime Packpoint earned — never decreases (used for tier-up thresholds). */
  packpointLifetimeEarned: int("packpointLifetimeEarned").default(0).notNull(),
  /** Last time user earned or redeemed — drives 18-month inactivity expiry. */
  packpointLastActivityAt: timestamp("packpointLastActivityAt"),
  /** Date of birth for birthday bonus (+100 pts/year). Optional. */
  birthDate: timestamp("birthDate"),

  /**
   * Round 80.22 Phase D: Referral program.
   * referralCode: unique 8-char code generated on signup; user shares this
   *   to earn +500 Packpoint when a referee first pays for a booking.
   * referredBy: userId of the referrer (null = direct signup).
   * referralBonusAwarded: true once the referrer has been paid for THIS
   *   referee's first booking. Prevents double-payment on subsequent
   *   bookings by the same referee.
   */
  referralCode: varchar("referralCode", { length: 16 }).unique(),
  referredBy: int("referredBy"),
  referralBonusAwarded: boolean("referralBonusAwarded").default(false).notNull(),

  /** Login security fields */
  loginAttempts: int("loginAttempts").default(0).notNull(), // Number of failed login attempts
  lockoutUntil: timestamp("lockoutUntil"), // Account locked until this time

  /**
   * Round 81 / migration 0075 — repurchase trigger + trial abuse prevention.
   *
   * InquiryAgent detects this user's 2nd inquiry within 60 days OR 30 days
   * after trip completion → if upgradePromptSentAt is null, appends "升級
   * Plus 10 天試用" CTA to reply, sets upgradePromptSentAt to throttle.
   *
   * plusTrialUsedAt / conciergeTrialUsedAt: once-per-user per tier limit
   * (filled when membershipTrials row is created). Prevents trial abuse.
   *
   * bookingCount: cached count of confirmed bookings — drives
   * "is this a repeat customer?" check faster than COUNT(*) on bookings.
   */
  inquiryCount: int("inquiryCount").default(0).notNull(),
  lastInquiryAt: timestamp("lastInquiryAt"),
  upgradePromptSentAt: timestamp("upgradePromptSentAt"),
  plusTrialUsedAt: timestamp("plusTrialUsedAt"),
  conciergeTrialUsedAt: timestamp("conciergeTrialUsedAt"),
  bookingCount: int("bookingCount").default(0).notNull(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/**
 * Round 80.22 Phase H2: Supplier poster distribution.
 *
 * Capture the source poster from suppliers (雄獅 / 縱橫) via WeChat,
 * AI rewrites + brands it, multi-platform copy generated, admin reviews,
 * distributes (auto for newsletter, manual for WeChat / IG / etc.).
 *
 * Workflow stages:
 *   1. uploaded → poster + original copy in DB
 *   2. processing → AI vision analysing image
 *   3. ready → AI generated branded poster + 7 platform copies
 *   4. approved → admin reviewed and approved
 *   5. distributed → at least 1 platform marked as posted
 *   6. archived → admin no longer wants to surface
 */
export const posterAssets = mysqlTable("posterAssets", {
  id: int("id").autoincrement().primaryKey(),
  /** Supplier sourcing — drives credibility footer + analytics. */
  sourceVendor: mysqlEnum("sourceVendor", ["lion", "zongheng", "house", "other"]).notNull(),
  /** Free-form name from admin or AI-extracted ("夏威夷 6 天精選團 7/15 出發"). */
  title: varchar("title", { length: 500 }),
  /** Target audience tag — drives copy tone in AI generation. */
  targetAudience: mysqlEnum("targetAudience", [
    "family",        // 家庭旅遊
    "honeymoon",     // 蜜月
    "parent_child",  // 親子
    "business",      // 商務
    "senior",        // 銀髮族
    "general",       // 通用
  ]).default("general").notNull(),
  /** Original poster image (uploaded by admin from WeChat screenshot). */
  originalImageUrl: varchar("originalImageUrl", { length: 1024 }).notNull(),
  /** Original promotional copy text (paste from WeChat). */
  originalCopyText: text("originalCopyText"),
  /** Branded poster image (PACK&GO logo + frame applied via Sharp). */
  brandedImageUrl: varchar("brandedImageUrl", { length: 1024 }),
  /** AI Vision extracted info as JSON: title, dates, prices, highlights, palette. */
  aiAnalysis: text("aiAnalysis"),
  status: mysqlEnum("status", [
    "uploaded",
    "processing",
    "ready",
    "approved",
    "distributed",
    "archived",
    "failed",
  ]).default("uploaded").notNull(),
  /** Admin notes / processing errors. */
  notes: text("notes"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx: index("idx_poster_status").on(table.status, table.createdAt),
}));

export type PosterAsset = typeof posterAssets.$inferSelect;
export type InsertPosterAsset = typeof posterAssets.$inferInsert;

/**
 * Round 80.22 Phase H2: Per-platform copy generated for each poster.
 * 7 rows per posterAsset (one per platform). Admin can edit + approve
 * each independently. Tracks distribution status separately per platform.
 */
export const posterPlatformCopies = mysqlTable("posterPlatformCopies", {
  id: int("id").autoincrement().primaryKey(),
  posterAssetId: int("posterAssetId").notNull(),
  platform: mysqlEnum("platform", [
    "wechat_moments",  // 朋友圈
    "wechat_group",    // 微信群
    "xiaohongshu",     // 小紅書
    "line",            // LINE 群
    "facebook",        // FB Page / personal
    "instagram",       // IG
    "newsletter",      // Email newsletter (auto-distributed)
  ]).notNull(),
  /** AI-generated copy text. Admin can edit before approving. */
  copyText: text("copyText").notNull(),
  /** Optional hashtags (separate field for platforms that use them prominently). */
  hashtags: text("hashtags"),
  status: mysqlEnum("status", ["draft", "approved", "posted", "skipped"]).default("draft").notNull(),
  /** When admin marked as posted (or auto-set for newsletter). */
  postedAt: timestamp("postedAt"),
  /** URL of the live post (admin pastes after posting). */
  postedUrl: varchar("postedUrl", { length: 1024 }),
  /** Free-form admin notes. */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  posterIdx: index("idx_platform_copy_poster").on(table.posterAssetId),
  platformIdx: index("idx_platform_copy_status").on(table.platform, table.status),
}));

export type PosterPlatformCopy = typeof posterPlatformCopies.$inferSelect;
export type InsertPosterPlatformCopy = typeof posterPlatformCopies.$inferInsert;

/**
 * Round 80.22 Phase F: Reward vouchers — Packpoint redeemed for tangible
 * rewards (flight credit, photo book, etc.). Unlike inline cash discount
 * (which we already do at checkout), vouchers are issued ahead of time
 * with a unique code and consumed on a later transaction.
 *
 * Lifecycle:
 *   1. Customer redeems on /rewards page → pts deducted → voucher issued
 *      (status='issued', code=PACK-FLT-XXXXXXXX, expires in 12 months).
 *   2. Customer presents code to PACK&GO when booking flight (manual flow).
 *   3. Admin marks status='redeemed' in admin UI; reference points to the
 *      booking that consumed the voucher.
 *   4. Cron sweep marks 'expired' vouchers (no clawback — points were
 *      already paid into the system).
 *
 * Why a separate table (vs reusing pointsTransactions): vouchers have
 * customer-facing codes, expiry dates, redemption tracking that don't fit
 * the immutable transaction-log model.
 */
export const rewardVouchers = mysqlTable("rewardVouchers", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Voucher type (drives UI label + redemption rules). */
  type: mysqlEnum("type", [
    "flight_credit",   // PACK&GO flight booking discount
    "photo_book",      // Premium photo book printing
    "tour_credit",     // Generic tour discount voucher (alt to inline redemption)
  ]).notNull(),
  /** Customer-facing unique code (PACK-FLT-XXXXXXXX format). */
  code: varchar("code", { length: 32 }).notNull().unique(),
  /** $ value (USD) — what the voucher is worth at redemption. */
  amountUsd: int("amountUsd").notNull(),
  /** Packpoint cost — how many points the user spent (audit trail). */
  pointsCost: int("pointsCost").notNull(),

  status: mysqlEnum("status", ["issued", "redeemed", "expired", "voided"]).default("issued").notNull(),
  /** Set when status moves to 'redeemed'. */
  redeemedAt: timestamp("redeemedAt"),
  /** Admin who marked redeemed. */
  redeemedByAdminId: int("redeemedByAdminId"),
  /** Reference to the booking / order that consumed it (nullable). */
  redeemedAgainstBookingId: int("redeemedAgainstBookingId"),

  /** Default 12 months. */
  expiresAt: timestamp("expiresAt").notNull(),
  /** Free-form admin notes (e.g., "applied to booking #123 for $250 discount"). */
  notes: text("notes"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_voucher_user").on(table.userId, table.status),
  codeIdx: index("idx_voucher_code").on(table.code),
}));

export type RewardVoucher = typeof rewardVouchers.$inferSelect;
export type InsertRewardVoucher = typeof rewardVouchers.$inferInsert;

/**
 * Round 80.22 Phase F: Trip photos — customer-uploaded photos from a
 * completed booking. Drives:
 *   - +10 Packpoint per photo (capped at 100 pts / 10 photos per booking
 *     per docs/packpoint-policy.md §4)
 *   - Photo book voucher unlock (50+ photos across approved bookings)
 *   - Future: photo gallery on user profile + tour pages (with consent)
 */
export const tripPhotos = mysqlTable("tripPhotos", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  bookingId: int("bookingId").notNull(),
  /** S3 URL — must be served from our trusted bucket, not arbitrary URLs. */
  photoUrl: varchar("photoUrl", { length: 1024 }).notNull(),
  caption: varchar("caption", { length: 500 }),
  /** True once the +10 Packpoint has been awarded for this photo. */
  pointsAwarded: boolean("pointsAwarded").default(false).notNull(),
  /** True if customer opted in to share publicly on tour gallery. */
  isPublic: boolean("isPublic").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  bookingIdx: index("idx_photo_booking").on(table.bookingId),
  userIdx: index("idx_photo_user").on(table.userId),
}));

export type TripPhoto = typeof tripPhotos.$inferSelect;
export type InsertTripPhoto = typeof tripPhotos.$inferInsert;

/**
 * Round 80.22 Phase E: Tour reviews — customer-submitted reviews after a
 * completed booking. Drives social proof on TourDetail/TestimonialsCarousel
 * and earns the user +50 Packpoint when approved by admin.
 *
 * Lifecycle:
 *   1. Customer completes a booking (bookingStatus='completed')
 *   2. Customer submits review → status='pending'
 *   3. Admin approves → status='approved', publishedAt set, +50 Packpoint
 *      awarded (idempotent via bookingId)
 *   4. Admin can reject (with reason) or hide later
 *
 * Why bookingId required: ties the review to a real verified purchase.
 * FTC 16 CFR §465 (eff 2024-10-21) bans fabricated/incentivized reviews
 * without disclosure — verified-purchase status is our compliance anchor.
 */
export const tourReviews = mysqlTable("tourReviews", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tourId: int("tourId").notNull(),
  // Round 80.25 — nullable. Logged-in users may post reviews/comments
  // without a prior booking ("open commenting"). Booking-tied reviews
  // still set this for the +50 Packpoint reward path.
  bookingId: int("bookingId"),

  rating: int("rating").notNull(), // 1–5 stars
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  /** Optional photos uploaded with the review (S3 URLs as JSON array). */
  photos: text("photos"),
  /** Locale of the review text (zh-TW / en) — surfaces correctly in i18n UI. */
  language: varchar("language", { length: 8 }).default("zh-TW").notNull(),

  status: mysqlEnum("status", ["pending", "approved", "rejected", "hidden"]).default("pending").notNull(),
  /** Set when admin moves review out of 'pending'. */
  moderatedAt: timestamp("moderatedAt"),
  moderatedBy: int("moderatedBy"), // admin userId
  /** Reason text shown to author on rejection. */
  rejectionReason: text("rejectionReason"),

  /** When customer submitted vs when admin approved (drives "publish date" UI). */
  publishedAt: timestamp("publishedAt"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  // Round 80.25 — one review per (user, tour) regardless of booking source.
  // Was uq_review_booking on bookingId; switched to compound (userId, tourId)
  // when bookingId went nullable so a single user still can't spam-flood a
  // tour with multiple reviews.
  userTourIdx: unique("uq_review_user_tour").on(table.userId, table.tourId),
  // Fast lookup for "all approved reviews for tour X" (TourDetail page)
  tourStatusIdx: index("idx_review_tour_status").on(table.tourId, table.status),
}));

export type TourReview = typeof tourReviews.$inferSelect;
export type InsertTourReview = typeof tourReviews.$inferInsert;

/**
 * Round 80.22: Packpoint transaction log (immutable audit trail).
 * Every earn / redeem / expire / adjust event creates a row here.
 * users.packpointBalance is a denormalized sum of all rows for that user.
 *
 * Why immutable: regulators may require proof of point liability for
 * accounting. Negative `delta` = redemption / clawback, positive = earn.
 */
export const pointsTransactions = mysqlTable("pointsTransactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Positive int = earn; negative int = redeem / clawback / expire. */
  delta: int("delta").notNull(),
  /** Categorize for analytics + filtering. */
  reason: mysqlEnum("reason", [
    "booking_earn",       // Earned from a booking (×tier ×tour multiplier)
    "signup_bonus",       // +50 first-time signup
    "review_bonus",       // +50 per completed-tour review
    "referral_bonus",     // +500 successful referral (both sides)
    "birthday_bonus",     // +100/year
    "photo_bonus",        // +10 per photo upload
    "redemption",         // -X, used at checkout
    "clawback",           // -X, refund / cancel claws back earned points
    "expiration",         // -X, 18-month inactivity sweep
    "admin_adjust",       // Manual adjustment by admin (+ or -)
  ]).notNull(),
  /** Optional reference: bookingId / reviewId / referralCode etc. */
  referenceType: varchar("referenceType", { length: 50 }),
  referenceId: int("referenceId"),
  /** Free-form description for audit (admin reason, error context). */
  description: text("description"),
  /** Running balance after this transaction (for fast history queries). */
  balanceAfter: int("balanceAfter").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_points_user").on(table.userId, table.createdAt),
}));

export type PointsTransaction = typeof pointsTransactions.$inferSelect;
export type InsertPointsTransaction = typeof pointsTransactions.$inferInsert;

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Tours table for managing travel packages.
 * Stores all tour information including destinations, pricing, and availability.
 * Enhanced with detailed location, flight, and accommodation information.
 */
export const tours = mysqlTable("tours", {
  id: int("id").autoincrement().primaryKey(),
  
  // Basic Information
  title: text("title").notNull(),
  productCode: varchar("productCode", { length: 100 }), // 產品代碼 (e.g., 26JO217BRC-T) — v80.24: 50→100 to fit longer supplier codes
  description: text("description").notNull(),
  
  // Location Information - Departure
  departureCountry: varchar("departureCountry", { length: 100 }).default("台灣"), // 出發國家
  departureCity: text("departureCity").default("桃園"), // 出發城市
  departureAirportCode: varchar("departureAirportCode", { length: 10 }), // 出發機場代碼 (e.g., TPE)
  departureAirportName: varchar("departureAirportName", { length: 100 }), // 出發機場名稱
  
  // Location Information - Destination
  destinationCountry: text("destinationCountry").notNull(), // 目的地國家
  destinationCity: text("destinationCity").notNull(), // 目的地城市 (支援多個城市)
  destinationRegion: varchar("destinationRegion", { length: 100 }), // 目的地區域 (e.g., 那霸)
  destinationAirportCode: varchar("destinationAirportCode", { length: 10 }), // 目的地機場代碼 (e.g., OKA)
  destinationAirportName: varchar("destinationAirportName", { length: 100 }), // 目的地機場名稱
  destination: text("destination"), // v81: legacy nullable; new code uses destinationCity
  
  // Duration & Pricing
  duration: int("duration").notNull(), // in days
  nights: int("nights"), // number of nights
  price: int("price").notNull(), // 原始價格
  priceCurrency: varchar("priceCurrency", { length: 3 }).default("TWD").notNull(), // 原始價格貨幣 (TWD/USD)
  priceUnit: varchar("priceUnit", { length: 20 }).default("人/起"), // 價格單位
  
  // Flight Information - Outbound
  // v80.24: bumped from 100 to 200 — LLM-cleaned airline names like
  // "All Nippon Airways (ANA / Star Alliance) — codeshare with United"
  // can exceed 100 chars on bilingual itineraries.
  outboundAirline: varchar("outboundAirline", { length: 200 }), // 去程航空公司
  outboundFlightNo: varchar("outboundFlightNo", { length: 20 }), // 去程航班號
  outboundDepartureTime: varchar("outboundDepartureTime", { length: 10 }), // 去程出發時間 (e.g., 06:55)
  outboundArrivalTime: varchar("outboundArrivalTime", { length: 10 }), // 去程抵達時間 (e.g., 09:15)
  outboundFlightDuration: varchar("outboundFlightDuration", { length: 20 }), // 去程飛行時間 (e.g., 1h20m)

  // Flight Information - Inbound
  inboundAirline: varchar("inboundAirline", { length: 200 }), // 回程航空公司
  inboundFlightNo: varchar("inboundFlightNo", { length: 20 }), // 回程航班號
  inboundDepartureTime: varchar("inboundDepartureTime", { length: 10 }), // 回程出發時間
  inboundArrivalTime: varchar("inboundArrivalTime", { length: 10 }), // 回程抵達時間
  inboundFlightDuration: varchar("inboundFlightDuration", { length: 20 }), // 回程飛行時間

  // Accommodation Information
  // v80.24: bumped lengths — Japanese / Korean hotel names can be 50+ chars
  // each in chinese AND english side-by-side; grade strings can include
  // "五星級豪華酒店 / 5-Star Luxury Resort"; room size formats vary.
  hotelName: varchar("hotelName", { length: 500 }), // 酒店名稱
  hotelGrade: varchar("hotelGrade", { length: 100 }), // 酒店等級 (e.g., 五星級, 四星級)
  hotelNights: int("hotelNights"), // 住宿晚數
  hotelLocation: varchar("hotelLocation", { length: 500 }), // 酒店位置
  hotelDescription: text("hotelDescription"), // 酒店介紹
  hotelFacilities: text("hotelFacilities"), // JSON array of facilities
  hotelRoomType: varchar("hotelRoomType", { length: 200 }), // 房型
  hotelRoomSize: varchar("hotelRoomSize", { length: 100 }), // 房間大小 (e.g., 30-35平方米)
  hotelCheckIn: varchar("hotelCheckIn", { length: 10 }), // 入住時間 (e.g., 15:00)
  hotelCheckOut: varchar("hotelCheckOut", { length: 10 }), // 退房時間 (e.g., 11:00)
  hotelSpecialOffers: text("hotelSpecialOffers"), // JSON array of special offers
  hotelImages: text("hotelImages"), // JSON array of image URLs
  hotelWebsite: varchar("hotelWebsite", { length: 2048 }), // 酒店官網 (Round 80.22: bumped 512→2048 to fit R2 pre-signed URLs)
  
  // Destination Description
  destinationDescription: text("destinationDescription"), // 目的地介紹
  
  
  // Daily Itinerary
  dailyItinerary: text("dailyItinerary"), // JSON array of daily activities
  
  // Pricing Details
  includes: text("includes"), // JSON array of what's included
  excludes: text("excludes"), // JSON array of what's excluded
  optionalTours: text("optionalTours"), // JSON array of optional tours with price
  
  // Tags & Features
  tags: text("tags"), // JSON array of tags (e.g., 特色住宿, 獨家企劃)
  highlights: text("highlights"), // JSON array of highlights
  promotionText: text("promotionText"), // 促銷文字 (e.g., 過年大促銷)
  
  // Images
  // Round 80.22: bumped 512→2048 to fit R2 pre-signed URLs (signed URLs run
  // 1500-2000 chars with X-Amz-* query params)
  imageUrl: varchar("imageUrl", { length: 2048 }), // Main image
  galleryImages: text("galleryImages"), // JSON array of gallery image URLs with metadata

  // v331 — AI tour-map. When non-NULL, the tour detail page renders
  // this PNG (rendered by gpt-image-2 from the itinerary) instead of
  // the SVG canvas. See `server/services/tourMapGenerator.ts` for the
  // generation flow.
  aiMapUrl: varchar("aiMapUrl", { length: 2048 }), // Public URL of the painted map
  aiMapPrompt: text("aiMapPrompt"), // Exact prompt used (audit / re-runs)
  aiMapGeneratedAt: timestamp("aiMapGeneratedAt"), // When the current image was rendered

  // === New Fields for Luxury Design ===
  // Hero Section
  heroImage: varchar("heroImage", { length: 2048 }), // Full-screen hero background image
  heroImageAlt: text("heroImageAlt"), // Hero image alt text for SEO
  // 0115: stock-photo attribution (Unsplash API terms). JSON {name, username,
  // profileUrl} | NULL. Written by catalogRebuild's stockPhotoResolver when the
  // hero is a stock photo; customer page renders "Photo by {name} on Unsplash".
  heroImageCredit: text("heroImageCredit"),
  heroSubtitle: text("heroSubtitle"), // Hero subtitle - tour highlights summary
  
  // Color Theme
  colorTheme: text("colorTheme"), // JSON format: {primary, secondary, accent, text, textLight, background, backgroundDark}
  
  // Key Features (for vertical text layout)
  keyFeatures: text("keyFeatures"), // JSON array of key features with poetic phrases
  
  // Poetic Content (elegant descriptions for different sections)
  poeticTitle: text("poeticTitle"), // Poetic title (e.g., "北海道二世谷雅奢６日")
  poeticContent: text("poeticContent"), // JSON object: {intro, accommodation, dining, experience, closing}
  poeticSubtitle: text("poeticSubtitle"), // Poetic subtitle (e.g., "越獅境踏野原魂，追遷徙逐天地心")
  
  // Feature Images (for sipincollection.com style)
  featureImages: text("featureImages"), // JSON array: [{url, alt, caption, position: 'large'|'small'}]
  
  // === New Fields for AI-Generated Detailed Content ===
  // Detailed Itinerary (generated by ItineraryAgent)
  itineraryDetailed: text("itineraryDetailed"), // JSON array: [{day, title, activities: [{time, title, description, transportation, location}], meals: {breakfast, lunch, dinner}, accommodation}]
  
  // Cost Explanation (generated by CostAgent)
  costExplanation: text("costExplanation"), // JSON object: {included: [], excluded: [], additionalCosts: [], notes}
  
  // Detailed Notice (generated by NoticeAgent)
  noticeDetailed: text("noticeDetailed"), // JSON object: {preparation: [], culturalNotes: [], healthSafety: [], emergency: []}
  
  // Detailed Content Blocks (for sipincollection.com style)
  attractions: text("attractions"), // JSON array: [{name, description (100-200 words), image, imageAlt}]
  hotels: text("hotels"), // JSON array: [{name, stars, description (100-150 words), image, imageAlt}]
  meals: text("meals"), // JSON array: [{name, description, image, imageAlt}]
  flights: text("flights"), // JSON object: {airline, outbound: {time, duration}, inbound: {time, duration}, features: []}
  
  // Category & Status
  category: mysqlEnum("category", [
    "group",      // 團體旅遊
    "custom",     // 客製旅遊
    "package",    // 包團旅遊
    "cruise",     // 郵輪旅遊
    "theme"       // 主題旅遊
  ]).default("group").notNull(),
  status: mysqlEnum("status", ["active", "inactive", "soldout", "draft", "pending_review"]).default("draft").notNull(),
  featured: int("featured").default(0).notNull(), // 0 = not featured, 1 = featured
  
  // Availability
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  maxParticipants: int("maxParticipants"),
  currentParticipants: int("currentParticipants").default(0).notNull(),
  availableSeats: int("availableSeats"), // 可賣席次
  
  // Notes & Reminders
  specialReminders: text("specialReminders"), // 行程特殊提醒
  notes: text("notes"), // 行程備註
  safetyGuidelines: text("safetyGuidelines"), // 安全守則
  flightRules: text("flightRules"), // 團體航班規定事項
  
  // Legacy fields for compatibility
  airline: varchar("airline", { length: 100 }), // Airline company (legacy)
  specialActivities: text("specialActivities"), // JSON string of special activities array
  
  // Source information (for auto-generated tours)
  sourceUrl: varchar("sourceUrl", { length: 1024 }), // 來源網址
  isAutoGenerated: int("isAutoGenerated").default(0), // 是否為自動生成
  originalityScore: decimal("originalityScore", { precision: 5, scale: 2 }), // 原創性評分 (0-100)

  // tour-catalog-rebuild (chunk 1) — 重抓換批標記(就地更新,id 不變)。
  batchId: int("batchId"), // 屬於哪一批 catalogBatches(NULL = 重抓前的舊資料)
  lastBatchAt: timestamp("lastBatchAt"), // 最近一次被重抓換上的時間
  
  // Warning Flags (for Partial Success tracking)
  // ⚠️ Tech Lead 審查意見：錯誤日誌的可視化
  // 當 P1 Agent 失敗並觸發 Fallback 時，Admin 後台必須能看到警告狀態。
  // JSON 格式：{colorTheme?: {failed, fallbackUsed, reason}, heroContent?: {...}, features?: {...}, imageGeneration?: {hero?: {...}, features?: {...}}}
  warningFlags: text("warningFlags"), // JSON string of warning flags
  
  // DateExtractor 暫存欄位：AI 從 URL 提取的出發日期/人數/價格（等待 admin 確認）
  // JSON 格式：{departureDates: [{date, status, price?}], capacity: {maxParticipants, minParticipants?}, pricing: {adultPrice, childWithBedPrice?, childNoBedPrice?, infantPrice?, currency, priceNote?}, productCode?}
  extractedDepartures: text("extractedDepartures"), // JSON - DateExtractor result pending admin confirmation
  
  // Supplier Monitor fields (updated by TourMonitorService)
  lastMonitoredAt: timestamp("lastMonitoredAt"), // when the tour was last checked
  monitorStatus: varchar("monitorStatus", { length: 20 }), // 'ok' | 'changed' | 'error'
  monitorChangeSummary: text("monitorChangeSummary"), // latest change summary

  // Calibration QA fields (from CalibrationAgent)
  calibrationScore: int("calibrationScore"), // 0-100 total score
  calibrationVerdict: varchar("calibrationVerdict", { length: 20 }), // 'pass' | 'warn' | 'fail'
  calibrationReport: text("calibrationReport"), // JSON - full CalibrationReport
  calibratedAt: timestamp("calibratedAt"), // when calibration was last run

  // v78l (Sprint 4A): supplier contact for auto-notify on booking confirmation.
  // When a booking goes paid, server emails supplierEmail with customer + dates.
  supplierName: varchar("supplierName", { length: 200 }),
  supplierEmail: varchar("supplierEmail", { length: 320 }),
  supplierPhone: varchar("supplierPhone", { length: 50 }),
  supplierNotes: text("supplierNotes"),

  /**
   * Round 80.22: Packpoint per-tour multiplier.
   * Final earn = booking_subtotal × 1 × tier_multiplier(1/5/10) × pointsEarnRate.
   * Default 0.25 (thin-margin safe even at 5% commission). Jeff sets higher
   * (0.5 / 1 / 2) for promotional campaigns or high-margin tours. 0 = exclude
   * this tour from earning entirely (used for affiliate/promo bookings).
   * Stored × 100 to avoid floating-point: 25 = 0.25x, 100 = 1x, 200 = 2x.
   */
  pointsEarnRate: int("pointsEarnRate").default(25).notNull(),
  /** Optional: Jeff's estimated commission % (× 10000, e.g. 1500 = 15%). Used in admin cost calculator. */
  estimatedCommissionPct: int("estimatedCommissionPct"),
  /** True = this tour never earns Packpoint (overrides pointsEarnRate). */
  excludeFromPackpoint: boolean("excludeFromPackpoint").default(false).notNull(),

  // Metadata
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Tour = typeof tours.$inferSelect;
export type InsertTour = typeof tours.$inferInsert;

/**
 * Tour departures table for managing multiple departure dates per tour.
 * Each tour can have multiple departure dates with different pricing.
 */
export const tourDepartures = mysqlTable("tourDepartures", {
  id: int("id").autoincrement().primaryKey(),
  tourId: int("tourId").notNull(),
  departureDate: timestamp("departureDate").notNull(),
  returnDate: timestamp("returnDate").notNull(),
  adultPrice: int("adultPrice").notNull(), // Adult price in TWD
  childPriceWithBed: int("childPriceWithBed"), // Child price with bed
  childPriceNoBed: int("childPriceNoBed"), // Child price without bed
  infantPrice: int("infantPrice"), // Infant price (under 2 years)
  singleRoomSupplement: int("singleRoomSupplement"), // Single room surcharge
  totalSlots: int("totalSlots").notNull(), // Total available slots
  bookedSlots: int("bookedSlots").default(0).notNull(), // Already booked slots
  status: mysqlEnum("status", ["open", "full", "cancelled", "confirmed"]).default("open").notNull(),
  currency: varchar("currency", { length: 3 }).default("TWD").notNull(),
  notes: text("notes"), // Special notes for this departure
  // Round 81 / migration 0075 — operational layer for "tour group" management.
  // A departure becomes a "group" once Jeff promotes it: assigns internal code,
  // group name (e.g. "李太太家族團 6/15 北海道"), tour leader, and operational
  // status. OpsAgent queries on these fields when Jeff asks natural-language
  // questions ("李太太那團幾號出發?"). internalNotes is Jeff-readable only.
  internalCode: varchar("internalCode", { length: 64 }), // e.g. "JP-HOK-0615-Y"
  groupName: varchar("groupName", { length: 255 }),
  tourLeader: varchar("tourLeader", { length: 128 }),
  opsStatus: mysqlEnum("opsStatus", ["planning", "confirmed", "departed", "completed", "cancelled"]).default("planning").notNull(),
  internalNotes: mediumtext("internalNotes"),
  supplierConfirmations: json("supplierConfirmations"), // {hotel:[…], transport:[…], ground:[…]}
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  opsStatusIdx: index("idx_departure_opsstatus").on(table.opsStatus, table.departureDate),
}));

export type TourDeparture = typeof tourDepartures.$inferSelect;
export type InsertTourDeparture = typeof tourDepartures.$inferInsert;

// Round 81 / migration 0075 — per-group activity log.
// type='ops' = Jeff's running notes; 'customer' = customer-side update;
// 'financial' = supplier payment / commission; 'followup' = post-trip;
// 'ai_query' = OpsAgent answered a natural-language question (auditable).
export const tourGroupNotes = mysqlTable("tourGroupNotes", {
  id: int("id").autoincrement().primaryKey(),
  tourDepartureId: int("tourDepartureId").notNull(),
  type: mysqlEnum("type", ["ops", "customer", "financial", "followup", "ai_query"]).notNull(),
  author: varchar("author", { length: 64 }).notNull(),
  body: mediumtext("body").notNull(),
  attachments: json("attachments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  departureIdx: index("idx_departure").on(table.tourDepartureId, table.createdAt),
  typeIdx: index("idx_type").on(table.type, table.createdAt),
}));

export type TourGroupNote = typeof tourGroupNotes.$inferSelect;
export type InsertTourGroupNote = typeof tourGroupNotes.$inferInsert;

export const preDepartureNotifications = mysqlTable("preDepartureNotifications", {
  id: int("id").autoincrement().primaryKey(),
  departureId: int("departureId").notNull(),
  bookingId: int("bookingId").notNull(),
  userId: int("userId"),
  recipientName: varchar("recipientName", { length: 128 }).notNull(),
  recipientEmail: varchar("recipientEmail", { length: 256 }).notNull(),
  subject: varchar("subject", { length: 256 }).default("").notNull(),
  content: mediumtext("content").notNull(),
  status: mysqlEnum("status", ["draft", "approved", "sent", "skipped"]).default("draft").notNull(),
  sentAt: timestamp("sentAt"),
  approvedBy: int("approvedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  departureIdx: index("idx_pdn_departure").on(table.departureId, table.status),
  bookingIdx: index("idx_pdn_booking").on(table.bookingId),
}));

export type PreDepartureNotification = typeof preDepartureNotifications.$inferSelect;
export type InsertPreDepartureNotification = typeof preDepartureNotifications.$inferInsert;

/**
 * Bookings table for storing all customer reservations.
 * Core transaction table linking users to tour departures.
 */
export const bookings = mysqlTable("bookings", {
  id: int("id").autoincrement().primaryKey(),
  tourId: int("tourId").notNull(),
  departureId: int("departureId").notNull(),
  userId: int("userId"), // Nullable for guest bookings
  customerName: varchar("customerName", { length: 255 }).notNull(),
  customerEmail: varchar("customerEmail", { length: 320 }).notNull(),
  customerPhone: varchar("customerPhone", { length: 50 }).notNull(),
  numberOfAdults: int("numberOfAdults").default(0).notNull(),
  numberOfChildrenWithBed: int("numberOfChildrenWithBed").default(0).notNull(),
  numberOfChildrenNoBed: int("numberOfChildrenNoBed").default(0).notNull(),
  numberOfInfants: int("numberOfInfants").default(0).notNull(),
  numberOfSingleRooms: int("numberOfSingleRooms").default(0).notNull(),
  totalPrice: int("totalPrice").notNull(), // Total booking price
  depositAmount: int("depositAmount").notNull(), // Deposit amount (20% of total)
  remainingAmount: int("remainingAmount").notNull(), // Remaining balance
  currency: varchar("currency", { length: 3 }).default("TWD").notNull(),
  message: text("message"), // Customer message or special requests
  bookingStatus: mysqlEnum("bookingStatus", [
    "pending",    // Awaiting confirmation
    "confirmed",  // Confirmed by admin
    "completed",  // Trip completed
    "cancelled"   // Cancelled
  ]).default("pending").notNull(),
  paymentStatus: mysqlEnum("paymentStatus", [
    "unpaid",     // No payment received
    "deposit",    // Deposit paid
    "paid",       // Fully paid
    "refunded"    // Refunded
  ]).default("unpaid").notNull(),
  depositDueDate: timestamp("depositDueDate"), // Deadline for deposit payment
  balanceDueDate: timestamp("balanceDueDate"), // Deadline for balance payment
  // v78y: customer's preferred email language at booking time. Drives all
  // subsequent emails (payment confirmation, reminders, cancellation, refund)
  // so we never switch languages mid-flow.
  customerLanguage: varchar("customerLanguage", { length: 8 }).default("zh-TW"),
  // Phase 1.1 (migration 0085): supplier fulfillment state machine. Tracks where
  // this booking sits in the supplier (UV / Lion) ordering flow. The customer
  // "confirmed / seat secured" copy drives off `vendor_confirmed`, NOT payment —
  // a customer paying us is not the same as the seat being secured with the
  // supplier. An admin advances this as they place + confirm the real order.
  supplierStatus: mysqlEnum("supplierStatus", [
    "not_placed",       // not yet ordered from the supplier (default)
    "placed",           // order placed, awaiting supplier reply
    "vendor_confirmed", // supplier confirmed; seat secured
    "vendor_rejected",  // supplier rejected / sold out
    "waitlisted",       // on the supplier waitlist
  ]).default("not_placed").notNull(),
  supplierBookingRef: varchar("supplierBookingRef", { length: 128 }), // supplier's order #
  supplierConfirmedAt: timestamp("supplierConfirmedAt"),              // when supplier confirmed
  // Phase 2.5 (migration 0086): the supplier cost Jeff entered AFTER verifying
  // it against the operator's actual order confirmation. Manual only, NEVER
  // auto-derived (supplier pricing nuance burns auto-quotes). Same unit/currency
  // as totalPrice. Drives the margin display. Nullable = not entered yet.
  supplierCost: int("supplierCost"),
  // Phase 3.2 (migration 0087): CA B&P §17550 consent capture. The booking
  // form's consent checkbox was client-only; persist it as dispute evidence.
  // disclaimerVersion stamps which disclosure-text version the customer accepted.
  disclaimerAcceptedAt: timestamp("disclaimerAcceptedAt"),
  disclaimerVersion: varchar("disclaimerVersion", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;

/**
 * Booking participants table for storing detailed information of all travelers.
 * Each booking can have multiple participants.
 */
export const bookingParticipants = mysqlTable("bookingParticipants", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  participantType: mysqlEnum("participantType", ["adult", "child", "infant"]).notNull(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  gender: mysqlEnum("gender", ["male", "female", "other"]),
  dateOfBirth: timestamp("dateOfBirth"),
  // v2 Wave 1 · Module 1.8 (migration 0078): widened from VARCHAR(50) to
  // VARCHAR(255) to hold AES-256-GCM ciphertext (~96 chars base64) via
  // server/_core/tokenCrypto.ts. Reads/writes go through db.ts helpers
  // that wrap encryptToken / decryptToken; ANY direct Drizzle access to
  // this column must do the same. See CLAUDE.md §四 forbidden patterns.
  passportNumber: varchar("passportNumber", { length: 255 }),
  passportExpiry: timestamp("passportExpiry"),
  nationality: varchar("nationality", { length: 100 }),
  dietaryRequirements: text("dietaryRequirements"),
  specialNeeds: text("specialNeeds"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BookingParticipant = typeof bookingParticipants.$inferSelect;
export type InsertBookingParticipant = typeof bookingParticipants.$inferInsert;

/**
 * Payments table for tracking all payment transactions.
 * Multiple payments can be associated with one booking (deposit + balance).
 */
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  amount: int("amount").notNull(),
  currency: varchar("currency", { length: 3 }).default("TWD").notNull(),
  paymentMethod: mysqlEnum("paymentMethod", [
    "stripe",
    "paypal",
    "bank_transfer",
    "cash",
    "other"
  ]).notNull(),
  paymentType: mysqlEnum("paymentType", ["deposit", "balance", "full"]).notNull(),
  transactionId: varchar("transactionId", { length: 255 }), // External payment gateway transaction ID
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }), // Stripe Payment Intent ID
  stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", { length: 255 }), // Stripe Checkout Session ID
  paymentStatus: mysqlEnum("paymentStatus", [
    "pending",
    "completed",
    "failed",
    "refunded"
  ]).default("pending").notNull(),
  paidAt: timestamp("paidAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

/**
 * Central Stripe webhook idempotency table (Phase 2 of refactor 2026-05).
 *
 * Stripe retries webhook delivery on transient failures (timeout, 5xx).
 * Without a central dedupe key, every handler had to implement its own
 * "have I seen this event?" check (lines 180/486/930 of stripeWebhook.ts).
 * This table is the single source of truth: handleStripeWebhook inserts
 * a row at the top of dispatch (status=processing) and updates to
 * status=succeeded|failed when the handler returns. A second delivery
 * of the same event.id short-circuits at the insert (UNIQUE collision).
 */
export const stripeWebhookEvents = mysqlTable("stripeWebhookEvents", {
  id: int("id").autoincrement().primaryKey(),
  /** Stripe event.id (evt_…) — the dedupe key. */
  eventId: varchar("eventId", { length: 255 }).notNull(),
  /** event.type, useful for analytics and replay scoping. */
  eventType: varchar("eventType", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["processing", "succeeded", "failed"]).notNull(),
  /** Free-form failure detail (truncate to 1024 chars on write). */
  errorMessage: text("errorMessage"),
  receivedAt: timestamp("receivedAt").notNull().defaultNow(),
  processedAt: timestamp("processedAt"),
}, (t) => ({
  uniqEventId: unique("uniq_stripeWebhookEvents_eventId").on(t.eventId),
}));

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type InsertStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;

/**
 * checkoutDisclosures — 付款前揭露存證 + 結帳前即時驗位驗價紀錄
 * (migration 0116, checkout-verify 批, 2026-07-11)。
 *
 * 外部顧問第二輪審計 §二指出的曝險 #4:「缺少付款前揭露版本,日後難以證明
 * 客戶同意的是哪個價格、費用與取消條款」。本表在建立 Stripe Checkout Session
 * 之前落一列:snapshot = 客戶即將同意的版本(團名/班期/單價與人數/必付費用
 * 明細/取消退款條款文字/幣別),verification = 即時驗證結果與時間戳
 * (商品在售/餘位/價格/供應商資料新鮮度)。驗證失敗也落列(status=
 * verification_failed,無 sessionId)供漏斗量測。webhook 完成付款時以
 * stripeSessionId 回填 completedAt + paymentIntentId 釘死關聯。
 *
 * 一列 = 一次結帳嘗試(同 booking 可多列:deposit/remaining/重試),
 * 絕不覆寫 —— 只新增,稽核軌不可變。
 */
export const checkoutDisclosures = mysqlTable("checkoutDisclosures", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  /** createCheckoutSession input.paymentType: "deposit" | "remaining"。 */
  paymentType: varchar("paymentType", { length: 16 }).notNull(),
  status: mysqlEnum("status", [
    "verification_failed", // 驗證未過,未建 Session
    "session_created",     // 驗證通過,Session 已建(或建立中)
    "completed",           // webhook 收到付款完成,關聯釘死
  ]).notNull(),
  /** Stripe Checkout Session id(cs_…);verification_failed 時為 NULL。 */
  stripeSessionId: varchar("stripeSessionId", { length: 255 }),
  /** webhook 完成時回填的 payment intent(pi_…)。 */
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  /** 客戶即將同意的版本快照(JSON,見 checkoutVerification.ts DisclosureSnapshot)。 */
  snapshot: json("snapshot"),
  /** 即時驗證結果(JSON,見 checkoutVerification.ts VerificationRecord)。 */
  verification: json("verification"),
  /** 驗證完成時間(不論過/不過)。 */
  verifiedAt: timestamp("verifiedAt").notNull(),
  /** webhook checkout.session.completed 蓋章時間。 */
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  bookingIdx: index("idx_checkoutDisclosures_booking").on(t.bookingId, t.createdAt),
  sessionIdx: index("idx_checkoutDisclosures_session").on(t.stripeSessionId),
}));

export type CheckoutDisclosure = typeof checkoutDisclosures.$inferSelect;
export type InsertCheckoutDisclosure = typeof checkoutDisclosures.$inferInsert;

/**
 * Inquiries table for customer service requests.
 * Stores all customer inquiries including quick inquiries and custom tour requests.
 */
export const inquiries = mysqlTable("inquiries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"), // Nullable for guest inquiries
  inquiryType: mysqlEnum("inquiryType", [
    "general",        // General inquiry
    "custom_tour",    // Custom tour planning
    "visa",           // Visa application service
    "group_booking",  // Group booking inquiry
    "complaint",      // Complaint
    "emergency",      // On-trip emergency (medical / flight / passport / safety) — added migration 0077
    "other"
  ]).notNull(),
  customerName: varchar("customerName", { length: 255 }).notNull(),
  customerEmail: varchar("customerEmail", { length: 320 }).notNull(),
  customerPhone: varchar("customerPhone", { length: 50 }),
  subject: varchar("subject", { length: 255 }).notNull(),
  message: text("message").notNull(),
  // Custom tour specific fields
  destination: varchar("destination", { length: 255 }),
  numberOfDays: int("numberOfDays"),
  numberOfPeople: int("numberOfPeople"),
  budget: int("budget"),
  preferredDepartureDate: timestamp("preferredDepartureDate"),
  // Tour-page redesign (migration 0088): structured context when an inquiry is
  // raised from a tour page's "decision + action" area. Both nullable/additive.
  //   relatedTourId: soft ref to tours.id (NULL = not raised from a tour page),
  //     mirrors the existing userId/assignedTo soft refs (no FK constraint).
  //   wizardAnswers: the 3-question fit wizard's language-neutral option keys.
  //     Qualitative buckets kept honest here instead of being forced into the
  //     typed numberOfPeople/budget/preferredDepartureDate fields above.
  relatedTourId: int("relatedTourId"),
  wizardAnswers: json("wizardAnswers").$type<{
    people?: "1-2" | "3-5" | "6+";
    timeframe?: "soon" | "school_break" | "discuss";
    budget?: "economy" | "comfort" | "luxury";
  }>(),
  status: mysqlEnum("status", [
    "new",           // New inquiry
    "in_progress",   // Being processed
    "replied",       // Replied to customer
    "resolved",      // Resolved
    "closed"         // Closed
  ]).default("new").notNull(),
  assignedTo: int("assignedTo"), // Admin user ID assigned to handle this inquiry
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Inquiry = typeof inquiries.$inferSelect;
export type InsertInquiry = typeof inquiries.$inferInsert;

/**
 * Inquiry messages table for conversation threads.
 * Stores all messages exchanged between customer and admin.
 */
export const inquiryMessages = mysqlTable("inquiryMessages", {
  id: int("id").autoincrement().primaryKey(),
  inquiryId: int("inquiryId").notNull(),
  senderId: int("senderId"), // User ID (admin or customer)
  senderType: mysqlEnum("senderType", ["customer", "admin"]).notNull(),
  message: text("message").notNull(),
  isRead: int("isRead").default(0).notNull(), // 0 = unread, 1 = read
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InquiryMessage = typeof inquiryMessages.$inferSelect;
export type InsertInquiryMessage = typeof inquiryMessages.$inferInsert;

/**
 * Newsletter subscribers table.
 * Stores email addresses of users who subscribed to the newsletter.
 */
export const newsletterSubscribers = mysqlTable("newsletterSubscribers", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  status: mysqlEnum("status", ["active", "unsubscribed"]).default("active").notNull(),
  subscribedAt: timestamp("subscribedAt").defaultNow().notNull(),
  unsubscribedAt: timestamp("unsubscribedAt"),
});

export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;
export type InsertNewsletterSubscriber = typeof newsletterSubscribers.$inferInsert;


/**
 * Image library table for storing uploaded images.
 * Allows users to reuse images across different tours and sections.
 */
export const imageLibrary = mysqlTable("imageLibrary", {
  id: int("id").autoincrement().primaryKey(),
  url: varchar("url", { length: 1024 }).notNull(), // S3 URL
  filename: varchar("filename", { length: 255 }), // Original filename
  mimeType: varchar("mimeType", { length: 100 }), // MIME type (image/jpeg, etc.)
  fileSize: int("fileSize"), // File size in bytes
  width: int("width"), // Image width in pixels
  height: int("height"), // Image height in pixels
  tags: text("tags"), // JSON array of tags for search
  uploadedBy: int("uploadedBy").notNull(), // User ID who uploaded
  tourId: int("tourId"), // Optional: associated tour ID
  usageCount: int("usageCount").default(0).notNull(), // How many times this image is used
  // Vision analysis fields (Round 11)
  source: varchar("source", { length: 50 }), // 'pdf' | 'google_places' | 'unsplash' | 'upload'
  visionDescription: text("visionDescription"), // Vision analysis description
  contentType: varchar("contentType", { length: 50 }), // 'landscape' | 'hotel' | 'food' | 'activity' | etc.
  qualityScore: int("qualityScore"), // Vision quality score 0-100
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ImageLibraryItem = typeof imageLibrary.$inferSelect;
export type InsertImageLibraryItem = typeof imageLibrary.$inferInsert;


/**
 * Homepage content table for storing editable homepage sections.
 * Allows admins to edit hero, destinations, and other homepage content.
 */
export const homepageContent = mysqlTable("homepageContent", {
  id: int("id").autoincrement().primaryKey(),
  sectionKey: varchar("sectionKey", { length: 100 }).notNull().unique(), // e.g., 'hero', 'destinations', 'trustpilot'
  content: text("content").notNull(), // JSON content for the section
  updatedBy: int("updatedBy"), // User ID who last updated
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type HomepageContent = typeof homepageContent.$inferSelect;
export type InsertHomepageContent = typeof homepageContent.$inferInsert;

/**
 * Destinations table for storing editable destination cards.
 * Allows admins to manage destination cards on the homepage.
 */
export const destinations = mysqlTable("destinations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(), // e.g., '歐洲'
  label: varchar("label", { length: 100 }), // e.g., 'Europe'
  image: varchar("image", { length: 1024 }), // Image URL
  region: varchar("region", { length: 100 }), // e.g., 'europe'
  sortOrder: int("sortOrder").default(0).notNull(), // Display order
  isActive: boolean("isActive").default(true).notNull(), // Whether to show on homepage
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Destination = typeof destinations.$inferSelect;
export type InsertDestination = typeof destinations.$inferInsert;


/**
 * Agent Skills table for storing learned knowledge and rules.
 * Allows AI agents to learn from PDF documents and apply knowledge in future generations.
 */
export const agentSkills = mysqlTable("agentSkills", {
  id: int("id").autoincrement().primaryKey(),
  
  // Skill identification
  skillType: mysqlEnum("skillType", [
    "feature_classification",  // 特色分類（ESG、美食、文化等）
    "tag_rule",               // 標籤規則（天數、價格等）
    "itinerary_structure",    // 行程結構模式
    "highlight_detection",    // 亮點識別
    "transportation_type",    // 交通類型識別
    "meal_classification",    // 餐食分類
    "accommodation_type",     // 住宿類型
    "conversation"            // 對話技能（AI Chat 知識庫）
  ]).notNull(),
  
  // Superpowers-style skill category
  skillCategory: mysqlEnum("skillCategory", [
    "technique",   // 技術 - 具體方法，有明確步驟可循
    "pattern",     // 模式 - 思考問題的方式
    "reference"    // 參考 - API 文檔、語法指南
  ]).default("technique").notNull(),
  
  skillName: varchar("skillName", { length: 100 }).notNull(), // 技能名稱
  skillNameEn: varchar("skillNameEn", { length: 100 }), // 英文名稱
  
  // Version control
  version: int("version").default(1).notNull(),
  previousVersionId: int("previousVersionId"), // 指向前一版本
  
  // Matching rules
  keywords: text("keywords").notNull(), // JSON array of trigger keywords
  rules: text("rules").notNull(), // JSON object defining conditions and actions
  
  // Output configuration
  outputLabels: text("outputLabels"), // JSON array of output labels
  outputFormat: text("outputFormat"), // JSON schema for structured output
  
  // Metadata
  description: text("description"), // 技能描述
  source: varchar("source", { length: 255 }), // 學習來源（如 PDF 檔名）
  sourceUrl: varchar("sourceUrl", { length: 1024 }), // 來源 URL
  
  // Superpowers-style documentation fields
  whenToUse: text("whenToUse"), // 觸發條件（何時使用此技能）
  corePattern: text("corePattern"), // 核心模式（技術/模式的核心邏輯）
  quickReference: text("quickReference"), // 快速參考（常用操作速查表）
  commonMistakes: text("commonMistakes"), // 常見錯誤（避免的陷阱）
  realWorldImpact: text("realWorldImpact"), // 實際影響（使用此技能的效果）
  
  // Dependencies
  dependsOn: text("dependsOn"), // JSON array of skill IDs this skill depends on
  
  // TDD-style test cases
  testCases: text("testCases"), // JSON array of test cases
  lastTestedAt: timestamp("lastTestedAt"), // 最後測試時間
  testPassRate: decimal("testPassRate", { precision: 3, scale: 2 }), // 測試通過率
  
  // Quality metrics
  confidence: decimal("confidence", { precision: 3, scale: 2 }).default("1.00"), // 信心度（0-1）
  usageCount: int("usageCount").default(0).notNull(), // 使用次數
  successCount: int("successCount").default(0).notNull(), // 成功次數
  lastUsedAt: timestamp("lastUsedAt"), // 最後使用時間
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  isBuiltIn: boolean("isBuiltIn").default(false).notNull(), // 是否為內建技能
  
  // Audit
  createdBy: int("createdBy"), // 創建者（null 表示系統自動學習）
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentSkill = typeof agentSkills.$inferSelect;
export type InsertAgentSkill = typeof agentSkills.$inferInsert;

/**
 * Skill Application Logs table for tracking skill usage history.
 * Records when and how skills are applied during tour generation.
 */
export const skillApplicationLogs = mysqlTable("skillApplicationLogs", {
  id: int("id").autoincrement().primaryKey(),
  skillId: int("skillId").notNull(),
  tourId: int("tourId"), // 可能為 null（預覽模式）
  
  // Application context
  inputContent: text("inputContent"), // 輸入內容摘要
  matchScore: decimal("matchScore", { precision: 3, scale: 2 }), // 匹配分數
  
  // Results
  outputResult: text("outputResult"), // JSON - 應用結果
  success: boolean("success").default(true).notNull(),
  errorMessage: text("errorMessage"), // 錯誤訊息（如果失敗）
  
  // Timing
  appliedAt: timestamp("appliedAt").defaultNow().notNull(),
  processingTimeMs: int("processingTimeMs"), // 處理時間（毫秒）
});

export type SkillApplicationLog = typeof skillApplicationLogs.$inferSelect;
export type InsertSkillApplicationLog = typeof skillApplicationLogs.$inferInsert;

/**
 * Learning Sessions table for tracking PDF learning history.
 * Records each learning session when new knowledge is extracted from PDFs.
 */
export const learningSessions = mysqlTable("learningSessions", {
  id: int("id").autoincrement().primaryKey(),
  
  // Source information
  sourceType: mysqlEnum("sourceType", ["pdf", "url", "manual"]).notNull(),
  sourceName: varchar("sourceName", { length: 255 }).notNull(), // 檔名或 URL
  sourceContent: text("sourceContent"), // 原始內容摘要
  
  // Learning results
  skillsLearned: int("skillsLearned").default(0).notNull(), // 學習到的技能數量
  skillIds: text("skillIds"), // JSON array of created skill IDs
  
  // Status
  status: mysqlEnum("status", [
    "pending",     // 等待處理
    "processing",  // 處理中
    "completed",   // 完成
    "failed",      // 失敗
    "cancelled"    // 取消
  ]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  
  // Audit
  initiatedBy: int("initiatedBy").notNull(), // 發起者
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type LearningSession = typeof learningSessions.$inferSelect;
export type InsertLearningSession = typeof learningSessions.$inferInsert;


/**
 * User Favorites table for storing user's favorite tours.
 * Allows users to save tours for later viewing.
 */
export const userFavorites = mysqlTable("userFavorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // User who favorited
  tourId: int("tourId").notNull(), // Tour that was favorited
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint to prevent duplicate favorites
  uniqueUserTour: unique().on(table.userId, table.tourId),
}));

export type UserFavorite = typeof userFavorites.$inferSelect;
export type InsertUserFavorite = typeof userFavorites.$inferInsert;

/**
 * User Browsing History table for storing user's recently viewed tours.
 * Allows users to see their browsing history.
 */
export const userBrowsingHistory = mysqlTable("userBrowsingHistory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // User who viewed
  tourId: int("tourId").notNull(), // Tour that was viewed
  viewedAt: timestamp("viewedAt").defaultNow().notNull(),
  viewCount: int("viewCount").default(1).notNull(), // Number of times viewed
});

export type UserBrowsingHistory = typeof userBrowsingHistory.$inferSelect;
export type InsertUserBrowsingHistory = typeof userBrowsingHistory.$inferInsert;


/**
 * Skill Learning History table for tracking AI learning results.
 * Records each learning session with suggestions and outcomes.
 */
export const skillLearningHistory = mysqlTable("skillLearningHistory", {
  id: int("id").autoincrement().primaryKey(),
  
  // Learning source
  sourceType: mysqlEnum("sourceType", ["tour", "batch", "scheduled", "manual"]).notNull(),
  sourceTourIds: text("sourceTourIds"), // JSON array of tour IDs that were analyzed
  
  // Learning results
  keywordSuggestions: text("keywordSuggestions"), // JSON array of keyword suggestions
  newSkillSuggestions: text("newSkillSuggestions"), // JSON array of new skill suggestions
  identifiedTags: text("identifiedTags"), // JSON array of identified tags
  
  // Statistics
  totalKeywordsFound: int("totalKeywordsFound").default(0).notNull(),
  newKeywordsFound: int("newKeywordsFound").default(0).notNull(),
  suggestionsAccepted: int("suggestionsAccepted").default(0).notNull(),
  suggestionsRejected: int("suggestionsRejected").default(0).notNull(),
  skillsCreated: int("skillsCreated").default(0).notNull(),
  processingTimeMs: int("processingTimeMs"),
  
  // Status
  status: mysqlEnum("status", [
    "pending",     // 等待處理
    "processing",  // 處理中
    "completed",   // 完成
    "failed",      // 失敗
    "partial"      // 部分完成
  ]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  
  // Trigger info
  triggeredBy: mysqlEnum("triggeredBy", ["user", "schedule", "system"]).default("user").notNull(),
  triggeredByUserId: int("triggeredByUserId"), // null for scheduled/system
  
  // Audit
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type SkillLearningHistory = typeof skillLearningHistory.$inferSelect;
export type InsertSkillLearningHistory = typeof skillLearningHistory.$inferInsert;

/**
 * Skill Learning Schedule table for managing automated learning settings.
 * Controls when and how the system automatically learns from new content.
 */
export const skillLearningSchedule = mysqlTable("skillLearningSchedule", {
  id: int("id").autoincrement().primaryKey(),
  
  // Schedule settings
  name: varchar("name", { length: 100 }).notNull(), // Schedule name
  isEnabled: boolean("isEnabled").default(true).notNull(),
  
  // Frequency settings
  frequency: mysqlEnum("frequency", ["daily", "weekly", "monthly"]).default("weekly").notNull(),
  dayOfWeek: int("dayOfWeek"), // 0-6 for weekly (0 = Sunday)
  dayOfMonth: int("dayOfMonth"), // 1-31 for monthly
  hour: int("hour").default(3).notNull(), // Hour to run (0-23), default 3 AM
  minute: int("minute").default(0).notNull(), // Minute to run (0-59)
  
  // Learning scope
  learnFromNewTours: boolean("learnFromNewTours").default(true).notNull(), // Learn from tours created since last run
  maxToursPerRun: int("maxToursPerRun").default(10).notNull(), // Max tours to process per run
  minTourAge: int("minTourAge").default(0).notNull(), // Min age in days before learning from a tour
  
  // Auto-apply settings
  autoApplyHighConfidence: boolean("autoApplyHighConfidence").default(false).notNull(), // Auto-apply suggestions with confidence > threshold
  autoApplyThreshold: decimal("autoApplyThreshold", { precision: 3, scale: 2 }).default("0.90"), // Confidence threshold for auto-apply
  
  // Notification settings
  notifyOnComplete: boolean("notifyOnComplete").default(true).notNull(),
  notifyOnNewSuggestions: boolean("notifyOnNewSuggestions").default(true).notNull(),
  
  // Execution tracking
  lastRunAt: timestamp("lastRunAt"),
  lastRunStatus: mysqlEnum("lastRunStatus", ["success", "failed", "partial"]),
  lastRunHistoryId: int("lastRunHistoryId"), // Reference to skillLearningHistory
  nextRunAt: timestamp("nextRunAt"),
  
  // Audit
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SkillLearningSchedule = typeof skillLearningSchedule.$inferSelect;
export type InsertSkillLearningSchedule = typeof skillLearningSchedule.$inferInsert;


/**
 * Skill Review Queue table for managing pending skill approvals.
 * AI-suggested skills require admin approval before being activated.
 */
export const skillReviewQueue = mysqlTable("skillReviewQueue", {
  id: int("id").autoincrement().primaryKey(),
  
  // Skill information (stored before creating actual skill)
  skillName: varchar("skillName", { length: 100 }).notNull(),
  skillType: mysqlEnum("skillType", ["technique", "pattern", "reference"]).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  keywords: text("keywords").notNull(), // JSON array
  rules: text("rules").notNull(), // JSON object
  description: text("description"),
  outputLabels: text("outputLabels"), // JSON array
  confidence: decimal("confidence", { precision: 3, scale: 2 }).default("0.80"),
  
  // Source information
  sourceType: mysqlEnum("sourceType", ["ai_learning", "scheduled", "manual"]).notNull(),
  sourceTourId: int("sourceTourId"), // Tour that triggered this suggestion
  learningHistoryId: int("learningHistoryId"), // Reference to skillLearningHistory
  
  // Review status
  status: mysqlEnum("status", [
    "pending",     // 等待審核
    "approved",    // 已批准
    "rejected",    // 已拒絕
    "merged"       // 已合併到現有技能
  ]).default("pending").notNull(),
  
  // Review details
  reviewedBy: int("reviewedBy"), // Admin who reviewed
  reviewedAt: timestamp("reviewedAt"),
  reviewNotes: text("reviewNotes"), // Admin's notes
  createdSkillId: int("createdSkillId"), // ID of created skill if approved
  
  // Priority for review
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium").notNull(),
  
  // Audit
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SkillReviewQueue = typeof skillReviewQueue.$inferSelect;
export type InsertSkillReviewQueue = typeof skillReviewQueue.$inferInsert;

/**
 * Tour Statistics table for tracking tour popularity metrics.
 * Used for intelligent learning prioritization.
 */
export const tourStatistics = mysqlTable("tourStatistics", {
  id: int("id").autoincrement().primaryKey(),
  tourId: int("tourId").notNull().unique(),
  
  // View metrics
  viewCount: int("viewCount").default(0).notNull(),
  uniqueViewCount: int("uniqueViewCount").default(0).notNull(),
  
  // Engagement metrics
  favoriteCount: int("favoriteCount").default(0).notNull(),
  shareCount: int("shareCount").default(0).notNull(),
  inquiryCount: int("inquiryCount").default(0).notNull(),
  
  // Booking metrics
  bookingCount: int("bookingCount").default(0).notNull(),
  conversionRate: decimal("conversionRate", { precision: 5, scale: 4 }).default("0.0000"), // bookings / views
  
  // Revenue metrics
  totalRevenue: int("totalRevenue").default(0).notNull(), // in TWD
  
  // Popularity score (calculated)
  popularityScore: decimal("popularityScore", { precision: 10, scale: 4 }).default("0.0000"),
  
  // Learning status
  hasBeenLearned: boolean("hasBeenLearned").default(false).notNull(),
  lastLearnedAt: timestamp("lastLearnedAt"),
  learningPriority: int("learningPriority").default(0).notNull(), // Higher = more priority
  
  // Timestamps
  lastViewedAt: timestamp("lastViewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TourStatistics = typeof tourStatistics.$inferSelect;
export type InsertTourStatistics = typeof tourStatistics.$inferInsert;

/**
 * Learning Analytics table for tracking learning system performance.
 * Aggregated daily statistics for dashboard visualization.
 */
export const learningAnalytics = mysqlTable("learningAnalytics", {
  id: int("id").autoincrement().primaryKey(),
  
  // Date for aggregation
  date: timestamp("date").notNull(),
  
  // Learning activity metrics
  learningSessionsCount: int("learningSessionsCount").default(0).notNull(),
  toursAnalyzed: int("toursAnalyzed").default(0).notNull(),
  keywordsSuggested: int("keywordsSuggested").default(0).notNull(),
  skillsSuggested: int("skillsSuggested").default(0).notNull(),
  
  // Adoption metrics
  keywordsAccepted: int("keywordsAccepted").default(0).notNull(),
  keywordsRejected: int("keywordsRejected").default(0).notNull(),
  skillsApproved: int("skillsApproved").default(0).notNull(),
  skillsRejected: int("skillsRejected").default(0).notNull(),
  
  // Calculated rates
  keywordAdoptionRate: decimal("keywordAdoptionRate", { precision: 5, scale: 4 }).default("0.0000"),
  skillAdoptionRate: decimal("skillAdoptionRate", { precision: 5, scale: 4 }).default("0.0000"),
  
  // Source distribution
  sourceDistribution: text("sourceDistribution"), // JSON: {tour: n, batch: n, scheduled: n, manual: n}
  
  // Performance metrics
  avgProcessingTimeMs: int("avgProcessingTimeMs"),
  totalProcessingTimeMs: int("totalProcessingTimeMs"),
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueDate: unique().on(table.date),
}));

export type LearningAnalytics = typeof learningAnalytics.$inferSelect;
export type InsertLearningAnalytics = typeof learningAnalytics.$inferInsert;


/**
 * Skill Usage Log table for tracking skill performance.
 * Records each time a skill is triggered and its outcome.
 */
export const skillUsageLog = mysqlTable("skillUsageLog", {
  id: int("id").autoincrement().primaryKey(),
  
  // Skill reference
  skillId: int("skillId").notNull(),
  skillName: varchar("skillName", { length: 255 }).notNull(),
  skillType: varchar("skillType", { length: 100 }).notNull(),
  
  // Context
  contextType: mysqlEnum("contextType", [
    "chat",           // AI 客服對話
    "search",         // 搜尋推薦
    "itinerary",      // 行程生成
    "content",        // 內容生成
    "classification"  // 分類標籤
  ]).notNull(),
  contextId: varchar("contextId", { length: 100 }), // Reference to conversation/search/tour ID
  
  // Trigger details
  inputText: text("inputText"), // The input that triggered the skill
  matchedKeywords: text("matchedKeywords"), // JSON array of matched keywords
  outputResult: text("outputResult"), // The skill's output
  
  // User information
  userId: int("userId"), // User who triggered (null for anonymous)
  sessionId: varchar("sessionId", { length: 100 }), // Session identifier
  
  // Outcome tracking
  wasSuccessful: boolean("wasSuccessful").default(true).notNull(),
  errorMessage: text("errorMessage"),
  
  // User feedback
  userFeedback: mysqlEnum("userFeedback", [
    "positive",   // 點讚
    "negative",   // 點踩
    "none"        // 無回饋
  ]).default("none").notNull(),
  feedbackComment: text("feedbackComment"),
  feedbackAt: timestamp("feedbackAt"),
  
  // Conversion tracking
  ledToConversion: boolean("ledToConversion").default(false).notNull(),
  conversionType: mysqlEnum("conversionType", [
    "booking",    // 預訂
    "inquiry",    // 諮詢
    "favorite",   // 收藏
    "share",      // 分享
    "none"        // 無轉換
  ]).default("none"),
  conversionId: int("conversionId"), // Reference to booking/inquiry ID
  conversionAt: timestamp("conversionAt"),
  
  // Performance metrics
  processingTimeMs: int("processingTimeMs"),
  
  // Timestamps
  triggeredAt: timestamp("triggeredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SkillUsageLog = typeof skillUsageLog.$inferSelect;
export type InsertSkillUsageLog = typeof skillUsageLog.$inferInsert;

/**
 * Auto Approval Rules table for automated skill review.
 * Defines rules that automatically approve or reject skill suggestions.
 */
export const autoApprovalRules = mysqlTable("autoApprovalRules", {
  id: int("id").autoincrement().primaryKey(),
  
  // Rule identification
  ruleName: varchar("ruleName", { length: 255 }).notNull(),
  description: text("description"),
  
  // Rule type
  ruleType: mysqlEnum("ruleType", [
    "confidence_threshold",  // 信心度閾值
    "source_type",           // 來源類型
    "keyword_count",         // 關鍵字數量
    "skill_category",        // 技能類別
    "combined"               // 組合規則
  ]).notNull(),
  
  // Rule conditions (JSON format)
  conditions: text("conditions").notNull(), // JSON: {field: value, operator: '>', ...}
  
  // Action
  action: mysqlEnum("action", [
    "auto_approve",   // 自動批准
    "auto_reject",    // 自動拒絕
    "flag_priority",  // 標記為高優先級
    "notify_admin"    // 通知管理員
  ]).notNull(),
  
  // Priority (higher = evaluated first)
  priority: int("priority").default(0).notNull(),
  
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Statistics
  timesTriggered: int("timesTriggered").default(0).notNull(),
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  
  // Audit
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AutoApprovalRule = typeof autoApprovalRules.$inferSelect;
export type InsertAutoApprovalRule = typeof autoApprovalRules.$inferInsert;

/**
 * Skill Performance Metrics table for aggregated skill statistics.
 * Daily aggregated metrics for each skill.
 */
export const skillPerformanceMetrics = mysqlTable("skillPerformanceMetrics", {
  id: int("id").autoincrement().primaryKey(),
  
  // Skill reference
  skillId: int("skillId").notNull(),
  
  // Date for aggregation
  date: timestamp("date").notNull(),
  
  // Usage metrics
  triggerCount: int("triggerCount").default(0).notNull(),
  uniqueUserCount: int("uniqueUserCount").default(0).notNull(),
  
  // Success metrics
  successCount: int("successCount").default(0).notNull(),
  failureCount: int("failureCount").default(0).notNull(),
  successRate: decimal("successRate", { precision: 5, scale: 4 }).default("0.0000"),
  
  // Feedback metrics
  positiveCount: int("positiveCount").default(0).notNull(),
  negativeCount: int("negativeCount").default(0).notNull(),
  satisfactionRate: decimal("satisfactionRate", { precision: 5, scale: 4 }).default("0.0000"),
  
  // Conversion metrics
  conversionCount: int("conversionCount").default(0).notNull(),
  conversionRate: decimal("conversionRate", { precision: 5, scale: 4 }).default("0.0000"),
  
  // Revenue impact (estimated)
  estimatedRevenue: int("estimatedRevenue").default(0).notNull(), // in TWD
  
  // Performance metrics
  avgProcessingTimeMs: int("avgProcessingTimeMs"),
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueSkillDate: unique().on(table.skillId, table.date),
}));

export type SkillPerformanceMetrics = typeof skillPerformanceMetrics.$inferSelect;
export type InsertSkillPerformanceMetrics = typeof skillPerformanceMetrics.$inferInsert;


/**
 * Translations table for storing translated content.
 * Supports multi-language translations for tours, pages, and UI elements.
 */
export const translations = mysqlTable("translations", {
  id: int("id").autoincrement().primaryKey(),
  
  // Entity reference — v78q: added inquiry, destination, homepage_content for the
  // generic translateEntity() pipeline (see server/translationRegistry.ts).
  entityType: mysqlEnum("entityType", ["tour", "tour_departure", "page", "ui_element", "notification", "inquiry", "destination", "homepage_content"]).notNull(),
  entityId: int("entityId").notNull(),
  fieldName: varchar("fieldName", { length: 100 }).notNull(), // e.g., "title", "description", "dailyItinerary"
  
  // Language information
  sourceLanguage: varchar("sourceLanguage", { length: 10 }).default("zh-TW").notNull(),
  targetLanguage: varchar("targetLanguage", { length: 10 }).notNull(), // e.g., "en", "ja", "ko"
  
  // Content
  originalText: text("originalText").notNull(),
  translatedText: text("translatedText").notNull(),
  
  // Metadata
  translatedBy: varchar("translatedBy", { length: 100 }), // "auto", "user:123", "admin"
  isVerified: boolean("isVerified").default(false).notNull(), // Human verified
  verifiedBy: int("verifiedBy"),
  verifiedAt: timestamp("verifiedAt"),
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  entityIdx: index("entity_idx").on(table.entityType, table.entityId),
  langIdx: index("lang_idx").on(table.targetLanguage),
  uniqueTranslation: unique().on(table.entityType, table.entityId, table.fieldName, table.targetLanguage),
}));

export type Translation = typeof translations.$inferSelect;
export type InsertTranslation = typeof translations.$inferInsert;

/**
 * Translation Jobs table for tracking batch translation tasks.
 */
export const translationJobs = mysqlTable("translationJobs", {
  id: int("id").autoincrement().primaryKey(),
  
  // Job type
  jobType: mysqlEnum("jobType", ["tour_full", "tour_update", "batch_tours", "ui_elements", "custom"]).notNull(),
  
  // Entity information
  entityType: varchar("entityType", { length: 50 }), // "tour", "page", etc.
  entityIds: text("entityIds"), // JSON array of entity IDs
  
  // Target languages
  targetLanguages: text("targetLanguages").notNull(), // JSON array of language codes
  
  // Progress tracking
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed", "partial"]).default("pending").notNull(),
  totalItems: int("totalItems").default(0).notNull(),
  completedItems: int("completedItems").default(0).notNull(),
  failedItems: int("failedItems").default(0).notNull(),
  
  // Results and errors
  results: text("results"), // JSON object with translation results
  errors: text("errors"), // JSON array of error messages
  
  // Performance metrics
  processingTimeMs: int("processingTimeMs"),
  
  // User tracking
  createdBy: int("createdBy").notNull(),
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
});

export type TranslationJob = typeof translationJobs.$inferSelect;
export type InsertTranslationJob = typeof translationJobs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// LLM 用量監控日誌
// 記錄每次 Claude API 呼叫的 token 用量與費用，供成本分析使用
// ─────────────────────────────────────────────────────────────────────────────
export const llmUsageLogs = mysqlTable("llmUsageLogs", {
  id: int("id").autoincrement().primaryKey(),

  // 呼叫來源識別
  agentName: varchar("agentName", { length: 100 }).notNull(), // 例如 "ContentAnalyzerAgent"
  taskType: varchar("taskType", { length: 100 }),             // 例如 "tour_generation", "ai_chat"
  taskId: varchar("taskId", { length: 100 }),                 // 關聯的任務 ID（如 tourId）

  // 使用的模型
  model: varchar("model", { length: 100 }).notNull(),         // 例如 "claude-3-5-haiku-20241022"

  // Token 用量
  inputTokens: int("inputTokens").default(0).notNull(),
  outputTokens: int("outputTokens").default(0).notNull(),
  cacheCreationInputTokens: int("cacheCreationInputTokens").default(0).notNull(),
  cacheReadInputTokens: int("cacheReadInputTokens").default(0).notNull(),
  totalTokens: int("totalTokens").default(0).notNull(),

  // 費用估算（USD，精確到小數點後 6 位）
  estimatedCostUsd: varchar("estimatedCostUsd", { length: 20 }).default("0.000000"),

  // 效能指標
  processingTimeMs: int("processingTimeMs"),
  wasFromCache: boolean("wasFromCache").default(false).notNull(),

  // 使用者關聯（可選）
  userId: int("userId"),

  // 時間戳記
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LlmUsageLog = typeof llmUsageLogs.$inferSelect;
export type InsertLlmUsageLog = typeof llmUsageLogs.$inferInsert;

/**
 * Agent Activity Logs table - 記錄每個 Agent 的任務開始/完成/失敗事件
 * 用於 AI 辦公室看板顯示即時狀態和工作日誌
 */
export const agentActivityLogs = mysqlTable("agentActivityLogs", {
  id: int("id").autoincrement().primaryKey(),
  // Agent 識別
  agentName: varchar("agentName", { length: 100 }).notNull(),   // 例如 "MasterAgent"
  agentKey: varchar("agentKey", { length: 100 }),               // 例如 "master"（對應前端卡牌）
  // 任務資訊
  taskType: varchar("taskType", { length: 100 }),               // 例如 "tour_generation"
  taskId: varchar("taskId", { length: 100 }),                   // 關聯的任務 ID
  taskTitle: varchar("taskTitle", { length: 500 }),             // 任務摘要（例如「生成日本東京 5 日行程」）
  // 狀態
  status: mysqlEnum("status", ["started", "completed", "failed", "idle"]).notNull().default("started"),
  // 執行結果
  resultSummary: text("resultSummary"),                         // 完成後的工作摘要（給 Jeff 看的）
  errorMessage: varchar("errorMessage", { length: 1000 }),      // 失敗時的錯誤訊息
  // 效能
  processingTimeMs: int("processingTimeMs"),
  // 使用者關聯
  userId: int("userId"),
  // 時間戳記
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type AgentActivityLog = typeof agentActivityLogs.$inferSelect;
export type InsertAgentActivityLog = typeof agentActivityLogs.$inferInsert;

/**
 * Calibration Results table - 記錄每個行程的自動 QA 品質評分
 * 由 CalibrationAgent 在行程生成後自動執行，結果存入此表
 */
export const calibrationResults = mysqlTable("calibrationResults", {
  id: int("id").autoincrement().primaryKey(),
  tourId: int("tourId").notNull(),

  // 5 項檢查分數（0-100）
  contentFidelityScore: int("contentFidelityScore").notNull(),       // CHECK 1: 內容忠實度（30%權重）
  translationScore: int("translationScore").notNull(),               // CHECK 2: 翻譯品質（20%）
  imageScore: int("imageScore").notNull(),                           // CHECK 3: 圖片品質（20%）
  completenessScore: int("completenessScore").notNull(),             // CHECK 4: 完整度（15%）
  marketingScore: int("marketingScore").notNull(),                   // CHECK 5: 行銷品質（15%）

  // 加權總分
  totalScore: int("totalScore").notNull(),                           // 0-100 加權平均

  // 結果
  verdict: mysqlEnum("verdict", ["approved", "review", "rejected"]).notNull(),

  // 問題清單
  issues: text("issues"),                 // JSON: [{ check, severity, message, autoFixable }]
  autoFixesApplied: text("autoFixesApplied"),  // JSON: [{ field, before, after }]

  // 原始資料快照（用於比對）
  sourceSnapshot: text("sourceSnapshot"),  // PDF/URL 原始內容摘要

  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CalibrationResult = typeof calibrationResults.$inferSelect;
export type InsertCalibrationResult = typeof calibrationResults.$inferInsert;


// ══════════════════════════════════════════════════════════════
// 競品監控系統 (Competitor Monitoring)
// ══════════════════════════════════════════════════════════════

// ── 1. 追蹤的競品行程 ──────────────────────────────────────
export const competitorTours = mysqlTable("competitorTours", {
  id: int("id").autoincrement().primaryKey(),
  competitor: mysqlEnum("competitor", ["liontravel", "colatour", "settour"]).default("liontravel").notNull(),
  tourUrl: varchar("tourUrl", { length: 1024 }).notNull(),
  normGroupId: varchar("normGroupId", { length: 100 }),
  tourTitle: varchar("tourTitle", { length: 500 }),
  destination: varchar("destination", { length: 255 }),
  duration: int("duration"),
  basePrice: int("basePrice"),
  lastScrapedAt: timestamp("lastScrapedAt"),
  scrapeStatus: mysqlEnum("scrapeStatus", ["active", "paused", "error"]).default("active").notNull(),
  scrapeErrorMessage: text("scrapeErrorMessage"),
  scrapeFrequency: mysqlEnum("scrapeFrequency", ["6h", "12h", "daily", "weekly"]).default("daily").notNull(),
  matchedTourId: int("matchedTourId"),
  notes: text("notes"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CompetitorTour = typeof competitorTours.$inferSelect;
export type InsertCompetitorTour = typeof competitorTours.$inferInsert;

// ── 2. 出團日期快照（每次爬取存一份） ─────────────────────
export const competitorDepartures = mysqlTable("competitorDepartures", {
  id: int("id").autoincrement().primaryKey(),
  competitorTourId: int("competitorTourId").notNull(),
  departureDate: varchar("departureDate", { length: 20 }).notNull(),
  returnDate: varchar("returnDate", { length: 20 }),
  adultPrice: int("adultPrice"),
  childPrice: int("childPrice"),
  singleSupplement: int("singleSupplement"),
  totalSeats: int("totalSeats"),
  availableSeats: int("availableSeats"),
  departureStatus: mysqlEnum("departureStatus", ["open", "full", "cancelled", "guaranteed"]).default("open").notNull(),
  scrapedAt: timestamp("scrapedAt").defaultNow().notNull(),
});
export type CompetitorDeparture = typeof competitorDepartures.$inferSelect;
export type InsertCompetitorDeparture = typeof competitorDepartures.$inferInsert;

// ── 3. 價格歷史（追蹤變動） ──────────────────────────────
export const competitorPriceHistory = mysqlTable("competitorPriceHistory", {
  id: int("id").autoincrement().primaryKey(),
  competitorTourId: int("competitorTourId").notNull(),
  departureDate: varchar("departureDate", { length: 20 }).notNull(),
  price: int("price").notNull(),
  previousPrice: int("previousPrice"),
  priceChange: int("priceChange"),
  changeType: mysqlEnum("changeType", ["increase", "decrease", "new", "unchanged"]).default("new").notNull(),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
});
export type CompetitorPriceHistory = typeof competitorPriceHistory.$inferSelect;
export type InsertCompetitorPriceHistory = typeof competitorPriceHistory.$inferInsert;

// ── 4. 告警 ──────────────────────────────────────────────
export const competitorAlerts = mysqlTable("competitorAlerts", {
  id: int("id").autoincrement().primaryKey(),
  competitorTourId: int("competitorTourId").notNull(),
  alertType: mysqlEnum("alertType", [
    "price_drop",
    "price_increase",
    "low_seats",
    "sold_out",
    "new_departure",
    "tour_cancelled",
    "guaranteed",
  ]).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  message: text("message"),
  severity: mysqlEnum("severity", ["info", "warning", "critical"]).default("info").notNull(),
  metadata: text("metadata"),
  isRead: int("isRead").default(0).notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CompetitorAlert = typeof competitorAlerts.$inferSelect;
export type InsertCompetitorAlert = typeof competitorAlerts.$inferInsert;

// ── 行銷自動化系統 ────────────────────────────────────────────

// ── 1. 行銷活動 ──────────────────────────────────────────
export const marketingCampaigns = mysqlTable("marketingCampaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 500 }).notNull(),
  type: mysqlEnum("type", [
    "social_post",
    "email_newsletter",
    "poster",
  ]).notNull(),
  status: mysqlEnum("status", [
    "draft",
    "scheduled",
    "sending",
    "sent",
    "cancelled",
  ]).default("draft").notNull(),
  tourIds: text("tourIds"),
  content: text("content"),
  scheduledAt: timestamp("scheduledAt"),
  sentAt: timestamp("sentAt"),
  recipientCount: int("recipientCount").default(0),
  metadata: text("metadata"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type MarketingCampaign = typeof marketingCampaigns.$inferSelect;
export type InsertMarketingCampaign = typeof marketingCampaigns.$inferInsert;

// ── 2. 行銷素材 ─────────────────────────────────────────
export const marketingMaterials = mysqlTable("marketingMaterials", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId"),
  tourId: int("tourId").notNull(),
  type: mysqlEnum("type", [
    "social_copy_fb",
    "social_copy_ig",
    "social_copy_line",
    "email_html",
    "poster_landscape",
    "poster_square",
    "poster_story",
  ]).notNull(),
  content: text("content"),
  imageUrl: varchar("imageUrl", { length: 1024 }),
  metadata: text("metadata"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MarketingMaterial = typeof marketingMaterials.$inferSelect;
export type InsertMarketingMaterial = typeof marketingMaterials.$inferInsert;

// ── 3. Email 發送記錄 ─────────────────────────────────────
export const emailSendLogs = mysqlTable("emailSendLogs", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  subscriberEmail: varchar("subscriberEmail", { length: 320 }).notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed", "bounced"]).default("pending").notNull(),
  sentAt: timestamp("sentAt"),
  errorMessage: text("errorMessage"),
  openedAt: timestamp("openedAt"),
  clickedAt: timestamp("clickedAt"),
});
export type EmailSendLog = typeof emailSendLogs.$inferSelect;
export type InsertEmailSendLog = typeof emailSendLogs.$inferInsert;

// ══════════════════════════════════════════════════════════════
// PHASE 6: 中國簽證代辦服務
// ══════════════════════════════════════════════════════════════

// ── 1. 簽證申請 ──────────────────────────────────────────────
export const visaApplications = mysqlTable("visaApplications", {
  id: int("id").autoincrement().primaryKey(),
  // 申請人資訊
  userId: int("userId"),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),

  // 護照資訊
  // v2 Wave 1 · Module 1.8 (migration 0078): widened from VARCHAR(50) to
  // VARCHAR(255) to hold AES-256-GCM ciphertext (~96 chars base64) via
  // server/_core/tokenCrypto.ts. Reads/writes go through db.ts helpers
  // that wrap encryptToken / decryptToken; ANY direct Drizzle access to
  // this column must do the same. See CLAUDE.md §四 forbidden patterns.
  passportNumber: varchar("passportNumber", { length: 255 }).notNull(),
  passportExpiry: varchar("passportExpiry", { length: 20 }).notNull(),
  passportCountry: varchar("passportCountry", { length: 100 }).default("United States").notNull(),
  dateOfBirth: varchar("dateOfBirth", { length: 20 }).notNull(),
  placeOfBirth: varchar("placeOfBirth", { length: 200 }),

  // 簽證資訊
  visaType: mysqlEnum("visaType", [
    "L_tourist",
    "M_business",
    "Q1_family_long",
    "Q2_family_short",
    "S1_dependent_long",
    "S2_dependent_short",
    "Z_work",
    "X1_study_long",
    "X2_study_short",
  ]).default("L_tourist").notNull(),
  entryType: mysqlEnum("entryType", [
    "single",
    "double",
    "multiple_6m",
    "multiple_12m",
  ]).default("single").notNull(),
  processingSpeed: mysqlEnum("processingSpeed", [
    "regular",
    "express",
    "rush",
  ]).default("regular").notNull(),

  // 旅行資訊
  travelDate: varchar("travelDate", { length: 20 }),
  travelPurpose: text("travelPurpose"),
  previousVisits: int("previousVisits").default(0),

  // 定價
  serviceFee: decimal("serviceFee", { precision: 10, scale: 2 }).notNull(),
  consulateFee: decimal("consulateFee", { precision: 10, scale: 2 }),
  totalAmount: decimal("totalAmount", { precision: 10, scale: 2 }).notNull(),
  discountType: mysqlEnum("discountType", [
    "none",
    "group",
    "returning",
  ]).default("none").notNull(),

  // 付款
  paymentStatus: mysqlEnum("paymentStatus", [
    "unpaid",
    "paid",
    "refunded",
  ]).default("unpaid").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", { length: 255 }),
  paidAt: timestamp("paidAt"),

  // 申請狀態
  applicationStatus: mysqlEnum("applicationStatus", [
    "draft",
    "submitted",
    "paid",
    "documents_received",
    "processing",
    "approved",
    "rejected",
    "completed",
    "cancelled",
  ]).default("draft").notNull(),

  // Admin 備註
  adminNotes: text("adminNotes"),
  trackingNumber: varchar("trackingNumber", { length: 100 }),

  // 附加文件（JSON array of S3 URLs）
  uploadedDocuments: text("uploadedDocuments"),

  // 同行申請人（JSON array for group applications）
  groupApplicants: text("groupApplicants"),
  groupSize: int("groupSize").default(1).notNull(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type VisaApplication = typeof visaApplications.$inferSelect;
export type InsertVisaApplication = typeof visaApplications.$inferInsert;

// ── 2. 簽證申請狀態歷程 ──────────────────────────────────────
export const visaStatusHistory = mysqlTable("visaStatusHistory", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("applicationId").notNull(),
  fromStatus: varchar("fromStatus", { length: 50 }),
  toStatus: varchar("toStatus", { length: 50 }).notNull(),
  changedBy: int("changedBy"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type VisaStatusHistory = typeof visaStatusHistory.$inferSelect;
export type InsertVisaStatusHistory = typeof visaStatusHistory.$inferInsert;

// ── 聯盟點擊追蹤 ──────────────────────────────────────────────
export const affiliateClicks = mysqlTable("affiliateClicks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  platform: mysqlEnum("platform", ["trip_flights", "trip_hotels", "trip_homepage"]).notNull(),
  targetUrl: varchar("targetUrl", { length: 2048 }).notNull(),
  referrerPage: varchar("referrerPage", { length: 500 }),
  tourId: int("tourId"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AffiliateClick = typeof affiliateClicks.$inferSelect;
export type InsertAffiliateClick = typeof affiliateClicks.$inferInsert;

// ── 行程價格比較資料 ──────────────────────────────────────────
export const tourPriceComparisons = mysqlTable("tourPriceComparisons", {
  id: int("id").autoincrement().primaryKey(),
  tourId: int("tourId").notNull(),
  flightEstimate: int("flightEstimate"),
  hotelEstimate: int("hotelEstimate"),
  activityEstimate: int("activityEstimate"),
  mealEstimate: int("mealEstimate"),
  transportEstimate: int("transportEstimate"),
  otherEstimate: int("otherEstimate"),
  totalSelfBook: int("totalSelfBook"),
  flightSource: varchar("flightSource", { length: 500 }),
  hotelSource: varchar("hotelSource", { length: 500 }),
  lastUpdated: timestamp("lastUpdated").defaultNow().notNull(),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TourPriceComparison = typeof tourPriceComparisons.$inferSelect;
export type InsertTourPriceComparison = typeof tourPriceComparisons.$inferInsert;

// ── 收支記錄（統一帳本） ──────────────────────────────────────────
export const accountingEntries = mysqlTable("accountingEntries", {
  id: int("id").autoincrement().primaryKey(),
  entryType: mysqlEnum("entryType", ["income", "expense"]).notNull(),
  category: mysqlEnum("category", [
    "tour_booking",
    "visa_service",
    "affiliate_commission",
    "flight_booking",
    "hotel_booking",
    "other_income",
    "rent",
    "utilities",
    "salary",
    "marketing",
    "travel_cost",
    "supplier_payment",
    "office_supplies",
    "software",
    "insurance",
    "tax_payment",
    "bank_fee",
    "stripe_fee",
    "consulate_fee",
    "other_expense",
  ]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  description: varchar("description", { length: 1000 }).notNull(),
  bookingId: int("bookingId"),
  visaApplicationId: int("visaApplicationId"),
  paymentId: int("paymentId"),
  entryDate: timestamp("entryDate").notNull(),
  receiptUrl: varchar("receiptUrl", { length: 1024 }),
  notes: text("notes"),
  tags: varchar("tags", { length: 500 }),
  isTaxDeductible: int("isTaxDeductible").default(0).notNull(),
  taxCategory: varchar("taxCategory", { length: 100 }),
  // email-receipt-intake (2026-06-15): which bank account this expense came
  // out of. Trust = #5442 (客人訂金), Operating = #2174 (日常). Nullable —
  // legacy + Plaid-side entries don't set it; only entries created from a
  // confirmed pendingExpense (handledMode='ledger') carry it. Trust/Operating
  // is otherwise tracked on linkedBankAccounts.isTrustAccount (Plaid side).
  account: mysqlEnum("account", ["trust", "operating"]),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AccountingEntry = typeof accountingEntries.$inferSelect;
export type InsertAccountingEntry = typeof accountingEntries.$inferInsert;

// ── 客戶發票 ──────────────────────────────────────────────────────
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 50 }).notNull().unique(),
  customerName: varchar("customerName", { length: 200 }).notNull(),
  customerEmail: varchar("customerEmail", { length: 320 }),
  customerPhone: varchar("customerPhone", { length: 50 }),
  customerAddress: text("customerAddress"),
  bookingId: int("bookingId"),
  visaApplicationId: int("visaApplicationId"),
  // custom-orders (0099): reverse FK so one 訂製單 can carry its 訂金 + 尾款 invoices.
  // Nullable — package/visa invoices leave it null.
  customOrderId: int("customOrderId"),
  userId: int("userId"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("0"),
  taxAmount: decimal("taxAmount", { precision: 12, scale: 2 }).default("0"),
  totalAmount: decimal("totalAmount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  lineItems: text("lineItems"),
  status: mysqlEnum("status", ["draft", "sent", "paid", "overdue", "cancelled"]).default("draft").notNull(),
  dueDate: timestamp("dueDate"),
  paidAt: timestamp("paidAt"),
  sentAt: timestamp("sentAt"),
  pdfUrl: varchar("pdfUrl", { length: 1024 }),
  // v78g: invoice HTML inlined so invoices work without R2 storage
  pdfHtml: text("pdfHtml"),
  notes: text("notes"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // custom-orders (0099): listInvoicesForCustomOrder filters on this reverse FK.
  customOrderIdx: index("idx_inv_custom_order").on(t.customOrderId),
}));
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ── 定期支出模板 ──────────────────────────────────────────────────
export const recurringExpenses = mysqlTable("recurringExpenses", {
  id: int("id").autoincrement().primaryKey(),
  category: varchar("category", { length: 50 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  frequency: mysqlEnum("frequency", ["monthly", "quarterly", "yearly"]).default("monthly").notNull(),
  dayOfMonth: int("dayOfMonth").default(1),
  isTaxDeductible: int("isTaxDeductible").default(1).notNull(),
  taxCategory: varchar("taxCategory", { length: 100 }),
  isActive: int("isActive").default(1).notNull(),
  lastGeneratedAt: timestamp("lastGeneratedAt"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type InsertRecurringExpense = typeof recurringExpenses.$inferInsert;

// ── 待確認支出 (email-receipt-intake, 2026-06-15) ──────────────────────
/**
 * Staging table for receipts/invoices auto-read from Gmail. The AI ONLY
 * receives, reads, and queues — it NEVER books. Jeff confirms each row, and
 * at confirm time decides the amount, which trip (bookingId), Trust vs
 * Operating, and whether to write a real ledger entry or just archive the
 * receipt for later Plaid reconciliation. See
 * docs/features/email-receipt-intake/design.md.
 *
 * 鐵則: 讀不清楚 → needsReview=1 + amount NULL ("請人工看"), 留白不猜。
 * Dedup: gmailMessageId is UNIQUE so re-polling the same email never
 * creates a duplicate card.
 */
export const pendingExpenses = mysqlTable(
  "pendingExpenses",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Where this came from. Phase 1 = gmail only. */
    source: mysqlEnum("source", ["gmail", "manual", "upload"]).default("gmail").notNull(),

    // ── provenance (for dedup + jump-back to the source email) ──
    gmailMessageId: varchar("gmailMessageId", { length: 128 }),
    gmailThreadId: varchar("gmailThreadId", { length: 128 }),
    integrationId: int("integrationId"),
    fromAddress: varchar("fromAddress", { length: 320 }),
    emailSubject: varchar("emailSubject", { length: 500 }),

    // ── AI-extracted fields (any may be NULL if unreadable → needsReview) ──
    vendor: varchar("vendor", { length: 255 }),
    amount: decimal("amount", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 3 }),
    receiptDate: timestamp("receiptDate"),
    /** Line items / what was bought. Plain text. */
    description: text("description"),
    /** 0-100 — AI's confidence it read the receipt correctly. */
    extractionConfidence: int("extractionConfidence").default(0).notNull(),
    /** 1 = AI couldn't read it cleanly → show "請人工看", do not trust fields. */
    needsReview: int("needsReview").default(0).notNull(),
    /** Full raw LLM JSON for audit (never shown to customer). */
    extractionRaw: text("extractionRaw"),

    // ── receipt attachment in R2 (key, not URL — view via short-TTL signed URL) ──
    attachmentKey: varchar("attachmentKey", { length: 1024 }),
    attachmentFilename: varchar("attachmentFilename", { length: 512 }),
    attachmentMimeType: varchar("attachmentMimeType", { length: 128 }),

    // ── status + Jeff's confirm-time decisions ──
    status: mysqlEnum("status", ["pending", "confirmed", "rejected"]).default("pending").notNull(),
    /**
     * Set at confirm. 'ledger' = wrote a real accountingEntries row;
     * 'receipt_only' = just archived (this expense will/did arrive via Plaid,
     * so booking it here would double-count).
     */
    handledMode: mysqlEnum("handledMode", ["ledger", "receipt_only"]),
    /** Trust (#5442) vs Operating (#2174). Set at confirm. */
    account: mysqlEnum("account", ["trust", "operating"]),
    /** accountingEntries.category chosen at confirm (when handledMode='ledger'). */
    entryCategory: varchar("entryCategory", { length: 50 }),
    /** Which trip (bookings.id). Set at confirm. */
    bookingId: int("bookingId"),
    /** FK to the accountingEntries row created on confirm (handledMode='ledger'). */
    accountingEntryId: int("accountingEntryId"),
    rejectReason: varchar("rejectReason", { length: 500 }),

    createdBy: int("createdBy"), // null = system/AI
    confirmedBy: int("confirmedBy"),
    confirmedAt: timestamp("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    gmailMsgIdx: unique("uniq_pending_gmail_msg").on(table.gmailMessageId),
    statusIdx: index("idx_pending_status").on(table.status, table.createdAt),
  }),
);
export type PendingExpense = typeof pendingExpenses.$inferSelect;
export type InsertPendingExpense = typeof pendingExpenses.$inferInsert;

// ── 供應商監控日誌 ──────────────────────────────────────────────────
// Stores results of daily supplier monitoring runs (price changes, seat availability, etc.)
export const tourMonitorLogs = mysqlTable("tourMonitorLogs", {
  id: int("id").autoincrement().primaryKey(),
  tourId: int("tourId").notNull(), // references tours.id
  monitoredAt: timestamp("monitoredAt").defaultNow().notNull(), // when this check ran
  sourceUrl: varchar("sourceUrl", { length: 1024 }), // URL that was checked
  
  // Departure availability changes
  departureDate: varchar("departureDate", { length: 20 }), // YYYY-MM-DD
  previousStatus: varchar("previousStatus", { length: 20 }), // 'open' | 'soldout' | 'confirmed' | 'cancelled'
  currentStatus: varchar("currentStatus", { length: 20 }), // 'open' | 'soldout' | 'confirmed' | 'cancelled'
  
  // Price changes
  previousPrice: int("previousPrice"), // in TWD
  currentPrice: int("currentPrice"), // in TWD
  priceChanged: int("priceChanged").default(0), // 0=no, 1=yes
  
  // Seat availability
  previousSeats: int("previousSeats"),
  currentSeats: int("currentSeats"),
  seatsChanged: int("seatsChanged").default(0), // 0=no, 1=yes
  
  // Overall change detection
  hasChanges: int("hasChanges").default(0), // 0=no changes, 1=changes detected
  changesSummary: text("changesSummary"), // human-readable summary of changes
  rawSnapshot: text("rawSnapshot"), // JSON - raw scraped data snapshot
  
  // Monitor run metadata
  runId: varchar("runId", { length: 64 }), // unique ID per monitoring run (groups all tours in one run)
  status: mysqlEnum("status", ["success", "failed", "skipped"]).default("success").notNull(),
  errorMessage: text("errorMessage"), // if status=failed
  durationMs: int("durationMs"), // how long this check took
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TourMonitorLog = typeof tourMonitorLogs.$inferSelect;
export type InsertTourMonitorLog = typeof tourMonitorLogs.$inferInsert;

// ── WeChat 訊息收件匣（v78）─────────────────────────────────────────────────
// Inbound from WeChat OA webhook, AI drafts a reply, owner reviews/approves.
// Until WeChat OA is verified, this table backs a manual-paste interface so
// the AI can still draft replies to messages Jeff copies in from his phone.
export const wechatMessages = mysqlTable("wechatMessages", {
  id: int("id").autoincrement().primaryKey(),
  // Source
  source: mysqlEnum("source", ["wechat_oa", "manual_paste", "moments_reply"]).notNull(),
  fromOpenId: varchar("fromOpenId", { length: 64 }), // WeChat user OpenID (null for manual paste)
  fromDisplayName: varchar("fromDisplayName", { length: 200 }),
  // Content
  inboundText: text("inboundText").notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  // AI draft
  aiDraftText: text("aiDraftText"),
  aiDraftAt: timestamp("aiDraftAt"),
  aiConfidence: decimal("aiConfidence", { precision: 3, scale: 2 }), // 0.00-1.00
  // Owner action
  status: mysqlEnum("status", ["pending_draft", "ready_review", "approved", "sent", "skipped"]).default("pending_draft").notNull(),
  finalText: text("finalText"),       // edits made by owner before sending
  approvedAt: timestamp("approvedAt"),
  sentAt: timestamp("sentAt"),
  // Linkage
  linkedQuoteId: int("linkedQuoteId"),     // if this thread led to a quote
  linkedBookingId: int("linkedBookingId"), // if it led to a booking
  // 批2 m5 (migration 0093) — 歸戶: users.id when the sender maps to a
  // registered customer (auto via customerProfiles.wechatId on OA inbound,
  // else manual assign). Nullable: manual pastes often can't be matched.
  customerUserId: int("customerUserId"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  customerIdx: index("idx_wm_customer").on(t.customerUserId, t.receivedAt),
}));
export type WechatMessage = typeof wechatMessages.$inferSelect;
export type InsertWechatMessage = typeof wechatMessages.$inferInsert;

// ── AI 報價單（v78）──────────────────────────────────────────────────────────
// Customer free-form intent → LLM extracts {destination, days, pax, budget…}
// → tour catalog match → PDF quote sent to customer.  Saved here so the
// admin can follow up, see conversion funnel (quoted → booked), and re-issue.
export const aiQuotes = mysqlTable("aiQuotes", {
  id: int("id").autoincrement().primaryKey(),
  // Original free-form request
  rawRequest: text("rawRequest").notNull(),
  // Extracted parameters (JSON: {destination, days, adults, children, budget, currency, departureMonth, preferences})
  extractedParams: text("extractedParams"),
  // Quote output
  quoteNumber: varchar("quoteNumber", { length: 32 }).notNull().unique(), // QUOTE-2026-0001
  recommendedTours: text("recommendedTours"), // JSON array of tour IDs that were matched
  estimatedTotal: int("estimatedTotal"),       // best-effort total in `currency`
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  pdfUrl: varchar("pdfUrl", { length: 1024 }), // public URL — either R2 or /api/aiQuotes/:id/view
  // v78f: HTML body inlined so the quote works without R2 storage. The
  // /api/aiQuotes/:id/view endpoint reads this column and serves it.
  pdfHtml: text("pdfHtml"),
  // Customer info (optional — anonymous quote OK)
  customerName: varchar("customerName", { length: 200 }),
  customerEmail: varchar("customerEmail", { length: 320 }),
  customerPhone: varchar("customerPhone", { length: 50 }),
  userId: int("userId"),                       // null if anonymous
  // Funnel tracking
  status: mysqlEnum("status", ["generated", "sent", "viewed", "converted", "expired"]).default("generated").notNull(),
  bookingId: int("bookingId"),                 // populated if quote → booking
  // Validity
  validUntil: timestamp("validUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AiQuote = typeof aiQuotes.$inferSelect;
export type InsertAiQuote = typeof aiQuotes.$inferInsert;

// ── 訂製單 (custom-orders, migration 0099, 2026-06-21) ───────────────────────
// PACK&GO 的生意是訂製單 (bespoke),不是套裝跟團。一筆訂製單 = 這裡一列,把
// 報價 → 收款(訂金/尾款)→ 確認 串成系統裡真正的一筆訂單。客戶頁 (CustomerDetail)
// 三顆 header 按鈕(報價/催款/確認書)落在這列上。送出一律 Jeff 親自按 (confirm
// gate);系統/agent 不自動發。設計見 docs/features/custom-orders/design.md。
//
// 錢與法遵紅線(編碼在欄位 + 註解):
//   - supplierCost 絕不上任何 customer-facing payload / email。LLM 自動化路徑的
//     精確定義(Phase2 2b,server/_core/supplierCostVerification.ts)：只能透過
//     create_custom_order / update_custom_order 這兩個 opsTools 寫入,且必須附上
//     sourceDocId(customerDocuments.id)並通過 resolveAndVerifySupplierCost 驗證
//     ——金額要真的出現在該供應商文件的文字裡才會被接受,對不上或沒附文件一律拒絕
//     整個欄位(其餘欄位正常寫入)。任何自動化 pipeline(收信/夜掃/看門狗/其他
//     agent)一律不可寫這個欄位。admin 後台(server/routers/adminCustomerOrders.ts
//     的 create/update mutation)是 Jeff 本人手動輸入的既有路徑,不經過這層驗證,
//     責任在 Jeff 本人核對 invoice;審查靠 grep 全 repo 對 customOrders.supplierCost
//     的賦值點,不是型別系統天然擋(Drizzle insert/update 型別本來就允許這欄)。
//   - depositPaidAt/balancePaidAt 只記「已收金額與時間」,不是營收認列。CA B&P
//     §17550:訂金 ≠ 營收,出發後才認列。Trust #5442 對帳走銀行 + 會計,不在此表。
//     recognizedAt 只是佔位,本批不寫 accountingEntries。
export const customOrders = mysqlTable("customOrders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("orderNumber", { length: 32 }).notNull().unique(), // ORD-2026-0001

  // 歸戶:customerProfileId 是 canonical anchor(guest 本來就有一列;registered
  // 在 createOrder 時 find-or-create)。userId 去正規化方便欄。name/email 快照
  // (同 invoices 做法),profile 之後改名不影響歷史單。
  customerProfileId: int("customerProfileId").notNull(),
  userId: int("userId"),
  customerName: varchar("customerName", { length: 200 }).notNull(),
  customerEmail: varchar("customerEmail", { length: 320 }),

  // 行程
  title: varchar("title", { length: 200 }).notNull(),
  destination: varchar("destination", { length: 200 }),
  // customer-projects (0105) — 總類: what KIND of case this project is
  // (flight / quote / visa / general), so each project reads 時間·總類·幹嘛.
  // A coordinator like Emerald (AXT) sends many different cases under one inbox;
  // the category lets Jeff tell them apart at a glance. varchar (not enum) so
  // categories can be added without a migration — the UI offers a fixed set of
  // keys mapped to i18n labels. NULL = 未標.
  category: varchar("category", { length: 32 }),
  // string mode ("YYYY-MM-DD") — pure calendar dates, no tz games.
  departureDate: date("departureDate", { mode: "string" }),
  returnDate: date("returnDate", { mode: "string" }),

  // 狀態機(design §3)。報價是可選步驟:needsQuote=0 走 draft→arranged。
  status: mysqlEnum("status", [
    "draft", "quoted", "arranged",
    "deposit_paid", "paid", "confirmed",
    "departed", "completed", "cancelled",
  ]).default("draft").notNull(),
  needsQuote: int("needsQuote").default(1).notNull(),

  // 報價:引用 Jeff skill 出的 PDF(主);quoteId 選連 aiQuotes funnel 紀錄。
  quotePdfUrl: varchar("quotePdfUrl", { length: 1024 }),
  quoteId: int("quoteId"),
  quoteSentAt: timestamp("quoteSentAt"),

  // 金額(售價,直客價)
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }),
  depositAmount: decimal("depositAmount", { precision: 12, scale: 2 }),
  balanceAmount: decimal("balanceAmount", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),

  // 成本(只 admin 算 margin,絕不上客人文件;寫入規則見上方表級註解 Phase2 2b)
  supplierCost: decimal("supplierCost", { precision: 12, scale: 2 }),

  // 收款(只記已收金額+時間,不做 Trust 分錄)
  depositPaidAt: timestamp("depositPaidAt"),
  balancePaidAt: timestamp("balancePaidAt"),
  // 「已收」金額,與 depositAmount/balanceAmount(=應收/契約價)分開存,絕不混用。
  // recordPayment 寫這兩欄;應收欄維持契約價(決策 A)。received 顯示用這兩欄。
  depositPaidAmount: decimal("depositPaidAmount", { precision: 12, scale: 2 }),
  balancePaidAmount: decimal("balancePaidAmount", { precision: 12, scale: 2 }),
  depositPaymentLink: varchar("depositPaymentLink", { length: 2048 }),
  balancePaymentLink: varchar("balancePaymentLink", { length: 2048 }),
  collectionSentAt: timestamp("collectionSentAt"),
  paymentMethod: varchar("paymentMethod", { length: 20 }),

  // 確認書:引用 PDF(Jeff 上傳/貼)
  confirmationPdfUrl: varchar("confirmationPdfUrl", { length: 1024 }),
  confirmedAt: timestamp("confirmedAt"),

  // 出發 / 認列(留下一段;本批只存)
  recognizedAt: timestamp("recognizedAt"),

  // 橋接 / 雜項。bookingId nullable 備用(決策 C),預設 null,邏輯不耦合。
  bookingId: int("bookingId"),
  notes: text("notes"),

  // order-ai-understanding (0107) — 這個專案專屬的 AI 客人理解(Jeff:「每一個專案
  // 都應該是專門的 太多會太亂」)。一段敘述 + 條列 key facts,繁中,只搬運素材裡的
  // 事實。手動 analyzeOrder(重新分析鈕)才算,算完存這裡當快取 — 絕不自動燒 LLM。
  // NULL = 還沒分析(客戶頁顯示誠實空狀態)。
  aiUnderstanding: text("aiUnderstanding"),
  aiUnderstandingAt: timestamp("aiUnderstandingAt"),

  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  profileIdx: index("idx_co_profile").on(t.customerProfileId, t.createdAt),
  userIdx: index("idx_co_user").on(t.userId),
  statusIdx: index("idx_co_status").on(t.status, t.createdAt),
}));
export type CustomOrder = typeof customOrders.$inferSelect;
export type InsertCustomOrder = typeof customOrders.$inferInsert;

// ── 管理員操作審計日誌（v73）─────────────────────────────────────────────────
// Tracks WHO did WHAT WHEN. Required for compliance + dispute resolution +
// post-incident forensics. Every admin mutation that touches customer data,
// tours, bookings, or settings should write a row here.
export const adminAuditLog = mysqlTable("adminAuditLog", {
  id: int("id").autoincrement().primaryKey(),
  // Actor
  userId: int("userId").notNull(), // who performed the action (admin user)
  userEmail: varchar("userEmail", { length: 320 }).notNull(), // captured at action time so it's stable even if user is renamed
  userRole: varchar("userRole", { length: 32 }).notNull(),

  // Action
  action: varchar("action", { length: 64 }).notNull(), // e.g. "tour.update", "booking.cancel", "user.delete"
  targetType: varchar("targetType", { length: 32 }), // e.g. "tour", "booking", "user", "visa"
  targetId: varchar("targetId", { length: 64 }), // string so it can hold numeric IDs OR string UUIDs

  // Details
  changes: text("changes"), // JSON: { before: {...}, after: {...} } or { fields: [...] }
  reason: text("reason"), // optional human-entered note (refunds, cancellations, etc.)

  // Request context
  ipAddress: varchar("ipAddress", { length: 45 }), // ipv6-safe length
  userAgent: varchar("userAgent", { length: 500 }),

  // Outcome
  success: int("success").default(1).notNull(), // 0=failure (denied / errored), 1=success
  errorMessage: text("errorMessage"),

  // SECURITY_AUDIT_2026_05_14 P2-1: tamper-evident hash chain (migration 0073).
  // previousHash references the immediately-prior row's rowHash (literal
  // "GENESIS" for the first chain entry). rowHash = SHA-256-hex of
  // previousHash || canonicalRow(this row). The verifier walks the table
  // id-ascending and recomputes — any divergence flags row modification
  // or mid-chain deletion. NULL on pre-migration rows; those predate the
  // chain and are trusted by id-monotonicity + createdAt alone.
  previousHash: varchar("previousHash", { length: 64 }),
  rowHash: varchar("rowHash", { length: 64 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLog.$inferInsert;

// v78z-z3 Sprint 11: poster generation logs (Image 2.0 Phase A v0).
// Tracks every gpt-image-2 call so we can show cost-to-date in admin and
// kill the pipeline if monthly spend exceeds budget.
export const posterGenLogs = mysqlTable("posterGenLogs", {
  id: int("id").autoincrement().primaryKey(),
  tourId: int("tourId"),
  prompt: text("prompt").notNull(),
  size: varchar("size", { length: 16 }).notNull(),
  quality: varchar("quality", { length: 16 }).notNull(),
  costUsd: varchar("costUsd", { length: 16 }).notNull(), // store as string to avoid float precision drift
  durationMs: int("durationMs").notNull(),
  storageKey: varchar("storageKey", { length: 512 }),
  status: varchar("status", { length: 32 }).notNull(), // success / refused / errored
  errorMessage: text("errorMessage"),
  generatedBy: int("generatedBy"), // admin user id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PosterGenLog = typeof posterGenLogs.$inferSelect;
export type InsertPosterGenLog = typeof posterGenLogs.$inferInsert;

// v78z-z3 Sprint 11 (Image 2.0 Phase A v1):
// User-uploaded reference assets (logo, photos, past posters) for use as
// inputs to gpt-image-2 generation. Stored in R2 with metadata here.
export const marketingAssets = mysqlTable("marketingAssets", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId"), // admin user who uploaded
  kind: varchar("kind", { length: 32 }).notNull(), // logo / photo / past_poster / scene_ref
  label: varchar("label", { length: 200 }).notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  width: int("width"),
  height: int("height"),
  fileSize: int("fileSize"),
  mimeType: varchar("mimeType", { length: 64 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MarketingAsset = typeof marketingAssets.$inferSelect;
export type InsertMarketingAsset = typeof marketingAssets.$inferInsert;

// One row per generation/edit iteration. Lets admin compare v1 vs v3 of
// the same poster project + revert. Each iteration links back to its
// parent for tree-style history.
export const posterIterations = mysqlTable("posterIterations", {
  id: int("id").autoincrement().primaryKey(),
  projectKey: varchar("projectKey", { length: 64 }).notNull(), // groups iterations together
  parentIterationId: int("parentIterationId"), // null = root, else points back
  ownerId: int("ownerId"),
  prompt: text("prompt").notNull(),
  mode: varchar("mode", { length: 16 }).notNull(), // generate / edit
  size: varchar("size", { length: 16 }).notNull(),
  quality: varchar("quality", { length: 16 }).notNull(),
  costUsd: varchar("costUsd", { length: 16 }).notNull(),
  durationMs: int("durationMs").notNull(),
  storageKey: varchar("storageKey", { length: 512 }),
  status: varchar("status", { length: 32 }).notNull(), // success / errored
  errorMessage: text("errorMessage"),
  referenceAssetIds: text("referenceAssetIds"), // JSON array of marketingAssets.id used
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PosterIteration = typeof posterIterations.$inferSelect;
export type InsertPosterIteration = typeof posterIterations.$inferInsert;

// ─── AI Advisor Usage (Round 80.19) ───────────────────────────────────────
//
// Tracks per-IP and per-userId message counts within a rolling 30-day window
// for AI Travel Advisor rate limiting (free tier = 5 messages / 30 days).
//
// Plus / Concierge members bypass rate limit but we still log usage for
// abuse detection (hard cap 100 / day per account).
//
// Key choice:
//   - Anonymous users → keyed by `ipHash` (sha256 of IP)
//   - Logged-in users → keyed by `userId`
// One row PER message — easy to count via WHERE createdAt > NOW() - 30 days.
// Old rows can be pruned by a daily cron (>30 days old).

export const aiAdvisorUsage = mysqlTable("aiAdvisorUsage", {
  id: int("id").autoincrement().primaryKey(),
  /** sha256(IP) — used for anonymous rate limiting. Null when userId is set. */
  ipHash: varchar("ipHash", { length: 64 }),
  /** Logged-in user id. Null for anonymous. */
  userId: int("userId"),
  /** The session id from the chat dialog (for grouping/debug). */
  sessionId: varchar("sessionId", { length: 64 }),
  /** Snapshot of the message text (first 500 chars) — for abuse review. */
  messagePreview: text("messagePreview"),
  /** Approx tokens billed for this turn (sum of in + out). */
  tokenCount: int("tokenCount").default(0).notNull(),
  /** User's tier at time of message — for analytics. */
  tier: varchar("tier", { length: 20 }).default("free").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiAdvisorUsage = typeof aiAdvisorUsage.$inferSelect;
export type InsertAiAdvisorUsage = typeof aiAdvisorUsage.$inferInsert;

/* ─────────────────────────────────────────────────────────────────────────
 * Round 81 — Autonomous AI Agents foundation
 *
 * Layer 0 (outcome tracking): every action a self-running agent takes is
 * recorded with downstream outcomes. The Self-Retrospective Agent reads
 * these tables weekly and updates each agent's policy autonomously based
 * on conversion + sentiment + LTV correlations.
 *
 * Layer 1 (customer memory): single-source-of-truth profile per customer
 * (multi-channel identity resolution: same person on email + WhatsApp +
 * WeChat = one profile). Powers per-customer voice matching for the
 * Inquiry/Review/Marketing/Followup/Refund agents.
 * ───────────────────────────────────────────────────────────────────── */

export const interactionOutcomes = mysqlTable("interactionOutcomes", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 50 }).notNull(),
  interactionId: int("interactionId").notNull(),
  customerProfileId: int("customerProfileId"),
  actionTaken: varchar("actionTaken", { length: 50 }).notNull(),
  confidence: int("confidence"),
  policyVersion: int("policyVersion"),

  // Short-term outcomes (24-72h)
  customerReplied: int("customerReplied").default(0).notNull(),
  customerReplyTimeMs: int("customerReplyTimeMs"),
  customerSentiment: mysqlEnum("customerSentiment", ["positive", "neutral", "negative"]),

  // Mid-term outcomes (30 days)
  customerBooked: int("customerBooked").default(0).notNull(),
  bookedAmount: int("bookedAmount"),
  customerOptedOut: int("customerOptedOut").default(0).notNull(),
  reviewSubmitted: int("reviewSubmitted").default(0).notNull(),
  reviewRating: int("reviewRating"),

  // Long-term outcomes (90+ days)
  refundRequested: int("refundRequested").default(0).notNull(),
  jeffOverride: int("jeffOverride").default(0).notNull(),
  jeffOverrideReason: text("jeffOverrideReason"),

  outcomeFinalized: int("outcomeFinalized").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  agentIdx: index("idx_outcome_agent").on(table.agentName, table.createdAt),
  customerIdx: index("idx_outcome_customer").on(table.customerProfileId),
  finalizedIdx: index("idx_outcome_finalized").on(table.outcomeFinalized, table.createdAt),
}));

export type InteractionOutcome = typeof interactionOutcomes.$inferSelect;
export type InsertInteractionOutcome = typeof interactionOutcomes.$inferInsert;

export const agentPolicies = mysqlTable("agentPolicies", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 50 }).notNull(),
  version: int("version").notNull(),
  rules: text("rules").notNull(),
  active: int("active").default(0).notNull(),
  performanceData: text("performanceData"),
  createdBy: varchar("createdBy", { length: 50 }),
  reasonNote: text("reasonNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  agentVersionIdx: unique("uq_agent_version").on(table.agentName, table.version),
  agentActiveIdx: index("idx_agent_active").on(table.agentName, table.active),
}));

export type AgentPolicy = typeof agentPolicies.$inferSelect;
export type InsertAgentPolicy = typeof agentPolicies.$inferInsert;

export const agentMetrics = mysqlTable("agentMetrics", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 50 }).notNull(),
  weekStart: timestamp("weekStart").notNull(),
  totalInteractions: int("totalInteractions").default(0).notNull(),
  autoActionsCount: int("autoActionsCount").default(0).notNull(),
  escalatedCount: int("escalatedCount").default(0).notNull(),
  jeffOverrideCount: int("jeffOverrideCount").default(0).notNull(),
  conversionRate: int("conversionRate"),
  avgSentimentScore: int("avgSentimentScore"),
  avgResponseTimeMs: int("avgResponseTimeMs"),
  errorRate: int("errorRate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  agentWeekIdx: unique("uq_agent_week").on(table.agentName, table.weekStart),
}));

export type AgentMetrics = typeof agentMetrics.$inferSelect;
export type InsertAgentMetrics = typeof agentMetrics.$inferInsert;

export const customerProfiles = mysqlTable("customerProfiles", {
  id: int("id").autoincrement().primaryKey(),

  // Multi-channel identifiers
  userId: int("userId"),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  wechatId: varchar("wechatId", { length: 100 }),
  lineId: varchar("lineId", { length: 100 }),
  whatsappPhone: varchar("whatsappPhone", { length: 32 }),

  // Display name (0098). Guests were name-less (derived from email); a manually
  // added customer carries a real name. Nullable — existing guests stay as-is.
  name: varchar("name", { length: 255 }),
  // Origin marker (0098). 'manual' = Jeff added this customer by hand from the
  // customer page; such a profile shows in the list even with no inquiry yet.
  source: varchar("source", { length: 20 }),

  // AI-learned communication preferences
  preferredLanguage: varchar("preferredLanguage", { length: 8 }).default("zh-TW").notNull(),
  communicationStyle: mysqlEnum("communicationStyle", ["formal", "casual", "detailed", "concise"]),
  preferredChannel: varchar("preferredChannel", { length: 20 }),

  // Family / context
  familyContext: text("familyContext"),
  budgetTier: int("budgetTier"),

  // Engagement signals
  totalSpend: int("totalSpend").default(0).notNull(),
  bookingCount: int("bookingCount").default(0).notNull(),
  lastInteractionAt: timestamp("lastInteractionAt"),
  responseTimeExpectationMs: int("responseTimeExpectationMs"),
  vipScore: int("vipScore").default(0).notNull(),

  // AI observations (auto-summarized periodically)
  aiNotes: text("aiNotes"),

  // Round 81 / migration 0075 — structured preference + manual note layer.
  // `preferences` is auto-updated by CustomerProfileExtractor (background
  // service) from every customerInteraction. Shape:
  //   { food: { dietary, dislikes[], favorites[] },
  //     accommodation: { roomType, floor, view },
  //     pace, interests[], avoidances[],
  //     pastDestinations: [{ destination, year, rating }],
  //     wishlist[] }
  // `keyFacts` is short structured facts AI extracts (1-line bullets).
  // `jeffPersonalNote` is Jeff's manual private memo, NEVER shown to customer
  // and NEVER fed back to public-facing agents — only OpsAgent uses it for
  // context when Jeff queries.
  preferences: json("preferences"),
  keyFacts: text("keyFacts"),
  jeffPersonalNote: text("jeffPersonalNote"),
  birthDate: timestamp("birthDate"),
  importantDates: json("importantDates"), // [{type, date, note}] anniversary/etc

  // customer-ai-sessions 批3 m3 — AI 摘要快取(背景算 / 開卡算 + 快取 + 重算鈕)。
  // 只存 business 結論四欄 { wants, actions, delivered, nextStep };絕不存 PDF 原文 /
  // PII(那些只進 prompt,見 customerDocsText)。aiSummaryAt=null → 從沒算過 → 開卡時
  // lazy 算;cron 暖最近有動靜的。
  aiSummary: json("aiSummary"),
  aiSummaryAt: timestamp("aiSummaryAt"),

  status: mysqlEnum("status", ["active", "dormant", "opted_out", "blocked"]).default("active").notNull(),

  // customer-unread (migration 0108) — 來訊未讀紅點的兩根指針。
  // lastInboundAt: 最近一封 inbound customerInteraction 的時間(寫入點經
  //   server/_core/customerUnread.ts touchLastInbound,只往新更新不倒退;
  //   migration 從既有 inbound rows backfill MAX(createdAt))。NULL = 沒來過訊。
  // jeffViewedAt: Jeff 上次打開這位客人的時間(markCustomerSeen 設 NOW)。
  // unread = lastInboundAt 非空 且 (jeffViewedAt 空 或 lastInboundAt > jeffViewedAt)。
  lastInboundAt: timestamp("lastInboundAt"),
  jeffViewedAt: timestamp("jeffViewedAt"),

  // mergedIntoProfileId (migration 0109): 這張卡已整份併入哪張卡(merge_into_customer
  // 設,restoreCustomer 清)。歸檔入口認人後必須經 server/_core/mergedProfile.ts 的
  // followMergePointer 走到最終卡再落資料 — 否則被併走的 email 之後來信會歸到
  // 隱藏卡上,永遠不會出現在客人列表。NULL = 沒被併過。
  mergedIntoProfileId: int("mergedIntoProfileId"),

  // Q4-A — Jeff's manual per-customer follow-up date (migration 0102). A plain
  // calendar DATE (no time / tz): the cockpit surfaces「今天該跟進」when this is
  // set and <= today in America/Los_Angeles. `mode: "string"` round-trips as
  // "YYYY-MM-DD" so the client compares dates without UTC drift. Nullable = none set.
  followUpDate: date("followUpDate", { mode: "string" }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  emailIdx: index("idx_cp_email").on(table.email),
  phoneIdx: index("idx_cp_phone").on(table.phone),
  userIdx: unique("uq_cp_user").on(table.userId),
  vipIdx: index("idx_cp_vip").on(table.vipScore),
  statusIdx: index("idx_cp_status").on(table.status),
}));

export type CustomerProfile = typeof customerProfiles.$inferSelect;
export type InsertCustomerProfile = typeof customerProfiles.$inferInsert;

// Round 81 / migration 0075 — customer documents.
// passport / visa / insurance / medical — PII heavy.
// Sensitive structured fields (passport number, DOB) go in `encryptedFields`
// JSON which is AES-256-GCM encrypted using APP_ENCRYPTION_KEY before insert.
// The R2 file itself is encrypted at rest by Cloudflare.
export const customerDocuments = mysqlTable("customerDocuments", {
  id: int("id").autoincrement().primaryKey(),
  customerProfileId: int("customerProfileId").notNull(),
  type: mysqlEnum("type", ["passport", "visa", "insurance", "medical", "other"]).notNull(),
  fileName: varchar("fileName", { length: 255 }),
  r2Url: varchar("r2Url", { length: 1024 }),
  expiresAt: timestamp("expiresAt"),
  isCurrent: boolean("isCurrent").default(true).notNull(),
  encryptedFields: json("encryptedFields"), // {passportNumber, dob, etc} AES-256-GCM
  uploadedBy: varchar("uploadedBy", { length: 50 }),
  // customer-projects (0106) — which customOrder (專案) this document is filed
  // under. NULL = 「未分類」(customer-level doc: passport, general upload). A file
  // dropped in a project-scoped chat lands on that order; the 文件 tab filters by
  // this when a project chip is active. Soft ref (no FK), mirrors
  // customerInteractions.customOrderId (0104).
  customOrderId: int("customOrderId"),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
}, (table) => ({
  customerTypeIdx: index("idx_customer_type").on(table.customerProfileId, table.type, table.isCurrent),
  expiryIdx: index("idx_expiry").on(table.expiresAt, table.isCurrent),
  orderIdx: index("idx_doc_order").on(table.customOrderId, table.uploadedAt),
}));

export type CustomerDocument = typeof customerDocuments.$inferSelect;
export type InsertCustomerDocument = typeof customerDocuments.$inferInsert;

// Round 81 / migration 0075 — 10-day membership trial tracking (AB 390 compliant).
// Created when user clicks "免費試用 10 天" → Stripe Checkout with trial_period_days=10.
// reminderSentAt: filled when we email "3 days before charge" (AB 390 mandate).
// converted=TRUE means trial completed → first paid period started.
// canceledAt: trial canceled before charge (no money taken).
//
// Prevents abuse: 1 trial per user per tier (uniqueness enforced application-side
// using plusTrialUsedAt / conciergeTrialUsedAt on the users table).
export const membershipTrials = mysqlTable("membershipTrials", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tier: mysqlEnum("tier", ["plus", "concierge"]).notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  endsAt: timestamp("endsAt").notNull(),
  reminderSentAt: timestamp("reminderSentAt"),
  converted: boolean("converted").default(false).notNull(),
  convertedAt: timestamp("convertedAt"),
  canceledAt: timestamp("canceledAt"),
  cancelReason: text("cancelReason"),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  stripePriceId: varchar("stripePriceId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_user").on(table.userId),
  endsPendingIdx: index("idx_ends_pending").on(table.endsAt, table.converted),
}));

export type MembershipTrial = typeof membershipTrials.$inferSelect;
export type InsertMembershipTrial = typeof membershipTrials.$inferInsert;

export const customerInteractions = mysqlTable("customerInteractions", {
  id: int("id").autoincrement().primaryKey(),
  customerProfileId: int("customerProfileId").notNull(),

  channel: mysqlEnum("channel", ["email", "whatsapp", "wechat", "line", "sms", "phone", "web_form", "review"]).notNull(),
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull(),

  content: text("content").notNull(),
  contentSummary: text("contentSummary"),

  generatedBy: mysqlEnum("generatedBy", ["human", "ai_auto", "ai_draft_human_approved"]),
  agentName: varchar("agentName", { length: 50 }),

  sentiment: mysqlEnum("sentiment", ["positive", "neutral", "negative"]),
  classification: varchar("classification", { length: 50 }),
  urgency: int("urgency").default(50).notNull(),

  outcomeId: int("outcomeId"),

  /**
   * Jeff's manual verdict on a "spam"-classified row (migration 0090,
   * design.md §2 rule 4 — spam is never silently dropped):
   *   NULL = 疑似垃圾 awaiting review · rescued = was a real customer
   *   (inquiry created + drafted) · confirmed_spam = muted but kept.
   */
  spamVerdict: mysqlEnum("spamVerdict", ["rescued", "confirmed_spam"]),

  // gmail-full-thread-filing (migration 0101) — idempotent dedup key + thread link.
  // externalId = RFC822 Message-ID (same across mailboxes for one email → cross-account
  // dedup); falls back to the Gmail internal id when the header is missing. gmailThreadId
  // is reserved for the identity layer's same_thread signal. Existing 453 rows are NULL
  // until server/_core/threadFiling.ts claim-or-insert backfills them. NULL is not
  // mutually exclusive under a MySQL unique index, so the legacy rows never collide.
  externalId: varchar("externalId", { length: 255 }),
  gmailThreadId: varchar("gmailThreadId", { length: 255 }),

  // customer-projects (0104) — which customOrder (專案) this real-conversation
  // turn is filed under. NULL = 「未分類」(today's behavior + Gmail filing's
  // default; threadFiling.ts is unchanged so new mail lands here). Jeff assigns
  // a whole gmailThreadId to a project from the 歷史 tab. Soft ref (no FK).
  customOrderId: int("customOrderId"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  customerIdx: index("idx_int_customer").on(table.customerProfileId, table.createdAt),
  channelIdx: index("idx_int_channel").on(table.channel, table.direction),
  classIdx: index("idx_int_class").on(table.classification),
  outcomeIdx: index("idx_int_outcome").on(table.outcomeId),
  orderIdx: index("idx_int_order").on(table.customOrderId, table.createdAt),
  profileExternalUq: unique("uq_ci_profile_external").on(table.customerProfileId, table.externalId),
}));

export type CustomerInteraction = typeof customerInteractions.$inferSelect;
export type InsertCustomerInteraction = typeof customerInteractions.$inferInsert;

// customer-cockpit Phase3 3a (0110) — 承諾追蹤:寄信成功後從內文抽出的具體時間
// 承諾(「週五可取件」「明天發報價」),看門狗(customOrderWatchdog.evaluateCommitment)
// 在過期未兌現時跳黃卡。客人層級,不是訂單層級 — customOrderId 是軟參考可為 NULL。
// fulfilledAt/dismissedAt 只有 opsTools mark_promise 工具、且只在 Jeff 聊天裡明確
// 表達時才會寫入,不存在任何自動化路徑會標記這兩欄。
export const customerPromises = mysqlTable("customerPromises", {
  id: int("id").autoincrement().primaryKey(),
  customerProfileId: int("customerProfileId").notNull(),
  customOrderId: int("customOrderId"),
  // 概念上指向 customerInteractions.id(no FK,同慣例);查重用 —
  // recordPromisesForInteraction 靠這個防止同一封信被重複抽取燒 LLM。
  sourceInteractionId: int("sourceInteractionId").notNull(),
  promiseText: text("promiseText").notNull(),
  rawDateText: varchar("rawDateText", { length: 100 }),
  // string mode ("YYYY-MM-DD") — 跟 customOrders.departureDate 同慣例,純曆日
  // 字串比較,不擔心 tz drift。抽不出來就 NULL,evaluateCommitment 永不叫。
  dueDate: date("dueDate", { mode: "string" }),
  extractedAt: timestamp("extractedAt").defaultNow().notNull(),
  fulfilledAt: timestamp("fulfilledAt"),
  dismissedAt: timestamp("dismissedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  profileDueIdx: index("idx_cp_profile_due").on(table.customerProfileId, table.dueDate),
  sourceInteractionIdx: index("idx_cp_source_interaction").on(table.sourceInteractionId),
}));

export type CustomerPromise = typeof customerPromises.$inferSelect;
export type InsertCustomerPromise = typeof customerPromises.$inferInsert;

// customer-cockpit Phase5(2026-07-03)— 學習閉環。案子完結(completed/
// cancelled)後蒸餾出的「這一類案子」可複用教訓(供應商雷/路線經驗/定價經驗),
// 供新同類案第一回合注入。internal admin-only;lesson 文字紀律:不寫客人全名
// (distillCaseLearning prompt 規則,PII)。sourceOrderId 概念上指向
// customOrders.id(no FK,同慣例),查重用 — 一張單只蒸餾一次。
export const caseLearnings = mysqlTable("caseLearnings", {
  id: int("id").autoincrement().primaryKey(),
  caseType: varchar("caseType", { length: 32 }),
  destination: varchar("destination", { length: 200 }),
  lesson: text("lesson").notNull(),
  // migration 0112 — nullable: distillCaseLearning(案完結蒸餾)填非 NULL,以此「一單一課」
  // 去重;批十一 塊B 收 blocked(無訂單)案時填 NULL。
  sourceOrderId: int("sourceOrderId"),
  // migration 0112 — 批十一 塊B 案件經驗收割的來源資料夾名;folderName 冪等去重(distill 路寫 NULL)。
  sourceFolder: varchar("sourceFolder", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  typeDestCreatedIdx: index("idx_cl_type_dest_created").on(table.caseType, table.destination, table.createdAt),
  sourceOrderIdx: index("idx_cl_source_order").on(table.sourceOrderId),
  sourceFolderIdx: index("idx_cl_source_folder").on(table.sourceFolder, table.createdAt),
}));

export type CaseLearning = typeof caseLearnings.$inferSelect;
export type InsertCaseLearning = typeof caseLearnings.$inferInsert;

// Round 81 — Agent ↔ Jeff chatbox (Layer 1.5)
export const agentMessages = mysqlTable("agentMessages", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 50 }).notNull(),
  senderRole: mysqlEnum("senderRole", ["agent", "jeff"]).default("agent").notNull(),
  messageType: mysqlEnum("messageType", [
    "proposal",
    "observation",
    "question",
    "alert",
    "digest",
    "escalation",
  ]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  context: text("context"),
  priority: mysqlEnum("priority", ["low", "normal", "high", "critical"])
    .default("normal")
    .notNull(),
  relatedOutcomeId: int("relatedOutcomeId"),
  relatedInteractionId: int("relatedInteractionId"),
  relatedCustomerProfileId: int("relatedCustomerProfileId"),
  readByJeff: int("readByJeff").default(0).notNull(),
  jeffResponse: text("jeffResponse"),
  readAt: timestamp("readAt"),
  // QA audit 2026-05-11 Phase 1 fix: track whether Jeff adopted/rejected
  // a proposal so the next Self-Retrospective can reference past decisions
  // and stop re-suggesting things he's already evaluated.
  proposalDecision: mysqlEnum("proposalDecision", ["pending", "adopted", "rejected"])
    .default("pending")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  unreadIdx: index("idx_am_unread").on(table.readByJeff, table.priority, table.createdAt),
  agentIdx: index("idx_am_agent").on(table.agentName, table.createdAt),
  priorityIdx: index("idx_am_priority").on(table.priority, table.createdAt),
  // Reviewer note v2: column order matches the actual query pattern
  // (filter by messageType + date range, then non-equality decision
  // filter handled in residual scan). The earlier (msgType, decision,
  // createdAt) ordering couldn't help inArray() lookups since
  // proposalDecision was used as non-equality.
  proposalIdx: index("idx_am_proposal_decision").on(
    table.messageType,
    table.createdAt,
    table.proposalDecision
  ),
}));

export type AgentMessage = typeof agentMessages.$inferSelect;
export type InsertAgentMessage = typeof agentMessages.$inferInsert;

// Round 81 — Gmail OAuth integration (email pipeline)
export const gmailIntegration = mysqlTable("gmailIntegration", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  emailAddress: varchar("emailAddress", { length: 255 }).notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  scope: text("scope"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  lastPollAt: timestamp("lastPollAt"),
  lastHistoryId: varchar("lastHistoryId", { length: 100 }),
  // gmail-push (2026-06-29) — epoch milliseconds when the current Gmail
  // users.watch expires (Gmail returns ms-since-epoch). NULL = no active
  // watch. The daily renew cron (scheduleGmailWatchRenew) re-arms watches
  // whose expiration is within the renew window. bigint because epoch-ms
  // overflows INT.
  watchExpiration: bigint("watchExpiration", { mode: "number" }),
  // gmail-intake-ledger (2026-07-13) — the last time the History sync engine
  // durably advanced this mailbox's cursor (ledger landed + CAS advance). NULL
  // = never synced via History. Reconciliation (D §4 rule 3) alerts when this
  // is stale; the 404 bounded-fallback recovery window starts from here −24h.
  lastSuccessfulSyncAt: timestamp("lastSuccessfulSyncAt"),
  // gmail-intake-ledger — per-mailbox flag flipping this integration between the
  // legacy poll path and the History ledger path. `legacy` (default) = the
  // existing every-3-min poll, ZERO behavior change. `shadow` = History engine
  // runs + writes the ledger for observability but does NOT feed downstream or
  // apply labels (safety-net compare period). `history` = ledger pending is fed
  // through the existing processOneEmail chain. Switched by DB column only
  // (never env), per-mailbox after v814 (Codex 11 §7). See docs/features/
  // gmail-intake-ledger/design.md §1.
  intakeMode: mysqlEnum("intakeMode", ["legacy", "shadow", "history"]).default("legacy").notNull(),
  messagesProcessed: int("messagesProcessed").default(0).notNull(),
  messagesFailed: int("messagesFailed").default(0).notNull(),
  isActive: int("isActive").default(1).notNull(),
  disconnectReason: text("disconnectReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  emailIdx: unique("uq_gmail_email").on(table.emailAddress),
  activeIdx: index("idx_gmail_active").on(table.isActive, table.lastPollAt),
}));

export type GmailIntegration = typeof gmailIntegration.$inferSelect;
export type InsertGmailIntegration = typeof gmailIntegration.$inferInsert;

// gmail-intake-ledger (2026-07-13) — the SINGLE auditable source of truth for
// customer-mail intake (Codex 11 §五). One row = one Gmail message the History
// engine (or a bounded fallback / backfill) discovered. The message-level
// UNIQUE(integrationId, gmailMessageId) is the idempotency key: a re-diff after
// a crash, a duplicate Pub/Sub push, or a manual label removal all collapse to
// one row (at-least-once discovery + idempotent landing). The cursor only
// advances AFTER every candidate durably lands here (順序鐵律), so nothing can
// be silently skipped. NO subject/body/attachment content is stored — fromAddress
// is the minimum field eligibility needs; everything else is a provenance /
// lifecycle field, never customer PII beyond the sender address already in logs.
export const gmailIngestionLedger = mysqlTable(
  "gmailIngestionLedger",
  {
    id: int("id").autoincrement().primaryKey(),
    integrationId: int("integrationId").notNull(),
    /** Gmail internal message id (per-mailbox). Half of the idempotency key. */
    gmailMessageId: varchar("gmailMessageId", { length: 128 }).notNull(),
    gmailThreadId: varchar("gmailThreadId", { length: 128 }).notNull(),
    /** The mailbox historyId this message was discovered at (audit; NULL for
     *  fallback/backfill rows discovered by query rather than history diff). */
    gmailHistoryId: varchar("gmailHistoryId", { length: 100 }),
    /** Gmail internalDate in EPOCH MILLISECONDS (bigint — never a DATETIME, so a
     *  ms value is never truncated to the second: it is not the dedup key but a
     *  DATETIME round-trip would still lose ordering precision). */
    internalDateMs: bigint("internalDateMs", { mode: "number" }).notNull(),
    /** Sender address (bare, lowercased). NULLABLE (v2, Codex 12 輪 P0-1): the row
     *  lands minimal at DISCOVERY (fromAddress unknown until the classification
     *  stage hydrates the From header downstream), so eligibility no longer gates
     *  landing — nothing can be dropped before it is recorded. */
    fromAddress: varchar("fromAddress", { length: 320 }),
    source: mysqlEnum("source", ["history", "push_wake", "fallback_scan", "backfill"]).notNull(),
    status: mysqlEnum("status", ["pending", "processed", "ignored", "failed"])
      .default("pending")
      .notNull(),
    /** v2 (Codex 12 輪 P0-1) — the downstream classification decision. NULL until
     *  the classification stage runs (route is set AFTER the row lands). The
     *  receipt classifier runs BEFORE the noise/self terminal, so a noreply
     *  merchant receipt routes to 'receipt', never silently dropped as noise. */
    route: mysqlEnum("route", ["customer", "receipt", "noise", "self_or_outbound", "manual_review"]),
    /** v2 shadow-mode parity: the route the History path WOULD have executed, for
     *  comparison against the legacy writer. NULL in history mode (route is
     *  authoritative + executed) and until classified. */
    wouldRoute: mysqlEnum("wouldRoute", ["customer", "receipt", "noise", "self_or_outbound", "manual_review"]),
    /** v2 — when the classification stage decided `route` (NULL while pending). */
    classifiedAt: timestamp("classifiedAt"),
    /** F skeleton — llm/db/gmail_api/attachment/auth/noise/unknown. NULL until a
     *  failure (or an ignored-as-noise) classifies it. */
    failureKind: varchar("failureKind", { length: 64 }),
    /** Truncated error string for debugging — NEVER message body / attachment
     *  content (design §1, attack surface 10). */
    errorDetail: varchar("errorDetail", { length: 512 }),
    httpStatus: int("httpStatus"),
    retryCount: int("retryCount").default(0).notNull(),
    nextRetryAt: timestamp("nextRetryAt"),
    firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
    lastAttemptAt: timestamp("lastAttemptAt"),
    processedAt: timestamp("processedAt"),
    /** customerInteractions.id once the message lands as an interaction (history
     *  mode). Soft ref, no FK — matches the repo's provenance convention. */
    interactionId: int("interactionId"),
    /** v3 (2026-07-13, Codex 15 輪 P0-2 狀態感知重排) — the MOST RECENT inbox-arrival
     *  historyId that (re)surfaced this message. gmailHistoryId stays the FIRST
     *  discovery id (immutable audit); this tracks the latest labelAdded/messageAdded
     *  re-entry so a moved-back-into-inbox message records its newest INBOX event. */
    lastSeenHistoryId: varchar("lastSeenHistoryId", { length: 100 }),
    /** v3 — coarse lifecycle marker: 'initial' at first discovery, 'inbox_requeue'
     *  when a terminal-ignored row is flipped back to pending by a newer INBOX event. */
    discoveryReason: varchar("discoveryReason", { length: 64 }),
    /** v3 — how many times a terminal-ignored row was requeued to pending by a newer
     *  INBOX event. Pure audit: it NEVER overwrites the original classification history
     *  (route/wouldRoute are reset for re-classification but this counts the resets). */
    requeueCount: int("requeueCount").default(0).notNull(),
    /** v3 — when the row was last requeued (NULL until the first ignored→pending flip). */
    lastRequeuedAt: timestamp("lastRequeuedAt"),
    /** v4 (2026-07-13, Codex 16 輪 P0-2 事件級重排冪等) — the MONOTONIC requeue
     *  watermark: the history record id of the last label_added_inbox EVENT that
     *  actually triggered a requeue. The requeue gate fires ONLY for an event id
     *  STRICTLY GREATER than this (BigInt-precise), so replaying the SAME (or an
     *  older) label event — even after the row cycles back to ignored — is a no-op
     *  (requeueCount cannot double-count). Distinct from lastSeenHistoryId (which
     *  statement 1 advances on EVERY sighting): this column is touched ONLY on a
     *  real requeue, so statement 2 can compare against a value statement 1 never
     *  overwrote (no read-after-write hazard between the two upsert statements). */
    lastRequeueEventId: varchar("lastRequeueEventId", { length: 100 }),
    // ── v4 row-claim lease (Codex 16 輪 P0-3) — the LAST gate for downstream side
    //    effects. classify + feed each atomically CAS-claim a candidate row
    //    (claimToken + claimExpiresAt + claimStage) before acting; only the
    //    affectedRows=1 winner processes it, and every terminal write is gated by
    //    the same token so a stale/expired lease can never overwrite a peer's row. ──
    /** v4 — the random token of the runner currently leasing this row (NULL = free).
     *  A terminal/retry write must carry the matching token or it is rejected. */
    claimToken: varchar("claimToken", { length: 64 }),
    /** v4 — lease expiry. A row is re-claimable when claimToken IS NULL OR
     *  claimExpiresAt <= now (crash → the lease simply lapses, then a peer re-takes). */
    claimExpiresAt: timestamp("claimExpiresAt"),
    /** v4 — which stage holds the lease ('classify' | 'feed'), audit + defensive. */
    claimStage: varchar("claimStage", { length: 16 }),
  },
  (table) => ({
    // message-level idempotency key (same thread → each new message is its own
    // business event, so the key is per-message not per-thread).
    msgUq: unique("uq_ledger_integration_msg").on(table.integrationId, table.gmailMessageId),
    // reconciliation + retry sweeps scan by (integration, status).
    statusIdx: index("idx_ledger_status").on(table.integrationId, table.status, table.nextRetryAt),
    threadIdx: index("idx_ledger_thread").on(table.integrationId, table.gmailThreadId),
    // v4 — the per-round claim scan filters by (integration, status, lease expiry).
    claimIdx: index("idx_ledger_claim").on(table.integrationId, table.status, table.claimExpiresAt),
  }),
);

export type GmailIngestionLedger = typeof gmailIngestionLedger.$inferSelect;
export type InsertGmailIngestionLedger = typeof gmailIngestionLedger.$inferInsert;

// ──────────────────────────────────────────────────────────────────────────
// Plaid bookkeeping integration (migration 0070).
//
// linkedBankAccounts: one row per Plaid Item × account (a Plaid Item is one
// bank login, can expose multiple accounts e.g. Chase checking + savings +
// credit card). plaidAccessTokenEncrypted is AES-GCM encrypted at the app
// layer using PLAID_ENCRYPTION_KEY env var before insert.
//
// bankTransactions: synced via Plaid /transactions/sync using the per-account
// cursor stored on linkedBankAccounts. AccountingAgent reads new rows,
// classifies into agentCategory, sets agentConfidence. Jeff can override.
// ──────────────────────────────────────────────────────────────────────────

export const linkedBankAccounts = mysqlTable("linkedBankAccounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  plaidItemId: varchar("plaidItemId", { length: 64 }).notNull(),
  plaidAccountId: varchar("plaidAccountId", { length: 128 }).notNull(),
  plaidAccessTokenEncrypted: text("plaidAccessTokenEncrypted").notNull(),
  plaidInstitutionId: varchar("plaidInstitutionId", { length: 64 }),
  institutionName: varchar("institutionName", { length: 128 }).notNull(),
  // Plaid embeds base64-encoded PNGs (~5-15KB). Stored as `data:image/png;base64,…`
  // data URIs. VARCHAR(512) silently truncated/rejected — see migration 0071.
  institutionLogoUrl: mediumtext("institutionLogoUrl"),
  accountMask: varchar("accountMask", { length: 8 }),
  accountName: varchar("accountName", { length: 128 }).notNull(),
  accountOfficialName: varchar("accountOfficialName", { length: 256 }),
  accountType: mysqlEnum("accountType", [
    "depository",
    "credit",
    "loan",
    "investment",
    "other",
  ]).notNull(),
  accountSubtype: varchar("accountSubtype", { length: 32 }),
  isTrustAccount: int("isTrustAccount").default(0).notNull(),
  isActive: int("isActive").default(1).notNull(),
  currentBalance: decimal("currentBalance", { precision: 14, scale: 2 }),
  availableBalance: decimal("availableBalance", { precision: 14, scale: 2 }),
  isoCurrencyCode: varchar("isoCurrencyCode", { length: 3 }).default("USD").notNull(),
  cursor: varchar("cursor", { length: 512 }),
  lastSyncedAt: timestamp("lastSyncedAt"),
  lastSyncError: text("lastSyncError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  plaidAccountIdx: unique("uniq_plaid_account").on(table.plaidAccountId),
  userActiveIdx: index("idx_user_active").on(table.userId, table.isActive),
}));

export type LinkedBankAccount = typeof linkedBankAccounts.$inferSelect;
export type InsertLinkedBankAccount = typeof linkedBankAccounts.$inferInsert;

export const bankTransactions = mysqlTable("bankTransactions", {
  id: int("id").autoincrement().primaryKey(),
  linkedAccountId: int("linkedAccountId").notNull(),
  plaidTransactionId: varchar("plaidTransactionId", { length: 128 }).notNull(),
  // Plaid uses ISO date. Amount sign: positive = outflow (expense),
  // negative = inflow (income/refund). We preserve Plaid's sign.
  date: date("date").notNull(),
  authorizedDate: date("authorizedDate"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  isoCurrencyCode: varchar("isoCurrencyCode", { length: 3 }).default("USD").notNull(),
  merchantName: varchar("merchantName", { length: 256 }),
  description: text("description"),
  // Plaid's `original_description` — raw bank-line text including check memo,
  // wire reference, Zelle / Bill Pay note that Jeff typed in BofA. Migration
  // 0081 (2026-05-22) — Jeff: "Agent 要 read 我在 bofa 用的 notes".
  originalDescription: text("originalDescription"),
  // Plaid's `payment_meta` — JSON: { payee, payer, payment_method, reason,
  // reference_number, by_order_of, ppd_id }. `reason` is where the BofA
  // Zelle memo lands ("PACKAGE TRIP DEPOSIT", etc.).
  paymentMeta: json("paymentMeta"),
  paymentChannel: varchar("paymentChannel", { length: 32 }),
  // Plaid's PFC taxonomy (Personal Finance Category) — primary + detailed
  plaidCategoryPrimary: varchar("plaidCategoryPrimary", { length: 64 }),
  plaidCategoryDetailed: varchar("plaidCategoryDetailed", { length: 128 }),
  // AccountingAgent output
  agentCategory: varchar("agentCategory", { length: 64 }),
  agentConfidence: int("agentConfidence"),
  agentReasoning: text("agentReasoning"),
  // Jeff override (when he disagrees with the agent)
  jeffOverrideCategory: varchar("jeffOverrideCategory", { length: 64 }),
  jeffOverrideReason: text("jeffOverrideReason"),
  // IRS Schedule C / §274 documentation — migration 0080 (2026-05-22).
  // counterparty: normalized vendor/payer (AI-extracted, Jeff-editable).
  // counterpartyType: vendor|customer|owner|employee|refund|transfer|tax|other
  //   — enum-like, kept as varchar for portability.
  // purposeNote: business-purpose 1-liner ("why did money move?")
  // receiptUrl: optional R2 link to receipt PDF (≥$75 expenses need it for IRS).
  counterparty: varchar("counterparty", { length: 255 }),
  counterpartyType: varchar("counterpartyType", { length: 32 }),
  purposeNote: text("purposeNote"),
  receiptUrl: varchar("receiptUrl", { length: 500 }),
  // Manually exclude personal items from accounting reports
  excludeFromAccounting: int("excludeFromAccounting").default(0).notNull(),
  excludeReason: varchar("excludeReason", { length: 256 }),
  isPending: int("isPending").default(0).notNull(),
  accountOwner: varchar("accountOwner", { length: 128 }),
  // Scaling guardrail (migration 0082, 2026-05-23). When 1, txn is hidden
  // from default ledger queries. Flipped by archiveOldTransactions cron
  // for rows > 2 years old. Year-end export bypasses the filter.
  archived: int("archived").default(0).notNull(),
  // Optional foreign keys to PACK&GO entities — lets the agent link e.g.
  // a Stripe payout to the originating booking.
  relatedBookingId: int("relatedBookingId"),
  relatedInquiryId: int("relatedInquiryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  plaidTxnIdx: unique("uniq_plaid_txn").on(table.plaidTransactionId),
  accountDateIdx: index("idx_account_date").on(table.linkedAccountId, table.date),
  agentCategoryIdx: index("idx_agent_category").on(table.agentCategory, table.date),
  pendingIdx: index("idx_pending").on(table.isPending, table.date),
  counterpartyIdx: index("idx_bank_txn_counterparty").on(table.counterparty),
  counterpartyTypeIdx: index("idx_bank_txn_counterparty_type").on(table.counterpartyType),
  archivedIdx: index("idx_bank_txn_archived").on(table.archived, table.date),
}));

export type BankTransaction = typeof bankTransactions.$inferSelect;
export type InsertBankTransaction = typeof bankTransactions.$inferInsert;

export const plaidWebhookEvents = mysqlTable("plaidWebhookEvents", {
  id: int("id").autoincrement().primaryKey(),
  webhookType: varchar("webhookType", { length: 64 }).notNull(),
  webhookCode: varchar("webhookCode", { length: 64 }).notNull(),
  plaidItemId: varchar("plaidItemId", { length: 64 }),
  payload: text("payload"),
  processedAt: timestamp("processedAt"),
  processedSuccess: int("processedSuccess").default(0).notNull(),
  processedError: text("processedError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  itemCreatedIdx: index("idx_item_created").on(table.plaidItemId, table.createdAt),
  unprocessedIdx: index("idx_unprocessed").on(table.processedSuccess, table.createdAt),
}));

export type PlaidWebhookEvent = typeof plaidWebhookEvents.$inferSelect;
export type InsertPlaidWebhookEvent = typeof plaidWebhookEvents.$inferInsert;

/**
 * Phase 4 — CST §17550 trust account income deferral.
 *
 * One row per bank-transaction-into-trust-account. Tracks: when the money
 * came in, which booking it pays for, when we expect to recognize it as
 * income (= booking.departureDate), and whether/when it was actually
 * recognized.
 *
 * Feature-flagged off via PLAID_TRUST_DEFERRAL_ENABLED env. When off, the
 * AccountingAgent treats trust-account inflows like any other income and
 * this table is unused. When on, income_booking transactions on
 * isTrustAccount=1 accounts get a deferred-income row instead of hitting
 * P&L immediately.
 */
export const trustDeferredIncome = mysqlTable(
  "trustDeferredIncome",
  {
    id: int("id").autoincrement().primaryKey(),
    bankTransactionId: int("bankTransactionId").notNull(),
    linkedAccountId: int("linkedAccountId").notNull(),
    bookingId: int("bookingId"),
    matchConfidence: int("matchConfidence").default(0).notNull(),
    matchMethod: mysqlEnum("matchMethod", ["auto", "manual", "unmatched"])
      .default("unmatched")
      .notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    isoCurrencyCode: varchar("isoCurrencyCode", { length: 3 })
      .default("USD")
      .notNull(),
    depositDate: date("depositDate").notNull(),
    expectedRecognitionDate: date("expectedRecognitionDate"),
    recognizedAt: timestamp("recognizedAt"),
    recognitionRunId: varchar("recognitionRunId", { length: 64 }),
    reversedAt: timestamp("reversedAt"),
    reversedReason: varchar("reversedReason", { length: 256 }),
    // F2 塊B (2026-07-10, migration 0114) — 認列生命週期閉環:認列後 Jeff 把錢
    // 從 Trust 轉到 Operating,轉帳偵測(trustTransferDetection.ts)在
    // bankTransactions 找到「Trust 流出 + Operating 流入」同額配對後回填。
    // transferredAt 非空 = §17550 閉環完成(收訂 → 出發認列 → 轉出)。
    // transferBankTransactionId = Trust 側流出那筆 bankTransactions.id
    // (概念 FK,無實體約束,同 bankTransactionLinks 慣例)。
    transferredAt: timestamp("transferredAt"),
    transferBankTransactionId: int("transferBankTransactionId"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    bankTxnIdx: unique("uniq_bank_txn").on(table.bankTransactionId),
    recognitionReadyIdx: index("idx_recognition_ready").on(
      table.recognizedAt,
      table.expectedRecognitionDate,
      table.reversedAt
    ),
    bookingPendingIdx: index("idx_booking_pending").on(
      table.bookingId,
      table.recognizedAt
    ),
    accountStatusIdx: index("idx_account_status").on(
      table.linkedAccountId,
      table.recognizedAt,
      table.reversedAt
    ),
  })
);

export type TrustDeferredIncome = typeof trustDeferredIncome.$inferSelect;
export type InsertTrustDeferredIncome =
  typeof trustDeferredIncome.$inferInsert;

/**
 * F1 對帳引擎 塊A (2026-07-08, migration 0113) — bankTransactionLinks.
 *
 * Multi-to-multi link between a bankTransactions row and its "claimed"
 * destination: a real source document (custom_order / invoice / booking)
 * or an internal category bucket (targetType='category', categoryCode
 * like 'stripe_payout' / 'owner_transfer' / 'interest' / 'small_inflow').
 * One inflow can be split across multiple links (deposit + balance landing
 * in the same wire) — bankTransactionId is deliberately NOT unique.
 *
 * Invariant enforced in code (server/services/bankTransactionLinkEngine.ts),
 * not at the DB layer: SUM(amountAllocated) for a given bankTransactionId
 * must never exceed |bankTransactions.amount|.
 */
export const bankTransactionLinks = mysqlTable(
  "bankTransactionLinks",
  {
    id: int("id").autoincrement().primaryKey(),
    bankTransactionId: int("bankTransactionId").notNull(),
    targetType: mysqlEnum("targetType", [
      "custom_order",
      "invoice",
      "booking",
      "category",
    ]).notNull(),
    targetId: int("targetId"),
    categoryCode: varchar("categoryCode", { length: 64 }),
    amountAllocated: decimal("amountAllocated", { precision: 14, scale: 2 }).notNull(),
    // 'auto:<rule-name>' (e.g. 'auto:exact_amount') or 'manual'.
    matchMethod: varchar("matchMethod", { length: 64 }).notNull(),
    matchConfidence: int("matchConfidence"),
    // 'jeff' (manual claim) or 'system' (auto-linked by a rule).
    claimedBy: varchar("claimedBy", { length: 32 }).notNull(),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    bankTxnIdx: index("idx_btl_bank_txn").on(table.bankTransactionId),
    targetIdx: index("idx_btl_target").on(table.targetType, table.targetId),
  })
);

export type BankTransactionLink = typeof bankTransactionLinks.$inferSelect;
export type InsertBankTransactionLink = typeof bankTransactionLinks.$inferInsert;

/**
 * ─────────────────────────────────────────────────────────────────────
 *  Supplier Product Sync (PACK&GO 供應商產品自動同步)
 * ─────────────────────────────────────────────────────────────────────
 *
 *  See `docs/SUPPLIER_SYNC_DESIGN.md` (forthcoming) and Jeff's research
 *  PDF dated 2026-05-15. Two suppliers wired in Phase 1:
 *    • lion  — 雄獅旅遊 (Lion Travel), TWD, 4,430+ products
 *    • uv    — UV Bookings / ToursBMS, USD, 1,124 products
 *
 *  Architecture: the SUPPLIER OWNS the source of truth for product
 *  content, price, and inventory. PACK&GO mirrors a normalized snapshot
 *  into these tables once per day (full sync) and re-fetches "hot"
 *  products hourly. Customer browses /catalog, clicks "詢問" → inquiry
 *  flow (Phase 1) or "立即下單" → Playwright auto-books in BMS (Phase 3).
 *
 *  Pricing per Jeff's call: display 直客價 (retail). PACK&GO's margin
 *  comes from supplier commission (同業價 < 直客價 spread), not from
 *  per-row markup. agentPrice column kept for internal reporting only.
 *
 *  Availability per Jeff's call: 3-tier (available / limited / full),
 *  computed from spareSeats. Raw seat count NEVER shown to customers
 *  to reduce stockout disputes.
 */

/**
 * Registry of supply sources. New supplier integrations get one row each.
 * `credentialsEncrypted` holds BMS login / API keys for Phase 3 (Playwright
 * auto-book). Encrypted via server/_core/tokenCrypto.ts AES-256-GCM.
 */
export const suppliers = mysqlTable("suppliers", {
  id: int("id").autoincrement().primaryKey(),
  /** Short stable code: "lion" / "uv". Used everywhere as the FK key. */
  code: varchar("code", { length: 32 }).notNull().unique(),
  displayName: varchar("displayName", { length: 128 }).notNull(),
  /** Base URL of the supplier's public catalog API. Phase 1 only reads from this. */
  baseUrl: varchar("baseUrl", { length: 512 }).notNull(),
  /** ISO 4217. Used for FX display; Stripe converts at checkout. */
  defaultCurrency: varchar("defaultCurrency", { length: 3 }).notNull(),
  /** BMS login / API token, AES-256-GCM enc (Phase 3). */
  credentialsEncrypted: text("credentialsEncrypted"),
  isActive: boolean("isActive").default(true).notNull(),
  /** Last successful full-sync end timestamp; null until first run. */
  lastFullSyncAt: timestamp("lastFullSyncAt"),
  /** Last successful hot-product sync end timestamp; null until first run. */
  lastHotSyncAt: timestamp("lastHotSyncAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

/**
 * One row per supplier product (Lion's GroupCode, UV's productId).
 * `rawProductJson` stores the full supplier response so renderers can read
 * fields we haven't normalized yet (saves a migration every time we want
 * to surface another field).
 *
 * `isHiddenByAdmin` is Jeff's manual override — lets him hide an
 * inappropriate / sold-out / brand-mismatched product without waiting
 * for the supplier to remove it.
 */
export const supplierProducts = mysqlTable(
  "supplierProducts",
  {
    id: int("id").autoincrement().primaryKey(),
    supplierId: int("supplierId").notNull(),
    /** Lion: GroupCode (e.g. "GG250715D"); UV: productId. */
    externalProductCode: varchar("externalProductCode", { length: 128 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    days: int("days").notNull().default(0),
    departureCity: varchar("departureCity", { length: 128 }),
    destinationCountry: varchar("destinationCountry", { length: 128 }),
    destinationCity: varchar("destinationCity", { length: 128 }),
    /** Direct URL to supplier-hosted cover image. */
    imageUrl: varchar("imageUrl", { length: 1024 }),
    /** Inherited from supplier; can differ per-product if supplier sells multi-currency. */
    currency: varchar("currency", { length: 3 }).notNull(),
    /**
     * Catalog status. 'active' shows in /catalog; 'inactive' hides
     * (e.g. supplier removed it); 'pending' = found but missing required fields.
     */
    status: mysqlEnum("status", ["active", "inactive", "pending"]).default("active").notNull(),
    /** Jeff's manual hide toggle in admin panel. ANDed with status. */
    isHiddenByAdmin: boolean("isHiddenByAdmin").default(false).notNull(),
    /** Full raw response from supplier — mediumtext can hold ~16MB which is plenty. */
    rawProductJson: mediumtext("rawProductJson"),
    lastSyncedAt: timestamp("lastSyncedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    supplierExternalIdx: unique("uniq_supplier_external").on(
      table.supplierId,
      table.externalProductCode
    ),
    statusIdx: index("idx_supplier_status").on(table.supplierId, table.status, table.isHiddenByAdmin),
    destinationIdx: index("idx_destination").on(table.destinationCountry),
  })
);

export type SupplierProduct = typeof supplierProducts.$inferSelect;
export type InsertSupplierProduct = typeof supplierProducts.$inferInsert;

/**
 * One row per departure date per product. This is the "team-period"
 * (團期 / 出發日) row.
 *
 * `availability` is the 3-tier display bucket per Jeff's call:
 *   - 'available'  : spareSeats > 5 (or > 30% of totalSeats)
 *   - 'limited'    : 1 ≤ spareSeats ≤ 5
 *   - 'full'       : spareSeats = 0 OR status="額滿"
 *   - 'unavailable': supplier returns status="停售" / closed for sale
 * The raw spareSeats is stored but NEVER rendered in the customer UI.
 */
export const supplierDepartures = mysqlTable(
  "supplierDepartures",
  {
    id: int("id").autoincrement().primaryKey(),
    supplierProductId: int("supplierProductId").notNull(),
    supplierId: int("supplierId").notNull(),
    /** Lion: TeamGroupCode (e.g. "GG2507150A"); UV: departureId. */
    externalDepartureCode: varchar("externalDepartureCode", { length: 128 }).notNull(),
    departureDate: date("departureDate").notNull(),
    /** 直客價 / retail price — what we show customers. */
    retailPrice: decimal("retailPrice", { precision: 14, scale: 2 }).notNull(),
    /** 同業價 / agent (cost) price — internal margin reporting only. */
    agentPrice: decimal("agentPrice", { precision: 14, scale: 2 }),
    currency: varchar("currency", { length: 3 }).notNull(),
    totalSeats: int("totalSeats").default(0).notNull(),
    /** Raw seat count from supplier. NEVER show in customer UI. */
    spareSeats: int("spareSeats").default(0).notNull(),
    availability: mysqlEnum("availability", [
      "available",
      "limited",
      "full",
      "unavailable",
    ])
      .default("available")
      .notNull(),
    rawDepartureJson: mediumtext("rawDepartureJson"),
    lastSyncedAt: timestamp("lastSyncedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    productExternalIdx: unique("uniq_product_external_dep").on(
      table.supplierProductId,
      table.externalDepartureCode
    ),
    productDateIdx: index("idx_product_date").on(
      table.supplierProductId,
      table.departureDate
    ),
    availabilityIdx: index("idx_availability").on(
      table.availability,
      table.departureDate
    ),
  })
);

export type SupplierDeparture = typeof supplierDepartures.$inferSelect;
export type InsertSupplierDeparture = typeof supplierDepartures.$inferInsert;

/**
 * Deep detail mirror for each supplier product. 2026-05-24 (migration 0083)
 * Stage 1 of supplier deep sync — Jeff: "擴充我的商品 + 成立我自己的 API".
 *
 * One row per supplierProductId (1:1). Five detail kinds — each with
 * raw + parsed + fetchedAt + parseStatus. Raw is the supplier's response
 * verbatim; parsed is our normalized JSON (NormalizedItinerary,
 * NormalizedPriceTerms, etc — see server/services/supplierSync/types.ts).
 *
 * `parseStatus`:
 *   - 'parsed'       : raw + parsed both present, reader can trust parsed
 *   - 'parse_failed' : raw present but parser couldn't extract structure
 *                       (format change at supplier — re-fetch + log)
 *   - 'missing'      : never fetched (or never returned by supplier)
 *   - 'stale'        : fetched > 30 days ago, refresh scheduled
 *
 * `schemaVersion` + `ownerType` are forward-compat for Stage 3 public
 * REST API: consumers know parsed-shape version; tracking lets future
 * PACK&GO-owned + partner products use the same table without churn.
 *
 * Populated by server/supplierDetailEnrichmentWorker.ts. Read by
 * client/src/pages/TourDetailPeony.tsx (via tours.getSupplierDetail)
 * and InquiryAgent system prompt.
 */
export const supplierProductDetails = mysqlTable(
  "supplierProductDetails",
  {
    id: int("id").autoincrement().primaryKey(),
    supplierProductId: int("supplierProductId").notNull(),
    supplierId: int("supplierId").notNull(),

    // Itinerary (per-day plan + hotels + meals)
    itineraryRaw: mediumtext("itineraryRaw"),
    itineraryParsed: mediumtext("itineraryParsed"),
    itineraryFetchedAt: timestamp("itineraryFetchedAt"),
    itineraryParseStatus: mysqlEnum("itineraryParseStatus", [
      "parsed",
      "parse_failed",
      "missing",
      "stale",
    ])
      .default("missing")
      .notNull(),

    // Price terms (included / excluded / payment / cancellation)
    priceTermsRaw: mediumtext("priceTermsRaw"),
    priceTermsParsed: mediumtext("priceTermsParsed"),
    priceTermsFetchedAt: timestamp("priceTermsFetchedAt"),
    priceTermsParseStatus: mysqlEnum("priceTermsParseStatus", [
      "parsed",
      "parse_failed",
      "missing",
      "stale",
    ])
      .default("missing")
      .notNull(),

    // Notices (visa / insurance / baggage / general)
    noticesRaw: mediumtext("noticesRaw"),
    noticesParsed: mediumtext("noticesParsed"),
    noticesFetchedAt: timestamp("noticesFetchedAt"),
    noticesParseStatus: mysqlEnum("noticesParseStatus", [
      "parsed",
      "parse_failed",
      "missing",
      "stale",
    ])
      .default("missing")
      .notNull(),

    // Optional add-ons
    optionalRaw: mediumtext("optionalRaw"),
    optionalParsed: mediumtext("optionalParsed"),
    optionalFetchedAt: timestamp("optionalFetchedAt"),
    optionalParseStatus: mysqlEnum("optionalParseStatus", [
      "parsed",
      "parse_failed",
      "missing",
      "stale",
    ])
      .default("missing")
      .notNull(),

    // Tour info (Lion only — UV has no equivalent)
    tourInfoRaw: mediumtext("tourInfoRaw"),
    tourInfoParsed: mediumtext("tourInfoParsed"),
    tourInfoFetchedAt: timestamp("tourInfoFetchedAt"),
    tourInfoParseStatus: mysqlEnum("tourInfoParseStatus", [
      "parsed",
      "parse_failed",
      "missing",
      "stale",
    ])
      .default("missing")
      .notNull(),

    // API-ready forward-compat
    schemaVersion: int("schemaVersion").default(1).notNull(),
    ownerType: mysqlEnum("ownerType", ["supplier", "packgo", "partner"])
      .default("supplier")
      .notNull(),

    // Run tracking
    lastEnrichedAt: timestamp("lastEnrichedAt"),
    enrichmentRunCount: int("enrichmentRunCount").default(0).notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    productIdx: unique("uniq_product_detail").on(table.supplierProductId),
    supplierEnrichedIdx: index("idx_supplier_enriched").on(
      table.supplierId,
      table.lastEnrichedAt
    ),
    itineraryStatusIdx: index("idx_itinerary_status").on(
      table.supplierId,
      table.itineraryParseStatus
    ),
  })
);

export type SupplierProductDetail = typeof supplierProductDetails.$inferSelect;
export type InsertSupplierProductDetail = typeof supplierProductDetails.$inferInsert;

/**
 * Audit log for every sync execution. One row per BullMQ job run.
 * Lets the admin panel show a history of syncs + flag streaks of
 * failures (e.g. when supplier changes their API format).
 *
 * `kind`:
 *   - 'full'   : daily 03:00 UTC pull of all products
 *   - 'hot'    : hourly re-pull of products with status='active' and
 *                a departure in the next 14 days
 *   - 'manual' : admin-triggered "Sync now" from the panel
 *   - 'detail' : on-demand single-product detail fetch
 */
export const supplierSyncRuns = mysqlTable(
  "supplierSyncRuns",
  {
    id: int("id").autoincrement().primaryKey(),
    supplierId: int("supplierId").notNull(),
    kind: mysqlEnum("kind", ["full", "hot", "manual", "detail"]).notNull(),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    finishedAt: timestamp("finishedAt"),
    productsScanned: int("productsScanned").default(0).notNull(),
    productsAdded: int("productsAdded").default(0).notNull(),
    productsUpdated: int("productsUpdated").default(0).notNull(),
    productsDeactivated: int("productsDeactivated").default(0).notNull(),
    departuresScanned: int("departuresScanned").default(0).notNull(),
    departuresUpdated: int("departuresUpdated").default(0).notNull(),
    status: mysqlEnum("status", ["running", "success", "failed", "partial"])
      .default("running")
      .notNull(),
    durationMs: int("durationMs"),
    errorMessage: text("errorMessage"),
    /** Bull job id so admin panel can deep-link to a specific run. */
    bullJobId: varchar("bullJobId", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    supplierStartIdx: index("idx_supplier_started").on(
      table.supplierId,
      table.startedAt
    ),
    statusIdx: index("idx_run_status").on(table.status, table.startedAt),
  })
);

export type SupplierSyncRun = typeof supplierSyncRuns.$inferSelect;
export type InsertSupplierSyncRun = typeof supplierSyncRuns.$inferInsert;

// ─── tour-catalog-rebuild (chunk 1) — 重抓換批 + 快照回滾 ──────────────────
// 換批機制 = 就地更新 tours(id/URL/FK/SEO 穩)+ 快照回滾(可退、不空窗)。
//   - catalogBatches:一級批次物件。一次重抓開一筆,記 scope / 狀態 / 完整度統計。
//   - toursCatalogArchive:promote 前把舊 tour 列整列存成 JSON 快照,回滾的來源。
//   - tours.batchId / tours.lastBatchAt:標記每個團屬於哪一批、何時換上(就地)。
// 見 docs/features/tour-catalog-rebuild/tasks/chunk-1-rescrape-pipeline.md §3(C+C1)。
export const catalogBatches = mysqlTable(
  "catalogBatches",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 這批抓哪家。 */
    scope: mysqlEnum("scope", ["lion", "uv", "both"]).notNull(),
    /** staging=建好待驗;live=當前上架批;archived=被換掉的舊批(可回滾);failed=promote 失敗。 */
    status: mysqlEnum("status", ["staging", "live", "archived", "failed"])
      .default("staging")
      .notNull(),
    toursTotal: int("toursTotal").default(0).notNull(),
    toursComplete: int("toursComplete").default(0).notNull(),
    toursIncomplete: int("toursIncomplete").default(0).notNull(),
    toursPromoted: int("toursPromoted").default(0).notNull(),
    /** promote 時這批換掉的上一個 live 批 — 回滾要把它翻回 live。 */
    replacedBatchId: int("replacedBatchId"),
    /** 自由文字:完整度缺項彙整 / 回報。 */
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    promotedAt: timestamp("promotedAt"),
    archivedAt: timestamp("archivedAt"),
  },
  (table) => ({
    statusIdx: index("idx_catalogBatch_status").on(
      table.status,
      table.createdAt
    ),
  })
);

export type CatalogBatch = typeof catalogBatches.$inferSelect;
export type InsertCatalogBatch = typeof catalogBatches.$inferInsert;

export const toursCatalogArchive = mysqlTable(
  "toursCatalogArchive",
  {
    id: int("id").autoincrement().primaryKey(),
    /** promote 出這份快照的批次。 */
    batchId: int("batchId").notNull(),
    /** 被快照的 live tour 列 id(覆蓋前的舊值)。 */
    tourId: int("tourId").notNull(),
    /** 覆蓋前的整列 tour 值,JSON。回滾就把它寫回 tours。 */
    snapshotJson: mediumtext("snapshotJson").notNull(),
    archivedAt: timestamp("archivedAt").defaultNow().notNull(),
  },
  (table) => ({
    batchIdx: index("idx_toursArchive_batch").on(table.batchId),
    tourIdx: index("idx_toursArchive_tour").on(table.tourId, table.archivedAt),
  })
);

export type TourCatalogArchive = typeof toursCatalogArchive.$inferSelect;
export type InsertTourCatalogArchive = typeof toursCatalogArchive.$inferInsert;

// ─── v2 Wave 3 Module 3.4-B — skill execution audit ──────────────────────
// Persists every skill-orchestrator run triggered by the gmailPipeline.
// Migration: drizzle/0079_skill_runs.sql.
export const skillRuns = mysqlTable(
  "skillRuns",
  {
    id: int("id").autoincrement().primaryKey(),

    /** Matches the SkillId union in server/agents/skills/registry.ts */
    skillId: varchar("skillId", { length: 60 }).notNull(),
    /** Matches the InquiryClassification union (7 legacy + 5 v2 sub-intents) */
    intent: varchar("intent", { length: 50 }).notNull(),

    /** Soft references — no FK constraints (consistent with auditLog pattern) */
    interactionId: int("interactionId"),
    customerProfileId: int("customerProfileId"),
    agentMessageId: int("agentMessageId"),

    status: mysqlEnum("status", [
      "running",
      "succeeded",
      "failed",
      "escalated",
    ])
      .default("running")
      .notNull(),

    /** Output artifacts (succeeded only) */
    pdfStoragePath: varchar("pdfStoragePath", { length: 500 }),
    draftBody: text("draftBody"),
    meta: json("meta"),

    /** Failure context (failed / escalated) */
    errorMessage: varchar("errorMessage", { length: 1024 }),

    /** Cost + latency for AgentMonitor / selfRetrospective */
    llmTokensIn: int("llmTokensIn").default(0),
    llmTokensOut: int("llmTokensOut").default(0),
    llmCostCents: int("llmCostCents").default(0),
    durationMs: int("durationMs"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (table) => ({
    interactionIdx: index("idx_skillRuns_interactionId").on(
      table.interactionId,
    ),
    statusCreatedIdx: index("idx_skillRuns_status_createdAt").on(
      table.status,
      table.createdAt,
    ),
    skillCreatedIdx: index("idx_skillRuns_skillId_createdAt").on(
      table.skillId,
      table.createdAt,
    ),
  }),
);

export type SkillRun = typeof skillRuns.$inferSelect;
export type InsertSkillRun = typeof skillRuns.$inferInsert;

/**
 * approvalTasks — 指揮中心 (Command Center) 審核箱 single source of truth.
 *
 * Every operational lane (cs / quote / marketing / finance) emits work that
 * needs Jeff's sign-off by writing a row here via createApprovalTask
 * (server/_core/approvalTasks.ts). The 指揮中心 tab reads this table; approve /
 * reject routes back to the lane executor keyed by `taskType`.
 *
 * riskLevel policy (proposal §3 — 鐵律):
 *   auto      → may be batch-approved in one click
 *   review    → per-item review before send
 *   hard_gate → money / irreversible / customer-visible — ALWAYS per-item,
 *               NEVER bulk-approved (bulkApprove refuses these rows).
 *
 * payload is a lane-specific JSON string (kept as text, same as other JSON
 * blobs in this schema) — the executor parses it on approve.
 */
export const approvalTasks = mysqlTable("approvalTasks", {
  id: int("id").autoincrement().primaryKey(),
  /** Which operational lane produced this task (executor namespace). */
  lane: mysqlEnum("lane", ["cs", "quote", "marketing", "finance"]).notNull(),
  /** Fine-grained executor route within the lane (e.g. "cs.reply_inquiry"). */
  taskType: varchar("taskType", { length: 64 }).notNull(),
  /** auto = batch-ok / review = per-item / hard_gate = per-item, never bulk. */
  riskLevel: mysqlEnum("riskLevel", ["auto", "review", "hard_gate"]).notNull(),
  status: mysqlEnum("status", [
    "pending",
    "approved",
    "rejected",
    "sent",
    "failed",
    "expired",
  ])
    .notNull()
    .default("pending"),
  title: varchar("title", { length: 255 }).notNull(),
  summary: text("summary"),
  /** Lane-specific JSON string; executor parses on approve. */
  payload: text("payload").notNull(),
  /** Optional back-reference to a domain row (e.g. "inquiry" + its id). */
  relatedType: varchar("relatedType", { length: 64 }),
  relatedId: varchar("relatedId", { length: 64 }),
  /** Producer identity — agent name or "system"/"admin:<id>". */
  createdBy: varchar("createdBy", { length: 64 }).notNull(),
  /** users.id of the admin who approved/rejected (null while pending). */
  decidedBy: int("decidedBy"),
  decidedAt: timestamp("decidedAt"),
  /** Free-form failure detail when status = failed. */
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  idxLaneStatus: index("idx_approvalTasks_lane_status").on(t.lane, t.status),
  idxStatus: index("idx_approvalTasks_status").on(t.status),
  idxCreatedAt: index("idx_approvalTasks_createdAt").on(t.createdAt),
}));

export type ApprovalTask = typeof approvalTasks.$inferSelect;
export type InsertApprovalTask = typeof approvalTasks.$inferInsert;

// ────────────────────────────────────────────────────────────────────────
// 整合工作台 P3 — per-item「處理好了」disposition (migration 0089).
// Jeff's manual triage marker, separate from an item's own system status.
// Presence of a row = handled; deleting it = un-handled. (itemKind,itemId)
// is unique so each heterogeneous item has at most one disposition.
// ────────────────────────────────────────────────────────────────────────
export const workspaceDispositions = mysqlTable("workspaceDispositions", {
  id: int("id").autoincrement().primaryKey(),
  itemKind: varchar("itemKind", { length: 32 }).notNull(),
  itemId: int("itemId").notNull(),
  handledBy: int("handledBy"),
  handledAt: timestamp("handledAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  uqItem: unique("uq_workspace_disp_item").on(t.itemKind, t.itemId),
}));

export type WorkspaceDisposition = typeof workspaceDispositions.$inferSelect;

// ── 整合工作台 批2 m3 — per-customer 對話(2026-06-10 Jeff 拍板:獨立新表,
// 不混 agentMessages)。One thread per customer: Jeff ↔ agent messages bound
// by customerUserId. context JSON keeps the streamed turn's suggestedActions
// / cards for the later m3b card rendering; v1 renders body text only.
// ────────────────────────────────────────────────────────────────────────
export const customerChatMessages = mysqlTable("customerChatMessages", {
  id: int("id").autoincrement().primaryKey(),
  /** users.id of a REGISTERED customer's thread. Null for guest threads
   *  (relaxed to nullable in 0095 — email guests have no users.id). */
  customerUserId: int("customerUserId"),
  /** customerProfiles.id of an EMAIL guest's thread (guest-customer-chat,
   *  2026-06-15). Null for registered threads. Exactly one of
   *  customerUserId / customerProfileId is set per row. */
  customerProfileId: int("customerProfileId"),
  senderRole: mysqlEnum("senderRole", ["jeff", "agent"]).notNull(),
  body: text("body").notNull(),
  /** JSON: { suggestedActions, cards, streamed } from the agent turn. */
  context: text("context"),
  /** customer-projects (0104) — which customOrder (專案) this turn belongs to.
   *  NULL = 「未分類」basket (the customer-wide thread; today's behavior). Each
   *  project gets its own chat line so a repeat customer's orders don't pile
   *  into one history. Soft ref (no FK), mirrors bookingId/quoteId convention. */
  customOrderId: int("customOrderId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  customerIdx: index("idx_ccm_customer").on(t.customerUserId, t.createdAt),
  profileIdx: index("idx_ccm_profile").on(t.customerProfileId, t.createdAt),
  orderIdx: index("idx_ccm_order").on(t.customOrderId, t.createdAt),
}));

export type CustomerChatMessage = typeof customerChatMessages.$inferSelect;
export type InsertCustomerChatMessage = typeof customerChatMessages.$inferInsert;

// ── 整合工作台 批2 m4 — 代客訂機票最小狀態機(2026-06-10 Jeff 拍板)。
// Digitizes the existing manual flow: 核件(護照名)→ Trip.com 備訂 →
// Jeff 親自刷卡 → 出票 → 確認單。HARD LINE: the system never touches card
// numbers / CVV / the pay button — `bookingUrl` is just a link Jeff opens.
// passengerNames stores PASSPORT-SPELLING NAMES ONLY, never passport numbers
// (those live encrypted elsewhere; this table deliberately has no such column).
// ────────────────────────────────────────────────────────────────────────
export const flightOrders = mysqlTable("flightOrders", {
  id: int("id").autoincrement().primaryKey(),
  /** users.id of the customer (workspace per-customer scoped, soft ref). */
  customerUserId: int("customerUserId").notNull(),
  /** 備訂 → 待你刷卡 → 已出票;取消只允許在未出票前。 */
  status: mysqlEnum("status", [
    "prepared",
    "awaiting_payment",
    "ticketed",
    "cancelled",
  ])
    .default("prepared")
    .notNull(),
  airline: varchar("airline", { length: 80 }).notNull(),
  /** e.g. "NH008 直飛 SFO⇄NRT · 9/14 去 / 9/19 回" */
  flightSummary: varchar("flightSummary", { length: 255 }).notNull(),
  pricePerPerson: int("pricePerPerson"),
  passengerCount: int("passengerCount").default(1).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  /** passport-spelling names, comma separated. NAMES ONLY — no numbers. */
  passengerNames: varchar("passengerNames", { length: 500 }),
  /** Trip.com 訂購頁 — Jeff opens it himself to pay. Never auto-driven. */
  bookingUrl: varchar("bookingUrl", { length: 2000 }),
  pnr: varchar("pnr", { length: 20 }),
  eticketNumbers: varchar("eticketNumbers", { length: 255 }),
  orderRef: varchar("orderRef", { length: 40 }),
  notes: varchar("notes", { length: 1000 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  customerIdx: index("idx_fo_customer").on(t.customerUserId, t.createdAt),
}));

export type FlightOrder = typeof flightOrders.$inferSelect;
export type InsertFlightOrder = typeof flightOrders.$inferInsert;
