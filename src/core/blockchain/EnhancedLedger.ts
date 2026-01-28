import { Block, Transaction, AccountState, GenesisBlock } from '../types/block.types';
import { HashUtils, CryptoUtils } from '../crypto';
import { validateBlock } from './block';
import { EventEmitter } from 'events';

export interface LedgerState {
  latestBlock: Block;
  blockHashes: Map<number, string>;
  blocks: Map<string, Block>;
  accountStates: Map<string, AccountState>;
  totalDifficulty: string;
  totalSupply: string;
  lastCheckpoint?: number;
}

export interface LedgerConfig {
  maxBlockSize: number;
  maxTransactionsPerBlock: number;
  checkpointInterval: number;
  enableStatePruning: boolean;
  statePruningDepth: number;
  enableCompression: boolean;
  backupInterval: number;
}

export interface LedgerStats {
  chainHeight: number;
  totalBlocks: number;
  totalTransactions: number;
  totalAccounts: number;
  totalDifficulty: string;
  totalSupply: string;
  averageBlockSize: number;
  averageGasUsed: string;
  lastBlockTime: number;
  syncProgress: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

/**
 * Enhanced ledger with advanced features for enterprise DLT
 */
export class EnhancedLedger extends EventEmitter {
  private state: LedgerState;
  private genesisBlock: GenesisBlock;
  private config: LedgerConfig;
  private transactionCache: Map<string, { transaction: Transaction; block: Block; index: number }> = new Map();
  private stateHistory: Map<number, Map<string, AccountState>> = new Map();
  private checkpoints: Map<number, string> = new Map();

  constructor(genesisBlock: GenesisBlock, config: Partial<LedgerConfig> = {}) {
    super();
    this.genesisBlock = genesisBlock;
    this.config = {
      maxBlockSize: 1048576, // 1MB
      maxTransactionsPerBlock: 1000,
      checkpointInterval: 1000,
      enableStatePruning: false,
      statePruningDepth: 10000,
      enableCompression: true,
      backupInterval: 100,
      ...config
    };
    this.state = this.initializeState();
  }

  /**
   * Initialize ledger with genesis block
   * @returns Initial ledger state
   */
  private initializeState(): LedgerState {
    const genesis = this.createGenesisBlock();
    
    const accountStates = new Map<string, AccountState>();
    
    // Initialize account states from genesis allocation
    Object.entries(this.genesisBlock.alloc).forEach(([address, state]) => {
      const accountState: AccountState = {
        balance: state.balance,
        nonce: state.nonce
      };
      
      if (state.code !== undefined) {
        accountState.code = state.code;
      }
      
      if (state.storage !== undefined) {
        accountState.storage = state.storage;
      }
      
      accountStates.set(address, accountState);
    });

    return {
      latestBlock: genesis,
      blockHashes: new Map([[0, genesis.hash]]),
      blocks: new Map([[genesis.hash, genesis]]),
      accountStates,
      totalDifficulty: '0',
      totalSupply: this.calculateTotalSupply(accountStates)
    };
  }

