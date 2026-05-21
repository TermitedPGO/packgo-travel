import { eq, and, gte, lte, desc, inArray, like, or, sql, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql2 from "mysql2";
import { 
  InsertUser, users, 
  tours, InsertTour, Tour,
  tourDepartures, InsertTourDeparture, TourDeparture,
  bookings, InsertBooking, Booking,
  bookingParticipants, InsertBookingParticipant, BookingParticipant,
  payments, InsertPayment, Payment,
  inquiries, InsertInquiry, Inquiry,
  inquiryMessages, InsertInquiryMessage, InquiryMessage,
  newsletterSubscribers, InsertNewsletterSubscriber, NewsletterSubscriber,
  imageLibrary, InsertImageLibraryItem, ImageLibraryItem,
  homepageContent, HomepageContent, InsertHomepageContent,
  destinations, Destination, InsertDestination,
  userFavorites, UserFavorite, InsertUserFavorite,
  userBrowsingHistory, UserBrowsingHistory, InsertUserBrowsingHistory,
  calibrationResults, CalibrationResult, InsertCalibrationResult,
  competitorTours, CompetitorTour, InsertCompetitorTour,
  competitorDepartures, CompetitorDeparture, InsertCompetitorDeparture,
  competitorPriceHistory, CompetitorPriceHistory, InsertCompetitorPriceHistory,
  competitorAlerts, CompetitorAlert, InsertCompetitorAlert,
  marketingCampaigns, MarketingCampaign, InsertMarketingCampaign,
  marketingMaterials, MarketingMaterial, InsertMarketingMaterial,
  emailSendLogs, EmailSendLog, InsertEmailSendLog,
  visaApplications, VisaApplication, InsertVisaApplication,
  visaStatusHistory, VisaStatusHistory, InsertVisaStatusHistory,
  affiliateClicks, AffiliateClick, InsertAffiliateClick,
  tourPriceComparisons, TourPriceComparison, InsertTourPriceComparison,
  accountingEntries, AccountingEntry, InsertAccountingEntry,
  invoices, Invoice, InsertInvoice,
  recurringExpenses, RecurringExpense, InsertRecurringExpense,
  aiQuotes, AiQuote, InsertAiQuote,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import {
  encryptPassport,
  decryptParticipantRow,
  decryptVisaApplicationRow,
} from './_core/passportEncryption';

// ─── Passport-at-rest encryption (v2 Wave 1 · Module 1.8) ────────────────
// `passportNumber` on `bookingParticipants` + `visaApplications` is
// encrypted before insert/update and decrypted on read so a hypothetical
// DB dump no longer exposes raw passport numbers. Uses the same
// AES-256-GCM envelope as Gmail + Plaid tokens via
// server/_core/tokenCrypto.ts. `decryptToken` returns plaintext as-is
// when the `enc:v1:` prefix is absent, so legacy rows keep working
// until server/scripts/backfill-passport-encryption.ts re-encrypts them.
//
// CRITICAL: every read/write touching `passportNumber` in this file MUST
// flow through helpers from server/_core/passportEncryption.ts. Direct
// `db.insert(...).values({passportNumber})` or returning a row without
// `decryptParticipantRow` / `decryptVisaApplicationRow` leaks plaintext.

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Drizzle transaction handle.
 *
 * Phase 2 (2026-05-18): money-path helpers (createPayment, updateBooking,
 * updatePaymentStatus, createAccountingEntry) now accept an optional `tx`
 * so the stripe-webhook handlers can wrap multi-write sequences in a
 * single `db.transaction(async (tx) => …)` for atomicity.
 *
 * The exported type is intentionally Parameters<…>[0] of the transaction
 * callback so call sites stay forward-compatible with Drizzle internals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleTx = any;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // Use mysql2 pool with explicit timeouts to prevent hanging queries
      const pool = mysql2.createPool({
        uri: process.env.DATABASE_URL,
        connectionLimit: 10,
        connectTimeout: 10000,       // 10s to establish connection
        waitForConnections: true,
        queueLimit: 20,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _db = drizzle(pool.promise() as any);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// === v2 Wave 2 — domain extractions (D2-locked 7-file split) ===
// See server/db/booking.ts (Module 2.1, 13 fns) and server/db/tour.ts
// (Module 2.2, 22 exports). These shims re-export the extracted helpers so
// existing `import { createBooking } from "../db"` call sites across ~40
// routers + agents + services keep working unchanged.
export * from "./db/booking";
export * from "./db/tour";

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId && !user.email) {
    throw new Error("User openId or email is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId ?? null,
      email: user.email,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);
    
    // Email is already set in values, update if provided
    if (user.email && user.email !== values.email) {
      values.email = user.email;
      updateSet.email = user.email;
    }

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return null;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByGoogleId(googleId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByResetToken(token: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.resetPasswordToken, token)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createUserWithPassword(data: { email: string; password: string; name: string }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(users).values({
    email: data.email,
    password: data.password,
    name: data.name,
    loginMethod: 'email',
    role: 'user',
  });

  // Get the created user
  const user = await getUserByEmail(data.email);
  if (!user) {
    throw new Error("Failed to create user");
  }

  // Round 80.22: signup bonus +50 Packpoint. Best-effort — failures shouldn't
  // block account creation. Idempotency at user level (only awarded once
  // since this is the only place users are created via password flow).
  try {
    const { awardPackpoint } = await import("./_core/packpoint");
    await awardPackpoint({
      userId: user.id,
      delta: 50,
      reason: "signup_bonus",
      description: "Welcome bonus for signing up",
    });
  } catch (err) {
    console.error("[Packpoint] Signup bonus failed for user", user.id, err);
  }

  // Round 80.22 Phase D: assign unique referral code so the user can share
  // their link immediately. Best-effort.
  try {
    const { ensureReferralCode } = await import("./_core/referral");
    await ensureReferralCode(user.id);
  } catch (err) {
    console.error("[Referral] Code generation failed for user", user.id, err);
  }

  return user;
}

export async function createUserWithGoogle(data: { googleId: string; email: string; name: string }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(users).values({
    googleId: data.googleId,
    email: data.email,
    name: data.name,
    loginMethod: 'google',
    role: 'user',
  });

  // Get the created user
  const user = await getUserByGoogleId(data.googleId);
  if (!user) {
    throw new Error("Failed to create user");
  }

  // Round 80.22: signup bonus +50 Packpoint (same as password flow).
  try {
    const { awardPackpoint } = await import("./_core/packpoint");
    await awardPackpoint({
      userId: user.id,
      delta: 50,
      reason: "signup_bonus",
      description: "Welcome bonus for signing up via Google",
    });
  } catch (err) {
    console.error("[Packpoint] Signup bonus failed for user", user.id, err);
  }

  // Round 80.22 Phase D: assign unique referral code on Google signup too.
  try {
    const { ensureReferralCode } = await import("./_core/referral");
    await ensureReferralCode(user.id);
  } catch (err) {
    console.error("[Referral] Code generation failed for user", user.id, err);
  }

  return user;
}

export async function linkGoogleAccount(userId: number, googleId: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({ googleId }).where(eq(users.id, userId));
  
  // Return updated user
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function setPasswordResetToken(userId: number, token: string, expires: Date) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    resetPasswordToken: token,
    resetPasswordExpires: expires,
  }).where(eq(users.id, userId));
}

export async function updatePassword(userId: number, hashedPassword: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
}

export async function clearPasswordResetToken(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    resetPasswordToken: null,
    resetPasswordExpires: null,
  }).where(eq(users.id, userId));
}

/**
 * Increment login attempts for a user
 */
export async function incrementLoginAttempts(userId: number, attempts: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    loginAttempts: attempts,
  }).where(eq(users.id, userId));
}

