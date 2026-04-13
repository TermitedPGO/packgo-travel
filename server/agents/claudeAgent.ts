/**
 * Claude Agent
 * Uses Anthropic Claude API for content analysis and generation
 * 
 * Advantages:
 * - 200K token context (vs GPT-4's 128K)
 * - Excellent structured output with native JSON Schema support
 * - Strong reasoning capabilities
 * - Better multilingual support (Chinese + English)
 * - Cost-effective (Haiku 4.5: $1/1M input, $5/1M output)
 * 
 * Claude Hybrid Architecture (Upgraded to 4.5 Series):
 * - Master (Orchestration): Claude Opus 4.5 for complex orchestration
 * - Brain (Complex Logic): Claude Sonnet 4.5 for itinerary planning
 * - Hands (Simple Tasks): Claude Haiku 4.5 for extraction and formatting
 */

import Anthropic from '@anthropic-ai/sdk';
import { logLlmUsage } from '../llmUsageService';

// Model constants - Upgraded to Claude 4.5 Series (2026-01-30)
export const CLAUDE_MODELS = {
  // Claude 4.5 Series (Latest)
  HAIKU_45: 'claude-haiku-4-5-20251001',      // Fast, cost-effective ($1/1M input, $5/1M output)
  SONNET_45: 'claude-sonnet-4-5-20250929',    // Balanced quality/speed ($3/1M input, $15/1M output)
  OPUS_45: 'claude-opus-4-5-20251101',        // Highest quality ($15/1M input, $75/1M output)
  
  // Legacy aliases (for backward compatibility)
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-5-20250929',
  OPUS: 'claude-opus-4-5-20251101',
  
  // Deprecated models (kept for reference)
  HAIKU_3: 'claude-3-haiku-20240307',
  SONNET_35: 'claude-3-5-sonnet-20241022',
  OPUS_3: 'claude-3-opus-20240229',
} as const;

export type ClaudeModel = typeof CLAUDE_MODELS[keyof typeof CLAUDE_MODELS];

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeResult {
  success: boolean;
  content?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  error?: string;
}

export interface ClaudeStructuredResult<T> extends ClaudeResult {
  data?: T;
}

// JSON Schema type definition
export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

// Token usage tracking
interface TokenUsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  estimatedCostUSD: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
}

// Strict Data Fidelity Rules (to prevent hallucinations)
export const STRICT_DATA_FIDELITY_RULES = `
## 嚴格數據忠實度規則

你必須遵守以下規則，違反將導致系統錯誤：

1. **只提取明確存在的資訊**：如果來源文本中沒有明確提到某個欄位的資訊，必須返回 null 或空值，絕對不能創造或推測。

2. **不要添加任何額外內容**：不要添加來源文本中沒有的飯店名稱、餐廳名稱、景點名稱或任何其他資訊。

3. **保持原始措辭**：盡可能保留來源文本的原始措辭，只做必要的格式調整。

4. **標記不確定性**：如果某個資訊不確定或模糊，在相關欄位中標記為 "待確認" 而不是猜測。

5. **數字必須準確**：價格、天數、時間等數字必須與來源文本完全一致，不能四捨五入或估算。

6. **不要輸出任何閒聊填充詞**：直接返回 JSON，不要有任何前言、解釋或後語。
`;

export class ClaudeAgent {
  private client: Anthropic;
  private model: string;
  private usageStats: TokenUsageStats;
  /** 子類別可覆寫，用於識別記錄來源 */
  protected agentName: string = 'ClaudeAgent';
  protected taskType?: string;

  constructor(options?: { model?: ClaudeModel }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    // 診斷日誌 — 確認 API key 狀態
    console.log(`[ClaudeAgent] ANTHROPIC_API_KEY status: ${apiKey ? `SET (${apiKey.substring(0, 8)}...)` : 'NOT SET'}`);
    console.log(`[ClaudeAgent] BUILT_IN_FORGE_API_KEY status: ${process.env.BUILT_IN_FORGE_API_KEY ? 'SET' : 'NOT SET'}`);
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }

    this.client = new Anthropic({ apiKey });
    // Default to Haiku 4.5 for cost-effectiveness
    this.model = options?.model || CLAUDE_MODELS.HAIKU_45;
    
