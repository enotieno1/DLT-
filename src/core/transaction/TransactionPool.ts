import { Transaction } from '../types/block.types';
import { HashUtils } from '../crypto';
import { EventEmitter } from 'events';

export interface TransactionValidationResult {
  valid: boolean;
  error?: string;
  gasUsed?: string;
}

/**
 * Transaction pool for managing pending transactions
 */
export class TransactionPool extends EventEmitter {
  private pendingTransactions: Map<string, Transaction> = new Map();
  private processedTransactions: Set<string> = new Set();
  private maxPoolSize: number;
  private minGasPrice: string;

  constructor(maxPoolSize: number = 10000, minGasPrice: string = '1000000000') {
    super();
    this.maxPoolSize = maxPoolSize;
    this.minGasPrice = minGasPrice;
  }

  /**
   * Add a transaction to the pool
   * @param transaction - Transaction to add
   * @returns Validation result
   */
  public addTransaction(transaction: Transaction): TransactionValidationResult {
    // Validate transaction
    const validation = this.validateTransaction(transaction);
    if (!validation.valid) {
      return validation;
    }

    // Check if transaction already exists
    if (this.pendingTransactions.has(transaction.hash) || 
        this.processedTransactions.has(transaction.hash)) {
      return { valid: false, error: 'Transaction already exists' };
    }

    // Check pool size limit
    if (this.pendingTransactions.size >= this.maxPoolSize) {
      this.evictOldestTransaction();
    }

    // Add to pool
    this.pendingTransactions.set(transaction.hash, transaction);
    this.emit('transactionAdded', transaction);

    return { valid: true };
  }

  /**
   * Remove a transaction from the pool
   * @param txHash - Transaction hash
   * @returns True if transaction was removed
   */
  public removeTransaction(txHash: string): boolean {
    const removed = this.pendingTransactions.delete(txHash);
    if (removed) {
      this.emit('transactionRemoved', txHash);
    }
    return removed;
  }

  /**
   * Get transactions from the pool for block creation
   * @param gasLimit - Maximum gas limit for the block
   * @param maxTransactions - Maximum number of transactions
   * @returns Array of transactions
   */
  public getTransactionsForBlock(gasLimit: string, maxTransactions: number = 100): Transaction[] {
    const transactions: Transaction[] = [];
    let totalGasUsed = '0';

    // Sort transactions by gas price (highest first)
    const sortedTxs = Array.from(this.pendingTransactions.values())
      .sort((a, b) => this.compareGasPrice(b.gasPrice, a.gasPrice));

    for (const tx of sortedTxs) {
      if (transactions.length >= maxTransactions) {
        break;
      }

      const gasNeeded = this.estimateGas(tx);
      const newTotalGas = this.addGas(totalGasUsed, gasNeeded);

      if (this.compareGas(newTotalGas, gasLimit) > 0) {
        break;
      }

      transactions.push(tx);
      totalGasUsed = newTotalGas;
    }

    return transactions;
  }

  /**
   * Mark transactions as processed (included in a block)
   * @param transactions - Array of processed transactions
   */
  public markTransactionsProcessed(transactions: Transaction[]): void {
    for (const tx of transactions) {
      this.pendingTransactions.delete(tx.hash);
      this.processedTransactions.add(tx.hash);
    }
  }

  /**
   * Get pending transaction count
   * @returns Number of pending transactions
   */
  public getPendingCount(): number {
    return this.pendingTransactions.size;
  }

  /**
   * Get transaction by hash
   * @param txHash - Transaction hash
   * @returns Transaction or null if not found
   */
  public getTransaction(txHash: string): Transaction | null {
    return this.pendingTransactions.get(txHash) || null;
  }

  /**
   * Get all pending transactions
   * @returns Array of pending transactions
   */
  public getAllTransactions(): Transaction[] {
    return Array.from(this.pendingTransactions.values());
  }

  /**
   * Clear all pending transactions
   */
  public clear(): void {
    this.pendingTransactions.clear();
    this.emit('poolCleared');
  }

  /**
   * Validate a transaction
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private validateTransaction(transaction: Transaction): TransactionValidationResult {
    // Check required fields
    if (!transaction.from || !transaction.to || !transaction.hash || !transaction.signature) {
      return { valid: false, error: 'Missing required fields' };
    }

    // Verify transaction hash
    const computedHash = HashUtils.hashTransaction(transaction);
    if (computedHash !== transaction.hash) {
      return { valid: false, error: 'Invalid transaction hash' };
    }

    // Verify signature (simplified - in production, use proper signature verification)
    if (!this.verifySignature(transaction)) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Check gas price
    if (this.compareGas(transaction.gasPrice, this.minGasPrice) < 0) {
      return { valid: false, error: 'Gas price too low' };
    }

    // Check gas limit
    const maxGasLimit = '10000000'; // 10 million gas
    if (this.compareGas(transaction.gasLimit, maxGasLimit) > 0) {
      return { valid: false, error: 'Gas limit too high' };
    }

    // Check nonce (simplified - in production, check against account state)
    if (transaction.nonce < 0) {
      return { valid: false, error: 'Invalid nonce' };
    }

    return { valid: true, gasUsed: this.estimateGas(transaction) };
  }

  /**
   * Verify transaction signature (simplified implementation)
   * @param transaction - Transaction to verify
   * @returns True if signature is valid
   */
  private verifySignature(transaction: Transaction): boolean {
    // In a real implementation, this would use proper cryptographic verification
    // For now, we'll do a basic check
    return transaction.signature.length > 0;
  }

  /**
   * Estimate gas for a transaction
   * @param transaction - Transaction to estimate gas for
   * @returns Estimated gas amount
   */
  private estimateGas(transaction: Transaction): string {
    // Simplified gas estimation
    const baseGas = '21000'; // Base transaction cost
    const dataGas = (transaction.data.length / 2) * 68; // 68 gas per byte of data
    return this.addGas(baseGas, dataGas.toString());
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
   * Compare gas prices
   * @param a - First gas price
   * @param b - Second gas price
   * @returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  private compareGasPrice(a: string, b: string): number {
    return this.compareGas(a, b);
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
   * Evict the oldest transaction from the pool
   */
  private evictOldestTransaction(): void {
    const oldestTx = this.pendingTransactions.values().next().value;
    if (oldestTx) {
      this.pendingTransactions.delete(oldestTx.hash);
      this.emit('transactionEvicted', oldestTx);
    }
  }

  /**
   * Get pool statistics
   * @returns Pool statistics
   */
  public getStats(): {
    pending: number;
    processed: number;
    maxSize: number;
    utilization: number;
  } {
    return {
      pending: this.pendingTransactions.size,
      processed: this.processedTransactions.size,
      maxSize: this.maxPoolSize,
      utilization: this.pendingTransactions.size / this.maxPoolSize
    };
  }
}
