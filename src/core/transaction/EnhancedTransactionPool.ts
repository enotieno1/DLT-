import { Transaction } from '../types/block.types';
import { HashUtils, CryptoUtils } from '../crypto';
import { EventEmitter } from 'events';

export interface TransactionValidationResult {
  valid: boolean;
  error?: string;
  gasUsed?: string;
  priority?: number;
}

export interface TransactionPoolConfig {
  maxPoolSize: number;
  minGasPrice: string;
  maxGasPrice: string;
  maxTransactionsPerAccount: number;
  evictionPolicy: 'FIFO' | 'LIFO' | 'PRICE';
  blacklistEnabled: boolean;
  spamProtection: boolean;
}

export interface PoolStats {
  pending: number;
  processed: number;
  blacklisted: number;
  maxSize: number;
  utilization: number;
  averageGasPrice: string;
  totalValue: string;
}

export interface TransactionInfo {
  transaction: Transaction;
  addedAt: number;
  priority: number;
  retryCount: number;
  lastAttempt: number;
}

/**
 * Enhanced transaction pool with advanced features for enterprise DLT
 */
export class EnhancedTransactionPool extends EventEmitter {
  private pendingTransactions: Map<string, TransactionInfo> = new Map();
  private processedTransactions: Set<string> = new Set();
  private blacklistedTransactions: Set<string> = new Set();
  private accountTransactions: Map<string, Set<string>> = new Map();
  private config: TransactionPoolConfig;
  private nonceTracker: Map<string, number> = new Map();

  constructor(config: Partial<TransactionPoolConfig> = {}) {
    super();
    this.config = {
      maxPoolSize: 10000,
      minGasPrice: '1000000000', // 1 Gwei
      maxGasPrice: '1000000000000', // 1000 Gwei
      maxTransactionsPerAccount: 100,
      evictionPolicy: 'PRICE',
      blacklistEnabled: true,
      spamProtection: true,
      ...config
    };
  }