    // Initialize usage stats
    this.usageStats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCalls: 0,
      estimatedCostUSD: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
    };
    
    console.log(`[ClaudeAgent] Initialized with model: ${this.model}`);
  }

  /**
   * Get current token usage statistics
   */
  getUsageStats(): TokenUsageStats {
    return { ...this.usageStats };
  }

  /**
   * Reset token usage statistics
   */
  resetUsageStats(): void {
    this.usageStats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCalls: 0,
      estimatedCostUSD: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
    };
  }

  /**
   * Update usage stats after a call (P2: supports Prompt Caching stats)
   */
  private updateUsageStats(
    inputTokens: number, 
    outputTokens: number,
    cacheCreationTokens?: number,
    cacheReadTokens?: number
  ): void {
    this.usageStats.totalInputTokens += inputTokens;
    this.usageStats.totalOutputTokens += outputTokens;
    this.usageStats.totalCalls += 1;
    this.usageStats.totalCacheCreationTokens += cacheCreationTokens || 0;
    this.usageStats.totalCacheReadTokens += cacheReadTokens || 0;

    // Calculate cost based on model (Claude 4.5 pricing with cache discounts)
    let inputCostPer1M: number;
    let outputCostPer1M: number;

    if (this.model.includes('haiku')) {
      inputCostPer1M = 1.0;
      outputCostPer1M = 5.0;
    } else if (this.model.includes('sonnet')) {
      inputCostPer1M = 3.0;
      outputCostPer1M = 15.0;
    } else if (this.model.includes('opus')) {
      inputCostPer1M = 15.0;
      outputCostPer1M = 75.0;
    } else {
      inputCostPer1M = 1.0;
      outputCostPer1M = 5.0;
    }

    // Prompt Caching pricing:
    // - cache_creation: 1.25x base input price
    // - cache_read: 0.1x base input price (90% discount)
    // - regular input: 1x base input price
    const regularInputTokens = inputTokens - (cacheCreationTokens || 0) - (cacheReadTokens || 0);
    const regularCost = (Math.max(0, regularInputTokens) / 1_000_000) * inputCostPer1M;
    const cacheWriteCost = ((cacheCreationTokens || 0) / 1_000_000) * inputCostPer1M * 1.25;
    const cacheReadCost = ((cacheReadTokens || 0) / 1_000_000) * inputCostPer1M * 0.1;
    const outputCost = (outputTokens / 1_000_000) * outputCostPer1M;
    
    this.usageStats.estimatedCostUSD += regularCost + cacheWriteCost + cacheReadCost + outputCost;

    // Log cache effectiveness
    if (cacheReadTokens && cacheReadTokens > 0) {
      const savings = ((cacheReadTokens || 0) / 1_000_000) * inputCostPer1M * 0.9;
      console.log(`[ClaudeAgent] 💰 Cache hit! ${cacheReadTokens} tokens read from cache, saved ~$${savings.toFixed(6)}`);
    }
    if (cacheCreationTokens && cacheCreationTokens > 0) {
      console.log(`[ClaudeAgent] 📝 Cache created: ${cacheCreationTokens} tokens cached for future use`);
    }

    // 非阻塞寫入資料庫（失敗不影響主流程）
    logLlmUsage({
      agentName: this.agentName,
      taskType: this.taskType,
      model: this.model,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: cacheCreationTokens ?? 0,
      cacheReadInputTokens: cacheReadTokens ?? 0,
    }).catch(() => { /* silent */ });
  }

  /**
   * Set agent context for usage logging (call before LLM operations)
   */
  setContext(agentName: string, taskType?: string): this {
    this.agentName = agentName;
    this.taskType = taskType;
    return this;
  }

  /**
   * Switch to a different model
   */
  setModel(model: ClaudeModel): void {
    this.model = model;
    console.log(`[ClaudeAgent] Switched to model: ${this.model}`);
  }

  /**
   * Send a single message to Claude (P2: with Prompt Caching support)
   */
  async sendMessage(
    prompt: string,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      enableCaching?: boolean; // P2: enable prompt caching for system prompt
    }
  ): Promise<ClaudeResult> {
    console.log('[ClaudeAgent] Sending message to Claude...');
    const startTime = Date.now();

    try {
      // P2: Build system prompt with cache_control if caching is enabled
      // Caching is enabled by default for system prompts >= 1024 tokens (Haiku minimum)
      const systemPromptText = options?.systemPrompt || '';
      const shouldCache = options?.enableCaching !== false && systemPromptText.length >= 500;
      
      const systemParam = shouldCache && systemPromptText
        ? [
            {
              type: 'text' as const,
              text: systemPromptText,
              cache_control: { type: 'ephemeral' as const },
            },
          ]
        : systemPromptText || undefined;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 1.0,
        system: systemParam as any,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const duration = Date.now() - startTime;
      console.log(`[ClaudeAgent] Response received in ${duration}ms`);

      // P2: Extract cache stats from usage
      const usage = response.usage as any;
      const cacheCreation = usage.cache_creation_input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;

      // Update usage stats with cache info
      this.updateUsageStats(response.usage.input_tokens, response.usage.output_tokens, cacheCreation, cacheRead);

      // Extract text content from response
      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      return {
        success: true,
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cacheRead,
        },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[ClaudeAgent] Error after ${duration}ms:`, error.message);

      // Forge fallback: 當 Anthropic 直連失敗（403/forbidden）時，透過 Forge proxy 呼叫
      if (error?.status === 403 || error?.message?.includes('forbidden') || error?.message?.includes('403')) {
        console.warn(`[ClaudeAgent] Anthropic direct call failed (403), falling back to Forge proxy...`);
        try {
          const { invokeLLM } = await import('../_core/llm');
          const forgeResult = await invokeLLM({
            messages: [
              ...(options?.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
              { role: 'user' as const, content: prompt },
            ],
            maxTokens: options?.maxTokens || 4096,
          });
          const forgeContent = forgeResult.choices?.[0]?.message?.content;
          const contentStr = typeof forgeContent === 'string' ? forgeContent : JSON.stringify(forgeContent);
          console.log(`[ClaudeAgent] Forge fallback succeeded (${Date.now() - startTime}ms)`);
          return {
            success: true,
            content: contentStr,
            usage: {
              inputTokens: forgeResult.usage?.prompt_tokens || 0,
              outputTokens: forgeResult.usage?.completion_tokens || 0,
            },
          };
        } catch (forgeErr: any) {
          console.error(`[ClaudeAgent] Forge fallback also failed:`, forgeErr.message);
        }
      }

      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Send a conversation (multiple messages) to Claude (P2: with Prompt Caching)
   */
  async sendConversation(
    messages: ClaudeMessage[],
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      enableCaching?: boolean;
    }
  ): Promise<ClaudeResult> {
    console.log(`[ClaudeAgent] Sending conversation (${messages.length} messages) to Claude...`);
    const startTime = Date.now();

    try {
      // P2: Build system prompt with cache_control
      const systemPromptText = options?.systemPrompt || '';
      const shouldCache = options?.enableCaching !== false && systemPromptText.length >= 500;
      
      const systemParam = shouldCache && systemPromptText
        ? [
            {
              type: 'text' as const,
              text: systemPromptText,
              cache_control: { type: 'ephemeral' as const },
            },
          ]
        : systemPromptText || undefined;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 1.0,
        system: systemParam as any,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      });

      const duration = Date.now() - startTime;
      console.log(`[ClaudeAgent] Response received in ${duration}ms`);

      const usage = response.usage as any;
      const cacheCreation = usage.cache_creation_input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;

      this.updateUsageStats(response.usage.input_tokens, response.usage.output_tokens, cacheCreation, cacheRead);

      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      return {
        success: true,
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cacheRead,
        },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[ClaudeAgent] Error after ${duration}ms:`, error.message);

      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Send a structured message with JSON Schema enforcement
   * This is the key method for the Claude Hybrid Architecture
   * 
   * Uses Claude's native tool use feature to guarantee valid JSON output
   * that conforms to the provided schema.
   * 
   * @param prompt - The user prompt
   * @param schema - JSON Schema defining the expected output structure
   * @param options - Additional options (systemPrompt, maxTokens, temperature)
   * @returns Structured result with parsed data
   */
  async sendStructuredMessage<T>(
    prompt: string,
    schema: JSONSchema,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      schemaName?: string;
      schemaDescription?: string;
      strictDataFidelity?: boolean;
      enableCaching?: boolean; // P2: enable prompt caching
    }
  ): Promise<ClaudeStructuredResult<T>> {
    const schemaName = options?.schemaName || 'structured_output';
    const schemaDescription = options?.schemaDescription || 'Extract structured data according to the schema';
    
    console.log(`[ClaudeAgent] Sending structured message with schema: ${schemaName}`);
    const startTime = Date.now();

    // Build system prompt with strict data fidelity rules if enabled
    let systemPromptText = options?.systemPrompt || '你是一個專業的資料提取專家，擅長從文本中提取結構化資訊。';
    if (options?.strictDataFidelity !== false) {
      systemPromptText = `${systemPromptText}\n\n${STRICT_DATA_FIDELITY_RULES}`;
    }

    // P2: Apply Prompt Caching to system prompt
    const shouldCache = options?.enableCaching !== false && systemPromptText.length >= 500;
    const systemParam = shouldCache
      ? [
          {
            type: 'text' as const,
            text: systemPromptText,
            cache_control: { type: 'ephemeral' as const },
          },
        ]
      : systemPromptText;

    try {
      // Use Claude's tool use feature to enforce JSON schema
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.3,
        system: systemParam as any,
        tools: [
          {
            name: schemaName,
            description: schemaDescription,
            input_schema: schema as any,
          },
        ],
        tool_choice: { type: 'tool', name: schemaName },
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const duration = Date.now() - startTime;
      console.log(`[ClaudeAgent] Structured response received in ${duration}ms`);

      // P2: Extract cache stats
      const usageRaw = response.usage as any;
      const cacheCreation = usageRaw.cache_creation_input_tokens || 0;
      const cacheRead = usageRaw.cache_read_input_tokens || 0;

      // Update usage stats with cache info
      this.updateUsageStats(response.usage.input_tokens, response.usage.output_tokens, cacheCreation, cacheRead);

      // Extract tool use result
      const toolUseBlock = response.content.find((block) => block.type === 'tool_use');
      
      if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
        console.error('[ClaudeAgent] No tool use block found in response');
        return {
          success: false,
          error: 'No structured output returned from Claude',
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cacheCreationInputTokens: cacheCreation,
            cacheReadInputTokens: cacheRead,
          },
        };
      }

      const data = toolUseBlock.input as T;

      console.log(`[ClaudeAgent] Successfully extracted structured data`);

      return {
        success: true,
        data,
        content: JSON.stringify(data, null, 2),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cacheRead,
        },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[ClaudeAgent] Structured message error after ${duration}ms:`, error.message);

      // Forge fallback: 當 Anthropic 直連失敗（403/forbidden）時，透過 Forge proxy 呼叫
      // Forge 使用 response_format: json_schema 替代 Claude tool_use
      if (error?.status === 403 || error?.message?.includes('forbidden') || error?.message?.includes('403')) {
        console.warn(`[ClaudeAgent] Anthropic structured call failed (403), falling back to Forge proxy...`);
        try {
          const { invokeLLM } = await import('../_core/llm');
          const schemaName = options?.schemaName || 'structured_output';
          const forgeResult = await invokeLLM({
            messages: [
              { role: 'system' as const, content: systemPromptText + '\n\n請回傳符合指定 JSON schema 的結構化資料。' },
              { role: 'user' as const, content: prompt },
            ],
            maxTokens: options?.maxTokens || 4096,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: schemaName,
                strict: false,
                schema: schema as any,
              },
            },
          });
          const forgeContent = forgeResult.choices?.[0]?.message?.content;
          const contentStr = typeof forgeContent === 'string' ? forgeContent : JSON.stringify(forgeContent);
          // 嘗試解析 JSON
          let parsedData: T;
          try {
            parsedData = JSON.parse(contentStr) as T;
          } catch {
            // 如果不是有效 JSON，尝試提取 JSON 區塊
            const jsonMatch = contentStr.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('Forge fallback: no valid JSON in response');
            parsedData = JSON.parse(jsonMatch[0]) as T;
          }
          console.log(`[ClaudeAgent] Forge structured fallback succeeded (${Date.now() - startTime}ms)`);
          return {
            success: true,
            data: parsedData,
            content: contentStr,
            usage: {
              inputTokens: forgeResult.usage?.prompt_tokens || 0,
              outputTokens: forgeResult.usage?.completion_tokens || 0,
            },
          };
        } catch (forgeErr: any) {
          console.error(`[ClaudeAgent] Forge structured fallback also failed:`, forgeErr.message);
        }
      }

      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Stream a conversation response using SSE (Server-Sent Events)
   * Yields text chunks as they arrive from Claude API
   * 
   * @param messages - Conversation history
   * @param options - System prompt, max tokens, etc.
   * @yields string chunks of the response
   */
  async *streamConversation(
    messages: ClaudeMessage[],
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      enableCaching?: boolean;
    }
  ): AsyncGenerator<string, void, unknown> {
    const startTime = Date.now();
    const systemPromptText = options?.systemPrompt || '';
    const shouldCache = options?.enableCaching !== false && systemPromptText.length >= 500;

    const systemParam = shouldCache && systemPromptText
      ? [{ type: 'text' as const, text: systemPromptText, cache_control: { type: 'ephemeral' as const } }]
      : systemPromptText || undefined;

    try {
      const stream = await this.client.messages.stream({
        model: this.model,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 1.0,
        system: systemParam as any,
        messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
      }

      // 取得最終用量統計
      const finalMessage = await stream.finalMessage();
      const duration = Date.now() - startTime;
      const usage = finalMessage.usage as any;
      const cacheCreation = usage.cache_creation_input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      this.updateUsageStats(finalMessage.usage.input_tokens, finalMessage.usage.output_tokens, cacheCreation, cacheRead);
      console.log(`[ClaudeAgent] Stream completed in ${duration}ms`);
    } catch (error: any) {
      console.error('[ClaudeAgent] Stream error:', error.message);
      throw error;
    }
  }

  /**
   * Extract structured data from text using Claude (legacy method)
   * @deprecated Use sendStructuredMessage instead for guaranteed JSON output
   */
  async extractStructuredData(
    text: string,
    schema: {
      description: string;
      fields: Record<string, { type: string; description: string }>;
    },
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
    }
  ): Promise<ClaudeResult & { data?: any }> {
    console.log('[ClaudeAgent] Extracting structured data (legacy method)...');

    // Build prompt for structured extraction
    const fieldsDescription = Object.entries(schema.fields)
      .map(([key, field]) => `- ${key} (${field.type}): ${field.description}`)
      .join('\n');

    const prompt = `${schema.description}