/**
 * Lock user account until specified time
 */
export async function lockUserAccount(userId: number, lockoutUntil: Date) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    loginAttempts: 0, // Reset attempts when locking
    lockoutUntil,
  }).where(eq(users.id, userId));
}

/**
 * Reset login attempts for a user (on successful login)
 */
export async function resetLoginAttempts(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(users).set({
    loginAttempts: 0,
    lockoutUntil: null,
  }).where(eq(users.id, userId));
}

export async function deleteUser(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(users).where(eq(users.id, userId));
}

// ============================================
// Tours + Tour Departures: see server/db/tour.ts
// (extracted in v2 Wave 2 Module 2.2 via `export * from "./db/tour"` at top)
// Includes tours CRUD, departures CRUD (with money-path slot reserve/release),
// searchTours, getFilterOptions, getDepartureCities, calibration helpers.
// ============================================

// ============================================
// Booking + Payment domains: see server/db/booking.ts
// (extracted in v2 Wave 2 Module 2.1 via `export * from "./db/booking"` at top)
// ============================================

// ============================================
// Inquiry Management Functions
// ============================================

/**
 * Get all inquiries with optional filtering
 */
export async function getAllInquiries(filters?: {
  status?: string;
  inquiryType?: string;
  assignedTo?: number;
  userId?: number;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get inquiries: database not available");
    return [];
  }

  let query = db.select().from(inquiries);
  
  // Apply userId filter if provided
  if (filters?.userId) {
    query = query.where(eq(inquiries.userId, filters.userId)) as any;
  }
  
  const result = await query;
  return result;
}

/**
 * Get a single inquiry by ID
 */
export async function getInquiryById(id: number): Promise<Inquiry | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get inquiry: database not available");
    return undefined;
  }

  const result = await db.select().from(inquiries).where(eq(inquiries.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new inquiry
 */
export async function createInquiry(inquiry: InsertInquiry): Promise<Inquiry> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(inquiries).values(inquiry);
  const insertId = Number(result[0].insertId);
  
  const newInquiry = await getInquiryById(insertId);
  if (!newInquiry) {
    throw new Error("Failed to retrieve created inquiry");
  }
  
  return newInquiry;
}

/**
 * Update an existing inquiry
 */
export async function updateInquiry(id: number, updates: Partial<InsertInquiry>): Promise<Inquiry> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(inquiries).set(updates).where(eq(inquiries.id, id));
  
  const updatedInquiry = await getInquiryById(id);
  if (!updatedInquiry) {
    throw new Error("Failed to retrieve updated inquiry");
  }
  
  return updatedInquiry;
}

/**
 * Get all messages for an inquiry
 */
export async function getInquiryMessages(inquiryId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get inquiry messages: database not available");
    return [];
  }

  const result = await db.select().from(inquiryMessages).where(eq(inquiryMessages.inquiryId, inquiryId));
  return result;
}

/**
 * Create a new inquiry message
 */
export async function createInquiryMessage(message: InsertInquiryMessage): Promise<InquiryMessage> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(inquiryMessages).values(message);
  const insertId = Number(result[0].insertId);
  
  const messages = await db.select().from(inquiryMessages).where(eq(inquiryMessages.id, insertId)).limit(1);
  if (messages.length === 0) {
    throw new Error("Failed to retrieve created message");
  }
  
  return messages[0];
}

// Update user profile (name, phone, address)
export async function updateUserProfile(
  userId: number,
  data: { name?: string; phone?: string; address?: string }
): Promise<any> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;

  await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, userId));

  // Return updated user (filter sensitive fields)
  const [updated] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!updated) return null;
  const { password, resetPasswordToken, resetPasswordExpires, loginAttempts, lockoutUntil, ...safeUser } = updated as any;
  return safeUser;
}

// Update user avatar
export async function updateUserAvatar(
  userId: number,
  avatarUrl: string | null
): Promise<any> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(users)
    .set({ avatar: avatarUrl })
    .where(eq(users.id, userId));

  // Return updated user (filter sensitive fields)
  const [updated] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!updated) return null;
  const { password, resetPasswordToken, resetPasswordExpires, loginAttempts, lockoutUntil, ...safeUser } = updated as any;
  return safeUser;
}


// ============================================================================
// Newsletter Subscribers
// ============================================================================

// Create newsletter subscriber
export async function createNewsletterSubscriber(
  data: InsertNewsletterSubscriber
): Promise<NewsletterSubscriber> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const [result] = await db
    .insert(newsletterSubscribers)
    .values(data);

  const [subscriber] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.id, Number(result.insertId)))
    .limit(1);

  return subscriber;
}

// Get all newsletter subscribers
export async function getAllNewsletterSubscribers(): Promise<NewsletterSubscriber[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  return await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, "active"))
    .orderBy(desc(newsletterSubscribers.subscribedAt));
}

// Unsubscribe from newsletter
export async function unsubscribeNewsletter(email: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db
    .update(newsletterSubscribers)
    .set({
      status: "unsubscribed",
      unsubscribedAt: new Date(),
    })
    .where(eq(newsletterSubscribers.email, email));
}


// searchTours moved to server/db/tour.ts in v2 Wave 2 Module 2.2.

// ============================================
// Image Library Functions
// ============================================

/**
 * Get all images from the library with optional filters
 */
export async function getImageLibrary(options: {
  userId?: number;
  tourId?: number;
  limit?: number;
  offset?: number;
  search?: string;
} = {}): Promise<ImageLibraryItem[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get image library: database not available");
    return [];
  }

  try {
    let query = db.select().from(imageLibrary);
    const conditions = [];

    if (options.userId) {
      conditions.push(eq(imageLibrary.uploadedBy, options.userId));
    }
    if (options.tourId) {
      conditions.push(eq(imageLibrary.tourId, options.tourId));
    }
    if (options.search) {
      conditions.push(
        or(
          like(imageLibrary.filename, `%${options.search}%`),
          like(imageLibrary.tags, `%${options.search}%`)
        )
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    query = query.orderBy(desc(imageLibrary.createdAt)) as typeof query;

    if (options.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    return await query;
  } catch (error) {
    console.error("[Database] Failed to get image library:", error);
    return [];
  }
}

/**
 * Add an image to the library
 */
export async function addImageToLibrary(image: InsertImageLibraryItem): Promise<ImageLibraryItem | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot add image to library: database not available");
    return null;
  }

  try {
    const result = await db.insert(imageLibrary).values(image);
    const insertId = result[0].insertId;
    
    // Fetch and return the inserted image
    const [inserted] = await db.select().from(imageLibrary).where(eq(imageLibrary.id, insertId));
    return inserted || null;
  } catch (error) {
    console.error("[Database] Failed to add image to library:", error);
    return null;
  }
}

