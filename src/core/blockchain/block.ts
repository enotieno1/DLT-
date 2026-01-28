import { Block, BlockHeader, Transaction } from '../types/block.types';
import { createHash } from 'crypto';

export class BlockBuilder {
  private block: Partial<Block> = {};

  constructor(parentHash: string, number: number, validator: string) {
    this.block.parentHash = parentHash;
    this.block.number = number;
    this.block.validator = validator;
    this.block.timestamp = Date.now();
    this.block.transactions = [];
    this.block.gasUsed = '0';
  }

  addTransaction(transaction: Transaction): void {
    this.block.transactions!.push(transaction);
  }

  setGasLimit(limit: string): void {
    this.block.gasLimit = limit;
  }

  setExtraData(data: string): void {
    this.block.extraData = data;
  }

  build(): Block {
    if (!this.block.transactions || !this.block.gasLimit) {
      throw new Error('Missing required block fields');
    }

    const transactionsRoot = this.calculateTransactionsRoot();
    const receiptsRoot = this.calculateReceiptsRoot();
    const stateRoot = this.calculateStateRoot();

    const header: BlockHeader = {
      parentHash: this.block.parentHash!,
      number: this.block.number!,
      timestamp: this.block.timestamp!,
      validator: this.block.validator!,
      stateRoot,
      transactionsRoot,
      receiptsRoot,
      gasLimit: this.block.gasLimit,
      gasUsed: this.block.gasUsed!,
      extraData: this.block.extraData || ''
    };

    const hash = this.calculateBlockHash(header);
    
    return {
      ...header,
      hash,
      transactions: this.block.transactions,
      signature: '', // Will be added by validator
      stateRoot,
      transactionsRoot,
      receiptsRoot,
      gasLimit: this.block.gasLimit,
      gasUsed: this.block.gasUsed!,
      extraData: this.block.extraData || ''
    };
  }

  private calculateTransactionsRoot(): string {
    if (!this.block.transactions || this.block.transactions.length === 0) {
      return createHash('sha256').digest('hex');
    }

    const transactionHashes = this.block.transactions.map(tx => tx.hash);
    return this.merkleRoot(transactionHashes);
  }

  private calculateReceiptsRoot(): string {
    // Simplified - in production would calculate actual receipt hashes
    return createHash('sha256').digest('hex');
  }

  private calculateStateRoot(): string {
    // Simplified - in production would calculate actual state root
    return createHash('sha256').digest('hex');
  }

  private calculateBlockHash(header: BlockHeader): string {
    const data = [
      header.parentHash,
      header.number.toString(),
      header.timestamp.toString(),
      header.validator,
      header.stateRoot,
      header.transactionsRoot,
      header.receiptsRoot,
      header.gasLimit,
      header.gasUsed,
      header.extraData
    ].join('');

    return createHash('sha256').update(data).digest('hex');
  }

  public static calculateBlockHashStatic(header: BlockHeader): string {
    const data = [
      header.parentHash,
      header.number.toString(),
      header.timestamp.toString(),
      header.validator,
      header.stateRoot,
      header.transactionsRoot,
      header.receiptsRoot,
      header.gasLimit,
      header.gasUsed,
      header.extraData
    ].join('');

    return createHash('sha256').update(data).digest('hex');
  }

  private merkleRoot(hashes: string[]): string {
    if (hashes.length === 0) {
      return createHash('sha256').digest('hex');
    }
    if (hashes.length === 1) {
      return hashes[0] || '';
    }

    const nextLevel: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] || hashes[i]; // Duplicate last if odd
      const combined = (left || '') + (right || '');
      nextLevel.push(createHash('sha256').update(combined).digest('hex'));
    }

    return this.merkleRoot(nextLevel);
  }
}

export function validateBlock(block: Block): boolean {
  // Basic validation
  if (!block.hash || !block.parentHash || !block.validator) {
    return false;
  }

  if (block.number < 0 || block.timestamp <= 0) {
    return false;
  }

  if (!block.transactions || !Array.isArray(block.transactions)) {
    return false;
  }

  // Validate transactions
  for (const tx of block.transactions) {
    if (!tx.hash || !tx.from || !tx.signature) {
      return false;
    }
  }

  // Recalculate hash and verify
  const header: BlockHeader = {
    parentHash: block.parentHash,
    number: block.number,
    timestamp: block.timestamp,
    validator: block.validator,
    stateRoot: block.stateRoot,
    transactionsRoot: block.transactionsRoot,
    receiptsRoot: block.receiptsRoot,
    gasLimit: block.gasLimit,
    gasUsed: block.gasUsed,
    extraData: block.extraData
  };

  const calculatedHash = BlockBuilder.calculateBlockHashStatic(header);
  return calculatedHash === block.hash;
}
