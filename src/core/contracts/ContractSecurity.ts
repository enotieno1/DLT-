import { EventEmitter } from 'events';
import { SmartContract, ContractABI } from './SmartContract';
import { ContractExecutionEngine } from './ContractExecutionEngine';
import { Transaction } from '../types/block.types';
import { CryptoUtils } from '../crypto';

export interface SecurityConfig {
  enableStaticAnalysis: boolean;
  enableRuntimeChecks: boolean;
  enableAccessControl: boolean;
  maxExecutionDepth: number;
  maxLoopIterations: number;
  maxArraySize: number;
  allowedLibraries: string[];
  blockedPatterns: string[];
  securityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'STRICT';
}

export interface SecurityViolation {
  type: 'STATIC_ANALYSIS' | 'RUNTIME_CHECK' | 'ACCESS_CONTROL' | 'RESOURCE_LIMIT' | 'PATTERN_MATCH';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  contractAddress: string;
  functionName?: string;
  description: string;
  recommendation: string;
  timestamp: number;
  transactionHash?: string;
}

export interface SecurityPolicy {
  requireOwner: boolean;
  requireMultiSig: boolean;
  requireTimeLock: boolean;
  maxGasPerFunction: Map<string, number>;
  allowedCallers: Map<string, string[]>;
  timeLockPeriod: number;
  multiSigThreshold: number;
}

export interface AccessControlEntry {
  contractAddress: string;
  functionName: string;
  role: string;
  allowed: boolean;
  conditions?: string[];
}

export interface SecurityReport {
  contractAddress: string;
  timestamp: number;
  violations: SecurityViolation[];
  riskScore: number;
  recommendations: string[];
  passed: boolean;
}

/**
 * Contract security validation and enforcement system
 * Provides comprehensive security checks, access control, and vulnerability detection
 */
export class ContractSecurity extends EventEmitter {
  private config: SecurityConfig;
  private policy: SecurityPolicy;
  private executionEngine: ContractExecutionEngine;
  private securityViolations: SecurityViolation[] = [];
  private accessControl: Map<string, AccessControlEntry[]> = new Map();
  private blacklistedContracts: Set<string> = new Set();
  private securityReports: Map<string, SecurityReport> = new Map();

  constructor(
    config: Partial<SecurityConfig> = {},
    executionEngine: ContractExecutionEngine
  ) {
    super();
    
    this.config = {
      enableStaticAnalysis: true,
      enableRuntimeChecks: true,
      enableAccessControl: true,
      maxExecutionDepth: 100,
      maxLoopIterations: 1000,
      maxArraySize: 10000,
      allowedLibraries: [],
      blockedPatterns: [
        'selfdestruct',
        'delegatecall',
        'suicide',
        'block.timestamp',
        'now',
        'extcodesize'
      ],
      securityLevel: 'HIGH',
      ...config
    };

    this.policy = {
      requireOwner: true,
      requireMultiSig: false,
      requireTimeLock: false,
      maxGasPerFunction: new Map(),
      allowedCallers: new Map(),
      timeLockPeriod: 86400, // 24 hours
      multiSigThreshold: 2
    };

    this.executionEngine = executionEngine;
  }

  /**
   * Perform comprehensive security analysis on contract
   * @param contract - Smart contract to analyze
   * @returns Security report
   */
  public analyzeContract(contract: SmartContract): SecurityReport {
    const violations: SecurityViolation[] = [];
    
    // Static analysis
    if (this.config.enableStaticAnalysis) {
      const staticViolations = this.performStaticAnalysis(contract);
      violations.push(...staticViolations);
    }

    // Runtime security checks
    if (this.config.enableRuntimeChecks) {
      const runtimeViolations = this.performRuntimeChecks(contract);
      violations.push(...runtimeViolations);
    }

    // Access control analysis
    if (this.config.enableAccessControl) {
      const accessViolations = this.performAccessControlAnalysis(contract);
      violations.push(...accessViolations);
    }

    // Pattern matching for known vulnerabilities
    const patternViolations = this.performPatternMatching(contract);
    violations.push(...patternViolations);

    // Calculate risk score
    const riskScore = this.calculateRiskScore(violations);

    // Generate recommendations
    const recommendations = this.generateRecommendations(violations);

    const report: SecurityReport = {
      contractAddress: contract.address,
      timestamp: Date.now(),
      violations,
      riskScore,
      recommendations,
      passed: violations.filter(v => v.severity === 'CRITICAL' || v.severity === 'HIGH').length === 0
    };

    // Store report
    this.securityReports.set(contract.address, report);

    // Emit analysis completed event
    this.emit('securityAnalysisCompleted', {
      contractAddress: contract.address,
      riskScore,
      violationsCount: violations.length,
      passed: report.passed
    });

    return report;
  }

