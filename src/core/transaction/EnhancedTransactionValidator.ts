import { Transaction, AccountState } from '../types/block.types';
import { HashUtils, CryptoUtils } from '../crypto';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  gasUsed?: string;
  warnings?: string[];
}

export interface AccountStateProvider {
  getAccountState(address: string): Promise<AccountState | null>;
  hasAccount(address: string): Promise<boolean>;
}

export interface ValidationConfig {
  maxGasLimit: string;
  minGasPrice: string;
  maxGasPrice: string;
  maxDataSize: number;
  allowedValueRange: { min: string; max: string };
  nonceWindow: number;
  enableDoubleSpendCheck: boolean;
  enableReplayProtection: boolean;
}

/**
 * Enhanced transaction validator with comprehensive security checks
 */
export class EnhancedTransactionValidator {
  private accountProvider: AccountStateProvider;
  private config: ValidationConfig;
  private processedNonces: Map<string, Set<number>> = new Map();
  private recentTransactions: Map<string, number> = new Map();

  constructor(
    accountProvider: AccountStateProvider,
    config: Partial<ValidationConfig> = {}
  ) {
    this.accountProvider = accountProvider;
    this.config = {
      maxGasLimit: '10000000', // 10 million gas
      minGasPrice: '1000000000', // 1 Gwei
      maxGasPrice: '1000000000000', // 1000 Gwei
      maxDataSize: 1048576, // 1MB
      allowedValueRange: { min: '0', max: '115792089237316195423570985008687907322991942844642470837454475712736742' }, // 2^256 - 1
      nonceWindow: 100, // Allow future nonces within this window
      enableDoubleSpendCheck: true,
      enableReplayProtection: true,
      ...config
    };
  }

