import { EventEmitter } from 'events';
import { Transaction } from '../types/block.types';
import { KYCSystem } from './KYCSystem';

export interface AMLConfig {
  enableRealTimeMonitoring: boolean;
  enablePatternDetection: boolean;
  enableRiskScoring: boolean;
  enableReporting: boolean;
  enableSanctionsScreening: boolean;
  monitoringThresholds: AMLThresholds;
  suspiciousPatterns: SuspiciousPattern[];
  reportingIntervals: ReportingIntervals;
  alertThresholds: AlertThresholds;
}

export interface AMLThresholds {
  maxTransactionAmount: number;
  maxDailyVolume: number;
  maxMonthlyVolume: number;
  maxTransactionFrequency: number;
  structuringThreshold: number;
  roundAmountThreshold: number;
  highRiskJurisdictions: string[];
  sanctionedCountries: string[];
}

export interface SuspiciousPattern {
  id: string;
  name: string;
  description: string;
  type: 'STRUCTURING' | 'ROUND_AMOUNT' | 'HIGH_FREQUENCY' | 'UNUSUAL_HOURS' | 'RAPID_MOVEMENT' | 'CONCENTRATION' | 'SHELL_COMPANY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  weight: number;
  indicators: string[];
  threshold: any;
}

export interface AlertThresholds {
  riskScore: number;
  patternMatches: number;
  transactionVolume: number;
  suspiciousActivity: number;
}

export interface ReportingIntervals {
  daily: number;
  weekly: number;
  monthly: number;
  quarterly: number;
  annual: number;
}

export interface AMLAlert {
  id: string;
  type: 'SUSPICIOUS_PATTERN' | 'RISK_THRESHOLD' | 'SANCTIONS_MATCH' | 'VOLUME_EXCEEDED' | 'FREQUENCY_EXCEEDED';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId: string;
  transactionId: string;
  pattern?: string;
  description: string;
  riskScore: number;
  details: any;
  timestamp: number;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE';
  resolvedAt?: number;
  resolvedBy?: string;
  resolution?: string;
}

export interface TransactionAnalysis {
  transactionId: string;
  userId: string;
  riskScore: number;
  riskFactors: RiskFactor[];
  suspiciousPatterns: string[];
  alerts: string[];
  recommendations: string[];
  requiresManualReview: boolean;
  autoApproved: boolean;
  blocked: boolean;
  timestamp: number;
}

export interface RiskFactor {
  category: 'AMOUNT' | 'FREQUENCY' | 'PATTERN' | 'JURISDICTION' | 'TIME' | 'RELATIONSHIP' | 'BEHAVIORAL';
  factor: string;
  weight: number;
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  description: string;
  value: any;
}

export interface AMLReport {
  id: string;
  type: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'SUSPICIOUS_ACTIVITY';
  period: {
    start: number;
    end: number;
  };
  summary: ReportSummary;
  alerts: AMLAlert[];
  statistics: ReportStatistics;
  recommendations: string[];
  generatedAt: number;
}

export interface ReportSummary {
  totalTransactions: number;
  totalVolume: number;
  alertsGenerated: number;
  alertsResolved: number;
  highRiskTransactions: number;
  blockedTransactions: number;
  averageRiskScore: number;
  topRiskFactors: Array<{ factor: string; count: number }>;
}

export interface ReportStatistics {
  riskDistribution: Record<string, number>;
  patternDistribution: Record<string, number>;
  jurisdictionDistribution: Record<string, number>;
  timeDistribution: Record<string, number>;
  volumeDistribution: Record<string, number>;
}

/**
 * Anti-Money Laundering (AML) monitoring and detection system
 * Implements real-time transaction monitoring, pattern detection, and regulatory reporting
 */
