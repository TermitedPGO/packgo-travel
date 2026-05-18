// Smoke-test OpsAgent — directly invoke from server side
const { runOpsAgent } = await import("./server/agents/autonomous/opsAgent.ts");

const questions = [
  "現在有什麼日本團?",
  "6 月有什麼團?",
  "5 日的團還有幾個?",
];

for (const q of questions) {
  console.log("\n" + "═".repeat(70));
  console.log("Q:", q);
  console.log("═".repeat(70));
  const t0 = Date.now();
  try {
    const result = await runOpsAgent(q);
    console.log(`\n⏱  ${Date.now() - t0}ms`);
    console.log(`🔍 Hints:`, result.hints);
    console.log(`📊 Queries:`, Object.keys(result.contextUsed));
    console.log(`\n💬 Answer:\n${result.answer}`);
  } catch (err) {
    console.log("❌ Error:", err.message);
  }
}
