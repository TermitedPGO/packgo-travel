import { describe, it, expect, beforeAll } from 'vitest';
import { appRouter } from './routers';
import * as db from './db';
import { createToken, verifyToken } from './jwt';
import type { User } from '../drizzle/schema';

// Mock context helper
function createMockContext(user: User | null = null) {
  return {
    req: {} as any,
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as any,
    user,
  };
}

describe.skipIf(!process.env.DATABASE_URL)('JWT Authentication System', () => {
  let testUser: User;

  beforeAll(async () => {
    // Get or create test user
    const existingUser = await db.getUserByEmail('jeffhsieh09@gmail.com');
    if (existingUser) {
      testUser = existingUser;
    } else {
      // Create test user if not exists
      await db.createUserWithPassword({
        email: 'jeffhsieh09@gmail.com',
        password: 'test123',
        name: 'Jeff Hsieh',
      });
      const user = await db.getUserByEmail('jeffhsieh09@gmail.com');
      if (!user) throw new Error('Failed to create test user');
      testUser = user;
    }
  });

  describe('JWT Token Creation and Verification', () => {
    it('should create a valid JWT token', () => {
      const token = createToken({
        userId: testUser.id,
        email: testUser.email,
        name: testUser.name || undefined,
        role: testUser.role,
      });

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should verify a valid JWT token', () => {
      const token = createToken({
        userId: testUser.id,
        email: testUser.email,
        name: testUser.name || undefined,
        role: testUser.role,
      });

      const payload = verifyToken(token);

      expect(payload).toBeTruthy();
      expect(payload?.userId).toBe(testUser.id);
      expect(payload?.email).toBe(testUser.email);
      expect(payload?.role).toBe(testUser.role);
    });

    it('should reject an invalid JWT token', () => {
      const invalidToken = 'invalid.token.here';
      const payload = verifyToken(invalidToken);

      expect(payload).toBeNull();
    });

    it('should reject a tampered JWT token', () => {
      const token = createToken({
        userId: testUser.id,
        email: testUser.email,
        name: testUser.name || undefined,
        role: testUser.role,
      });

      // Tamper with the token
      const parts = token.split('.');
      parts[2] = 'tampered';
      const tamperedToken = parts.join('.');

      const payload = verifyToken(tamperedToken);

      expect(payload).toBeNull();
    });
  });

  describe('Context Creation with JWT', () => {
    it('should extract user from valid JWT in context', async () => {
      // Create a fresh user for this test
      const testEmail = `test-context-${Date.now()}@example.com`;
      const contextUser = await db.createUserWithPassword({
        email: testEmail,
        password: 'test123',
        name: 'Test Context User',
      });

      const token = createToken({
        userId: contextUser.id,
        email: contextUser.email,
        name: contextUser.name || undefined,
        role: contextUser.role,
      });

      // Simulate context creation with JWT cookie
      const mockReq = {
        cookies: {
          'app_session_id': token,
        },
      };

      const { createContext } = await import('./_core/context');
      const context = await createContext({
        req: mockReq as any,
        res: {} as any,
      });

      expect(context.user).toBeTruthy();
      expect(context.user?.id).toBe(contextUser.id);
      expect(context.user?.email).toBe(contextUser.email);
    });

    it('should handle missing JWT cookie', async () => {
      const mockReq = {
        cookies: {},
      };

      const { createContext } = await import('./_core/context');
      const context = await createContext({
        req: mockReq as any,
        res: {} as any,
      });

      expect(context.user).toBeNull();
    });

    it('should handle invalid JWT cookie', async () => {
      const mockReq = {
        cookies: {
          'app_session_id': 'invalid.token.here',
        },
      };

      const { createContext } = await import('./_core/context');
      const context = await createContext({
        req: mockReq as any,
        res: {} as any,
      });

      expect(context.user).toBeNull();
    });
  });

  describe('Protected Procedures with JWT', () => {
    it('should allow access to protected procedure with valid user', async () => {
      const caller = appRouter.createCaller(createMockContext(testUser));
      const result = await caller.auth.me();

      expect(result).toBeTruthy();
      expect(result.id).toBe(testUser.id);
      expect(result.email).toBe(testUser.email);
    });

    it('should return null for auth.me without user', async () => {
      const caller = appRouter.createCaller(createMockContext(null));

      const result = await caller.auth.me();
      expect(result).toBeNull();
    });
  });

  describe('Login Flow with JWT', () => {
    it('should create JWT token on successful login with password user', async () => {
      // Create a new user with password for this test
      const testEmail = `test-login-${Date.now()}@example.com`;
      const { createUser } = await import('./auth');
      await createUser(testEmail, 'test123', 'Test Login User');

      let capturedToken: string | undefined;
      const mockRes = {
        cookie: (name: string, value: string) => {
          if (name === 'app_session_id') {
            capturedToken = value;
          }
        },
        clearCookie: () => {},
      };

      const caller = appRouter.createCaller({
        req: {
          headers: {},
          get: () => undefined,
        } as any,
        res: mockRes as any,
        user: null,
      });

      try {
        const result = await caller.auth.login({
          email: testEmail,
          password: 'test123',
        });

        expect(result.success).toBe(true);
        expect(capturedToken).toBeTruthy();

        // Verify the token is valid
        if (capturedToken) {
          const payload = verifyToken(capturedToken);
          expect(payload).toBeTruthy();
          expect(payload?.email).toBe(testEmail);
        }
      } catch (error: any) {
        console.error('Login test error:', error.message);
        throw error;
      }
    });
  });

  describe('Google OAuth Flow with JWT', () => {
    it('should create user with Google ID', async () => {
      const googleId = 'test-google-id-' + Date.now();
      const email = `test-${Date.now()}@example.com`;

      const user = await db.createUserWithGoogle({
        googleId,
        email,
        name: 'Test Google User',
      });

      expect(user).toBeTruthy();
      expect(user.googleId).toBe(googleId);
      expect(user.email).toBe(email);

      // Clean up
      // Note: In production, you might want to add a deleteUser function
    });

    it('should link Google account to existing email account', async () => {
      const email = `test-link-${Date.now()}@example.com`;

      // Create user with password
      const passwordUser = await db.createUserWithPassword({
        email,
        password: 'test123',
        name: 'Test User',
      });

      expect(passwordUser.googleId).toBeNull();

      // Link Google account
      const googleId = 'test-google-id-link-' + Date.now();
      await db.linkGoogleAccount(passwordUser.id, googleId);

      // Verify link
      const linkedUser = await db.getUserByGoogleId(googleId);
      expect(linkedUser).toBeTruthy();
      expect(linkedUser?.id).toBe(passwordUser.id);
      expect(linkedUser?.email).toBe(email);
      expect(linkedUser?.googleId).toBe(googleId);
    });
  });
});
