import { EventEmitter } from 'events';
import { Block, Transaction } from '../types/block.types';

export interface ShardingConfig {
  enabled: boolean;
  shardCount: number;
  shardingStrategy: 'HASH' | 'RANGE' | 'DIRECTORY' | 'CONSISTENT_HASH';
  replicationFactor: number;
  enableRebalancing: boolean;
  rebalanceThreshold: number;
  enableCrossShardQueries: boolean;
  enableShardHealthMonitoring: boolean;
  healthCheckInterval: number;
  enableMetrics: boolean;
}

export interface Shard {
  id: string;
  range: {
    start: string;
    end: string;
  };
  nodes: string[];
  status: 'ACTIVE' | 'REBALANCING' | 'OFFLINE' | 'MAINTENANCE';
  lastHealthCheck: number;
  transactionCount: number;
  size: number;
  replicationStatus: Map<string, 'SYNCED' | 'SYNCING' | 'FAILED'>;
}

export interface ShardNode {
  id: string;
  address: string;
  port: number;
  shards: string[];
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  lastSeen: number;
  load: number;
  capacity: number;
}

export interface ShardRouting {
  shardId: string;
  nodeId: string;
  timestamp: number;
  reason: 'INITIAL' | 'REBALANCE' | 'FAILURE' | 'MAINTENANCE';
}

export interface ShardingMetrics {
  totalShards: number;
  activeShards: number;
  offlineShards: number;
  rebalancingShards: number;
  totalTransactions: number;
  averageShardLoad: number;
  replicationHealth: number;
  crossShardQueries: number;
  rebalanceOperations: number;
}

/**
 * Sharding manager for high-volume transaction processing
 * Implements data partitioning, replication, and load balancing across shards
 */
export class ShardingManager extends EventEmitter {
  private config: ShardingConfig;
  private shards: Map<string, Shard> = new Map();
  private nodes: Map<string, ShardNode> = new Map();
  private routingTable: Map<string, ShardRouting> = new Map();
  private metrics: ShardingMetrics;
  private healthCheckTimer?: NodeJS.Timeout;
  private rebalanceTimer?: NodeJS.Timeout;
  private metricsTimer?: NodeJS.Timeout;

  constructor(config: Partial<ShardingConfig> = {}) {
    super();
    
    this.config = {
      enabled: true,
      shardCount: 4,
      shardingStrategy: 'HASH',
      replicationFactor: 3,
      enableRebalancing: true,
      rebalanceThreshold: 0.8,
      enableCrossShardQueries: true,
      enableShardHealthMonitoring: true,
      healthCheckInterval: 30000, // 30 seconds
      enableMetrics: true,
      ...config
    };

    this.metrics = {
      totalShards: 0,
      activeShards: 0,
      offlineShards: 0,
      rebalancingShards: 0,
      totalTransactions: 0,
      averageShardLoad: 0,
      replicationHealth: 0,
      crossShardQueries: 0,
      rebalanceOperations: 0
    };

    if (this.config.enabled) {
      this.initializeShards();
      this.startHealthMonitoring();
      this.startRebalancing();
      
      if (this.config.enableMetrics) {
        this.startMetricsCollection();
      }
    }
  }

  /**
   * Initialize shards
   */
  private initializeShards(): void {
    for (let i = 0; i < this.config.shardCount; i++) {
      const shard: Shard = {
        id: `shard_${i}`,
        range: this.calculateShardRange(i),
        nodes: [],
        status: 'ACTIVE',
        lastHealthCheck: Date.now(),
        transactionCount: 0,
        size: 0,
        replicationStatus: new Map()
      };

      this.shards.set(shard.id, shard);
    }

    this.metrics.totalShards = this.shards.size;
    this.metrics.activeShards = this.shards.size;

    this.emit('shardsInitialized', {
      shardCount: this.shards.size,
      strategy: this.config.shardingStrategy
    });
  }

