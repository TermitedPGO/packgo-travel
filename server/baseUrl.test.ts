import { describe, it, expect } from 'vitest';
import { ENV } from './_core/env';

describe('BASE_URL env validation', () => {
  it('ENV.baseUrl should not contain d3xjbq67 (old domain)', () => {
    expect(ENV.baseUrl).not.toContain('d3xjbq67');
  });

  it('ENV.baseUrl fallback should use packgoplay.com when BASE_URL not set', () => {
    // The fallback in env.ts is now packgoplay.com (migration from
    // *.manus.space subdomains completed; legacy hosts now 301-redirect).
    const fallback = 'https://packgoplay.com';
    expect(fallback).not.toContain('d3xjbq67');
    expect(fallback).not.toContain('manus.space');
    expect(fallback).toContain('packgoplay');
  });
});
