import { EventEmitter } from 'events';
import { Transaction } from '../types/block.types';
import { Worker } from 'worker_threads';
import { performance } from 'perf_hooks';

export interface ProcessorConfig {
  maxWorkers: number;
  workerTimeout: number;
  enableLoadBalancing: boolean;
  enableHealthCheck: boolean;
  healthCheckInterval: number;
  maxRetries: number;
  retryDelay: number;
  enableMetrics: boolean;
}

export interface ProcessingTask {
  id: string;
  data: any;
  priority: number;
  timestamp: number;
  retries: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  result?: any;
  error?: string;
  workerId?: number;
}

export interface WorkerInfo {
  id: number;
  worker: Worker;
  status: 'IDLE' | 'BUSY' | 'FAILED';
  currentTask?: ProcessingTask;
  tasksProcessed: number;
  averageProcessingTime: number;
  lastUsed: number;
  errors: number;
  memoryUsage: number;
}

export interface ProcessingResult {
  taskId: string;
  success: boolean;
  result?: any;
  error?: string;
  processingTime: number;
  workerId: number;
}

export interface LoadBalancingStrategy {
  selectWorker(workers: WorkerInfo[]): WorkerInfo | null;
  updateWorkerPerformance(workerId: number, processingTime: number): void;
}

/**
 * Parallel processing system for high-volume transaction processing
 * Implements worker threads, load balancing, and health monitoring
 */
export class ParallelProcessor extends EventEmitter {
  private config: ProcessorConfig;
  private workers: Map<number, WorkerInfo> = new Map();
  private taskQueue: ProcessingTask[] = [];
  private processingTasks: Map<string, ProcessingTask> = new Map();
  private loadBalancer: LoadBalancingStrategy;
  private taskIdCounter: number = 0;
  private healthCheckTimer?: NodeJS.Timeout;
  private metricsTimer?: NodeJS.Timeout;

  constructor(config: Partial<ProcessorConfig> = {}) {
    super();
    
    this.config = {
      maxWorkers: 4,
      workerTimeout: 30000, // 30 seconds
      enableLoadBalancing: true,
      enableHealthCheck: true,
      healthCheckInterval: 10000, // 10 seconds
      maxRetries: 3,
      retryDelay: 1000,
      enableMetrics: true,
      ...config
    };

    this.loadBalancer = new RoundRobinLoadBalancer();
    this.initializeWorkers();
    
    if (this.config.enableHealthCheck) {
      this.startHealthCheck();
    }
    
    if (this.config.enableMetrics) {
      this.startMetricsCollection();
    }
  }

  /**
   * Initialize worker threads
   */
  private initializeWorkers(): void {
    for (let i = 0; i < this.config.maxWorkers; i++) {
      this.createWorker(i);
    }
  }

  /**
   * Create a new worker
   */
  private createWorker(workerId: number): void {
    // In a real implementation, this would create actual Worker threads
    // For now, we'll simulate workers
    const mockWorker = {
      postMessage: () => {},
      on: () => {},
      terminate: () => Promise.resolve(),
      ref: () => {},
      unref: () => {}
    } as any;

    const workerInfo: WorkerInfo = {
      id: workerId,
      worker: mockWorker,
      status: 'IDLE',
      tasksProcessed: 0,
      averageProcessingTime: 0,
      lastUsed: Date.now(),
      errors: 0,
      memoryUsage: 0
    };

    this.workers.set(workerId, workerInfo);
    
    // Set up worker event handlers
    this.setupWorkerEventHandlers(workerId);
  }

  /**
   * Set up worker event handlers
   */
  private setupWorkerEventHandlers(workerId: number): void {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    // In a real implementation, this would handle actual worker events
    // For now, we'll simulate the event handling
  }

  /**
   * Process task in parallel
   * @param data - Task data
   * @param priority - Task priority (higher = more important)
   * @returns Task ID
   */
  public processTask(data: any, priority: number = 0): string {
    const taskId = this.generateTaskId();
    
    const task: ProcessingTask = {
      id: taskId,
      data,
      priority,
      timestamp: Date.now(),
      retries: 0,
      status: 'PENDING'
    };

    this.taskQueue.push(task);
    this.processingTasks.set(taskId, task);

    // Sort queue by priority
    this.taskQueue.sort((a, b) => b.priority - a.priority);

    // Process next task
    this.processNextTask();

    return taskId;
  }

  /**
   * Process multiple tasks in parallel
   * @param tasks - Array of task data
   * @param priority - Task priority
   * @returns Array of task IDs
   */
  public processTasks(tasks: any[], priority: number = 0): string[] {
    const taskIds: string[] = [];
    
    for (const taskData of tasks) {
      const taskId = this.processTask(taskData, priority);
      taskIds.push(taskId);
    }

    return taskIds;
  }

