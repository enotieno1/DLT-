import { EventEmitter } from 'events';
import { ValidatorHealth } from './FaultTolerantConsensus';

export interface HealthMetrics {
  responseTime: number;
  successRate: number;
  uptime: number;
  lastSeen: number;
  consecutiveFailures: number;
  reputation: number;
}

export interface HealthThresholds {
  maxResponseTime: number;
  minSuccessRate: number;
  minUptime: number;
  maxConsecutiveFailures: number;
  minReputation: number;
}

export interface HealthAlert {
  validatorId: string;
  type: 'RESPONSE_TIME_HIGH' | 'SUCCESS_RATE_LOW' | 'UPTIME_LOW' | 'CONSECUTIVE_FAILURES' | 'REPUTATION_LOW';
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  timestamp: number;
  metrics: HealthMetrics;
}

export interface HealthReport {
  validatorId: string;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'FAILED';
  metrics: HealthMetrics;
  alerts: HealthAlert[];
  lastCheck: number;
}

/**
 * Comprehensive validator health monitoring system
 * Tracks validator performance and generates alerts for potential issues
 */
export class ValidatorHealthMonitor extends EventEmitter {
  private healthData: Map<string, HealthMetrics> = new Map();
  private thresholds: HealthThresholds;
  private monitoringInterval: number;
  private monitorTimer?: NodeJS.Timeout;
  private alertHistory: Map<string, HealthAlert[]> = new Map();

  constructor(thresholds: Partial<HealthThresholds> = {}, monitoringInterval: number = 30000) {
    super();
    this.thresholds = {
      maxResponseTime: 5000, // 5 seconds
      minSuccessRate: 0.95, // 95%
      minUptime: 0.99, // 99%
      maxConsecutiveFailures: 3,
      minReputation: 50,
      ...thresholds
    };
    this.monitoringInterval = monitoringInterval;
  }

  /**
   * Start health monitoring
   */
  public start(): void {
    if (this.monitorTimer) {
      return;
    }

    this.monitorTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.monitoringInterval);

