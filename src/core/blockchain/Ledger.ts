import { Block, Transaction, AccountState, GenesisBlock } from '../types/block.types';
import { HashUtils, SignatureUtils } from '../crypto';
import { validateBlock } from './block';
import { EventEmitter } from 'events';

export interface LedgerState {
  latestBlock: Block;
  blockHashes: Map<number, string>; // block number -> hash
  blocks: Map<string, Block>; // hash -> block
  accountStates: Map<string, AccountState>; // address -> state
  totalDifficulty: string;
}

/**
 * Ledger class for managing the blockchain state
 */
export class Ledger extends EventEmitter {
  private state: LedgerState;
  private genesisBlock: GenesisBlock;

  constructor(genesisBlock: GenesisBlock) {
    super();
    this.genesisBlock = genesisBlock;
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
      totalDifficulty: '0'
    };
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
   * Add a new block to the ledger
   * @param block - Block to add
   * @returns True if block was added successfully
   */
  public addBlock(block: Block): boolean {
    try {
      // Validate block structure
      if (!validateBlock(block)) {
        this.emit('error', new Error('Invalid block structure'));
        return false;
      }

      // Check if block links to current chain
      if (block.parentHash !== this.state.latestBlock.hash) {
        this.emit('error', new Error('Block does not link to current chain'));
        return false;
      }

      // Check block number
      if (block.number !== this.state.latestBlock.number + 1) {
        this.emit('error', new Error('Invalid block number'));
        return false;
      }

      // Verify block signature
      if (!SignatureUtils.verifyBlockSignature(block)) {
        this.emit('error', new Error('Invalid block signature'));
        return false;
      }

      // Process transactions and update state
      const newState = this.processBlock(block);
      if (!newState) {
        this.emit('error', new Error('Failed to process block'));
        return false;
      }

      // Update state
      this.state = newState;
      
      // Emit events
      this.emit('blockAdded', block);
      this.emit('stateUpdated', this.state);

      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
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

      // Process each transaction
      for (const tx of block.transactions) {
        const result = this.processTransaction(tx, newAccountStates);
        if (!result.success) {
          this.emit('error', new Error(`Transaction failed: ${result.error}`));
          return null;
        }
        totalGasUsed = this.addGas(totalGasUsed, tx.gasLimit);
      }

      // Verify gas used matches block gas used
      if (totalGasUsed !== block.gasUsed) {
        this.emit('error', new Error('Gas used mismatch'));
        return null;
      }

      // Update state
      const newState: LedgerState = {
        latestBlock: block,
        blockHashes: new Map(this.state.blockHashes),
        blocks: new Map(this.state.blocks),
        accountStates: newAccountStates,
        totalDifficulty: this.addGas(this.state.totalDifficulty, '1') // Simplified difficulty
      };

      newState.blockHashes.set(block.number, block.hash);
      newState.blocks.set(block.hash, block);

      return newState;
    } catch (error) {
      this.emit('error', error);
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
    for (const block of this.state.blocks.values()) {
      const index = block.transactions.findIndex(tx => tx.hash === hash);
      if (index !== -1) {
        const transaction = block.transactions[index];
        if (transaction) {
          return { transaction, block, index };
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
   * Get total number of blocks
   * @returns Total blocks in chain
   */
  public getTotalBlocks(): number {
    return this.state.blocks.size;
  }

  /**
   * Validate chain integrity
   * @returns True if chain is valid
   */
  public validateChain(): boolean {
    try {
      let currentBlock = this.state.latestBlock;
      
      while (currentBlock.number > 0) {
        // Validate current block
        if (!validateBlock(currentBlock)) {
          return false;
        }

        // Get parent block
        const parentBlock = this.state.blocks.get(currentBlock.parentHash);
        if (!parentBlock) {
          return false;
        }

        // Check parent-child relationship
        if (parentBlock.number !== currentBlock.number - 1) {
          return false;
        }

        currentBlock = parentBlock;
      }

      // Validate genesis block
      return validateBlock(currentBlock);
    } catch (error) {
      console.error('Chain validation error:', error);
      return false;
    }
  }

  /**
   * Get ledger statistics
   * @returns Ledger statistics
   */
  public getStats(): {
    chainHeight: number;
    totalBlocks: number;
    totalTransactions: number;
    totalAccounts: number;
    totalDifficulty: string;
  } {
    let totalTransactions = 0;
    for (const block of this.state.blocks.values()) {
      totalTransactions += block.transactions.length;
    }

    return {
      chainHeight: this.getChainHeight(),
      totalBlocks: this.getTotalBlocks(),
      totalTransactions,
      totalAccounts: this.state.accountStates.size,
      totalDifficulty: this.state.totalDifficulty
    };
  }

  // Utility methods for gas calculations
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
}
