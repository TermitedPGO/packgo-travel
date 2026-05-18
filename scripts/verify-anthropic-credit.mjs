// Tiny LLM call to verify Anthropic credit is replenished.
// Calls invokeLLM the same way the rest of the codebase does — so if Forge
// fallback is in play, it engages here too.
import { invokeLLM } from "../server/_core/llm.ts";

const t0 = Date.now();
try {
  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 32,
    messages: [
      { role: "system", content: "Reply with the single word OK." },
      { role: "user", content: "ping" },
    ],
  });
  const text =
    response?.choices?.[0]?.message?.content ??
    response?.content?.[0]?.text ??
    "(no text in response)";
  console.log(`✅ LLM live (${Date.now() - t0}ms): ${String(text).slice(0, 80)}`);
} catch (err) {
  console.error(`❌ LLM call failed (${Date.now() - t0}ms):`, err?.message || err);
  process.exit(1);
}