export class AMLSystem extends EventEmitter {
  private config: AMLConfig;
  private kycSystem: KYCSystem;
  private alerts: Map<string, AMLAlert> = new Map();
  private analyses: Map<string, TransactionAnalysis> = new Map();
  private reports: Map<string, AMLReport> = new Map();
  private transactionHistory: Map<string, Transaction[]> = new Map();
  private riskScores: Map<string, number> = new Map();
  private monitoringTimer?: NodeJS.Timeout;
  private reportingTimer?: NodeJS.Timeout;

  constructor(config: Partial<AMLConfig> = {}, kycSystem: KYCSystem) {
    super();
    
    this.config = {
      enableRealTimeMonitoring: true,
      enablePatternDetection: true,
      enableRiskScoring: true,
      enableReporting: true,
      enableSanctionsScreening: true,
      monitoringThresholds: {
        maxTransactionAmount: 10000,
        maxDailyVolume: 100000,
        maxMonthlyVolume: 1000000,
        maxTransactionFrequency: 100,
        structuringThreshold: 100,
        roundAmountThreshold: 100,
        highRiskJurisdictions: ['XX', 'YY', 'ZZ'], // Placeholder for high-risk jurisdictions
        sanctionedCountries: ['AA', 'BB', 'CC'] // Placeholder for sanctioned countries
      },
      suspiciousPatterns: [],
      reportingIntervals: {
        daily: 1,
        weekly: 7,
        monthly: 30,
        quarterly: 90,
        annual: 365
      },
      alertThresholds: {
        riskScore: 80,
        patternMatches: 3,
        transactionVolume: 1000000,
        suspiciousActivity: 10
      },
      ...config
    };

    this.kycSystem = kycSystem;
    this.initializeSuspiciousPatterns();
    
    if (this.config.enableRealTimeMonitoring) {
      this.startMonitoring();
    }
    
    if (this.config.enableReporting) {
      this.startReporting();
    }
  }

  /**
   * Analyze transaction for AML compliance
   * @param transaction - Transaction to analyze
   * @returns Analysis result
   */
  public analyzeTransaction(transaction: Transaction): TransactionAnalysis {
    const analysisId = this.generateAnalysisId(transaction.hash);
    
    const analysis: TransactionAnalysis = {
      transactionId: transaction.hash,
      userId: transaction.from,
      riskScore: 0,
      riskFactors: [],
      suspiciousPatterns: [],
      alerts: [],
      recommendations: [],
      requiresManualReview: false,
      autoApproved: true,
      blocked: false,
      timestamp: Date.now()
    };

    try {
      // Step 1: Basic compliance checks
      this.performBasicChecks(analysis, transaction);

      // Step 2: Pattern detection
      if (this.config.enablePatternDetection) {
        this.detectSuspiciousPatterns(analysis, transaction);
      }

      // Step 3: Risk scoring
      if (this.config.enableRiskScoring) {
        this.calculateRiskScore(analysis, transaction);
      }

      // Step 4: Sanctions screening
      if (this.config.enableSanctionsScreening) {
        this.screenSanctions(analysis, transaction);
      }

      // Step 5: Make decision
      this.makeAMLDecision(analysis);

      // Store analysis
      this.analyses.set(analysisId, analysis);

      // Update transaction history
      this.updateTransactionHistory(transaction);

      // Update user risk score
      this.updateUserRiskScore(transaction.from, analysis.riskScore);

      this.emit('transactionAnalyzed', {
        analysisId,
        transactionId: transaction.hash,
        userId: transaction.from,
        riskScore: analysis.riskScore,
        requiresManualReview: analysis.requiresManualReview,
        blocked: analysis.blocked
      });

    } catch (error) {
      analysis.recommendations.push('Analysis failed - manual review required');
      analysis.requiresManualReview = true;
      analysis.autoApproved = false;
    }

    return analysis;
  }

