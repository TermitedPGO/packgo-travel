// LLM client — direct Anthropic Messages API (Fly.io deployment).
//
// Replaces the legacy Manus Forge OpenAI-compatible proxy. Public API
// (InvokeParams, InvokeResult, invokeLLM) is UNCHANGED so that all callers
// keep working without edits.
//
// Internally we translate:
//   OpenAI-style messages   → Anthropic Messages API (system + tools + content blocks)
//   Anthropic response      → OpenAI-style InvokeResult (choices[], tool_calls, usage)
//
// Env:
//   ANTHROPIC_API_KEY  (required in production)

import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";
import { getCachedResponse, setCachedResponse } from "./llmCache";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "llm" });

// ──────────────────────────────────────────────────────────────────────────────
// Public types — unchanged so callers don't break
// ──────────────────────────────────────────────────────────────────────────────

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
  /** Round 81: when re-sending an assistant turn back to the LLM during a
   *  tool-use loop, pass the tool calls so Anthropic gets matching tool_use
   *  blocks. Without these, tool_result blocks in the next user message
   *  fail validation. */
  tool_calls?: ToolCall[];
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: { name: string };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  model?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

// ──────────────────────────────────────────────────────────────────────────────
// Anthropic SDK (lazy-init)
// ──────────────────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!ENV.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Set it via `fly secrets set ANTHROPIC_API_KEY=...`."
    );
  }
  if (!_client) {
    _client = new Anthropic({
      apiKey: ENV.anthropicApiKey,
      // v80.24: bumped 120s → 240s. PDF analysis on 2MB+ scanned tour
      // brochures was hitting the 120s ceiling with Sonnet 4.5. Haiku 4.5
      // is 3-5× faster but we still need headroom for: long itineraries
      // (30+ days), retries, and parallel agent calls competing for slots.
      timeout: 240_000,
      // v80.24: was maxRetries=2. We now have RetryManager + circuit breaker
      // doing fine-grained retry control; the SDK retrying on top of that
      // multiplied compute 3× during outages. Single source of retry truth.
      maxRetries: 0,
    });
  }
  return _client;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Round 80.15: prompt-cache eligibility check.
 *
 * Anthropic prompt-cache requires minimum block sizes — below them, the
 * cache_control directive is silently ignored AND you pay full price.
 *   - Sonnet / Opus: 1024 tokens
 *   - Haiku:         2048 tokens
 *
 * We estimate at 3.5 chars/token (conservative for CJK) and only attach
 * cache_control when the system prompt is large enough to actually save.
 *
 * Mirrors the same logic in claudeAgent.ts so direct invokeLLM callers
 * (calibrationAgent / learningAgent / skillLearnerAgent) get the same
 * 90% input-token savings on cache hits.
 */
function shouldCacheSystemPrompt(text: string, model: string): boolean {
  if (!text) return false;
  // v80.24: better token estimate for Chinese-heavy prompts. Anthropic
  // tokenizer uses ~1.5 chars/token for CJK, ~3.5 for English. PACK&GO
  // system prompts are 90% Chinese so the old 3.5 estimate undershot
  // by ~2.3× — many cacheable prompts were skipped, paying full price
  // every call. Detect CJK ratio and use the right divisor.
  const cjkChars = (text.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g) || []).length;
  const cjkRatio = cjkChars / text.length;
  const charsPerToken = cjkRatio > 0.5 ? 1.5 : 3.5;
  const estimatedTokens = Math.floor(text.length / charsPerToken);
  const minTokens = model.includes("haiku") ? 2048 : 1024;
  return estimatedTokens >= minTokens;
}

const ensureArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

function inferMimeTypeFromDataUrl(dataUrl: string): { mime: string; data: string } | null {
  // data:image/png;base64,iVBOR...
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], data: match[2] };
}

// OpenAI "image_url" → Anthropic image block
function imageUrlToAnthropic(url: string): Anthropic.Messages.ImageBlockParam {
  const dataUrl = inferMimeTypeFromDataUrl(url);
  if (dataUrl) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: dataUrl.mime as Anthropic.Messages.Base64ImageSource["media_type"],
        data: dataUrl.data,
      },
    };
  }
  return {
    type: "image",
    source: { type: "url", url },
  };
}

