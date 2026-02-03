import { EventEmitter } from 'events';
import { NodeInfo } from '../types/node.types';
import { NetworkPartition } from './FaultTolerantConsensus';

export interface PartitionConfig {
  detectionTimeout: number;
  heartbeatInterval: number;
  maxPartitionDuration: number;
  syncRetryInterval: number;
  minNodesForQuorum: number;
  partitionRecoveryTimeout: number;
}

export interface PartitionNode {
  nodeId: string;
  nodeInfo: NodeInfo;
  lastSeen: number;
  status: 'CONNECTED' | 'SUSPECTED' | 'PARTITIONED' | 'RECOVERING';
  partitionId?: string;
}

export interface PartitionInfo {
  partitionId: string;
  detectedAt: number;
  nodes: string[];
  isolatedNodes: string[];
  connectedNodes: string[];
  isMajorityPartition: boolean;
  estimatedSize: number;
}

export interface SyncRequest {
  partitionId: string;
  requestingNode: string;
  targetNode: string;
  lastKnownBlock: number;
  timestamp: number;
}

/**
 * Network partition detection and handling system
 * Manages network splits and ensures consensus continuity
 */
export class NetworkPartitionHandler extends EventEmitter {
  private config: PartitionConfig;
  private currentNode: NodeInfo;
  private partitionNodes: Map<string, PartitionNode> = new Map();
  private currentPartition: PartitionInfo | null = null;
  private heartbeatTimer?: NodeJS.Timeout;
  private syncTimer?: NodeJS.Timeout;
  private partitionDetected: boolean = false;

  constructor(config: PartitionConfig, currentNode: NodeInfo) {
    super();
    this.config = config;
    this.currentNode = currentNode;
    
    // Initialize current node
    this.partitionNodes.set(currentNode.id, {
      nodeId: currentNode.id,
      nodeInfo: currentNode,
      lastSeen: Date.now(),
      status: 'CONNECTED'
    });
  }