  /**
   * Perform basic AML compliance checks
   */
  private performBasicChecks(analysis: TransactionAnalysis, transaction: Transaction): void {
    // Check transaction amount
    if (transaction.value > this.config.monitoringThresholds.maxTransactionAmount) {
      analysis.riskFactors.push({
        category: 'AMOUNT',
        factor: 'HIGH_AMOUNT',
        weight: 30,
        impact: 'NEGATIVE',
        description: `Transaction amount ${transaction.value} exceeds threshold ${this.config.monitoringThresholds.maxTransactionAmount}`,
        value: transaction.value
      });
    }

    // Check transaction frequency
    const userHistory = this.transactionHistory.get(transaction.from) || [];
    const recentTransactions = userHistory.filter(t => 
      Date.now() - t.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
    );

    if (recentTransactions.length > this.config.monitoringThresholds.maxTransactionFrequency) {
      analysis.riskFactors.push({
        category: 'FREQUENCY',
        factor: 'HIGH_FREQUENCY',
        weight: 25,
        impact: 'NEGATIVE',
        description: `Transaction frequency ${recentTransactions.length} exceeds threshold ${this.config.monitoringThresholds.maxTransactionFrequency}`,
        value: recentTransactions.length
      });
    }

    // Check for round amounts
    if (this.isRoundAmount(transaction.value)) {
      analysis.riskFactors.push({
        category: 'PATTERN',
        factor: 'ROUND_AMOUNT',
        weight: 15,
        impact: 'NEGATIVE',
        description: `Round amount detected: ${transaction.value}`,
        value: transaction.value
      });
    }

    // Check transaction time
    const hour = new Date(transaction.timestamp).getHours();
    if (hour < 6 || hour > 22) {
      analysis.riskFactors.push({
        category: 'TIME',
        factor: 'UNUSUAL_HOURS',
        weight: 10,
        impact: 'NEGATIVE',
        description: `Transaction at unusual hour: ${hour}`,
        value: hour
      });
    }
  }

  /**
   * Detect suspicious patterns
   */
  private detectSuspiciousPatterns(analysis: TransactionAnalysis, transaction: Transaction): void {
    for (const pattern of this.config.suspiciousPatterns) {
      if (this.matchesPattern(pattern, transaction)) {
        analysis.suspiciousPatterns.push(pattern.id);
        analysis.riskFactors.push({
          category: 'PATTERN',
          factor: pattern.name,
          weight: pattern.weight,
          impact: 'NEGATIVE',
          description: pattern.description,
          value: pattern.threshold
        });

        // Create alert if severity is high enough
        if (pattern.severity === 'HIGH' || pattern.severity === 'CRITICAL') {
          this.createAlert('SUSPICIOUS_PATTERN', pattern.severity, transaction, pattern.id, pattern.description);
        }
      }
    }
  }

  /**
   * Check if transaction matches suspicious pattern
   */
  private matchesPattern(pattern: SuspiciousPattern, transaction: Transaction): boolean {
    switch (pattern.type) {
      case 'STRUCTURING':
        return this.detectStructuring(transaction, pattern.threshold);
      case 'ROUND_AMOUNT':
        return this.isRoundAmount(transaction.value, pattern.threshold);
      case 'HIGH_FREQUENCY':
        return this.detectHighFrequency(transaction.from, pattern.threshold);
      case 'UNUSUAL_HOURS':
        return this.detectUnusualHours(transaction.timestamp, pattern.threshold);
      case 'RAPID_MOVEMENT':
        return this.detectRapidMovement(transaction, pattern.threshold);
      case 'CONCENTRATION':
        return this.detectConcentration(transaction, pattern.threshold);
      case 'SHELL_COMPANY':
        return this.detectShellCompany(transaction, pattern.threshold);
      default:
        return false;
    }
  }

  /**
   * Detect transaction structuring
   */
  private detectStructuring(transaction: Transaction, threshold: number): boolean {
    // Check for structured amounts (e.g., 999.99)
    const amount = transaction.value;
    const decimalPart = amount % 1;
    return decimalPart > 0.9 && decimalPart < 0.99;
  }

