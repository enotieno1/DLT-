import { createHash } from 'crypto';
import { Transaction, Block, BlockHeader } from '../types/block.types';

/**
 * Cryptographic hash utilities for the DLT system
 * Uses SHA-256 for all hashing operations
 */
export class HashUtils {
  /**
   * Compute SHA-256 hash of data
   * @param data - Data to hash (string or Buffer)
   * @returns Hexadecimal hash string
   */
  public static hash(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Compute hash of a transaction
   * @param transaction - Transaction object
   * @returns Transaction hash
   */
  public static hashTransaction(transaction: Transaction): string {
    const txData = {
      from: transaction.from,
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      nonce: transaction.nonce,
      gasLimit: transaction.gasLimit,
      gasPrice: transaction.gasPrice,
      timestamp: transaction.timestamp
    };
    
    return this.hash(JSON.stringify(txData));
  }

  /**
   * Compute hash of a block header
   * @param header - Block header object
   * @returns Block header hash
   */
  public static hashBlockHeader(header: BlockHeader): string {
    const headerData = {
      parentHash: header.parentHash,
      number: header.number,
      timestamp: header.timestamp,
      validator: header.validator,
      stateRoot: header.stateRoot,
      transactionsRoot: header.transactionsRoot,
      receiptsRoot: header.receiptsRoot,
      gasLimit: header.gasLimit,
      gasUsed: header.gasUsed,
      extraData: header.extraData
    };
    
    return this.hash(JSON.stringify(headerData));
  }

  /**
   * Compute hash of a complete block
   * @param block - Block object
   * @returns Block hash
   */
  public static hashBlock(block: Block): string {
    return this.hashBlockHeader({
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
    });
  }

  /**
   * Compute Merkle root of transaction hashes
   * @param transactions - Array of transactions
   * @returns Merkle root hash
   */
  public static computeMerkleRoot(transactions: Transaction[]): string {
    if (transactions.length === 0) {
      return this.hash('');
    }

    const txHashes = transactions.map(tx => tx.hash);
    return this.merkleRoot(txHashes);
  }

  /**
   * Recursive Merkle root computation
   * @param hashes - Array of hashes
   * @returns Merkle root
   */
  private static merkleRoot(hashes: string[]): string {
    if (hashes.length === 1) {
      return hashes[0];
    }

    const nextLevel: string[] = [];
    
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = i + 1 < hashes.length ? hashes[i + 1] : hashes[i];
      nextLevel.push(this.hash(left + right));
    }

    return this.merkleRoot(nextLevel);
  }

  /**
   * Verify if data matches expected hash
   * @param data - Original data
   * @param expectedHash - Expected hash to verify against
   * @returns True if hash matches
   */
  public static verifyHash(data: string | Buffer, expectedHash: string): boolean {
    return this.hash(data) === expectedHash;
  }

  /**
   * Generate a random hash (for testing purposes)
   * @returns Random hash string
   */
  public static generateRandomHash(): string {
    return this.hash(Date.now().toString() + Math.random().toString());
  }
}
