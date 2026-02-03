import { EventEmitter } from 'events';
import { Transaction } from '../types/block.types';

export interface KYCConfig {
  enableDocumentVerification: boolean;
  enableBiometricVerification: boolean;
  enableBackgroundChecks: boolean;
  enableRiskAssessment: boolean;
  enableContinuousMonitoring: boolean;
  documentRetentionPeriod: number;
  riskThresholds: RiskThresholds;
  approvedDocumentTypes: string[];
  verificationProviders: VerificationProvider[];
}

export interface RiskThresholds {
  lowRisk: number;
  mediumRisk: number;
  highRisk: number;
  suspiciousActivity: number;
  transactionLimit: number;
  dailyLimit: number;
  monthlyLimit: number;
}

export interface VerificationProvider {
  id: string;
  name: string;
  type: 'DOCUMENT' | 'BIOMETRIC' | 'BACKGROUND' | 'AML';
  endpoint: string;
  apiKey: string;
  enabled: boolean;
}

export interface KYCRequest {
  id: string;
  userId: string;
  requestType: 'INDIVIDUAL' | 'BUSINESS' | 'HIGH_VALUE';
  personalInfo: PersonalInfo;
  documents: KYCDocument[];
  biometricData?: BiometricData;
  backgroundCheck?: BackgroundCheckRequest;
  riskAssessment?: RiskAssessment;
  status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED' | 'REVIEW_REQUIRED';
  submittedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  rejectionReason?: string;
  riskScore: number;
  verificationLevel: 'BASIC' | 'STANDARD' | 'ENHANCED' | 'COMPREHENSIVE';
}

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  address: Address;
  email: string;
  phone: string;
  taxId?: string;
  ssn?: string;
  passportNumber?: string;
  driversLicense?: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isPrimary: boolean;
}

export interface KYCDocument {
  id: string;
  type: 'PASSPORT' | 'DRIVERS_LICENSE' | 'ID_CARD' | 'UTILITY_BILL' | 'BANK_STATEMENT' | 'BUSINESS_LICENSE' | 'TAX_RETURN' | 'PROOF_OF_ADDRESS';
  documentNumber: string;
  issuingCountry: string;
  expiryDate: string;
  frontImage?: string; // Base64 encoded
  backImage?: string; // Base64 encoded
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  verifiedAt?: number;
  rejectionReason?: string;
  metadata?: any;
}

export interface BiometricData {
  fingerprint?: string;
  facialRecognition?: string;
  irisScan?: string;
  voicePrint?: string;
  signature?: string;
  verificationMethod: 'FINGERPRINT' | 'FACIAL' | 'IRIS' | 'VOICE' | 'SIGNATURE';
}

export interface BackgroundCheckRequest {
  criminalRecord: boolean;
  creditCheck: boolean;
  employmentVerification: boolean;
  educationVerification: boolean;
  referenceCheck: boolean;
  watchlistScreening: boolean;
  adverseMediaCheck: boolean;
}

export interface RiskAssessment {
  riskFactors: RiskFactor[];
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendedActions: string[];
  monitoringRequired: boolean;
  reviewFrequency: number; // days
}

export interface RiskFactor {
  category: 'IDENTITY' | 'FINANCIAL' | 'GEOGRAPHIC' | 'BEHAVIORAL' | 'REGULATORY';
  factor: string;
  weight: number;
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  description: string;
}

export interface KYCVerificationResult {
  requestId: string;
  userId: string;
  status: 'VERIFIED' | 'REJECTED' | 'REVIEW_REQUIRED';
  verificationLevel: string;
  riskScore: number;
  riskLevel: string;
  verifiedDocuments: string[];
  rejectedDocuments: string[];
  additionalRequirements?: string[];
  nextReviewDate?: number;
  restrictions?: string[];
}

/**
 * KYC (Know Your Customer) verification system
 * Implements comprehensive identity verification with document validation, biometric checks, and risk assessment
 */
export class KYCSystem extends EventEmitter {
  private config: KYCConfig;
  private requests: Map<string, KYCRequest> = new Map();
  private verifications: Map<string, KYCVerificationResult> = new Map();
  private watchlist: Set<string> = new Set();
  private suspiciousPatterns: Map<string, any> = new Map();