  /**
   * Check if amount is round
   */
  private isRoundAmount(amount: number, threshold: number = 100): boolean {
    return amount % threshold === 0;
  }

  /**
   * Detect high frequency transactions
   */
  private detectHighFrequency(userId: string, threshold: number): boolean {
    const userHistory = this.transactionHistory.get(userId) || [];
    const recentTransactions = userHistory.filter(t => 
      Date.now() - t.timestamp < 60 * 60 * 1000 // Last hour
    );
    return recentTransactions.length >= threshold;
  }

  /**
   * Detect unusual hours
   */
  private detectUnusualHours(timestamp: number, threshold: number): boolean {
    const hour = new Date(timestamp).getHours();
    return hour < 6 || hour > 22;
  }

  /**
   * Detect rapid movement
   */
  private detectRapidMovement(transaction: Transaction, threshold: number): boolean {
    const userHistory = this.transactionHistory.get(transaction.from) || [];
    const recentTransactions = userHistory.slice(-5); // Last 5 transactions
    
    if (recentTransactions.length < 2) {
      return false;
    }

    const timeDifferences = [];
    for (let i = 1; i < recentTransactions.length; i++) {
      const timeDiff = Math.abs(recentTransactions[i].timestamp - recentTransactions[i-1].timestamp);
      timeDifferences.push(timeDiff);
    }

    const averageTimeDiff = timeDifferences.reduce((sum, diff) => sum + diff, 0) / timeDifferences.length;
    return averageTimeDiff < threshold;
  }

  /**
   * Detect concentration
   */
  private detectConcentration(transaction: Transaction, threshold: number): boolean {
    const userHistory = this.transactionHistory.get(transaction.from) || [];
    const recentTransactions = userHistory.filter(t => 
      Date.now() - t.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
    );

    // Check concentration to single recipient
    const recipientCounts = new Map<string, number>();
    for (const tx of recentTransactions) {
      const count = recipientCounts.get(tx.to) || 0;
      recipientCounts.set(tx.to, count + 1);
    }

    const maxCount = Math.max(...recipientCounts.values());
    return maxCount >= threshold;
  }

  /**
   * Detect shell company
   */
  private detectShellCompany(transaction: Transaction, threshold: number): boolean {
    // Simple shell company detection - in real implementation, this would be more sophisticated
    const userHistory = this.transactionHistory.get(transaction.from) || [];
    const uniqueRecipients = new Set(userHistory.map(t => t.to));
    return uniqueRecipients.size >= threshold;
  }

  /**
   * Calculate risk score
   */
  private calculateRiskScore(analysis: TransactionAnalysis, transaction: Transaction): void {
    let riskScore = 0;

    // Calculate base risk score from risk factors
    for (const factor of analysis.riskFactors) {
      const impact = factor.impact === 'NEGATIVE' ? 1 : factor.impact === 'POSITIVE' ? -1 : 0;
      riskScore += factor.weight * impact;
    }

    // Add pattern-based risk
    for (const patternId of analysis.suspiciousPatterns) {
      const pattern = this.config.suspiciousPatterns.find(p => p.id === patternId);
      if (pattern) {
        riskScore += pattern.weight;
      }
    }

    // Normalize to 0-100 scale
    analysis.riskScore = Math.max(0, Math.min(100, (riskScore + 100) / 2));
  }

  /**
   * Screen against sanctions
   */
  private screenSanctions(analysis: TransactionAnalysis, transaction: Transaction): void {
    // Check against sanctioned countries
    if (this.config.monitoringThresholds.sanctionedCountries.length > 0) {
      // In a real implementation, this would check against actual sanctions lists
      // For now, we'll simulate the check
      const isSanctioned = this.config.monitoringThresholds.sanctionedCountries.includes('XX');
      
      if (isSanctioned) {
        analysis.riskFactors.push({
          category: 'JURISDICTION',
          factor: 'SANCTIONED_COUNTRY',
          weight: 50,
          impact: 'NEGATIVE',
          description: 'Transaction involves sanctioned jurisdiction',
          value: 'XX'
        });

        this.createAlert('SANCTIONS_MATCH', 'CRITICAL', transaction, 'SANCTIONED_COUNTRY', 'Transaction involves sanctioned jurisdiction');
      }
    }
  }

