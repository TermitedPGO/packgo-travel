/**
 * llm_dashboard.mjs — print today's & yesterday's LLM usage / cache hit rate
 * / self-repair stats. Uses Redis hashes populated by v72 instrumentation.
 *
 * Run on Fly: flyctl ssh console -C 'cd /app && node scripts/llm_dashboard.mjs'
 */
import Redis from 'ioredis';

const redis = new Redis(process.env.UPSTASH_REDIS_URL, { tls: { rejectUnauthorized: false } });

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

// Anthropic public list prices ($ per 1M tokens) for cost estimation
const PRICES = {
  'claude-haiku-4-5-20251001':   { in: 1,  out: 5 },
  'claude-sonnet-4-5-20250929':  { in: 3,  out: 15 },
  'claude-opus-4-5-20251101':    { in: 15, out: 75 },
  'claude-3-haiku-20240307':     { in: 0.25, out: 1.25 },
  'claude-3-5-sonnet-20241022':  { in: 3,  out: 15 },
};
const CACHE_READ_DISCOUNT = 0.10; // cache_read_input_tokens billed at 10%

function formatTokens(n) {
  if (n === 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

async function loadDay(day) {
  const stats = await redis.hgetall(`llm:stats:${day}`);
  const out = {
    day,
    cacheHit: parseInt(stats.cache_hit || '0', 10),
    cacheMiss: parseInt(stats.cache_miss || '0', 10),
    promptCacheRead: parseInt(stats.prompt_cache_read || '0', 10),
    promptCacheWrite: parseInt(stats.prompt_cache_write || '0', 10),
    callsTotal: parseInt(stats.calls_total || '0', 10),
    perModel: {},
    totalIn: 0,
    totalOut: 0,
    totalCostUSD: 0,
  };
  for (const [k, v] of Object.entries(stats)) {
    const inMatch = k.match(/^input:(.+)$/);
    const outMatch = k.match(/^output:(.+)$/);
    const n = parseInt(v, 10) || 0;
    if (inMatch) {
      const m = inMatch[1];
      out.perModel[m] = out.perModel[m] || { in: 0, out: 0 };
      out.perModel[m].in = n;
      out.totalIn += n;
    } else if (outMatch) {
      const m = outMatch[1];
      out.perModel[m] = out.perModel[m] || { in: 0, out: 0 };
      out.perModel[m].out = n;
      out.totalOut += n;
    }
  }
  // Cost estimate
  for (const [model, m] of Object.entries(out.perModel)) {
    const p = PRICES[model] || { in: 1, out: 5 };
    // Approximate: assume promptCacheRead is split proportionally across models
    out.totalCostUSD += (m.in / 1_000_000) * p.in + (m.out / 1_000_000) * p.out;
  }
  // Cache savings approximation (90% off on cached_read tokens)
  const cacheSavingsTokens = out.promptCacheRead;
  return out;
}

async function loadSelfRepair(day) {
  const s = await redis.hgetall(`selfrepair:stats:${day}`);
  return {
    triggered: parseInt(s.triggered || '0', 10),
    passed: parseInt(s.passed || '0', 10),
  };
}

function printDay(d, sr) {
  console.log(`\n━━━ ${d.day} ━━━`);
  console.log(`  Calls: ${d.callsTotal}    Cache hit: ${d.cacheHit}/${d.cacheHit + d.cacheMiss} (${d.cacheHit + d.cacheMiss > 0 ? ((d.cacheHit / (d.cacheHit + d.cacheMiss)) * 100).toFixed(1) : '?'}%)`);
  console.log(`  Tokens: in=${formatTokens(d.totalIn)} out=${formatTokens(d.totalOut)} total=${formatTokens(d.totalIn + d.totalOut)}`);
  console.log(`  Anthropic prompt cache: write=${formatTokens(d.promptCacheWrite)} read=${formatTokens(d.promptCacheRead)}`);
  console.log(`  Estimated cost: $${d.totalCostUSD.toFixed(2)}`);
  console.log(`  Self-repair: ${sr.triggered} triggered / ${sr.passed} passed${sr.triggered + sr.passed > 0 ? ` (${((sr.triggered / (sr.triggered + sr.passed)) * 100).toFixed(1)}% trigger rate)` : ''}`);
  if (Object.keys(d.perModel).length > 0) {
    console.log('  Per model:');
    for (const [m, mm] of Object.entries(d.perModel).sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out))) {
      console.log(`    ${m.padEnd(35)} in=${formatTokens(mm.in)} out=${formatTokens(mm.out)}`);
    }
  }
}

const todayData = await loadDay(today);
const yesterdayData = await loadDay(yesterday);
const todaySR = await loadSelfRepair(today);
const yesterdaySR = await loadSelfRepair(yesterday);

console.log(`\n=== PACK&GO LLM Dashboard ===`);
printDay(yesterdayData, yesterdaySR);
printDay(todayData, todaySR);

// Trend
if (yesterdayData.totalIn + yesterdayData.totalOut > 0) {
  const yt = yesterdayData.totalIn + yesterdayData.totalOut;
  const tt = todayData.totalIn + todayData.totalOut;
  const delta = ((tt - yt) / yt) * 100;
  console.log(`\nDay-over-day token usage: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`);
}

await redis.quit();
process.exit(0);