  constructor(config: Partial<KYCConfig> = {}) {
    super();
    
    this.config = {
      enableDocumentVerification: true,
      enableBiometricVerification: true,
      enableBackgroundChecks: true,
      enableRiskAssessment: true,
      enableContinuousMonitoring: true,
      documentRetentionPeriod: 7 * 365 * 24 * 60 * 60 * 1000, // 7 years
      riskThresholds: {
        lowRisk: 30,
        mediumRisk: 60,
        highRisk: 80,
        suspiciousActivity: 90,
        transactionLimit: 10000,
        dailyLimit: 50000,
        monthlyLimit: 1000000
      },
      approvedDocumentTypes: [
        'PASSPORT', 'DRIVERS_LICENSE', 'ID_CARD', 'UTILITY_BILL', 
        'BANK_STATEMENT', 'BUSINESS_LICENSE', 'TAX_RETURN', 'PROOF_OF_ADDRESS'
      ],
      verificationProviders: [],
      ...config
    };

    this.initializeWatchlist();
    this.initializeSuspiciousPatterns();
  }

  /**
   * Submit KYC verification request
   * @param userId - User ID
   * @param requestType - Request type
   * @param personalInfo - Personal information
   * @param documents - Documents to verify
   * @returns Request ID
   */
  public submitKYCRequest(
    userId: string,
    requestType: 'INDIVIDUAL' | 'BUSINESS' | 'HIGH_VALUE',
    personalInfo: PersonalInfo,
    documents: KYCDocument[]
  ): string {
    const requestId = this.generateRequestId();
    
    const request: KYCRequest = {
      id: requestId,
      userId,
      requestType,
      personalInfo,
      documents,
      status: 'PENDING',
      submittedAt: Date.now(),
      riskScore: 0,
      verificationLevel: this.determineVerificationLevel(requestType)
    };

    this.requests.set(requestId, request);
    
    // Start verification process
    this.processKYCRequest(requestId);

    this.emit('kycSubmitted', {
      requestId,
      userId,
      requestType,
      verificationLevel: request.verificationLevel
    });

    return requestId;
  }

