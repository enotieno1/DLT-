import { Block } from './Block';
import { Transaction } from './Transaction';
import { NodeConfig, NodeRole } from './Node';
import { CryptoUtils } from '../crypto/CryptoUtils';

export class Validator {
  private config: NodeConfig;

  constructor(config: NodeConfig) {
    this.config = config;
  }

  public async validateTransaction(transaction: Transaction): Promise<boolean> {
    try {
      // Check if transaction has required fields
      if (!transaction.from || !transaction.to || transaction.amount <= 0) {
        return false;
      }

      // Check if transaction is properly signed
      if (!transaction.isValid()) {
        return false;
      }

      // Check for duplicate transactions
      // In a real implementation, this would check against the blockchain
      // For now, we'll assume it's valid if basic checks pass

      // Check if sender has sufficient balance
      // This would require querying the blockchain state
      // For now, we'll skip this check

      return true;
    } catch (error) {
      console.error('Error validating transaction:', error);
      return false;
    }
  }

  public async validateBlock(block: Block, previousBlock: Block): Promise<boolean> {
    try {
      // Check if block index is correct
      if (block.index !== previousBlock.index + 1) {
        return false;
      }

      // Check if previous hash is correct
      if (block.previousHash !== previousBlock.hash) {
        return false;
      }

      // Check if block hash is valid
      if (block.hash !== block.calculateHash()) {
        return false;
      }

      // Check if all transactions are valid
      if (!block.hasValidTransactions()) {
        return false;
      }

      // Check if block timestamp is reasonable
      const currentTime = Date.now();
      if (block.timestamp > currentTime + 60000) { // Allow 1 minute future
        return false;
      }

      // Check if validator is authorized
      if (!this.isAuthorizedValidator(block.validator)) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error validating block:', error);
      return false;
    }
  }

  private isAuthorizedValidator(validatorId: string): boolean {
    // Check if the validator is in the authorized validator set
    return this.config.validatorSet.includes(validatorId);
  }

  public async validateChain(chain: Block[]): Promise<boolean> {
    try {
      // Check if chain has at least genesis block
      if (chain.length === 0) {
        return false;
      }

      // Validate genesis block
      const genesisBlock = chain[0];
      if (genesisBlock.index !== 0 || genesisBlock.previousHash !== '0') {
        return false;
      }

      // Validate each block in sequence
      for (let i = 1; i < chain.length; i++) {
        const currentBlock = chain[i];
        const previousBlock = chain[i - 1];

        if (!await this.validateBlock(currentBlock, previousBlock)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error validating chain:', error);
      return false;
    }
  }

  public canValidate(): boolean {
    // Only authority and validator nodes can validate
    return this.config.role === NodeRole.AUTHORITY || 
           this.config.role === NodeRole.VALIDATOR;
  }

  public canCreateBlocks(): boolean {
    // Only validator nodes can create blocks
    return this.config.role === NodeRole.VALIDATOR;
  }

  public canAddValidators(): boolean {
    // Only authority nodes can add/remove validators
    return this.config.role === NodeRole.AUTHORITY;
  }

  public getValidatorSet(): string[] {
    return [...this.config.validatorSet];
  }

  public addToValidatorSet(validatorId: string): boolean {
    if (!this.canAddValidators()) {
      return false;
    }

    if (!this.config.validatorSet.includes(validatorId)) {
      this.config.validatorSet.push(validatorId);
      return true;
    }

    return false;
  }

  public removeFromValidatorSet(validatorId: string): boolean {
    if (!this.canAddValidators()) {
      return false;
    }

    const index = this.config.validatorSet.indexOf(validatorId);
    if (index > -1) {
      this.config.validatorSet.splice(index, 1);
      return true;
    }

    return false;
  }
}
