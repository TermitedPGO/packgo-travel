/**
 * 進度追蹤管理器
 * 用於追蹤 AI 自動生成行程的進度，並透過 SSE 即時回報給前端
 *
 * v80.24: now Redis-backed in addition to in-memory Map. The audit found
 * the previous in-memory-only design had three failure modes:
 *   1. Worker restart mid-generation → frontend polls forever, never gets
 *      partial results.
 *   2. Multi-worker production → only the worker that handled the task
 *      knows the progress; other workers' API responses are blank.
 *   3. Memory leak → tasks never auto-cleaned, Map grows forever.
 *
 * Strategy: write-through to Redis on every state change with TTL=1h.
 * EventEmitter is still used for in-process SSE subscribers (no change for
 * the happy path). On `getProgress` we check Redis if the local Map misses.
 *
 * Redis keys: `progress:{taskId}` → JSON-serialized GenerationProgress.
 */

import { EventEmitter } from 'events';
import { redis } from '../redis';

const REDIS_KEY_PREFIX = 'progress:';
const REDIS_TTL_SECONDS = 60 * 60; // 1 hour past last update

// Agent 執行階段定義
export interface AgentPhase {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  startTime?: number;
  endTime?: number;
  duration?: number;
  error?: string;
}

// 漸進式結果類型
export interface PartialResults {
  title?: string;
  poeticTitle?: string;
  destination?: string;
  colorTheme?: any;
  heroImage?: string;
  highlights?: string[];
  itinerary?: any[];
}

// 整體進度狀態
export interface GenerationProgress {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentPhase: string;
  overallProgress: number; // 0-100
  phases: AgentPhase[];
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  error?: string;
  partialResults?: PartialResults; // 漸進式結果
}

// 進度事件類型
export type ProgressEvent = {
  type: 'phase_start' | 'phase_progress' | 'phase_complete' | 'phase_error' | 'overall_progress' | 'generation_complete' | 'generation_error';
  taskId: string;
  data: Partial<GenerationProgress>;
};

// 預設的 Agent 階段配置
export const DEFAULT_PHASES: Omit<AgentPhase, 'status' | 'progress'>[] = [
  { id: 'web_scraper', name: '網頁爬取', description: '從來源網站提取行程資訊' },
  { id: 'dynamic_render', name: '動態渲染', description: '使用 Puppeteer 動態渲染網頁' },
  { id: 'date_extractor', name: 'AI 日期抽取', description: 'AI Vision 分析截圖，抽取出發日期/人數/價格' },
  { id: 'content_analyzer', name: '內容分析', description: '分析並結構化行程資料' },
  { id: 'color_theme', name: '配色主題', description: '生成行程配色方案' },
  { id: 'image_prompt', name: '圖片提示', description: '生成圖片搜尋關鍵字' },
  { id: 'image_generation', name: '圖片生成', description: '搜尋並生成行程圖片' },
  { id: 'itinerary', name: '行程規劃', description: '生成詳細每日行程' },
  { id: 'cost_agent', name: '費用說明', description: '生成費用包含/不包含項目' },
  { id: 'notice_agent', name: '注意事項', description: '生成旅遊注意事項' },
  { id: 'hotel_agent', name: '住宿資訊', description: '生成住宿詳細資訊' },
  { id: 'meal_agent', name: '餐飲資訊', description: '生成餐飲詳細資訊' },
  { id: 'flight_agent', name: '航班資訊', description: '生成航班詳細資訊' },
  { id: 'finalize', name: '完成組裝', description: '組裝最終行程資料' },
  { id: 'calibration', name: 'QA 品質審查', description: '自動品質評分與審查' },
];

// 階段權重（用於計算整體進度）
const PHASE_WEIGHTS: Record<string, number> = {
  web_scraper: 15,
  dynamic_render: 8,
  date_extractor: 7,
  content_analyzer: 10,
  color_theme: 5,
  image_prompt: 5,
  image_generation: 15,
  itinerary: 20,
  cost_agent: 5,
  notice_agent: 5,
  hotel_agent: 5,
  meal_agent: 5,
  flight_agent: 5,
  finalize: 5,
  calibration: 5,
};

/**
 * Internal helper: persist current progress to Redis. Errors are swallowed
 * so a Redis blip never breaks generation — the in-memory Map is still
 * authoritative for the worker that owns the task.
 */
async function writeToRedis(taskId: string, progress: GenerationProgress): Promise<void> {
  try {
    await redis.set(
      `${REDIS_KEY_PREFIX}${taskId}`,
      JSON.stringify(progress),
      'EX',
      REDIS_TTL_SECONDS
    );
  } catch (err) {
    // Don't crash generation if Redis is briefly unavailable
    console.warn(`[progressTracker] Redis write failed for ${taskId}:`, (err as Error).message);
  }
}

/**
 * 進度追蹤器類別
 */
export class ProgressTracker extends EventEmitter {
  private progresses: Map<string, GenerationProgress> = new Map();

  /**
   * 創建新的生成任務
   */
  createTask(taskId: string): GenerationProgress {
    const phases: AgentPhase[] = DEFAULT_PHASES.map(phase => ({
      ...phase,
      status: 'pending',
      progress: 0,
    }));
    
    const progress: GenerationProgress = {
      taskId,
      status: 'pending',
      currentPhase: '',
      overallProgress: 0,
      phases,
      startTime: Date.now(),
      partialResults: {}, // 初始化漸進式結果
    };
    
    this.progresses.set(taskId, progress);
    void writeToRedis(taskId, progress);
    return progress;
  }

