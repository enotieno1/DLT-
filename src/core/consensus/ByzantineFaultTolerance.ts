import { Block, Transaction } from '../types/block.types';
import { Vote, ValidatorHealth } from './FaultTolerantConsensus';
import { CryptoUtils } from '../crypto';
import { EventEmitter } from 'events';

export interface ByzantineConfig {
  maxFaultyValidators: number;
  accusationThreshold: number;
  evidenceTimeout: number;
  punishmentDuration: number;
  slashingConditions: {
    doubleSigning: boolean;
    invalidBlock: boolean;
    nonParticipation: boolean;
  };
}

export interface Accusation {
  accuserId: string;
  accusedId: string;
  type: 'DOUBLE_SIGNING' | 'INVALID_BLOCK' | 'NON_PARTICIPATION' | 'EQUIVOCATION';
  evidence: any;
  timestamp: number;
  roundNumber: number;
  signature: string;
}

export interface Evidence {
  type: string;
  data: any;
  timestamp: number;
  validatorSignature: string;
  blockHash?: string;
  roundNumber?: number;
}

export interface SlashingRecord {
  validatorId: string;
  offense: string;
  evidence: Evidence;
  timestamp: number;
  slashAmount: number;
  jailedUntil: number;
}

/**
 * Byzantine Fault Tolerance implementation
 * Handles malicious validator detection and punishment
 */
export class ByzantineFaultTolerance extends EventEmitter {
  private config: ByzantineConfig;
  private nodeInfo: any;
  private privateKey: string;
  
  // Byzantine state
  private accusations: Map<string, Accusation[]> = new Map();
  private evidence: Map<string, Evidence[]> = new Map();
  private slashingRecords: Map<string, SlashingRecord[]> = new Map();
  private jailedValidators: Map<string, number> = new Map();
  
  // Reputation system
  private validatorReputation: Map<string, number> = new Map();
  private behaviorHistory: Map<string, any[]> = new Map();

  constructor(config: ByzantineConfig, nodeInfo: any, privateKey: string) {
    super();
    this.config = config;
    this.nodeInfo = nodeInfo;
    this.privateKey = privateKey;
  }

  /**
   * Detect double signing by a validator
   * @param validatorId - Validator to check
   * @param blockHash - Block hash
   * @param signature - Signature to verify
   * @param roundNumber - Consensus round
   * @returns True if double signing detected
   */
  public detectDoubleSigning(
    validatorId: string, 
    blockHash: string, 
    signature: string, 
    roundNumber: number
  ): boolean {
    const key = `${validatorId}:${roundNumber}`;
    const existingSignatures = this.evidence.get(key) || [];
    
    // Check if validator already signed a different block for this round
    const conflictingSignature = existingSignatures.find(e => 
      e.type === 'BLOCK_SIGNATURE' && e.blockHash !== blockHash
    );
    
    if (conflictingSignature) {
      this.createAccusation({
        accuserId: this.nodeInfo.id,
        accusedId: validatorId,
        type: 'DOUBLE_SIGNING',
        evidence: {
          originalSignature: conflictingSignature,
          conflictingSignature: signature,
          roundNumber
        },
        timestamp: Date.now(),
        roundNumber,
        signature: this.signAccusation(validatorId, 'DOUBLE_SIGNING', roundNumber)
      });
      
      return true;
    }
    
    // Record this signature
    this.recordEvidence(validatorId, {
      type: 'BLOCK_SIGNATURE',
      data: { blockHash, signature },
      timestamp: Date.now(),
      validatorSignature: signature,
      blockHash,
      roundNumber
    });
    
    return false;
  }

