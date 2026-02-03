import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { Block, Transaction } from '../types/block.types';

export interface MonitoringConfig {
  enabled: boolean;
  metricsInterval: number;
  retentionPeriod: number;
  enableAlerts: boolean;
  alertThresholds: AlertThresholds;
  enableProfiling: boolean;
  enableTracing: boolean;
  enableResourceMonitoring: boolean;
  enableCustomMetrics: boolean;
}

export interface AlertThresholds {
  transactionRate: number;
  blockTime: number;
  memoryUsage: number;
  cpuUsage: number;
  errorRate: number;
  responseTime: number;
  queueSize: number;
}

export interface PerformanceMetrics {
  timestamp: number;
  transactionsPerSecond: number;
  averageBlockTime: number;
  averageResponseTime: number;
  memoryUsage: number;
  cpuUsage: number;
  errorRate: number;
  queueSize: number;
  cacheHitRate: number;
  databaseConnections: number;
  networkLatency: number;
}

export interface PerformanceAlert {
  id: string;
  type: 'PERFORMANCE' | 'RESOURCE' | 'ERROR' | 'CAPACITY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  metric: string;
  currentValue: number;
  threshold: number;
  timestamp: number;
  resolved: boolean;
}

export interface PerformanceProfile {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  samples: PerformanceSample[];
  summary: ProfileSummary;
}

export interface PerformanceSample {
  timestamp: number;
  operation: string;
  duration: number;
  memoryBefore: number;
  memoryAfter: number;
  cpuUsage: number;
  stackTrace?: string;
}

export interface ProfileSummary {
  totalSamples: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  totalMemoryDelta: number;
  averageCpuUsage: number;
  operationCounts: Record<string, number>;
}

export interface CustomMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  tags: Record<string, string>;
}

/**
 * Performance monitoring system for high-volume ledger operations
 * Provides real-time metrics, alerting, profiling, and custom metrics
 */
export class PerformanceMonitor extends EventEmitter {
  private config: MonitoringConfig;
  private metrics: PerformanceMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private profiles: Map<string, PerformanceProfile> = new Map();
  private customMetrics: CustomMetric[] = [];
  private currentProfile?: PerformanceProfile;
  private metricsTimer?: NodeJS.Timeout;
  private alertTimer?: NodeJS.Timeout;
  private counters: Map<string, number> = new Map();
  private timers: Map<string, number> = new Map();

  constructor(config: Partial<MonitoringConfig> = {}) {
    super();
    
    this.config = {
      enabled: true,
      metricsInterval: 5000, // 5 seconds
      retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
      enableAlerts: true,
      alertThresholds: {
        transactionRate: 1000,
        blockTime: 5000,
        memoryUsage: 80, // 80%
        cpuUsage: 80, // 80%
        errorRate: 0.05, // 5%
        responseTime: 1000, // 1 second
        queueSize: 1000
      },
      enableProfiling: true,
      enableTracing: true,
      enableResourceMonitoring: true,
      enableCustomMetrics: true,
      ...config
    };

    if (this.config.enabled) {
      this.startMonitoring();
    }
  }

  /**
   * Start performance monitoring
   */
  private startMonitoring(): void {
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.metricsInterval);

    if (this.config.enableAlerts) {
      this.alertTimer = setInterval(() => {
        this.checkAlerts();
      }, 10000); // Check alerts every 10 seconds
    }

