import { boolean, decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar, unique, index } from "drizzle-orm/mysql-core";

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
  
  /** Login security fields */
  loginAttempts: int("loginAttempts").default(0).notNull(), // Number of failed login attempts
  lockoutUntil: timestamp("lockoutUntil"), // Account locked until this time
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

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
  productCode: varchar("productCode", { length: 50 }), // 產品代碼 (e.g., 26JO217BRC-T)
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
  destination: text("destination").notNull(), // Legacy field for compatibility
  
  // Duration & Pricing
  duration: int("duration").notNull(), // in days
  nights: int("nights"), // number of nights
  price: int("price").notNull(), // 原始價格
  priceCurrency: varchar("priceCurrency", { length: 3 }).default("TWD").notNull(), // 原始價格貨幣 (TWD/USD)
  priceUnit: varchar("priceUnit", { length: 20 }).default("人/起"), // 價格單位
  
  // Flight Information - Outbound
  outboundAirline: varchar("outboundAirline", { length: 100 }), // 去程航空公司
  outboundFlightNo: varchar("outboundFlightNo", { length: 20 }), // 去程航班號
  outboundDepartureTime: varchar("outboundDepartureTime", { length: 10 }), // 去程出發時間 (e.g., 06:55)
  outboundArrivalTime: varchar("outboundArrivalTime", { length: 10 }), // 去程抵達時間 (e.g., 09:15)
  outboundFlightDuration: varchar("outboundFlightDuration", { length: 20 }), // 去程飛行時間 (e.g., 1h20m)
  
  // Flight Information - Inbound
  inboundAirline: varchar("inboundAirline", { length: 100 }), // 回程航空公司
  inboundFlightNo: varchar("inboundFlightNo", { length: 20 }), // 回程航班號
  inboundDepartureTime: varchar("inboundDepartureTime", { length: 10 }), // 回程出發時間
  inboundArrivalTime: varchar("inboundArrivalTime", { length: 10 }), // 回程抵達時間
  inboundFlightDuration: varchar("inboundFlightDuration", { length: 20 }), // 回程飛行時間
  
  // Accommodation Information
  hotelName: varchar("hotelName", { length: 255 }), // 酒店名稱
  hotelGrade: varchar("hotelGrade", { length: 50 }), // 酒店等級 (e.g., 五星級, 四星級)
  hotelNights: int("hotelNights"), // 住宿晚數
  hotelLocation: varchar("hotelLocation", { length: 255 }), // 酒店位置
  hotelDescription: text("hotelDescription"), // 酒店介紹
  hotelFacilities: text("hotelFacilities"), // JSON array of facilities
  hotelRoomType: varchar("hotelRoomType", { length: 100 }), // 房型
  hotelRoomSize: varchar("hotelRoomSize", { length: 50 }), // 房間大小 (e.g., 30-35平方米)
  hotelCheckIn: varchar("hotelCheckIn", { length: 10 }), // 入住時間 (e.g., 15:00)
  hotelCheckOut: varchar("hotelCheckOut", { length: 10 }), // 退房時間 (e.g., 11:00)
  hotelSpecialOffers: text("hotelSpecialOffers"), // JSON array of special offers
  hotelImages: text("hotelImages"), // JSON array of image URLs
  hotelWebsite: varchar("hotelWebsite", { length: 512 }), // 酒店官網
  
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
  imageUrl: varchar("imageUrl", { length: 512 }), // Main image
  galleryImages: text("galleryImages"), // JSON array of gallery image URLs with metadata
  
  // === New Fields for Luxury Design ===
  // Hero Section
  heroImage: varchar("heroImage", { length: 512 }), // Full-screen hero background image
  heroImageAlt: text("heroImageAlt"), // Hero image alt text for SEO
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
  
  // Warning Flags (for Partial Success tracking)
  // ⚠️ Tech Lead 審查意見：錯誤日誌的可視化
  // 當 P1 Agent 失敗並觸發 Fallback 時，Admin 後台必須能看到警告狀態。
  // JSON 格式：{colorTheme?: {failed, fallbackUsed, reason}, heroContent?: {...}, features?: {...}, imageGeneration?: {hero?: {...}, features?: {...}}}
  warningFlags: text("warningFlags"), // JSON string of warning flags
  
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
  status: mysqlEnum("status", ["open", "full", "cancelled"]).default("open").notNull(),
  currency: varchar("currency", { length: 3 }).default("TWD").notNull(),
  notes: text("notes"), // Special notes for this departure
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TourDeparture = typeof tourDepartures.$inferSelect;
export type InsertTourDeparture = typeof tourDepartures.$inferInsert;

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
  passportNumber: varchar("passportNumber", { length: 50 }),
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
  
  // Entity reference
  entityType: mysqlEnum("entityType", ["tour", "tour_departure", "page", "ui_element", "notification"]).notNull(),
  entityId: int("entityId").notNull(),
  fieldName: varchar("fieldName", { length: 100 }).notNull(), // e.g., "title", "description", "dailyItinerary"
  
  // Language information
  sourceLanguage: varchar("sourceLanguage", { length: 10 }).default("zh-TW").notNull(),
  targetLanguage: varchar("targetLanguage", { length: 10 }).notNull(), // e.g., "en", "es", "ja", "ko"
  
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
  passportNumber: varchar("passportNumber", { length: 50 }).notNull(),
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