  /**
   * Comprehensive transaction validation
   * @param transaction - Transaction to validate
   * @returns Detailed validation result
   */
  public async validateTransaction(transaction: Transaction): Promise<ValidationResult> {
    const warnings: string[] = [];
    
    try {
      // 1. Basic structure validation
      const structureValidation = this.validateStructure(transaction);
      if (!structureValidation.valid) {
        return structureValidation;
      }

      // 2. Cryptographic validation
      const cryptoValidation = await this.validateCryptography(transaction);
      if (!cryptoValidation.valid) {
        return cryptoValidation;
      }

      // 3. Account validation
      const accountValidation = await this.validateAccounts(transaction);
      if (!accountValidation.valid) {
        return accountValidation;
      }

      // 4. Gas and value validation
      const gasValidation = this.validateGasAndValue(transaction);
      if (!gasValidation.valid) {
        return gasValidation;
      }

      // 5. Balance validation
      const balanceValidation = await this.validateBalance(transaction);
      if (!balanceValidation.valid) {
        return balanceValidation;
      }

      // 6. Nonce validation
      const nonceValidation = await this.validateNonce(transaction);
      if (!nonceValidation.valid) {
        return nonceValidation;
      }

      // 7. Security validations
      const securityValidation = await this.validateSecurity(transaction);
      if (!securityValidation.valid) {
        return securityValidation;
      }

      // 8. Business logic validation
      const businessValidation = await this.validateBusinessRules(transaction);
      if (!businessValidation.valid) {
        return businessValidation;
      }

      // Add warnings if any
      const result: ValidationResult = { 
        valid: true, 
        gasUsed: this.estimateGas(transaction) 
      };

      if (warnings.length > 0) {
        result.warnings = warnings;
      }

      return result;

    } catch (error) {
      return {
        valid: false,
        error: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validate transaction structure and basic requirements
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private validateStructure(transaction: Transaction): ValidationResult {
    const requiredFields = [
      'hash', 'from', 'to', 'value', 'data', 'nonce', 
      'gasLimit', 'gasPrice', 'signature', 'timestamp'
    ];

    for (const field of requiredFields) {
      if (!(field in transaction) || transaction[field as keyof Transaction] === undefined) {
        return { valid: false, error: `Missing required field: ${field}` };
      }
    }

    // Validate address format
    if (!this.isValidAddress(transaction.from)) {
      return { valid: false, error: 'Invalid from address format' };
    }

    if (!this.isValidAddress(transaction.to)) {
      return { valid: false, error: 'Invalid to address format' };
    }

    // Validate value format
    if (!this.isValidAmount(transaction.value)) {
      return { valid: false, error: 'Invalid value format' };
    }

    // Validate nonce
    if (!Number.isInteger(transaction.nonce) || transaction.nonce < 0) {
      return { valid: false, error: 'Invalid nonce' };
    }

    // Validate timestamp
    if (!Number.isInteger(transaction.timestamp) || transaction.timestamp <= 0) {
      return { valid: false, error: 'Invalid timestamp' };
    }

    // Check for future timestamp (allow 5 minutes clock skew)
    const now = Date.now();
    const maxFutureTime = now + 5 * 60 * 1000; // 5 minutes
    if (transaction.timestamp > maxFutureTime) {
      return { valid: false, error: 'Transaction timestamp too far in the future' };
    }

    // Check for very old timestamp (reject transactions older than 1 hour)
    const maxPastTime = now - 60 * 60 * 1000; // 1 hour
    if (transaction.timestamp < maxPastTime) {
      return { valid: false, error: 'Transaction timestamp too old' };
    }

    return { valid: true };
  }

  /**
   * Validate cryptographic components
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private async validateCryptography(transaction: Transaction): Promise<ValidationResult> {
    // Verify transaction hash
    const computedHash = HashUtils.hashTransaction(transaction);
    if (computedHash !== transaction.hash) {
      return { valid: false, error: 'Transaction hash mismatch' };
    }

    // Verify signature
    const signatureVerification = CryptoUtils.verifyTransactionSignature(transaction);
    if (!signatureVerification.valid) {
      return { valid: false, error: signatureVerification.error || 'Invalid transaction signature' };
    }

    // Additional signature check: ensure from address matches signature
    if (signatureVerification.recoveredAddress !== transaction.from) {
      return { valid: false, error: 'Signature does not match from address' };
    }

    return { valid: true };
  }

  /**
   * Validate account existence and permissions
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private async validateAccounts(transaction: Transaction): Promise<ValidationResult> {
    try {
      // Check if sender account exists
      const senderExists = await this.accountProvider.hasAccount(transaction.from);
      if (!senderExists) {
        return { valid: false, error: 'Sender account does not exist' };
      }

      // Check if recipient account exists (or allow creation)
      const recipientExists = await this.accountProvider.hasAccount(transaction.to);
      if (!recipientExists) {
        // In some systems, new accounts can be created
        // For now, we'll require existing accounts
        return { valid: false, error: 'Recipient account does not exist' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Account validation failed' };
    }
  }

  /**
   * Validate gas parameters and value
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private validateGasAndValue(transaction: Transaction): ValidationResult {
    // Check gas price
    if (this.compareGas(transaction.gasPrice, this.config.minGasPrice) < 0) {
      return { valid: false, error: `Gas price too low. Minimum: ${this.config.minGasPrice}` };
    }

    if (this.compareGas(transaction.gasPrice, this.config.maxGasPrice) > 0) {
      return { valid: false, error: `Gas price too high. Maximum: ${this.config.maxGasPrice}` };
    }

    // Check gas limit
    if (this.compareGas(transaction.gasLimit, this.config.maxGasLimit) > 0) {
      return { valid: false, error: `Gas limit too high. Maximum: ${this.config.maxGasLimit}` };
    }

    // Check minimum gas limit
    const minGasLimit = '21000';
    if (this.compareGas(transaction.gasLimit, minGasLimit) < 0) {
      return { valid: false, error: `Gas limit too low. Minimum: ${minGasLimit}` };
    }

    // Check value range
    if (this.compareGas(transaction.value, this.config.allowedValueRange.min) < 0) {
      return { valid: false, error: 'Value cannot be negative' };
    }

    if (this.compareGas(transaction.value, this.config.allowedValueRange.max) > 0) {
      return { valid: false, error: 'Value exceeds maximum allowed' };
    }

    return { valid: true };
  }

  /**
   * Validate sender has sufficient balance
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private async validateBalance(transaction: Transaction): Promise<ValidationResult> {
    try {
      const senderState = await this.accountProvider.getAccountState(transaction.from);
      if (!senderState) {
        return { valid: false, error: 'Sender account state not found' };
      }

      // Calculate total cost: value + (gasLimit * gasPrice)
      const gasCost = this.multiplyGas(transaction.gasLimit, transaction.gasPrice);
      const totalCost = this.addGas(transaction.value, gasCost);

      if (this.compareGas(senderState.balance, totalCost) < 0) {
        return { 
          valid: false, 
          error: `Insufficient balance. Required: ${totalCost}, Available: ${senderState.balance}` 
        };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Balance validation failed' };
    }
  }

  /**
   * Validate transaction nonce
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private async validateNonce(transaction: Transaction): Promise<ValidationResult> {
    try {
      const senderState = await this.accountProvider.getAccountState(transaction.from);
      if (!senderState) {
        return { valid: false, error: 'Sender account state not found' };
      }

      // Check exact nonce match
      if (transaction.nonce !== senderState.nonce) {
        return { 
          valid: false, 
          error: `Invalid nonce. Expected: ${senderState.nonce}, Got: ${transaction.nonce}` 
        };
      }

      // Replay protection check
      if (this.config.enableReplayProtection) {
        const senderNonces = this.processedNonces.get(transaction.from) || new Set();
        if (senderNonces.has(transaction.nonce)) {
          return { valid: false, error: 'Nonce already processed (replay attack detected)' };
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Nonce validation failed' };
    }
  }

  /**
   * Validate security-related aspects
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private async validateSecurity(transaction: Transaction): Promise<ValidationResult> {
    // Check data size
    if (transaction.data.length > this.config.maxDataSize * 2) { // *2 for hex representation
      return { valid: false, error: `Transaction data too large. Maximum: ${this.config.maxDataSize} bytes` };
    }

    // Check for suspicious patterns in data
    if (this.containsSuspiciousData(transaction.data)) {
      return { valid: false, error: 'Transaction data contains suspicious patterns' };
    }

    // Double spend protection
    if (this.config.enableDoubleSpendCheck) {
      const recentTx = this.recentTransactions.get(transaction.from);
      if (recentTx && Date.now() - recentTx < 1000) { // 1 second
        return { valid: false, error: 'Potential double spend detected' };
      }
    }

    return { valid: true };
  }

  /**
   * Validate business rules
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private async validateBusinessRules(transaction: Transaction): Promise<ValidationResult> {
    // Self-transfer check
    if (transaction.from === transaction.to) {
      return { valid: false, error: 'Self-transfers are not allowed' };
    }

    // Zero value transfer check (only allow if data is present)
    if (transaction.value === '0' && transaction.data === '') {
      return { valid: false, error: 'Zero value transfers must include data' };
    }

    return { valid: true };
  }

  /**
   * Mark nonce as processed (for replay protection)
   * @param address - Account address
   * @param nonce - Nonce to mark
   */
  public markNonceProcessed(address: string, nonce: number): void {
    if (!this.processedNonces.has(address)) {
      this.processedNonces.set(address, new Set());
    }
    this.processedNonces.get(address)!.add(nonce);
  }

  /**
   * Clear old nonces from memory
   * @param maxAge - Maximum age in milliseconds
   */
  public clearOldNonces(maxAge: number = 3600000): void {
    // This is a simplified implementation
    // In a real system, you'd track timestamps for each nonce and clear based on maxAge
    console.log(`Clearing nonces older than ${maxAge}ms`);
    this.processedNonces.clear();
  }

  /**
   * Estimate gas for a transaction
   * @param transaction - Transaction to estimate gas for
   * @returns Estimated gas amount
   */
  private estimateGas(transaction: Transaction): string {
    const baseGas = '21000'; // Base transaction cost
    const dataGas = (transaction.data.length / 2) * 68; // 68 gas per byte of data
    return this.addGas(baseGas, dataGas.toString());
  }

  /**
   * Check if address format is valid
   * @param address - Address to validate
   * @returns True if address is valid
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Check if amount format is valid
   * @param amount - Amount to validate
   * @returns True if amount is valid
   */
  private isValidAmount(amount: string): boolean {
    try {
      const value = BigInt(amount);
      return value >= 0;
    } catch {
      return false;
    }
  }

  /**
   * Check for suspicious patterns in transaction data
   * @param data - Transaction data to check
   * @returns True if suspicious patterns are found
   */
  private containsSuspiciousData(data: string): boolean {
    // Check for common attack patterns
    const suspiciousPatterns = [
      /0x4d414c57415245/i, // MALWARE
      /0x54524f4a414e/i, // TROJAN
      /0x5350414d/i,     // SPAM
      /0x4841434b/i,      // HACK
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(data)) {
        return true;
      }
    }

    return false;
  }

  // Gas calculation utilities
  private compareGas(a: string, b: string): number {
    const bigA = BigInt(a);
    const bigB = BigInt(b);
    return bigA < bigB ? -1 : bigA > bigB ? 1 : 0;
  }

  private addGas(a: string, b: string): string {
    return (BigInt(a) + BigInt(b)).toString();
  }

  private multiplyGas(a: string, b: string): string {
    return (BigInt(a) * BigInt(b)).toString();
  }

  /**
   * Get validator statistics
   * @returns Validator statistics
   */
  public getStats(): {
    processedNonces: number;
    recentTransactions: number;
    config: ValidationConfig;
  } {
    let totalNonces = 0;
    for (const nonces of this.processedNonces.values()) {
      totalNonces += nonces.size;
    }

    return {
      processedNonces: totalNonces,
      recentTransactions: this.recentTransactions.size,
      config: this.config
    };
  }
}
