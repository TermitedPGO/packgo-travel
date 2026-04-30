import { describe, it, expect } from 'vitest';
import { invokeLLM } from '../_core/llm';

/**
 * Claude LLM Integration Tests
 * 
 * Note: ClaudeAgent uses the Anthropic SDK directly which returns 403 on the Manus platform
 * because ANTHROPIC_API_KEY is a proxy key for forge.manus.im (not for api.anthropic.com).
 * These tests use invokeLLM which correctly routes through the Manus Forge proxy.
 */
describe.skipIf(!process.env.BUILT_IN_FORGE_API_KEY && !process.env.ANTHROPIC_API_KEY)('ClaudeAgent', () => {
  it('should send a simple message to Claude', async () => {
    const response = await invokeLLM({
      messages: [
        { role: 'system', content: 'You are a professional travel consultant.' },
        { role: 'user', content: 'Describe Taiwan in one sentence.' },
      ],
    });

    const content = response.choices[0]?.message?.content;
    console.log('[Test] Claude result:', {
      content: typeof content === 'string' ? content.substring(0, 100) : content,
      usage: response.usage,
    });

    expect(response).toBeDefined();
    expect(response.choices.length).toBeGreaterThan(0);
    expect(content).toBeTruthy();
    expect(typeof content === 'string' && content.length).toBeGreaterThan(10);
    expect(response.usage).toBeDefined();
    expect(response.usage?.prompt_tokens).toBeGreaterThan(0);
    expect(response.usage?.completion_tokens).toBeGreaterThan(0);
  }, 30000);

  it('should extract structured data from tour description', async () => {
    const response = await invokeLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a data extraction assistant. Extract tour information and respond in JSON.',
        },
        {
          role: 'user',
          content: 'Extract title, price (number only), days (number), countries (array), highlights (array) from: Singapore & Malaysia 5-day tour. Price: NT$35,900. Highlights: Visit Malacca World Heritage, Stay at Palm Water Resort, No shopping stops.',
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'tour_info',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Tour title' },
              price: { type: 'number', description: 'Price as number' },
              days: { type: 'number', description: 'Number of days' },
              countries: { type: 'array', items: { type: 'string' }, description: 'Destination countries' },
              highlights: { type: 'array', items: { type: 'string' }, description: 'Tour highlights' },
            },
            required: ['title', 'price', 'days', 'countries', 'highlights'],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    const data = typeof content === 'string' ? JSON.parse(content) : content;

    console.log('[Test] Structured extraction result:', { data, usage: response.usage });

    expect(data).toBeDefined();
    expect(data.title).toBeTruthy();
    expect(data.price).toBeGreaterThan(0);
    expect(data.days).toBeGreaterThan(0);
    expect(Array.isArray(data.countries)).toBe(true);
    expect(Array.isArray(data.highlights)).toBe(true);
  }, 30000);
});
