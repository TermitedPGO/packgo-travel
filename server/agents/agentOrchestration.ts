/**
 * Agent Orchestration Utilities
 * Provides task queue management, retry logic, and agent monitoring
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface Task {
  id: string;
  priority: 'high' | 'medium' | 'low';
  agentName: string;
  execute: () => Promise<any>;
  dependencies?: string[]; // Task IDs that must complete before this task
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  startTime?: number;
  endTime?: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // Base delay in milliseconds
  maxDelay: number;  // Maximum delay in milliseconds
  retryableErrors: string[]; // Error codes/messages that are retryable
}

export interface AgentStatus {
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  duration?: number;
  retryCount: number;
  error?: string;
}

export interface FallbackConfig {
  agentName: string;
  isCritical: boolean;
  fallbackData: any;
}

// ============================================================================
// Retry Manager
// ============================================================================

export class RetryManager {
  /**
   * Execute a function with retry logic
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig,
    agentName: string = 'Unknown'
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[RetryManager] Retry attempt ${attempt}/${config.maxRetries} for ${agentName}`);
        }
        
        const result = await fn();
        
        if (attempt > 0) {
          console.log(`[RetryManager] ${agentName} succeeded on attempt ${attempt + 1}`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // Check if error is retryable
        if (!this.isRetryableError(error as Error, config.retryableErrors)) {
          console.error(`[RetryManager] Non-retryable error for ${agentName}:`, error);
          throw error;
        }
        
        // If this was the last attempt, throw the error
        if (attempt === config.maxRetries) {
          console.error(`[RetryManager] ${agentName} failed after ${config.maxRetries} retries`);
          throw error;
        }
        
        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt, config.baseDelay, config.maxDelay);
        console.log(`[RetryManager] ${agentName} failed, retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }
    
    // This should never be reached, but TypeScript needs it
    throw lastError || new Error('Unexpected error in retry logic');
  }
  
  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error, retryableErrors: string[]): boolean {
    // Explicitly non-retryable errors (e.g., LLM 120s timeout)
    if ((error as any).nonRetryable === true) {
      console.log(`[RetryManager] Error marked as nonRetryable, skipping retry: ${error.message}`);
      return false;
    }
    
    const errorMessage = error.message || '';
    const errorCode = (error as any).code || '';
    
    // Check if error message or code matches any retryable patterns
    return retryableErrors.some(pattern => 
      errorMessage.includes(pattern) || errorCode === pattern
    );
  }
  
  /**
   * Calculate delay with exponential backoff
   */
  private calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
    // Exponential backoff: baseDelay * 2^attempt
    const delay = baseDelay * Math.pow(2, attempt);
    
    // Add jitter (random 0-20% variation) to avoid thundering herd
    const jitter = delay * 0.2 * Math.random();
    
    return Math.min(delay + jitter, maxDelay);
  }
  
  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Agent Monitor
// ============================================================================

export class AgentMonitor {
  private statuses: Map<string, AgentStatus> = new Map();
  
  /**
   * Mark agent as started
   */
  startAgent(agentName: string): void {
    this.statuses.set(agentName, {
      agentName,
      status: 'running',
      startTime: Date.now(),
      retryCount: 0
    });
    console.log(`[AgentMonitor] ${agentName} started`);
  }
  
  /**
   * Mark agent as completed
   */
  completeAgent(agentName: string, result: any): void {
    const status = this.statuses.get(agentName);
    if (!status) {
      console.warn(`[AgentMonitor] Agent ${agentName} not found in monitor`);
      return;
    }
    
    const endTime = Date.now();
    const duration = status.startTime ? endTime - status.startTime : 0;
    
    this.statuses.set(agentName, {
      ...status,
      status: 'completed',
      endTime,
      duration
    });
    
    console.log(`[AgentMonitor] ${agentName} completed in ${duration}ms`);
  }
  
  /**
   * Mark agent as failed
   */
  failAgent(agentName: string, error: Error): void {
    const status = this.statuses.get(agentName);
    if (!status) {
      console.warn(`[AgentMonitor] Agent ${agentName} not found in monitor`);
      return;
    }
    
    const endTime = Date.now();
    const duration = status.startTime ? endTime - status.startTime : 0;
    
    this.statuses.set(agentName, {
      ...status,
      status: 'failed',
      endTime,
      duration,
      error: error.message
    });
    
    console.error(`[AgentMonitor] ${agentName} failed after ${duration}ms:`, error.message);
  }
  
  /**
   * Increment retry count for agent
   */
  retryAgent(agentName: string): void {
    const status = this.statuses.get(agentName);
    if (!status) {
      console.warn(`[AgentMonitor] Agent ${agentName} not found in monitor`);
      return;
    }
    
    this.statuses.set(agentName, {
      ...status,
      retryCount: status.retryCount + 1
    });
    
    console.log(`[AgentMonitor] ${agentName} retry count: ${status.retryCount + 1}`);
  }
  
  /**
   * Get status of a specific agent
   */
  getStatus(agentName: string): AgentStatus | undefined {
    return this.statuses.get(agentName);
  }
  
  /**
   * Get all agent statuses
   */
  getAllStatuses(): AgentStatus[] {
    return Array.from(this.statuses.values());
  }
  