  /**
   * Perform static analysis on contract
   */
  private performStaticAnalysis(contract: SmartContract): SecurityViolation[] {
    const violations: SecurityViolation[] = [];

    // Check for dangerous functions
    for (const func of contract.abi.functions) {
      // Check for payable functions without proper validation
      if (func.mutability === 'payable') {
        if (!this.hasProperPayableValidation(func)) {
          violations.push({
            type: 'STATIC_ANALYSIS',
            severity: 'HIGH',
            contractAddress: contract.address,
            functionName: func.name,
            description: `Payable function ${func.name} lacks proper validation`,
            recommendation: 'Add input validation and access control to payable functions',
            timestamp: Date.now()
          });
        }
      }

      // Check for external functions without access control
      if (func.visibility === 'external' || func.visibility === 'public') {
        if (!this.hasAccessControl(func)) {
          violations.push({
            type: 'ACCESS_CONTROL',
            severity: 'MEDIUM',
            contractAddress: contract.address,
            functionName: func.name,
            description: `External function ${func.name} lacks access control`,
            recommendation: 'Implement proper access control mechanisms',
            timestamp: Date.now()
          });
        }
      }

      // Check for high gas limits
      if (func.gasLimit && func.gasLimit > 1000000) {
        violations.push({
          type: 'RESOURCE_LIMIT',
          severity: 'MEDIUM',
          contractAddress: contract.address,
          functionName: func.name,
          description: `Function ${func.name} has high gas limit: ${func.gasLimit}`,
          recommendation: 'Optimize function to reduce gas consumption',
          timestamp: Date.now()
        });
      }
    }

    return violations;
  }

  /**
   * Perform runtime security checks
   */
  private performRuntimeChecks(contract: SmartContract): SecurityViolation[] {
    const violations: SecurityViolation[] = [];

    // Check for reentrancy vulnerabilities
    if (this.hasReentrancyVulnerability(contract)) {
      violations.push({
        type: 'RUNTIME_CHECK',
        severity: 'HIGH',
        contractAddress: contract.address,
        description: 'Potential reentrancy vulnerability detected',
        recommendation: 'Implement checks-effects-interactions pattern',
        timestamp: Date.now()
      });
    }

    // Check for integer overflow/underflow
    if (this.hasIntegerOverflowRisk(contract)) {
      violations.push({
        type: 'RUNTIME_CHECK',
        severity: 'HIGH',
        contractAddress: contract.address,
        description: 'Potential integer overflow/underflow risk',
        recommendation: 'Use SafeMath library or built-in overflow protection',
        timestamp: Date.now()
      });
    }

    // Check for unchecked external calls
    if (this.hasUncheckedExternalCalls(contract)) {
      violations.push({
        type: 'RUNTIME_CHECK',
        severity: 'MEDIUM',
        contractAddress: contract.address,
        description: 'Unchecked external calls detected',
        recommendation: 'Always check return values of external calls',
        timestamp: Date.now()
      });
    }

    return violations;
  }

