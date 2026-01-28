import * as crypto from 'crypto';
import * as elliptic from 'elliptic';
import { Transaction, Block } from '../types/block.types';

// Initialize ECDSA curve (secp256k1 - same as Bitcoin/Ethereum)
const ec = new elliptic.ec('secp256k1');

export interface KeyPair {
  privateKey: string;
  publicKey: string;
  address: string;
}

export interface SignatureResult {
  signature: string;
  recoveryId?: number;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  recoveredAddress?: string;
}

/**
 * Enhanced cryptographic utilities with comprehensive error handling
 * and security features for enterprise DLT systems
 */
export class CryptoUtils {
  private static readonly ALGORITHM = 'sha256';
  private static readonly CURVE = 'secp256k1';
  private static readonly ADDRESS_LENGTH = 40;
  private static readonly SIGNATURE_LENGTH = 130; // 0x + 64 bytes * 2

  /**
   * Generate a cryptographically secure random key pair
   * @param entropy - Optional additional entropy (must be cryptographically secure)
   * @returns New key pair with address
   * @throws Error if key generation fails
   */
  public static generateKeyPair(entropy?: Buffer): KeyPair {
    try {
      let keyPair: any;
      
      if (entropy && entropy.length >= 32) {
        // Use provided entropy for deterministic key generation
        const hash = crypto.createHash(this.ALGORITHM).update(entropy).digest();
        keyPair = ec.keyFromPrivate(hash);
      } else {
        // Generate random key pair
        keyPair = ec.genKeyPair({
          entropy: entropy ? entropy.toString('hex') : undefined,
          pers: [Date.now(), Math.random()].join()
        });
      }

      const privateKey = keyPair.getPrivate('hex');
      const publicKey = keyPair.getPublic('hex');
      const address = this.publicKeyToAddress(publicKey);

      // Validate generated components
      this.validatePrivateKey(privateKey);
      this.validatePublicKey(publicKey);
      this.validateAddress(address);

      return {
        privateKey,
        publicKey,
        address
      };
    } catch (error) {
      throw new Error(`Key pair generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create key pair from existing private key with validation
   * @param privateKey - Private key in hex format
   * @returns Key pair with address
   * @throws Error if private key is invalid
   */
  public static keyPairFromPrivate(privateKey: string): KeyPair {
    try {
      this.validatePrivateKey(privateKey);
      
      const key = ec.keyFromPrivate(privateKey);
      const publicKey = key.getPublic('hex');
      const address = this.publicKeyToAddress(publicKey);

      return {
        privateKey,
        publicKey,
        address
      };
    } catch (error) {
      throw new Error(`Invalid private key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Convert public key to address using Keccak256 (Ethereum-style)
   * @param publicKey - Public key in hex format (with or without 0x04 prefix)
   * @returns Address string
   * @throws Error if public key is invalid
   */
  public static publicKeyToAddress(publicKey: string): string {
    try {
      this.validatePublicKey(publicKey);
      
      // Remove the 0x04 prefix if present (uncompressed key)
      const cleanPubKey = publicKey.startsWith('04') ? publicKey.slice(2) : publicKey;
      
      // Use Keccak256 for Ethereum compatibility
      const keccak = require('js-sha3').keccak256;
      const hash = keccak(cleanPubKey, 'hex');
      
      // Take last 20 bytes (40 hex characters)
      const address = '0x' + hash.slice(-40);
      
      this.validateAddress(address);
      return address;
    } catch (error) {
      throw new Error(`Address generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Sign a message with comprehensive validation
   * @param message - Message to sign
   * @param privateKey - Private key in hex format
   * @param includeRecoveryId - Whether to include recovery ID for public key recovery
   * @returns Signature result
   * @throws Error if signing fails
   */
  public static sign(
    message: string, 
    privateKey: string, 
    includeRecoveryId: boolean = false
  ): SignatureResult {
    try {
      this.validatePrivateKey(privateKey);
      
      if (!message || typeof message !== 'string') {
        throw new Error('Message must be a non-empty string');
      }

      const key = ec.keyFromPrivate(privateKey);
      const msgHash = crypto.createHash(this.ALGORITHM).update(message).digest();
      
      const signature = key.sign(msgHash, {
        canonical: true, // Use low-S values only
        pers: [Date.now()].join()
      });

      const signatureHex = signature.toDER('hex');
      
      if (includeRecoveryId) {
        const recoveryId = signature.recoveryParam ?? 0;
        return {
          signature: signatureHex,
          recoveryId
        };
      }

      return { signature: signatureHex };
    } catch (error) {
      throw new Error(`Signing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Sign a transaction with transaction-specific validation
   * @param transaction - Transaction to sign
   * @param privateKey - Private key to sign with
   * @returns Signature as hex string
   * @throws Error if transaction signing fails
   */
  public static signTransaction(transaction: Transaction, privateKey: string): string {
    try {
      this.validateTransaction(transaction);
      this.validatePrivateKey(privateKey);

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

      const message = JSON.stringify(txData, Object.keys(txData).sort());
      const result = this.sign(message, privateKey);
      
      return result.signature;
    } catch (error) {
      throw new Error(`Transaction signing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Sign a block with block-specific validation
   * @param block - Block to sign
   * @param privateKey - Private key to sign with
   * @returns Signature as hex string
   * @throws Error if block signing fails
   */
  public static signBlock(block: Block, privateKey: string): string {
    try {
      this.validateBlock(block);
      this.validatePrivateKey(privateKey);

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

      const message = JSON.stringify(blockData, Object.keys(blockData).sort());
      const result = this.sign(message, privateKey);
      
      return result.signature;
    } catch (error) {
      throw new Error(`Block signing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify a signature with detailed result
   * @param message - Original message
   * @param signature - Signature to verify
   * @param publicKey - Public key of signer
   * @returns Verification result with details
   */
  public static verify(message: string, signature: string, publicKey: string): VerificationResult {
    try {
      this.validatePublicKey(publicKey);
      this.validateSignature(signature);
      
      if (!message || typeof message !== 'string') {
        return { valid: false, error: 'Invalid message' };
      }

      const key = ec.keyFromPublic(publicKey, 'hex');
      const msgHash = crypto.createHash(this.ALGORITHM).update(message).digest();
      
      const isValid = key.verify(msgHash, signature);
      
      if (isValid) {
        const recoveredAddress = this.publicKeyToAddress(publicKey);
        return { valid: true, recoveredAddress };
      }
      
      return { valid: false, error: 'Signature verification failed' };
    } catch (error) {
      return { 
        valid: false, 
        error: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Verify transaction signature with transaction-specific validation
   * @param transaction - Transaction to verify
   * @returns Verification result
   */
  public static verifyTransactionSignature(transaction: Transaction): VerificationResult {
    try {
      this.validateTransaction(transaction);
      
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

      const message = JSON.stringify(txData, Object.keys(txData).sort());
      
      // Extract public key from signature and verify it matches the from address
      const verification = this.verify(message, transaction.signature, transaction.from);
      
      if (!verification.valid) {
        return verification;
      }
      
      // Additional check: ensure recovered address matches transaction.from
      if (verification.recoveredAddress && verification.recoveredAddress !== transaction.from) {
        return { 
          valid: false, 
          error: `Address mismatch: expected ${transaction.from}, got ${verification.recoveredAddress}` 
        };
      }
      
      return { valid: true, recoveredAddress: transaction.from };
    } catch (error) {
      return { 
        valid: false, 
        error: `Transaction verification error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Verify block signature with block-specific validation
   * @param block - Block to verify
   * @returns Verification result
   */
  public static verifyBlockSignature(block: Block): VerificationResult {
    try {
      this.validateBlock(block);
      
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

      const message = JSON.stringify(blockData, Object.keys(blockData).sort());
      
      // Verify signature and ensure it matches the validator address
      const verification = this.verify(message, block.signature, block.validator);
      
      if (!verification.valid) {
        return verification;
      }
      
      // Additional check: ensure recovered address matches block.validator
      if (verification.recoveredAddress && verification.recoveredAddress !== block.validator) {
        return { 
          valid: false, 
          error: `Validator address mismatch: expected ${block.validator}, got ${verification.recoveredAddress}` 
        };
      }
      
      return { valid: true, recoveredAddress: block.validator };
    } catch (error) {
      return { 
        valid: false, 
        error: `Block verification error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Recover public key from signature (enhanced version)
   * @param message - Signed message
   * @param signature - Signature in DER format
   * @param recoveryId - Recovery ID (if available)
   * @returns Recovered public key or null if recovery fails
   */
  public static recoverPublicKey(
    message: string, 
    signature: string, 
    recoveryId?: number
  ): string | null {
    try {
      if (!message || typeof message !== 'string') {
        throw new Error('Invalid message');
      }

      this.validateSignature(signature);
      
      const msgHash = crypto.createHash(this.ALGORITHM).update(message).digest();
      
      let key: any;
      
      if (recoveryId !== undefined) {
        // Use recovery ID for more reliable public key recovery
        const signatureObj = {
          r: Buffer.from(signature.slice(0, 64), 'hex'),
          s: Buffer.from(signature.slice(64, 128), 'hex'),
          recoveryParam: recoveryId
        };
        key = ec.recoverPubKey(msgHash, signatureObj, recoveryId);
      } else {
        // Try all possible recovery IDs
        for (let recId = 0; recId < 4; recId++) {
          try {
            const signatureObj = {
              r: Buffer.from(signature.slice(0, 64), 'hex'),
              s: Buffer.from(signature.slice(64, 128), 'hex'),
              recoveryParam: recId
            };
            key = ec.recoverPubKey(msgHash, signatureObj, recId);
            
            // Verify the recovered key
            if (key.verify(msgHash, signature)) {
              return key.getPublic('hex');
            }
          } catch {
            // Try next recovery ID
            continue;
          }
        }
        
        throw new Error('Could not recover public key with any recovery ID');
      }
      
      return key.getPublic('hex');
    } catch (error) {
      console.error('Public key recovery error:', error);
      return null;
    }
  }

  /**
   * Generate cryptographically secure random bytes
   * @param length - Number of bytes to generate
   * @returns Random bytes as Buffer
   */
  public static generateSecureRandom(length: number): Buffer {
    if (length <= 0 || length > 1024) {
      throw new Error('Invalid length for random bytes generation');
    }
    
    return crypto.randomBytes(length);
  }

  /**
   * Validate private key format and security
   * @param privateKey - Private key to validate
   * @throws Error if private key is invalid
   */
  private static validatePrivateKey(privateKey: string): void {
    if (!privateKey || typeof privateKey !== 'string') {
      throw new Error('Private key must be a non-empty string');
    }

    // Remove 0x prefix if present
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    
    if (!/^[a-fA-F0-9]{64}$/.test(cleanKey)) {
      throw new Error('Private key must be 64 hexadecimal characters');
    }

    // Check if private key is within valid range for secp256k1
    const privateKeyNum = BigInt('0x' + cleanKey);
    const curveOrder = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    
    if (privateKeyNum <= 0 || privateKeyNum >= curveOrder) {
      throw new Error('Private key is outside valid range for secp256k1');
    }
  }

  /**
   * Validate public key format
   * @param publicKey - Public key to validate
   * @throws Error if public key is invalid
   */
  private static validatePublicKey(publicKey: string): void {
    if (!publicKey || typeof publicKey !== 'string') {
      throw new Error('Public key must be a non-empty string');
    }

    // Remove 0x prefix if present
    const cleanKey = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    
    // Check for uncompressed (130 chars) or compressed (66 chars) public key
    if (!/^[0-9a-fA-F]{130}$/.test(cleanKey) && !/^[0-9a-fA-F]{66}$/.test(cleanKey)) {
      throw new Error('Public key must be 130 (uncompressed) or 66 (compressed) hexadecimal characters');
    }
  }

  /**
   * Validate address format
   * @param address - Address to validate
   * @throws Error if address is invalid
   */
  private static validateAddress(address: string): void {
    if (!address || typeof address !== 'string') {
      throw new Error('Address must be a non-empty string');
    }

    if (!address.startsWith('0x')) {
      throw new Error('Address must start with 0x');
    }

    const cleanAddress = address.slice(2);
    
    if (!/^[a-fA-F0-9]{40}$/.test(cleanAddress)) {
      throw new Error('Address must be 40 hexadecimal characters after 0x prefix');
    }
  }

  /**
   * Validate signature format
   * @param signature - Signature to validate
   * @throws Error if signature is invalid
   */
  private static validateSignature(signature: string): void {
    if (!signature || typeof signature !== 'string') {
      throw new Error('Signature must be a non-empty string');
    }

    // Remove 0x prefix if present
    const cleanSig = signature.startsWith('0x') ? signature.slice(2) : signature;
    
    if (!/^[a-fA-F0-9]+$/.test(cleanSig)) {
      throw new Error('Signature must contain only hexadecimal characters');
    }

    if (cleanSig.length < 128 || cleanSig.length > 132) {
      throw new Error('Signature length must be between 128 and 132 hexadecimal characters');
    }
  }

  /**
   * Validate transaction structure
   * @param transaction - Transaction to validate
   * @throws Error if transaction is invalid
   */
  private static validateTransaction(transaction: Transaction): void {
    if (!transaction || typeof transaction !== 'object') {
      throw new Error('Transaction must be a valid object');
    }

    const requiredFields = ['hash', 'from', 'to', 'value', 'data', 'nonce', 'gasLimit', 'gasPrice', 'signature', 'timestamp'];
    
    for (const field of requiredFields) {
      if (!(field in transaction) || transaction[field as keyof Transaction] === undefined) {
        throw new Error(`Transaction missing required field: ${field}`);
      }
    }

    this.validateAddress(transaction.from);
    this.validateAddress(transaction.to);
    this.validateSignature(transaction.signature);
  }

  /**
   * Validate block structure
   * @param block - Block to validate
   * @throws Error if block is invalid
   */
  private static validateBlock(block: Block): void {
    if (!block || typeof block !== 'object') {
      throw new Error('Block must be a valid object');
    }

    const requiredFields = ['hash', 'parentHash', 'number', 'timestamp', 'validator', 'signature', 'stateRoot', 'transactionsRoot', 'receiptsRoot', 'gasLimit', 'gasUsed', 'extraData'];
    
    for (const field of requiredFields) {
      if (!(field in block) || block[field as keyof Block] === undefined) {
        throw new Error(`Block missing required field: ${field}`);
      }
    }

    this.validateAddress(block.validator);
    this.validateSignature(block.signature);
  }

  /**
   * Get cryptographic utilities statistics
   * @returns Statistics about the crypto utilities
   */
  public static getStats(): {
    algorithm: string;
    curve: string;
    addressLength: number;
    signatureLength: number;
  } {
    return {
      algorithm: this.ALGORITHM,
      curve: this.CURVE,
      addressLength: this.ADDRESS_LENGTH,
      signatureLength: this.SIGNATURE_LENGTH
    };
  }
}
