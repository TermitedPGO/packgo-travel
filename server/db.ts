import { eq, and, gte, lte, desc, inArray, like, or, sql } from "drizzle-orm";
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
  userBrowsingHistory, UserBrowsingHistory, InsertUserBrowsingHistory
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

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
// Tour Management Functions
// ============================================

/**
 * Get all tours with optional filtering
 */
export async function getAllTours(filters?: {
  category?: string;
  status?: string;
  featured?: boolean;
  search?: string;
  country?: string;
  minDays?: number;
  maxDays?: number;
  maxPrice?: number;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get tours: database not available");
    return [];
  }

  const conditions = [];

  // Status filter
  if (filters?.status && filters.status !== 'all') {
    conditions.push(eq(tours.status, filters.status as 'active' | 'inactive' | 'soldout'));
  }

  // Featured filter (schema stores as int 0/1)
  if (filters?.featured !== undefined) {
    conditions.push(eq(tours.featured, filters.featured ? 1 : 0));
  }

  // Full-text search (title, destination country, destination city)
  if (filters?.search && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        like(tours.title, searchTerm),
        like(tours.destinationCountry, searchTerm),
        like(tours.destinationCity, searchTerm),
      )
    );
  }

  // Country filter
  if (filters?.country && filters.country !== 'all') {
    conditions.push(eq(tours.destinationCountry, filters.country));
  }

  // Duration range filter
  if (filters?.minDays !== undefined) {
    conditions.push(gte(tours.duration, filters.minDays));
  }
  if (filters?.maxDays !== undefined) {
    conditions.push(lte(tours.duration, filters.maxDays));
  }

  // Max price filter
  if (filters?.maxPrice !== undefined) {
    conditions.push(lte(tours.price, filters.maxPrice));
  }

  const query = db.select().from(tours);
  if (conditions.length > 0) {
    query.where(and(...conditions));
  }
  query.orderBy(desc(tours.createdAt));

  // Pagination
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 100;
  const offset = (page - 1) * pageSize;
  query.limit(pageSize).offset(offset);

  const result = await query;
  return result;
}

/**
 * Get a single tour by ID
 */
export async function getTourById(id: number): Promise<Tour | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get tour: database not available");
    return undefined;
  }

  const result = await db.select().from(tours).where(eq(tours.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new tour
 */
export async function createTour(tour: InsertTour): Promise<Tour> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(tours).values(tour);
  const insertId = Number(result[0].insertId);
  
  const newTour = await getTourById(insertId);
  if (!newTour) {
    throw new Error("Failed to retrieve created tour");
  }
  
  return newTour;
}

/**
 * Update an existing tour
 */
export async function updateTour(id: number, updates: Partial<InsertTour>): Promise<Tour> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(tours).set(updates).where(eq(tours.id, id));
  
  const updatedTour = await getTourById(id);
  if (!updatedTour) {
    throw new Error("Failed to retrieve updated tour");
  }
  
  return updatedTour;
}

/**
 * Delete a tour
 */
export async function deleteTour(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(tours).where(eq(tours.id, id));
}

/**
 * Batch delete multiple tours
 */
export async function batchDeleteTours(ids: number[]): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  if (ids.length === 0) return;

  await db.delete(tours).where(inArray(tours.id, ids));
}

// ============================================
// Tour Departure Management Functions
// ============================================

/**
 * Get all departures for a specific tour
 */
export async function getTourDepartures(tourId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get departures: database not available");
    return [];
  }

  const result = await db.select().from(tourDepartures).where(eq(tourDepartures.tourId, tourId));
  return result;
}

/**
 * Get a single departure by ID
 */
export async function getDepartureById(id: number): Promise<TourDeparture | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get departure: database not available");
    return undefined;
  }

  const result = await db.select().from(tourDepartures).where(eq(tourDepartures.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new departure
 */
export async function createDeparture(departure: InsertTourDeparture): Promise<TourDeparture> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(tourDepartures).values(departure);
  const insertId = Number(result[0].insertId);
  
  const newDeparture = await getDepartureById(insertId);
  if (!newDeparture) {
    throw new Error("Failed to retrieve created departure");
  }
  
  return newDeparture;
}

/**
 * Update an existing departure
 */
export async function updateDeparture(id: number, updates: Partial<InsertTourDeparture>): Promise<TourDeparture> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(tourDepartures).set(updates).where(eq(tourDepartures.id, id));
  
  const updatedDeparture = await getDepartureById(id);
  if (!updatedDeparture) {
    throw new Error("Failed to retrieve updated departure");
  }
  
  return updatedDeparture;
}