// OpenAI "file_url" → Anthropic document/other block
// Anthropic supports URL documents (PDF); audio/video handled only where the model supports it.
function fileUrlToAnthropic(
  file: FileContent["file_url"]
): Anthropic.Messages.DocumentBlockParam | Anthropic.Messages.TextBlockParam {
  const mime = file.mime_type;
  if (mime === "application/pdf") {
    return {
      type: "document",
      source: { type: "url", url: file.url },
    };
  }
  // Fallback: embed as text reference. Anthropic doesn't support audio/video blocks
  // in the Messages API (as of writing). Callers that need audio should use a
  // dedicated transcription service first.
  return {
    type: "text",
    text: `[attachment: ${mime || "unknown"}] ${file.url}`,
  };
}

// Collect system messages, fold OpenAI-style tool results into user tool_result blocks.
// Returns { system, messages } in Anthropic format.
function normalizeToAnthropic(messages: Message[]): {
  system?: string;
  messages: Anthropic.Messages.MessageParam[];
} {
  const systemParts: string[] = [];
  const out: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    const parts = ensureArray(msg.content);

    if (msg.role === "system") {
      const text = parts
        .map(p => (typeof p === "string" ? p : p.type === "text" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) systemParts.push(text);
      continue;
    }

    if (msg.role === "tool" || msg.role === "function") {
      // Aggregate tool output into a single string; attach as tool_result.
      const text = parts
        .map(p => (typeof p === "string" ? p : p.type === "text" ? p.text : JSON.stringify(p)))
        .join("\n");
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id ?? "",
            content: text,
          },
        ],
      });
      continue;
    }

    // user / assistant
    const blocks: Anthropic.Messages.ContentBlockParam[] = [];
    for (const p of parts) {
      if (typeof p === "string") {
        if (p) blocks.push({ type: "text", text: p });
      } else if (p.type === "text") {
        if (p.text) blocks.push({ type: "text", text: p.text });
      } else if (p.type === "image_url") {
        blocks.push(imageUrlToAnthropic(p.image_url.url));
      } else if (p.type === "file_url") {
        blocks.push(fileUrlToAnthropic(p.file_url));
      }
    }
    // Round 81: assistant turns from a previous tool-use loop iteration carry
    // tool_calls. Convert each to a tool_use block so Anthropic can match
    // them to the following tool_result blocks.
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = {};
        }
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: input as Record<string, unknown>,
        });
      }
    }
    // Anthropic requires non-empty content.
    if (blocks.length === 0) {
      blocks.push({ type: "text", text: "" });
    }
    out.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: blocks,
    });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: out,
  };
}

function toolsToAnthropic(tools?: Tool[]): Anthropic.Messages.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t, i) => {
    // 2026-05-21 hotfix: if `t.function` is undefined we previously crashed
    // with "Cannot read properties of undefined (reading 'name')" — useless
    // when the offender is one of 7 agents. Throw something Jeff can grep.
    // The flat-shape `{ name, description, parameters }` (instead of nested
    // `{ type: "function", function: { ... } }`) is the recurring footgun.
    if (!t || typeof t !== "object" || !("function" in t) || !t.function) {
      throw new Error(
        `toolsToAnthropic: tool[${i}] is missing the nested 'function' field. ` +
          `Expected { type: "function", function: { name, description, parameters } }. ` +
          `Got: ${JSON.stringify(t).slice(0, 200)}`
      );
    }
    return {
      name: t.function.name,
      description: t.function.description,
      input_schema: (t.function.parameters ?? {
        type: "object",
        properties: {},
      }) as Anthropic.Messages.Tool.InputSchema,
    };
  });
}

