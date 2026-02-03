import * as elliptic from 'elliptic';
import { Transaction, Block } from '../types/block.types';

// Initialize ECDSA curve (secp256k1 - same as Bitcoin/Ethereum)
const ec = new elliptic.ec('secp256k1');

export interface KeyPair {
  privateKey: string;
  publicKey: string;
  address: string;
}

/**
 * Digital signature utilities using ECDSA (secp256k1)
 */
export class SignatureUtils {
  /**
   * Generate a new key pair for the node
   * @returns New key pair with address
   */
  public static generateKeyPair(): KeyPair {
    const keyPair = ec.genKeyPair();
    const privateKey = keyPair.getPrivate('hex');
    const publicKey = keyPair.getPublic('hex');
    const address = this.publicKeyToAddress(publicKey);

    return {
      privateKey,
      publicKey,
      address
    };
  }

  /**
   * Create key pair from private key
   * @param privateKey - Private key in hex format
   * @returns Key pair with address
   */
  public static keyPairFromPrivate(privateKey: string): KeyPair {
    const key = ec.keyFromPrivate(privateKey);
    const publicKey = key.getPublic('hex');
    const address = this.publicKeyToAddress(publicKey);

    return {
      privateKey,
      publicKey,
      address
    };
  }

  /**
   * Convert public key to address (last 20 bytes of Keccak256 hash)
   * @param publicKey - Public key in hex format
   * @returns Address string
   */
  public static publicKeyToAddress(publicKey: string): string {
    // Remove the 0x04 prefix if present
    const cleanPubKey = publicKey.startsWith('04') ? publicKey.slice(2) : publicKey;
    
    // For simplicity, we'll use SHA-256 instead of Keccak256
    // In production, you'd want to use Keccak256 for Ethereum compatibility
    const hash = require('crypto').createHash('sha256').update(cleanPubKey, 'hex').digest();
    
    // Take last 20 bytes (40 hex characters)
    return '0x' + hash.slice(-20).toString('hex');
  }

  /**
   * Sign a message with private key
   * @param message - Message to sign
   * @param privateKey - Private key in hex format
   * @returns Signature object
   */
  public static sign(message: string, privateKey: string): elliptic.Signature {
    const key = ec.keyFromPrivate(privateKey);
    const msgHash = require('crypto').createHash('sha256').update(message).digest();
    
    return key.sign(msgHash);
  }

  /**
   * Sign a transaction
   * @param transaction - Transaction to sign
   * @param privateKey - Private key to sign with
   * @returns Signature as hex string
   */
  public static signTransaction(transaction: Transaction, privateKey: string): string {
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

    const message = JSON.stringify(txData);
    const signature = this.sign(message, privateKey);
    
    // Convert signature to DER format and then to hex
    return signature.toDER('hex');
  }

  /**
   * Sign a block
   * @param block - Block to sign
   * @param privateKey - Private key to sign with
   * @returns Signature as hex string
   */
  public static signBlock(block: Block, privateKey: string): string {
    const blockData = {
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

    const message = JSON.stringify(blockData);
    const signature = this.sign(message, privateKey);
    
    return signature.toDER('hex');
  }

  /**
   * Verify a signature
   * @param message - Original message
   * @param signature - Signature to verify
   * @param publicKey - Public key of signer
   * @returns True if signature is valid
   */
  public static verify(message: string, signature: string, publicKey: string): boolean {
    try {
      const key = ec.keyFromPublic(publicKey, 'hex');
      const msgHash = require('crypto').createHash('sha256').update(message).digest();
      
      return key.verify(msgHash, signature);
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }

  /**
   * Verify transaction signature
   * @param transaction - Transaction to verify
   * @returns True if signature is valid
   */
  public static verifyTransactionSignature(transaction: Transaction): boolean {
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

    const message = JSON.stringify(txData);
    
    // Extract public key from signature (in a real implementation, you'd recover the public key)
    // For simplicity, we'll verify with the from address as public key
    // In production, you'd need to implement proper public key recovery
    
    return this.verify(message, transaction.signature, transaction.from);
  }

  /**
   * Verify block signature
   * @param block - Block to verify
   * @returns True if signature is valid
   */
  public static verifyBlockSignature(block: Block): boolean {
    const blockData = {
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

    const message = JSON.stringify(blockData);
    
    return this.verify(message, block.signature, block.validator);
  }

  /**
   * Recover public key from signature (simplified version)
   * @param message - Signed message
   * @param signature - Signature
   * @returns Recovered public key
   */
  public static recoverPublicKey(message: string, signature: string): string | null {
    try {
      const msgHash = require('crypto').createHash('sha256').update(message).digest();
      const key = ec.recoverPubKey(msgHash, signature);
      return key.getPublic('hex');
    } catch (error) {
      console.error('Public key recovery error:', error);
      return null;
    }
  }
}