  /**
   * Make AML decision
   */
  private makeAMLDecision(analysis: TransactionAnalysis): void {
    const riskLevel = this.determineRiskLevel(analysis.riskScore);
    
    // Auto-approve low risk transactions
    if (riskLevel === 'LOW') {
      analysis.autoApproved = true;
      analysis.blocked = false;
      analysis.requiresManualReview = false;
      return;
    }

    // Medium risk - may require manual review based on patterns
    if (riskLevel === 'MEDIUM') {
      analysis.autoApproved = analysis.suspiciousPatterns.length === 0;
      analysis.blocked = false;
      analysis.requiresManualReview = !analysis.autoApproved;
      return;
    }

    // High risk - manual review required
    if (riskLevel === 'HIGH') {
      analysis.autoApproved = false;
      analysis.blocked = false;
      analysis.requiresManualReview = true;
      
      if (analysis.suspiciousPatterns.length > 0) {
        analysis.recommendations.push('Immediate manual review required due to suspicious patterns');
      }
      
      return;
    }

    // Critical risk - block transaction
    if (riskLevel === 'CRITICAL') {
      analysis.autoApproved = false;
      analysis.blocked = true;
      analysis.requiresManualReview = true;
      analysis.recommendations.push('Transaction blocked due to high risk score');
      
      // Create critical alert
      this.createAlert('RISK_THRESHOLD', 'CRITICAL', transaction, 'CRITICAL_RISK', 'Transaction blocked due to critical risk score');
    }
  }

  /**
   * Determine risk level
   */
  private determineRiskLevel(riskScore: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (riskScore < 30) {
      return 'LOW';
    } else if (riskScore < 60) {
      return 'MEDIUM';
    } else if (riskScore < 80) {
      return 'HIGH';
    } else {
      return 'CRITICAL';
    }
  }

  /**
   * Create AML alert
   */
  private createAlert(
    type: 'SUSPICIOUS_PATTERN' | 'RISK_THRESHOLD' | 'SANCTIONS_MATCH' | 'VOLUME_EXCEEDED' | 'FREQUENCY_EXCEEDED',
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    transaction: Transaction,
    pattern?: string,
    description: string
  ): void {
    const alert: AMLAlert = {
      id: this.generateAlertId(),
      type,
      severity,
      userId: transaction.from,
      transactionId: transaction.hash,
      pattern,
      description,
      riskScore: this.riskScores.get(transaction.from) || 0,
      details: {
        transactionAmount: transaction.value,
        timestamp: transaction.timestamp
      },
      timestamp: Date.now(),
      status: 'OPEN'
    };

    this.alerts.set(alert.id, alert);
    
    this.emit('alertCreated', {
      alertId: alert.id,
      type,
      severity,
      userId: alert.userId,
      transactionId: alert.transactionId
    });
  }

  /**
   * Get transaction analysis
   */
  public getTransactionAnalysis(transactionId: string): TransactionAnalysis | null {
    return this.analyses.get(transactionId) || null;
  }

  /**
   * Get user transaction history
   */
  public getUserTransactionHistory(userId: string): Transaction[] {
    return this.transactionHistory.get(userId) || [];
  }

  /**
   * Get user risk score
   */
  public getUserRiskScore(userId: string): number {
    return this.riskScores.get(userId) || 0;
  }

  /**
   * Get AML alerts
   */
  public getAlerts(status?: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE'): AMLAlert[] {
    return Array.from(this.alerts.values()).filter(alert => 
      status === undefined || alert.status === status
    );
  }