  /**
   * Process next task in queue
   */
  private async processNextTask(): Promise<void> {
    if (this.taskQueue.length === 0) {
      return;
    }

    const availableWorker = this.getAvailableWorker();
    if (!availableWorker) {
      return; // No workers available
    }

    const task = this.taskQueue.shift()!;
    task.status = 'PROCESSING';
    task.workerId = availableWorker.id;
    availableWorker.currentTask = task;
    availableWorker.status = 'BUSY';
    availableWorker.lastUsed = Date.now();

    this.emit('taskStarted', {
      taskId: task.id,
      workerId: availableWorker.id,
      timestamp: Date.now()
    });

    try {
      const result = await this.executeTask(task, availableWorker);
      this.handleTaskSuccess(task, result, availableWorker);
    } catch (error) {
      this.handleTaskError(task, error, availableWorker);
    }
  }

  /**
   * Execute task on worker
   */
  private async executeTask(task: ProcessingTask, workerInfo: WorkerInfo): Promise<ProcessingResult> {
    const startTime = performance.now();

    return new Promise((resolve, reject) => {
      // Simulate task execution
      // In a real implementation, this would send the task to the worker thread
      setTimeout(() => {
        const processingTime = performance.now() - startTime;
        
        // Simulate success/failure
        if (Math.random() > 0.1) { // 90% success rate
          resolve({
            taskId: task.id,
            success: true,
            result: this.processTaskData(task.data),
            processingTime,
            workerId: workerInfo.id
          });
        } else {
          reject(new Error('Task execution failed'));
        }
      }, Math.random() * 1000 + 100); // Random processing time
    });
  }

  /**
   * Process task data (simulation)
   */
  private processTaskData(data: any): any {
    // Simulate processing
    if (typeof data === 'object' && data.type === 'transaction') {
      return {
        processed: true,
        hash: `processed_${Date.now()}`,
        timestamp: Date.now()
      };
    }
    
    return {
      processed: true,
      result: data,
      timestamp: Date.now()
    };
  }

  /**
   * Handle task success
   */
  private handleTaskSuccess(task: ProcessingTask, result: ProcessingResult, workerInfo: WorkerInfo): void {
    task.status = 'COMPLETED';
    task.result = result.result;
    
    workerInfo.status = 'IDLE';
    workerInfo.currentTask = undefined;
    workerInfo.tasksProcessed++;
    workerInfo.averageProcessingTime = 
      (workerInfo.averageProcessingTime * (workerInfo.tasksProcessed - 1) + result.processingTime) / 
      workerInfo.tasksProcessed;

    // Update load balancer
    this.loadBalancer.updateWorkerPerformance(workerInfo.id, result.processingTime);

    this.emit('taskCompleted', {
      taskId: task.id,
      result,
      workerId: workerInfo.id,
      processingTime: result.processingTime
    });

    // Process next task
    this.processNextTask();
  }

  /**
   * Handle task error
   */
  private handleTaskError(task: ProcessingTask, error: any, workerInfo: WorkerInfo): void {
    task.retries++;
    workerInfo.errors++;

    if (task.retries < this.config.maxRetries) {
      // Retry task
      task.status = 'PENDING';
      task.timestamp = Date.now();
      this.taskQueue.unshift(task); // Add to front of queue
      
      setTimeout(() => {
        this.processNextTask();
      }, this.config.retryDelay);
    } else {
      // Mark as failed
      task.status = 'FAILED';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      
      workerInfo.status = 'IDLE';
      workerInfo.currentTask = undefined;

      this.emit('taskFailed', {
        taskId: task.id,
        error: task.error,
        workerId: workerInfo.id,
        retries: task.retries
      });
    }

    // Process next task
    this.processNextTask();
  }

  /**
   * Get available worker
   */
  private getAvailableWorker(): WorkerInfo | null {
    const availableWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'IDLE');

    if (availableWorkers.length === 0) {
      return null;
    }

    if (this.config.enableLoadBalancing) {
      return this.loadBalancer.selectWorker(availableWorkers);
    }