/**
 * Delete a departure
 */
export async function deleteDeparture(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.delete(tourDepartures).where(eq(tourDepartures.id, id));
}

// ============================================
// Booking Management Functions
// ============================================

/**
 * Get bookings for a specific user
 */
export async function getUserBookings(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user bookings: database not available");
    return [];
  }

  const result = await db.select().from(bookings).where(eq(bookings.userId, userId));
  return result;
}

/**
 * Get all bookings with optional filtering, joined with tours and departures
 */
export async function getAllBookings(filters?: {
  userId?: number;
  bookingStatus?: string;
  paymentStatus?: string;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get bookings: database not available");
    return [];
  }

  // Use raw SQL to JOIN bookings with tours and departures for full info
  const { sql } = await import('drizzle-orm');
  const result = await db.execute(sql`
    SELECT
      b.*,
      t.title AS tourTitle,
      d.departureDate AS departureDate
    FROM bookings b
    LEFT JOIN tours t ON b.tourId = t.id
    LEFT JOIN tourDepartures d ON b.departureId = d.id
    ${filters?.userId ? sql`WHERE b.userId = ${filters.userId}` : sql``}
    ORDER BY b.createdAt DESC
  `);

  // Normalize field names to match what the frontend expects
  const rows = Array.isArray(result) ? (result[0] as unknown as any[]) : ((result as any).rows ?? []);
  return rows.map((row: any) => ({
    ...row,
    // Alias fields to match frontend expectations
    contactName: row.customerName,
    contactEmail: row.customerEmail,
    totalAmount: row.totalPrice,
    totalPax: (row.numberOfAdults ?? 0) + (row.numberOfChildrenWithBed ?? 0) + (row.numberOfChildrenNoBed ?? 0) + (row.numberOfInfants ?? 0),
    tourTitle: row.tourTitle ?? null,
    departureDate: row.departureDate ?? null,
  }));
}

/**
 * Get a single booking by ID
 */
export async function getBookingById(id: number): Promise<Booking | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get booking: database not available");
    return undefined;
  }

  const result = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new booking
 */
export async function createBooking(booking: InsertBooking): Promise<Booking> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(bookings).values(booking);
  const insertId = Number(result[0].insertId);
  
  const newBooking = await getBookingById(insertId);
  if (!newBooking) {
    throw new Error("Failed to retrieve created booking");
  }
  
  return newBooking;
}

/**
 * Update an existing booking
 */
export async function updateBooking(id: number, updates: Partial<InsertBooking>): Promise<Booking> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.update(bookings).set(updates).where(eq(bookings.id, id));
  
  const updatedBooking = await getBookingById(id);
  if (!updatedBooking) {
    throw new Error("Failed to retrieve updated booking");
  }
  
  return updatedBooking;
}

/**
 * Get all participants for a booking
 */
export async function getBookingParticipants(bookingId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get participants: database not available");
    return [];
  }

  const result = await db.select().from(bookingParticipants).where(eq(bookingParticipants.bookingId, bookingId));
  return result;
}

/**
 * Create a new booking participant
 */
export async function createBookingParticipant(participant: InsertBookingParticipant): Promise<BookingParticipant> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(bookingParticipants).values(participant);
  const insertId = Number(result[0].insertId);
  
  const participants = await db.select().from(bookingParticipants).where(eq(bookingParticipants.id, insertId)).limit(1);
  if (participants.length === 0) {
    throw new Error("Failed to retrieve created participant");
  }
  
  return participants[0];
}

// ============================================
// Payment Management Functions
// ============================================

/**
 * Get all payments for a booking
 */
export async function getBookingPayments(bookingId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get payments: database not available");
    return [];
  }

  const result = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
  return result;
}

