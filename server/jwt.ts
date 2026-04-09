import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[FATAL] JWT_SECRET environment variable is required in production');
  }
  console.warn('[Security Warning] JWT_SECRET not set — using development fallback');
}
const SECRET = JWT_SECRET || 'dev-only-secret-not-for-production';

const JWT_EXPIRES_IN = '365d'; // 1 year

export interface JWTPayload {
  userId: number;
  email: string;
  name?: string;
  role?: string;
}

/**
 * Create a JWT token for a user session
 * @param payload - User data to encode in the token
 * @param expiresIn - Token expiry time (e.g., '7d', '30d', '1h'). Defaults to 365 days.
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
