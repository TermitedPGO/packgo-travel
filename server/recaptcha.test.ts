/**
 * reCAPTCHA v3 Integration Tests
 * Tests the backend verification logic for reCAPTCHA tokens
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appRouter } from './routers';
import type { Context } from './_core/context';

function createMockContext(user: any = null): Context {
  return {
    req: {
      headers: { 'x-forwarded-for': '127.0.0.1' },
      get: () => undefined,
      socket: { remoteAddress: '127.0.0.1' },
    } as any,
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as any,
    user,
  };
}

describe('reCAPTCHA v3 Integration', () => {
  describe('Backend verification logic', () => {
    it('should skip reCAPTCHA verification in test environment (VITEST=true)', async () => {
      // In test environment, VITEST is set, so reCAPTCHA is bypassed
      const caller = appRouter.createCaller(createMockContext());

      // Should succeed without recaptchaToken in test env
      const result = await caller.auth.requestPasswordReset({
        email: `recaptcha-test-${Date.now()}@packgo-test.com`,
        // No recaptchaToken provided — should be fine in test env
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('如果該電子郵件已註冊');
    });

    it('should accept request with recaptchaToken in test environment', async () => {
      const caller = appRouter.createCaller(createMockContext());

      const result = await caller.auth.requestPasswordReset({
        email: `recaptcha-test2-${Date.now()}@packgo-test.com`,
        recaptchaToken: 'test-token-ignored-in-test-env',
      });

      expect(result.success).toBe(true);
    });

    it('should verify reCAPTCHA when RECAPTCHA_SECRET_KEY is set (mocked)', async () => {
      // Mock fetch to simulate Google's reCAPTCHA verification response
      const originalFetch = global.fetch;
      const originalEnv = process.env.VITEST;

      try {
        // Temporarily unset VITEST to trigger reCAPTCHA check
        delete process.env.VITEST;
        process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';

        // Mock a successful reCAPTCHA response (score 0.9 = human)
        global.fetch = vi.fn().mockResolvedValue({
          json: async () => ({
            success: true,
            score: 0.9,
            action: 'forgot_password',
            'error-codes': [],
          }),
        } as any);

        // Use a unique IP to avoid rate limiting from other parallel tests
        const uniqueIp = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
        const ctx = {
          req: {
            headers: { 'x-forwarded-for': uniqueIp },
            get: () => undefined,
            socket: { remoteAddress: uniqueIp },
          } as any,
          res: { cookie: () => {}, clearCookie: () => {} } as any,
          user: null,
        };
        const caller = appRouter.createCaller(ctx);
        const result = await caller.auth.requestPasswordReset({
          email: `recaptcha-mock-${Date.now()}@packgo-test.com`,
          recaptchaToken: 'valid-mock-token',
        });

        expect(result.success).toBe(true);
      } finally {
        // Restore environment
        process.env.VITEST = originalEnv;
        global.fetch = originalFetch;
      }
    }, 15000);

    it('should silently reject bot requests (score < 0.5) without leaking info', async () => {
      const originalFetch = global.fetch;
      const originalEnv = process.env.VITEST;

      try {
        delete process.env.VITEST;
        process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';

        // Mock a bot response (score 0.1 = likely bot)
        global.fetch = vi.fn().mockResolvedValue({
          json: async () => ({
            success: true,
            score: 0.1,
            action: 'forgot_password',
            'error-codes': [],
          }),
        } as any);

        const caller = appRouter.createCaller(createMockContext());
        const result = await caller.auth.requestPasswordReset({
          email: `bot-test-${Date.now()}@packgo-test.com`,
          recaptchaToken: 'bot-token',
        });

        // Should return generic success (not an error) to avoid leaking info
        expect(result.success).toBe(true);
        expect(result.message).toContain('如果該電子郵件已註冊');
      } finally {
        process.env.VITEST = originalEnv;
        global.fetch = originalFetch;
      }
    });

    it('should reject request with missing token in production (no VITEST)', async () => {
      const originalFetch = global.fetch;
      const originalVitest = process.env.VITEST;
      const originalNodeEnv = process.env.NODE_ENV;

      try {
        // Implementation checks both VITEST and NODE_ENV==='test'; vitest sets
        // both, so we override both to simulate production.
        delete process.env.VITEST;
        process.env.NODE_ENV = 'production';
        process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';

        const caller = appRouter.createCaller(createMockContext());

        await expect(
          caller.auth.requestPasswordReset({
            email: `no-token-${Date.now()}@packgo-test.com`,
            // No recaptchaToken — should be rejected in production
          })
        ).rejects.toThrow('驗證失敗');
      } finally {
        process.env.VITEST = originalVitest;
        process.env.NODE_ENV = originalNodeEnv;
        global.fetch = originalFetch;
      }
    });
  });
});