/**
 * Create a new payment record
 */
export async function createPayment(payment: InsertPayment): Promise<Payment> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const result = await db.insert(payments).values(payment);
  const insertId = Number(result[0].insertId);
  
  const paymentRecords = await db.select().from(payments).where(eq(payments.id, insertId)).limit(1);
  if (paymentRecords.length === 0) {
    throw new Error("Failed to retrieve created payment");
  }
  
  return paymentRecords[0];
}

/**
 * Update payment status by Stripe Payment Intent ID
 */
export async function updatePaymentStatus(stripePaymentIntentId: string, status: string, paidAt?: Date): Promise<Payment> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const updates: any = { paymentStatus: status };
  if (paidAt) {
    updates.paidAt = paidAt;
  }

  await db.update(payments).set(updates).where(eq(payments.stripePaymentIntentId, stripePaymentIntentId));
  
  const paymentRecords = await db.select().from(payments).where(eq(payments.stripePaymentIntentId, stripePaymentIntentId)).limit(1);
  if (paymentRecords.length === 0) {
    throw new Error("Failed to retrieve updated payment");
  }
  
  return paymentRecords[0];
}

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


// Search tours with filters
export async function searchTours(filters: {
  destination?: string;
  category?: string;
  minDays?: number;
  maxDays?: number;
  minPrice?: number;
  maxPrice?: number;
  airlines?: string[];
  hotelGrades?: string[];
  specialActivities?: string[];
  tags?: string[];
  sortBy?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tours: Tour[]; total: number }> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Build filter conditions
  const conditions = [eq(tours.status, "active")];

  if (filters.category && filters.category !== 'all') {
    conditions.push(eq(tours.category, filters.category as 'group' | 'custom' | 'package' | 'cruise' | 'theme'));
  }

  if (filters.destination) {
    // 使用模糊匹配，支援在 destination, destinationCountry, destinationCity 中搜尋
    const searchPattern = `%${filters.destination}%`;
    const destinationCondition = or(
      like(tours.destination, searchPattern),
      like(tours.destinationCountry, searchPattern),
      like(tours.destinationCity, searchPattern),
      like(tours.title, searchPattern)
    );
    if (destinationCondition) {
      conditions.push(destinationCondition);
    }
  }

  if (filters.minDays !== undefined) {
    conditions.push(gte(tours.duration, filters.minDays));
  }

  if (filters.maxDays !== undefined) {
    conditions.push(lte(tours.duration, filters.maxDays));
  }

  if (filters.minPrice !== undefined) {
    conditions.push(gte(tours.price, filters.minPrice));
  }

  if (filters.maxPrice !== undefined) {
    conditions.push(lte(tours.price, filters.maxPrice));
  }

  if (filters.airlines && filters.airlines.length > 0) {
    conditions.push(inArray(tours.airline, filters.airlines));
  }

  if (filters.hotelGrades && filters.hotelGrades.length > 0) {
    conditions.push(inArray(tours.hotelGrade, filters.hotelGrades));
  }

  const whereClause = and(...conditions);

  // Note: specialActivities and tags are JSON fields — must filter in-memory.
  // If these filters are active, we cannot use DB-level pagination directly;
  // we fall back to fetching all matching rows and paginating in memory.
  const needsInMemoryFilter =
    (filters.specialActivities && filters.specialActivities.length > 0) ||
    (filters.tags && filters.tags.length > 0);

  if (needsInMemoryFilter) {
    // Fetch all rows matching DB-level conditions, then filter in memory
    let query = db.select().from(tours).where(whereClause).$dynamic();

    let results: Tour[];
    if (filters.sortBy === "price_asc") {
      results = await query.orderBy(tours.price);
    } else if (filters.sortBy === "price_desc") {
      results = await query.orderBy(desc(tours.price));
    } else if (filters.sortBy === "days_asc") {
      results = await query.orderBy(tours.duration);
    } else if (filters.sortBy === "days_desc") {
      results = await query.orderBy(desc(tours.duration));
    } else {
      results = await query.orderBy(desc(tours.featured), desc(tours.createdAt));
    }

    // In-memory filter for specialActivities
    if (filters.specialActivities && filters.specialActivities.length > 0) {
      results = results.filter(tour => {
        if (!tour.specialActivities) return false;
        try {
          const activities = JSON.parse(tour.specialActivities);
          if (!Array.isArray(activities)) return false;
          return filters.specialActivities!.some(activity => activities.includes(activity));
        } catch {
          return false;
        }
      });
    }

    // In-memory filter for tags
    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(tour => {
        if (!tour.tags) return false;
        try {
          const tourTags = typeof tour.tags === 'string' ? JSON.parse(tour.tags) : tour.tags;
          if (!Array.isArray(tourTags)) return false;
          return filters.tags!.some(tag => tourTags.includes(tag));
        } catch {
          return false;
        }
      });
    }

    const total = results.length;
    const limit = filters.limit ?? 12;
    const offset = filters.offset ?? 0;
    return { tours: results.slice(offset, offset + limit), total };
  }

  // --- Fast path: pure DB-level pagination (no JSON field filters) ---
  // Run count query and data query in parallel
  const [countResult, dataResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(tours).where(whereClause),
    (() => {
      let q = db.select().from(tours).where(whereClause).$dynamic();
      if (filters.sortBy === "price_asc") {
        q = q.orderBy(tours.price);
      } else if (filters.sortBy === "price_desc") {
        q = q.orderBy(desc(tours.price));
      } else if (filters.sortBy === "days_asc") {
        q = q.orderBy(tours.duration);
      } else if (filters.sortBy === "days_desc") {
        q = q.orderBy(desc(tours.duration));
      } else {
        q = q.orderBy(desc(tours.featured), desc(tours.createdAt));
      }
      const limit = filters.limit ?? 12;
      const offset = filters.offset ?? 0;
      return q.limit(limit).offset(offset);
    })()
  ]);

  const total = Number(countResult[0]?.count ?? 0);
  return { tours: dataResult, total };
}


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

