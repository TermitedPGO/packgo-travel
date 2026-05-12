import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as db from './db';
import { sendPasswordResetEmail } from './emailService';
import { redactEmail } from './_core/redact';

const SALT_ROUNDS = 10;

/**
 * Create a new user with email and password
 */
export async function createUser(email: string, password: string, name?: string) {
  // Check if user already exists
  const existingUser = await db.getUserByEmail(email);
  if (existingUser) {
    throw new Error('此電子郵件已被註冊');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const user = await db.createUserWithPassword({
    email,
    password: hashedPassword,
    name: name || email.split('@')[0],
  });

  return user;
}

// Login security constants
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Authenticate user with email and password
 * Implements login attempt tracking and account lockout
 */
export async function authenticateUser(email: string, password: string) {
  const user = await db.getUserByEmail(email);
  
  if (!user) {
    throw new Error('電子郵件或密碼錯誤');
  }

  // Check if account is locked
  if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
    const remainingMinutes = Math.ceil((new Date(user.lockoutUntil).getTime() - Date.now()) / 60000);
    throw new Error(`帳號已被鎖定，請在 ${remainingMinutes} 分鐘後再試`);
  }

  if (!user.password) {
    throw new Error('此帳號使用第三方登入，請使用 Google 登入');
  }

  const isValidPassword = await bcrypt.compare(password, user.password);
  
  if (!isValidPassword) {
    // Increment login attempts
    const newAttempts = (user.loginAttempts || 0) + 1;
    
    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      // Lock account for 15 minutes
      const lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      await db.lockUserAccount(user.id, lockoutUntil);
      throw new Error(`登入失敗次數過多，帳號已被鎖定 15 分鐘`);
    } else {
      // Update login attempts
      await db.incrementLoginAttempts(user.id, newAttempts);
      const remainingAttempts = MAX_LOGIN_ATTEMPTS - newAttempts;
      throw new Error(`電子郵件或密碼錯誤（還剩 ${remainingAttempts} 次嘗試機會）`);
    }
  }

  // Reset login attempts on successful login
  if (user.loginAttempts && user.loginAttempts > 0) {
    await db.resetLoginAttempts(user.id);
  }

  return user;
}

/**
 * Request password reset - generates token and stores it
 */
export async function requestPasswordReset(email: string) {
  const user = await db.getUserByEmail(email);
  
  if (!user) {
    // Don't reveal if user exists for security
    return { success: true, message: '如果該電子郵件已註冊，您將收到重設密碼的連結' };
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenExpires = new Date(Date.now() + 3600000); // 1 hour from now

  // Store token in database
  await db.setPasswordResetToken(user.id, resetToken, resetTokenExpires);

  // Send password reset email
  try {
    const emailSent = await sendPasswordResetEmail(email, resetToken, user.name || undefined);
    if (emailSent) {
      console.log('[Auth] Password reset email sent successfully to:', redactEmail(email));
    } else {
      console.error('[Auth] Failed to send password reset email to:', email);
    }
  } catch (error) {
    console.error('[Auth] Error sending password reset email:', error);
  }

  // In test environment, return the token for testing purposes
  // In production, the token is only sent via email
  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST;
  
  return { 
    success: true, 
    message: '如果該電子郵件已註冊，您將收到重設密碼的連結',
    ...(isTestEnv && user ? { token: resetToken } : {})
  };
}

/**
 * Reset password with token
 */
export async function resetPassword(token: string, newPassword: string) {
  // Validate password length
  if (newPassword.length < 8) {
    throw new Error('密碼至少需要 8 個字元');
  }

  const user = await db.getUserByResetToken(token);
  
  if (!user) {
    throw new Error('重設密碼連結無效或已過期');
  }

  // Check if token has expired
  if (user.resetPasswordExpires && user.resetPasswordExpires < new Date()) {
    throw new Error('重設密碼連結已過期');
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Update password and clear reset token
  await db.updatePassword(user.id, hashedPassword);
  await db.clearPasswordResetToken(user.id);

  return { success: true };
}

/**
 * Create or get user from Google OAuth
 */
export async function createOrGetGoogleUser(googleId: string, email: string, name: string) {
  // Check if user exists with this Google ID
  let user = await db.getUserByGoogleId(googleId);
  
  if (user) {
    return user;
  }

  // Check if user exists with this email
  user = await db.getUserByEmail(email);
  
  if (user) {
    // Link Google account to existing user
    const updatedUser = await db.linkGoogleAccount(user.id, googleId);
    return updatedUser || user;
  }

  // Create new user
  user = await db.createUserWithGoogle({
    googleId,
    email,
    name,
  });

  return user;
}
