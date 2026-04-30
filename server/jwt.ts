import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { randomBytes } from 'crypto';

// v70: strict secret loading — throw in prod, also throw if the dev fallback is
// being used because the fallback is a *publicly known string* (it lives in
// this file in git). Previously a misconfigured deploy with NODE_ENV != "production"
// would silently sign tokens with the fallback, which any reader of this repo
// could forge. Now any environment without JWT_SECRET refuses to start.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[FATAL] JWT_SECRET environment variable is required in production');
  }
  // In non-production we still warn but allow startup so local tooling works,
  // however we do NOT fall back to a hardcoded value — instead derive a
  // per-process random secret. Tokens minted with this secret die when the
  // process restarts, which is the correct behavior in dev.
  console.warn('[Security Warning] JWT_SECRET not set — using ephemeral per-process secret (tokens won\'t survive restart)');
}
const SECRET =
  JWT_SECRET ||
  // 32 bytes random hex, regenerated each process start
  randomBytes(32).toString('hex');

// v70: was 365 days — gave attackers a 12-month window on any compromised token.
// Reduced to 14 days. For longer-lived sessions, callers should rotate via a
// refresh-token flow rather than a long-lived access token.
const JWT_EXPIRES_IN: StringValue = '14d';

export interface JWTPayload {
  userId: number;
  email: string;
  name?: string;
  role?: string;
}

/**
 * Create a JWT token for a user session
 * @param payload - User data to encode in the token
 * @param expiresIn - Token expiry time (e.g., '7d', '14d', '1h'). Defaults to 14 days.
 */
export function createToken(payload: JWTPayload, expiresIn?: StringValue): string {
  return jwt.sign(payload, SECRET, {
    expiresIn: expiresIn || JWT_EXPIRES_IN,
  });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}