// ============================================
// Filter Options Functions (Smart Filters)
// ============================================

/**
 * 獲取智能篩選選項 - 根據現有行程自動生成
 */
export async function getFilterOptions(): Promise<{
  destinations: { country: string; count: number }[];
  tags: { tag: string; count: number }[];
  smartTags: {
    duration: { label: string; count: number }[];
    price: { label: string; count: number }[];
    transport: { label: string; count: number }[];
    feature: { label: string; count: number }[];
  };
  durationRange: { min: number; max: number };
  priceRange: { min: number; max: number };
}> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // 獲取所有有效行程
  const allTours = await db
    .select()
    .from(tours)
    .where(eq(tours.status, "active"));

  // 1. 統計目的地國家
  const destinationMap = new Map<string, number>();
  allTours.forEach(tour => {
    const country = tour.destinationCountry || tour.destination;
    if (country) {
      destinationMap.set(country, (destinationMap.get(country) || 0) + 1);
    }
  });
  const destinations = Array.from(destinationMap.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  // 2. 統計標籤
  const tagMap = new Map<string, number>();
  allTours.forEach(tour => {
    if (tour.tags) {
      try {
        const parsedTags = typeof tour.tags === 'string' ? JSON.parse(tour.tags) : tour.tags;
        if (Array.isArray(parsedTags)) {
          parsedTags.forEach((tag: string) => {
            tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
          });
        }
      } catch {
        // 忽略解析錯誤
      }
    }
  });
  const tags = Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  // 3. 計算天數範圍
  const durations = allTours.map(t => t.duration).filter(d => d && d > 0);
  const durationRange = {
    min: durations.length > 0 ? Math.min(...durations) : 1,
    max: durations.length > 0 ? Math.max(...durations) : 30,
  };

  // 4. 計算價格範圍
  const prices = allTours.map(t => t.price).filter(p => p && p > 0);
  const priceRange = {
    min: prices.length > 0 ? Math.min(...prices) : 0,
    max: prices.length > 0 ? Math.max(...prices) : 500000,
  };

  // 5. 智能標籤分類
  const smartTags = {
    duration: [] as { label: string; count: number }[],
    price: [] as { label: string; count: number }[],
    transport: [] as { label: string; count: number }[],
    feature: [] as { label: string; count: number }[],
  };

  // 天數分類
  const durationCounts = { "深度旅遊": 0, "經典行程": 0, "輕旅行": 0, "一般行程": 0 };
  allTours.forEach(tour => {
    if (tour.duration >= 10) durationCounts["深度旅遊"]++;
    else if (tour.duration >= 7) durationCounts["經典行程"]++;
    else if (tour.duration <= 4) durationCounts["輕旅行"]++;
    else durationCounts["一般行程"]++;
  });
  Object.entries(durationCounts).forEach(([label, count]) => {
    if (count > 0) smartTags.duration.push({ label, count });
  });

  // 價格分類
  const priceCounts = { "精緻行程": 0, "超值優惠": 0 };
  allTours.forEach(tour => {
    if (tour.price && tour.price >= 80000) priceCounts["精緻行程"]++;
    else if (tour.price && tour.price < 30000) priceCounts["超值優惠"]++;
  });
  Object.entries(priceCounts).forEach(([label, count]) => {
    if (count > 0) smartTags.price.push({ label, count });
  });

  // 交通方式分類
  const transportCounts = { "航空": 0, "鐵道": 0, "郵輪": 0, "巴士": 0 };
  allTours.forEach(tour => {
    const combinedText = `${tour.title || ''} ${tour.description || ''} ${tour.category || ''}`.toLowerCase();
    if (tour.outboundAirline || combinedText.includes('航空') || combinedText.includes('飛機')) transportCounts["航空"]++;
    if (combinedText.includes('高鐵') || combinedText.includes('火車') || combinedText.includes('列車')) transportCounts["鐵道"]++;
    if (tour.category === 'cruise' || combinedText.includes('郵輪') || combinedText.includes('遊輪')) transportCounts["郵輪"]++;
    if (combinedText.includes('巴士') || combinedText.includes('遊覽車')) transportCounts["巴士"]++;
  });
  Object.entries(transportCounts).forEach(([label, count]) => {
    if (count > 0) smartTags.transport.push({ label, count });
  });

  // 特色活動分類
  const featureCounts = { "美食之旅": 0, "攝影之旅": 0, "團體旅遊": 0, "永續旅遊": 0, "溫泉": 0 };
  allTours.forEach(tour => {
    const combinedText = `${tour.title || ''} ${tour.description || ''}`.toLowerCase();
    if (combinedText.includes('美食') || combinedText.includes('料理') || combinedText.includes('餐廳')) featureCounts["美食之旅"]++;
    if (combinedText.includes('攝影') || combinedText.includes('拍照') || combinedText.includes('打卡')) featureCounts["攝影之旅"]++;
    if (tour.category === 'group' || combinedText.includes('團體')) featureCounts["團體旅遊"]++;
    if (combinedText.includes('esg') || combinedText.includes('永續')) featureCounts["永續旅遊"]++;
    if (combinedText.includes('溫泉')) featureCounts["溫泉"]++;
  });
  Object.entries(featureCounts).forEach(([label, count]) => {
    if (count > 0) smartTags.feature.push({ label, count });
  });

  return {
    destinations,
    tags,
    smartTags,
    durationRange,
    priceRange,
  };
}


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

// Get distinct departure cities from active tours (for search autocomplete)
export async function getDepartureCities(): Promise<{ city: string; country: string; count: number }[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const activeTours = await db
    .select({
      departureCity: tours.departureCity,
      departureCountry: tours.departureCountry,
    })
    .from(tours)
    .where(eq(tours.status, "active"));

  // Count occurrences per city
  const cityMap = new Map<string, { city: string; country: string; count: number }>();
  for (const tour of activeTours) {
    const city = (tour.departureCity || "").trim();
    const country = (tour.departureCountry || "").trim();
    // Skip empty, "NULL" string, or whitespace-only values
    if (!city || city.toUpperCase() === "NULL") continue;
    const key = `${city}|${country}`;
    if (cityMap.has(key)) {
      cityMap.get(key)!.count++;
    } else {
      cityMap.set(key, { city, country, count: 1 });
    }
  }

  return Array.from(cityMap.values()).sort((a, b) => b.count - a.count);
}