  /**
   * Generate a summary report
   */
  generateReport(): string {
    const statuses = this.getAllStatuses();
    
    const completed = statuses.filter(s => s.status === 'completed').length;
    const failed = statuses.filter(s => s.status === 'failed').length;
    const running = statuses.filter(s => s.status === 'running').length;
    const pending = statuses.filter(s => s.status === 'pending').length;
    
    const totalDuration = statuses
      .filter(s => s.duration)
      .reduce((sum, s) => sum + (s.duration || 0), 0);
    
    const report = [
      '=== Agent Execution Report ===',
      `Total Agents: ${statuses.length}`,
      `Completed: ${completed}`,
      `Failed: ${failed}`,
      `Running: ${running}`,
      `Pending: ${pending}`,
      `Total Duration: ${totalDuration}ms`,
      '',
      '=== Agent Details ===',
      ...statuses.map(s => {
        const duration = s.duration ? `${s.duration}ms` : 'N/A';
        const retries = s.retryCount > 0 ? ` (${s.retryCount} retries)` : '';
        const error = s.error ? ` - Error: ${s.error}` : '';
        return `- ${s.agentName}: ${s.status} (${duration})${retries}${error}`;
      })
    ];
    
    return report.join('\n');
  }
  
  /**
   * Reset all statuses
   */
  reset(): void {
    this.statuses.clear();
    console.log('[AgentMonitor] Reset all statuses');
  }
}

// ============================================================================
// Fallback Manager
// ============================================================================

export class FallbackManager {
  private configs: Map<string, FallbackConfig> = new Map();
  
  /**
   * Register a fallback configuration for an agent
   */
  registerFallback(config: FallbackConfig): void {
    this.configs.set(config.agentName, config);
    console.log(`[FallbackManager] Registered fallback for ${config.agentName} (critical: ${config.isCritical})`);
  }
  
  /**
   * Handle agent failure
   * Returns fallback data if agent is non-critical, otherwise throws error
   */
  handleFailure(agentName: string, error: Error): any {
    const config = this.configs.get(agentName);
    
    if (!config) {
      console.warn(`[FallbackManager] No fallback config for ${agentName}, treating as critical`);
      throw error;
    }
    
    if (config.isCritical) {
      console.error(`[FallbackManager] Critical agent ${agentName} failed, terminating process`);
      throw error;
    }
    
    console.warn(`[FallbackManager] Non-critical agent ${agentName} failed, using fallback data`);
    return config.fallbackData;
  }
  
  /**
   * Check if an agent is critical
   */
  isCriticalAgent(agentName: string): boolean {
    const config = this.configs.get(agentName);
    return config ? config.isCritical : true; // Default to critical if not configured
  }
  
  /**
   * Get fallback data for an agent
   */
  getFallbackData(agentName: string): any {
    const config = this.configs.get(agentName);
    return config ? config.fallbackData : null;
  }
}

// ============================================================================
// Task Queue (Simplified Version)
// ============================================================================

export class TaskQueue {
  private tasks: Map<string, Task> = new Map();
  private runningTasks: Set<string> = new Set();
  private maxConcurrent: number;
  
  constructor(maxConcurrent: number = 5) {
    this.maxConcurrent = maxConcurrent;
  }
  
  /**
   * Add a task to the queue
   */
  addTask(task: Task): void {
    this.tasks.set(task.id, task);
    console.log(`[TaskQueue] Added task: ${task.id} (${task.agentName})`);
  }
  
  /**
   * Execute a single task
   */
  async executeTask(taskId: string): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    // Check dependencies
    if (task.dependencies) {
      for (const depId of task.dependencies) {
        const depTask = this.tasks.get(depId);
        if (!depTask || depTask.status !== 'completed') {
          throw new Error(`Dependency ${depId} not completed for task ${taskId}`);
        }
      }
    }
    
    // Mark as running
    task.status = 'running';
    task.startTime = Date.now();
    this.runningTasks.add(taskId);
    
    try {
      const result = await task.execute();
      task.status = 'completed';
      task.result = result;
      task.endTime = Date.now();
      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = (error as Error).message;
      task.endTime = Date.now();
      throw error;
    } finally {
      this.runningTasks.delete(taskId);
    }
  }
  
  /**
   * Execute multiple tasks in parallel
   */
  async executeBatch(taskIds: string[]): Promise<any[]> {
    return Promise.all(taskIds.map(id => this.executeTask(id)));
  }
  
  /**
   * Get task status
   */
  getTaskStatus(taskId: string): Task['status'] | undefined {
    return this.tasks.get(taskId)?.status;
  }
  
  /**
   * Get all completed tasks
   */
  getCompletedTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'completed');
  }
  
  /**
   * Get all failed tasks
   */
  getFailedTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'failed');
  }
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default retry configuration for agents
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 8000,  // 8 seconds
  retryableErrors: [
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'ECONNREFUSED',
    // 'timeout' removed — LLM 120s timeouts should NOT be retried (4×120s = 8 min waste)
    'network',
    'fetch failed'
  ]
};

/**
 * Default fallback configurations for non-critical agents
 */
export const DEFAULT_FALLBACK_CONFIGS: FallbackConfig[] = [
  {
    agentName: 'CostAgent',
    isCritical: false,
    fallbackData: {
      included: [],
      excluded: [],
      notes: []
    }
  },
  {
    agentName: 'NoticeAgent',
    isCritical: false,
    fallbackData: {
      before: [],
      during: [],
      after: []
    }
  },
  {
    agentName: 'HotelAgent',
    isCritical: false,
    fallbackData: {
      hotels: []
    }
  },
  {
    agentName: 'MealAgent',
    isCritical: false,
    fallbackData: {
      meals: []
    }
  },
  {
    agentName: 'FlightAgent',
    isCritical: false,
    fallbackData: {
      outbound: null,
      inbound: null,
      notes: []
    }
  }
];