  /**
   * Perform access control analysis
   */
  private performAccessControlAnalysis(contract: SmartContract): SecurityViolation[] {
    const violations: SecurityViolation[] = [];

    // Check for owner functions
    const ownerFunctions = contract.abi.functions.filter(f => 
      f.name.toLowerCase().includes('owner') || 
      f.name.toLowerCase().includes('admin')
    );

    for (const func of ownerFunctions) {
      if (func.visibility === 'public' || func.visibility === 'external') {
        violations.push({
          type: 'ACCESS_CONTROL',
          severity: 'HIGH',
          contractAddress: contract.address,
          functionName: func.name,
          description: `Owner function ${func.name} is publicly accessible`,
          recommendation: 'Restrict owner functions to authorized addresses only',
          timestamp: Date.now()
        });
      }
    }

    // Check for missing role-based access control
    const criticalFunctions = contract.abi.functions.filter(f => 
      f.name.toLowerCase().includes('transfer') ||
      f.name.toLowerCase().includes('mint') ||
      f.name.toLowerCase().includes('burn') ||
      f.name.toLowerCase().includes('approve')
    );

    for (const func of criticalFunctions) {
      if (!this.hasRoleBasedAccessControl(func)) {
        violations.push({
          type: 'ACCESS_CONTROL',
          severity: 'MEDIUM',
          contractAddress: contract.address,
          functionName: func.name,
          description: `Critical function ${func.name} lacks role-based access control`,
          recommendation: 'Implement role-based access control for critical functions',
          timestamp: Date.now()
        });
      }
    }

    return violations;
  }

  /**
   * Perform pattern matching for known vulnerabilities
   */
  private performPatternMatching(contract: SmartContract): SecurityViolation[] {
    const violations: SecurityViolation[] = [];

    // Check for blocked patterns in function names
    for (const func of contract.abi.functions) {
      for (const pattern of this.config.blockedPatterns) {
        if (func.name.toLowerCase().includes(pattern.toLowerCase())) {
          violations.push({
            type: 'PATTERN_MATCH',
            severity: 'HIGH',
            contractAddress: contract.address,
            functionName: func.name,
            description: `Function ${func.name} contains potentially dangerous pattern: ${pattern}`,
            recommendation: `Avoid using ${pattern} or implement additional security measures`,
            timestamp: Date.now()
          });
        }
      }
    }

    return violations;
  }

  /**
   * Check if function has proper payable validation
   */
  private hasProperPayableValidation(func: any): boolean {
    // Simplified check - in a real implementation, this would analyze the function body
    return func.inputs.length > 0 || func.name.toLowerCase().includes('validate');
  }

  /**
   * Check if function has access control
   */
  private hasAccessControl(func: any): boolean {
    // Simplified check - in a real implementation, this would analyze the function body
    return func.name.toLowerCase().includes('only') || 
           func.name.toLowerCase().includes('require') ||
           func.name.toLowerCase().includes('auth');
  }

  /**
   * Check if contract has reentrancy vulnerability
   */
  private hasReentrancyVulnerability(contract: SmartContract): boolean {
    // Simplified check - in a real implementation, this would analyze the bytecode
    const riskyFunctions = contract.abi.functions.filter(f => 
      f.mutability === 'payable' && 
      f.name.toLowerCase().includes('withdraw')
    );
    
    return riskyFunctions.length > 0;
  }

  /**
   * Check if contract has integer overflow risk
   */
  private hasIntegerOverflowRisk(contract: SmartContract): boolean {
    // Simplified check - in a real implementation, this would analyze the bytecode
    const mathFunctions = contract.abi.functions.filter(f => 
      f.name.toLowerCase().includes('add') ||
      f.name.toLowerCase().includes('sub') ||
      f.name.toLowerCase().includes('mul') ||
      f.name.toLowerCase().includes('div')
    );
    
    return mathFunctions.length > 0;
  }

  /**
   * Check if contract has unchecked external calls
   */
  private hasUncheckedExternalCalls(contract: SmartContract): boolean {
    // Simplified check - in a real implementation, this would analyze the bytecode
    const externalFunctions = contract.abi.functions.filter(f => 
      f.visibility === 'external' || f.visibility === 'public'
    );
    
    return externalFunctions.length > 2;
  }

  /**
   * Check if function has role-based access control
   */
  private hasRoleBasedAccessControl(func: any): boolean {
    // Simplified check - in a real implementation, this would analyze the function body
    return func.name.toLowerCase().includes('role') || 
           func.name.toLowerCase().includes('permission');
  }

