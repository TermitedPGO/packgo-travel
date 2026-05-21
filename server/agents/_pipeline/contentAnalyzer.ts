/**
 * Pipeline Phase 2: Content Analysis (Critical, Sequential)
 *
 * Extracted from masterAgent.ts during v2 Wave 2 Module 2.9 split.
 *
 * Runs the ContentAnalyzerAgent to extract poetic title, highlights, key
 * features, and originality score. Must complete before image prompts and
 * downstream phases (Phase 3 onwards) can proceed.
 *
 * On failure, the supervisor will throw — content analysis is critical.
 */

import { createChildLogger } from "../../_core/logger";
import { progressTracker } from "../progressTracker";
import { logAgentStart, logAgentComplete } from "../../agentActivityService";
import type { AgentDeps, PhaseTimer, ProgressCallback } from "./types";

const log = createChildLogger({ module: "masterAgent/contentAnalyzer" });

export interface ContentAnalyzerPhaseInput {
  rawData: any;
  taskId?: string;
  userId?: number;
  onProgress?: ProgressCallback;
  deps: AgentDeps;
  phaseTimer: PhaseTimer;
}

export async function runContentAnalyzerPhase(input: ContentAnalyzerPhaseInput): Promise<any> {
  const { rawData, taskId, userId, onProgress, deps, phaseTimer } = input;

  // ========================================================================
  // Phase 2: Content Analysis + Lion Title (Critical, Sequential)
  // Must complete before image prompts can be generated
  // ========================================================================
  phaseTimer.start('P2_contentAnalyzer');
  onProgress?.("analyzing", 25);
  deps.monitor.startAgent('ContentAnalyzerAgent');
  if (taskId) progressTracker.startPhase(taskId, 'content_analyzer');

  // Run Content Analysis (includes poeticTitle generation)
  const analysisResult = await deps.retryManager.executeWithRetry(
    () => deps.contentAnalyzerAgent.execute(rawData),
    deps.retryConfig,
    'ContentAnalyzerAgent'
  );

  if (!analysisResult.success || !analysisResult.data) {
    deps.monitor.failAgent('ContentAnalyzerAgent', new Error(analysisResult.error || "Content analysis failed"));
    throw new Error(analysisResult.error || "Content analysis failed");
  }

  deps.monitor.completeAgent('ContentAnalyzerAgent', analysisResult);
  if (taskId) progressTracker.completePhase(taskId, 'content_analyzer');
  const analyzedContent = analysisResult.data;
  // 記錄 ContentAnalyzerAgent 詳細工作
  try {
    const analyzerActivityId = await logAgentStart({
      agentName: 'ContentAnalyzerAgent',
      agentKey: 'analyzer',
      taskType: 'tour_generation',
      taskId: taskId,
      taskTitle: `分析行程內容：${rawData.basicInfo?.title || rawData.location?.destinationCity || '未知目的地'}`,
      userId,
    });
    if (analyzerActivityId) await logAgentComplete(analyzerActivityId, {
      status: 'completed',
      resultSummary: `✅ 分析完成「${analyzedContent.poeticTitle || rawData.basicInfo?.title || ''}」→ 目的地：${rawData.location?.destinationCity || ''}${rawData.location?.destinationCountry ? ` · ${rawData.location.destinationCountry}` : ''}，亮點 ${analyzedContent.highlights?.length || 0} 項，原創性分數 ${analyzedContent.originalityScore || 'N/A'}`,
    });
  } catch (logErr) {
    log.warn({ event: "phase2.activity_log_failed", err: logErr }, "Failed to log ContentAnalyzerAgent activity");
    console.warn('[MasterAgent] Failed to log ContentAnalyzerAgent activity:', logErr);
  }

  // 漸進式結果：更新標題和目的地
  if (taskId) {
    progressTracker.updatePartialResults(taskId, {
      title: analyzedContent.poeticTitle,
      poeticTitle: analyzedContent.poeticTitle,
      destination: `${rawData.location?.destinationCity || ''}, ${rawData.location?.destinationCountry || ''}`,
      highlights: analyzedContent.highlights?.slice(0, 3),
    });
  }

  phaseTimer.end('P2_contentAnalyzer');
  console.log("[MasterAgent] ✓ Phase 2 completed: Content analysis + Lion title");
  console.log("[MasterAgent] Originality score:", analyzedContent.originalityScore);
  console.log("[MasterAgent] Poetic title:", analyzedContent.poeticTitle);

  return analyzedContent;
}
