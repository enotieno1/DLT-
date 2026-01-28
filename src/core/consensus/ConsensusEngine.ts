import { Block, Transaction } from '../types/block.types';
import { NodeInfo, NodeRole } from '../types/node.types';
import { SignatureUtils } from '../crypto';
import { EventEmitter } from 'events';

export interface ConsensusConfig {
  blockTime: number;
  validatorSet: string[];
  blockGasLimit: string;
  minValidators: number;
  votingPeriod: number;
  checkpointInterval: number;
  finalityBlocks: number;
}

export interface Vote {
  validator: string;
  blockHash: string;
  decision: boolean;
  signature: string;
  timestamp: number;
  reason?: string;
}

export interface ConsensusState {
  currentRound: number;
  currentPhase: 'PROPOSAL' | 'VOTING' | 'COMMIT';
  currentProposer: string;
  proposedBlock?: Block;
  votes: Vote[];
  roundStartTime: number;
  lastCommittedBlock?: Block;
}

export interface Checkpoint {
  blockNumber: number;
  blockHash: string;
  validatorSet: string[];
  timestamp: number;
  signatures: string[];
}

/**
 * Enhanced Proof of Authority Consensus Engine
 * Implements a robust PoA consensus with finality and checkpointing
 */
export class ConsensusEngine extends EventEmitter {
  private config: ConsensusConfig;
  private nodeInfo: NodeInfo;
  private state: ConsensusState;
  private checkpoints: Map<number, Checkpoint> = new Map();
  private privateKey: string;
  private isActive: boolean = false;
  private consensusTimer?: NodeJS.Timeout | null;

  constructor(config: ConsensusConfig, nodeInfo: NodeInfo, privateKey: string) {
    super();
    this.config = config;
    this.nodeInfo = nodeInfo;
    this.privateKey = privateKey;
    this.state = this.initializeConsensusState();
  }

  /**
   * Initialize consensus state
   * @returns Initial consensus state
   */
  private initializeConsensusState(): ConsensusState {
    return {
      currentRound: 0,
      currentPhase: 'PROPOSAL',
      currentProposer: this.getNextValidator(0),
      votes: [],
      roundStartTime: Date.now()
    };
  }

  /**
   * Start the consensus engine
   */
  public start(): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.emit('consensusStarted');
    