  /**
   * Update alert status
   */
  public updateAlertStatus(alertId: string, status: 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE', resolvedBy?: string, resolution?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.status = status;
    alert.resolvedAt = Date.now();
    alert.resolvedBy = resolvedBy;
    alert.resolution = resolution;

    this.emit('alertUpdated', {
      alertId,
      status,
      resolvedBy,
      resolution
    });

    return true;
  }

  /**
   * Get AML statistics
   */
  public getAMLStats(): {
    totalAlerts: number;
    openAlerts: number;
    resolvedAlerts: number;
    falsePositives: number;
    averageRiskScore: number;
    highRiskTransactions: number;
    blockedTransactions: number;
    patternDistribution: Record<string, number>;
    riskDistribution: Record<string, number>;
  } {
    const alerts = Array.from(this.alerts.values());
    const analyses = Array.from(this.analyses.values());
    
    return {
      totalAlerts: alerts.length,
      openAlerts: alerts.filter(a => a.status === 'OPEN').length,
      resolvedAlerts: alerts.filter(a => a.status === 'RESOLVED').length,
      falsePositives: alerts.filter(a => a.status === 'FALSE_POSITIVE').length,
      averageRiskScore: analyses.reduce((sum, a) => sum + a.riskScore, 0) / analyses.length,
      highRiskTransactions: analyses.filter(a => this.determineRiskLevel(a.riskScore) === 'HIGH' || this.determineRiskLevel(a.riskScore) === 'CRITICAL').length,
      blockedTransactions: analyses.filter(a => a.blocked).length,
      patternDistribution: this.calculatePatternDistribution(),
      riskDistribution: this.calculateRiskDistribution()
    };
  }

  /**
   * Generate AML report
   */
  public generateReport(type: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'SUSPICIOUS_ACTIVITY'): string {
    const reportId = this.generateReportId(type);
    const now = Date.now();
    
    let periodStart: number;
    let periodEnd: number;
    
    switch (type) {
      case 'DAILY':
        periodStart = now - (24 * 60 * 60 * 1000);
        periodEnd = now;
        break;
      case 'WEEKLY':
        periodStart = now - (7 * 24 * 60 * 60 * 1000);
        periodEnd = now;
        break;
      case 'MONTHLY':
        periodStart = now - (30 * 24 * 60 * 60 * 1000);
        periodEnd = now;
        break;
      case 'QUARTERLY':
        periodStart = now - (90 * 24 * 60 * 60 * 1000);
        periodEnd = now;
        break;
      case 'ANNUAL':
        periodStart = now - (365 * 24 * 60 * 60 * 1000);
        periodEnd = now;
        break;
      default:
        periodStart = now - (24 * 60 * 60 * 1000);
        periodEnd = now;
    }

    const report: AMLReport = {
      id: reportId,
      type,
      period: { start: periodStart, end: periodEnd },
      summary: this.generateReportSummary(periodStart, periodEnd),
      alerts: Array.from(this.alerts.values()).filter(a => 
        a.timestamp >= periodStart && a.timestamp <= periodEnd
      ),
      statistics: this.generateReportStatistics(periodStart, periodEnd),
      recommendations: this.generateRecommendations(),
      generatedAt: now
    };

    this.reports.set(reportId, report);

    this.emit('reportGenerated', {
      reportId,
      type,
      period: report.period,
      generatedAt: report.generatedAt
    });

    return reportId;
  }

