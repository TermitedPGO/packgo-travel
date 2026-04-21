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
      // 120s matches previous Forge-era timeout budget
      timeout: 120_000,
      maxRetries: 2,
    });
  }
  return _client;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 8192;

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
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters ?? {
      type: "object",
      properties: {},
    }) as Anthropic.Messages.Tool.InputSchema,
  }));
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
// Main entry
// ──────────────────────────────────────────────────────────────────────────────

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  // 1. Cache lookup (key is already stable across param shapes — see llmCache.ts)
  const cached = await getCachedResponse(params);
  if (cached) return cached;

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

  // 3. Call Anthropic
  const client = getClient();
  const startMs = Date.now();
  console.log(
    `[invokeLLM] → Anthropic (model: ${model}, msgs: ${anthropicMessages.length}` +
      (tools?.length ? `, tools: ${tools.length}` : "") +
      ")"
  );

  let resp: Anthropic.Messages.Message;
  try {
    resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: anthropicMessages,
      ...(system ? { system } : {}),
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    });
  } catch (err: any) {
    const elapsed = Date.now() - startMs;
    // Anthropic SDK errors: err.status, err.error, err.message
    if (err?.status === 408 || /timeout/i.test(err?.message || "")) {
      console.error(`[invokeLLM] ⏱ TIMEOUT after ${elapsed}ms`);
      const wrapped = new Error(
        `LLM_TIMEOUT: Anthropic API did not respond within 120s (elapsed: ${elapsed}ms)`
      );
      (wrapped as any).nonRetryable = true;
      throw wrapped;
    }
    console.error(
      `[invokeLLM] ❌ Anthropic error after ${elapsed}ms: ${err?.status ?? ""} ${err?.message}`
    );
    throw err;
  }

  const elapsed = Date.now() - startMs;
  console.log(
    `[invokeLLM] ✅ ${resp.stop_reason ?? "ok"} in ${elapsed}ms ` +
      `(in: ${resp.usage?.input_tokens ?? "?"}, out: ${resp.usage?.output_tokens ?? "?"})`
  );

  // 4. Convert back to OpenAI-style, cache, return
  const result = anthropicToInvokeResult(resp, structuredToolName);
  await setCachedResponse(params, result);
  return result;
}