    // Start consensus loop
    this.startConsensusLoop();
  }

  /**
   * Stop the consensus engine
   */
  public stop(): void {
    this.isActive = false;
    
    if (this.consensusTimer) {
      clearTimeout(this.consensusTimer);
      this.consensusTimer = null;
    }
    
    this.emit('consensusStopped');
  }

  /**
   * Start the main consensus loop
   */
  private startConsensusLoop(): void {
    if (!this.isActive) {
      return;
    }

    this.runConsensusRound().catch(error => {
      console.error('Consensus round error:', error);
      this.emit('consensusError', error);
    });

    // Schedule next round
    this.consensusTimer = setTimeout(() => {
      this.startConsensusLoop();
    }, this.config.blockTime);
  }

  /**
   * Run a single consensus round
   */
  private async runConsensusRound(): Promise<void> {
    try {
      switch (this.state.currentPhase) {
        case 'PROPOSAL':
          await this.handleProposalPhase();
          break;
        case 'VOTING':
          await this.handleVotingPhase();
          break;
        case 'COMMIT':
          await this.handleCommitPhase();
          break;
      }
    } catch (error) {
      console.error('Consensus phase error:', error);
      this.advanceToNextRound();
    }
  }

  /**
   * Handle the proposal phase
   */
  private async handleProposalPhase(): Promise<void> {
    if (this.isCurrentProposer()) {
      try {
        // Get pending transactions from transaction pool
        const transactions = await this.getPendingTransactions();
        
        if (transactions.length > 0) {
          const block = await this.proposeBlock(transactions);
          this.state.proposedBlock = block;
          this.state.currentPhase = 'VOTING';
          this.emit('blockProposed', block);
        } else {
          // No transactions, skip to next round
          this.advanceToNextRound();
        }
      } catch (error) {
        console.error('Block proposal failed:', error);
        this.advanceToNextRound();
      }
    } else {
      // Wait for proposal from current proposer
      this.state.currentPhase = 'VOTING';
    }
  }

  /**
   * Handle the voting phase
   */
  private async handleVotingPhase(): Promise<void> {
    if (!this.state.proposedBlock) {
      this.advanceToNextRound();
      return;
    }

    if (this.isValidator()) {
      try {
        const vote = await this.voteOnBlock(this.state.proposedBlock);
        this.addVote(vote);
        this.emit('voteCast', vote);
      } catch (error) {
        console.error('Voting failed:', error);
      }
    }

    // Check if we have enough votes
    if (await this.checkConsensus()) {
      this.state.currentPhase = 'COMMIT';
    } else {
      // Check voting timeout
      const votingTimeout = this.config.votingPeriod;
      if (Date.now() - this.state.roundStartTime > votingTimeout) {
        this.emit('votingTimeout', this.state.currentRound);
        this.advanceToNextRound();
      }
    }
  }

  /**
   * Handle the commit phase
   */
  private async handleCommitPhase(): Promise<void> {
    if (!this.state.proposedBlock) {
      this.advanceToNextRound();
      return;
    }

    const consensus = await this.calculateConsensus();
    
    if (consensus.reached && consensus.approved) {
      // Block is committed
      this.state.lastCommittedBlock = this.state.proposedBlock;
      this.emit('blockCommitted', this.state.proposedBlock);
      
      // Create checkpoint if needed
      if (this.state.proposedBlock.number % this.config.checkpointInterval === 0) {
        await this.createCheckpoint(this.state.proposedBlock);
      }
    } else {
      this.emit('blockRejected', this.state.proposedBlock, consensus.reason);
    }

    this.advanceToNextRound();
  }

  /**
   * Advance to the next consensus round
   */
  private advanceToNextRound(): void {
    this.state.currentRound++;
    this.state.currentPhase = 'PROPOSAL';
    this.state.currentProposer = this.getNextValidator(this.state.currentRound);
    this.state.proposedBlock = undefined;
    this.state.votes = [];
    this.state.roundStartTime = Date.now();
  }

  /**
   * Propose a new block
   * @param transactions - Transactions to include in the block
   * @returns Proposed block
   */
  public async proposeBlock(transactions: Transaction[]): Promise<Block> {
    if (!this.isValidator()) {
      throw new Error('Node is not authorized to propose blocks');
    }

    // Get latest block info
    const parentHash = await this.getLatestBlockHash();
    const blockNumber = await this.getLatestBlockNumber() + 1;

    // Create block using BlockBuilder
    const { BlockBuilder } = await import('../blockchain');
    const builder = new BlockBuilder(parentHash, blockNumber, this.nodeInfo.id);
    
    // Add transactions
    for (const tx of transactions) {
      builder.addTransaction(tx);
    }

    builder.setGasLimit(this.config.blockGasLimit);
    builder.setExtraData(JSON.stringify({
      round: this.state.currentRound,
      proposer: this.nodeInfo.id,
      timestamp: Date.now()
    }));

    const block = builder.build();

    // Sign block
    block.signature = SignatureUtils.signBlock(block, this.privateKey);
    block.hash = this.calculateBlockHash(block);

    return block;
  }

  /**
   * Vote on a proposed block
   * @param block - Block to vote on
   * @returns Vote object
   */
  public async voteOnBlock(block: Block): Promise<Vote> {
    if (!this.isValidator()) {
      throw new Error('Node is not authorized to vote');
    }

    // Validate block
    const isValid = await this.validateBlock(block);
    
    const message = `${block.hash}:${this.state.currentRound}:${isValid}`;
    const signature = SignatureUtils.sign(message, this.privateKey);

    const vote: Vote = {
      validator: this.nodeInfo.id,
      blockHash: block.hash,
      decision: isValid,
      signature,
      timestamp: Date.now(),
      reason: isValid ? 'Block is valid' : 'Block validation failed'
    };

    return vote;
  }

  /**
   * Add a vote to the current round
   * @param vote - Vote to add
   * @returns True if vote was added successfully
   */
  public async addVote(vote: Vote): Promise<boolean> {
    try {
      // Verify vote signature
      if (!this.verifyVoteSignature(vote)) {
        return false;
      }

      // Check if vote is from current validator set
      if (!this.config.validatorSet.includes(vote.validator)) {
        return false;
      }

      // Check if validator already voted
      const existingVote = this.state.votes.find(v => v.validator === vote.validator);
      if (existingVote) {
        return false; // Duplicate vote
      }

      // Add vote
      this.state.votes.push(vote);
      return true;
    } catch (error) {
      console.error('Error adding vote:', error);
      return false;
    }
  }

  /**
   * Check if consensus has been reached
   * @returns True if consensus reached
   */
  public async checkConsensus(): Promise<boolean> {
    const totalValidators = this.config.validatorSet.length;
    const requiredVotes = Math.floor(totalValidators * 2/3) + 1; // 2/3 + 1 supermajority

    const approveVotes = this.state.votes.filter(v => v.decision);
    const rejectVotes = this.state.votes.filter(v => !v.decision);

    if (approveVotes.length >= requiredVotes) {
      return true;
    }

    if (rejectVotes.length >= requiredVotes) {
      return true;
    }

    return false;
  }

  /**
   * Calculate consensus result
   * @returns Consensus result
   */
  public async calculateConsensus(): Promise<{
    reached: boolean;
    approved: boolean;
    reason?: string;
  }> {
    const totalValidators = this.config.validatorSet.length;
    const requiredVotes = Math.floor(totalValidators * 2/3) + 1;

    const approveVotes = this.state.votes.filter(v => v.decision);
    const rejectVotes = this.state.votes.filter(v => !v.decision);

    if (approveVotes.length >= requiredVotes) {
      return {
        reached: true,
        approved: true,
        reason: `Supermajority approval: ${approveVotes.length}/${totalValidators}`
      };
    }

    if (rejectVotes.length >= requiredVotes) {
      return {
        reached: true,
        approved: false,
        reason: `Supermajority rejection: ${rejectVotes.length}/${totalValidators}`
      };
    }

    return {
      reached: false,
      approved: false,
      reason: `Insufficient votes: ${this.state.votes.length}/${totalValidators}`
    };
  }

  /**
   * Get the next validator for a given round
   * @param round - Consensus round
   * @returns Validator ID
   */
  private getNextValidator(round: number): string {
    const validators = this.config.validatorSet;
    const index = round % validators.length;
    return validators[index];
  }

  /**
   * Check if current node is the proposer for this round
   * @returns True if current node is proposer
   */
  private isCurrentProposer(): boolean {
    return this.state.currentProposer === this.nodeInfo.id;
  }

  /**
   * Check if current node is a validator
   * @returns True if current node is validator
   */
  public isValidator(): boolean {
    return this.config.validatorSet.includes(this.nodeInfo.id) &&
           (this.nodeInfo.role === NodeRole.AUTHORITY || this.nodeInfo.role === NodeRole.VALIDATOR);
  }

  /**
   * Verify vote signature
   * @param vote - Vote to verify
   * @returns True if signature is valid
   */
  private verifyVoteSignature(vote: Vote): boolean {
    try {
      // In a real implementation, you'd get the validator's public key
      // For now, we'll use a simplified verification
      return vote.signature.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate a block
   * @param block - Block to validate
   * @returns True if block is valid
   */
  private async validateBlock(block: Block): Promise<boolean> {
    try {
      // Basic validation
      if (!block.hash || !block.parentHash || !block.validator) {
        return false;
      }

      // Verify block signature
      if (!SignatureUtils.verifyBlockSignature(block)) {
        return false;
      }

      // Verify parent hash
      const latestHash = await this.getLatestBlockHash();
      if (block.parentHash !== latestHash) {
        return false;
      }

      // Verify block number
      const latestNumber = await this.getLatestBlockNumber();
      if (block.number !== latestNumber + 1) {
        return false;
      }

      // Verify gas limit
      if (BigInt(block.gasLimit) > BigInt(this.config.blockGasLimit)) {
        return false;
      }

      // Verify transactions
      for (const tx of block.transactions) {
        if (!this.validateTransaction(tx)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Block validation error:', error);
      return false;
    }
  }

  /**
   * Validate a transaction
   * @param transaction - Transaction to validate
   * @returns True if transaction is valid
   */
  private validateTransaction(transaction: Transaction): boolean {
    // Basic validation
    return !!(transaction.hash && transaction.from && transaction.to && transaction.signature);
  }

  /**
   * Calculate block hash
   * @param block - Block to hash
   * @returns Block hash
   */
  private calculateBlockHash(block: Block): string {
    const { HashUtils } = require('../crypto');
    return HashUtils.hashBlock(block);
  }

  /**
   * Create a checkpoint
   * @param block - Block to create checkpoint for
   */
  private async createCheckpoint(block: Block): Promise<void> {
    const checkpoint: Checkpoint = {
      blockNumber: block.number,
      blockHash: block.hash,
      validatorSet: [...this.config.validatorSet],
      timestamp: Date.now(),
      signatures: [] // Would collect validator signatures
    };

    this.checkpoints.set(block.number, checkpoint);
    this.emit('checkpointCreated', checkpoint);
  }

  /**
   * Get pending transactions (placeholder)
   * @returns Array of pending transactions
   */
  private async getPendingTransactions(): Promise<Transaction[]> {
    // In a real implementation, this would get transactions from the transaction pool
    return [];
  }

  /**
   * Get latest block hash (placeholder)
   * @returns Latest block hash
   */
  private async getLatestBlockHash(): Promise<string> {
    // In a real implementation, this would query the blockchain
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  /**
   * Get latest block number (placeholder)
   * @returns Latest block number
   */
  private async getLatestBlockNumber(): Promise<number> {
    // In a real implementation, this would query the blockchain
    return 0;
  }

  /**
   * Get current consensus state
   * @returns Current consensus state
   */
  public getConsensusState(): ConsensusState {
    return { ...this.state };
  }

  /**
   * Get validator set
   * @returns Array of validator IDs
   */
  public getValidatorSet(): string[] {
    return [...this.config.validatorSet];
  }

  /**
   * Add a validator to the set
   * @param validatorId - Validator ID to add
   */
  public addValidator(validatorId: string): void {
    if (!this.config.validatorSet.includes(validatorId)) {
      this.config.validatorSet.push(validatorId);
      this.emit('validatorAdded', validatorId);
    }
  }

  /**
   * Remove a validator from the set
   * @param validatorId - Validator ID to remove
   */
  public removeValidator(validatorId: string): void {
    const index = this.config.validatorSet.indexOf(validatorId);
    if (index > -1) {
      this.config.validatorSet.splice(index, 1);
      this.emit('validatorRemoved', validatorId);
    }
  }

  /**
   * Get consensus statistics
   * @returns Consensus statistics
   */
  public getStats(): {
    currentRound: number;
    currentPhase: string;
    currentProposer: string;
    totalValidators: number;
    totalCheckpoints: number;
    isActive: boolean;
  } {
    return {
      currentRound: this.state.currentRound,
      currentPhase: this.state.currentPhase,
      currentProposer: this.state.currentProposer,
      totalValidators: this.config.validatorSet.length,
      totalCheckpoints: this.checkpoints.size,
      isActive: this.isActive
    };
  }
}