  /**
   * Calculate risk score based on violations
   */
  private calculateRiskScore(violations: SecurityViolation[]): number {
    let score = 0;
    
    for (const violation of violations) {
      switch (violation.severity) {
        case 'CRITICAL':
          score += 10;
          break;
        case 'HIGH':
          score += 5;
          break;
        case 'MEDIUM':
          score += 2;
          break;
        case 'LOW':
          score += 1;
          break;
      }
    }
    
    return Math.min(100, score);
  }

  /**
   * Generate security recommendations
   */
  private generateRecommendations(violations: SecurityViolation[]): string[] {
    const recommendations = new Set<string>();
    
    for (const violation of violations) {
      recommendations.add(violation.recommendation);
    }
    
    // Add general recommendations based on security level
    if (this.config.securityLevel === 'STRICT' || this.config.securityLevel === 'HIGH') {
      recommendations.add('Consider using formal verification for critical contracts');
      recommendations.add('Implement comprehensive logging and monitoring');
      recommendations.add('Regular security audits and penetration testing');
    }
    
    return Array.from(recommendations);
  }

  /**
   * Validate contract execution
   * @param contractAddress - Contract address
   * @param functionName - Function name
   * @param sender - Sender address
   * @param transaction - Transaction
   * @returns Validation result
   */
  public validateExecution(
    contractAddress: string,
    functionName: string,
    sender: string,
    transaction: Transaction
  ): { valid: boolean; violation?: SecurityViolation } {
    // Check if contract is blacklisted
    if (this.blacklistedContracts.has(contractAddress)) {
      const violation: SecurityViolation = {
        type: 'ACCESS_CONTROL',
        severity: 'CRITICAL',
        contractAddress,
        functionName,
        description: 'Contract is blacklisted',
        recommendation: 'Contract execution is blocked due to security violations',
        timestamp: Date.now(),
        transactionHash: transaction.hash
      };
      
      return { valid: false, violation };
    }

    // Check access control
    if (this.config.enableAccessControl) {
      const accessResult = this.checkAccessControl(contractAddress, functionName, sender);
      if (!accessResult.allowed) {
        const violation: SecurityViolation = {
          type: 'ACCESS_CONTROL',
          severity: 'HIGH',
          contractAddress,
          functionName,
          description: accessResult.reason || 'Access denied',
          recommendation: 'Ensure proper permissions are set',
          timestamp: Date.now(),
          transactionHash: transaction.hash
        };
        
        return { valid: false, violation };
      }
    }

    // Check execution limits
    const limitResult = this.checkExecutionLimits(contractAddress, functionName);
    if (!limitResult.valid) {
      const violation: SecurityViolation = {
        type: 'RESOURCE_LIMIT',
        severity: 'MEDIUM',
        contractAddress,
        functionName,
        description: limitResult.reason || 'Execution limit exceeded',
        recommendation: 'Optimize function or increase limits',
        timestamp: Date.now(),
        transactionHash: transaction.hash
      };
      
      return { valid: false, violation };
    }

    return { valid: true };
  }

  /**
   * Check access control for function execution
   */
  private checkAccessControl(
    contractAddress: string,
    functionName: string,
    sender: string
  ): { allowed: boolean; reason?: string } {
    const key = `${contractAddress}_${functionName}`;
    const entries = this.accessControl.get(key);
    
    if (!entries || entries.length === 0) {
      return { allowed: true }; // No restrictions
    }

    // Check if sender is allowed
    for (const entry of entries) {
      if (this.matchesAccessControl(entry, sender)) {
        return { allowed: entry.allowed };
      }
    }

    return { allowed: false, reason: 'Sender not authorized' };
  }

  /**
   * Check if sender matches access control entry
   */
  private matchesAccessControl(entry: AccessControlEntry, sender: string): boolean {
    // Simplified matching - in a real implementation, this would be more sophisticated
    return entry.allowed;
  }

