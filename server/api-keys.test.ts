import { describe, it, expect } from 'vitest';
import { invokeLLM } from './_core/llm';

/**
 * API Keys Validation
 * Note: Firecrawl has been removed from this project (replaced by PDF-first approach).
 * The Manus platform uses a proxy API (forge.manus.im) for LLM calls.
 * Direct Anthropic SDK calls are NOT supported (returns 403) - use invokeLLM instead.
 */
describe.skipIf(!process.env.BUILT_IN_FORGE_API_KEY)('API Keys Validation', () => {
  it('should have BUILT_IN_FORGE_API_KEY configured', () => {
    const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
    if (apiKey) {
      expect(typeof apiKey).toBe('string');
      expect(apiKey.length).toBeGreaterThan(10);
    } else {
      console.warn('[api-keys.test] BUILT_IN_FORGE_API_KEY not set in this environment, skipping live check');
    }
  });

  it('should be able to call LLM via Manus Forge API', async () => {
    // Use invokeLLM which routes through forge.manus.im proxy
    const response = await invokeLLM({
      messages: [{ role: 'user', content: 'Say "Hello" in one word.' }],
    });

    expect(response).toBeDefined();
    expect(response.choices).toBeDefined();
    expect(response.choices.length).toBeGreaterThan(0);
    expect(response.choices[0].message.content).toBeTruthy();
  }, 30000);
});
