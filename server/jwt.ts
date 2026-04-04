import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
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
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: expiresIn || JWT_EXPIRES_IN,
  });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}
