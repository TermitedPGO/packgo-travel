import { describe, it, expect, vi } from 'vitest';
import * as auth from './auth';
import * as db from './db';

// Mock the email service to prevent real SMTP/SendGrid calls (which cause timeouts in test env)
vi.mock('./emailService', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  sendWelcomeEmail: vi.fn().mockResolvedValue(true),
  sendBookingConfirmationEmail: vi.fn().mockResolvedValue(true),
}));

describe.skipIf(!process.env.DATABASE_URL)('Forgot Password Flow', () => {
  const testPassword = 'TestPassword123!';
  const newPassword = 'NewPassword456!';

  // Helper function to create a unique test user
  async function createTestUser() {
    const testEmail = `test-forgot-pw-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
    const user = await auth.createUser(testEmail, testPassword, 'Test User');
    return { user, testEmail };
  }

  it('should successfully complete the full forgot password flow', async () => {
    const { user, testEmail } = await createTestUser();

    // Step 1: Request password reset
    const response = await auth.requestPasswordReset(testEmail);
    expect(response.success).toBe(true);
    expect(response.message).toBeDefined();

    // Step 2: Verify token was saved to database
    const userAfterRequest = await db.getUserById(user.id);
    expect(userAfterRequest?.resetPasswordToken).toBeDefined();
    expect(userAfterRequest?.resetPasswordExpires).toBeDefined();
    
    // Token should expire in the future
    const expiresAt = new Date(userAfterRequest!.resetPasswordExpires!).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());

    // Get the actual token from database for testing
    const resetToken = userAfterRequest!.resetPasswordToken!;

    // Step 3: Reset password using token
    await auth.resetPassword(resetToken, newPassword);

    // Step 4: Verify token was cleared from database
    const userAfterReset = await db.getUserById(user.id);
    expect(userAfterReset?.resetPasswordToken).toBeNull();
    expect(userAfterReset?.resetPasswordExpires).toBeNull();

    // Step 5: Verify old password no longer works
    try {
      await auth.authenticateUser(testEmail, testPassword);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('電子郵件或密碼錯誤');
    }

    // Step 6: Verify new password works
    const authenticatedUser = await auth.authenticateUser(testEmail, newPassword);
    expect(authenticatedUser).toBeDefined();
    expect(authenticatedUser.email).toBe(testEmail);
  });

  it('should not reveal if email exists (security)', async () => {
    const nonExistentEmail = `nonexistent-${Date.now()}@example.com`;

    // Should return success even for non-existent email (security best practice)
    const response = await auth.requestPasswordReset(nonExistentEmail);
    expect(response.success).toBe(true);
    expect(response.message).toContain('如果該電子郵件已註冊');
  });

  it('should reject password reset with invalid token', async () => {
    const invalidToken = 'invalid-token-12345';

    try {
      await auth.resetPassword(invalidToken, newPassword);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('重設密碼連結無效或已過期');
    }
  });

  it('should reject password reset with expired token', async () => {
    const { user, testEmail } = await createTestUser();

    // Request password reset
    await auth.requestPasswordReset(testEmail);

    // Get token from database
    const userRecord = await db.getUserById(user.id);
    const resetToken = userRecord!.resetPasswordToken!;

    // Manually set token expiration to the past
    await db.setPasswordResetToken(
      user.id,
      resetToken,
      new Date(Date.now() - 1000) // Expired 1 second ago
    );

    // Try to reset password with expired token
    try {
      await auth.resetPassword(resetToken, newPassword);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('重設密碼連結已過期');
    }
  });

  it('should allow multiple password reset requests', async () => {
    const { user, testEmail } = await createTestUser();

    // First request
    const firstResponse = await auth.requestPasswordReset(testEmail);
    expect(firstResponse.success).toBe(true);

    // Get first token from database
    let userRecord = await db.getUserById(user.id);
    const firstToken = userRecord!.resetPasswordToken!;

    // Second request (should replace first token)
    const secondResponse = await auth.requestPasswordReset(testEmail);
    expect(secondResponse.success).toBe(true);

    // Get second token from database
    userRecord = await db.getUserById(user.id);
    const secondToken = userRecord!.resetPasswordToken!;
    expect(secondToken).not.toBe(firstToken);

    // First token should no longer work
    try {
      await auth.resetPassword(firstToken, newPassword);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('重設密碼連結無效或已過期');
    }

    // Second token should work
    await auth.resetPassword(secondToken, newPassword);

    // Verify new password works
    const authenticatedUser = await auth.authenticateUser(testEmail, newPassword);
    expect(authenticatedUser).toBeDefined();
  });

  it('should enforce minimum password length during reset', async () => {
    const { user, testEmail } = await createTestUser();
    await auth.requestPasswordReset(testEmail);

    // Get token from database
    const userRecord = await db.getUserById(user.id);
    const resetToken = userRecord!.resetPasswordToken!;

    const shortPassword = '1234567'; // Only 7 characters

    try {
      await auth.resetPassword(resetToken, shortPassword);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('密碼至少需要 8 個字元');
    }
  });

  it('should not allow reusing the same reset token twice', async () => {
    const { user, testEmail } = await createTestUser();
    await auth.requestPasswordReset(testEmail);

    // Get token from database
    const userRecord = await db.getUserById(user.id);
    const resetToken = userRecord!.resetPasswordToken!;

    // First reset should succeed
    await auth.resetPassword(resetToken, newPassword);

    // Second reset with same token should fail
    try {
      await auth.resetPassword(resetToken, 'AnotherPassword789!');
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('重設密碼連結無效或已過期');
    }
  });
});
