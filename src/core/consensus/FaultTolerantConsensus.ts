import { Block, Transaction } from '../types/block.types';
import { NodeInfo, NodeRole } from '../types/node.types';
import { CryptoUtils } from '../crypto';
import { EventEmitter } from 'events';

export interface FaultTolerantConfig {
  blockTime: number;
  validatorSet: string[];
  blockGasLimit: string;
  minValidators: number;
  votingPeriod: number;
  checkpointInterval: number;
  finalityBlocks: number;
  faultTolerance: {
    maxFailedRounds: number;
    heartbeatInterval: number;
    timeoutThreshold: number;
    byzantineThreshold: number;
    recoveryTimeout: number;
    networkPartitionTimeout: number;
  };
}

export interface ValidatorHealth {
  validatorId: string;
  status: 'ACTIVE' | 'SUSPECTED' | 'FAILED' | 'RECOVERING';
  lastSeen: number;
  responseTime: number;
  successRate: number;
  consecutiveFailures: number;
  reputation: number;
}

export interface ConsensusRound {
  roundNumber: number;
  phase: 'PROPOSAL' | 'VOTING' | 'COMMIT' | 'RECOVERY';
  proposer: string;
  startTime: number;
  timeout: number;
  proposedBlock?: Block;
  votes: Vote[];
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  faultDetected?: boolean;
}

export interface Vote {
  validator: string;
  blockHash: string;
  decision: boolean;
  signature: string;
  timestamp: number;
  roundNumber: number;
  reason?: string;
}

export interface NetworkPartition {
  detected: boolean;
  startTime: number;
  partitionId: string;
  knownValidators: string[];
  isolatedValidators: string[];
}

/**
 * Fault-tolerant consensus mechanism with Byzantine fault tolerance
 * Implements enhanced Proof of Authority with comprehensive fault detection and recovery
 */
export class FaultTolerantConsensus extends EventEmitter {
  private config: FaultTolerantConfig;
  private nodeInfo: NodeInfo;
  private privateKey: string;
  
  // Consensus state
  private currentRound: ConsensusRound;
  private validatorHealth: Map<string, ValidatorHealth> = new Map();
  private roundHistory: Map<number, ConsensusRound> = new Map();
  private networkPartition: NetworkPartition;
  
  // Fault tolerance
  private failedRounds: number = 0;
  private consecutiveTimeouts: number = 0;
  private recoveryMode: boolean = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private consensusTimer?: NodeJS.Timeout;
  
  // Byzantine fault tolerance
  private byzantineAccusations: Map<string, Set<string>> = new Map();
  private evidence: Map<string, any> = new Map();

  constructor(config: FaultTolerantConfig, nodeInfo: NodeInfo, privateKey: string) {
    super();
    this.config = config;
    this.nodeInfo = nodeInfo;
    this.privateKey = privateKey;
    
    this.networkPartition = {
      detected: false,
      startTime: 0,
      partitionId: '',
      knownValidators: [...config.validatorSet],
      isolatedValidators: []
    };

    this.currentRound = this.initializeRound(0);
    this.initializeValidatorHealth();
    this.startHeartbeatMonitoring();
  }

  /**
   * Initialize a new consensus round
   * @param roundNumber - Round number
   * @returns New consensus round
   */
  private initializeRound(roundNumber: number): ConsensusRound {
    const proposer = this.getRoundProposer(roundNumber);
    
    return {
      roundNumber,
      phase: 'PROPOSAL',
      proposer,
      startTime: Date.now(),
      timeout: this.config.votingPeriod,
      votes: [],
      status: 'PENDING'
    };
  }

  /**
   * Initialize validator health tracking
   */
  private initializeValidatorHealth(): void {
    for (const validatorId of this.config.validatorSet) {
      this.validatorHealth.set(validatorId, {
        validatorId,
        status: 'ACTIVE',
        lastSeen: Date.now(),
        responseTime: 0,
        successRate: 1.0,
        consecutiveFailures: 0,
        reputation: 100
      });
    }
  }

