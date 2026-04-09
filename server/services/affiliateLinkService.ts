/**
 * Trip.com Affiliate Link Service
 * Generates affiliate links with correct allianceId, SID, and deepLink IDs.
 * Also handles click tracking persistence.
 */

import { createAffiliateClick } from "../db";

const TRIP_COM_CONFIG = {
  allianceId: "7896974",
  sid: "296102808",
  deepLinks: {
    flights: "D13390057",
    hotels: "D15196722",
    homepage: "D13390050",
  },
} as const;

const BASE_URL = "https://www.trip.com/t";

/**
 * Generate a Trip.com flight search affiliate link.
 */
export function generateFlightLink(params?: {
  origin?: string;
  destination?: string;
  departDate?: string;
  returnDate?: string;
  ouid?: string;
}): string {
  const deepLinkId = TRIP_COM_CONFIG.deepLinks.flights;
  const url = new URL(`${BASE_URL}/${deepLinkId}`);
  url.searchParams.set("allianceId", TRIP_COM_CONFIG.allianceId);
  url.searchParams.set("sid", TRIP_COM_CONFIG.sid);

  if (params?.ouid) url.searchParams.set("ouid", params.ouid);
  if (params?.origin) url.searchParams.set("dcity", params.origin);
  if (params?.destination) url.searchParams.set("acity", params.destination);
  if (params?.departDate) url.searchParams.set("ddate", params.departDate);
  if (params?.returnDate) url.searchParams.set("rdate", params.returnDate);

  return url.toString();
}

/**
 * Generate a Trip.com hotel search affiliate link.
 */
export function generateHotelLink(params?: {
  city?: string;
  checkIn?: string;
  checkOut?: string;
  ouid?: string;
}): string {
  const deepLinkId = TRIP_COM_CONFIG.deepLinks.hotels;
  const url = new URL(`${BASE_URL}/${deepLinkId}`);
  url.searchParams.set("allianceId", TRIP_COM_CONFIG.allianceId);
  url.searchParams.set("sid", TRIP_COM_CONFIG.sid);

  if (params?.ouid) url.searchParams.set("ouid", params.ouid);
  if (params?.city) url.searchParams.set("city", params.city);
  if (params?.checkIn) url.searchParams.set("checkin", params.checkIn);
  if (params?.checkOut) url.searchParams.set("checkout", params.checkOut);

  return url.toString();
}

/**
 * Generate a Trip.com homepage affiliate link.
 */
export function generateHomepageLink(ouid?: string): string {
  const deepLinkId = TRIP_COM_CONFIG.deepLinks.homepage;
  const url = new URL(`${BASE_URL}/${deepLinkId}`);
  url.searchParams.set("allianceId", TRIP_COM_CONFIG.allianceId);
  url.searchParams.set("sid", TRIP_COM_CONFIG.sid);

  if (ouid) url.searchParams.set("ouid", ouid);

  return url.toString();
}

/**
 * Track an affiliate click by persisting it to the database.
 */
export async function trackAffiliateClick(data: {
  userId?: number;
  platform: "trip_flights" | "trip_hotels" | "trip_homepage";
  targetUrl: string;
  referrerPage?: string;
  tourId?: number;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await createAffiliateClick({
      userId: data.userId ?? null,
      platform: data.platform,
      targetUrl: data.targetUrl,
      referrerPage: data.referrerPage ?? null,
      tourId: data.tourId ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    });
  } catch (err) {
    // Non-critical: log but don't throw
    console.error("[AffiliateClick] Failed to track click:", err);
  }
}

export { TRIP_COM_CONFIG };