    this.emit('monitoringStarted');
  }

  /**
   * Collect performance metrics
   */
  private collectMetrics(): void {
    const metrics: PerformanceMetrics = {
      timestamp: Date.now(),
      transactionsPerSecond: this.calculateTransactionRate(),
      averageBlockTime: this.calculateAverageBlockTime(),
      averageResponseTime: this.calculateAverageResponseTime(),
      memoryUsage: this.getMemoryUsage(),
      cpuUsage: this.getCpuUsage(),
      errorRate: this.calculateErrorRate(),
      queueSize: this.getQueueSize(),
      cacheHitRate: this.getCacheHitRate(),
      databaseConnections: this.getDatabaseConnections(),
      networkLatency: this.getNetworkLatency()
    };

    this.metrics.push(metrics);
    this.cleanupOldMetrics();

    this.emit('metricsCollected', metrics);
  }

  /**
   * Calculate transaction rate
   */
  private calculateTransactionRate(): number {
    const txCount = this.counters.get('transactions') || 0;
    const timeWindow = this.config.metricsInterval / 1000; // Convert to seconds
    return txCount / timeWindow;
  }

  /**
   * Calculate average block time
   */
  private calculateAverageBlockTime(): number {
    const blockTime = this.counters.get('blockTime') || 0;
    const blockCount = this.counters.get('blocks') || 1;
    return blockTime / blockCount;
  }

  /**
   * Calculate average response time
   */
  private calculateAverageResponseTime(): number {
    const totalTime = this.counters.get('responseTime') || 0;
    const requestCount = this.counters.get('requests') || 1;
    return totalTime / requestCount;
  }

  /**
   * Get memory usage
   */
  private getMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return (memUsage.heapUsed / memUsage.heapTotal) * 100;
  }

  /**
   * Get CPU usage
   */
  private getCpuUsage(): number {
    // Simulate CPU usage - in real implementation, use actual CPU monitoring
    return Math.random() * 100;
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(): number {
    const errors = this.counters.get('errors') || 0;
    const requests = this.counters.get('requests') || 1;
    return errors / requests;
  }

  /**
   * Get queue size
   */
  private getQueueSize(): number {
    return this.counters.get('queueSize') || 0;
  }

  /**
   * Get cache hit rate
   */
  private getCacheHitRate(): number {
    const hits = this.counters.get('cacheHits') || 0;
    const misses = this.counters.get('cacheMisses') || 1;
    return hits / (hits + misses);
  }

  /**
   * Get database connections
   */
  private getDatabaseConnections(): number {
    return this.counters.get('dbConnections') || 0;
  }

  /**
   * Get network latency
   */
  private getNetworkLatency(): number {
    return this.counters.get('networkLatency') || 0;
  }

  /**
   * Check for performance alerts
   */
  private checkAlerts(): void {
    if (!this.config.enableAlerts) {
      return;
    }

    const latestMetrics = this.metrics[this.metrics.length - 1];
    if (!latestMetrics) {
      return;
    }

    const alerts: PerformanceAlert[] = [];

    // Check transaction rate
    if (latestMetrics.transactionsPerSecond > this.config.alertThresholds.transactionRate) {
      alerts.push(this.createAlert(
        'PERFORMANCE',
        'HIGH',
        `Transaction rate exceeded threshold: ${latestMetrics.transactionsPerSecond.toFixed(2)} > ${this.config.alertThresholds.transactionRate}`,
        'transactionsPerSecond',
        latestMetrics.transactionsPerSecond,
        this.config.alertThresholds.transactionRate
      ));
    }

    // Check block time
    if (latestMetrics.averageBlockTime > this.config.alertThresholds.blockTime) {
      alerts.push(this.createAlert(
        'PERFORMANCE',
        'HIGH',
        `Block time exceeded threshold: ${latestMetrics.averageBlockTime.toFixed(2)}ms > ${this.config.alertThresholds.blockTime}ms`,
        'averageBlockTime',
        latestMetrics.averageBlockTime,
        this.config.alertThresholds.blockTime
      ));
    }

    // Check memory usage
    if (latestMetrics.memoryUsage > this.config.alertThresholds.memoryUsage) {
      alerts.push(this.createAlert(
        'RESOURCE',
        'HIGH',
        `Memory usage exceeded threshold: ${latestMetrics.memoryUsage.toFixed(2)}% > ${this.config.alertThresholds.memoryUsage}%`,
        'memoryUsage',
        latestMetrics.memoryUsage,
        this.config.alertThresholds.memoryUsage
      ));
    }

    // Check CPU usage
    if (latestMetrics.cpuUsage > this.config.alertThresholds.cpuUsage) {
      alerts.push(this.createAlert(
        'RESOURCE',
        'HIGH',
        `CPU usage exceeded threshold: ${latestMetrics.cpuUsage.toFixed(2)}% > ${this.config.alertThresholds.cpuUsage}%`,
        'cpuUsage',
        latestMetrics.cpuUsage,
        this.config.alertThresholds.cpuUsage
      ));
    }

    // Check error rate
    if (latestMetrics.errorRate > this.config.alertThresholds.errorRate) {
      alerts.push(this.createAlert(
        'ERROR',
        'HIGH',
        `Error rate exceeded threshold: ${(latestMetrics.errorRate * 100).toFixed(2)}% > ${(this.config.alertThresholds.errorRate * 100).toFixed(2)}%`,
        'errorRate',
        latestMetrics.errorRate,
        this.config.alertThresholds.errorRate
      ));
    }

    // Check response time
    if (latestMetrics.averageResponseTime > this.config.alertThresholds.responseTime) {
      alerts.push(this.createAlert(
        'PERFORMANCE',
        'MEDIUM',
        `Response time exceeded threshold: ${latestMetrics.averageResponseTime.toFixed(2)}ms > ${this.config.alertThresholds.responseTime}ms`,
        'averageResponseTime',
        latestMetrics.averageResponseTime,
        this.config.alertThresholds.responseTime
      ));
    }

    // Check queue size
    if (latestMetrics.queueSize > this.config.alertThresholds.queueSize) {
      alerts.push(this.createAlert(
        'CAPACITY',
        'MEDIUM',
        `Queue size exceeded threshold: ${latestMetrics.queueSize} > ${this.config.alertThresholds.queueSize}`,
        'queueSize',
        latestMetrics.queueSize,
        this.config.alertThresholds.queueSize
      ));
    }

    // Emit alerts
    for (const alert of alerts) {
      this.alerts.push(alert);
      this.emit('alert', alert);
    }

    // Clean up old alerts
    this.cleanupOldAlerts();
  }

  /**
   * Create performance alert
   */
  private createAlert(
    type: 'PERFORMANCE' | 'RESOURCE' | 'ERROR' | 'CAPACITY',
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    message: string,
    metric: string,
    currentValue: number,
    threshold: number
  ): PerformanceAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      message,
      metric,
      currentValue,
      threshold,
      timestamp: Date.now(),
      resolved: false
    };
  }

  /**
   * Start performance profiling
   */
  public startProfiling(name: string): string {
    if (!this.config.enableProfiling) {
      throw new Error('Profiling is disabled');
    }

    const profileId = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.currentProfile = {
      id: profileId,
      name,
      startTime: Date.now(),
      samples: [],
      summary: {
        totalSamples: 0,
        averageDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        totalMemoryDelta: 0,
        averageCpuUsage: 0,
        operationCounts: {}
      }
    };

    this.profiles.set(profileId, this.currentProfile);

    this.emit('profilingStarted', {
      profileId,
      name,
      timestamp: Date.now()
    });

    return profileId;
  }

  /**
   * Stop performance profiling
   */
  public stopProfiling(profileId: string): PerformanceProfile | null {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return null;
    }

    profile.endTime = Date.now();
    profile.duration = profile.endTime - profile.startTime;

    // Calculate summary
    this.calculateProfileSummary(profile);

    this.emit('profilingStopped', {
      profileId,
      duration: profile.duration,
      samples: profile.samples.length
    });

    return profile;
  }

  /**
   * Record performance sample
   */
  public recordSample(operation: string, duration: number, stackTrace?: string): void {
    if (!this.currentProfile || !this.config.enableProfiling) {
      return;
    }

    const sample: PerformanceSample = {
      timestamp: Date.now(),
      operation,
      duration,
      memoryBefore: this.getMemoryUsage(),
      memoryAfter: this.getMemoryUsage(),
      cpuUsage: this.getCpuUsage(),
      stackTrace
    };

    this.currentProfile.samples.push(sample);
  }

  /**
   * Calculate profile summary
   */
  private calculateProfileSummary(profile: PerformanceProfile): void {
    const samples = profile.samples;
    
    if (samples.length === 0) {
      return;
    }

    let totalDuration = 0;
    let minDuration = Infinity;
    let maxDuration = 0;
    let totalMemoryDelta = 0;
    let totalCpuUsage = 0;
    const operationCounts: Record<string, number> = {};

    for (const sample of samples) {
      totalDuration += sample.duration;
      minDuration = Math.min(minDuration, sample.duration);
      maxDuration = Math.max(maxDuration, sample.duration);
      totalMemoryDelta += sample.memoryAfter - sample.memoryBefore;
      totalCpuUsage += sample.cpuUsage;
      
      operationCounts[sample.operation] = (operationCounts[sample.operation] || 0) + 1;
    }

    profile.summary = {
      totalSamples: samples.length,
      averageDuration: totalDuration / samples.length,
      minDuration,
      maxDuration,
      totalMemoryDelta,
      averageCpuUsage: totalCpuUsage / samples.length,
      operationCounts
    };
  }

  /**
   * Increment counter
   */
  public incrementCounter(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  /**
   * Set counter value
   */
  public setCounter(name: string, value: number): void {
    this.counters.set(name, value);
  }

  /**
   * Get counter value
   */
  public getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }

  /**
   * Start timer
   */
  public startTimer(name: string): string {
    const timerId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.timers.set(timerId, performance.now());
    return timerId;
  }

  /**
   * End timer and return duration
   */
  public endTimer(timerId: string): number {
    const startTime = this.timers.get(timerId);
    if (!startTime) {
      return 0;
    }

    const duration = performance.now() - startTime;
    this.timers.delete(timerId);
    return duration;
  }

  /**
   * Record custom metric
   */
  public recordCustomMetric(
    name: string,
    value: number,
    unit: string,
    tags: Record<string, string> = {}
  ): void {
    if (!this.config.enableCustomMetrics) {
      return;
    }

    const metric: CustomMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      tags
    };

    this.customMetrics.push(metric);
    this.cleanupOldCustomMetrics();

    this.emit('customMetric', metric);
  }

  /**
   * Get performance metrics
   */
  public getMetrics(limit?: number): PerformanceMetrics[] {
    if (limit) {
      return this.metrics.slice(-limit);
    }
    return [...this.metrics];
  }

  /**
   * Get alerts
   */
  public getAlerts(resolved?: boolean): PerformanceAlert[] {
    return this.alerts.filter(alert => 
      resolved === undefined || alert.resolved === resolved
    );
  }

  /**
   * Get profiles
   */
  public getProfiles(): PerformanceProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get profile by ID
   */
  public getProfile(profileId: string): PerformanceProfile | null {
    return this.profiles.get(profileId) || null;
  }

  /**
   * Get custom metrics
   */
  public getCustomMetrics(limit?: number): CustomMetric[] {
    if (limit) {
      return this.customMetrics.slice(-limit);
    }
    return [...this.customMetrics];
  }

  /**
   * Resolve alert
   */
  public resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      this.emit('alertResolved', alert);
      return true;
    }
    return false;
  }

  /**
   * Clean up old metrics
   */
  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - this.config.retentionPeriod;
    this.metrics = this.metrics.filter(m => m.timestamp > cutoff);
  }

  /**
   * Clean up old alerts
   */
  private cleanupOldAlerts(): void {
    const cutoff = Date.now() - this.config.retentionPeriod;
    this.alerts = this.alerts.filter(a => a.timestamp > cutoff);
  }

  /**
   * Clean up old custom metrics
   */
  private cleanupOldCustomMetrics(): void {
    const cutoff = Date.now() - this.config.retentionPeriod;
    this.customMetrics = this.customMetrics.filter(m => m.timestamp > cutoff);
  }

  /**
   * Get performance summary
   */
  public getPerformanceSummary(): {
    uptime: number;
    totalTransactions: number;
    averageResponseTime: number;
    errorRate: number;
    activeAlerts: number;
    profiles: number;
    customMetrics: number;
  } {
    const uptime = Date.now() - (this.metrics[0]?.timestamp || Date.now());
    const totalTransactions = this.getCounter('transactions');
    const averageResponseTime = this.calculateAverageResponseTime();
    const errorRate = this.calculateErrorRate();
    const activeAlerts = this.alerts.filter(a => !a.resolved).length;

    return {
      uptime,
      totalTransactions,
      averageResponseTime,
      errorRate,
      activeAlerts,
      profiles: this.profiles.size,
      customMetrics: this.customMetrics.length
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart monitoring with new configuration
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
    
    if (this.alertTimer) {
      clearInterval(this.alertTimer);
    }
    
    if (this.config.enabled) {
      this.startMonitoring();
    }

    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): MonitoringConfig {
    return { ...this.config };
  }

  /**
   * Stop performance monitoring
   */
  public stop(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
    
    if (this.alertTimer) {
      clearInterval(this.alertTimer);
    }

    // Stop any active profiling
    if (this.currentProfile) {
      this.stopProfiling(this.currentProfile.id);
    }

    this.emit('monitoringStopped');
  }

  /**
   * Reset all metrics and counters
   */
  public reset(): void {
    this.metrics = [];
    this.alerts = [];
    this.profiles.clear();
    this.customMetrics = [];
    this.counters.clear();
    this.timers.clear();
    this.currentProfile = undefined;

    this.emit('reset');
  }
}