/**
 * Delete an image from the library
 */
export async function deleteImageFromLibrary(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete image from library: database not available");
    return false;
  }

  try {
    // Only allow deletion if user owns the image or is admin
    const [image] = await db.select().from(imageLibrary).where(eq(imageLibrary.id, id));
    if (!image) {
      return false;
    }

    await db.delete(imageLibrary).where(eq(imageLibrary.id, id));
    return true;
  } catch (error) {
    console.error("[Database] Failed to delete image from library:", error);
    return false;
  }
}

/**
 * Update image usage count
 */
export async function incrementImageUsage(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update image usage: database not available");
    return;
  }

  try {
    await db.update(imageLibrary)
      .set({ usageCount: sql`${imageLibrary.usageCount} + 1` })
      .where(eq(imageLibrary.id, id));
  } catch (error) {
    console.error("[Database] Failed to update image usage:", error);
  }
}

/**
 * Get image by ID
 */
export async function getImageById(id: number): Promise<ImageLibraryItem | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get image: database not available");
    return null;
  }

  try {
    const [image] = await db.select().from(imageLibrary).where(eq(imageLibrary.id, id));
    return image || null;
  } catch (error) {
    console.error("[Database] Failed to get image:", error);
    return null;
  }
}


// ============================================================
// Homepage Content Functions
// ============================================================

/**
 * Get homepage content by section key
 */
export async function getHomepageContent(sectionKey: string): Promise<HomepageContent | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get homepage content: database not available");
    return null;
  }

  try {
    const [content] = await db.select().from(homepageContent).where(eq(homepageContent.sectionKey, sectionKey));
    return content || null;
  } catch (error) {
    console.error("[Database] Failed to get homepage content:", error);
    return null;
  }
}

/**
 * Get all homepage content
 */
export async function getAllHomepageContent(): Promise<HomepageContent[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get homepage content: database not available");
    return [];
  }

  try {
    return await db.select().from(homepageContent);
  } catch (error) {
    console.error("[Database] Failed to get all homepage content:", error);
    return [];
  }
}

/**
 * Update or create homepage content
 */
export async function upsertHomepageContent(sectionKey: string, content: string, updatedBy?: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert homepage content: database not available");
    return false;
  }

  try {
    const existing = await getHomepageContent(sectionKey);
    if (existing) {
      await db.update(homepageContent)
        .set({ content, updatedBy })
        .where(eq(homepageContent.sectionKey, sectionKey));
    } else {
      await db.insert(homepageContent).values({ sectionKey, content, updatedBy });
    }
    return true;
  } catch (error) {
    console.error("[Database] Failed to upsert homepage content:", error);
    return false;
  }
}

// ============================================================
// Destinations Functions
// ============================================================

/**
 * Get all destinations
 */
export async function getAllDestinations(): Promise<Destination[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get destinations: database not available");
    return [];
  }

  try {
    return await db.select().from(destinations).orderBy(destinations.sortOrder);
  } catch (error) {
    console.error("[Database] Failed to get destinations:", error);
    return [];
  }
}

/**
 * Get active destinations for homepage display
 */
export async function getActiveDestinations(): Promise<Destination[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get destinations: database not available");
    return [];
  }

  try {
    return await db.select().from(destinations)
      .where(eq(destinations.isActive, true))
      .orderBy(destinations.sortOrder);
  } catch (error) {
    console.error("[Database] Failed to get active destinations:", error);
    return [];
  }
}

/**
 * Get destination by ID
 */
export async function getDestinationById(id: number): Promise<Destination | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get destination: database not available");
    return null;
  }

  try {
    const [destination] = await db.select().from(destinations).where(eq(destinations.id, id));
    return destination || null;
  } catch (error) {
    console.error("[Database] Failed to get destination:", error);
    return null;
  }
}

/**
 * Create a new destination
 */
export async function createDestination(data: InsertDestination): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create destination: database not available");
    return null;
  }

  try {
    const result = await db.insert(destinations).values(data);
    return result[0].insertId;
  } catch (error) {
    console.error("[Database] Failed to create destination:", error);
    return null;
  }
}

/**
 * Update a destination
 */
export async function updateDestination(id: number, data: Partial<InsertDestination>): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update destination: database not available");
    return false;
  }

  try {
    await db.update(destinations).set(data).where(eq(destinations.id, id));
    return true;
  } catch (error) {
    console.error("[Database] Failed to update destination:", error);
    return false;
  }
}

/**
 * Delete a destination
 */
export async function deleteDestination(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete destination: database not available");
    return false;
  }

  try {
    await db.delete(destinations).where(eq(destinations.id, id));
    return true;
  } catch (error) {
    console.error("[Database] Failed to delete destination:", error);
    return false;
  }
}

/**
 * Reorder destinations
 */
export async function reorderDestinations(orderedIds: number[]): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot reorder destinations: database not available");
    return false;
  }

  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(destinations)
        .set({ sortOrder: i + 1 })
        .where(eq(destinations.id, orderedIds[i]));
    }
    return true;
  } catch (error) {
    console.error("[Database] Failed to reorder destinations:", error);
    return false;
  }
}

// getFilterOptions moved to server/db/tour.ts in v2 Wave 2 Module 2.2.

// ==================== User Favorites ====================

/**
 * Add a tour to user's favorites
 */
export async function addFavorite(userId: number, tourId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    await db.insert(userFavorites).values({
      userId,
      tourId,
    }).onDuplicateKeyUpdate({
      set: { userId }, // No-op update, just to handle duplicate
    });
  } catch (error) {
    console.error("[Database] Failed to add favorite:", error);
    throw error;
  }
}

/**
 * Remove a tour from user's favorites
 */
export async function removeFavorite(userId: number, tourId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    await db.delete(userFavorites).where(
      and(
        eq(userFavorites.userId, userId),
        eq(userFavorites.tourId, tourId)
      )
    );
  } catch (error) {
    console.error("[Database] Failed to remove favorite:", error);
    throw error;
  }
}

/**
 * Check if a tour is in user's favorites
 */
export async function isFavorite(userId: number, tourId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db
    .select()
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.userId, userId),
        eq(userFavorites.tourId, tourId)
      )
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Get user's favorite tours with tour details
 */