  /**
   * Start partition monitoring
   */
  public start(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.performPartitionCheck();
    }, this.config.heartbeatInterval);

    this.emit('partitionMonitoringStarted');
  }

  /**
   * Stop partition monitoring
   */
  public stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }

    this.emit('partitionMonitoringStopped');
  }

  /**
   * Add a node to partition monitoring
   * @param nodeInfo - Node information
   */
  public addNode(nodeInfo: NodeInfo): void {
    this.partitionNodes.set(nodeInfo.id, {
      nodeId: nodeInfo.id,
      nodeInfo,
      lastSeen: Date.now(),
      status: 'CONNECTED'
    });

    this.emit('nodeAdded', { nodeId: nodeInfo.id });
  }

  /**
   * Remove a node from partition monitoring
   * @param nodeId - Node ID to remove
   */
  public removeNode(nodeId: string): void {
    this.partitionNodes.delete(nodeId);
    this.emit('nodeRemoved', { nodeId });
  }

  /**
   * Update node heartbeat
   * @param nodeId - Node ID
   * @param timestamp - Heartbeat timestamp
   */
  public updateHeartbeat(nodeId: string, timestamp: number): void {
    const node = this.partitionNodes.get(nodeId);
    if (!node) {
      return;
    }

    node.lastSeen = timestamp;

    // If node was suspected or partitioned, mark as recovering
    if (node.status === 'SUSPECTED' || node.status === 'PARTITIONED') {
      node.status = 'RECOVERING';
      
      setTimeout(() => {
        this.markNodeRecovered(nodeId);
      }, this.config.partitionRecoveryTimeout);
    }
  }

  /**
   * Mark node as recovered from partition
   * @param nodeId - Node ID
   */
  private markNodeRecovered(nodeId: string): void {
    const node = this.partitionNodes.get(nodeId);
    if (node && (node.status === 'RECOVERING' || node.status === 'SUSPECTED')) {
      node.status = 'CONNECTED';
      delete node.partitionId;
      
      this.emit('nodeRecovered', { nodeId });
      this.checkPartitionResolution();
    }
  }

  /**
   * Perform comprehensive partition check
   */
  private performPartitionCheck(): void {
    const now = Date.now();
    const timeoutThreshold = this.config.detectionTimeout;

    // Check for timeouts
    for (const [nodeId, node] of this.partitionNodes.entries()) {
      const timeSinceLastSeen = now - node.lastSeen;

      if (timeSinceLastSeen > timeoutThreshold) {
        if (node.status === 'CONNECTED') {
          node.status = 'SUSPECTED';
          this.emit('nodeSuspected', { nodeId, timeSinceLastSeen });
        } else if (node.status === 'SUSPECTED' && timeSinceLastSeen > timeoutThreshold * 2) {
          node.status = 'PARTITIONED';
          this.emit('nodePartitioned', { nodeId, timeSinceLastSeen });
        }
      }
    }

    // Check for network partition
    this.detectNetworkPartition();
  }

  /**
   * Detect network partition
   */
  private detectNetworkPartition(): void {
    const connectedNodes = Array.from(this.partitionNodes.values())
      .filter(n => n.status === 'CONNECTED')
      .map(n => n.nodeId);

    const totalNodes = this.partitionNodes.size;
    const connectedCount = connectedNodes.length;

    // If we have less than 2/3 of nodes, we might be in a partition
    if (connectedCount < Math.ceil(totalNodes * 2/3)) {
      if (!this.partitionDetected) {
        this.partitionDetected = true;
        this.createPartitionInfo(connectedNodes);
      }
    } else if (this.partitionDetected) {
      // Check if partition is resolved
      this.checkPartitionResolution();
    }
  }

  /**
   * Create partition information
   * @param connectedNodes - Currently connected nodes
   */
  private createPartitionInfo(connectedNodes: string[]): void {
    const partitionId = this.generatePartitionId();
    const allNodes = Array.from(this.partitionNodes.keys());
    const isolatedNodes = allNodes.filter(n => !connectedNodes.includes(n));

    this.currentPartition = {
      partitionId,
      detectedAt: Date.now(),
      nodes: allNodes,
      isolatedNodes,
      connectedNodes,
      isMajorityPartition: connectedNodes.length >= isolatedNodes.length,
      estimatedSize: connectedNodes.length
    };

    this.emit('partitionDetected', {
      partition: this.currentPartition,
      isMajority: this.currentPartition.isMajorityPartition
    });

    // Start sync process if we're in majority partition
    if (this.currentPartition.isMajorityPartition) {
      this.startSyncProcess();
    } else {
      this.enterMinorityPartitionMode();
    }
  }

  /**
   * Generate unique partition ID
   * @returns Partition ID
   */
  private generatePartitionId(): string {
    return `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start synchronization process
   */
  private startSyncProcess(): void {
    if (!this.currentPartition) {
      return;
    }

    this.emit('syncStarted', {
      partitionId: this.currentPartition.partitionId,
      connectedNodes: this.currentPartition.connectedNodes.length
    });

    // Attempt to sync with other nodes in the partition
    this.attemptPartitionSync();
  }

  /**
   * Attempt to synchronize with partition
   */
  private attemptPartitionSync(): void {
    if (!this.currentPartition) {
      return;
    }

    const syncRequests: SyncRequest[] = [];

    // Create sync requests for other connected nodes
    for (const nodeId of this.currentPartition.connectedNodes) {
      if (nodeId !== this.currentNode.id) {
        syncRequests.push({
          partitionId: this.currentPartition.partitionId,
          requestingNode: this.currentNode.id,
          targetNode: nodeId,
          lastKnownBlock: 0, // Would get from blockchain state
          timestamp: Date.now()
        });
      }
    }

    this.emit('syncAttempt', {
      partitionId: this.currentPartition.partitionId,
      syncRequests
    });

    // Schedule retry
    this.syncTimer = setTimeout(() => {
      if (this.partitionDetected) {
        this.attemptPartitionSync();
      }
    }, this.config.syncRetryInterval);
  }

  /**
   * Handle sync response from another node
   * @param syncRequest - Original sync request
   * @param response - Sync response
   */
  public handleSyncResponse(syncRequest: SyncRequest, response: any): void {
    if (!this.currentPartition || syncRequest.partitionId !== this.currentPartition.partitionId) {
      return;
    }

    this.emit('syncResponse', {
      syncRequest,
      response,
      timestamp: Date.now()
    });

    // Check if all nodes in partition are synced
    this.checkSyncCompletion();
  }

  /**
   * Check if synchronization is complete
   */
  private checkSyncCompletion(): void {
    if (!this.currentPartition) {
      return;
    }

    // In a real implementation, this would check if all nodes have consistent state
    // For now, emit sync completed after a delay
    setTimeout(() => {
      if (this.partitionDetected && this.currentPartition) {
        this.emit('syncCompleted', {
          partitionId: this.currentPartition.partitionId,
          connectedNodes: this.currentPartition.connectedNodes.length
        });
      }
    }, 5000);
  }

  /**
   * Enter minority partition mode
   */
  private enterMinorityPartitionMode(): void {
    if (!this.currentPartition) {
      return;
    }

    this.emit('minorityPartitionMode', {
      partitionId: this.currentPartition.partitionId,
      isolatedNodes: this.currentPartition.isolatedNodes.length,
      connectedNodes: this.currentPartition.connectedNodes.length
    });

    // In minority partition, we should pause consensus and wait for recovery
    this.emit('consensusPaused', {
      reason: 'MINORITY_PARTITION',
      partitionId: this.currentPartition.partitionId
    });

    // Schedule recovery attempts
    this.scheduleRecoveryAttempts();
  }

  /**
   * Schedule recovery attempts for minority partition
   */
  private scheduleRecoveryAttempts(): void {
    const recoveryInterval = this.config.partitionRecoveryTimeout * 2;

    setTimeout(() => {
      if (this.partitionDetected) {
        this.attemptPartitionRecovery();
        
        // Schedule next attempt
        this.scheduleRecoveryAttempts();
      }
    }, recoveryInterval);
  }

  /**
   * Attempt to recover from partition
   */
  private attemptPartitionRecovery(): void {
    if (!this.currentPartition) {
      return;
    }

    this.emit('recoveryAttempt', {
      partitionId: this.currentPartition.partitionId,
      duration: Date.now() - this.currentPartition.detectedAt
    });

    // Try to reconnect with isolated nodes
    for (const nodeId of this.currentPartition.isolatedNodes) {
      this.attemptNodeReconnection(nodeId);
    }
  }

  /**
   * Attempt to reconnect with isolated node
   * @param nodeId - Node ID to reconnect
   */
  private attemptNodeReconnection(nodeId: string): void {
    this.emit('reconnectionAttempt', {
      nodeId,
      partitionId: this.currentPartition?.partitionId,
      timestamp: Date.now()
    });

    // In a real implementation, this would involve network calls
    // For now, simulate reconnection attempt
    setTimeout(() => {
      const reconnected = Math.random() > 0.7; // 30% success rate
      
      if (reconnected) {
        this.updateHeartbeat(nodeId, Date.now());
      }
    }, 2000);
  }

  /**
   * Check if partition is resolved
   */
  private checkPartitionResolution(): void {
    const totalNodes = this.partitionNodes.size;
    const connectedNodes = Array.from(this.partitionNodes.values())
      .filter(n => n.status === 'CONNECTED')
      .length;

    // Partition is resolved if we have at least 2/3 of nodes
    if (connectedNodes >= Math.ceil(totalNodes * 2/3)) {
      this.resolvePartition();
    }
  }

  /**
   * Resolve network partition
   */
  private resolvePartition(): void {
    if (!this.currentPartition) {
      return;
    }

    const partitionDuration = Date.now() - this.currentPartition.detectedAt;
    
    this.emit('partitionResolved', {
      partitionId: this.currentPartition.partitionId,
      duration: partitionDuration,
      connectedNodes: this.currentPartition.connectedNodes.length
    });

    // Clean up partition state
    for (const node of this.partitionNodes.values()) {
      if (node.status === 'PARTITIONED' || node.status === 'SUSPECTED') {
        node.status = 'CONNECTED';
        delete node.partitionId;
      }
    }

    this.currentPartition = null;
    this.partitionDetected = false;

    // Clear sync timer
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }

    // Resume consensus
    this.emit('consensusResumed', {
      reason: 'PARTITION_RESOLVED'
    });
  }

  /**
   * Get current partition information
   * @returns Current partition info or null
   */
  public getCurrentPartition(): PartitionInfo | null {
    return this.currentPartition;
  }

  /**
   * Check if partition is detected
   * @returns True if partition is detected
   */
  public isPartitionDetected(): boolean {
    return this.partitionDetected;
  }

  /**
   * Get partition statistics
   * @returns Partition statistics
   */
  public getPartitionStats(): {
    totalNodes: number;
    connectedNodes: number;
    suspectedNodes: number;
    partitionedNodes: number;
    recoveringNodes: number;
    partitionDetected: boolean;
    currentPartitionId?: string;
    partitionDuration?: number;
    isMajorityPartition?: boolean;
  } {
    const nodes = Array.from(this.partitionNodes.values());
    
    return {
      totalNodes: nodes.length,
      connectedNodes: nodes.filter(n => n.status === 'CONNECTED').length,
      suspectedNodes: nodes.filter(n => n.status === 'SUSPECTED').length,
      partitionedNodes: nodes.filter(n => n.status === 'PARTITIONED').length,
      recoveringNodes: nodes.filter(n => n.status === 'RECOVERING').length,
      partitionDetected: this.partitionDetected,
      currentPartitionId: this.currentPartition?.partitionId,
      partitionDuration: this.currentPartition ? 
        Date.now() - this.currentPartition.detectedAt : undefined,
      isMajorityPartition: this.currentPartition?.isMajorityPartition
    };
  }

  /**
   * Get all partition nodes
   * @returns Array of partition nodes
   */
  public getAllNodes(): PartitionNode[] {
    return Array.from(this.partitionNodes.values());
  }

  /**
   * Get connected nodes
   * @returns Array of connected node IDs
   */
  public getConnectedNodes(): string[] {
    return Array.from(this.partitionNodes.values())
      .filter(n => n.status === 'CONNECTED')
      .map(n => n.nodeId);
  }

  /**
   * Force partition detection
   */
  public forcePartitionDetection(): void {
    this.performPartitionCheck();
  }

  /**
   * Force partition resolution
   */
  public forcePartitionResolution(): void {
    if (this.partitionDetected) {
      this.resolvePartition();
    }
  }

  /**
   * Update partition configuration
   * @param newConfig - New configuration values
   */
  public updateConfig(newConfig: Partial<PartitionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   * @returns Current configuration
   */
  public getConfig(): PartitionConfig {
    return { ...this.config };
  }
}
