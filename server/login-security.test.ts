import { describe, it, expect, beforeEach } from 'vitest';
import * as auth from './auth';
import * as db from './db';

describe.skipIf(!process.env.DATABASE_URL)('Login Security Mechanism', () => {
  const testPassword = 'TestPassword123!';
  const wrongPassword = 'WrongPassword123!';

  // Helper function to create a unique test user
  async function createTestUser() {
    const testEmail = `test-security-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
    const user = await auth.createUser(testEmail, testPassword, 'Test Security User');
    return { user, testEmail };
  }

  it('should allow successful login with correct credentials', async () => {
    const { user: createdUser, testEmail } = await createTestUser();
    const user = await auth.authenticateUser(testEmail, testPassword);
    expect(user).toBeDefined();
    expect(user.email).toBe(testEmail);
    expect(user.loginAttempts).toBe(0);
  });

  it('should increment login attempts on failed login', async () => {
    const { user: createdUser, testEmail } = await createTestUser();
    
    try {
      await auth.authenticateUser(testEmail, wrongPassword);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('還剩 4 次嘗試機會');
    }

    // Check that login attempts were incremented
    const user = await db.getUserById(createdUser.id);
    expect(user?.loginAttempts).toBe(1);
  });

  it('should lock account after 5 failed login attempts', async () => {
    const { user: createdUser, testEmail } = await createTestUser();
    
    // Attempt to login 5 times with wrong password
    for (let i = 0; i < 5; i++) {
      try {
        await auth.authenticateUser(testEmail, wrongPassword);
      } catch (error: any) {
        if (i < 4) {
          expect(error.message).toContain('還剩');
        } else {
          expect(error.message).toContain('帳號已被鎖定 15 分鐘');
        }
      }
    }

    // Check that account is locked
    const user = await db.getUserById(createdUser.id);
    expect(user?.lockoutUntil).toBeDefined();
    expect(new Date(user!.lockoutUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it('should prevent login when account is locked', async () => {
    const { user: createdUser, testEmail } = await createTestUser();
    
    // Lock the account
    const lockoutUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
    await db.lockUserAccount(createdUser.id, lockoutUntil);

    // Try to login with correct credentials
    try {
      await auth.authenticateUser(testEmail, testPassword);
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('帳號已被鎖定');
      expect(error.message).toMatch(/請在 \d+ 分鐘後再試/);
    }
  });

  it('should reset login attempts after successful login', async () => {
    const { user: createdUser, testEmail } = await createTestUser();
    
    // Fail once
    try {
      await auth.authenticateUser(testEmail, wrongPassword);
    } catch (error) {
      // Expected
    }

    // Verify attempts were incremented
    let user = await db.getUserById(createdUser.id);
    expect(user?.loginAttempts).toBe(1);

    // Successful login
    await auth.authenticateUser(testEmail, testPassword);

    // Verify attempts were reset
    user = await db.getUserById(createdUser.id);
    expect(user?.loginAttempts).toBe(0);
  });

  it('should show correct remaining attempts in error message', async () => {
    const { user: createdUser, testEmail } = await createTestUser();
    
    const expectedMessages = [
      '還剩 4 次嘗試機會',
      '還剩 3 次嘗試機會',
      '還剩 2 次嘗試機會',
      '還剩 1 次嘗試機會',
      '帳號已被鎖定 15 分鐘',
    ];

    for (let i = 0; i < 5; i++) {
      try {
        await auth.authenticateUser(testEmail, wrongPassword);
        throw new Error('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain(expectedMessages[i]);
      }
    }
  });
});