export async function getUserFavorites(userId: number): Promise<Tour[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const favorites = await db
    .select({
      tourId: userFavorites.tourId,
      createdAt: userFavorites.createdAt,
    })
    .from(userFavorites)
    .where(eq(userFavorites.userId, userId))
    .orderBy(desc(userFavorites.createdAt));

  if (favorites.length === 0) {
    return [];
  }

  const tourIds = favorites.map(f => f.tourId);
  const tourList = await db
    .select()
    .from(tours)
    .where(inArray(tours.id, tourIds));

  // Sort by favorite order
  const tourMap = new Map(tourList.map(t => [t.id, t]));
  return tourIds.map(id => tourMap.get(id)).filter(Boolean) as Tour[];
}

/**
 * Get user's favorite tour IDs (for quick checking)
 */
export async function getUserFavoriteIds(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const favorites = await db
    .select({ tourId: userFavorites.tourId })
    .from(userFavorites)
    .where(eq(userFavorites.userId, userId));

  return favorites.map(f => f.tourId);
}

// ==================== User Browsing History ====================

/**
 * Record a tour view in user's browsing history
 */
export async function recordBrowsingHistory(userId: number, tourId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    // Check if entry exists
    const existing = await db
      .select()
      .from(userBrowsingHistory)
      .where(
        and(
          eq(userBrowsingHistory.userId, userId),
          eq(userBrowsingHistory.tourId, tourId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing entry
      await db
        .update(userBrowsingHistory)
        .set({
          viewedAt: new Date(),
          viewCount: sql`${userBrowsingHistory.viewCount} + 1`,
        })
        .where(eq(userBrowsingHistory.id, existing[0].id));
    } else {
      // Insert new entry
      await db.insert(userBrowsingHistory).values({
        userId,
        tourId,
      });
    }
  } catch (error) {
    console.error("[Database] Failed to record browsing history:", error);
    throw error;
  }
}

/**
 * Get user's browsing history with tour details
 */
export async function getUserBrowsingHistory(userId: number, limit: number = 20): Promise<Tour[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const history = await db
    .select({
      tourId: userBrowsingHistory.tourId,
      viewedAt: userBrowsingHistory.viewedAt,
    })
    .from(userBrowsingHistory)
    .where(eq(userBrowsingHistory.userId, userId))
    .orderBy(desc(userBrowsingHistory.viewedAt))
    .limit(limit);

  if (history.length === 0) {
    return [];
  }

  const tourIds = history.map(h => h.tourId);
  const tourList = await db
    .select()
    .from(tours)
    .where(inArray(tours.id, tourIds));

  // Sort by viewing order
  const tourMap = new Map(tourList.map(t => [t.id, t]));
  return tourIds.map(id => tourMap.get(id)).filter(Boolean) as Tour[];
}

/**
 * Clear user's browsing history
 */
export async function clearBrowsingHistory(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(userBrowsingHistory).where(eq(userBrowsingHistory.userId, userId));
}

// Get newsletter subscriber by email
export async function getNewsletterSubscriberByEmail(email: string): Promise<NewsletterSubscriber | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [subscriber] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1);
  return subscriber ?? null;
}

// Re-subscribe a previously unsubscribed email
export async function resubscribeNewsletter(email: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(newsletterSubscribers)
    .set({ status: "active", unsubscribedAt: null })
    .where(eq(newsletterSubscribers.email, email));
}

// getDepartureCities moved to server/db/tour.ts in v2 Wave 2 Module 2.2.

// ============================================================
// imageLibrary convenience aliases (used by masterAgent pipeline)
// ============================================================
/**
 * Alias for addImageToLibrary – used by masterAgent image pipeline.
 */
export const addToImageLibrary = addImageToLibrary;

/**
 * Search imageLibrary by a text query (matches filename or tags).
 */
export async function searchImageLibrary(
  query: string,
  limit = 10
): Promise<ImageLibraryItem[]> {
  return getImageLibrary({ search: query, limit });
}

/**
 * Get all images associated with a specific tour.
 */
export async function getImagesByTourId(tourId: number): Promise<ImageLibraryItem[]> {
  return getImageLibrary({ tourId });
}

/**
 * Update imageLibrary item fields (used by Vision analysis pipeline).
 */
export async function updateImageLibraryItem(
  id: number,
  updates: Partial<Pick<ImageLibraryItem, 'tags' | 'visionDescription' | 'contentType' | 'qualityScore' | 'source'>>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(imageLibrary).set(updates).where(eq(imageLibrary.id, id));
}

// Calibration helpers (saveCalibrationResult, getCalibrationResultByTourId,
// getPendingReviewTours, approveTour, rejectTour) moved to server/db/tour.ts
// in v2 Wave 2 Module 2.2 (calibration is part of tour state machine).

// ============================================
// Competitor Monitoring Functions
// ============================================

/**
 * Create a new competitor tour to monitor
 */
export async function createCompetitorTour(data: InsertCompetitorTour) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(competitorTours).values(data);
  const insertId = (result as any)[0]?.insertId;
  if (!insertId) throw new Error("Failed to create competitor tour");
  
  const rows = await db.select().from(competitorTours).where(eq(competitorTours.id, insertId)).limit(1);
  return rows[0];
}

/**
 * Get all competitor tours with optional filters
 */
export async function getCompetitorTours(filters?: {
  competitor?: string;
  scrapeStatus?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { tours: [] as CompetitorTour[], total: 0, page: 1, pageSize: 20 };

  const conditions: any[] = [];
  if (filters?.competitor && filters.competitor !== "all") {
    conditions.push(eq(competitorTours.competitor, filters.competitor as any));
  }
  if (filters?.scrapeStatus && filters.scrapeStatus !== "all") {
    conditions.push(eq(competitorTours.scrapeStatus, filters.scrapeStatus as any));
  }
  if (filters?.search) {
    conditions.push(
      or(
        like(competitorTours.tourTitle, `%${filters.search}%`),
        like(competitorTours.destination, `%${filters.search}%`),
        like(competitorTours.tourUrl, `%${filters.search}%`)
      )
    );
  }

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(competitorTours)
    .where(whereClause)
    .orderBy(desc(competitorTours.updatedAt))
    .limit(pageSize)
    .offset(offset);

  // Count total
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorTours)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  return { tours: rows, total, page, pageSize };
}

/**
 * Get a single competitor tour by ID
 */
