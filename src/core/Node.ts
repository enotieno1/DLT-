import { EventEmitter } from 'events';
import { Block } from './Block';
import { Transaction } from './Transaction';
import { Validator } from './Validator';
import { NetworkManager } from '../network/NetworkManager';
import { ConsensusEngine } from '../consensus/ConsensusEngine';
import { CryptoUtils } from '../crypto/CryptoUtils';

export enum NodeRole {
  AUTHORITY = 'authority',
  VALIDATOR = 'validator',
  PEER = 'peer'
}

export interface NodeConfig {
  id: string;
  address: string;
  port: number;
  role: NodeRole;
  validatorSet: string[];
}

export class DLTNode extends EventEmitter {
  private config: NodeConfig;
  private blockchain: Block[];
  private pendingTransactions: Transaction[];
  private networkManager: NetworkManager;
  private consensusEngine: ConsensusEngine;
  private validator: Validator;
  private isRunning: boolean = false;

  constructor() {
    super();
    this.config = this.loadConfig();
    this.blockchain = [];
    this.pendingTransactions = [];
    this.networkManager = new NetworkManager(this.config);
    this.consensusEngine = new ConsensusEngine(this.config);
    this.validator = new Validator(this.config);
    
    // Initialize with genesis block
    this.createGenesisBlock();
  }

  private loadConfig(): NodeConfig {
    return {
      id: process.env.NODE_ID || 'node-1',
      address: process.env.NODE_ADDRESS || 'localhost',
      port: parseInt(process.env.NODE_PORT || '3000'),
      role: (process.env.NODE_ROLE as NodeRole) || NodeRole.PEER,
      validatorSet: (process.env.VALIDATOR_SET || '').split(',').filter(v => v.trim())
    };
  }

  private createGenesisBlock(): void {
    const genesisBlock = new Block(
      0,
      '0',
      [],
      Date.now(),
      'genesis-hash'
    );
    this.blockchain.push(genesisBlock);
    console.log('🌱 Genesis block created');
  }

  public async initialize(): Promise<void> {
    try {
      await this.networkManager.initialize();
      await this.consensusEngine.initialize();
      
      this.setupEventHandlers();
      this.isRunning = true;
      
      this.emit('node:initialized', this.config);
    } catch (error) {
      throw new Error(`Failed to initialize node: ${error}`);
    }
  }

  private setupEventHandlers(): void {
    this.networkManager.on('transaction:received', (transaction: Transaction) => {
      this.handleReceivedTransaction(transaction);
    });

    this.networkManager.on('block:received', (block: Block) => {
      this.handleReceivedBlock(block);
    });

    this.consensusEngine.on('consensus:achieved', (block: Block) => {
      this.addBlockToChain(block);
    });
  }

  private async handleReceivedTransaction(transaction: Transaction): Promise<void> {
    try {
      // Validate transaction
      if (await this.validator.validateTransaction(transaction)) {
        this.pendingTransactions.push(transaction);
        this.emit('transaction:validated', transaction);
        
        // If this node is a validator, start consensus process
        if (this.config.role === NodeRole.VALIDATOR || this.config.role === NodeRole.AUTHORITY) {
          await this.consensusEngine.startConsensus(this.pendingTransactions);
        }
      } else {
        this.emit('transaction:invalid', transaction);
      }
    } catch (error) {
      console.error('Error handling received transaction:', error);
    }
  }

  private async handleReceivedBlock(block: Block): Promise<void> {
    try {
      // Validate block
      if (await this.validator.validateBlock(block, this.getLatestBlock())) {
        await this.consensusEngine.validateBlock(block);
      } else {
        this.emit('block:invalid', block);
      }
    } catch (error) {
      console.error('Error handling received block:', error);
    }
  }

  private addBlockToChain(block: Block): void {
    this.blockchain.push(block);
    this.pendingTransactions = this.pendingTransactions.filter(
      tx => !block.transactions.includes(tx)
    );
    
    this.emit('block:added', block);
    console.log(`📦 Block ${block.index} added to chain`);
  }

  public async submitTransaction(transaction: Transaction): Promise<void> {
    try {
      // Sign transaction with this node's private key
      const signedTransaction = await CryptoUtils.signTransaction(transaction, this.config.id);
      
      // Broadcast to network
      await this.networkManager.broadcastTransaction(signedTransaction);
      
      // Handle locally
      await this.handleReceivedTransaction(signedTransaction);
    } catch (error) {
      throw new Error(`Failed to submit transaction: ${error}`);
    }
  }

  public getLatestBlock(): Block {
    return this.blockchain[this.blockchain.length - 1];
  }

  public getBlockchain(): Block[] {
    return [...this.blockchain];
  }

  public getPendingTransactions(): Transaction[] {
    return [...this.pendingTransactions];
  }

  public getId(): string {
    return this.config.id;
  }

  public getRole(): NodeRole {
    return this.config.role;
  }

  public getConfig(): NodeConfig {
    return { ...this.config };
  }

  public async shutdown(): Promise<void> {
    this.isRunning = false;
    await this.networkManager.shutdown();
    await this.consensusEngine.shutdown();
    this.emit('node:shutdown');
  }

  public isNodeRunning(): boolean {
    return this.isRunning;
  }
}