    // Return first available worker
    return availableWorkers[0];
  }

  /**
   * Generate task ID
   */
  private generateTaskId(): string {
    return `task_${++this.taskIdCounter}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start health check
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health check on workers
   */
  private performHealthCheck(): void {
    const now = Date.now();
    
    for (const [workerId, workerInfo] of this.workers.entries()) {
      // Check if worker is stuck
      if (workerInfo.status === 'BUSY' && workerInfo.currentTask) {
        const taskDuration = now - workerInfo.currentTask.timestamp;
        
        if (taskDuration > this.config.workerTimeout) {
          // Worker is stuck, restart it
          this.restartWorker(workerId);
        }
      }

      // Check if worker is idle for too long
      if (workerInfo.status === 'IDLE' && now - workerInfo.lastUsed > 60000) {
        // Worker has been idle for 1 minute
        this.emit('workerIdle', {
          workerId,
          idleTime: now - workerInfo.lastUsed
        });
      }
    }
  }

  /**
   * Restart worker
   */
  private restartWorker(workerId: number): void {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    this.emit('workerRestart', {
      workerId,
      reason: 'timeout',
      tasksProcessed: workerInfo.tasksProcessed,
      errors: workerInfo.errors
    });

    // Terminate old worker
    workerInfo.worker.terminate?.();

    // Create new worker
    this.createWorker(workerId);
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, 5000); // Collect every 5 seconds
  }

  /**
   * Collect performance metrics
   */
  private collectMetrics(): void {
    const metrics = {
      totalWorkers: this.workers.size,
      busyWorkers: Array.from(this.workers.values()).filter(w => w.status === 'BUSY').length,
      idleWorkers: Array.from(this.workers.values()).filter(w => w.status === 'IDLE').length,
      failedWorkers: Array.from(this.workers.values()).filter(w => w.status === 'FAILED').length,
      queuedTasks: this.taskQueue.length,
      processingTasks: Array.from(this.processingTasks.values()).filter(t => t.status === 'PROCESSING').length,
      averageProcessingTime: this.calculateAverageProcessingTime(),
      totalTasksProcessed: this.calculateTotalTasksProcessed(),
      errorRate: this.calculateErrorRate()
    };

    this.emit('metricsCollected', metrics);
  }

  /**
   * Calculate average processing time
   */
  private calculateAverageProcessingTime(): number {
    const workers = Array.from(this.workers.values());
    if (workers.length === 0) return 0;

    const totalTime = workers.reduce((sum, worker) => sum + worker.averageProcessingTime, 0);
    return totalTime / workers.length;
  }

  /**
   * Calculate total tasks processed
   */
  private calculateTotalTasksProcessed(): number {
    return Array.from(this.workers.values())
      .reduce((sum, worker) => sum + worker.tasksProcessed, 0);
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(): number {
    const totalTasks = this.calculateTotalTasksProcessed();
    const totalErrors = Array.from(this.workers.values())
      .reduce((sum, worker) => sum + worker.errors, 0);

    return totalTasks > 0 ? totalErrors / totalTasks : 0;
  }

  /**
   * Get task status
   */
  public getTaskStatus(taskId: string): ProcessingTask | null {
    return this.processingTasks.get(taskId) || null;
  }

  /**
   * Get all tasks
   */
  public getAllTasks(): ProcessingTask[] {
    return Array.from(this.processingTasks.values());
  }

  /**
   * Get worker information
   */
  public getWorkerInfo(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get processor statistics
   */
  public getStats(): {
    workers: number;
    queuedTasks: number;
    processingTasks: number;
    completedTasks: number;
    failedTasks: number;
    averageProcessingTime: number;
    errorRate: number;
  } {
    const tasks = Array.from(this.processingTasks.values());
    
    return {
      workers: this.workers.size,
      queuedTasks: this.taskQueue.length,
      processingTasks: tasks.filter(t => t.status === 'PROCESSING').length,
      completedTasks: tasks.filter(t => t.status === 'COMPLETED').length,
      failedTasks: tasks.filter(t => t.status === 'FAILED').length,
      averageProcessingTime: this.calculateAverageProcessingTime(),
      errorRate: this.calculateErrorRate()
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ProcessorConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart health check with new interval
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      if (this.config.enableHealthCheck) {
        this.startHealthCheck();
      }
    }

    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): ProcessorConfig {
    return { ...this.config };
  }

  /**
   * Stop the parallel processor
   */
  public stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    // Terminate all workers
    for (const [workerId, workerInfo] of this.workers.entries()) {
      workerInfo.worker.terminate?.();
    }
    
    this.workers.clear();
    this.taskQueue = [];
    this.processingTasks.clear();
    
    this.emit('stopped');
  }
}

/**
 * Round-robin load balancing strategy
 */
class RoundRobinLoadBalancer implements LoadBalancingStrategy {
  private currentIndex: number = 0;

  selectWorker(workers: WorkerInfo[]): WorkerInfo | null {
    if (workers.length === 0) {
      return null;
    }

    const worker = workers[this.currentIndex % workers.length];
    this.currentIndex++;
    
    return worker;
  }

  updateWorkerPerformance(workerId: number, processingTime: number): void {
    // Round-robin doesn't use performance data
  }
}

/**
 * Least-loaded load balancing strategy
 */
class LeastLoadedLoadBalancer implements LoadBalancingStrategy {
  selectWorker(workers: WorkerInfo[]): WorkerInfo | null {
    if (workers.length === 0) {
      return null;
    }

    return workers.reduce((least, current) => 
      current.tasksProcessed < least.tasksProcessed ? current : least
    );
  }

  updateWorkerPerformance(workerId: number, processingTime: number): void {
    // Least-loaded doesn't use performance data
  }
}

/**
 * Performance-based load balancing strategy
 */
class PerformanceBasedLoadBalancer implements LoadBalancingStrategy {
  private workerPerformance: Map<number, number> = new Map();

  selectWorker(workers: WorkerInfo[]): WorkerInfo | null {
    if (workers.length === 0) {
      return null;
    }

    return workers.reduce((best, current) => {
      const currentPerf = this.workerPerformance.get(current.id) || 0;
      const bestPerf = this.workerPerformance.get(best.id) || 0;
      
      return currentPerf > bestPerf ? current : best;
    });
  }

  updateWorkerPerformance(workerId: number, processingTime: number): void {
    const current = this.workerPerformance.get(workerId) || 0;
    this.workerPerformance.set(workerId, (current + processingTime) / 2);
  }
}