export async function getCompetitorTourById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(competitorTours).where(eq(competitorTours.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Get all active competitor tours (for scheduling)
 */
export async function getActiveCompetitorTours() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(competitorTours)
    .where(eq(competitorTours.scrapeStatus, "active"));
}

/**
 * Update a competitor tour
 */
export async function updateCompetitorTour(id: number, data: Partial<InsertCompetitorTour>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(competitorTours).set(data).where(eq(competitorTours.id, id));
  return getCompetitorTourById(id);
}

/**
 * Delete a competitor tour and all related data
 */
export async function deleteCompetitorTour(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete related data first
  await db.delete(competitorAlerts).where(eq(competitorAlerts.competitorTourId, id));
  await db.delete(competitorPriceHistory).where(eq(competitorPriceHistory.competitorTourId, id));
  await db.delete(competitorDepartures).where(eq(competitorDepartures.competitorTourId, id));
  await db.delete(competitorTours).where(eq(competitorTours.id, id));
}

/**
 * Update scrape status for a competitor tour
 */
export async function updateCompetitorTourScrapeStatus(
  id: number,
  status: "active" | "paused" | "error",
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = {
    scrapeStatus: status,
    lastScrapedAt: new Date(),
  };
  if (status === "error" && errorMessage) {
    updateData.scrapeErrorMessage = errorMessage;
  } else {
    updateData.scrapeErrorMessage = null;
  }

  await db.update(competitorTours).set(updateData).where(eq(competitorTours.id, id));
}

// ── Departures ──────────────────────────────────────────────

/**
 * Get latest departures for a competitor tour
 */
export async function getLatestDepartures(competitorTourId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(competitorDepartures)
    .where(eq(competitorDepartures.competitorTourId, competitorTourId))
    .orderBy(desc(competitorDepartures.scrapedAt));
}

/**
 * Upsert competitor departures (replace old snapshot with new one)
 */
export async function upsertCompetitorDepartures(
  competitorTourId: number,
  departures: Array<{
    departureDate: string;
    returnDate?: string;
    adultPrice?: number;
    childPrice?: number;
    singleSupplement?: number;
    totalSeats?: number;
    availableSeats?: number;
    status: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete old departures for this tour
  await db
    .delete(competitorDepartures)
    .where(eq(competitorDepartures.competitorTourId, competitorTourId));

  // Insert new departures
  if (departures.length === 0) return;

  const values = departures.map((d) => ({
    competitorTourId,
    departureDate: d.departureDate,
    returnDate: d.returnDate ?? null,
    adultPrice: d.adultPrice ?? null,
    childPrice: d.childPrice ?? null,
    singleSupplement: d.singleSupplement ?? null,
    totalSeats: d.totalSeats ?? null,
    availableSeats: d.availableSeats ?? null,
    departureStatus: (d.status || "open") as "open" | "full" | "cancelled" | "guaranteed",
  }));

  await db.insert(competitorDepartures).values(values);
}

// ── Price History ───────────────────────────────────────────

/**
 * Insert a price history record
 */
export async function insertPriceHistory(data: {
  competitorTourId: number;
  departureDate: string;
  price: number;
  previousPrice: number | null;
  priceChange: number | null;
  changeType: "increase" | "decrease" | "new" | "unchanged";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(competitorPriceHistory).values({
    competitorTourId: data.competitorTourId,
    departureDate: data.departureDate,
    price: data.price,
    previousPrice: data.previousPrice,
    priceChange: data.priceChange,
    changeType: data.changeType,
  });
}

/**
 * Get price history for a competitor tour (optionally filtered by departure date)
 */
export async function getPriceHistory(
  competitorTourId: number,
  departureDate?: string,
  limit = 100
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(competitorPriceHistory.competitorTourId, competitorTourId)];
  if (departureDate) {
    conditions.push(eq(competitorPriceHistory.departureDate, departureDate));
  }

  return db
    .select()
    .from(competitorPriceHistory)
    .where(and(...conditions))
    .orderBy(desc(competitorPriceHistory.recordedAt))
    .limit(limit);
}

// ── Alerts ──────────────────────────────────────────────────

/**
 * Insert competitor alerts (batch)
 */
export async function insertCompetitorAlerts(
  alerts: Array<{
    competitorTourId: number;
    alertType: string;
    title: string;
    message: string;
    severity: "info" | "warning" | "critical";
    metadata: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (alerts.length === 0) return;

  const values = alerts.map((a) => ({
    competitorTourId: a.competitorTourId,
    alertType: a.alertType as any,
    title: a.title,
    message: a.message,
    severity: a.severity,
    metadata: a.metadata,
  }));

  await db.insert(competitorAlerts).values(values);
}

/**
 * Get competitor alerts with optional filters
 */
export async function getCompetitorAlerts(filters?: {
  competitorTourId?: number;
  alertType?: string;
  severity?: string;
  isRead?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { alerts: [], total: 0, page: 1, pageSize: 20 };

  const conditions: any[] = [];
  if (filters?.competitorTourId) {
    conditions.push(eq(competitorAlerts.competitorTourId, filters.competitorTourId));
  }
  if (filters?.alertType && filters.alertType !== "all") {
    conditions.push(eq(competitorAlerts.alertType, filters.alertType as any));
  }
  if (filters?.severity && filters.severity !== "all") {
    conditions.push(eq(competitorAlerts.severity, filters.severity as any));
  }
  if (filters?.isRead !== undefined) {
    conditions.push(eq(competitorAlerts.isRead, filters.isRead ? 1 : 0));
  }

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(competitorAlerts)
    .where(whereClause)
    .orderBy(desc(competitorAlerts.createdAt))
    .limit(pageSize)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorAlerts)
    .where(whereClause);
  const total = countResult[0]?.count ?? 0;

  return { alerts: rows, total, page, pageSize };
}

/**
 * Get unread alert count
 */
export async function getUnreadAlertCount() {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorAlerts)
    .where(eq(competitorAlerts.isRead, 0));

  return result[0]?.count ?? 0;
}

/**
 * Mark alert as read
 */
export async function markAlertAsRead(alertId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(competitorAlerts)
    .set({ isRead: 1, readAt: new Date() })
    .where(eq(competitorAlerts.id, alertId));
}

/**
 * Mark all alerts as read
 */
export async function markAllAlertsAsRead() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(competitorAlerts)
    .set({ isRead: 1, readAt: new Date() })
    .where(eq(competitorAlerts.isRead, 0));
}

/**
 * Delete old alerts (cleanup)
 */
export async function deleteOldAlerts(olderThanDays = 30) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  await db
    .delete(competitorAlerts)
    .where(lte(competitorAlerts.createdAt, cutoff));
}

// ============================================
// Marketing Automation Functions
// ============================================

// ── Campaign CRUD ──────────────────────────────────────────

export async function createMarketingCampaign(data: InsertMarketingCampaign): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(marketingCampaigns).values(data);
  return (result[0] as { insertId: number }).insertId;
}

export async function getMarketingCampaigns(filters?: {
  type?: "social_post" | "email_newsletter" | "poster";
  status?: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  limit?: number;
}): Promise<MarketingCampaign[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.type) conditions.push(eq(marketingCampaigns.type, filters.type));
  if (filters?.status) conditions.push(eq(marketingCampaigns.status, filters.status));
  const query = db.select().from(marketingCampaigns);
  if (conditions.length > 0) query.where(and(...conditions));
  query.orderBy(desc(marketingCampaigns.createdAt));
  if (filters?.limit) query.limit(filters.limit);
  return query;
}

export async function getMarketingCampaignById(id: number): Promise<MarketingCampaign | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateMarketingCampaign(id: number, data: Partial<InsertMarketingCampaign>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(marketingCampaigns).set(data).where(eq(marketingCampaigns.id, id));
}

export async function deleteMarketingCampaign(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
}

// ── Materials ──────────────────────────────────────────────