  /**
   * Generate report summary
   */
  private generateReportSummary(start: number, end: number): ReportSummary {
    const alerts = Array.from(this.alerts.values()).filter(a => 
      a.timestamp >= start && a.timestamp <= end
    );
    const analyses = Array.from(this.analyses.values()).filter(a => 
      a.timestamp >= start && a.timestamp <= end
    );

    const totalTransactions = analyses.length;
    const totalVolume = analyses.reduce((sum, a) => {
      const transaction = this.getTransactionById(a.transactionId);
      return sum + (transaction?.value || 0);
    }, 0);
    const averageRiskScore = analyses.reduce((sum, a) => sum + a.riskScore, 0) / analyses.length;

    const riskFactorCounts: Record<string, number> = {};
    for (const analysis of analyses) {
      for (const factor of analysis.riskFactors) {
        riskFactorCounts[factor.factor] = (riskFactorCounts[factor.factor] || 0) + 1;
      }
    }

    const topRiskFactors = Object.entries(riskFactorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([factor, count]) => ({ factor, count }));

    return {
      totalTransactions,
      totalVolume,
      alertsGenerated: alerts.length,
      alertsResolved: alerts.filter(a => a.status === 'RESOLVED').length,
      highRiskTransactions: analyses.filter(a => 
        this.determineRiskLevel(a.riskScore) === 'HIGH' || this.determineRiskLevel(a.riskScore) === 'CRITICAL'
      ).length,
      blockedTransactions: analyses.filter(a => a.blocked).length,
      averageRiskScore,
      topRiskFactors
    };
  }

  /**
   * Generate report statistics
   */
  private generateReportStatistics(start: number, end: number): ReportStatistics {
    const analyses = Array.from(this.analyses.values()).filter(a => 
      a.timestamp >= start && a.timestamp <= end
    );

    return {
      riskDistribution: this.calculateRiskDistribution(),
      patternDistribution: this.calculatePatternDistribution(),
      jurisdictionDistribution: {},
      timeDistribution: {},
      volumeDistribution: {}
    };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    
    const stats = this.getAMLStats();
    
    if (stats.averageRiskScore > 70) {
      recommendations.push('Consider implementing stricter transaction monitoring');
    }
    
    if (stats.openAlerts > 10) {
      recommendations.push('Increase manual review capacity');
    }
    
    if (stats.falsePositives > stats.totalAlerts * 0.1) {
      recommendations.push('Review and adjust suspicious pattern detection algorithms');
    }

    return recommendations;
  }

  /**
   * Calculate risk distribution
   */
  private calculateRiskDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {
      'LOW': 0,
      'MEDIUM': 0,
      'HIGH': 0,
      'CRITICAL': 0
    };

    for (const analysis of this.analyses.values()) {
      const level = this.determineRiskLevel(analysis.riskScore);
      distribution[level]++;
    }