  /**
   * Add a new block to the ledger with comprehensive validation
   * @param block - Block to add
   * @returns Validation result
   */
  public addBlock(block: Block): ValidationResult {
    const warnings: string[] = [];
    
    try {
      // 1. Basic block validation
      const basicValidation = this.validateBlockStructure(block);
      if (!basicValidation.valid) {
        return basicValidation;
      }

      // 2. Chain continuity validation
      const continuityValidation = this.validateChainContinuity(block);
      if (!continuityValidation.valid) {
        return continuityValidation;
      }

      // 3. Cryptographic validation
      const cryptoValidation = this.validateBlockCryptography(block);
      if (!cryptoValidation.valid) {
        return cryptoValidation;
      }

      // 4. Transaction validation
      const txValidation = this.validateBlockTransactions(block);
      if (!txValidation.valid) {
        return txValidation;
      }

      // 5. State transition validation
      const stateValidation = this.validateStateTransition(block);
      if (!stateValidation.valid) {
        return stateValidation;
      }

      // 6. Performance checks
      const performanceValidation = this.validateBlockPerformance(block);
      if (!performanceValidation.valid) {
        return performanceValidation;
      }

      // Add warnings if any
      if (warnings.length > 0) {
        performanceValidation.warnings = warnings;
      }

      // Process block and update state
      const newState = this.processBlock(block);
      if (!newState) {
        return { valid: false, error: 'Failed to process block' };
      }

      // Update state
      this.state = newState;
      
      // Update transaction cache
      this.updateTransactionCache(block);

      // Create checkpoint if needed
      if (block.number % this.config.checkpointInterval === 0) {
        this.createCheckpoint(block.number);
      }

      // Prune old state if enabled
      if (this.config.enableStatePruning) {
        this.pruneOldState();
      }

      // Emit events
      this.emit('blockAdded', block);
      this.emit('stateUpdated', this.state);

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Block addition failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validate block structure
   * @param block - Block to validate
   * @returns Validation result
   */
  private validateBlockStructure(block: Block): ValidationResult {
    if (!validateBlock(block)) {
      return { valid: false, error: 'Invalid block structure' };
    }

    // Check block size
    const blockSize = JSON.stringify(block).length;
    if (blockSize > this.config.maxBlockSize) {
      return { valid: false, error: `Block too large: ${blockSize} > ${this.config.maxBlockSize}` };
    }

    return { valid: true };
  }

  /**
   * Validate chain continuity
   * @param block - Block to validate
   * @returns Validation result
   */
  private validateChainContinuity(block: Block): ValidationResult {
    // Check if block links to current chain
    if (block.parentHash !== this.state.latestBlock.hash) {
      return { valid: false, error: 'Block does not link to current chain' };
    }

    // Check block number
    if (block.number !== this.state.latestBlock.number + 1) {
      return { valid: false, error: 'Invalid block number' };
    }

    // Check timestamp
    const now = Date.now();
    const maxFutureTime = now + 60 * 1000; // 1 minute future
    if (block.timestamp > maxFutureTime) {
      return { valid: false, error: 'Block timestamp too far in the future' };
    }

    if (block.timestamp <= this.state.latestBlock.timestamp) {
      return { valid: false, error: 'Block timestamp must be greater than parent' };
    }

    return { valid: true };
  }

  /**
   * Validate block cryptography
   * @param block - Block to validate
   * @returns Validation result
   */
  private validateBlockCryptography(block: Block): ValidationResult {
    // Verify block signature
    const signatureVerification = CryptoUtils.verifyBlockSignature(block);
    if (!signatureVerification.valid) {
      return { valid: false, error: signatureVerification.error || 'Invalid block signature' };
    }

    // Verify hash
    const computedHash = HashUtils.hashBlock(block);
    if (computedHash !== block.hash) {
      return { valid: false, error: 'Block hash mismatch' };
    }

    // Verify Merkle roots
    const computedTxRoot = HashUtils.computeMerkleRoot(block.transactions);
    if (computedTxRoot !== block.transactionsRoot) {
      return { valid: false, error: 'Transactions root mismatch' };
    }

    return { valid: true };
  }

  /**
   * Validate block transactions
   * @param block - Block to validate
   * @returns Validation result
   */
  private validateBlockTransactions(block: Block): ValidationResult {
    // Check transaction count
    if (block.transactions.length > this.config.maxTransactionsPerBlock) {
      return { valid: false, error: 'Too many transactions in block' };
    }

    // Validate each transaction
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      if (!tx) {
        continue;
      }
      
      // Basic transaction validation
      const txValidation = this.validateTransaction(tx);
      if (!txValidation.valid) {
        return { valid: false, error: `Transaction ${i} validation failed: ${txValidation.error}` };
      }

      // Check for duplicates within block
      const duplicates = block.transactions.filter((t, j) => t?.hash === tx.hash && j !== i);
      if (duplicates.length > 0) {
        return { valid: false, error: `Duplicate transaction in block: ${tx.hash}` };
      }
    }

    return { valid: true };
  }

  /**
   * Validate state transition
   * @param block - Block to validate
   * @returns Validation result
   */
  private validateStateTransition(block: Block): ValidationResult {
    // Create a copy of current state for validation
    const tempStates = new Map(this.state.accountStates);
    let totalGasUsed = '0';

    // Process each transaction
    for (const tx of block.transactions) {
      if (!tx) {
        continue;
      }
      const result = this.processTransaction(tx, tempStates);
      if (!result.success) {
        return { valid: false, error: `Transaction processing failed: ${result.error}` };
      }
      totalGasUsed = this.addGas(totalGasUsed, tx.gasLimit);
    }

    // Verify gas used matches block gas used
    if (totalGasUsed !== block.gasUsed) {
      return { valid: false, error: `Gas used mismatch: expected ${block.gasUsed}, got ${totalGasUsed}` };
    }

    return { valid: true };
  }

  /**
   * Validate block performance
   * @param block - Block to validate
   * @returns Validation result
   */
  private validateBlockPerformance(block: Block): ValidationResult {
    const warnings: string[] = [];

    // Check if block is nearly full
    const utilization = (block.transactions.length / this.config.maxTransactionsPerBlock) * 100;
    if (utilization > 90) {
      warnings.push(`Block utilization high: ${utilization.toFixed(1)}%`);
    }

    // Check gas usage
    const gasUtilization = (BigInt(block.gasUsed) * BigInt(100)) / BigInt(block.gasLimit);
    if (gasUtilization > BigInt(90)) {
      warnings.push(`Gas utilization high: ${gasUtilization}%`);
    }

    return { valid: true, warnings };
  }

  /**
   * Process a block and update state
   * @param block - Block to process
   * @returns New ledger state or null if processing failed
   */
  private processBlock(block: Block): LedgerState | null {
    try {
      // Create new state from current state
      const newAccountStates = new Map(this.state.accountStates);
      let totalGasUsed = '0';

      // Save state history before processing
      if (this.config.enableStatePruning) {
        this.stateHistory.set(block.number, new Map(newAccountStates));
      }

      // Process each transaction
      for (const tx of block.transactions) {
        if (!tx) {
          continue;
        }
        const result = this.processTransaction(tx, newAccountStates);
        if (!result.success) {
          return null;
        }
        totalGasUsed = this.addGas(totalGasUsed, tx.gasLimit);
      }

      // Update state
      const newState: LedgerState = {
        latestBlock: block,
        blockHashes: new Map(this.state.blockHashes),
        blocks: new Map(this.state.blocks),
        accountStates: newAccountStates,
        totalDifficulty: this.addGas(this.state.totalDifficulty, '1'), // Simplified difficulty
        totalSupply: this.calculateTotalSupply(newAccountStates)
      };

      if (this.state.lastCheckpoint !== undefined) {
        newState.lastCheckpoint = this.state.lastCheckpoint;
      }

      newState.blockHashes.set(block.number, block.hash);
      newState.blocks.set(block.hash, block);

      return newState;
    } catch (error) {
      console.error('Block processing error:', error);
      return null;
    }
  }

  /**
   * Process a single transaction
   * @param transaction - Transaction to process
   * @param accountStates - Current account states
   * @returns Processing result
   */
  private processTransaction(
    transaction: Transaction, 
    accountStates: Map<string, AccountState>
  ): { success: boolean; error?: string } {
    try {
      // Get sender account state
      const senderState = accountStates.get(transaction.from);
      if (!senderState) {
        return { success: false, error: 'Sender account not found' };
      }

      // Check nonce
      if (transaction.nonce !== senderState.nonce) {
        return { success: false, error: 'Invalid nonce' };
      }

      // Calculate total cost
      const gasCost = this.multiplyGas(transaction.gasLimit, transaction.gasPrice);
      const totalCost = this.addGas(transaction.value, gasCost);

      // Check balance
      if (this.compareGas(senderState.balance, totalCost) < 0) {
        return { success: false, error: 'Insufficient balance' };
      }

      // Get or create recipient account
      let recipientState = accountStates.get(transaction.to);
      if (!recipientState) {
        recipientState = { balance: '0', nonce: 0 };
        accountStates.set(transaction.to, recipientState);
      }

      // Update sender state
      const newSenderBalance = this.subtractGas(senderState.balance, totalCost);
      const newSenderNonce = senderState.nonce + 1;
      
      const newSenderState: AccountState = {
        balance: newSenderBalance,
        nonce: newSenderNonce
      };
      
      if (senderState.code !== undefined) {
        newSenderState.code = senderState.code;
      }
      
      if (senderState.storage !== undefined) {
        newSenderState.storage = senderState.storage;
      }
      
      accountStates.set(transaction.from, newSenderState);

      // Update recipient state
      const newRecipientBalance = this.addGas(recipientState.balance, transaction.value);
      
      const newRecipientState: AccountState = {
        balance: newRecipientBalance,
        nonce: recipientState.nonce
      };
      
      if (recipientState.code !== undefined) {
        newRecipientState.code = recipientState.code;
      }
      
      if (recipientState.storage !== undefined) {
        newRecipientState.storage = recipientState.storage;
      }
      
      accountStates.set(transaction.to, newRecipientState);

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Create genesis block
   * @returns Genesis block
   */
  private createGenesisBlock(): Block {
    const timestamp = this.genesisBlock.timestamp;
    const validator = '0x0000000000000000000000000000000000000000'; // System address
    
    const transactions: Transaction[] = [];
    const transactionsRoot = HashUtils.computeMerkleRoot(transactions);
    const stateRoot = HashUtils.hash(JSON.stringify(this.genesisBlock.alloc));
    const receiptsRoot = HashUtils.hash('');
    
    const header = {
      parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      number: 0,
      timestamp,
      validator,
      stateRoot,
      transactionsRoot,
      receiptsRoot,
      gasLimit: this.genesisBlock.gasLimit,
      gasUsed: '0',
      extraData: this.genesisBlock.extraData
    };

    const hash = HashUtils.hashBlockHeader(header);

    return {
      ...header,
      hash,
      transactions,
      signature: '', // Genesis blocks don't need signatures
      stateRoot,
      transactionsRoot,
      receiptsRoot,
      gasLimit: this.genesisBlock.gasLimit,
      gasUsed: '0',
      extraData: this.genesisBlock.extraData
    };
  }

  /**
   * Update transaction cache
   * @param block - Block to cache transactions for
   */
  private updateTransactionCache(block: Block): void {
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      if (tx) {
        this.transactionCache.set(tx.hash, { block, index: i, transaction: tx });
      }
    }
  }

  /**
   * Create a checkpoint
   * @param blockNumber - Block number to create checkpoint for
   */
  private createCheckpoint(blockNumber: number): void {
    const checkpointData = JSON.stringify({
      blockNumber,
      stateHash: HashUtils.hash(JSON.stringify(Array.from(this.state.accountStates.entries()))),
      timestamp: Date.now()
    });

    this.checkpoints.set(blockNumber, checkpointData);
    this.state.lastCheckpoint = blockNumber;
    this.emit('checkpointCreated', blockNumber);
  }

  /**
   * Prune old state history
   */
  private pruneOldState(): void {
    const cutoffBlock = this.state.latestBlock.number - this.config.statePruningDepth;
    
    for (const [blockNumber] of this.stateHistory.entries()) {
      if (blockNumber < cutoffBlock) {
        this.stateHistory.delete(blockNumber);
      }
    }
  }

  /**
   * Calculate total supply from account states
   * @param accountStates - Account states to calculate from
   * @returns Total supply
   */
  private calculateTotalSupply(accountStates: Map<string, AccountState>): string {
    let totalSupply = '0';
    
    for (const state of accountStates.values()) {
      totalSupply = this.addGas(totalSupply, state.balance);
    }
    
    return totalSupply;
  }

  /**
   * Validate a transaction
   * @param transaction - Transaction to validate
   * @returns Validation result
   */
  private validateTransaction(transaction: Transaction): ValidationResult {
    // Basic validation
    if (!transaction.hash || !transaction.from || !transaction.to || !transaction.signature) {
      return { valid: false, error: 'Missing required transaction fields' };
    }

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

    return { valid: true };
  }

  // Public API methods

  /**
   * Get the latest block
   * @returns Latest block
   */
  public getLatestBlock(): Block {
    return this.state.latestBlock;
  }

  /**
   * Get block by number
   * @param number - Block number
   * @returns Block or null if not found
   */
  public getBlockByNumber(number: number): Block | null {
    const hash = this.state.blockHashes.get(number);
    return hash ? this.state.blocks.get(hash) || null : null;
  }

  /**
   * Get block by hash
   * @param hash - Block hash
   * @returns Block or null if not found
   */
  public getBlockByHash(hash: string): Block | null {
    return this.state.blocks.get(hash) || null;
  }

  /**
   * Get account state
   * @param address - Account address
   * @returns Account state or null if not found
   */
  public getAccountState(address: string): AccountState | null {
    return this.state.accountStates.get(address) || null;
  }

  /**
   * Get transaction by hash
   * @param hash - Transaction hash
   * @returns Transaction and block info or null if not found
   */
  public getTransaction(hash: string): { transaction: Transaction; block: Block; index: number } | null {
    const cached = this.transactionCache.get(hash);
    if (cached) {
      return cached;
    }

    // Search through blocks if not in cache
    for (const block of this.state.blocks.values()) {
      const index = block.transactions.findIndex(tx => tx.hash === hash);
      if (index !== -1) {
        const transaction = block.transactions[index];
        if (transaction) {
          const result = { transaction, block, index };
          this.transactionCache.set(hash, result);
          return result;
        }
      }
    }
    return null;
  }

  /**
   * Get current chain height
   * @returns Chain height (latest block number)
   */
  public getChainHeight(): number {
    return this.state.latestBlock.number;
  }

  /**
   * Validate entire chain integrity
   * @returns Validation result
   */
  public validateChain(): ValidationResult {
    try {
      let currentBlock = this.state.latestBlock;
      let blockCount = 0;
      
      while (currentBlock.number > 0) {
        // Validate current block
        const blockValidation = this.validateBlockStructure(currentBlock);
        if (!blockValidation.valid) {
          return { valid: false, error: `Invalid block at height ${currentBlock.number}: ${blockValidation.error}` };
        }

        // Get parent block
        const parentBlock = this.state.blocks.get(currentBlock.parentHash);
        if (!parentBlock) {
          return { valid: false, error: `Missing parent block for ${currentBlock.hash}` };
        }

        // Check parent-child relationship
        if (parentBlock.number !== currentBlock.number - 1) {
          return { valid: false, error: `Invalid parent-child relationship at height ${currentBlock.number}` };
        }

        currentBlock = parentBlock;
        blockCount++;

        // Prevent infinite loops
        if (blockCount > this.state.blocks.size) {
          return { valid: false, error: 'Chain validation loop detected' };
        }
      }

      // Validate genesis block
      return this.validateBlockStructure(currentBlock);
    } catch (error) {
      return { 
        valid: false, 
        error: `Chain validation error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Get comprehensive ledger statistics
   * @returns Detailed ledger statistics
   */
  public getStats(): LedgerStats {
    let totalTransactions = 0;
    let totalBlockSize = 0;
    let totalGasUsed = '0';
    let blockCount = 0;

    for (const block of this.state.blocks.values()) {
      totalTransactions += block.transactions.length;
      totalBlockSize += JSON.stringify(block).length;
      totalGasUsed = this.addGas(totalGasUsed, block.gasUsed);
      blockCount++;
    }

    return {
      chainHeight: this.getChainHeight(),
      totalBlocks: this.getTotalBlocks(),
      totalTransactions,
      totalAccounts: this.state.accountStates.size,
      totalDifficulty: this.state.totalDifficulty,
      totalSupply: this.state.totalSupply,
      averageBlockSize: blockCount > 0 ? Math.floor(totalBlockSize / blockCount) : 0,
      averageGasUsed: blockCount > 0 ? this.divideGas(totalGasUsed, blockCount.toString()) : '0',
      lastBlockTime: this.state.latestBlock.timestamp,
      syncProgress: 100 // Always 100% for local ledger
    };
  }

  /**
   * Get total number of blocks
   * @returns Total blocks in chain
   */
  public getTotalBlocks(): number {
    return this.state.blocks.size;
  }

  /**
   * Get checkpoint information
   * @returns Checkpoint information
   */
  public getCheckpointInfo(): { lastCheckpoint?: number; totalCheckpoints: number } {
    const result: { lastCheckpoint?: number; totalCheckpoints: number } = {
      totalCheckpoints: this.checkpoints.size
    };
    
    if (this.state.lastCheckpoint !== undefined) {
      result.lastCheckpoint = this.state.lastCheckpoint;
    }
    
    return result;
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

  private subtractGas(a: string, b: string): string {
    return (BigInt(a) - BigInt(b)).toString();
  }

  private multiplyGas(a: string, b: string): string {
    return (BigInt(a) * BigInt(b)).toString();
  }

  private divideGas(a: string, b: string): string {
    return (BigInt(a) / BigInt(b)).toString();
  }
}