  /**
   * Start heartbeat monitoring for fault detection
   */
  private startHeartbeatMonitoring(): void {
    this.heartbeatTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.faultTolerance.heartbeatInterval);
  }

  /**
   * Perform comprehensive health check on all validators
   */
  private performHealthCheck(): void {
    const now = Date.now();
    const timeoutThreshold = this.config.faultTolerance.timeoutThreshold;

    for (const [validatorId, health] of this.validatorHealth.entries()) {
      const timeSinceLastSeen = now - health.lastSeen;
      
      // Check for timeout
      if (timeSinceLastSeen > timeoutThreshold) {
        this.handleValidatorTimeout(validatorId);
      }
      
      // Check for consecutive failures
      if (health.consecutiveFailures >= 3) {
        this.markValidatorAsFailed(validatorId);
      }
      
      // Update reputation based on performance
      this.updateValidatorReputation(validatorId);
    }

    // Check for network partition
    this.detectNetworkPartition();
    
    // Emit health status
    this.emit('healthCheck', this.getValidatorHealthStatus());
  }

  /**
   * Handle validator timeout
   * @param validatorId - Validator that timed out
   */
  private handleValidatorTimeout(validatorId: string): void {
    const health = this.validatorHealth.get(validatorId);
    if (health) {
      health.consecutiveFailures++;
      health.status = health.consecutiveFailures >= 2 ? 'SUSPECTED' : 'ACTIVE';
      
      this.emit('validatorTimeout', {
        validatorId,
        consecutiveFailures: health.consecutiveFailures,
        status: health.status
      });
    }
  }

  /**
   * Mark validator as failed
   * @param validatorId - Validator to mark as failed
   */
  private markValidatorAsFailed(validatorId: string): void {
    const health = this.validatorHealth.get(validatorId);
    if (health) {
      health.status = 'FAILED';
      health.reputation = Math.max(0, health.reputation - 50);
      
      this.emit('validatorFailed', {
        validatorId,
        reputation: health.reputation
      });
      
      // Check if we have enough active validators
      this.checkQuorumAvailability();
    }
  }

  /**
   * Update validator reputation based on performance
   * @param validatorId - Validator to update
   */
  private updateValidatorReputation(validatorId: string): void {
    const health = this.validatorHealth.get(validatorId);
    if (!health) return;

    // Calculate reputation based on success rate and response time
    const performanceScore = (health.successRate * 0.7) + 
                           (Math.max(0, 1 - health.responseTime / 1000) * 0.3);
    
    // Smooth reputation changes
    const targetReputation = performanceScore * 100;
    health.reputation = Math.round(health.reputation * 0.9 + targetReputation * 0.1);
    health.reputation = Math.max(0, Math.min(100, health.reputation));
  }

  /**
   * Detect network partition
   */
  private detectNetworkPartition(): void {
    const activeValidators = Array.from(this.validatorHealth.values())
      .filter(h => h.status === 'ACTIVE')
      .map(h => h.validatorId);

    const totalValidators = this.config.validatorSet.length;
    const activeCount = activeValidators.length;
    
    // If we have less than 2/3 of validators, we might be in a partition
    if (activeCount < Math.ceil(totalValidators * 2/3)) {
      if (!this.networkPartition.detected) {
        this.networkPartition.detected = true;
        this.networkPartition.startTime = Date.now();
        this.networkPartition.isolatedValidators = this.config.validatorSet
          .filter(v => !activeValidators.includes(v));
        
        this.emit('networkPartitionDetected', this.networkPartition);
        this.enterRecoveryMode();
      }
    } else if (this.networkPartition.detected) {
      // Partition resolved
      this.resolveNetworkPartition();
    }
  }

  /**
   * Enter recovery mode due to network issues
   */
  private enterRecoveryMode(): void {
    this.recoveryMode = true;
    this.currentRound.phase = 'RECOVERY';
    
    this.emit('recoveryModeEntered', {
      roundNumber: this.currentRound.roundNumber,
      partitionInfo: this.networkPartition
    });
    
    // Start recovery process
    this.startConsensusRecovery();
  }

  /**
   * Start consensus recovery process
   */
  private startConsensusRecovery(): void {
    // Try to sync with other active validators
    this.attemptNetworkSync();
    
    // Set recovery timeout
    setTimeout(() => {
      if (this.recoveryMode) {
        this.handleRecoveryTimeout();
      }
    }, this.config.faultTolerance.recoveryTimeout);
  }

  /**
   * Attempt to synchronize with network
   */
  private attemptNetworkSync(): void {
    const activeValidators = Array.from(this.validatorHealth.values())
      .filter(h => h.status === 'ACTIVE')
      .map(h => h.validatorId);

    this.emit('networkSyncAttempt', {
      activeValidators,
      roundNumber: this.currentRound.roundNumber
    });
  }

  /**
   * Handle recovery timeout
   */
  private handleRecoveryTimeout(): void {
    this.emit('recoveryTimeout', {
      roundNumber: this.currentRound.roundNumber,
      failedValidators: this.networkPartition.isolatedValidators.length
    });
    
    // Try to continue with available validators
    this.continueWithReducedQuorum();
  }

  /**
   * Continue consensus with reduced quorum
   */
  private continueWithReducedQuorum(): void {
    const activeValidators = Array.from(this.validatorHealth.values())
      .filter(h => h.status === 'ACTIVE')
      .map(h => h.validatorId);

    if (activeValidators.length >= this.config.minValidators) {
      this.recoveryMode = false;
      this.currentRound.phase = 'PROPOSAL';
      
      this.emit('reducedQuorumContinuation', {
        activeValidators: activeValidators.length,
        totalValidators: this.config.validatorSet.length
      });
      
      this.startConsensusRound();
    } else {
      this.emit('insufficientValidators', {
        activeCount: activeValidators.length,
        required: this.config.minValidators
      });
    }
  }

  /**
   * Resolve network partition
   */
  private resolveNetworkPartition(): void {
    this.networkPartition.detected = false;
    this.networkPartition.isolatedValidators = [];
    
    this.emit('networkPartitionResolved', {
      duration: Date.now() - this.networkPartition.startTime
    });
    
    if (this.recoveryMode) {
      this.exitRecoveryMode();
    }
  }

  /**
   * Exit recovery mode
   */
  private exitRecoveryMode(): void {
    this.recoveryMode = false;
    this.currentRound.phase = 'PROPOSAL';
    
    this.emit('recoveryModeExited', {
      roundNumber: this.currentRound.roundNumber
    });
    
    // Reset failed rounds counter
    this.failedRounds = 0;
    this.consecutiveTimeouts = 0;
  }

  /**
   * Check if we have enough validators for quorum
   */
  private checkQuorumAvailability(): void {
    const activeValidators = Array.from(this.validatorHealth.values())
      .filter(h => h.status === 'ACTIVE' || h.status === 'RECOVERING')
      .length;

    if (activeValidators < this.config.minValidators) {
      this.emit('quorumLost', {
        activeCount: activeValidators,
        required: this.config.minValidators
      });
    }
  }

  /**
   * Start the main consensus engine
   */
  public start(): void {
    this.emit('consensusStarted');
    this.startConsensusRound();
  }

  /**
   * Start a consensus round
   */
  private startConsensusRound(): void {
    if (this.recoveryMode) {
      return;
    }

    this.currentRound = this.initializeRound(this.currentRound.roundNumber + 1);
    
    this.consensusTimer = setTimeout(() => {
      this.handleRoundTimeout();
    }, this.currentRound.timeout);

    this.runConsensusPhase();
  }

  /**
   * Run the current consensus phase
   */
  private async runConsensusPhase(): Promise<void> {
    try {
      switch (this.currentRound.phase) {
        case 'PROPOSAL':
          await this.handleProposalPhase();
          break;
        case 'VOTING':
          await this.handleVotingPhase();
          break;
        case 'COMMIT':
          await this.handleCommitPhase();
          break;
        case 'RECOVERY':
          await this.handleRecoveryPhase();
          break;
      }
    } catch (error) {
      this.handleConsensusError(error);
    }
  }

  /**
   * Handle proposal phase
   */
  private async handleProposalPhase(): Promise<void> {
    if (this.currentRound.proposer === this.nodeInfo.id) {
      try {
        const transactions = await this.getPendingTransactions();
        
        if (transactions.length > 0) {
          const block = await this.proposeBlock(transactions);
          this.currentRound.proposedBlock = block;
          this.currentRound.phase = 'VOTING';
          
          this.emit('blockProposed', {
            roundNumber: this.currentRound.roundNumber,
            block,
            proposer: this.nodeInfo.id
          });
        } else {
          this.advanceToNextRound();
        }
      } catch (error) {
        this.handleProposalError(error);
      }
    } else {
      // Wait for proposal from current proposer
      this.currentRound.phase = 'VOTING';
      this.emit('waitingForProposal', {
        roundNumber: this.currentRound.roundNumber,
        proposer: this.currentRound.proposer
      });
    }
  }

  /**
   * Handle voting phase
   */
  private async handleVotingPhase(): Promise<void> {
    if (!this.currentRound.proposedBlock) {
      this.handleRoundTimeout();
      return;
    }

    if (this.isValidator()) {
      try {
        const vote = await this.voteOnBlock(this.currentRound.proposedBlock);
        this.addVote(vote);
        
        this.emit('voteCast', {
          roundNumber: this.currentRound.roundNumber,
          vote
        });
      } catch (error) {
        this.handleVotingError(error);
      }
    }

    // Check if we have enough votes
    if (await this.checkConsensus()) {
      this.currentRound.phase = 'COMMIT';
    }
  }

  /**
   * Handle commit phase
   */
  private async handleCommitPhase(): Promise<void> {
    const consensus = await this.calculateConsensus();
    
    if (consensus.reached && consensus.approved && this.currentRound.proposedBlock) {
      this.currentRound.status = 'SUCCESS';
      this.failedRounds = 0;
      this.consecutiveTimeouts = 0;
      
      this.emit('blockCommitted', {
        roundNumber: this.currentRound.roundNumber,
        block: this.currentRound.proposedBlock,
        consensus
      });
      
      // Update validator health for successful participation
      this.updateValidatorHealthOnSuccess();
    } else {
      this.currentRound.status = 'FAILED';
      this.failedRounds++;
      this.consecutiveTimeouts++;
      
      this.emit('blockRejected', {
        roundNumber: this.currentRound.roundNumber,
        reason: consensus.reason || 'Insufficient consensus'
      });
    }

    // Store round history
    this.roundHistory.set(this.currentRound.roundNumber, this.currentRound);
    
    // Check if we need to enter recovery mode
    if (this.shouldEnterRecoveryMode()) {
      this.enterRecoveryMode();
    } else {
      this.advanceToNextRound();
    }
  }

  /**
   * Handle recovery phase
   */
  private async handleRecoveryPhase(): Promise<void> {
    // Try to recover consensus state
    const recovered = await this.attemptConsensusRecovery();
    
    if (recovered) {
      this.exitRecoveryMode();
      this.advanceToNextRound();
    } else {
      // Continue in recovery mode
      setTimeout(() => {
        this.startConsensusRound();
      }, this.config.faultTolerance.recoveryTimeout);
    }
  }

  /**
   * Handle round timeout
   */
  private handleRoundTimeout(): void {
    this.currentRound.status = 'TIMEOUT';
    this.failedRounds++;
    this.consecutiveTimeouts++;
    
    this.emit('roundTimeout', {
      roundNumber: this.currentRound.roundNumber,
      phase: this.currentRound.phase,
      consecutiveTimeouts: this.consecutiveTimeouts
    });
    
    // Mark proposer as suspicious if they timeout
    if (this.currentRound.phase === 'PROPOSAL') {
      this.handleValidatorTimeout(this.currentRound.proposer);
    }
    
    if (this.shouldEnterRecoveryMode()) {
      this.enterRecoveryMode();
    } else {
      this.advanceToNextRound();
    }
  }

  /**
   * Check if we should enter recovery mode
   */
  private shouldEnterRecoveryMode(): boolean {
    return this.failedRounds >= this.config.faultTolerance.maxFailedRounds ||
           this.consecutiveTimeouts >= 3 ||
           this.networkPartition.detected;
  }

  /**
   * Advance to next round
   */
  private advanceToNextRound(): void {
    if (this.consensusTimer) {
      clearTimeout(this.consensusTimer);
    }
    
    setTimeout(() => {
      this.startConsensusRound();
    }, 100); // Small delay between rounds
  }

  /**
   * Update validator health on successful consensus
   */
  private updateValidatorHealthOnSuccess(): void {
    for (const vote of this.currentRound.votes) {
      const health = this.validatorHealth.get(vote.validator);
      if (health) {
        health.lastSeen = Date.now();
        health.status = 'ACTIVE';
        health.consecutiveFailures = 0;
        health.successRate = Math.min(1.0, health.successRate + 0.01);
      }
    }
  }

  // Public API methods

  /**
   * Get proposer for a specific round
   * @param roundNumber - Round number
   * @returns Proposer validator ID
   */
  private getRoundProposer(roundNumber: number): string {
    const activeValidators = Array.from(this.validatorHealth.values())
      .filter(h => h.status === 'ACTIVE' || h.status === 'RECOVERING')
      .sort((a, b) => b.reputation - a.reputation) // Sort by reputation
      .map(h => h.validatorId);

    if (activeValidators.length === 0) {
      return this.config.validatorSet[0]; // Fallback
    }

    const index = roundNumber % activeValidators.length;
    return activeValidators[index];
  }

  /**
   * Check if current node is a validator
   */
  public isValidator(): boolean {
    return this.config.validatorSet.includes(this.nodeInfo.id) &&
           (this.nodeInfo.role === NodeRole.AUTHORITY || this.nodeInfo.role === NodeRole.VALIDATOR);
  }

  /**
   * Get validator health status
   */
  public getValidatorHealthStatus(): {
    total: number;
    active: number;
    suspected: number;
    failed: number;
    recovering: number;
    health: Map<string, ValidatorHealth>;
  } {
    const health = Array.from(this.validatorHealth.values());
    
    return {
      total: health.length,
      active: health.filter(h => h.status === 'ACTIVE').length,
      suspected: health.filter(h => h.status === 'SUSPECTED').length,
      failed: health.filter(h => h.status === 'FAILED').length,
      recovering: health.filter(h => h.status === 'RECOVERING').length,
      health: this.validatorHealth
    };
  }

  /**
   * Get consensus statistics
   */
  public getConsensusStats(): {
    currentRound: number;
    currentPhase: string;
    currentProposer: string;
    failedRounds: number;
    consecutiveTimeouts: number;
    recoveryMode: boolean;
    networkPartition: NetworkPartition;
    totalRounds: number;
    successRate: number;
  } {
    const totalRounds = this.roundHistory.size;
    const successfulRounds = Array.from(this.roundHistory.values())
      .filter(r => r.status === 'SUCCESS').length;
    const successRate = totalRounds > 0 ? successfulRounds / totalRounds : 0;

    return {
      currentRound: this.currentRound.roundNumber,
      currentPhase: this.currentRound.phase,
      currentProposer: this.currentRound.proposer,
      failedRounds: this.failedRounds,
      consecutiveTimeouts: this.consecutiveTimeouts,
      recoveryMode: this.recoveryMode,
      networkPartition: this.networkPartition,
      totalRounds,
      successRate
    };
  }

  // Placeholder methods (would be implemented with actual blockchain integration)
  
  private async getPendingTransactions(): Promise<Transaction[]> {
    // Implementation would get transactions from transaction pool
    return [];
  }

  private async proposeBlock(transactions: Transaction[]): Promise<Block> {
    // Implementation would create and sign a block
    return {} as Block;
  }

  private async voteOnBlock(block: Block): Promise<Vote> {
    // Implementation would validate and vote on block
    return {} as Vote;
  }

  private addVote(vote: Vote): void {
    // Implementation would add vote to current round
    this.currentRound.votes.push(vote);
  }

  private async checkConsensus(): Promise<boolean> {
    // Implementation would check if consensus reached
    return false;
  }

  private async calculateConsensus(): Promise<{ reached: boolean; approved: boolean; reason?: string }> {
    // Implementation would calculate consensus result
    return { reached: false, approved: false };
  }

  private handleProposalError(error: any): void {
    this.emit('proposalError', { roundNumber: this.currentRound.roundNumber, error });
  }

  private handleVotingError(error: any): void {
    this.emit('votingError', { roundNumber: this.currentRound.roundNumber, error });
  }

  private handleConsensusError(error: any): void {
    this.emit('consensusError', { roundNumber: this.currentRound.roundNumber, error });
  }

  private async attemptConsensusRecovery(): Promise<boolean> {
    // Implementation would attempt to recover consensus state
    return false;
  }

  public stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.consensusTimer) {
      clearTimeout(this.consensusTimer);
    }
    this.emit('consensusStopped');
  }
}