  /**
   * Calculate shard range for index
   */
  private calculateShardRange(index: number): { start: string; end: string } {
    const rangeSize = Math.floor(256 / this.config.shardCount);
    const start = (index * rangeSize).toString(16).padStart(2, '0');
    const end = Math.min((index + 1) * rangeSize - 1, 255).toString(16).padStart(2, '0');
    
    return { start, end };
  }

  /**
   * Get shard for transaction
   * @param transaction - Transaction to shard
   * @returns Shard ID
   */
  public getShardForTransaction(transaction: Transaction): string {
    if (!this.config.enabled) {
      return 'default';
    }

    switch (this.config.shardingStrategy) {
      case 'HASH':
        return this.getShardByHash(transaction.hash);
      case 'RANGE':
        return this.getShardByRange(transaction.from);
      case 'DIRECTORY':
        return this.getShardByDirectory(transaction.from);
      case 'CONSISTENT_HASH':
        return this.getShardByConsistentHash(transaction.hash);
      default:
        return 'default';
    }
  }

  /**
   * Get shard by hash
   */
  private getShardByHash(hash: string): string {
    const hashValue = parseInt(hash.slice(2, 4), 16);
    const shardIndex = hashValue % this.config.shardCount;
    return `shard_${shardIndex}`;
  }

  /**
   * Get shard by range
   */
  private getShardByRange(address: string): string {
    const addressValue = parseInt(address.slice(2, 4), 16);
    const shardIndex = Math.floor(addressValue / (256 / this.config.shardCount));
    return `shard_${shardIndex}`;
  }

  /**
   * Get shard by directory
   */
  private getShardByDirectory(address: string): string {
    // Use directory service to map address to shard
    const directoryKey = address.slice(2, 10);
    const shardIndex = parseInt(directoryKey, 16) % this.config.shardCount;
    return `shard_${shardIndex}`;
  }

  /**
   * Get shard by consistent hash
   */
  private getShardByConsistentHash(hash: string): string {
    // Simplified consistent hashing
    const hashValue = this.consistentHash(hash);
    const shardIndex = hashValue % this.config.shardCount;
    return `shard_${shardIndex}`;
  }