  /**
   * Check execution limits
   */
  private checkExecutionLimits(
    contractAddress: string,
    functionName: string
  ): { valid: boolean; reason?: string } {
    const key = `${contractAddress}_${functionName}`;
    const maxGas = this.policy.maxGasPerFunction.get(key);
    
    if (maxGas) {
      // Check current gas usage against limit
      const currentUsage = this.getCurrentGasUsage(contractAddress, functionName);
      if (currentUsage > maxGas) {
        return { 
          valid: false, 
          reason: `Gas usage ${currentUsage} exceeds limit ${maxGas}` 
        };
      }
    }

    return { valid: true };
  }

  /**
   * Get current gas usage for function
   */
  private getCurrentGasUsage(contractAddress: string, functionName: string): number {
    // Simplified - in a real implementation, this would track actual usage
    return 0;
  }

  /**
   * Add access control entry
   */
  public addAccessControl(entry: AccessControlEntry): void {
    const key = `${entry.contractAddress}_${entry.functionName}`;
    
    if (!this.accessControl.has(key)) {
      this.accessControl.set(key, []);
    }

    const entries = this.accessControl.get(key)!;
    entries.push(entry);

    this.emit('accessControlAdded', entry);
  }

  /**
   * Remove access control entry
   */
  public removeAccessControl(
    contractAddress: string,
    functionName: string,
    role: string
  ): void {
    const key = `${contractAddress}_${functionName}`;
    const entries = this.accessControl.get(key);
    
    if (entries) {
      const filtered = entries.filter(entry => entry.role !== role);
      this.accessControl.set(key, filtered);
    }

    this.emit('accessControlRemoved', { contractAddress, functionName, role });
  }

  /**
   * Blacklist contract
   */
  public blacklistContract(contractAddress: string, reason: string): void {
    this.blacklistedContracts.add(contractAddress);
    
    this.emit('contractBlacklisted', {
      contractAddress,
      reason,
      timestamp: Date.now()
    });
  }

  /**
   * Remove contract from blacklist
   */
  public unblacklistContract(contractAddress: string): void {
    this.blacklistedContracts.delete(contractAddress);
    
    this.emit('contractUnblacklisted', {
      contractAddress,
      timestamp: Date.now()
    });
  }

  /**
   * Get security report for contract
   */
  public getSecurityReport(contractAddress: string): SecurityReport | null {
    return this.securityReports.get(contractAddress) || null;
  }

  /**
   * Get all security violations
   */
  public getSecurityViolations(): SecurityViolation[] {
    return [...this.securityViolations];
  }

  /**
   * Get violations by contract
   */
  public getViolationsByContract(contractAddress: string): SecurityViolation[] {
    return this.securityViolations.filter(v => v.contractAddress === contractAddress);
  }

  /**
   * Get security statistics
   */
  public getSecurityStats(): {
    totalViolations: number;
    criticalViolations: number;
    highViolations: number;
    blacklistedContracts: number;
    averageRiskScore: number;
    contractsAnalyzed: number;
  } {
    const totalViolations = this.securityViolations.length;
    const criticalViolations = this.securityViolations.filter(v => v.severity === 'CRITICAL').length;
    const highViolations = this.securityViolations.filter(v => v.severity === 'HIGH').length;
    const blacklistedContracts = this.blacklistedContracts.size;
    
    const reports = Array.from(this.securityReports.values());
    const averageRiskScore = reports.length > 0 ? 
      reports.reduce((sum, report) => sum + report.riskScore, 0) / reports.length : 0;

    return {
      totalViolations,
      criticalViolations,
      highViolations,
      blacklistedContracts,
      averageRiskScore,
      contractsAnalyzed: reports.length
    };
  }

  /**
   * Update security configuration
   */
  public updateConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * Update security policy
   */
  public updatePolicy(policy: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...policy };
    this.emit('policyUpdated', this.policy);
  }

  /**
   * Get current configuration
   */
  public getConfig(): SecurityConfig {
    return { ...this.config };
  }

  /**
   * Get current policy
   */
  public getPolicy(): SecurityPolicy {
    return { ...this.policy };
  }

  /**
   * Clear all security data
   */
  public clearSecurityData(): void {
    this.securityViolations = [];
    this.accessControl.clear();
    this.blacklistedContracts.clear();
    this.securityReports.clear();
    
    this.emit('securityDataCleared');
  }
}