function toolChoiceToAnthropic(
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): Anthropic.Messages.ToolChoice | undefined {
  if (!toolChoice) return undefined;

  if (toolChoice === "none") return { type: "none" };
  if (toolChoice === "auto") return { type: "auto" };

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length === 1) {
      return { type: "tool", name: tools[0].function.name };
    }
    return { type: "any" };
  }

  if ("name" in toolChoice) {
    return { type: "tool", name: toolChoice.name };
  }

  // ToolChoiceExplicit
  return { type: "tool", name: toolChoice.function.name };
}

/**
 * Convert response_format / output_schema into either:
 *  - an injected system-prompt suffix (for json_object), or
 *  - a synthetic forced tool (for json_schema) so we can extract structured output.
 */
function applyStructuredOutput(
  params: InvokeParams,
  anthropicSystem: string | undefined,
  anthropicTools: Anthropic.Messages.Tool[] | undefined,
  anthropicToolChoice: Anthropic.Messages.ToolChoice | undefined
): {
  system: string | undefined;
  tools: Anthropic.Messages.Tool[] | undefined;
  toolChoice: Anthropic.Messages.ToolChoice | undefined;
  structuredToolName: string | null;
} {
  const format = params.responseFormat ?? params.response_format;
  const schema = params.outputSchema ?? params.output_schema;

  // Case 1: explicit json_schema (either via responseFormat or outputSchema)
  const jsonSchema: JsonSchema | undefined =
    format?.type === "json_schema" ? format.json_schema : schema;

  if (jsonSchema) {
    if (!jsonSchema.name || !jsonSchema.schema) {
      throw new Error("json_schema requires both 'name' and 'schema'");
    }
    const syntheticTool: Anthropic.Messages.Tool = {
      name: jsonSchema.name,
      description: `Return the structured result. ${
        typeof (jsonSchema as any).description === "string"
          ? (jsonSchema as any).description
          : ""
      }`.trim(),
      input_schema: jsonSchema.schema as Anthropic.Messages.Tool.InputSchema,
    };
    return {
      system: anthropicSystem,
      tools: [...(anthropicTools ?? []), syntheticTool],
      toolChoice: { type: "tool", name: jsonSchema.name },
      structuredToolName: jsonSchema.name,
    };
  }

  // Case 2: plain json_object → augment system prompt
  if (format?.type === "json_object") {
    const suffix =
      "\n\nReturn your response as a single valid JSON object. Do not wrap it in markdown code fences. Do not include any prose before or after the JSON.";
    return {
      system: (anthropicSystem ?? "") + suffix,
      tools: anthropicTools,
      toolChoice: anthropicToolChoice,
      structuredToolName: null,
    };
  }

  return {
    system: anthropicSystem,
    tools: anthropicTools,
    toolChoice: anthropicToolChoice,
    structuredToolName: null,
  };
}

// Map Anthropic stop_reason → OpenAI finish_reason
function mapStopReason(stop: string | null | undefined): string | null {
  switch (stop) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    case "tool_use":
      return "tool_calls";
    default:
      return stop ?? null;
  }
}

// Convert Anthropic response → OpenAI-compatible InvokeResult.
function anthropicToInvokeResult(
  resp: Anthropic.Messages.Message,
  structuredToolName: string | null
): InvokeResult {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let structuredContent: string | null = null;

  for (const block of resp.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      if (structuredToolName && block.name === structuredToolName) {
        // Collapse structured-output tool into message.content as JSON string,
        // so callers that JSON.parse(content) keep working.
        structuredContent = JSON.stringify(block.input);
      } else {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }
    // Other block types (thinking, etc.) are ignored for now.
  }

  const content = structuredContent ?? textParts.join("");

  return {
    id: resp.id,
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: mapStopReason(resp.stop_reason),
      },
    ],
    usage: resp.usage
      ? {
          prompt_tokens: resp.usage.input_tokens,
          completion_tokens: resp.usage.output_tokens,
          total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
        }
      : undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Round 80.15: Circuit breaker — protects against Anthropic outages cascading.
