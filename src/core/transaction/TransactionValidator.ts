import { Transaction, AccountState } from '../types/block.types';
import { HashUtils, SignatureUtils } from '../crypto';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  gasUsed?: string;
}

export interface AccountStateProvider {
  getAccountState(address: string): Promise<AccountState | null>;
  hasAccount(address: string): Promise<boolean>;
}

/**
 * Transaction validator for validating transactions against business rules
 */
export class TransactionValidator {
  private accountProvider: AccountStateProvider;
  private minGasPrice: string;
  private maxGasLimit: string;
  private chainId: number;

  constructor(
    accountProvider: AccountStateProvider,
    minGasPrice: string = '1000000000',
    maxGasLimit: string = '10000000',
    chainId: number = 1
  ) {
    this.accountProvider = accountProvider;
    this.minGasPrice = minGasPrice;
    this.maxGasLimit = maxGasLimit;
    this.chainId = chainId;
  }

  /**
   * Validate a transaction
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  public async validateTransaction(transaction: Transaction): Promise<ValidationResult> {
    try {
      // 1. Basic structure validation
      const structureValidation = this.validateStructure(transaction);
      if (!structureValidation.valid) {
        return structureValidation;
      }

      // 2. Hash validation
      const hashValidation = this.validateHash(transaction);
      if (!hashValidation.valid) {
        return hashValidation;
      }

      // 3. Signature validation
      const signatureValidation = await this.validateSignature(transaction);
      if (!signatureValidation.valid) {
        return signatureValidation;
      }

      // 4. Account validation
      const accountValidation = await this.validateAccounts(transaction);
      if (!accountValidation.valid) {
        return accountValidation;
      }

      // 5. Gas validation
      const gasValidation = this.validateGas(transaction);
      if (!gasValidation.valid) {
        return gasValidation;
      }

      // 6. Balance validation
      const balanceValidation = await this.validateBalance(transaction);
      if (!balanceValidation.valid) {
        return balanceValidation;
      }

      // 7. Nonce validation
      const nonceValidation = await this.validateNonce(transaction);
      if (!nonceValidation.valid) {
        return nonceValidation;
      }

      return { valid: true, gasUsed: this.estimateGas(transaction) };

    } catch (error) {
      return {
        valid: false,
        error: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validate transaction structure
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

    return { valid: true };
  }

  /**
   * Validate transaction hash
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private validateHash(transaction: Transaction): ValidationResult {
    const computedHash = HashUtils.hashTransaction(transaction);
    if (computedHash !== transaction.hash) {
      return { valid: false, error: 'Transaction hash mismatch' };
    }
    return { valid: true };
  }

  /**
   * Validate transaction signature
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private async validateSignature(transaction: Transaction): Promise<ValidationResult> {
    try {
      // In a real implementation, this would use proper signature verification
      // For now, we'll use the simplified version
      const isValid = SignatureUtils.verifyTransactionSignature(transaction);
      
      if (!isValid) {
        return { valid: false, error: 'Invalid transaction signature' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Signature verification failed' };
    }
  }

  /**
   * Validate accounts exist
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

      // Check if recipient account exists (or create it for new accounts)
      const recipientExists = await this.accountProvider.hasAccount(transaction.to);
      if (!recipientExists) {
        // In a real implementation, you might auto-create accounts
        return { valid: false, error: 'Recipient account does not exist' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Account validation failed' };
    }
  }

  /**
   * Validate gas parameters
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private validateGas(transaction: Transaction): ValidationResult {
    // Check gas price
    if (this.compareGas(transaction.gasPrice, this.minGasPrice) < 0) {
      return { valid: false, error: `Gas price too low. Minimum: ${this.minGasPrice}` };
    }

    // Check gas limit
    if (this.compareGas(transaction.gasLimit, this.maxGasLimit) > 0) {
      return { valid: false, error: `Gas limit too high. Maximum: ${this.maxGasLimit}` };
    }

    // Check minimum gas limit
    const minGasLimit = '21000';
    if (this.compareGas(transaction.gasLimit, minGasLimit) < 0) {
      return { valid: false, error: `Gas limit too low. Minimum: ${minGasLimit}` };
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

      if (transaction.nonce !== senderState.nonce) {
        return { 
          valid: false, 
          error: `Invalid nonce. Expected: ${senderState.nonce}, Got: ${transaction.nonce}` 
        };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Nonce validation failed' };
    }
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
   * Validate address format
   * @param address - Address to validate
   * @returns True if address is valid
   */
  private isValidAddress(address: string): boolean {
    // Simple validation: starts with 0x and is 42 characters long
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Validate amount format
   * @param amount - Amount to validate
   * @returns True if amount is valid
   */
  private isValidAmount(amount: string): boolean {
    try {
      // Should be a valid non-negative integer
      const value = BigInt(amount);
      return value >= 0;
    } catch {
      return false;
    }
  }

  /**
   * Compare two gas values
   * @param a - First gas value
   * @param b - Second gas value
   * @returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  private compareGas(a: string, b: string): number {
    const bigA = BigInt(a);
    const bigB = BigInt(b);
    
    if (bigA < bigB) return -1;
    if (bigA > bigB) return 1;
    return 0;
  }

  /**
   * Add two gas values
   * @param a - First gas value
   * @param b - Second gas value
   * @returns Sum as string
   */
  private addGas(a: string, b: string): string {
    return (BigInt(a) + BigInt(b)).toString();
  }

  /**
   * Multiply two gas values
   * @param a - First gas value
   * @param b - Second gas value
   * @returns Product as string
   */
  private multiplyGas(a: string, b: string): string {
    return (BigInt(a) * BigInt(b)).toString();
  }
}