  /**
   * Process KYC verification request
   */
  private async processKYCRequest(requestId: string): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request) {
      return;
    }

    request.status = 'IN_PROGRESS';

    try {
      // Step 1: Document verification
      if (this.config.enableDocumentVerification) {
        await this.verifyDocuments(request);
      }

      // Step 2: Biometric verification
      if (this.config.enableBiometricVerification && request.biometricData) {
        await this.verifyBiometrics(request);
      }

      // Step 3: Background checks
      if (this.config.enableBackgroundChecks && request.backgroundCheck) {
        await this.performBackgroundCheck(request);
      }

      // Step 4: Risk assessment
      if (this.config.enableRiskAssessment) {
        await this.performRiskAssessment(request);
      }

      // Step 5: Final decision
      const result = await this.makeVerificationDecision(request);
      this.verifications.set(requestId, result);

      // Update request status
      request.status = result.status;
      request.reviewedAt = Date.now();

      this.emit('kycCompleted', {
        requestId,
        userId: request.userId,
        status: result.status,
        riskScore: result.riskScore,
        riskLevel: result.riskLevel
      });

    } catch (error) {
      request.status = 'REJECTED';
      request.rejectionReason = error instanceof Error ? error.message : 'Verification failed';
      
      this.emit('kycFailed', {
        requestId,
        userId: request.userId,
        error: request.rejectionReason
      });
    }
  }

  /**
   * Verify documents
   */
  private async verifyDocuments(request: KYCRequest): Promise<void> {
    for (const document of request.documents) {
      try {
        // Check document type
        if (!this.config.approvedDocumentTypes.includes(document.type)) {
          document.verificationStatus = 'REJECTED';
          document.rejectionReason = `Document type ${document.type} is not approved`;
          continue;
        }

        // Check expiry
        if (this.isDocumentExpired(document)) {
          document.verificationStatus = 'EXPIRED';
          document.rejectionReason = 'Document has expired';
          continue;
        }

        // Verify document authenticity
        const isValid = await this.verifyDocumentAuthenticity(document);
        
        if (isValid) {
          document.verificationStatus = 'VERIFIED';
          document.verifiedAt = Date.now();
        } else {
          document.verificationStatus = 'REJECTED';
          document.rejectionReason = 'Document verification failed';
        }

      } catch (error) {
        document.verificationStatus = 'REJECTED';
        document.rejectionReason = error instanceof Error ? error.message : 'Document verification error';
      }
    }
  }

  /**
   * Verify biometric data
   */
  private async verifyBiometrics(request: KYCRequest): Promise<void> {
    if (!request.biometricData) {
      return;
    }

    // Simulate biometric verification
    const isValid = await this.verifyBiometricAuthenticity(request.biometricData);
    
    if (!isValid) {
      throw new Error('Biometric verification failed');
    }
  }

  /**
   * Perform background check
   */
  private async performBackgroundCheck(request: KYCRequest): Promise<void> {
    if (!request.backgroundCheck) {
      return;
    }

    // Check against watchlist
    if (this.isInWatchlist(request.personalInfo)) {
      throw new Error('User found in watchlist');
    }

    // Check suspicious patterns
    if (this.hasSuspiciousPatterns(request)) {
      throw new Error('Suspicious activity detected');
    }

    // Simulate other background checks
    if (request.backgroundCheck.criminalRecord) {
      await this.checkCriminalRecord(request);
    }

    if (request.backgroundCheck.creditCheck) {
      await this.performCreditCheck(request);
    }
  }

  /**
   * Perform risk assessment
   */
  private async performRiskAssessment(request: KYCRequest): Promise<void> {
    const riskFactors: RiskFactor[] = [];
    let riskScore = 0;

    // Identity risk factors
    riskFactors.push(...this.assessIdentityRisk(request));

    // Financial risk factors
    riskFactors.push(...this.assessFinancialRisk(request));

    // Geographic risk factors
    riskFactors.push(...this.assessGeographicRisk(request));

    // Behavioral risk factors
    riskFactors.push(...this.assessBehavioralRisk(request));

    // Calculate total risk score
    riskScore = riskFactors.reduce((total, factor) => {
      const impact = factor.impact === 'NEGATIVE' ? 1 : factor.impact === 'POSITIVE' ? -1 : 0;
      return total + (factor.weight * impact);
    }, 0);

    // Normalize risk score to 0-100 scale
    riskScore = Math.max(0, Math.min(100, (riskScore + 100) / 2));

    const riskLevel = this.determineRiskLevel(riskScore);
    const recommendedActions = this.getRecommendedActions(riskLevel, riskFactors);

    request.riskAssessment = {
      riskFactors,
      riskScore,
      riskLevel,
      recommendedActions,
      monitoringRequired: riskLevel !== 'LOW',
      reviewFrequency: riskLevel === 'LOW' ? 365 : riskLevel === 'MEDIUM' ? 180 : 90
    };

    request.riskScore = riskScore;
  }

  /**
   * Make final verification decision
   */
  private async makeVerificationDecision(request: KYCRequest): Promise<KYCVerificationResult> {
    const verifiedDocuments = request.documents.filter(d => d.verificationStatus === 'VERIFIED');
    const rejectedDocuments = request.documents.filter(d => d.verificationStatus === 'REJECTED');

    // Check if all required documents are verified
    const requiredDocuments = this.getRequiredDocuments(request.requestType);
    const hasAllDocuments = requiredDocuments.every(docType => 
      verifiedDocuments.some(d => d.type === docType)
    );

    if (!hasAllDocuments) {
      return {
        requestId: request.id,
        userId: request.userId,
        status: 'REJECTED',
        verificationLevel: request.verificationLevel,
        riskScore: request.riskScore,
        riskLevel: this.determineRiskLevel(request.riskScore),
        verifiedDocuments: verifiedDocuments.map(d => d.type),
        rejectedDocuments: rejectedDocuments.map(d => d.type),
        additionalRequirements: requiredDocuments.filter(docType => 
          !verifiedDocuments.some(d => d.type === docType)
        )
      };
    }

    // Check risk level
    const riskLevel = this.determineRiskLevel(request.riskScore);
    
    if (riskLevel === 'CRITICAL') {
      return {
        requestId: request.id,
        userId: request.userId,
        status: 'REJECTED',
        verificationLevel: request.verificationLevel,
        riskScore: request.riskScore,
        riskLevel,
        verifiedDocuments: verifiedDocuments.map(d => d.type),
        rejectedDocuments: rejectedDocuments.map(d => d.type),
        rejectionReason: 'Risk level too high'
      };
    }

    if (riskLevel === 'HIGH') {
      return {
        requestId: request.id,
        userId: request.userId,
        status: 'REVIEW_REQUIRED',
        verificationLevel: request.verificationLevel,
        riskScore: request.riskScore,
        riskLevel,
        verifiedDocuments: verifiedDocuments.map(d => d.type),
        rejectedDocuments: rejectedDocuments.map(d => d.type),
        additionalRequirements: request.riskAssessment?.recommendedActions,
        nextReviewDate: Date.now() + (request.riskAssessment?.reviewFrequency || 90) * 24 * 60 * 60 * 1000,
        restrictions: ['LIMITED_TRANSACTIONS', 'ENHANCED_MONITORING']
      };
    }

    // Approved
    return {
      requestId: request.id,
      userId: request.userId,
      status: 'VERIFIED',
      verificationLevel: request.verificationLevel,
      riskScore: request.riskScore,
      riskLevel,
      verifiedDocuments: verifiedDocuments.map(d => d.type),
      rejectedDocuments: rejectedDocuments.map(d => d.type),
      nextReviewDate: request.riskAssessment?.monitoringRequired ? 
        Date.now() + (request.riskAssessment.reviewFrequency || 365) * 24 * 60 * 60 * 1000 : undefined
    };
  }

  /**
   * Get KYC request status
   */
  public getKYCRequest(requestId: string): KYCRequest | null {
    return this.requests.get(requestId) || null;
  }

  /**
   * Get KYC verification result
   */
  public getKYCVerification(requestId: string): KYCVerificationResult | null {
    return this.verifications.get(requestId) || null;
  }

  /**
   * Get all KYC requests for user
   */
  public getUserKYCRequests(userId: string): KYCRequest[] {
    return Array.from(this.requests.values()).filter(r => r.userId === userId);
  }

  /**
   * Update KYC request
   */
  public updateKYCRequest(requestId: string, updates: Partial<KYCRequest>): boolean {
    const request = this.requests.get(requestId);
    if (!request) {
      return false;
    }

    Object.assign(request, updates);
    this.emit('kycUpdated', { requestId, updates });
    return true;
  }

  /**
   * Check if user is verified
   */
  public isUserVerified(userId: string): boolean {
    const userRequests = this.getUserKYCRequests(userId);
    const latestRequest = userRequests.sort((a, b) => b.submittedAt - a.submittedAt)[0];
    
    return latestRequest?.status === 'VERIFIED' || false;
  }

  /**
   * Get user risk level
   */
  public getUserRiskLevel(userId: string): string {
    const userRequests = this.getUserKYCRequests(userId);
    const latestRequest = userRequests.sort((a, b) => b.submittedAt - a.submittedAt)[0];
    
    if (!latestRequest) {
      return 'UNKNOWN';
    }

    return this.determineRiskLevel(latestRequest.riskScore);
  }

  /**
   * Check transaction compliance
   */
  public checkTransactionCompliance(userId: string, amount: number, transactionType: string): {
    compliant: boolean;
    reason?: string;
    restrictions?: string[];
  } {
    const userRequests = this.getUserKYCRequests(userId);
    const latestRequest = userRequests.sort((a, b) => b.submittedAt - a.submittedAt)[0];
    
    if (!latestRequest || latestRequest.status !== 'VERIFIED') {
      return {
        compliant: false,
        reason: 'User not verified'
      };
    }

    const riskLevel = this.determineRiskLevel(latestRequest.riskScore);
    
    // Check transaction limits based on risk level
    const limits = this.config.riskThresholds;
    
    if (riskLevel === 'HIGH') {
      if (amount > limits.transactionLimit) {
        return {
          compliant: false,
          reason: 'Transaction amount exceeds limit',
          restrictions: ['TRANSACTION_LIMIT_EXCEEDED']
        };
      }
    }

    // Check for suspicious transaction patterns
    if (this.isSuspiciousTransaction(userId, amount, transactionType)) {
      return {
        compliant: false,
        reason: 'Suspicious transaction pattern detected',
        restrictions: ['SUSPICIOUS_ACTIVITY']
      };
    }

    return { compliant: true };
  }

  /**
   * Get KYC statistics
   */
  public getKYCStats(): {
    totalRequests: number;
    verifiedRequests: number;
    rejectedRequests: number;
    pendingRequests: number;
    averageRiskScore: number;
    riskDistribution: Record<string, number>;
    verificationLevelDistribution: Record<string, number>;
  } {
    const requests = Array.from(this.requests.values());
    
    return {
      totalRequests: requests.length,
      verifiedRequests: requests.filter(r => r.status === 'VERIFIED').length,
      rejectedRequests: requests.filter(r => r.status === 'REJECTED').length,
      pendingRequests: requests.filter(r => r.status === 'PENDING' || r.status === 'IN_PROGRESS').length,
      averageRiskScore: requests.reduce((sum, r) => sum + r.riskScore, 0) / requests.length,
      riskDistribution: this.calculateRiskDistribution(requests),
      verificationLevelDistribution: this.calculateVerificationLevelDistribution(requests)
    };
  }

  // Helper methods

  private generateRequestId(): string {
    return `kyc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private determineVerificationLevel(requestType: string): 'BASIC' | 'STANDARD' | 'ENHANCED' | 'COMPREHENSIVE' {
    switch (requestType) {
      case 'INDIVIDUAL':
        return 'STANDARD';
      case 'BUSINESS':
        return 'ENHANCED';
      case 'HIGH_VALUE':
        return 'COMPREHENSIVE';
      default:
        return 'BASIC';
    }
  }

  private isDocumentExpired(document: KYCDocument): boolean {
    return new Date(document.expiryDate) < new Date();
  }

  private async verifyDocumentAuthenticity(document: KYCDocument): Promise<boolean> {
    // Simulate document verification
    return new Promise((resolve) => {
      setTimeout(() => {
        // 95% success rate for simulation
        resolve(Math.random() > 0.05);
      }, 1000);
    });
  }

  private async verifyBiometricAuthenticity(biometricData: BiometricData): Promise<boolean> {
    // Simulate biometric verification
    return new Promise((resolve) => {
      setTimeout(() => {
        // 98% success rate for simulation
        resolve(Math.random() > 0.02);
      }, 500);
    });
  }

  private isInWatchlist(personalInfo: PersonalInfo): boolean {
    // Check against watchlist
    return this.watchlist.has(personalInfo.taxId || '') || 
           this.watchlist.has(personalInfo.ssn || '') ||
           this.watchlist.has(personalInfo.passportNumber || '');
  }

  private hasSuspiciousPatterns(request: KYCRequest): boolean {
    // Check for suspicious patterns
    const suspiciousKeys = [
      request.personalInfo.email,
      request.personalInfo.phone,
      request.personalInfo.address.postalCode
    ];

    return suspiciousKeys.some(key => 
      this.suspiciousPatterns.has(key)
    );
  }

  private async checkCriminalRecord(request: KYCRequest): Promise<void> {
    // Simulate criminal record check
  }

  private async performCreditCheck(request: KYCRequest): Promise<void> {
    // Simulate credit check
  }

  private assessIdentityRisk(request: KYCRequest): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // Check for incomplete information
    if (!request.personalInfo.taxId && !request.personalInfo.ssn) {
      factors.push({
        category: 'IDENTITY',
        factor: 'MISSING_IDENTIFICATION',
        weight: 20,
        impact: 'NEGATIVE',
        description: 'Missing tax ID or SSN'
      });
    }

    // Check for temporary addresses
    const tempAddress = request.personalInfo.address;
    if (tempAddress.street.toLowerCase().includes('temp') || 
        tempAddress.city.toLowerCase().includes('temp')) {
      factors.push({
        category: 'IDENTITY',
        factor: 'TEMPORARY_ADDRESS',
        weight: 15,
        impact: 'NEGATIVE',
        description: 'Temporary address detected'
      });
    }

    return factors;
  }

  private assessFinancialRisk(request: KYCRequest): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // High-value business request
    if (request.requestType === 'HIGH_VALUE') {
      factors.push({
        category: 'FINANCIAL',
        factor: 'HIGH_VALUE_TRANSACTION',
        weight: 25,
        impact: 'NEGATIVE',
        description: 'High-value transaction request'
      });
    }

    return factors;
  }

  private assessGeographicRisk(request: KYCRequest): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // High-risk countries
    const highRiskCountries = ['XX', 'YY', 'ZZ']; // Placeholder for high-risk countries
    if (highRiskCountries.includes(request.personalInfo.address.country)) {
      factors.push({
        category: 'GEOGRAPHIC',
        factor: 'HIGH_RISK_COUNTRY',
        weight: 30,
        impact: 'NEGATIVE',
        description: 'High-risk country detected'
      });
    }

    return factors;
  }

  private assessBehavioralRisk(request: KYCRequest): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // Rapid submission
    const submissionTime = Date.now() - request.submittedAt;
    if (submissionTime < 60000) { // Less than 1 minute
      factors.push({
        category: 'BEHAVIORAL',
        factor: 'RAPID_SUBMISSION',
        weight: 10,
        impact: 'NEGATIVE',
        description: 'Rapid submission detected'
      });
    }

    return factors;
  }

  private determineRiskLevel(riskScore: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (riskScore < this.config.riskThresholds.lowRisk) {
      return 'LOW';
    } else if (riskScore < this.config.riskThresholds.mediumRisk) {
      return 'MEDIUM';
    } else if (riskScore < this.config.riskThresholds.highRisk) {
      return 'HIGH';
    } else {
      return 'CRITICAL';
    }
  }

  private getRecommendedActions(riskLevel: string, riskFactors: RiskFactor[]): string[] {
    const actions: string[] = [];
    
    switch (riskLevel) {
      case 'LOW':
        actions.push('Standard monitoring');
        break;
      case 'MEDIUM':
        actions.push('Enhanced monitoring', 'Periodic review');
        break;
      case 'HIGH':
        actions.push('Enhanced monitoring', 'Transaction limits', 'Frequent review');
        break;
      case 'CRITICAL':
        actions.push('Transaction limits', 'Manual review', 'Enhanced due diligence');
        break;
    }

    // Add specific actions based on risk factors
    for (const factor of riskFactors) {
      if (factor.category === 'IDENTITY' && factor.impact === 'NEGATIVE') {
        actions.push('Additional identity verification');
      }
    }

    return actions;
  }

  private getRequiredDocuments(requestType: string): string[] {
    switch (requestType) {
      case 'INDIVIDUAL':
        return ['PASSPORT', 'DRIVERS_LICENSE', 'PROOF_OF_ADDRESS'];
      case 'BUSINESS':
        return ['BUSINESS_LICENSE', 'TAX_RETURN', 'PROOF_OF_ADDRESS'];
      case 'HIGH_VALUE':
        return ['PASSPORT', 'DRIVERS_LICENSE', 'BANK_STATEMENT', 'TAX_RETURN', 'PROOF_OF_ADDRESS'];
      default:
        return ['ID_CARD'];
    }
  }

  private isSuspiciousTransaction(userId: string, amount: number, transactionType: string): boolean {
    // Simulate suspicious transaction detection
    return amount > 100000 || transactionType === 'CRYPTO';
  }

  private calculateRiskDistribution(requests: KYCRequest[]): Record<string, number> {
    const distribution: Record<string, number> = {
      'LOW': 0,
      'MEDIUM': 0,
      'HIGH': 0,
      'CRITICAL': 0
    };

    for (const request of requests) {
      const level = this.determineRiskLevel(request.riskScore);
      distribution[level]++;
    }

    return distribution;
  }

  private calculateVerificationLevelDistribution(requests: KYCRequest[]): Record<string, number> {
    const distribution: Record<string, number> = {
      'BASIC': 0,
      'STANDARD': 0,
      'ENHANCED': 0,
      'COMPREHENSIVE': 0
    };

    for (const request of requests) {
      distribution[request.verificationLevel]++;
    }

    return distribution;
  }

  private initializeWatchlist(): void {
    // Initialize with some sample watchlist entries
    this.watchlist.add('123456789');
    this.watchlist.add('987654321');
  }

  private initializeSuspiciousPatterns(): void {
    // Initialize with some suspicious patterns
    this.suspiciousPatterns.set('temp@example.com', true);
    this.suspiciousPatterns.set('test@test.com', true);
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<KYCConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): KYCConfig {
    return { ...this.config };
  }

  /**
   * Add to watchlist
   */
  public addToWatchlist(identifier: string): void {
    this.watchlist.add(identifier);
    this.emit('watchlistUpdated', { added: identifier });
  }

  /**
   * Remove from watchlist
   */
  public removeFromWatchlist(identifier: string): void {
    this.watchlist.delete(identifier);
    this.emit('watchlistUpdated', { removed: identifier });
  }

  /**
   * Get watchlist
   */
  public getWatchlist(): Set<string> {
    return new Set(this.watchlist);
  }
}