  /**
   * Consistent hash function
   */
  private consistentHash(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Add node to shard
   * @param nodeId - Node ID
   * @param shardId - Shard ID
   * @returns Success status
   */
  public addNodeToShard(nodeId: string, shardId: string): boolean {
    const shard = this.shards.get(shardId);
    if (!shard) {
      return false;
    }

    if (!shard.nodes.includes(nodeId)) {
      shard.nodes.push(nodeId);
    }

    // Update routing table
    this.routingTable.set(nodeId, {
      shardId,
      nodeId,
      timestamp: Date.now(),
      reason: 'INITIAL'
    });

    this.emit('nodeAddedToShard', {
      nodeId,
      shardId,
      nodeCount: shard.nodes.length
    });

    return true;
  }

  /**
   * Remove node from shard
   * @param nodeId - Node ID
   * @param shardId - Shard ID
   * @returns Success status
   */
  public removeNodeFromShard(nodeId: string, shardId: string): boolean {
    const shard = this.shards.get(shardId);
    if (!shard) {
      return false;
    }

    const index = shard.nodes.indexOf(nodeId);
    if (index > -1) {
      shard.nodes.splice(index, 1);
    }

    this.routingTable.delete(nodeId);

    this.emit('nodeRemovedFromShard', {
      nodeId,
      shardId,
      nodeCount: shard.nodes.length
    });

    return true;
  }

  /**
   * Get shard information
   */
  public getShard(shardId: string): Shard | null {
    return this.shards.get(shardId) || null;
  }

  /**
   * Get all shards
   */
  public getAllShards(): Shard[] {
    return Array.from(this.shards.values());
  }

  /**
   * Get shards for node
   */
  public getShardsForNode(nodeId: string): Shard[] {
    return Array.from(this.shards.values()).filter(shard => 
      shard.nodes.includes(nodeId)
    );
  }

  /**
   * Execute cross-shard query
   * @param query - Query to execute
   * @param targetShards - Target shards (optional)
   * @returns Query results
   */
  public async executeCrossShardQuery(query: string, targetShards?: string[]): Promise<any[]> {
    if (!this.config.enableCrossShardQueries) {
      throw new Error('Cross-shard queries are disabled');
    }

    const shards = targetShards || Array.from(this.shards.keys());
    const results: any[] = [];

    this.metrics.crossShardQueries++;

    for (const shardId of shards) {
      try {
        const result = await this.executeQueryOnShard(shardId, query);
        results.push({
          shardId,
          result,
          timestamp: Date.now()
        });
      } catch (error) {
        results.push({
          shardId,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        });
      }
    }

    return results;
  }

  /**
   * Execute query on specific shard
   */
  private async executeQueryOnShard(shardId: string, query: string): Promise<any> {
    const shard = this.shards.get(shardId);
    if (!shard) {
      throw new Error(`Shard ${shardId} not found`);
    }

    if (shard.status !== 'ACTIVE') {
      throw new Error(`Shard ${shardId} is not active`);
    }

    // Simulate query execution
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          shardId,
          query,
          rows: Math.floor(Math.random() * 100) + 1,
          executionTime: Math.random() * 100 + 10
        });
      }, Math.random() * 50 + 10);
    });
  }

  /**
   * Rebalance shards
   */
  public async rebalanceShards(): Promise<any> {
    if (!this.config.enableRebalancing) {
      return { rebalanced: 0, reason: 'Rebalancing disabled' };
    }

    const rebalanceResults = {
      rebalanced: 0,
      movedTransactions: 0,
      reason: 'MANUAL'
    };

    // Check if rebalancing is needed
    const needsRebalancing = this.checkRebalancingNeeded();
    if (!needsRebalancing) {
      return { ...rebalanceResults, reason: 'NO_REBALANCING_NEEDED' };
    }

    // Perform rebalancing
    for (const [shardId, shard] of this.shards.entries()) {
      if (this.shouldRebalanceShard(shard)) {
        const result = await this.rebalanceShard(shardId);
        rebalanceResults.rebalanced++;
        rebalanceResults.movedTransactions += result.movedTransactions;
      }
    }

    this.metrics.rebalanceOperations += rebalanceResults.rebalanced;

    this.emit('shardsRebalanced', rebalanceResults);
    return rebalanceResults;
  }

  /**
   * Check if rebalancing is needed
   */
  private checkRebalancingNeeded(): boolean {
    for (const shard of this.shards.values()) {
      if (this.shouldRebalanceShard(shard)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if shard should be rebalanced
   */
  private shouldRebalanceShard(shard: Shard): boolean {
    // Check load threshold
    const load = shard.transactionCount / 10000; // Assume 10k transactions per shard
    return load > this.config.rebalanceThreshold;
  }

  /**
   * Rebalance individual shard
   */
  private async rebalanceShard(shardId: string): Promise<{ movedTransactions: number }> {
    const shard = this.shards.get(shardId);
    if (!shard) {
      return { movedTransactions: 0 };
    }

    shard.status = 'REBALANCING';

    // Simulate rebalancing
    const movedTransactions = Math.floor(Math.random() * 1000) + 100;

    return new Promise((resolve) => {
      setTimeout(() => {
        shard.status = 'ACTIVE';
        shard.transactionCount -= movedTransactions;
        
        this.emit('shardRebalanced', {
          shardId,
          movedTransactions
        });

        resolve({ movedTransactions });
      }, 1000);
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (!this.config.enableShardHealthMonitoring) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health check on all shards
   */
  private performHealthCheck(): void {
    const now = Date.now();
    
    for (const [shardId, shard] of this.shards.entries()) {
      const timeSinceLastCheck = now - shard.lastHealthCheck;
      
      // Check if shard is healthy
      const isHealthy = this.isShardHealthy(shard);
      
      if (!isHealthy) {
        if (shard.status === 'ACTIVE') {
          shard.status = 'OFFLINE';
          this.emit('shardOffline', { shardId, timestamp: now });
        }
      } else {
        if (shard.status === 'OFFLINE') {
          shard.status = 'ACTIVE';
          this.emit('shardOnline', { shardId, timestamp: now });
        }
      }
      
      shard.lastHealthCheck = now;
    }

    this.updateMetrics();
  }

  /**
   * Check if shard is healthy
   */
  private isShardHealthy(shard: Shard): boolean {
    // Check if shard has enough nodes
    if (shard.nodes.length < this.config.replicationFactor) {
      return false;
    }

    // Check replication status
    const syncedReplicas = Array.from(shard.replicationStatus.values())
      .filter(status => status === 'SYNCED').length;
    
    return syncedReplicas >= this.config.replicationFactor - 1;
  }

  /**
   * Start automatic rebalancing
   */
  private startRebalancing(): void {
    if (!this.config.enableRebalancing) {
      return;
    }

    this.rebalanceTimer = setInterval(() => {
      this.rebalanceShards();
    }, 300000); // Rebalance every 5 minutes
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, 60000); // Collect every minute
  }

  /**
   * Collect performance metrics
   */
  private collectMetrics(): void {
    this.updateMetrics();
    
    this.emit('metricsCollected', {
      timestamp: Date.now(),
      metrics: this.metrics
    });
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    const shards = Array.from(this.shards.values());
    
    this.metrics.activeShards = shards.filter(s => s.status === 'ACTIVE').length;
    this.metrics.offlineShards = shards.filter(s => s.status === 'OFFLINE').length;
    this.metrics.rebalancingShards = shards.filter(s => s.status === 'REBALANCING').length;
    
    // Calculate average shard load
    const totalTransactions = shards.reduce((sum, s) => sum + s.transactionCount, 0);
    this.metrics.totalTransactions = totalTransactions;
    this.metrics.averageShardLoad = shards.length > 0 ? totalTransactions / shards.length : 0;
    
    // Calculate replication health
    let totalReplicationHealth = 0;
    let shardCount = 0;
    
    for (const shard of shards) {
      const syncedReplicas = Array.from(shard.replicationStatus.values())
        .filter(status => status === 'SYNCED').length;
      const replicationHealth = syncedReplicas / this.config.replicationFactor;
      totalReplicationHealth += replicationHealth;
      shardCount++;
    }
    
    this.metrics.replicationHealth = shardCount > 0 ? totalReplicationHealth / shardCount : 0;
  }

  /**
   * Get sharding metrics
   */
  public getMetrics(): ShardingMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get routing table
   */
  public getRoutingTable(): Map<string, ShardRouting> {
    return new Map(this.routingTable);
  }

  /**
   * Get shard statistics
   */
  public getShardStats(): {
    totalShards: number;
    activeShards: number;
    averageLoad: number;
    totalTransactions: number;
    replicationHealth: number;
  } {
    const shards = Array.from(this.shards.values());
    const activeShards = shards.filter(s => s.status === 'ACTIVE').length;
    const totalTransactions = shards.reduce((sum, s) => sum + s.transactionCount, 0);
    const averageLoad = shards.length > 0 ? totalTransactions / shards.length : 0;
    
    let totalReplicationHealth = 0;
    for (const shard of shards) {
      const syncedReplicas = Array.from(shard.replicationStatus.values())
        .filter(status => status === 'SYNCED').length;
      totalReplicationHealth += syncedReplicas / this.config.replicationFactor;
    }
    const replicationHealth = shards.length > 0 ? totalReplicationHealth / shards.length : 0;

    return {
      totalShards: shards.length,
      activeShards,
      averageLoad,
      totalTransactions,
      replicationHealth
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ShardingConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart timers with new configuration
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      if (this.config.enableShardHealthMonitoring) {
        this.startHealthMonitoring();
      }
    }
    
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
      if (this.config.enableRebalancing) {
        this.startRebalancing();
      }
    }

    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): ShardingConfig {
    return { ...this.config };
  }

  /**
   * Stop the sharding manager
   */
  public stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
    }
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    // Set all shards to offline
    for (const shard of this.shards.values()) {
      shard.status = 'OFFLINE';
    }

    this.emit('stopped');
  }
}