  /**
   * Add a transaction to the pool with comprehensive validation
   * @param transaction - Transaction to add
   * @returns Validation result with detailed information
   */
  public addTransaction(transaction: Transaction): TransactionValidationResult {
    try {
      // Basic validation
      const basicValidation = this.validateBasicTransaction(transaction);
      if (!basicValidation.valid) {
        return basicValidation;
      }

      // Check blacklist
      if (this.config.blacklistEnabled && this.isBlacklisted(transaction.hash)) {
        return { valid: false, error: 'Transaction is blacklisted' };
      }

      // Check for duplicates
      if (this.isDuplicate(transaction)) {
        return { valid: false, error: 'Transaction already exists in pool or processed' };
      }

      // Spam protection
      if (this.config.spamProtection) {
        const spamCheck = this.checkSpamProtection(transaction);
        if (!spamCheck.valid) {
          return spamCheck;
        }
      }

      // Account-specific limits
      const accountCheck = this.checkAccountLimits(transaction);
      if (!accountCheck.valid) {
        return accountCheck;
      }

      // Gas price validation
      const gasValidation = this.validateGasPrice(transaction);
      if (!gasValidation.valid) {
        return gasValidation;
      }

      // Calculate priority
      const priority = this.calculateTransactionPriority(transaction);

      // Check pool size and evict if necessary
      this.ensurePoolCapacity();

      // Add to pool
      const txInfo: TransactionInfo = {
        transaction,
        addedAt: Date.now(),
        priority,
        retryCount: 0,
        lastAttempt: 0
      };

      this.pendingTransactions.set(transaction.hash, txInfo);

      // Track account transactions
      this.trackAccountTransaction(transaction);

      // Update nonce tracker
      this.updateNonceTracker(transaction);

      this.emit('transactionAdded', transaction, txInfo);

      return { 
        valid: true, 
        gasUsed: this.estimateGas(transaction),
        priority 
      };
    } catch (error) {
      return {
        valid: false,
        error: `Failed to add transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Remove a transaction from the pool
   * @param txHash - Transaction hash
   * @param reason - Reason for removal
   * @returns True if transaction was removed
   */
  public removeTransaction(txHash: string, reason: string = 'manual'): boolean {
    const txInfo = this.pendingTransactions.get(txHash);
    if (!txInfo) {
      return false;
    }

    this.pendingTransactions.delete(txHash);
    this.untrackAccountTransaction(txInfo.transaction);
    
    this.emit('transactionRemoved', txHash, reason);
    return true;
  }

  /**
   * Blacklist a transaction
   * @param txHash - Transaction hash to blacklist
   * @param reason - Reason for blacklisting
   */
  public blacklistTransaction(txHash: string, reason: string = 'spam'): void {
    this.removeTransaction(txHash, 'blacklisted');
    this.blacklistedTransactions.add(txHash);
    this.emit('transactionBlacklisted', txHash, reason);
  }

  /**
   * Get transactions for block creation with intelligent selection
   * @param gasLimit - Maximum gas limit for the block
   * @param maxTransactions - Maximum number of transactions
   * @param selectionStrategy - Strategy for selecting transactions
   * @returns Array of transactions
   */
  public getTransactionsForBlock(
    gasLimit: string, 
    maxTransactions: number = 100,
    selectionStrategy: 'PRIORITY' | 'PRICE' | 'FIFO' = 'PRIORITY'
  ): Transaction[] {
    const transactions: Transaction[] = [];
    let totalGasUsed = '0';

    // Sort transactions based on strategy
    const sortedTxs = this.sortTransactions(selectionStrategy);

    for (const [txHash, txInfo] of sortedTxs) {
      if (transactions.length >= maxTransactions) {
        break;
      }

      const gasNeeded = this.estimateGas(txInfo.transaction);
      const newTotalGas = this.addGas(totalGasUsed, gasNeeded);

      if (this.compareGas(newTotalGas, gasLimit) > 0) {
        break;
      }

      transactions.push(txInfo.transaction);
      totalGasUsed = newTotalGas;
      
      // Mark as attempted
      txInfo.lastAttempt = Date.now();
      txInfo.retryCount++;
    }

    return transactions;
  }

  /**
   * Mark transactions as processed (included in a block)
   * @param transactions - Array of processed transactions
   */
  public markTransactionsProcessed(transactions: Transaction[]): void {
    for (const tx of transactions) {
      this.removeTransaction(tx.hash, 'processed');
      this.processedTransactions.add(tx.hash);
    }
    this.emit('transactionsProcessed', transactions);
  }

  /**
   * Retry failed transactions
   * @param maxRetries - Maximum retry attempts
   */
  public retryFailedTransactions(maxRetries: number = 3): void {
    const now = Date.now();
    const retryableTxs: string[] = [];

    for (const [txHash, txInfo] of this.pendingTransactions.entries()) {
      if (txInfo.retryCount < maxRetries && 
          now - txInfo.lastAttempt > 60000) { // 1 minute cooldown
        retryableTxs.push(txHash);
      }
    }

    for (const txHash of retryableTxs) {
      const txInfo = this.pendingTransactions.get(txHash);
      if (txInfo) {
        txInfo.retryCount++;
        txInfo.lastAttempt = now;
        this.emit('transactionRetry', txInfo.transaction, txInfo.retryCount);
      }
    }
  }

  /**
   * Clean up old transactions
   * @param maxAge - Maximum age in milliseconds
   */
  public cleanupOldTransactions(maxAge: number = 3600000): number { // 1 hour default
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [txHash, txInfo] of this.pendingTransactions.entries()) {
      if (now - txInfo.addedAt > maxAge) {
        toRemove.push(txHash);
      }
    }

    for (const txHash of toRemove) {
      this.removeTransaction(txHash, 'expired');
    }

    if (toRemove.length > 0) {
      this.emit('cleanupCompleted', toRemove.length);
    }

    return toRemove.length;
  }

  /**
   * Get comprehensive pool statistics
   * @returns Detailed pool statistics
   */
  public getStats(): PoolStats {
    let totalValue = '0';
    let totalGasPrice = '0';
    let txCount = 0;

    for (const txInfo of this.pendingTransactions.values()) {
      totalValue = this.addGas(totalValue, txInfo.transaction.value);
      totalGasPrice = this.addGas(totalGasPrice, txInfo.transaction.gasPrice);
      txCount++;
    }

    const averageGasPrice = txCount > 0 ? 
      this.divideGas(totalGasPrice, txCount.toString()) : '0';

    return {
      pending: this.pendingTransactions.size,
      processed: this.processedTransactions.size,
      blacklisted: this.blacklistedTransactions.size,
      maxSize: this.config.maxPoolSize,
      utilization: this.pendingTransactions.size / this.config.maxPoolSize,
      averageGasPrice,
      totalValue
    };
  }

  /**
   * Get transaction by hash
   * @param txHash - Transaction hash
   * @returns Transaction info or null if not found
   */
  public getTransaction(txHash: string): TransactionInfo | null {
    return this.pendingTransactions.get(txHash) || null;
  }

  /**
   * Get all pending transactions
   * @returns Array of pending transaction infos
   */
  public getAllTransactions(): TransactionInfo[] {
    return Array.from(this.pendingTransactions.values());
  }

  /**
   * Get transactions for a specific account
   * @param address - Account address
   * @returns Array of transaction infos for the account
   */
  public getAccountTransactions(address: string): TransactionInfo[] {
    const txHashes = this.accountTransactions.get(address);
    if (!txHashes) {
      return [];
    }

    const transactions: TransactionInfo[] = [];
    for (const txHash of txHashes) {
      const txInfo = this.pendingTransactions.get(txHash);
      if (txInfo) {
        transactions.push(txInfo);
      }
    }

    return transactions;
  }

  /**
   * Clear all pending transactions
   */
  public clear(): void {
    const count = this.pendingTransactions.size;
    this.pendingTransactions.clear();
    this.accountTransactions.clear();
    this.nonceTracker.clear();
    this.emit('poolCleared', count);
  }

  /**
   * Update pool configuration
   * @param newConfig - New configuration values
   */
  public updateConfig(newConfig: Partial<TransactionPoolConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  // Private helper methods

  private validateBasicTransaction(transaction: Transaction): TransactionValidationResult {
    if (!transaction || typeof transaction !== 'object') {
      return { valid: false, error: 'Invalid transaction object' };
    }

    const requiredFields = ['hash', 'from', 'to', 'value', 'data', 'nonce', 'gasLimit', 'gasPrice', 'signature', 'timestamp'];
    
    for (const field of requiredFields) {
      if (!(field in transaction) || transaction[field as keyof Transaction] === undefined) {
        return { valid: false, error: `Missing required field: ${field}` };
      }
    }

    // Verify transaction hash
    const computedHash = HashUtils.hashTransaction(transaction);
    if (computedHash !== transaction.hash) {
      return { valid: false, error: 'Invalid transaction hash' };
    }

    // Verify signature
    const signatureVerification = CryptoUtils.verifyTransactionSignature(transaction);
    if (!signatureVerification.valid) {
      return { valid: false, error: signatureVerification.error || 'Invalid signature' };
    }

    return { valid: true };
  }

  private isBlacklisted(txHash: string): boolean {
    return this.blacklistedTransactions.has(txHash);
  }

  private isDuplicate(transaction: Transaction): boolean {
    return this.pendingTransactions.has(transaction.hash) || 
           this.processedTransactions.has(transaction.hash);
  }

  private checkSpamProtection(transaction: Transaction): TransactionValidationResult {
    const accountTxs = this.accountTransactions.get(transaction.from);
    if (accountTxs && accountTxs.size >= this.config.maxTransactionsPerAccount) {
      return { valid: false, error: 'Too many transactions from this account' };
    }

    // Check nonce sequence
    const expectedNonce = this.nonceTracker.get(transaction.from) || 0;
    if (transaction.nonce < expectedNonce) {
      return { valid: false, error: 'Nonce too low' };
    }

    return { valid: true };
  }

  private checkAccountLimits(transaction: Transaction): TransactionValidationResult {
    const accountTxs = this.accountTransactions.get(transaction.from);
    if (accountTxs && accountTxs.size >= this.config.maxTransactionsPerAccount) {
      return { valid: false, error: 'Account transaction limit exceeded' };
    }
    return { valid: true };
  }

  private validateGasPrice(transaction: Transaction): TransactionValidationResult {
    if (this.compareGas(transaction.gasPrice, this.config.minGasPrice) < 0) {
      return { valid: false, error: `Gas price too low. Minimum: ${this.config.minGasPrice}` };
    }

    if (this.compareGas(transaction.gasPrice, this.config.maxGasPrice) > 0) {
      return { valid: false, error: `Gas price too high. Maximum: ${this.config.maxGasPrice}` };
    }

    return { valid: true };
  }

  private calculateTransactionPriority(transaction: Transaction): number {
    // Priority based on gas price and value
    const gasPrice = BigInt(transaction.gasPrice);
    const value = BigInt(transaction.value);
    const timestamp = Date.now() - transaction.timestamp;
    
    // Higher gas price and value = higher priority
    // Older transactions get slight priority boost
    const priority = Number(gasPrice) + Number(value) * 0.0001 - timestamp * 0.001;
    
    return Math.max(0, priority);
  }

  private sortTransactions(strategy: 'PRIORITY' | 'PRICE' | 'FIFO'): Array<[string, TransactionInfo]> {
    const transactions = Array.from(this.pendingTransactions.entries());

    switch (strategy) {
      case 'PRIORITY':
        return transactions.sort((a, b) => b[1].priority - a[1].priority);
      case 'PRICE':
        return transactions.sort((a, b) => 
          this.compareGas(b[1].transaction.gasPrice, a[1].transaction.gasPrice)
        );
      case 'FIFO':
        return transactions.sort((a, b) => a[1].addedAt - b[1].addedAt);
      default:
        return transactions;
    }
  }

  private ensurePoolCapacity(): void {
    while (this.pendingTransactions.size >= this.config.maxPoolSize) {
      this.evictTransaction();
    }
  }

  private evictTransaction(): void {
    let toEvict: string | null = null;

    switch (this.config.evictionPolicy) {
      case 'FIFO':
        // Evict oldest
        let oldestTime = Date.now();
        for (const [txHash, txInfo] of this.pendingTransactions.entries()) {
          if (txInfo.addedAt < oldestTime) {
            oldestTime = txInfo.addedAt;
            toEvict = txHash;
          }
        }
        break;

      case 'LIFO':
        // Evict newest
        let newestTime = 0;
        for (const [txHash, txInfo] of this.pendingTransactions.entries()) {
          if (txInfo.addedAt > newestTime) {
            newestTime = txInfo.addedAt;
            toEvict = txHash;
          }
        }
        break;

      case 'PRICE':
        // Evict lowest gas price
        let lowestPrice = null;
        for (const [txHash, txInfo] of this.pendingTransactions.entries()) {
          if (lowestPrice === null || 
              this.compareGas(txInfo.transaction.gasPrice, lowestPrice) < 0) {
            lowestPrice = txInfo.transaction.gasPrice;
            toEvict = txHash;
          }
        }
        break;
    }

    if (toEvict) {
      this.removeTransaction(toEvict, 'evicted');
    }
  }

  private trackAccountTransaction(transaction: Transaction): void {
    if (!this.accountTransactions.has(transaction.from)) {
      this.accountTransactions.set(transaction.from, new Set());
    }
    this.accountTransactions.get(transaction.from)!.add(transaction.hash);
  }

  private untrackAccountTransaction(transaction: Transaction): void {
    const accountTxs = this.accountTransactions.get(transaction.from);
    if (accountTxs) {
      accountTxs.delete(transaction.hash);
      if (accountTxs.size === 0) {
        this.accountTransactions.delete(transaction.from);
      }
    }
  }

  private updateNonceTracker(transaction: Transaction): void {
    const currentNonce = this.nonceTracker.get(transaction.from) || 0;
    if (transaction.nonce >= currentNonce) {
      this.nonceTracker.set(transaction.from, transaction.nonce + 1);
    }
  }

  private estimateGas(transaction: Transaction): string {
    const baseGas = '21000';
    const dataGas = (transaction.data.length / 2) * 68;
    return this.addGas(baseGas, dataGas.toString());
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

  private divideGas(a: string, b: string): string {
    return (BigInt(a) / BigInt(b)).toString();
  }
}