  /**
   * 更新漸進式結果
   */
  updatePartialResults(taskId: string, results: Partial<PartialResults>): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;

    progress.partialResults = {
      ...progress.partialResults,
      ...results,
    };

    void writeToRedis(taskId, progress);
    this.emitProgress(taskId, 'phase_progress');
  }
  
  /**
   * 開始某個階段
   */
  startPhase(taskId: string, phaseId: string): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;
    
    const phase = progress.phases.find(p => p.id === phaseId);
    if (!phase) return;
    
    phase.status = 'running';
    phase.startTime = Date.now();
    phase.progress = 0;

    progress.status = 'running';
    progress.currentPhase = phaseId;

    void writeToRedis(taskId, progress);
    this.emitProgress(taskId, 'phase_start');
  }

  /**
   * 更新階段進度
   */
  updatePhaseProgress(taskId: string, phaseId: string, phaseProgress: number): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;

    const phase = progress.phases.find(p => p.id === phaseId);
    if (!phase) return;

    phase.progress = Math.min(100, Math.max(0, phaseProgress));

    this.recalculateOverallProgress(taskId);
    void writeToRedis(taskId, progress);
    this.emitProgress(taskId, 'phase_progress');
  }

  /**
   * 完成某個階段
   */
  completePhase(taskId: string, phaseId: string): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;

    const phase = progress.phases.find(p => p.id === phaseId);
    if (!phase) return;

    phase.status = 'completed';
    phase.progress = 100;
    phase.endTime = Date.now();
    phase.duration = phase.startTime ? phase.endTime - phase.startTime : 0;

    this.recalculateOverallProgress(taskId);
    void writeToRedis(taskId, progress);
    this.emitProgress(taskId, 'phase_complete');
  }

  /**
   * 標記階段失敗
   */
  failPhase(taskId: string, phaseId: string, error: string): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;

    const phase = progress.phases.find(p => p.id === phaseId);
    if (!phase) return;

    phase.status = 'failed';
    phase.endTime = Date.now();
    phase.duration = phase.startTime ? phase.endTime - phase.startTime : 0;
    phase.error = error;

    this.recalculateOverallProgress(taskId);
    void writeToRedis(taskId, progress);
    this.emitProgress(taskId, 'phase_error');
  }

  /**
   * 完成整個生成任務
   */
  completeTask(taskId: string): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;

    progress.status = 'completed';
    progress.overallProgress = 100;
    progress.endTime = Date.now();
    progress.totalDuration = progress.endTime - progress.startTime;

    void writeToRedis(taskId, progress);
    this.emitProgress(taskId, 'generation_complete');
  }

  /**
   * 標記整個任務失敗
   */
  failTask(taskId: string, error: string): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;

    progress.status = 'failed';
    progress.error = error;
    progress.endTime = Date.now();
    progress.totalDuration = progress.endTime - progress.startTime;

    void writeToRedis(taskId, progress);
    this.emitProgress(taskId, 'generation_error');
  }

  /**
   * 獲取任務進度（in-memory; for Redis-backed cross-worker reads use
   * `getProgressAsync` instead — the routers layer should switch to that)
   */
  getProgress(taskId: string): GenerationProgress | undefined {
    return this.progresses.get(taskId);
  }

  /**
   * 跨 worker 讀取進度 — falls back to Redis if local Map miss.
   * v80.24: required for multi-worker production where the worker that
   * handled the job isn't the same one serving the polling API call.
   */
  async getProgressAsync(taskId: string): Promise<GenerationProgress | undefined> {
    const local = this.progresses.get(taskId);
    if (local) return local;

    try {
      const cached = await redis.get(`${REDIS_KEY_PREFIX}${taskId}`);
      if (cached) {
        return JSON.parse(cached) as GenerationProgress;
      }
    } catch (err) {
      console.warn(`[progressTracker] Redis read failed for ${taskId}:`, (err as Error).message);
    }
    return undefined;
  }

  /**
   * 刪除任務進度（清理）
   */
  removeTask(taskId: string): void {
    this.progresses.delete(taskId);
    redis.del(`${REDIS_KEY_PREFIX}${taskId}`).catch(() => { /* silent */ });
  }
  
  /**
   * 重新計算整體進度
   */
  private recalculateOverallProgress(taskId: string): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;
    
    let totalWeight = 0;
    let completedWeight = 0;
    
    for (const phase of progress.phases) {
      const weight = PHASE_WEIGHTS[phase.id] || 5;
      totalWeight += weight;
      
      if (phase.status === 'completed') {
        completedWeight += weight;
      } else if (phase.status === 'running') {
        completedWeight += (weight * phase.progress) / 100;
      }
    }
    
    progress.overallProgress = Math.round((completedWeight / totalWeight) * 100);
  }
  
  /**
   * 發送進度事件
   */
  private emitProgress(taskId: string, type: ProgressEvent['type']): void {
    const progress = this.progresses.get(taskId);
    if (!progress) return;
    
    const event: ProgressEvent = {
      type,
      taskId,
      data: { ...progress },
    };
    
    this.emit('progress', event);
    this.emit(`progress:${taskId}`, event);
  }
}

// 全局單例
export const progressTracker = new ProgressTracker();
