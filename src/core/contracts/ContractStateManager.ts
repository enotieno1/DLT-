import { EventEmitter } from 'events';
import { SmartContract, ContractState } from './SmartContract';
import { Transaction } from '../types/block.types';
import { CryptoUtils } from '../crypto';

export interface StateConfig {
  maxStorageSize: number;
  enableSnapshots: boolean;
  snapshotInterval: number;
  maxSnapshots: number;
  enableCompression: boolean;
  enableEncryption: boolean;
  encryptionKey?: string;
}

export interface StateSnapshot {
  id: string;
  contractAddress: string;
  state: ContractState;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
  size: number;
  compressed: boolean;
  encrypted: boolean;
}

export interface StateTransition {
  contractAddress: string;
  fromState: string;
  toState: string;
  functionName: string;
  args: any[];
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
  gasUsed: number;
}

export interface StateQuery {
  contractAddress: string;
  key?: string;
  fromBlock?: number;
  toBlock?: number;
  fromTimestamp?: number;
  toTimestamp?: number;
}

export interface StateDiff {
  contractAddress: string;
  added: Map<string, string>;
  modified: Map<string, { old: string; new: string }>;
  deleted: Set<string>;
  timestamp: number;
}

/**
 * Contract state management system
 * Provides persistent storage, snapshots, and state transitions tracking
 */
export class ContractStateManager extends EventEmitter {
  private config: StateConfig;
  private contractStates: Map<string, ContractState> = new Map();
  private stateSnapshots: Map<string, StateSnapshot[]> = new Map();
  private stateTransitions: StateTransition[] = [];
  private stateHistory: Map<string, Map<string, string[]>> = new Map();
  private encryptionKey: string;

  constructor(config: Partial<StateConfig> = {}) {
    super();
    
    this.config = {
      maxStorageSize: 1000000, // 1MB per contract
      enableSnapshots: true,
      snapshotInterval: 100, // Every 100 blocks
      maxSnapshots: 10,
      enableCompression: true,
      enableEncryption: false,
      ...config
    };

    this.encryptionKey = this.config.encryptionKey || this.generateEncryptionKey();
  }

  /**
   * Get contract state
   * @param contractAddress - Contract address
   * @returns Contract state or null
   */
  public getContractState(contractAddress: string): ContractState | null {
    return this.contractStates.get(contractAddress) || null;
  }

  /**
   * Update contract state
   * @param contractAddress - Contract address
   * @param newState - New contract state
   * @param transaction - Transaction that caused the change
   * @returns Success status
   */
  public updateContractState(
    contractAddress: string,
    newState: ContractState,
    transaction: Transaction
  ): boolean {
    try {
      const oldState = this.contractStates.get(contractAddress);
      
      // Validate state size
      const stateSize = this.calculateStateSize(newState);
      if (stateSize > this.config.maxStorageSize) {
        this.emit('stateError', {
          contractAddress,
          error: `State size exceeds maximum: ${stateSize} > ${this.config.maxStorageSize}`
        });
        return false;
      }

      // Create state transition record
      const transition: StateTransition = {
        contractAddress,
        fromState: oldState ? this.serializeState(oldState) : '',
        toState: this.serializeState(newState),
        functionName: 'unknown', // Would be extracted from transaction
        args: [],
        transactionHash: transaction.hash,
        blockNumber: 0, // Would be extracted from block
        timestamp: Date.now(),
        gasUsed: transaction.gasLimit || 0
      };

      // Calculate state diff
      const diff = this.calculateStateDiff(oldState, newState);

      // Update state
      this.contractStates.set(contractAddress, newState);
      this.stateTransitions.push(transition);

      // Update state history
      this.updateStateHistory(contractAddress, diff);

      // Create snapshot if needed
      if (this.config.enableSnapshots && this.shouldCreateSnapshot(contractAddress)) {
        this.createSnapshot(contractAddress, newState, transaction);
      }

      // Clean up old snapshots
      this.cleanupOldSnapshots(contractAddress);

      this.emit('stateUpdated', {
        contractAddress,
        transition,
        diff,
        stateSize
      });

      return true;
    } catch (error) {
      this.emit('stateError', {
        contractAddress,
        error: error instanceof Error ? error.message : 'State update failed'
      });
      return false;
    }
  }

