import { Block, Transaction } from '../types/block.types';
import { NodeInfo, NodeRole } from '../types/node.types';
import { EventEmitter } from 'events';

export interface ConsensusConfig {
  blockTime: number;
  validatorSet: string[];
  blockGasLimit: string;
  minValidators: number;
  votingPeriod: number;
}

export interface Vote {
  validator: string;
  blockHash: string;
  decision: boolean;
  signature: string;
  timestamp: number;
}

export class ProofOfAuthority extends EventEmitter {
  private config: ConsensusConfig;
  private currentValidator: number = 0;
  private pendingVotes: Map<string, Vote[]> = new Map();
  private isValidator: boolean = false;
  private nodeInfo: NodeInfo;

  constructor(config: ConsensusConfig, nodeInfo: NodeInfo) {
    super();
    this.config = config;
    this.nodeInfo = nodeInfo;
    this.isValidator = this.isNodeValidator();
  }

  public async proposeBlock(transactions: Transaction[]): Promise<Block> {
    if (!this.isValidator) {
      throw new Error('Node is not authorized to propose blocks');
    }

    // Get latest block hash (simplified - would come from blockchain storage)
    const parentHash = await this.getLatestBlockHash();
    const blockNumber = await this.getLatestBlockNumber() + 1;

    // Create block
    const block = await this.createBlock(parentHash, blockNumber, transactions);
    
    // Sign block
    block.signature = await this.signBlock(block);

    this.emit('blockProposed', block);
    return block;
  }

  public async voteOnBlock(blockHash: string, approve: boolean): Promise<Vote> {
    if (!this.isValidator) {
      throw new Error('Node is not authorized to vote');
    }

    const vote: Vote = {
      validator: this.nodeInfo.id,
      blockHash,
      decision: approve,
      signature: await this.signVote(blockHash, approve),
      timestamp: Date.now()
    };

    this.emit('voteCast', vote);
    return vote;
  }

  public async addVote(vote: Vote): Promise<boolean> {
    // Verify vote signature
    if (!await this.verifyVoteSignature(vote)) {
      return false;
    }

    // Add vote to pending votes
    const votes = this.pendingVotes.get(vote.blockHash) || [];
    votes.push(vote);
    this.pendingVotes.set(vote.blockHash, votes);

    // Check if we have enough votes for consensus
    return await this.checkConsensus(vote.blockHash);
  }

  public getNextValidator(): string {
    const validators = this.config.validatorSet;
    const validator = validators[this.currentValidator];
    this.currentValidator = (this.currentValidator + 1) % validators.length;
    return validator || '';
  }

  public isNodeValidator(): boolean {
    return this.config.validatorSet.includes(this.nodeInfo.id) &&
           (this.nodeInfo.role === NodeRole.AUTHORITY || this.nodeInfo.role === NodeRole.VALIDATOR);
  }

  private async createBlock(parentHash: string, number: number, transactions: Transaction[]): Promise<Block> {
    // This would use the BlockBuilder from blockchain/block.ts
    // For now, return a simplified block structure
    const block: Block = {
      hash: '',
      parentHash: parentHash || '',
      number,
      timestamp: Date.now(),
      transactions,
      validator: this.nodeInfo.id,
      signature: '',
      stateRoot: '',
      transactionsRoot: '',
      receiptsRoot: '',
      gasLimit: this.config.blockGasLimit,
      gasUsed: '0',
      extraData: ''
    };

    return block;
  }

  private async signBlock(block: Block): Promise<string> {
    // In a real implementation, this would use the node's private key
    // For now, return a mock signature
    return `signature_${block.hash}_${this.nodeInfo.id}`;
  }

  private async signVote(blockHash: string, approve: boolean): Promise<string> {
    // In a real implementation, this would use the node's private key
    return `vote_signature_${blockHash}_${approve}_${this.nodeInfo.id}`;
  }

  private async verifyVoteSignature(vote: Vote): Promise<boolean> {
    // In a real implementation, this would verify the cryptographic signature
    // For now, just check basic format
    return vote.signature.startsWith('vote_signature_') && 
           vote.signature.includes(vote.blockHash) &&
           vote.signature.includes(vote.decision.toString());
  }

  private async checkConsensus(blockHash: string): Promise<boolean> {
    const votes = this.pendingVotes.get(blockHash) || [];
    const approveVotes = votes.filter(v => v.decision);
    const rejectVotes = votes.filter(v => !v.decision);

    // Need majority approval
    const totalValidators = this.config.validatorSet.length;
    const requiredVotes = Math.floor(totalValidators * 0.5) + 1;

    if (approveVotes.length >= requiredVotes) {
      this.emit('consensusReached', blockHash, true);
      this.pendingVotes.delete(blockHash);
      return true;
    }

    if (rejectVotes.length >= requiredVotes) {
      this.emit('consensusReached', blockHash, false);
      this.pendingVotes.delete(blockHash);
      return false;
    }

    return false;
  }

  private async getLatestBlockHash(): Promise<string> {
    // In a real implementation, this would query the blockchain storage
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  private async getLatestBlockNumber(): Promise<number> {
    // In a real implementation, this would query the blockchain storage
    return 0;
  }

  public getValidatorSet(): string[] {
    return [...this.config.validatorSet];
  }

  public addValidator(validatorId: string): void {
    if (!this.config.validatorSet.includes(validatorId)) {
      this.config.validatorSet.push(validatorId);
      this.emit('validatorAdded', validatorId);
    }
  }

  public removeValidator(validatorId: string): void {
    const index = this.config.validatorSet.indexOf(validatorId);
    if (index > -1) {
      this.config.validatorSet.splice(index, 1);
      this.emit('validatorRemoved', validatorId);
    }
  }
}
