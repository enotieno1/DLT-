import { EventEmitter } from 'events';
import { KYCSystem } from './KYCSystem';
import { AMLSystem } from './AMLSystem';
import { AuditTrailSystem } from './AuditTrailSystem';
import { AccessControl } from './AccessControl';
import { ComplianceReporting } from './ComplianceReporting';

export interface DashboardConfig {
  enableRealTimeUpdates: boolean;
  refreshInterval: number;
  enableAlerts: boolean;
  enableNotifications: boolean;
  enableDataVisualization: boolean;
  enableExport: boolean;
  theme: 'LIGHT' | 'DARK' | 'AUTO';
  language: string;
  timezone: string;
  widgets: WidgetConfig[];
}

export interface WidgetConfig {
  id: string;
  type: 'KYC_SUMMARY' | 'AML_SUMMARY' | 'AUDIT_SUMMARY' | 'ACCESS_SUMMARY' | 'COMPLIANCE_SCORE' | 'VIOLATIONS' | 'METRICS' | 'ALERTS' | 'CHARTS';
  title: string;
  position: { x: number; y: number; width: number; height: number };
  refreshInterval: number;
  config: any;
  visible: boolean;
}

export interface DashboardData {
  kycData: KYCDashboardData;
  amlData: AMLDashboardData;
  auditData: AuditDashboardData;
  accessData: AccessDashboardData;
  complianceScore: ComplianceScoreData;
  violations: ViolationData;
  metrics: MetricsData;
  alerts: AlertData;
  charts: ChartData[];
}

export interface KYCDashboardData {
  totalRequests: number;
  verifiedUsers: number;
  pendingRequests: number;
  rejectedRequests: number;
  averageRiskScore: number;
  riskDistribution: Record<string, number>;
  verificationTrends: Array<{ date: string; count: number }>;
  documentVerificationRate: number;
}

export interface AMLDashboardData {
  totalTransactions: number;
  suspiciousTransactions: number;
  blockedTransactions: number;
  alertsGenerated: number;
  alertsResolved: number;
  averageRiskScore: number;
  riskDistribution: Record<string, number>;
  patternMatches: Record<string, number>;
  transactionVolume: Array<{ date: string; volume: number }>;
}

export interface AuditDashboardData {
  totalLogs: number;
  criticalEvents: number;
  securityEvents: number;
  complianceEvents: number;
  integrityIssues: number;
  errorRate: number;
  logDistribution: Record<string, number>;
  recentLogs: Array<{
    id: string;
    timestamp: number;
    level: string;
    category: string;
    message: string;
  }>;
}

export interface AccessDashboardData {
  totalUsers: number;
  activeUsers: number;
  lockedUsers: number;
  activeSessions: number;
  failedLogins: number;
  roleDistribution: Record<string, number>;
  permissionUsage: Record<string, number>;
  accessDeniedEvents: number;
}

export interface ComplianceScoreData {
  overall: number;
  kycScore: number;
  amlScore: number;
  auditScore: number;
  accessScore: number;
  trends: Array<{ date: string; score: number }>;
  status: 'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT' | 'POOR';
}

export interface ViolationData {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  byCategory: Record<string, number>;
  recent: Array<{
    id: string;
    type: string;
    severity: string;
    description: string;
    timestamp: number;
    status: string;
  }>;
}

export interface MetricsData {
  systemHealth: number;
  performance: number;
  availability: number;
  responseTime: number;
  throughput: number;
  errorRate: number;
  resourceUsage: {
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  };
}

export interface AlertData {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  recent: Array<{
    id: string;
    type: string;
    severity: string;
    title: string;
    message: string;
    timestamp: number;
    acknowledged: boolean;
  }>;
}

export interface ChartData {
  id: string;
  type: 'LINE' | 'BAR' | 'PIE' | 'AREA' | 'SCATTER' | 'GAUGE';
  title: string;
  data: any[];
  xAxis: string;
  yAxis: string;
  colors: string[];
  options: any;
}

/**
 * Regulatory compliance dashboard for enterprise DLT system
 * Provides real-time monitoring, visualization, and reporting capabilities
 */