//
// State machine:
//   CLOSED   (normal): all requests pass through
//   OPEN     (tripped): all requests fail fast with circuit-open error
//                       so we don't hammer Anthropic during an outage.
//   HALF_OPEN (probe): one request allowed to test recovery; on success →
//                      CLOSED, on failure → OPEN (with backoff).
//
// Configuration:
//   - Trips after 5 consecutive failures within 30s
//   - Stays OPEN for 30s, then enters HALF_OPEN
//   - Counters reset after each successful response
//
// TODO(circuit-breaker-v2): when OPEN, fall back to OpenAI/Gemini if those
// API keys exist. Requires: OPENAI_API_KEY secret + OpenAI client + adapter.
// Today, OPEN simply throws a clearly-named error so callers can degrade
// gracefully (e.g. AI generation shows "service temporarily unavailable").
// ──────────────────────────────────────────────────────────────────────────────

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const CIRCUIT_CONFIG = {
  failureThreshold: 5,           // open after 5 consecutive failures
  failureWindowMs: 30_000,       // failures must be within 30s window
  openDurationMs: 30_000,        // stay open for 30s
};

class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private firstFailureAt = 0;
  private openedAt = 0;

  /** Throws if circuit is OPEN; returns true if call should proceed. */
  beforeCall(): void {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= CIRCUIT_CONFIG.openDurationMs) {
        // Cooldown finished — try one probe
        this.state = "HALF_OPEN";
        log.warn("[CircuitBreaker] cooldown done, → HALF_OPEN");
        return;
      }
      const remaining = CIRCUIT_CONFIG.openDurationMs - elapsed;
      const err = new Error(
        `LLM_CIRCUIT_OPEN: Anthropic API circuit is open (auto-retry in ${Math.ceil(remaining / 1000)}s). ` +
        `Recent failures: ${this.failureCount}.`
      );
      (err as any).circuitOpen = true;
      (err as any).nonRetryable = true;
      throw err;
    }
  }

  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      log.info("[CircuitBreaker] probe succeeded → CLOSED");
    }
    this.state = "CLOSED";
    this.failureCount = 0;
    this.firstFailureAt = 0;
  }

  recordFailure(err: any): void {
    // Don't trip the circuit on user-side errors — only infra/upstream.
    // 4xx (other than 429 rate limit) are typically caller bugs, not outages.
    const status = err?.status;
    const isInfraFailure =
      !status ||
      status === 408 ||      // request timeout
      status === 429 ||      // rate limit (treat as upstream pressure)
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      /timeout/i.test(err?.message || "") ||
      err?.code === "ECONNRESET" ||
      err?.code === "ETIMEDOUT";

    if (!isInfraFailure) return;

    const now = Date.now();
    if (now - this.firstFailureAt > CIRCUIT_CONFIG.failureWindowMs) {
      // Window expired — reset counter
      this.failureCount = 1;
      this.firstFailureAt = now;
    } else {
      this.failureCount++;
    }

    if (this.state === "HALF_OPEN") {
      // Probe failed — back to OPEN
      this.state = "OPEN";
      this.openedAt = now;
      log.error(
        { openDurationMs: CIRCUIT_CONFIG.openDurationMs },
        "[CircuitBreaker] probe failed → OPEN",
      );
      bumpStat("circuit_opened", 1);
      return;
    }

    if (this.failureCount >= CIRCUIT_CONFIG.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = now;
      log.error(
        { failureCount: this.failureCount, elapsedMs: now - this.firstFailureAt },
        "[CircuitBreaker] consecutive failures → OPEN",
      );
      bumpStat("circuit_opened", 1);
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

const circuit = new CircuitBreaker();

// Exposed for diagnostics / health endpoints
export function getCircuitState(): { state: CircuitState; failures: number } {
  return { state: circuit.getState(), failures: (circuit as any).failureCount };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────────────

// v72: per-day Redis counters so we can answer "how much did each agent
// spend yesterday?" without parsing log files. Best-effort and non-blocking —
// counter failures never affect the LLM call itself. Query via:
//   HGETALL llm:stats:YYYY-MM-DD
// Sample keys: input:claude-haiku-4-5, output:claude-haiku-4-5,
//              cache_hit, cache_miss, prompt_cache_read, prompt_cache_write
async function bumpStat(field: string, n: number): Promise<void> {
  if (n <= 0) return;
  try {
    const { redis } = await import("./../redis");
    const day = new Date().toISOString().slice(0, 10);
    await redis.hincrby(`llm:stats:${day}`, field, n);
    // 30-day TTL on first write of the day
    await redis.expire(`llm:stats:${day}`, 30 * 24 * 60 * 60);
  } catch {
    // silent — observability must never break the request path
  }
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const t0 = Date.now();

  // 1. Cache lookup (key is already stable across param shapes — see llmCache.ts)
  const cached = await getCachedResponse(params);
  if (cached) {
    // v67: explicit cache-hit log so we can grep "[invokeLLM] cache=HIT" to
    // measure 24h app-cache effectiveness. Previously cache hits were silent
    // here (only the LLMCache layer logged, with a different prefix).
    log.info(
      { event: "cache_hit", model: cached.model ?? "?", elapsedMs: Date.now() - t0 },
      "[invokeLLM] cache=HIT",
    );
    bumpStat("cache_hit", 1);
    return cached;
  }
  bumpStat("cache_miss", 1);

  // 2. Translate params
  const { system: rawSystem, messages: anthropicMessages } = normalizeToAnthropic(
    params.messages
  );
  const rawTools = toolsToAnthropic(params.tools);
  const rawToolChoice = toolChoiceToAnthropic(
    params.toolChoice ?? params.tool_choice,
    params.tools
  );

  const { system, tools, toolChoice, structuredToolName } = applyStructuredOutput(
    params,
    rawSystem,
    rawTools,
    rawToolChoice
  );

  const model = params.model || DEFAULT_MODEL;
  const maxTokens = params.maxTokens ?? params.max_tokens ?? DEFAULT_MAX_TOKENS;

  // 3. Call Anthropic — guarded by circuit breaker
  // Round 80.15: trip the breaker on cascading failures so we don't hammer
  // a degraded API. See CircuitBreaker class above.
  circuit.beforeCall();

  const client = getClient();
  const startMs = Date.now();
  log.info(
    {
      model,
      messages: anthropicMessages.length,
      tools: tools?.length ?? 0,
      circuit: circuit.getState(),
    },
    "[invokeLLM] → Anthropic",
  );

  // Round 80.15: wrap system prompt as content-block array with cache_control
  // when it's large enough to qualify. Direct callers of invokeLLM (calibration
  // agent, learning agents) didn't have this — they were passing system as a
  // plain string and missing 90% input-token savings on repeat calls.
  let systemPayload: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> | undefined =
    system;
  if (system && shouldCacheSystemPrompt(system, model)) {
    systemPayload = [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ];
    log.debug(
      { approxTokens: Math.floor(system.length / 3.5) },
      "[invokeLLM] cache_control=ephemeral on system prompt",
    );
  }

  // 2026-05-26: 429 retry-with-backoff. Anthropic rate-limit hits (e.g.
  // 450k input tokens/min on Haiku 4.5) used to bubble straight to the
  // caller, which Sentry then captured and emailed Jeff for EACH job in
  // a 150-job batch — inbox storm. The fix:
  //   1. On 429, read `retry-after` header (Anthropic-honoured), sleep,
  //      retry. Up to 3 attempts (cumulative ~3 min wait).
  //   2. After exhausting attempts, swallow with a `nonRetryable` 503
  //      message — caller's RetryManager won't re-fire, and Sentry's
  //      issue-alert rule (high-priority only) won't trigger.
  //   3. Still bump circuit-breaker on each failure (pre-existing logic).
  //
  // Why retry here vs in caller: the SDK's maxRetries was set to 0 (single
  // source of retry truth). 429s are an INFRA pressure signal — distinct
  // from caller-bug 4xx — and recovery is mechanical (just wait). So this
  // layer is the right place.
  const MAX_429_RETRIES = 3;
  const RETRY_DEFAULT_SECONDS = [30, 60, 120]; // matches Anthropic typical retry-after
  let resp: Anthropic.Messages.Message | undefined;
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    try {
      resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: anthropicMessages,
        ...(systemPayload ? { system: systemPayload as any } : {}),
        ...(tools ? { tools } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      });
      circuit.recordSuccess();
      break;
    } catch (err: any) {
      lastErr = err;
      circuit.recordFailure(err);
      // Only retry on 429; everything else falls through to the throw below.
      if (err?.status !== 429 || attempt >= MAX_429_RETRIES) break;
      const retryAfterHeader = err?.headers?.["retry-after"];
      const retrySeconds =
        retryAfterHeader && /^\d+$/.test(String(retryAfterHeader))
          ? parseInt(String(retryAfterHeader), 10)
          : RETRY_DEFAULT_SECONDS[attempt] ?? 120;
      log.warn(
        {
          event: "rate_limit_429",
          model,
          attempt: attempt + 1,
          maxAttempts: MAX_429_RETRIES + 1,
          retrySeconds,
          retryAfterHeader,
        },
        `[invokeLLM] 429 rate-limit — backing off ${retrySeconds}s`,
      );
      bumpStat("rate_limit_429", 1);
      await new Promise((res) => setTimeout(res, retrySeconds * 1000));
    }
  }
  if (!resp) {
    const err = lastErr;
    const elapsed = Date.now() - startMs;
    if (err?.status === 408 || /timeout/i.test(err?.message || "")) {
      log.error({ err, elapsedMs: elapsed }, "[invokeLLM] TIMEOUT");
      const wrapped = new Error(
        `LLM_TIMEOUT: Anthropic API did not respond within 120s (elapsed: ${elapsed}ms)`,
      );
      (wrapped as any).nonRetryable = true;
      throw wrapped;
    }
    if (err?.status === 429) {
      // Exhausted retries — degrade to non-retryable so caller skips
      // gracefully and Sentry's "new issue" rule doesn't fire on the
      // re-thrown 429 (rule filters on `mechanism=generic` errors;
      // we swap message + mark nonRetryable so it falls outside).
      log.error(
        { elapsedMs: elapsed, attempts: MAX_429_RETRIES + 1 },
        "[invokeLLM] 429 retries exhausted — degrading gracefully",
      );
      bumpStat("rate_limit_429_exhausted", 1);
      const wrapped = new Error(
        `LLM_RATE_LIMITED: Anthropic rate limit sustained for ${MAX_429_RETRIES + 1} attempts; caller should defer.`,
      );
      (wrapped as any).nonRetryable = true;
      (wrapped as any).rateLimited = true;
      throw wrapped;
    }
    log.error(
      { err, status: err?.status, elapsedMs: elapsed },
      "[invokeLLM] Anthropic error",
    );
    throw err;
  }

  const elapsed = Date.now() - startMs;
  // v67: include Anthropic prompt-cache stats so we can see whether
  // cache_control directives are actually firing on the API side.
  // cache_creation = first time we wrote to Anthropic's 5m/1h cache;
  // cache_read = a hit (90% cheaper input tokens).
  const u = resp.usage as any;
  const cacheCreate = u?.cache_creation_input_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const inputTokens = u?.input_tokens ?? 0;
  const outputTokens = u?.output_tokens ?? 0;
  log.info(
    {
      event: "cache_miss",
      model,
      stopReason: resp.stop_reason ?? "ok",
      elapsedMs: elapsed,
      inputTokens,
      outputTokens,
      promptCacheWrite: cacheCreate,
      promptCacheRead: cacheRead,
    },
    "[invokeLLM] cache=MISS",
  );

  // v72: bump the per-day stats hash. We track tokens per model so the daily
  // summary can show e.g. "yesterday: Haiku 1.2M in / 0.4M out, Sonnet 100K in".
  bumpStat(`input:${model}`, inputTokens);
  bumpStat(`output:${model}`, outputTokens);
  bumpStat("prompt_cache_write", cacheCreate);
  bumpStat("prompt_cache_read", cacheRead);
  bumpStat("calls_total", 1);

  // 4. Convert back to OpenAI-style, cache, return
  const result = anthropicToInvokeResult(resp, structuredToolName);
  await setCachedResponse(params, result);
  return result;
}