    this.emit('monitoringStarted');
  }

  /**
   * Stop health monitoring
   */
  public stop(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }

    this.emit('monitoringStopped');
  }

  /**
   * Update validator health metrics
   * @param validatorId - Validator ID
   * @param metrics - Health metrics to update
   */
  public updateHealthMetrics(validatorId: string, metrics: Partial<HealthMetrics>): void {
    const current = this.healthData.get(validatorId) || {
      responseTime: 0,
      successRate: 1.0,
      uptime: 1.0,
      lastSeen: Date.now(),
      consecutiveFailures: 0,
      reputation: 100
    };

    const updated = { ...current, ...metrics };
    this.healthData.set(validatorId, updated);

    // Check for health alerts
    this.checkHealthAlerts(validatorId, updated);
  }

  /**
   * Record a successful interaction with validator
   * @param validatorId - Validator ID
   * @param responseTime - Response time in milliseconds
   */
  public recordSuccess(validatorId: string, responseTime: number): void {
    const current = this.healthData.get(validatorId);
    if (!current) {
      this.initializeValidator(validatorId);
      return;
    }

    // Update metrics
    const updated = {
      ...current,
      responseTime: this.calculateAverage(current.responseTime, responseTime),
      successRate: Math.min(1.0, current.successRate * 0.9 + 0.1), // Increase success rate
      lastSeen: Date.now(),
      consecutiveFailures: 0,
      reputation: Math.min(100, current.reputation + 1)
    };

    this.healthData.set(validatorId, updated);
    this.checkHealthAlerts(validatorId, updated);
  }

  /**
   * Record a failed interaction with validator
   * @param validatorId - Validator ID
   */
  public recordFailure(validatorId: string): void {
    const current = this.healthData.get(validatorId);
    if (!current) {
      this.initializeValidator(validatorId);
      return;
    }

    // Update metrics
    const updated = {
      ...current,
      successRate: Math.max(0.0, current.successRate * 0.9), // Decrease success rate
      lastSeen: Date.now(),
      consecutiveFailures: current.consecutiveFailures + 1,
      reputation: Math.max(0, current.reputation - 5)
    };

    this.healthData.set(validatorId, updated);
    this.checkHealthAlerts(validatorId, updated);
  }

  /**
   * Initialize health data for a new validator
   * @param validatorId - Validator ID
   */
  private initializeValidator(validatorId: string): void {
    const initialMetrics: HealthMetrics = {
      responseTime: 0,
      successRate: 1.0,
      uptime: 1.0,
      lastSeen: Date.now(),
      consecutiveFailures: 0,
      reputation: 100
    };

    this.healthData.set(validatorId, initialMetrics);
  }

  /**
   * Calculate average response time
   * @param current - Current average
   * @param newMeasurement - New measurement
   * @returns New average
   */
  private calculateAverage(current: number, newMeasurement: number): number {
    if (current === 0) {
      return newMeasurement;
    }
    return Math.round((current * 0.8) + (newMeasurement * 0.2));
  }

  /**
   * Check for health alerts and emit them
   * @param validatorId - Validator ID
   * @param metrics - Current health metrics
   */
  private checkHealthAlerts(validatorId: string, metrics: HealthMetrics): void {
    const alerts: HealthAlert[] = [];
    const now = Date.now();

    // Check response time
    if (metrics.responseTime > this.thresholds.maxResponseTime) {
      alerts.push({
        validatorId,
        type: 'RESPONSE_TIME_HIGH',
        severity: metrics.responseTime > this.thresholds.maxResponseTime * 2 ? 'ERROR' : 'WARNING',
        message: `Response time ${metrics.responseTime}ms exceeds threshold ${this.thresholds.maxResponseTime}ms`,
        timestamp: now,
        metrics
      });
    }

    // Check success rate
    if (metrics.successRate < this.thresholds.minSuccessRate) {
      alerts.push({
        validatorId,
        type: 'SUCCESS_RATE_LOW',
        severity: metrics.successRate < this.thresholds.minSuccessRate * 0.8 ? 'CRITICAL' : 'ERROR',
        message: `Success rate ${(metrics.successRate * 100).toFixed(1)}% below threshold ${(this.thresholds.minSuccessRate * 100).toFixed(1)}%`,
        timestamp: now,
        metrics
      });
    }

    // Check consecutive failures
    if (metrics.consecutiveFailures >= this.thresholds.maxConsecutiveFailures) {
      alerts.push({
        validatorId,
        type: 'CONSECUTIVE_FAILURES',
        severity: metrics.consecutiveFailures >= this.thresholds.maxConsecutiveFailures * 2 ? 'CRITICAL' : 'ERROR',
        message: `${metrics.consecutiveFailures} consecutive failures detected`,
        timestamp: now,
        metrics
      });
    }

    // Check reputation
    if (metrics.reputation < this.thresholds.minReputation) {
      alerts.push({
        validatorId,
        type: 'REPUTATION_LOW',
        severity: metrics.reputation < this.thresholds.minReputation * 0.5 ? 'CRITICAL' : 'WARNING',
        message: `Reputation ${metrics.reputation} below threshold ${this.thresholds.minReputation}`,
        timestamp: now,
        metrics
      });
    }

    // Check last seen (uptime indicator)
    const timeSinceLastSeen = now - metrics.lastSeen;
    const maxSilentTime = this.monitoringInterval * 3; // 3 monitoring intervals
    
    if (timeSinceLastSeen > maxSilentTime) {
      alerts.push({
        validatorId,
        type: 'UPTIME_LOW',
        severity: timeSinceLastSeen > maxSilentTime * 2 ? 'CRITICAL' : 'ERROR',
        message: `Validator not seen for ${Math.round(timeSinceLastSeen / 1000)}s`,
        timestamp: now,
        metrics
      });
    }

    // Store alerts and emit them
    if (alerts.length > 0) {
      if (!this.alertHistory.has(validatorId)) {
        this.alertHistory.set(validatorId, []);
      }
      
      const validatorAlerts = this.alertHistory.get(validatorId)!;
      validatorAlerts.push(...alerts);
      
      // Keep only last 100 alerts per validator
      if (validatorAlerts.length > 100) {
        this.alertHistory.set(validatorId, validatorAlerts.slice(-100));
      }

      // Emit alerts
      for (const alert of alerts) {
        this.emit('healthAlert', alert);
      }
    }
  }

  /**
   * Perform comprehensive health check on all validators
   */
  private performHealthCheck(): void {
    const now = Date.now();
    const reports: HealthReport[] = [];

    for (const [validatorId, metrics] of this.healthData.entries()) {
      const report = this.generateHealthReport(validatorId, metrics);
      reports.push(report);

      // Emit health status change if status changed
      const previousStatus = this.getPreviousStatus(validatorId);
      if (previousStatus !== report.status) {
        this.emit('statusChanged', {
          validatorId,
          previousStatus,
          newStatus: report.status,
          report
        });
      }
    }

    // Emit overall health report
    this.emit('healthReport', {
      timestamp: now,
      totalValidators: reports.length,
      healthy: reports.filter(r => r.status === 'HEALTHY').length,
      warning: reports.filter(r => r.status === 'WARNING').length,
      critical: reports.filter(r => r.status === 'CRITICAL').length,
      failed: reports.filter(r => r.status === 'FAILED').length,
      reports
    });
  }

  /**
   * Generate health report for a validator
   * @param validatorId - Validator ID
   * @param metrics - Health metrics
   * @returns Health report
   */
  private generateHealthReport(validatorId: string, metrics: HealthMetrics): HealthReport {
    const alerts = this.alertHistory.get(validatorId) || [];
    const recentAlerts = alerts.filter(a => Date.now() - a.timestamp < 300000); // Last 5 minutes

    let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'FAILED' = 'HEALTHY';

    // Determine status based on metrics and alerts
    if (metrics.consecutiveFailures >= 5 || metrics.successRate < 0.5 || metrics.reputation < 20) {
      status = 'FAILED';
    } else if (recentAlerts.some(a => a.severity === 'CRITICAL') || 
               metrics.consecutiveFailures >= 3 || 
               metrics.successRate < 0.8 || 
               metrics.reputation < 50) {
      status = 'CRITICAL';
    } else if (recentAlerts.some(a => a.severity === 'ERROR') || 
               metrics.consecutiveFailures >= 1 || 
               metrics.successRate < 0.95 || 
               metrics.reputation < 80) {
      status = 'WARNING';
    }

    return {
      validatorId,
      status,
      metrics,
      alerts: recentAlerts,
      lastCheck: Date.now()
    };
  }

  /**
   * Get previous status for a validator
   * @param validatorId - Validator ID
   * @returns Previous status or null
   */
  private getPreviousStatus(validatorId: string): string | null {
    // This would typically be stored in memory or a cache
    // For now, return null to indicate no previous status
    return null;
  }

  /**
   * Get health report for a specific validator
   * @param validatorId - Validator ID
   * @returns Health report or null if validator not found
   */
  public getValidatorHealthReport(validatorId: string): HealthReport | null {
    const metrics = this.healthData.get(validatorId);
    if (!metrics) {
      return null;
    }

    return this.generateHealthReport(validatorId, metrics);
  }

  /**
   * Get health reports for all validators
   * @returns Array of health reports
   */
  public getAllHealthReports(): HealthReport[] {
    const reports: HealthReport[] = [];
    
    for (const [validatorId, metrics] of this.healthData.entries()) {
      reports.push(this.generateHealthReport(validatorId, metrics));
    }

    return reports;
  }

  /**
   * Get recent alerts for all validators
   * @param timeWindow - Time window in milliseconds
   * @returns Array of recent alerts
   */
  public getRecentAlerts(timeWindow: number = 300000): HealthAlert[] {
    const cutoff = Date.now() - timeWindow;
    const recentAlerts: HealthAlert[] = [];

    for (const alerts of this.alertHistory.values()) {
      for (const alert of alerts) {
        if (alert.timestamp > cutoff) {
          recentAlerts.push(alert);
        }
      }
    }

    // Sort by timestamp (most recent first)
    return recentAlerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get alerts for a specific validator
   * @param validatorId - Validator ID
   * @param timeWindow - Time window in milliseconds
   * @returns Array of alerts
   */
  public getValidatorAlerts(validatorId: string, timeWindow: number = 300000): HealthAlert[] {
    const alerts = this.alertHistory.get(validatorId) || [];
    const cutoff = Date.now() - timeWindow;

    return alerts
      .filter(a => a.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get monitoring statistics
   * @returns Statistics object
   */
  public getMonitoringStats(): {
    totalValidators: number;
    healthyValidators: number;
    warningValidators: number;
    criticalValidators: number;
    failedValidators: number;
    averageResponseTime: number;
    averageSuccessRate: number;
    averageReputation: number;
    totalAlerts: number;
    criticalAlerts: number;
  } {
    const reports = this.getAllHealthReports();
    const alerts = this.getRecentAlerts();

    const healthy = reports.filter(r => r.status === 'HEALTHY').length;
    const warning = reports.filter(r => r.status === 'WARNING').length;
    const critical = reports.filter(r => r.status === 'CRITICAL').length;
    const failed = reports.filter(r => r.status === 'FAILED').length;

    let totalResponseTime = 0;
    let totalSuccessRate = 0;
    let totalReputation = 0;
    let count = 0;

    for (const metrics of this.healthData.values()) {
      totalResponseTime += metrics.responseTime;
      totalSuccessRate += metrics.successRate;
      totalReputation += metrics.reputation;
      count++;
    }

    return {
      totalValidators: reports.length,
      healthyValidators: healthy,
      warningValidators: warning,
      criticalValidators: critical,
      failedValidators: failed,
      averageResponseTime: count > 0 ? Math.round(totalResponseTime / count) : 0,
      averageSuccessRate: count > 0 ? totalSuccessRate / count : 0,
      averageReputation: count > 0 ? Math.round(totalReputation / count) : 0,
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter(a => a.severity === 'CRITICAL').length
    };
  }

  /**
   * Update health thresholds
   * @param newThresholds - New threshold values
   */
  public updateThresholds(newThresholds: Partial<HealthThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.emit('thresholdsUpdated', this.thresholds);
  }

  /**
   * Get current thresholds
   * @returns Current threshold values
   */
  public getThresholds(): HealthThresholds {
    return { ...this.thresholds };
  }

  /**
   * Clear old alert history
   * @param maxAge - Maximum age in milliseconds
   */
  public clearOldAlerts(maxAge: number = 24 * 60 * 60 * 1000): void { // 24 hours default
    const cutoff = Date.now() - maxAge;

    for (const [validatorId, alerts] of this.alertHistory.entries()) {
      const recent = alerts.filter(a => a.timestamp > cutoff);
      if (recent.length === 0) {
        this.alertHistory.delete(validatorId);
      } else {
        this.alertHistory.set(validatorId, recent);
      }
    }

    this.emit('alertsCleared', { maxAge, cutoff });
  }

  /**
   * Remove validator from monitoring
   * @param validatorId - Validator ID to remove
   */
  public removeValidator(validatorId: string): void {
    this.healthData.delete(validatorId);
    this.alertHistory.delete(validatorId);
    this.emit('validatorRemoved', { validatorId });
  }
}
