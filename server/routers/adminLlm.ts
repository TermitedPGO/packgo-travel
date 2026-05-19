/**
 * Admin LLM router — read-only LLM usage + cost reporting.
 *
 * Extracted from server/routers.ts (Phase 4B · sub-PR 2 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 * Source range (verbatim from origin): L4363-4679 inside `admin:` block.
 *
 * Procedures:
 *   - getLlmStats     – per-agent / per-task / per-day LLM usage stats
 *                        from llmUsageLogs table (DB-backed, ~135 LOC)
 *   - llmCostReport   – Redis HGETALL on llm:stats:YYYY-MM-DD keys,
 *                        applies model-tier pricing, per-day breakdown
 *                        (Redis-backed, ~184 LOC)
 *
 * Documented exception to CLAUDE.md §3.2 300-LOC limit: kept as a single
 * file because both procedures share the LLM cost domain and the
 * model-tier pricing matrix. If this file grows further, split into
 * adminLlmStats.ts + adminLlmCostReport.ts.
 *
 * Composed back into `admin:` via spread in server/routers.ts so existing
 * client trpc.admin.* paths resolve unchanged.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const adminLlmRouter = router({
  getLlmStats: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(90).default(30),
    }))
    .query(async ({ input }) => {
      const { llmUsageLogs } = await import('../../drizzle/schema');
      const { gte, sql, desc } = await import('drizzle-orm');
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DB not available' });

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      // 總計
      const [totals] = await drizzleDb
        .select({
          totalCalls: sql<number>`COUNT(*)`,
          totalTokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
          totalCostUsd: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
          cachedCalls: sql<number>`SUM(CASE WHEN ${llmUsageLogs.wasFromCache} = 1 THEN 1 ELSE 0 END)`,
          avgProcessingMs: sql<number>`AVG(${llmUsageLogs.processingTimeMs})`,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, since));

      // 每日費用趨勢
      const dailyCosts = await drizzleDb
        .select({
          date: sql<string>`DATE_FORMAT(createdAt, '%Y-%m-%d')`,
          calls: sql<number>`COUNT(*)`,
          tokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
          costUsd: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, since))
        .groupBy(sql`DATE_FORMAT(createdAt, '%Y-%m-%d')`)
        .orderBy(sql`DATE_FORMAT(createdAt, '%Y-%m-%d')`);

      // 各 Agent 費用佔比
      const agentCosts = await drizzleDb
        .select({
          agentName: llmUsageLogs.agentName,
          calls: sql<number>`COUNT(*)`,
          tokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
          costUsd: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, since))
        .groupBy(llmUsageLogs.agentName)
        .orderBy(desc(sql`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`));

      // 各任務類型費用
      const taskTypeCosts = await drizzleDb
        .select({
          taskType: llmUsageLogs.taskType,
          calls: sql<number>`COUNT(*)`,
          tokens: sql<number>`SUM(${llmUsageLogs.totalTokens})`,
          costUsd: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, since))
        .groupBy(llmUsageLogs.taskType)
        .orderBy(desc(sql`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`));

      // 最近 50 筆記錄
      const recentLogs = await drizzleDb
        .select()
        .from(llmUsageLogs)
        .orderBy(desc(llmUsageLogs.createdAt))
        .limit(50);

      return {
        totals: {
          totalCalls: Number(totals?.totalCalls ?? 0),
          totalTokens: Number(totals?.totalTokens ?? 0),
          totalCostUsd: parseFloat(totals?.totalCostUsd ?? '0').toFixed(4),
          cachedCalls: Number(totals?.cachedCalls ?? 0),
          cacheHitRate: totals?.totalCalls
            ? ((Number(totals.cachedCalls) / Number(totals.totalCalls)) * 100).toFixed(1)
            : '0.0',
          avgProcessingMs: Math.round(Number(totals?.avgProcessingMs ?? 0)),
        },
        dailyCosts: dailyCosts.map((d: { date: string; calls: number; tokens: number; costUsd: string }) => ({
          date: d.date,
          calls: Number(d.calls),
          tokens: Number(d.tokens),
          costUsd: parseFloat(d.costUsd ?? '0').toFixed(4),
        })),
        agentCosts: agentCosts.map((a: { agentName: string; calls: number; tokens: number; costUsd: string }) => ({
          agentName: a.agentName,
          calls: Number(a.calls),
          tokens: Number(a.tokens),
          costUsd: parseFloat(a.costUsd ?? '0').toFixed(4),
        })),
        taskTypeCosts: taskTypeCosts.map((t: { taskType: string | null; calls: number; tokens: number; costUsd: string }) => ({
          taskType: t.taskType ?? 'other',
          calls: Number(t.calls),
          tokens: Number(t.tokens),
          costUsd: parseFloat(t.costUsd ?? '0').toFixed(4),
        })),
        recentLogs: recentLogs.map((l: typeof recentLogs[number]) => ({
          id: l.id,
          agentName: l.agentName,
          taskType: l.taskType,
          model: l.model,
          inputTokens: l.inputTokens,
          outputTokens: l.outputTokens,
          totalTokens: l.totalTokens,
          estimatedCostUsd: l.estimatedCostUsd,
          wasFromCache: l.wasFromCache,
          processingTimeMs: l.processingTimeMs,
          createdAt: l.createdAt,
        })),
      };
    }),

  // Round 80.15-G: LLM cost report — reads per-day Redis stats hashes
  // (written by server/_core/llm.ts bumpStat) so a solo founder can see
  // "what's AI burning today?" without joining DB tables.
  //
  // Redis schema: HGETALL llm:stats:YYYY-MM-DD
  //   input:<model>            input tokens for that model
  //   output:<model>           output tokens for that model
  //   prompt_cache_read        Anthropic prompt-cache read tokens (10% cost)
  //   prompt_cache_write       Anthropic prompt-cache write tokens (125% cost)
  //   cache_hit / cache_miss   app-level llmCache hit counters (call counts, NOT tokens)
  //   calls_total              total API calls
  //   circuit_opened           breaker trip count
  //
  // Pricing rates (USD per 1M tokens):
  //   Haiku  in $1   / out $5
  //   Sonnet in $3   / out $15
  //   Opus   in $15  / out $75
  //   Cache read = input × 0.10
  //   Cache write = input × 1.25
  llmCostReport: adminProcedure
    .input(z.object({
      days: z.number().int().min(1).max(30).default(7),
    }))
    .query(async ({ input }) => {
      const { redis } = await import("../redis");

      // Pricing per 1K tokens for easier math (1/1000 of per-1M rate).
      const RATES_PER_K: Record<string, { in: number; out: number }> = {
        haiku:  { in: 0.001,  out: 0.005  },
        sonnet: { in: 0.003,  out: 0.015  },
        opus:   { in: 0.015,  out: 0.075  },
      };
      const CACHE_READ_MULT = 0.10;
      const CACHE_WRITE_MULT = 1.25;

      function classifyModel(model: string): "haiku" | "sonnet" | "opus" | null {
        const m = model.toLowerCase();
        if (m.includes("haiku")) return "haiku";
        if (m.includes("sonnet")) return "sonnet";
        if (m.includes("opus")) return "opus";
        return null;
      }

      function inputCostPerK(model: string): number {
        const tier = classifyModel(model);
        if (!tier) return RATES_PER_K.sonnet.in; // safe default
        return RATES_PER_K[tier].in;
      }

      function outputCostPerK(model: string): number {
        const tier = classifyModel(model);
        if (!tier) return RATES_PER_K.sonnet.out;
        return RATES_PER_K[tier].out;
      }

      // Build list of UTC date strings (newest first) — matches the
      // YYYY-MM-DD format that bumpStat() writes.
      const dates: string[] = [];
      const today = new Date();
      for (let i = 0; i < input.days; i++) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        dates.push(d.toISOString().slice(0, 10));
      }

      type ModelRow = {
        model: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        costUSD: number;
      };
      type DayRow = {
        date: string;
        callsTotal: number;
        cacheHits: number;
        cacheMisses: number;
        circuitOpened: number;
        perModel: ModelRow[];
        totalUSD: number;
      };

      const days: DayRow[] = [];
      let totalUSD = 0;
      let totalCalls = 0;
      let totalCacheHits = 0;
      let totalCacheMisses = 0;

      for (const date of dates) {
        const key = `llm:stats:${date}`;
        let raw: Record<string, string> = {};
        try {
          raw = (await redis.hgetall(key)) as Record<string, string>;
        } catch {
          raw = {};
        }

        const callsTotal = Number(raw.calls_total ?? 0);
        const cacheHits = Number(raw.cache_hit ?? 0);
        const cacheMisses = Number(raw.cache_miss ?? 0);
        const circuitOpened = Number(raw.circuit_opened ?? 0);
        const promptCacheRead = Number(raw.prompt_cache_read ?? 0);
        const promptCacheWrite = Number(raw.prompt_cache_write ?? 0);

        // Aggregate input:<model> and output:<model> by model name.
        const modelMap = new Map<string, ModelRow>();
        const ensure = (model: string): ModelRow => {
          let row = modelMap.get(model);
          if (!row) {
            row = {
              model,
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUSD: 0,
            };
            modelMap.set(model, row);
          }
          return row;
        };

        for (const [field, value] of Object.entries(raw)) {
          const n = Number(value ?? 0);
          if (!Number.isFinite(n) || n <= 0) continue;
          if (field.startsWith("input:")) {
            const model = field.slice("input:".length);
            ensure(model).inputTokens += n;
          } else if (field.startsWith("output:")) {
            const model = field.slice("output:".length);
            ensure(model).outputTokens += n;
          }
        }

        // Spread prompt-cache tokens across the day's models in proportion
        // to their input share. Anthropic stats don't tell us per-model
        // cache split, but the assumption (cache follows where input goes)
        // is good enough for a single-tenant cost view.
        const totalInput = Array.from(modelMap.values()).reduce(
          (acc, r) => acc + r.inputTokens, 0
        );
        if (totalInput > 0) {
          for (const row of modelMap.values()) {
            const share = row.inputTokens / totalInput;
            row.cacheReadTokens = Math.round(promptCacheRead * share);
            row.cacheWriteTokens = Math.round(promptCacheWrite * share);
          }
        } else if (promptCacheRead > 0 || promptCacheWrite > 0) {
          // No model-tagged input but we did see cache activity — bucket
          // it under "unknown" so it surfaces somewhere.
          const row = ensure("unknown");
          row.cacheReadTokens = promptCacheRead;
          row.cacheWriteTokens = promptCacheWrite;
        }

        // Cost per model.
        let dayUSD = 0;
        for (const row of modelMap.values()) {
          const inK  = inputCostPerK(row.model);
          const outK = outputCostPerK(row.model);
          const baseInputCost  = (row.inputTokens / 1000)  * inK;
          const outputCost     = (row.outputTokens / 1000) * outK;
          const cacheReadCost  = (row.cacheReadTokens  / 1000) * inK * CACHE_READ_MULT;
          const cacheWriteCost = (row.cacheWriteTokens / 1000) * inK * CACHE_WRITE_MULT;
          row.costUSD = baseInputCost + outputCost + cacheReadCost + cacheWriteCost;
          dayUSD += row.costUSD;
        }

        // Sort models so the most expensive shows first.
        const perModel = Array.from(modelMap.values()).sort(
          (a, b) => b.costUSD - a.costUSD
        );

        days.push({
          date,
          callsTotal,
          cacheHits,
          cacheMisses,
          circuitOpened,
          perModel,
          totalUSD: dayUSD,
        });

        totalUSD += dayUSD;
        totalCalls += callsTotal;
        totalCacheHits += cacheHits;
        totalCacheMisses += cacheMisses;
      }

      const cacheLookups = totalCacheHits + totalCacheMisses;
      const cacheHitRate = cacheLookups > 0 ? totalCacheHits / cacheLookups : 0;

      return {
        totalUSD,
        totalCalls,
        totalCacheHits,
        cacheHitRate,
        days, // already newest-first
      };
    }),
});
