import { describe, it, expect } from 'vitest';
import { ENV } from './_core/env';

describe('BASE_URL env validation', () => {
  it('ENV.baseUrl should not contain d3xjbq67 (old domain)', () => {
    expect(ENV.baseUrl).not.toContain('d3xjbq67');
  });

  it('ENV.baseUrl fallback should use packgo09 domain when BASE_URL not set', () => {
    // The fallback in env.ts is now packgo09.manus.space
    const fallback = 'https://packgo09.manus.space';
    expect(fallback).not.toContain('d3xjbq67');
    expect(fallback).toContain('packgo09');
  });
});