export class RegulatoryDashboard extends EventEmitter {
  private config: DashboardConfig;
  private kycSystem: KYCSystem;
  private amlSystem: AMLSystem;
  private auditSystem: AuditTrailSystem;
  private accessControl: AccessControl;
  private complianceReporting: ComplianceReporting;
  private dashboardData: DashboardData;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    config: Partial<DashboardConfig> = {},
    kycSystem: KYCSystem,
    amlSystem: AMLSystem,
    auditSystem: AuditTrailSystem,
    accessControl: AccessControl,
    complianceReporting: ComplianceReporting
  ) {
    super();
    
    this.config = {
      enableRealTimeUpdates: true,
      refreshInterval: 30000, // 30 seconds
      enableAlerts: true,
      enableNotifications: true,
      enableDataVisualization: true,
      enableExport: true,
      theme: 'DARK',
      language: 'en',
      timezone: 'UTC',
      widgets: this.getDefaultWidgets(),
      ...config
    };

    this.kycSystem = kycSystem;
    this.amlSystem = amlSystem;
    this.auditSystem = auditSystem;
    this.accessControl = accessControl;
    this.complianceReporting = complianceReporting;

    this.dashboardData = {
      kycData: {} as KYCDashboardData,
      amlData: {} as AMLDashboardData,
      auditData: {} as AuditDashboardData,
      accessData: {} as AccessDashboardData,
      complianceScore: {} as ComplianceScoreData,
      violations: {} as ViolationData,
      metrics: {} as MetricsData,
      alerts: {} as AlertData,
      charts: []
    };

    this.initializeDashboard();
    
    if (this.config.enableRealTimeUpdates) {
      this.startRealTimeUpdates();
    }
  }

  /**
   * Initialize dashboard with default data
   */
  private initializeDashboard(): void {
    this.collectInitialData();
    this.setupEventListeners();
    
    this.emit('dashboardInitialized', {
      timestamp: Date.now(),
      config: this.config
    });
  }

  /**
   * Collect initial dashboard data
   */
  private collectInitialData(): void {
    this.dashboardData.kycData = this.collectKYCData();
    this.dashboardData.amlData = this.collectAMLData();
    this.dashboardData.auditData = this.collectAuditData();
    this.dashboardData.accessData = this.collectAccessData();
    this.dashboardData.complianceScore = this.calculateComplianceScore();
    this.dashboardData.violations = this.collectViolations();
    this.dashboardData.metrics = this.collectMetrics();
    this.dashboardData.alerts = this.collectAlerts();
    this.dashboardData.charts = this.generateCharts();
  }

  /**
   * Setup event listeners for real-time updates
   */
  private setupEventListeners(): void {
    // KYC events
    this.kycSystem.on('kycSubmitted', () => {
      this.updateKYCData();
    });

    this.kycSystem.on('kycCompleted', () => {
      this.updateKYCData();
    });

    this.kycSystem.on('kycFailed', () => {
      this.updateKYCData();
    });

    // AML events
    this.amlSystem.on('alertCreated', () => {
      this.updateAMLData();
      this.updateAlerts();
    });

    this.amlSystem.on('transactionAnalyzed', () => {
      this.updateAMLData();
    });

    // Audit events
    this.auditSystem.on('logCreated', () => {
      this.updateAuditData();
    });

    this.auditSystem.on('reportGenerated', () => {
      this.updateAuditData();
    });

    // Access control events
    this.accessControl.on('userAuthenticated', () => {
      this.updateAccessData();
    });

    this.accessControl.on('userLoggedOut', () => {
      this.updateAccessData();
    });

    this.accessControl.on('accessDenied', () => {
      this.updateAccessData();
    });

    // Compliance reporting events
    this.complianceReporting.on('reportGenerated', () => {
      this.updateComplianceScore();
    });
  }

  /**
   * Start real-time updates
   */
  private startRealTimeUpdates(): void {
    this.refreshTimer = setInterval(() => {
      this.refreshDashboard();
    }, this.config.refreshInterval);
  }

  /**
   * Refresh dashboard data
   */
  private refreshDashboard(): void {
    this.dashboardData.kycData = this.collectKYCData();
    this.dashboardData.amlData = this.collectAMLData();
    this.dashboardData.auditData = this.collectAuditData();
    this.dashboardData.accessData = this.collectAccessData();
    this.dashboardData.complianceScore = this.calculateComplianceScore();
    this.dashboardData.violations = this.collectViolations();
    this.dashboardData.metrics = this.collectMetrics();
    this.dashboardData.alerts = this.collectAlerts();
    this.dashboardData.charts = this.generateCharts();

    this.emit('dashboardUpdated', {
      timestamp: Date.now(),
      data: this.dashboardData
    });
  }

  /**
   * Update KYC data
   */
  private updateKYCData(): void {
    this.dashboardData.kycData = this.collectKYCData();
    this.emit('kycDataUpdated', this.dashboardData.kycData);
  }

  /**
   * Update AML data
   */
  private updateAMLData(): void {
    this.dashboardData.amlData = this.collectAMLData();
    this.emit('amlDataUpdated', this.dashboardData.amlData);
  }

  /**
   * Update audit data
   */
  private updateAuditData(): void {
    this.dashboardData.auditData = this.collectAuditData();
    this.emit('auditDataUpdated', this.dashboardData.auditData);
  }

  /**
   * Update access data
   */
  private updateAccessData(): void {
    this.dashboardData.accessData = this.collectAccessData();
    this.emit('accessDataUpdated', this.dashboardData.accessData);
  }

  /**
   * Update compliance score
   */
  private updateComplianceScore(): void {
    this.dashboardData.complianceScore = this.calculateComplianceScore();
    this.emit('complianceScoreUpdated', this.dashboardData.complianceScore);
  }

  /**
   * Update violations
   */
  private updateViolations(): void {
    this.dashboardData.violations = this.collectViolations();
    this.emit('violationsUpdated', this.dashboardData.violations);
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    this.dashboardData.metrics = this.collectMetrics();
    this.emit('metricsUpdated', this.dashboardData.metrics);
  }

  /**
   * Update alerts
   */
  private updateAlerts(): void {
    this.dashboardData.alerts = this.collectAlerts();
    this.emit('alertsUpdated', this.dashboardData.alerts);
  }

  /**
   * Collect KYC data
   */
  private collectKYCData(): KYCDashboardData {
    const stats = this.kycSystem.getKYCStats();
    
    return {
      totalRequests: stats.totalRequests,
      verifiedUsers: stats.verifiedRequests,
      pendingRequests: stats.pendingRequests,
      rejectedRequests: stats.rejectedRequests,
      averageRiskScore: stats.averageRiskScore,
      riskDistribution: stats.riskDistribution,
      verificationTrends: this.generateVerificationTrends(),
      documentVerificationRate: 95 // Would calculate from actual data
    };
  }

  /**
   * Collect AML data
   */
  private collectAMLData(): AMLDashboardData {
    const stats = this.amlSystem.getAMLStats();
    
    return {
      totalTransactions: stats.totalTransactions,
      suspiciousTransactions: stats.highRiskTransactions,
      blockedTransactions: stats.blockedTransactions,
      alertsGenerated: stats.totalAlerts,
      alertsResolved: stats.resolvedAlerts,
      averageRiskScore: stats.averageRiskScore,
      riskDistribution: stats.riskDistribution,
      patternMatches: stats.patternDistribution,
      transactionVolume: this.generateTransactionVolume()
    };
  }

  /**
   * Collect audit data
   */
  private collectAuditData(): AuditDashboardData {
    const stats = this.auditSystem.getAuditStatistics();
    
    return {
      totalLogs: stats.totalLogs,
      criticalEvents: 0, // Would calculate from actual data
      securityEvents: 0, // Would calculate from actual data
      complianceEvents: 0, // Would calculate from actual data
      integrityIssues: stats.integrityIssues,
      errorRate: stats.errors / stats.totalLogs * 100,
      logDistribution: stats.logsByLevel,
      recentLogs: this.getRecentLogs()
    };
  }

  /**
   * Collect access data
   */
  private collectAccessData(): AccessDashboardData {
    const stats = this.accessControl.getAccessStats();
    
    return {
      totalUsers: stats.totalUsers,
      activeUsers: stats.activeUsers,
      lockedUsers: stats.lockedUsers,
      activeSessions: stats.activeSessions,
      failedLogins: 0, // Would calculate from actual data
      roleDistribution: {}, // Would calculate from actual data
      permissionUsage: {}, // Would calculate from actual data
      accessDeniedEvents: 0 // Would calculate from actual data
    };
  }

  /**
   * Calculate compliance score
   */
  private calculateComplianceScore(): ComplianceScoreData {
    const kycScore = this.calculateKYCScore();
    const amlScore = this.calculateAMLScore();
    const auditScore = this.calculateAuditScore();
    const accessScore = this.calculateAccessScore();
    
    const overall = (kycScore + amlScore + auditScore + accessScore) / 4;
    
    return {
      overall,
      kycScore,
      amlScore,
      auditScore,
      accessScore,
      trends: this.generateComplianceTrends(),
      status: overall >= 90 ? 'EXCELLENT' : overall >= 75 ? 'GOOD' : overall >= 60 ? 'NEEDS_IMPROVEMENT' : 'POOR'
    };
  }

  /**
   * Collect violations
   */
  private collectViolations(): ViolationData {
    return {
      total: 0, // Would calculate from actual data
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      byCategory: {},
      recent: [] // Would get from actual data
    };
  }

  /**
   * Collect metrics
   */
  private collectMetrics(): MetricsData {
    return {
      systemHealth: 95,
      performance: 88,
      availability: 99.9,
      responseTime: 150,
      throughput: 1000,
      errorRate: 0.1,
      resourceUsage: {
        cpu: 45,
        memory: 60,
        disk: 30,
        network: 25
      }
    };
  }

  /**
   * Collect alerts
   */
  private collectAlerts(): AlertData {
    return {
      total: 0, // Would calculate from actual data
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      recent: [] // Would get from actual data
    };
  }

  /**
   * Generate charts for dashboard
   */
  private generateCharts(): ChartData[] {
    return [
      {
        id: 'compliance-trends',
        type: 'LINE',
        title: 'Compliance Score Trends',
        data: this.generateComplianceTrends(),
        xAxis: 'date',
        yAxis: 'score',
        colors: ['#4CAF50', '#2196F3', '#FF9800', '#F44336'],
        options: {
          responsive: true,
          maintainAspectRatio: false
        }
      },
      {
        id: 'risk-distribution',
        type: 'PIE',
        title: 'Risk Distribution',
        data: [
          { category: 'Low', value: 60 },
          { category: 'Medium', value: 25 },
          { category: 'High', value: 10 },
          { category: 'Critical', value: 5 }
        ],
        xAxis: 'category',
        yAxis: 'count',
        colors: ['#4CAF50', '#FF9800', '#FF5722', '#F44336']
      },
      {
        id: 'transaction-volume',
        type: 'BAR',
        title: 'Transaction Volume',
        data: this.generateTransactionVolume(),
        xAxis: 'date',
        yAxis: 'volume',
        colors: ['#2196F3']
      },
      {
        id: 'system-metrics',
        type: 'GAUGE',
        title: 'System Health',
        data: [
          { metric: 'System Health', value: 95, max: 100 },
          { metric: 'Performance', value: 88, max: 100 },
          { metric: 'Availability', value: 99.9, max: 100 },
          { metric: 'Response Time', value: 85, max: 100 }
        ],
        xAxis: 'metric',
        yAxis: 'value',
        colors: ['#4CAF50', '#2196F3', '#FF9800', '#FF5722']
      }
    ];
  }

  /**
   * Get current dashboard data
   */
  public getDashboardData(): DashboardData {
    return { ...this.dashboardData };
  }

  /**
   * Update widget configuration
   */
  public updateWidget(widgetId: string, config: Partial<WidgetConfig>): boolean {
    const widgetIndex = this.config.widgets.findIndex(w => w.id === widgetId);
    if (widgetIndex === -1) {
      return false;
    }

    this.config.widgets[widgetIndex] = { ...this.config.widgets[widgetIndex], ...config };
    
    this.emit('widgetUpdated', {
      widgetId,
      config: this.config.widgets[widgetIndex]
    });

    return true;
  }

  /**
   * Add widget to dashboard
   */
  public addWidget(widget: WidgetConfig): boolean {
    if (this.config.widgets.find(w => w.id === widget.id)) {
      return false;
    }

    this.config.widgets.push(widget);
    
    this.emit('widgetAdded', {
      widgetId: widget.id,
      widget
    });

    return true;
  }

  /**
   * Remove widget from dashboard
   */
  public removeWidget(widgetId: string): boolean {
    const index = this.config.widgets.findIndex(w => w.id === widgetId);
    if (index === -1) {
      return false;
    }

    this.config.widgets.splice(index, 1);
    
    this.emit('widgetRemoved', {
      widgetId
    });

    return true;
  }

  /**
   * Get widget configuration
   */
  public getWidget(widgetId: string): WidgetConfig | null {
    return this.config.widgets.find(w => w.id === widgetId) || null;
  }

  /**
   * Get all widgets
   */
  public getAllWidgets(): WidgetConfig[] {
    return [...this.config.widgets];
  }

  /**
   * Export dashboard data
   */
  public exportData(format: 'JSON' | 'PDF' | 'EXCEL' | 'CSV'): string | null {
    if (!this.config.enableExport) {
      return null;
    }

    const exportData = {
      dashboardData: this.dashboardData,
      config: this.config,
      timestamp: Date.now()
    };

    switch (format) {
      case 'JSON':
        return JSON.stringify(exportData, null, 2);
      case 'PDF':
        return 'PDF export not implemented';
      case 'EXCEL':
        return 'Excel export not implemented';
      case 'CSV':
        return 'CSV export not implemented';
      default:
        return null;
    }
  }

  /**
   * Get dashboard statistics
   */
  public getDashboardStatistics(): {
    lastUpdate: number;
    refreshInterval: number;
    totalWidgets: number;
    activeWidgets: number;
    dataPoints: number;
    alertsCount: number;
    complianceScore: number;
    systemHealth: number;
  } {
    return {
      lastUpdate: Date.now(),
      refreshInterval: this.config.refreshInterval,
      totalWidgets: this.config.widgets.length,
      activeWidgets: this.config.widgets.filter(w => w.visible).length,
      dataPoints: this.calculateDataPoints(),
      alertsCount: this.dashboardData.alerts.total,
      complianceScore: this.dashboardData.complianceScore.overall,
      systemHealth: this.dashboardData.metrics.systemHealth
    };
  }

  // Helper methods

  private calculateKYCScore(): number {
    const kycData = this.dashboardData.kycData;
    if (kycData.totalRequests === 0) return 100;
    
    return (kycData.verifiedUsers / kycData.totalRequests) * 100;
  }

  private calculateAMLScore(): number {
    const amlData = this.dashboardData.amlData;
    if (amlData.totalTransactions === 0) return 100;
    
    return ((amlData.totalTransactions - amlData.blockedTransactions) / amlData.totalTransactions) * 100;
  }

  private calculateAuditScore(): number {
    const auditData = this.dashboardData.auditData;
    if (auditData.totalLogs === 0) return 100;
    
    return ((auditData.totalLogs - auditData.integrityIssues) / auditData.totalLogs) * 100;
  }

  private calculateAccessScore(): number {
    const accessData = this.dashboardData.accessData;
    if (accessData.totalUsers === 0) return 100;
    
    return (accessData.activeUsers / accessData.totalUsers) * 100;
  }

  private generateVerificationTrends(): Array<{ date: string; count: number }> {
    // Generate sample data for the last 30 days
    const trends = [];
    const now = new Date();
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
      trends.push({
        date: date.toISOString().split('T')[0],
        count: Math.floor(Math.random() * 100) + 50
      });
    }
    
    return trends;
  }

  private generateTransactionVolume(): Array<{ date: string; volume: number }> {
    const volume = [];
    const now = new Date();
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
      volume.push({
        date: date.toISOString().split('T')[0],
        volume: Math.floor(Math.random() * 1000000) + 500000
      });
    }
    
    return volume;
  }

  private generateComplianceTrends(): Array<{ date: string; score: number }> {
    const trends = [];
    const now = new Date();
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
      trends.push({
        date: date.toISOString().split('T')[0],
        score: Math.floor(Math.random() * 20) + 80
      });
    }
    
    return trends;
  }

  private calculateDataPoints(): number {
    let count = 0;
    
    count += Object.keys(this.dashboardData.kycData).length;
    count += Object.keys(this.dashboardData.amlData).length;
    count += Object.keys(this.dashboardData.auditData).length;
    count += Object.keys(this.dashboardData.accessData).length;
    count += Object.keys(this.dashboardData.complianceScore).length;
    count += Object.keys(this.dashboardData.violations).length;
    count += Object.keys(this.dashboardData.metrics).length;
    count += this.dashboardData.alerts.total;
    count += this.dashboardData.charts.length;
    
    return count;
  }

  private getRecentLogs(): Array<{
    id: string;
    timestamp: number;
    level: string;
    category: string;
    message: string;
  }> {
    // Generate sample recent logs
    return [
      {
        id: 'LOG001',
        timestamp: Date.now() - 1000 * 60,
        level: 'INFO',
        category: 'SYSTEM',
        message: 'System health check completed'
      },
      {
        id: 'LOG002',
        timestamp: Date.now() - 2000 * 60,
        level: 'WARN',
        category: 'SECURITY',
        message: 'Failed login attempt detected'
      },
      {
        id: 'LOG003',
        timestamp: Date.now() - 3000 * 60,
        level: 'ERROR',
        category: 'SYSTEM',
        message: 'Database connection timeout'
      }
    ];
  }

  private getDefaultWidgets(): WidgetConfig[] {
    return [
      {
        id: 'compliance-score',
        type: 'COMPLIANCE_SCORE',
        title: 'Compliance Score',
        position: { x: 0, y: 0, width: 12, height: 6 },
        refreshInterval: 60000,
        config: { showTrends: true },
        visible: true
      },
      {
        id: 'kyc-summary',
        type: 'KYC_SUMMARY',
        title: 'KYC Summary',
        position: { x: 0, y: 6, width: 6, height: 6 },
        refreshInterval: 30000,
        config: { showCharts: true },
        visible: true
      },
      {
        id: 'aml-summary',
        type: 'AML_SUMMARY',
        title: 'AML Summary',
        position: { x: 6, y: 6, width: 6, height: 6 },
        refreshInterval: 30000,
        config: { showCharts: true },
        visible: true
      },
      {
        id: 'violations',
        type: 'VIOLATIONS',
        title: 'Violations',
        position: { x: 12, y: 0, width: 12, height: 6 },
        refreshInterval: 60000,
        config: { showDetails: true },
        visible: true
      },
      {
        id: 'metrics',
        type: 'METRICS',
        title: 'System Metrics',
        position: { x: 12, y: 6, width: 12, height: 6 },
        refreshInterval: 30000,
        config: { showCharts: true },
        visible: true
      },
      {
        id: 'alerts',
        type: 'ALERTS',
        title: 'Alerts',
        position: { x: 0, y: 12, width: 8, height: 6 },
        refreshInterval: 15000,
        config: { showDetails: true },
        visible: true
      },
      {
        id: 'audit-summary',
        type: 'AUDIT_SUMMARY',
        title: 'Audit Summary',
        position: { x: 8, y: 12, width: 8, height: 6 },
        refreshInterval: 30000,
        config: { showCharts: true },
        visible: true
      },
      {
        id: 'access-summary',
        type: 'ACCESS_SUMMARY',
        title: 'Access Summary',
        position: { x: 16, y: 12, width: 8, height: 6 },
        refreshInterval: 30000,
        config: { showCharts: true },
        visible: true
      }
    ];
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<DashboardConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (this.config.enableRealTimeUpdates && !this.refreshTimer) {
      this.startRealTimeUpdates();
    } else if (!this.config.enableRealTimeUpdates && this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): DashboardConfig {
    return { ...this.config };
  }

  /**
   * Stop dashboard
   */
  public stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    this.emit('dashboardStopped');
  }
}