  /**
   * Detect invalid block proposal
   * @param block - Block to validate
   * @param validatorId - Proposer validator
   * @param roundNumber - Consensus round
   * @returns True if block is invalid
   */
  public detectInvalidBlock(
    block: Block, 
    validatorId: string, 
    roundNumber: number
  ): boolean {
    const violations = this.validateBlockByzantine(block);
    
    if (violations.length > 0) {
      this.createAccusation({
        accuserId: this.nodeInfo.id,
        accusedId: validatorId,
        type: 'INVALID_BLOCK',
        evidence: {
          blockHash: block.hash,
          violations,
          roundNumber
        },
        timestamp: Date.now(),
        roundNumber,
        signature: this.signAccusation(validatorId, 'INVALID_BLOCK', roundNumber)
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Detect non-participation in consensus
   * @param validatorId - Validator to check
   * @param roundNumber - Consensus round
   * @param expectedVotes - Expected number of votes
   * @param actualVotes - Actual number of votes
   * @returns True if non-participation detected
   */
  public detectNonParticipation(
    validatorId: string,
    roundNumber: number,
    expectedVotes: number,
    actualVotes: number
  ): boolean {
    const participationRate = actualVotes / expectedVotes;
    
    if (participationRate < 0.5) { // Less than 50% participation
      this.createAccusation({
        accuserId: this.nodeInfo.id,
        accusedId: validatorId,
        type: 'NON_PARTICIPATION',
        evidence: {
          participationRate,
          expectedVotes,
          actualVotes,
          roundNumber
        },
        timestamp: Date.now(),
        roundNumber,
        signature: this.signAccusation(validatorId, 'NON_PARTICIPATION', roundNumber)
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Create and record an accusation
   * @param accusation - Accusation details
   */
  private createAccusation(accusation: Accusation): void {
    if (!this.accusations.has(accusation.accusedId)) {
      this.accusations.set(accusation.accusedId, []);
    }
    
    this.accusations.get(accusation.accusedId)!.push(accusation);
    
    this.emit('accusationCreated', {
      accusedId: accusation.accusedId,
      type: accusation.type,
      roundNumber: accusation.roundNumber
    });
    
    // Check if we have enough accusations to slash
    this.checkSlashingConditions(accusation.accusedId);
  }

  /**
   * Record evidence for a validator
   * @param validatorId - Validator ID
   * @param evidence - Evidence to record
   */
  private recordEvidence(validatorId: string, evidence: Evidence): void {
    if (!this.evidence.has(validatorId)) {
      this.evidence.set(validatorId, []);
    }
    
    this.evidence.get(validatorId)!.push(evidence);
  }

  /**
   * Check if slashing conditions are met
   * @param validatorId - Validator to check
   */
  private checkSlashingConditions(validatorId: string): void {
    const accusations = this.accusations.get(validatorId) || [];
    const recentAccusations = accusations.filter(a => 
      Date.now() - a.timestamp < this.config.evidenceTimeout
    );
    
    if (recentAccusations.length >= this.config.accusationThreshold) {
      this.slashValidator(validatorId, recentAccusations);
    }
  }

  /**
   * Slash a validator for misbehavior
   * @param validatorId - Validator to slash
   * @param accusations - Accusations leading to slashing
   */
  private slashValidator(validatorId: string, accusations: Accusation[]): void {
    const slashAmount = this.calculateSlashAmount(accusations);
    const jailTime = Date.now() + this.config.punishmentDuration;
    
    const slashingRecord: SlashingRecord = {
      validatorId,
      offense: accusations[0].type,
      evidence: accusations[0].evidence,
      timestamp: Date.now(),
      slashAmount,
      jailedUntil: jailTime
    };
    
    if (!this.slashingRecords.has(validatorId)) {
      this.slashingRecords.set(validatorId, []);
    }
    
    this.slashingRecords.get(validatorId)!.push(slashingRecord);
    this.jailedValidators.set(validatorId, jailTime);
    
    // Update reputation
    const currentReputation = this.validatorReputation.get(validatorId) || 100;
    this.validatorReputation.set(validatorId, Math.max(0, currentReputation - slashAmount));
    
    this.emit('validatorSlashed', {
      validatorId,
      slashAmount,
      jailedUntil: jailTime,
      offenses: accusations.length
    });
  }

  /**
   * Calculate slash amount based on offenses
   * @param accusations - List of accusations
   * @returns Slash amount (0-100)
   */
  private calculateSlashAmount(accusations: Accusation[]): number {
    let slashAmount = 0;
    
    for (const accusation of accusations) {
      switch (accusation.type) {
        case 'DOUBLE_SIGNING':
          slashAmount += 50; // Severe offense
          break;
        case 'INVALID_BLOCK':
          slashAmount += 30; // Medium offense
          break;
        case 'NON_PARTICIPATION':
          slashAmount += 10; // Minor offense
          break;
        case 'EQUIVOCATION':
          slashAmount += 40; // Serious offense
          break;
      }
    }
    
    return Math.min(100, slashAmount);
  }

  /**
   * Validate block for Byzantine behavior
   * @param block - Block to validate
   * @returns Array of violations found
   */
  private validateBlockByzantine(block: Block): string[] {
    const violations: string[] = [];
    
    // Check block structure
    if (!block.hash || !block.parentHash || !block.validator) {
      violations.push('INVALID_BLOCK_STRUCTURE');
    }
    
    // Check for invalid state transitions
    if (this.hasInvalidStateTransition(block)) {
      violations.push('INVALID_STATE_TRANSITION');
    }
    
    // Check for invalid transactions
    if (this.hasInvalidTransactions(block)) {
      violations.push('INVALID_TRANSACTIONS');
    }
    
    // Check for signature manipulation
    if (this.hasSignatureManipulation(block)) {
      violations.push('SIGNATURE_MANIPULATION');
    }
    
    return violations;
  }

  /**
   * Check if block has invalid state transitions
   * @param block - Block to check
   * @returns True if invalid state transitions found
   */
  private hasInvalidStateTransition(block: Block): boolean {
    // Implementation would verify state transitions
    // For now, return false (no invalid transitions detected)
    return false;
  }

  /**
   * Check if block has invalid transactions
   * @param block - Block to check
   * @returns True if invalid transactions found
   */
  private hasInvalidTransactions(block: Block): boolean {
    // Implementation would verify all transactions in block
    // For now, return false (all transactions valid)
    return false;
  }

  /**
   * Check if block has signature manipulation
   * @param block - Block to check
   * @returns True if signature manipulation detected
   */
  private hasSignatureManipulation(block: Block): boolean {
    try {
      // Verify block signature
      const verification = CryptoUtils.verifyBlockSignature(block);
      return !verification.valid;
    } catch (error) {
      return true; // Assume manipulation if verification fails
    }
  }

  /**
   * Sign an accusation
   * @param accusedId - Accused validator
   * @param type - Accusation type
   * @param roundNumber - Round number
   * @returns Signature
   */
  private signAccusation(accusedId: string, type: string, roundNumber: number): string {
    const message = `${accusedId}:${type}:${roundNumber}:${Date.now()}`;
    return CryptoUtils.sign(message, this.privateKey).signature;
  }

  /**
   * Verify accusation signature
   * @param accusation - Accusation to verify
   * @returns True if signature is valid
   */
  public verifyAccusationSignature(accusation: Accusation): boolean {
    try {
      const message = `${accusation.accusedId}:${accusation.type}:${accusation.roundNumber}:${accusation.timestamp}`;
      return CryptoUtils.verify(message, accusation.signature, accusation.accuserId).valid;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if validator is jailed
   * @param validatorId - Validator to check
   * @returns True if validator is jailed
   */
  public isValidatorJailed(validatorId: string): boolean {
    const jailTime = this.jailedValidators.get(validatorId);
    return jailTime ? Date.now() < jailTime : false;
  }

  /**
   * Get validator reputation
   * @param validatorId - Validator ID
   * @returns Reputation score (0-100)
   */
  public getValidatorReputation(validatorId: string): number {
    return this.validatorReputation.get(validatorId) || 100;
  }

  /**
   * Get all accusations against a validator
   * @param validatorId - Validator ID
   * @returns Array of accusations
   */
  public getValidatorAccusations(validatorId: string): Accusation[] {
    return this.accusations.get(validatorId) || [];
  }

  /**
   * Get slashing history for a validator
   * @param validatorId - Validator ID
   * @returns Array of slashing records
   */
  public getValidatorSlashingHistory(validatorId: string): SlashingRecord[] {
    return this.slashingRecords.get(validatorId) || [];
  }

  /**
   * Get all jailed validators
   * @returns Array of jailed validator IDs
   */
  public getJailedValidators(): string[] {
    const now = Date.now();
    const jailed: string[] = [];
    
    for (const [validatorId, jailTime] of this.jailedValidators.entries()) {
      if (now < jailTime) {
        jailed.push(validatorId);
      }
    }
    
    return jailed;
  }

  /**
   * Release validators from jail if their time is up
   */
  public releaseJailedValidators(): string[] {
    const now = Date.now();
    const released: string[] = [];
    
    for (const [validatorId, jailTime] of this.jailedValidators.entries()) {
      if (now >= jailTime) {
        this.jailedValidators.delete(validatorId);
        released.push(validatorId);
        
        this.emit('validatorReleased', {
          validatorId,
          releasedAt: now
        });
      }
    }
    
    return released;
  }

  /**
   * Get Byzantine fault tolerance statistics
   * @returns Statistics object
   */
  public getByzantineStats(): {
    totalAccusations: number;
    totalSlashings: number;
    currentlyJailed: number;
    averageReputation: number;
    offensesByType: Record<string, number>;
  } {
    let totalAccusations = 0;
    let totalSlashings = 0;
    let reputationSum = 0;
    let reputationCount = 0;
    const offensesByType: Record<string, number> = {};

    // Count accusations
    for (const accusations of this.accusations.values()) {
      totalAccusations += accusations.length;
      for (const accusation of accusations) {
        offensesByType[accusation.type] = (offensesByType[accusation.type] || 0) + 1;
      }
    }

    // Count slashings
    for (const records of this.slashingRecords.values()) {
      totalSlashings += records.length;
    }

    // Calculate average reputation
    for (const reputation of this.validatorReputation.values()) {
      reputationSum += reputation;
      reputationCount++;
    }

    const averageReputation = reputationCount > 0 ? reputationSum / reputationCount : 100;

    return {
      totalAccusations,
      totalSlashings,
      currentlyJailed: this.getJailedValidators().length,
      averageReputation,
      offensesByType
    };
  }

  /**
   * Clean up old evidence and accusations
   * @param maxAge - Maximum age in milliseconds
   */
  public cleanupOldEvidence(maxAge: number = 7 * 24 * 60 * 60 * 1000): void { // 7 days default
    const cutoffTime = Date.now() - maxAge;
    
    // Clean up old accusations
    for (const [validatorId, accusations] of this.accusations.entries()) {
      const recent = accusations.filter(a => a.timestamp > cutoffTime);
      if (recent.length === 0) {
        this.accusations.delete(validatorId);
      } else {
        this.accusations.set(validatorId, recent);
      }
    }
    
    // Clean up old evidence
    for (const [validatorId, evidence] of this.evidence.entries()) {
      const recent = evidence.filter(e => e.timestamp > cutoffTime);
      if (recent.length === 0) {
        this.evidence.delete(validatorId);
      } else {
        this.evidence.set(validatorId, recent);
      }
    }
    
    this.emit('evidenceCleanup', {
      maxAge,
      cutoffTime
    });
  }

  /**
   * Reset validator reputation (for testing or admin purposes)
   * @param validatorId - Validator ID
   */
  public resetValidatorReputation(validatorId: string): void {
    this.validatorReputation.set(validatorId, 100);
    this.accusations.delete(validatorId);
    this.jailedValidators.delete(validatorId);
    
    this.emit('validatorReputationReset', {
      validatorId,
      newReputation: 100
    });
  }
}