export async function saveMarketingMaterial(data: InsertMarketingMaterial): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(marketingMaterials).values(data);
  return (result[0] as { insertId: number }).insertId;
}

export async function getMarketingMaterials(filters?: {
  tourId?: number;
  type?: string;
  campaignId?: number;
  limit?: number;
}): Promise<MarketingMaterial[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.tourId) conditions.push(eq(marketingMaterials.tourId, filters.tourId));
  if (filters?.campaignId) conditions.push(eq(marketingMaterials.campaignId, filters.campaignId));
  if (filters?.type) conditions.push(eq(marketingMaterials.type, filters.type as MarketingMaterial["type"]));
  const query = db.select().from(marketingMaterials);
  if (conditions.length > 0) query.where(and(...conditions));
  query.orderBy(desc(marketingMaterials.createdAt));
  if (filters?.limit) query.limit(filters.limit);
  return query;
}

export async function deleteMarketingMaterial(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(marketingMaterials).where(eq(marketingMaterials.id, id));
}

// ── Email Send Logs ────────────────────────────────────────

export async function createEmailSendLog(data: InsertEmailSendLog): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(emailSendLogs).values(data);
}

export async function updateEmailSendLog(id: number, data: Partial<InsertEmailSendLog>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(emailSendLogs).set(data).where(eq(emailSendLogs.id, id));
}

export async function getEmailSendLogs(campaignId: number): Promise<EmailSendLog[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailSendLogs)
    .where(eq(emailSendLogs.campaignId, campaignId))
    .orderBy(desc(emailSendLogs.sentAt));
}

// ── Newsletter Subscribers ─────────────────────────────────

export async function getActiveSubscribers(): Promise<{ email: string }[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ email: newsletterSubscribers.email })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, 'active'));
}

export async function getSubscriberCount(): Promise<{ total: number; active: number }> {
  const db = await getDb();
  if (!db) return { total: 0, active: 0 };
  const [totalResult, activeResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(newsletterSubscribers),
    db.select({ count: sql<number>`count(*)` }).from(newsletterSubscribers).where(eq(newsletterSubscribers.status, 'active')),
  ]);
  return {
    total: Number(totalResult[0]?.count ?? 0),
    active: Number(activeResult[0]?.count ?? 0),
  };
}

// ══════════════════════════════════════════════════════════════
// PHASE 6: 中國簽證代辦 DB 函數
// ══════════════════════════════════════════════════════════════

// ── 建立申請 ──────────────────────────────────────────────────
export async function createVisaApplication(
  data: InsertVisaApplication
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // v2 Module 1.8: encrypt passportNumber before insert. visaApplications
  // .passportNumber is NOT NULL, so we always have a value to encrypt.
  const toInsert: InsertVisaApplication = {
    ...data,
    passportNumber: encryptPassport(data.passportNumber),
  };
  const result = await db.insert(visaApplications).values(toInsert);
  return (result[0] as { insertId: number }).insertId;
}

// ── 查詢單筆申請 ──────────────────────────────────────────────
/**
 * Phase 2 (2026-05-18): accepts an optional `tx` so visa-payment webhook
 * handlers can read the application row inside the same transaction that
 * later writes payment info, status, and the accounting entry. Reading
 * via the tx handle guarantees the row hasn't been mutated by another
 * concurrent writer between READ and WRITE inside the same tx scope.
 */
export async function getVisaApplicationById(
  id: number,
  tx?: DrizzleTx,
): Promise<VisaApplication | null> {
  const db = await getDb();
  if (!db) return null;
  const reader = tx ?? db;
  const result = await reader
    .select()
    .from(visaApplications)
    .where(eq(visaApplications.id, id))
    .limit(1);
  // v2 Module 1.8: decrypt passportNumber on the way out so admin UI,
  // visa email service, Stripe webhook, and applicant status page all
  // see plaintext transparently.
  return result[0] ? decryptVisaApplicationRow(result[0]) : null;
}

// ── 依 Stripe Session 查詢 ────────────────────────────────────
export async function getVisaApplicationByStripeSession(
  sessionId: string
): Promise<VisaApplication | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(visaApplications)
    .where(eq(visaApplications.stripeCheckoutSessionId, sessionId))
    .limit(1);
  // v2 Module 1.8: decrypt passportNumber on the way out.
  return result[0] ? decryptVisaApplicationRow(result[0]) : null;
}

// ── 查詢所有申請（Admin）────────────────────────────────────
export async function getAllVisaApplications(filters?: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ applications: VisaApplication[]; total: number }> {
  const db = await getDb();
  if (!db) return { applications: [], total: 0 };

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(visaApplications.applicationStatus, filters.status as VisaApplication["applicationStatus"]));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [applications, countResult] = await Promise.all([
    db
      .select()
      .from(visaApplications)
      .where(whereClause)
      .orderBy(desc(visaApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(visaApplications)
      .where(whereClause),
  ]);

  return {
    // v2 Module 1.8: decrypt passportNumber on the way out for every row.
    applications: applications.map((row) => decryptVisaApplicationRow(row)),
    total: Number(countResult[0]?.count ?? 0),
  };
}

// ── 更新申請狀態 ──────────────────────────────────────────────
/**
 * Phase 2 (2026-05-18): accepts an optional `tx`. When supplied, both the
 * status UPDATE and the `visaStatusHistory` INSERT run inside the same
 * transaction so a status flip without an audit-history row is impossible.
 * The current-status read also flows through the tx handle to see any
 * uncommitted writes made earlier inside the same transaction.
 */
export async function updateVisaApplicationStatus(
  id: number,
  newStatus: VisaApplication["applicationStatus"],
  changedBy?: number,
  note?: string,
  tx?: DrizzleTx,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const writer = tx ?? db;
  const current = await getVisaApplicationById(id, tx);
  const fromStatus = current?.applicationStatus ?? null;

  await writer
    .update(visaApplications)
    .set({ applicationStatus: newStatus })
    .where(eq(visaApplications.id, id));

  // 記錄狀態歷程
  await writer.insert(visaStatusHistory).values({
    applicationId: id,
    fromStatus: fromStatus ?? undefined,
    toStatus: newStatus,
    changedBy,
    note,
  });
}

// ── 更新付款資訊 ──────────────────────────────────────────────
/**
 * Phase 2 (2026-05-18): accepts an optional `tx` so the visa-payment
 * webhook handler can co-locate this UPDATE with the application-status
 * flip and the accounting income entry under a single atomic transaction.
 */
export async function updateVisaPaymentInfo(
  id: number,
  data: {
    paymentStatus: VisaApplication["paymentStatus"];
    stripePaymentIntentId?: string;
    stripeCheckoutSessionId?: string;
    paidAt?: Date;
  },
  tx?: DrizzleTx,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const writer = tx ?? db;
  await writer
    .update(visaApplications)
    .set(data)
    .where(eq(visaApplications.id, id));
}

// ── 更新 Admin 備註 ───────────────────────────────────────────
export async function updateVisaAdminNotes(
  id: number,
  adminNotes: string,
  trackingNumber?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(visaApplications)
    .set({ adminNotes, ...(trackingNumber ? { trackingNumber } : {}) })
    .where(eq(visaApplications.id, id));
}

// ── 查詢狀態歷程 ──────────────────────────────────────────────
export async function getVisaStatusHistory(
  applicationId: number
): Promise<VisaStatusHistory[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(visaStatusHistory)
    .where(eq(visaStatusHistory.applicationId, applicationId))
    .orderBy(desc(visaStatusHistory.createdAt));
}

// ── 統計資料（Admin Dashboard）────────────────────────────────
export async function getVisaStats(): Promise<{
  total: number;
  pending: number;
  processing: number;
  approved: number;
  rejected: number;
  totalRevenue: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, pending: 0, processing: 0, approved: 0, rejected: 0, totalRevenue: 0 };

  const [totalResult, pendingResult, processingResult, approvedResult, rejectedResult, revenueResult] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(visaApplications),
      db
        .select({ count: sql<number>`count(*)` })
        .from(visaApplications)
        .where(inArray(visaApplications.applicationStatus, ["submitted", "paid", "documents_received"])),
      db
        .select({ count: sql<number>`count(*)` })
        .from(visaApplications)
        .where(eq(visaApplications.applicationStatus, "processing")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(visaApplications)
        .where(inArray(visaApplications.applicationStatus, ["approved", "completed"])),
      db
        .select({ count: sql<number>`count(*)` })
        .from(visaApplications)
        .where(eq(visaApplications.applicationStatus, "rejected")),
      db
        .select({ total: sql<number>`sum(totalAmount)` })
        .from(visaApplications)
        .where(eq(visaApplications.paymentStatus, "paid")),
    ]);

  return {
    total: Number(totalResult[0]?.count ?? 0),
    pending: Number(pendingResult[0]?.count ?? 0),
    processing: Number(processingResult[0]?.count ?? 0),
    approved: Number(approvedResult[0]?.count ?? 0),
    rejected: Number(rejectedResult[0]?.count ?? 0),
    totalRevenue: Number(revenueResult[0]?.total ?? 0),
  };
}