請從以下文本中提取資訊，並以 JSON 格式返回。

欄位說明：
${fieldsDescription}

文本內容：
${text}

請直接返回 JSON 格式的結果，不要包含任何其他說明文字。`;

    const result = await this.sendMessage(prompt, {
      systemPrompt: options?.systemPrompt || '你是一個專業的資料提取專家，擅長從文本中提取結構化資訊。',
      maxTokens: options?.maxTokens || 4096,
      temperature: 0.3, // Lower temperature for more consistent extraction
    });

    if (!result.success || !result.content) {
      return result;
    }

    // Try to parse JSON from response
    try {
      // Extract JSON from markdown code blocks if present
      let jsonText = result.content.trim();
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }

      const data = JSON.parse(jsonText);

      return {
        ...result,
        data,
      };
    } catch (error) {
      console.error('[ClaudeAgent] Failed to parse JSON from response:', error);
      return {
        success: false,
        error: 'Failed to parse JSON from Claude response',
      };
    }
  }
}

// Export singleton instances for different use cases
let haikuInstance: ClaudeAgent | null = null;
let sonnetInstance: ClaudeAgent | null = null;
let opusInstance: ClaudeAgent | null = null;

/**
 * Get a shared Haiku 4.5 instance (for simple extraction tasks)
 * Cost: $1/1M input, $5/1M output
 */
export function getHaikuAgent(): ClaudeAgent {
  if (!haikuInstance) {
    haikuInstance = new ClaudeAgent({ model: CLAUDE_MODELS.HAIKU_45 });
  }
  return haikuInstance;
}

/**
 * Get a shared Sonnet 4.5 instance (for complex reasoning tasks)
 * Cost: $3/1M input, $15/1M output
 */
export function getSonnetAgent(): ClaudeAgent {
  if (!sonnetInstance) {
    sonnetInstance = new ClaudeAgent({ model: CLAUDE_MODELS.SONNET_45 });
  }
  return sonnetInstance;
}

/**
 * Get a shared Opus 4.5 instance (for master orchestration tasks)
 * Cost: $15/1M input, $75/1M output
 */
export function getOpusAgent(): ClaudeAgent {
  if (!opusInstance) {
    opusInstance = new ClaudeAgent({ model: CLAUDE_MODELS.OPUS_45 });
  }
  return opusInstance;
}
