import { EventEmitter } from 'events';
import { Block } from '../core/Block';
import { Transaction } from '../core/Transaction';
import { NodeConfig, NodeRole } from '../core/Node';
import { CryptoUtils } from '../crypto/CryptoUtils';

export interface ConsensusResult {
  success: boolean;
  block?: Block;
  validator?: string;
  signature?: string;
}

export class ConsensusEngine extends EventEmitter {
  private config: NodeConfig;
  private currentValidator: number = 0;
  private consensusRound: number = 0;
  private isRunning: boolean = false;
  private pendingVotes: Map<string, any> = new Map();

  constructor(config: NodeConfig) {
    super();
    this.config = config;
  }

  public async initialize(): Promise<void> {
    this.isRunning = true;
    console.log('🔗 Consensus engine initialized');
  }

  public async startConsensus(transactions: Transaction[]): Promise<ConsensusResult> {
    if (!this.canParticipateInConsensus()) {
      return { success: false };
    }

    try {
      this.consensusRound++;
      const validator = this.getCurrentValidator();
      
      // If this node is the current validator, create a block
      if (validator === this.config.id) {
        const block = await this.createBlock(transactions);
        const result = await this.proposeBlock(block);
        return result;
      }

      return { success: false };
    } catch (error) {
      console.error('Consensus error:', error);
      return { success: false };
    }
  }

  private async createBlock(transactions: Transaction[]): Promise<Block> {
    // Create a new block with pending transactions
    const block = new Block(
      0, // Will be set by the blockchain
      '', // Will be set by the blockchain
      transactions,
      Date.now(),
      '', // Will be calculated
      0,
      this.config.id
    );

    return block;
  }

  private async proposeBlock(block: Block): Promise<ConsensusResult> {
    try {
      // Sign the block with this validator's private key
      const signature = await CryptoUtils.sign(JSON.stringify(block), this.config.id);
      
      // In a real implementation, this would be broadcast to other validators
      // For now, we'll simulate consensus achievement
      
      const result: ConsensusResult = {
        success: true,
        block: block,
        validator: this.config.id,
        signature: signature
      };

      // Move to next validator
      this.moveToNextValidator();
      
      // Emit consensus achieved
      this.emit('consensus:achieved', block);
      
      return result;
    } catch (error) {
      console.error('Error proposing block:', error);
      return { success: false };
    }
  }

  public async validateBlock(block: Block): Promise<boolean> {
    try {
      // Check if block is from current validator
      if (block.validator !== this.getCurrentValidator()) {
        return false;
      }

      // Check if we have enough votes (simplified PoA)
      const requiredVotes = Math.ceil(this.config.validatorSet.length * 0.66); // 66% majority
      const currentVotes = this.pendingVotes.size + 1; // +1 for this node

      if (currentVotes >= requiredVotes) {
        // Clear pending votes and emit consensus achieved
        this.pendingVotes.clear();
        this.moveToNextValidator();
        this.emit('consensus:achieved', block);
        return true;
      }

      // Add this node's vote
      this.pendingVotes.set(this.config.id, {
        blockHash: block.hash,
        timestamp: Date.now()
      });

      return false;
    } catch (error) {
      console.error('Error validating block:', error);
      return false;
    }
  }

  private getCurrentValidator(): string {
    if (this.config.validatorSet.length === 0) {
      return this.config.id;
    }
    return this.config.validatorSet[this.currentValidator];
  }

  private moveToNextValidator(): void {
    this.currentValidator = (this.currentValidator + 1) % this.config.validatorSet.length;
  }

  private canParticipateInConsensus(): boolean {
    return this.isRunning && 
           (this.config.role === NodeRole.VALIDATOR || 
            this.config.role === NodeRole.AUTHORITY);
  }

  public getConsensusStatus(): object {
    return {
      isRunning: this.isRunning,
      currentValidator: this.getCurrentValidator(),
      consensusRound: this.consensusRound,
      pendingVotes: this.pendingVotes.size,
      validatorSet: this.config.validatorSet
    };
  }

  public async addValidator(validatorId: string): Promise<boolean> {
    if (this.config.role !== NodeRole.AUTHORITY) {
      return false;
    }

    if (!this.config.validatorSet.includes(validatorId)) {
      this.config.validatorSet.push(validatorId);
      console.log(`✅ Validator ${validatorId} added to consensus set`);
      return true;
    }

    return false;
  }

  public async removeValidator(validatorId: string): Promise<boolean> {
    if (this.config.role !== NodeRole.AUTHORITY) {
      return false;
    }

    const index = this.config.validatorSet.indexOf(validatorId);
    if (index > -1) {
      this.config.validatorSet.splice(index, 1);
      
      // Adjust current validator if necessary
      if (this.currentValidator >= this.config.validatorSet.length) {
        this.currentValidator = 0;
      }
      
      console.log(`❌ Validator ${validatorId} removed from consensus set`);
      return true;
    }

    return false;
  }

  public getValidatorSet(): string[] {
    return [...this.config.validatorSet];
  }

  public getCurrentValidatorIndex(): number {
    return this.currentValidator;
  }

  public async shutdown(): Promise<void> {
    this.isRunning = false;
    this.pendingVotes.clear();
    console.log('🛑 Consensus engine shutdown');
  }

  public isConsensusRunning(): boolean {
    return this.isRunning;
  }

  // Proof of Authority specific methods
  public async validateAuthority(validatorId: string): Promise<boolean> {
    // In PoA, validators are pre-approved authorities
    return this.config.validatorSet.includes(validatorId);
  }

  public async getValidatorStake(validatorId: string): Promise<number> {
    // In PoA, stake is not used like in PoS
    // All validators have equal authority
    return this.config.validatorSet.includes(validatorId) ? 1 : 0;
  }

  public async calculateFinality(block: Block): Promise<number> {
    // In PoA, finality is achieved once consensus is reached
    // Return the number of confirmations
    return this.pendingVotes.size + 1;
  }
}
