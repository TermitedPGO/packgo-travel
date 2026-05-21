/**
 * Pipeline Phase 3: Color Theme Generation
 *
 * Extracted from masterAgent.ts during v2 Wave 2 Module 2.9 split.
 *
 * Runs the ColorThemeAgent against the destination city/country. Cache-aware
 * (7-day TTL by destination key). ImagePromptAgent has been removed for
 * speed optimization — editors will manage images manually downstream.
 */

import { createChildLogger } from "../../_core/logger";
import { progressTracker } from "../progressTracker";
import { logAgentStart, logAgentComplete } from "../../agentActivityService";
import generationCache from "../../cache/generation-cache";
import type { AgentDeps, PhaseTimer, ProgressCallback } from "./types";

const log = createChildLogger({ module: "masterAgent/colorTheme" });

export interface ColorThemePhaseInput {
  rawData: any;
  forceRegenerate: boolean;
  taskId?: string;
  userId?: number;
  onProgress?: ProgressCallback;
  deps: AgentDeps;
  phaseTimer: PhaseTimer;
}

export async function runColorThemePhase(input: ColorThemePhaseInput): Promise<any> {
  const { rawData, forceRegenerate, taskId, userId, onProgress, deps, phaseTimer } = input;

  // ========================================================================
  // Phase 3: ColorTheme ONLY (ImagePrompt removed for speed optimization)
  // Image generation is skipped - editors will manage images manually
  // ========================================================================
  phaseTimer.start('P3_colorTheme');
  onProgress?.("generating_themes", 40);
  console.log("[MasterAgent] Starting Phase 3: ColorTheme only (image generation disabled)");

  deps.monitor.startAgent('ColorThemeAgent');
  if (taskId) {
    progressTracker.startPhase(taskId, 'color_theme');
    // Skip image_prompt phase - mark as complete immediately
    progressTracker.startPhase(taskId, 'image_prompt');
    progressTracker.completePhase(taskId, 'image_prompt');
  }

  // Check for cached color palette first (skip if forceRegenerate)
  const destination = rawData.location?.destinationCity || rawData.location?.destinationCountry || "";
  let colorTheme;
  const cachedPalette = forceRegenerate ? null : await generationCache.getColorPalette(destination);

  // Run ColorTheme only
  const colorThemeResult = cachedPalette
    ? { success: true, data: cachedPalette }
    : await deps.retryManager.executeWithRetry(
        () => deps.colorThemeAgent.execute(
          rawData.location?.destinationCountry || "",
          rawData.location?.destinationCity
        ),
        deps.retryConfig,
        'ColorThemeAgent'
      );

  // Handle ColorThemeAgent result
  if (!colorThemeResult.success || !colorThemeResult.data) {
    const errorMsg = (colorThemeResult as any).error || "Color theme generation failed";
    deps.monitor.failAgent('ColorThemeAgent', new Error(errorMsg));
    throw new Error(errorMsg);
  }

  if (cachedPalette) {
    console.log("[MasterAgent] 🎯 Color palette cache HIT!");
  } else {
    // Cache the color palette (7 days TTL)
    await generationCache.cacheColorPalette(destination, colorThemeResult.data);
  }

  deps.monitor.completeAgent('ColorThemeAgent', colorThemeResult);
  if (taskId) progressTracker.completePhase(taskId, 'color_theme');
  colorTheme = colorThemeResult.data;
  // 記錄 ColorThemeAgent 詳細工作
  try {
    const colorActivityId = await logAgentStart({
      agentName: 'ColorThemeAgent',
      agentKey: 'colordesk',
      taskType: 'tour_generation',
      taskId: taskId,
      taskTitle: `生成配色方案：${destination || '未知目的地'}`,
      userId,
    });
    if (colorActivityId) await logAgentComplete(colorActivityId, {
      status: 'completed',
      resultSummary: `🎨 ${cachedPalette ? '（快取命中）' : ''}為「${destination}」生成配色方案，主色 ${colorTheme?.primary || 'N/A'}，輔色 ${colorTheme?.secondary || 'N/A'}`,
    });
  } catch (logErr) {
    log.warn({ event: "phase3.activity_log_failed", err: logErr }, "Failed to log ColorThemeAgent activity");
    console.warn('[MasterAgent] Failed to log ColorThemeAgent activity:', logErr);
  }

  // 漸進式結果：更新配色方案
  if (taskId) {
    progressTracker.updatePartialResults(taskId, {
      colorTheme: colorTheme,
    });
  }

  // Skip ImagePromptAgent - editors will manage images
  console.log("[MasterAgent] Skipping ImagePromptAgent - editors will manage images");

  phaseTimer.end('P3_colorTheme');
  console.log("[MasterAgent] ✓ Phase 3 completed: ColorTheme only");

  return colorTheme;
}
