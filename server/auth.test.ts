import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as auth from './auth';
import * as db from './db';

describe.skipIf(!process.env.DATABASE_URL)('Authentication System', () => {
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  const testName = 'Test User';
  let createdUserId: number;

  afterAll(async () => {
    // Cleanup: delete test user
    if (createdUserId) {
      try {
        await db.deleteUser(createdUserId);
      } catch (error) {
        console.log('Cleanup: User already deleted or not found');
      }
    }
  });

  describe('Email/Password Registration', () => {
    it('should create a new user with email and password', async () => {
      const user = await auth.createUser(testEmail, testPassword, testName);
      
      expect(user).toBeDefined();
      expect(user.email).toBe(testEmail);
      expect(user.name).toBe(testName);
      expect(user.password).toBeDefined(); // Password should be hashed
      expect(user.password).not.toBe(testPassword); // Should not store plain password
      
      createdUserId = user.id;
    });

    it('should not allow duplicate email registration', async () => {
      await expect(
        auth.createUser(testEmail, testPassword, testName)
      ).rejects.toThrow('此電子郵件已被註冊');
    });
  });

  describe('Email/Password Login', () => {
    it('should authenticate user with correct credentials', async () => {
      const user = await auth.authenticateUser(testEmail, testPassword);
      
      expect(user).toBeDefined();
      expect(user.email).toBe(testEmail);
    });

    it('should reject authentication with wrong password', async () => {
      await expect(
        auth.authenticateUser(testEmail, 'WrongPassword123!')
      ).rejects.toThrow('電子郵件或密碼錯誤');
    });

    it('should reject authentication with non-existent email', async () => {
      await expect(
        auth.authenticateUser('nonexistent@example.com', testPassword)
      ).rejects.toThrow('電子郵件或密碼錯誤');
    });
  });

  describe('Password Reset', () => {
    it('should generate password reset token', async () => {
      const result = await auth.requestPasswordReset(testEmail);
      
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
    });

    it('should reset password with valid token', async () => {
      // Request reset token
      const { token } = await auth.requestPasswordReset(testEmail);
      
      // Reset password
      const newPassword = 'NewPassword123!';
      const result = await auth.resetPassword(token!, newPassword);
      
      expect(result.success).toBe(true);
      
      // Verify new password works
      const user = await auth.authenticateUser(testEmail, newPassword);
      expect(user).toBeDefined();
    });

    it('should reject password reset with invalid token', async () => {
      await expect(
        auth.resetPassword('invalid-token-12345', 'NewPassword123!')
      ).rejects.toThrow('重設密碼連結無效或已過期');
    });
  });

  describe('Google OAuth', () => {
    const googleId = `google-${Date.now()}`;
    const googleEmail = `google-${Date.now()}@example.com`;
    const googleName = 'Google User';
    let googleUserId: number;

    afterAll(async () => {
      // Cleanup: delete Google test user
      if (googleUserId) {
        try {
          await db.deleteUser(googleUserId);
        } catch (error) {
          console.log('Cleanup: Google user already deleted or not found');
        }
      }
    });

    it('should create new user from Google OAuth', async () => {
      const user = await auth.createOrGetGoogleUser(googleId, googleEmail, googleName);
      
      expect(user).toBeDefined();
      expect(user.email).toBe(googleEmail);
      expect(user.googleId).toBe(googleId);
      expect(user.name).toBe(googleName);
      
      googleUserId = user.id;
    });

    it('should return existing user on subsequent Google logins', async () => {
      const user = await auth.createOrGetGoogleUser(googleId, googleEmail, googleName);
      
      expect(user.id).toBe(googleUserId);
      expect(user.email).toBe(googleEmail);
    });

    it('should link Google account to existing email user', async () => {
      // Create a user with email/password
      const linkTestEmail = `link-test-${Date.now()}@example.com`;
      const emailUser = await auth.createUser(linkTestEmail, testPassword, 'Link Test');
      
      // Try to login with Google using same email
      const newGoogleId = `google-link-${Date.now()}`;
      const linkedUser = await auth.createOrGetGoogleUser(newGoogleId, linkTestEmail, 'Link Test');
      
      // Should return the same user with Google ID linked
      expect(linkedUser.id).toBe(emailUser.id);
      expect(linkedUser.googleId).toBe(newGoogleId);
      expect(linkedUser.email).toBe(linkTestEmail);
      
      // Cleanup
      await db.deleteUser(emailUser.id);
    });
  });
});