// ============================================
// Affiliate Click Tracking Functions
// ============================================

export async function createAffiliateClick(data: InsertAffiliateClick): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create affiliate click: database not available");
    return;
  }
  await db.insert(affiliateClicks).values(data);
}

export async function getAffiliateClicks(filters?: {
  platform?: string;
  limit?: number;
}): Promise<AffiliateClick[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.platform) {
    conditions.push(eq(affiliateClicks.platform, filters.platform as AffiliateClick["platform"]));
  }

  const query = db.select().from(affiliateClicks);
  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(affiliateClicks.createdAt)).limit(filters?.limit ?? 100);
  }
  return query.orderBy(desc(affiliateClicks.createdAt)).limit(filters?.limit ?? 100);
}

export async function getAffiliateStats(days: number): Promise<{
  totalClicks: number;
  byPlatform: Record<string, number>;
  byDay: Array<{ date: string; clicks: number }>;
  topReferrers: Array<{ page: string; clicks: number }>;
}> {
  const db = await getDb();
  if (!db) return { totalClicks: 0, byPlatform: {}, byDay: [], topReferrers: [] };

  const since = new Date();
  since.setDate(since.getDate() - days);

  const [totalResult, platformResult, dayResult, referrerResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(affiliateClicks)
      .where(gte(affiliateClicks.createdAt, since)),
    db.select({
      platform: affiliateClicks.platform,
      count: sql<number>`count(*)`,
    })
      .from(affiliateClicks)
      .where(gte(affiliateClicks.createdAt, since))
      .groupBy(affiliateClicks.platform),
    db.select({
      date: sql<string>`DATE(createdAt)`,
      clicks: sql<number>`count(*)`,
    })
      .from(affiliateClicks)
      .where(gte(affiliateClicks.createdAt, since))
      .groupBy(sql`DATE(createdAt)`)
      .orderBy(sql`DATE(createdAt)`),
    db.select({
      page: affiliateClicks.referrerPage,
      clicks: sql<number>`count(*)`,
    })
      .from(affiliateClicks)
      .where(and(gte(affiliateClicks.createdAt, since), sql`referrerPage IS NOT NULL`))
      .groupBy(affiliateClicks.referrerPage)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const byPlatform: Record<string, number> = {};
  for (const row of platformResult) {
    byPlatform[row.platform] = Number(row.count);
  }

  return {
    totalClicks: Number(totalResult[0]?.count ?? 0),
    byPlatform,
    byDay: dayResult.map(r => ({ date: r.date, clicks: Number(r.clicks) })),
    topReferrers: referrerResult
      .filter(r => r.page)
      .map(r => ({ page: r.page!, clicks: Number(r.clicks) })),
  };
}

// ============================================
// Tour Price Comparison Functions
// ============================================

export async function upsertTourPriceComparison(data: Omit<InsertTourPriceComparison, "id" | "createdAt" | "updatedAt" | "lastUpdated">): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select({ id: tourPriceComparisons.id })
    .from(tourPriceComparisons)
    .where(eq(tourPriceComparisons.tourId, data.tourId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(tourPriceComparisons)
      .set({ ...data, lastUpdated: new Date() })
      .where(eq(tourPriceComparisons.tourId, data.tourId));
  } else {
    await db.insert(tourPriceComparisons).values({ ...data, lastUpdated: new Date() });
  }
}

export async function getTourPriceComparison(tourId: number): Promise<TourPriceComparison | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select()
    .from(tourPriceComparisons)
    .where(eq(tourPriceComparisons.tourId, tourId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getAllPriceComparisons(): Promise<TourPriceComparison[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(tourPriceComparisons).orderBy(desc(tourPriceComparisons.updatedAt));
}

export async function deleteTourPriceComparison(tourId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(tourPriceComparisons).where(eq(tourPriceComparisons.tourId, tourId));
}

// ─── Accounting Entries ────────────────────────────────────────────────────────

/**
 * Insert a row into the accounting ledger.
 *
 * Phase 2 (2026-05-18): accepts an optional `tx` so the stripe-webhook
 * booking handler can co-locate the accounting income entry with the
 * payment + booking writes in a single atomic transaction.
 */
export async function createAccountingEntry(
  data: InsertAccountingEntry,
  tx?: DrizzleTx,
): Promise<AccountingEntry | null> {
  const db = await getDb();
  if (!db) return null;
  const writer = tx ?? db;
  const [result] = await writer.insert(accountingEntries).values(data);
  const id = (result as any).insertId;
  const [entry] = await writer.select().from(accountingEntries).where(eq(accountingEntries.id, id));
  return entry || null;
}

export async function getAccountingEntries(params: {
  entryType?: 'income' | 'expense';
  category?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: AccountingEntry[]; total: number }> {
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };
  const conditions = [];
  if (params.entryType) conditions.push(eq(accountingEntries.entryType, params.entryType));
  if (params.category) conditions.push(eq(accountingEntries.category, params.category as any));
  if (params.startDate) conditions.push(gte(accountingEntries.entryDate, params.startDate));
  if (params.endDate) conditions.push(lte(accountingEntries.entryDate, params.endDate));
  if (params.search) conditions.push(like(accountingEntries.description, `%${params.search}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(accountingEntries).where(where);
  const entries = await db.select().from(accountingEntries).where(where)
    .orderBy(desc(accountingEntries.entryDate))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0);
  return { entries, total: Number(countResult.count) };
}

export async function updateAccountingEntry(id: number, data: Partial<InsertAccountingEntry>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(accountingEntries).set({ ...data, updatedAt: new Date() }).where(eq(accountingEntries.id, id));
  return true;
}

export async function deleteAccountingEntry(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.delete(accountingEntries).where(eq(accountingEntries.id, id));
  return true;
}

export async function getAccountingStats(params: { startDate: Date; endDate: Date }): Promise<{
  totalIncome: number; totalExpenses: number; netProfit: number;
  prevTotalIncome: number; prevTotalExpenses: number; prevNetProfit: number;
  yearIncome: number; yearExpenses: number; yearNetProfit: number;
}> {
  const db = await getDb();
  if (!db) return { totalIncome: 0, totalExpenses: 0, netProfit: 0, prevTotalIncome: 0, prevTotalExpenses: 0, prevNetProfit: 0, yearIncome: 0, yearExpenses: 0, yearNetProfit: 0 };
  const diff = params.endDate.getTime() - params.startDate.getTime();
  const prevStart = new Date(params.startDate.getTime() - diff);
  const prevEnd = new Date(params.endDate.getTime() - diff);
  const yearStart = new Date(params.startDate.getFullYear(), 0, 1);
  const yearEnd = new Date(params.startDate.getFullYear(), 11, 31, 23, 59, 59);
  const [curr, prev, year] = await Promise.all([
    db.select({ type: accountingEntries.entryType, total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(accountingEntries).where(and(gte(accountingEntries.entryDate, params.startDate), lte(accountingEntries.entryDate, params.endDate)))
      .groupBy(accountingEntries.entryType),
    db.select({ type: accountingEntries.entryType, total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(accountingEntries).where(and(gte(accountingEntries.entryDate, prevStart), lte(accountingEntries.entryDate, prevEnd)))
      .groupBy(accountingEntries.entryType),
    db.select({ type: accountingEntries.entryType, total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(accountingEntries).where(and(gte(accountingEntries.entryDate, yearStart), lte(accountingEntries.entryDate, yearEnd)))
      .groupBy(accountingEntries.entryType),
  ]);
  const sum = (rows: any[], type: string) => Number(rows.find(r => r.type === type)?.total ?? 0);
  const ti = sum(curr, 'income'), te = sum(curr, 'expense');
  const pti = sum(prev, 'income'), pte = sum(prev, 'expense');
  const yi = sum(year, 'income'), ye = sum(year, 'expense');
  return { totalIncome: ti, totalExpenses: te, netProfit: ti - te, prevTotalIncome: pti, prevTotalExpenses: pte, prevNetProfit: pti - pte, yearIncome: yi, yearExpenses: ye, yearNetProfit: yi - ye };
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function createInvoice(data: InsertInvoice): Promise<Invoice | null> {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(invoices).values(data);
  const id = (result as any).insertId;
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  return inv || null;
}

export async function getInvoices(params: { status?: string; limit?: number; offset?: number }): Promise<Invoice[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (params.status) conditions.push(eq(invoices.status, params.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(invoices).where(where).orderBy(desc(invoices.createdAt)).limit(params.limit ?? 50).offset(params.offset ?? 0);
}

export async function getInvoiceById(id: number): Promise<Invoice | null> {
  const db = await getDb();
  if (!db) return null;
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  return inv || null;
}

/**
 * v77: lookup an invoice by its associated booking. Used by the customer
 * "Download receipt" flow to avoid regenerating PDFs that already exist.
 * Returns the most recent invoice for that booking (in case of multiple).
 */
export async function getInvoiceByBookingId(bookingId: number): Promise<Invoice | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.bookingId, bookingId))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return rows[0] || null;
}

export async function updateInvoice(id: number, data: Partial<InsertInvoice>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(invoices).set({ ...data, updatedAt: new Date() }).where(eq(invoices.id, id));
  return true;
}

export async function getNextInvoiceSequence(year: number): Promise<number> {
  const db = await getDb();
  if (!db) return 1;
  const prefix = `INV-${year}-`;
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(like(invoices.invoiceNumber, `${prefix}%`));
  return Number(result.count) + 1;
}

// ─── Recurring Expenses ───────────────────────────────────────────────────────

export async function getRecurringExpenses(): Promise<RecurringExpense[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(recurringExpenses).orderBy(desc(recurringExpenses.createdAt));
}

export async function createRecurringExpense(data: InsertRecurringExpense): Promise<RecurringExpense | null> {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(recurringExpenses).values(data);
  const id = (result as any).insertId;
  const [exp] = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id));
  return exp || null;
}

export async function updateRecurringExpense(id: number, data: Partial<InsertRecurringExpense>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(recurringExpenses).set({ ...data, updatedAt: new Date() }).where(eq(recurringExpenses.id, id));
  return true;
}

export async function deleteRecurringExpense(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.delete(recurringExpenses).where(eq(recurringExpenses.id, id));
  return true;
}

export async function updateInvoiceStatus(id: number, status: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(invoices).set({ status: status as any, updatedAt: new Date() }).where(eq(invoices.id, id));
  return (result[0] as any).affectedRows > 0;
}

export async function deleteInvoice(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.delete(invoices).where(eq(invoices.id, id));
  return (result[0] as any).affectedRows > 0;
}

export async function getRecurringExpenseById(id: number): Promise<RecurringExpense | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).limit(1);
  return rows[0] ?? null;
}

// ── v78: AI Quotes ──────────────────────────────────────────────────────────

export async function createAiQuote(data: InsertAiQuote): Promise<AiQuote | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(aiQuotes).values(data);
  const insertId = Number((result[0] as any).insertId);
  const rows = await db.select().from(aiQuotes).where(eq(aiQuotes.id, insertId)).limit(1);
  return rows[0] ?? null;
}

export async function listAiQuotes(params: { status?: string; limit?: number; offset?: number }): Promise<AiQuote[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (params.status) conditions.push(eq(aiQuotes.status, params.status as any));
  const query = db.select().from(aiQuotes);
  const finalQuery = conditions.length > 0
    ? query.where(and(...conditions))
    : query;
  return await finalQuery
    .orderBy(desc(aiQuotes.createdAt))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0);
}

export async function updateAiQuote(id: number, data: Partial<InsertAiQuote>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(aiQuotes).set(data).where(eq(aiQuotes.id, id));
  return (result[0] as any).affectedRows > 0;
}

export async function getAiQuoteById(id: number): Promise<AiQuote | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(aiQuotes).where(eq(aiQuotes.id, id)).limit(1);
  return rows[0] ?? null;
}