  /**
   * Get contract storage value
   * @param contractAddress - Contract address
   * @param key - Storage key
   * @returns Storage value or null
   */
  public getStorageValue(contractAddress: string, key: string): string | null {
    const state = this.contractStates.get(contractAddress);
    if (!state) {
      return null;
    }

    return state.storage.get(key) || null;
  }

  /**
   * Set contract storage value
   * @param contractAddress - Contract address
   * @param key - Storage key
   * @param value - Storage value
   * @returns Success status
   */
  public setStorageValue(
    contractAddress: string,
    key: string,
    value: string
  ): boolean {
    const state = this.contractStates.get(contractAddress);
    if (!state) {
      return false;
    }

    // Check storage size
    const currentSize = this.calculateStateSize(state);
    const newValueSize = value.length;
    const oldValue = state.storage.get(key);
    const oldValueSize = oldValue ? oldValue.length : 0;
    
    const newSize = currentSize - oldValueSize + newValueSize;
    if (newSize > this.config.maxStorageSize) {
      return false;
    }

    // Update storage
    state.storage.set(key, value);
    state.nonce++;

    this.emit('storageUpdated', {
      contractAddress,
      key,
      value,
      oldValue
    });

    return true;
  }

  /**
   * Delete contract storage value
   * @param contractAddress - Contract address
   * @param key - Storage key
   * @returns Success status
   */
  public deleteStorageValue(contractAddress: string, key: string): boolean {
    const state = this.contractStates.get(contractAddress);
    if (!state) {
      return false;
    }

    const oldValue = state.storage.get(key);
    if (oldValue === undefined) {
      return false;
    }

    state.storage.delete(key);
    state.nonce++;

    this.emit('storageDeleted', {
      contractAddress,
      key,
      oldValue
    });

    return true;
  }

  /**
   * Create state snapshot
   * @param contractAddress - Contract address
   * @param state - Contract state
   * @param transaction - Transaction
   * @returns Snapshot ID
   */
  public createSnapshot(
    contractAddress: string,
    state: ContractState,
    transaction: Transaction
  ): string {
    const snapshotId = this.generateSnapshotId();
    
    let serializedState = this.serializeState(state);
    let compressed = false;
    let encrypted = false;

    // Compress if enabled
    if (this.config.enableCompression) {
      serializedState = this.compressData(serializedState);
      compressed = true;
    }

    // Encrypt if enabled
    if (this.config.enableEncryption) {
      serializedState = this.encryptData(serializedState);
      encrypted = true;
    }

    const snapshot: StateSnapshot = {
      id: snapshotId,
      contractAddress,
      state,
      timestamp: Date.now(),
      blockNumber: 0, // Would be extracted from block
      transactionHash: transaction.hash,
      size: serializedState.length,
      compressed,
      encrypted
    };

    // Store snapshot
    if (!this.stateSnapshots.has(contractAddress)) {
      this.stateSnapshots.set(contractAddress, []);
    }

    const snapshots = this.stateSnapshots.get(contractAddress)!;
    snapshots.push(snapshot);

    this.emit('snapshotCreated', {
      contractAddress,
      snapshotId,
      size: snapshot.size,
      compressed,
      encrypted
    });

    return snapshotId;
  }

  /**
   * Restore state from snapshot
   * @param contractAddress - Contract address
   * @param snapshotId - Snapshot ID
   * @returns Success status
   */
  public restoreFromSnapshot(
    contractAddress: string,
    snapshotId: string
  ): boolean {
    const snapshots = this.stateSnapshots.get(contractAddress);
    if (!snapshots) {
      return false;
    }

    const snapshot = snapshots.find(s => s.id === snapshotId);
    if (!snapshot) {
      return false;
    }

    try {
      let stateData = this.serializeState(snapshot.state);

      // Decrypt if needed
      if (snapshot.encrypted) {
        stateData = this.decryptData(stateData);
      }

      // Decompress if needed
      if (snapshot.compressed) {
        stateData = this.decompressData(stateData);
      }

      // Restore state
      const restoredState = this.deserializeState(stateData);
      this.contractStates.set(contractAddress, restoredState);

      this.emit('snapshotRestored', {
        contractAddress,
        snapshotId,
        timestamp: Date.now()
      });

      return true;
    } catch (error) {
      this.emit('stateError', {
        contractAddress,
        error: error instanceof Error ? error.message : 'Snapshot restoration failed'
      });
      return false;
    }
  }