    return distribution;
  }

  /**
   * Calculate pattern distribution
   */
  private calculatePatternDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const analysis of this.analyses.values()) {
      for (const patternId of analysis.suspiciousPatterns) {
        const pattern = this.config.suspiciousPatterns.find(p => p.id === patternId);
        if (pattern) {
          distribution[pattern.name] = (distribution[pattern.name] || 0) + 1;
        }
      }
    }

    return distribution;
  }

  // Helper methods

  private generateAnalysisId(transactionHash: string): string {
    return `analysis_${transactionHash}_${Date.now()}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateReportId(type: string): string {
    return `report_${type.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updateTransactionHistory(transaction: Transaction): void {
    const userHistory = this.transactionHistory.get(transaction.from) || [];
    userHistory.push(transaction);
    
    // Keep only last 1000 transactions per user
    if (userHistory.length > 1000) {
      this.transactionHistory.set(transaction.from, userHistory.slice(-1000));
    } else {
      this.transactionHistory.set(transaction.from, userHistory);
    }
  }

  private updateUserRiskScore(userId: string, riskScore: number): void {
    const currentScore = this.riskScores.get(userId) || 0;
    // Use weighted average
    const newScore = (currentScore * 0.8) + (riskScore * 0.2);
    this.riskScores.set(userId, newScore);
  }

  private getTransactionById(transactionId: string): Transaction | null {
    for (const history of this.transactionHistory.values()) {
      const transaction = history.find(t => t.hash === transactionId);
      if (transaction) {
        return transaction;
      }
    }
    return null;
  }

  private initializeSuspiciousPatterns(): void {
    this.config.suspiciousPatterns = [
      {
        id: 'structuring_001',
        name: 'Transaction Structuring',
        description: 'Detection of structured transaction amounts',
        type: 'STRUCTURING',
        severity: 'MEDIUM',
        weight: 20,
        indicators: ['Round amounts', 'Decimal patterns'],
        threshold: 0.9
      },
      {
        id: 'round_amount_001',
        name: 'Round Amount Detection',
        description: 'Detection of round transaction amounts',
        type: 'ROUND_AMOUNT',
        severity: 'LOW',
        weight: 15,
        indicators: ['Round numbers'],
        threshold: 100
      },
      {
        id: 'high_frequency_001',
        name: 'High Frequency Detection',
        description: 'Detection of high frequency transactions',
        type: 'HIGH_FREQUENCY',
        severity: 'HIGH',
        weight: 30,
        indicators: ['Multiple transactions', 'Short time intervals'],
        threshold: 50
      },
      {
        id: 'unusual_hours_001',
        name: 'Unusual Hours Detection',
        description: 'Detection of transactions during unusual hours',
        type: 'UNUSUAL_HOURS',
        severity: 'MEDIUM',
        weight: 15,
        indicators: ['Late night', 'Early morning'],
        threshold: 22
      }
    ];
  }

  /**
   * Start real-time monitoring
   */
  private startMonitoring(): void {
    this.monitoringTimer = setInterval(() => {
      this.performPeriodicChecks();
    }, 60000); // Check every minute
  }

  /**
   * Start reporting
   */
  private startReporting(): void {
    this.reportingTimer = setInterval(() => {
      this.generateScheduledReports();
    }, 3600000); // Check every hour
  }

  /**
   * Perform periodic checks
   */
  private performPeriodicChecks(): void {
    // Check for volume thresholds
    this.checkVolumeThresholds();
    
    // Check for pattern thresholds
    this.checkPatternThresholds();
    
    // Check for suspicious activity
    this.checkSuspiciousActivity();
  }

  /**
   * Check volume thresholds
   */
  private checkVolumeThresholds(): void {
    // Implementation would check daily/monthly volume thresholds
  }

  /**
   * Check pattern thresholds
   */
  private checkPatternThresholds(): void {
    // Implementation would check pattern match thresholds
  }

  /**
   * Check for suspicious activity
   */
  private checkSuspiciousActivity(): void {
    // Implementation would check for suspicious activity patterns
  }

  /**
   * Generate scheduled reports
   */
  private generateScheduledReports(): void {
    const now = Date.now();
    
    // Generate daily report
    if (this.shouldGenerateReport('DAILY', now)) {
      this.generateReport('DAILY');
    }
    
    // Generate weekly report
    if (this.shouldGenerateReport('WEEKLY', now)) {
      this.generateReport('WEEKLY');
    }
  }

  /**
   * Check if report should be generated
   */
  private shouldGenerateReport(type: string, now: number): boolean {
    const intervals = this.config.reportingIntervals;
    const interval = intervals[type as keyof ReportingIntervals];
    
    if (!interval) {
      return false;
    }

    const lastReportTime = this.getLastReportTime(type);
    const nextReportTime = lastReportTime + (interval * 24 * 60 * 60 * 1000);
    
    return now >= nextReportTime;
  }

  /**
   * Get last report time
   */
  private getLastReportTime(type: string): number {
    const reports = Array.from(this.reports.values())
      .filter(r => r.type === type)
      .sort((a, b) => b.generatedAt - a.generatedAt);
    
    return reports.length > 0 ? reports[0].generatedAt : 0;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<AMLConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): AMLConfig {
    return { ...this.config };
  }

  /**
   * Stop AML monitoring
   */
  public stop(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
    }

    this.emit('stopped');
  }
}