  /**
   * Get contract snapshots
   * @param contractAddress - Contract address
   * @returns Array of snapshots
   */
  public getSnapshots(contractAddress: string): StateSnapshot[] {
    const snapshots = this.stateSnapshots.get(contractAddress);
    return snapshots ? [...snapshots] : [];
  }

  /**
   * Delete snapshot
   * @param contractAddress - Contract address
   * @param snapshotId - Snapshot ID
   * @returns Success status
   */
  public deleteSnapshot(contractAddress: string, snapshotId: string): boolean {
    const snapshots = this.stateSnapshots.get(contractAddress);
    if (!snapshots) {
      return false;
    }

    const index = snapshots.findIndex(s => s.id === snapshotId);
    if (index === -1) {
      return false;
    }

    snapshots.splice(index, 1);

    this.emit('snapshotDeleted', {
      contractAddress,
      snapshotId
    });

    return true;
  }

  /**
   * Get state transitions
   * @param query - State query
   * @returns Array of state transitions
   */
  public getStateTransitions(query: StateQuery): StateTransition[] {
    return this.stateTransitions.filter(transition => {
      if (query.contractAddress && transition.contractAddress !== query.contractAddress) {
        return false;
      }
      
      if (query.fromBlock && transition.blockNumber < query.fromBlock) {
        return false;
      }
      
      if (query.toBlock && transition.blockNumber > query.toBlock) {
        return false;
      }
      
      if (query.fromTimestamp && transition.timestamp < query.fromTimestamp) {
        return false;
      }
      
      if (query.toTimestamp && transition.timestamp > query.toTimestamp) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get state history for a key
   * @param contractAddress - Contract address
   * @param key - Storage key
   * @returns Array of historical values
   */
  public getStateHistory(contractAddress: string, key: string): string[] {
    const history = this.stateHistory.get(contractAddress);
    if (!history) {
      return [];
    }

    return history.get(key) || [];
  }

  /**
   * Calculate state diff
   */
  private calculateStateDiff(oldState: ContractState | undefined, newState: ContractState): StateDiff {
    const diff: StateDiff = {
      contractAddress: newState.address,
      added: new Map(),
      modified: new Map(),
      deleted: new Set(),
      timestamp: Date.now()
    };

    if (!oldState) {
      // All keys are added
      for (const [key, value] of newState.storage.entries()) {
        diff.added.set(key, value);
      }
      return diff;
    }

    // Find added and modified keys
    for (const [key, newValue] of newState.storage.entries()) {
      const oldValue = oldState.storage.get(key);
      
      if (oldValue === undefined) {
        diff.added.set(key, newValue);
      } else if (oldValue !== newValue) {
        diff.modified.set(key, { old: oldValue, new: newValue });
      }
    }

    // Find deleted keys
    for (const [key, value] of oldState.storage.entries()) {
      if (!newState.storage.has(key)) {
        diff.deleted.add(key);
      }
    }

    return diff;
  }

  /**
   * Update state history
   */
  private updateStateHistory(contractAddress: string, diff: StateDiff): void {
    if (!this.stateHistory.has(contractAddress)) {
      this.stateHistory.set(contractAddress, new Map());
    }

    const history = this.stateHistory.get(contractAddress)!;

    // Add added keys to history
    for (const [key, value] of diff.added.entries()) {
      if (!history.has(key)) {
        history.set(key, []);
      }
      history.get(key)!.push(value);
    }

    // Add modified keys to history
    for (const [key, change] of diff.modified.entries()) {
      if (!history.has(key)) {
        history.set(key, []);
      }
      history.get(key)!.push(change.new);
    }
  }

  /**
   * Check if snapshot should be created
   */
  private shouldCreateSnapshot(contractAddress: string): boolean {
    const snapshots = this.stateSnapshots.get(contractAddress);
    if (!snapshots) {
      return true;
    }

    const lastSnapshot = snapshots[snapshots.length - 1];
    if (!lastSnapshot) {
      return true;
    }

    // Create snapshot based on interval
    const timeSinceLastSnapshot = Date.now() - lastSnapshot.timestamp;
    return timeSinceLastSnapshot >= this.config.snapshotInterval * 1000;
  }

  /**
   * Clean up old snapshots
   */
  private cleanupOldSnapshots(contractAddress: string): void {
    const snapshots = this.stateSnapshots.get(contractAddress);
    if (!snapshots) {
      return;
    }

    // Keep only the most recent snapshots
    if (snapshots.length > this.config.maxSnapshots) {
      const toDelete = snapshots.splice(0, snapshots.length - this.config.maxSnapshots);
      
      for (const snapshot of toDelete) {
        this.emit('snapshotDeleted', {
          contractAddress,
          snapshotId: snapshot.id,
          reason: 'cleanup'
        });
      }
    }
  }

  /**
   * Calculate state size
   */
  private calculateStateSize(state: ContractState): number {
    let size = 0;
    
    // Add storage size
    for (const [key, value] of state.storage.entries()) {
      size += key.length + value.length;
    }

    // Add other fields
    size += state.address.length;
    size += state.balance.length;
    size += state.code.length;
    size += JSON.stringify(state.deployedBy).length;

    return size;
  }

  /**
   * Serialize state
   */
  private serializeState(state: ContractState): string {
    return JSON.stringify({
      address: state.address,
      balance: state.balance,
      nonce: state.nonce,
      code: state.code,
      storage: Object.fromEntries(state.storage),
      deployedAt: state.deployedAt,
      deployedBy: state.deployedBy,
      version: state.version
    });
  }

  /**
   * Deserialize state
   */
  private deserializeState(serialized: string): ContractState {
    const data = JSON.parse(serialized);
    
    return {
      address: data.address,
      balance: data.balance,
      nonce: data.nonce,
      code: data.code,
      storage: new Map(Object.entries(data.storage)),
      deployedAt: data.deployedAt,
      deployedBy: data.deployedBy,
      version: data.version
    };
  }

  /**
   * Generate snapshot ID
   */
  private generateSnapshotId(): string {
    return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate encryption key
   */
  private generateEncryptionKey(): string {
    return CryptoUtils.hash(`encryption_key_${Date.now()}_${Math.random()}`);
  }

  /**
   * Compress data (placeholder)
   */
  private compressData(data: string): string {
    // In a real implementation, this would use compression algorithms
    return data;
  }

  /**
   * Decompress data (placeholder)
   */
  private decompressData(data: string): string {
    // In a real implementation, this would use decompression algorithms
    return data;
  }

  /**
   * Encrypt data (placeholder)
   */
  private encryptData(data: string): string {
    // In a real implementation, this would use encryption algorithms
    return data;
  }

  /**
   * Decrypt data (placeholder)
   */
  private decryptData(data: string): string {
    // In a real implementation, this would use decryption algorithms
    return data;
  }

  /**
   * Get state manager statistics
   */
  public getStats(): {
    totalContracts: number;
    totalStorageSize: number;
    totalSnapshots: number;
    totalTransitions: number;
    averageStateSize: number;
  } {
    const totalContracts = this.contractStates.size;
    let totalStorageSize = 0;
    
    for (const state of this.contractStates.values()) {
      totalStorageSize += this.calculateStateSize(state);
    }

    const totalSnapshots = Array.from(this.stateSnapshots.values())
      .reduce((sum, snapshots) => sum + snapshots.length, 0);
    
    const totalTransitions = this.stateTransitions.length;
    const averageStateSize = totalContracts > 0 ? totalStorageSize / totalContracts : 0;

    return {
      totalContracts,
      totalStorageSize,
      totalSnapshots,
      totalTransitions,
      averageStateSize
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<StateConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): StateConfig {
    return { ...this.config };
  }

  /**
   * Clear all contract states
   */
  public clearAllStates(): void {
    this.contractStates.clear();
    this.stateSnapshots.clear();
    this.stateTransitions = [];
    this.stateHistory.clear();
    
    this.emit('allStatesCleared');
  }

  /**
   * Clear contract state
   */
  public clearContractState(contractAddress: string): void {
    this.contractStates.delete(contractAddress);
    this.stateSnapshots.delete(contractAddress);
    this.stateHistory.delete(contractAddress);
    
    // Remove transitions for this contract
    this.stateTransitions = this.stateTransitions.filter(
      transition => transition.contractAddress !== contractAddress
    );
    
    this.emit('contractStateCleared', { contractAddress });
  }
}
