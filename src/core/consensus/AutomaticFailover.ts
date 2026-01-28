import { EventEmitter } from 'events';
import { NodeInfo, NodeRole } from '../types/node.types';
import { ValidatorHealth, ConsensusRound } from './FaultTolerantConsensus';

export interface FailoverConfig {
  maxFailedNodes: number;
  failoverTimeout: number;
  healthCheckInterval: number;
  minActiveValidators: number;
  leaderElectionTimeout: number;
  syncTimeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface FailoverNode {
  nodeInfo: NodeInfo;
  status: 'ACTIVE' | 'SUSPECTED' | 'FAILED' | 'RECOVERING' | 'STANDBY';
  lastSeen: number;
  consecutiveFailures: number;
  isLeader: boolean;
  priority: number;
}

export interface FailoverEvent {
  type: 'NODE_FAILED' | 'NODE_RECOVERED' | 'LEADER_CHANGED' | 'FAILOVER_TRIGGERED' | 'SYNC_COMPLETED';
  nodeId: string;
  timestamp: number;
  details?: any;
}

export interface LeaderElectionResult {
  newLeader: string;
  electionRound: number;
  participants: string[];
  votes: Map<string, string>;
  timestamp: number;
}

/**
 * Automatic failover system for consensus nodes
 * Handles leader election, node recovery, and automatic failover
 */
export class AutomaticFailover extends EventEmitter {
  private config: FailoverConfig;
  private currentNode: NodeInfo;
  private nodes: Map<string, FailoverNode> = new Map();
  private currentLeader: string | null = null;
  private electionInProgress: boolean = false;
  private failoverMode: boolean = false;
  private healthCheckTimer?: NodeJS.Timeout;
  private electionTimer?: NodeJS.Timeout;

  constructor(config: FailoverConfig, currentNode: NodeInfo) {
    super();
    this.config = config;
    this.currentNode = currentNode;
    
    // Initialize current node
    this.nodes.set(currentNode.id, {
      nodeInfo: currentNode,
      status: 'ACTIVE',
      lastSeen: Date.now(),
      consecutiveFailures: 0,
      isLeader: false,
      priority: this.calculateNodePriority(currentNode)
    });
  }

  /**
   * Start automatic failover monitoring
   */
  public start(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);

    this.emit('failoverStarted');
  }

  /**
   * Stop automatic failover monitoring
   */
  public stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = undefined;
    }

    this.emit('failoverStopped');
  }

  /**
   * Add a node to the failover system
   * @param nodeInfo - Node information
   */
  public addNode(nodeInfo: NodeInfo): void {
    const node: FailoverNode = {
      nodeInfo,
      status: 'ACTIVE',
      lastSeen: Date.now(),
      consecutiveFailures: 0,
      isLeader: false,
      priority: this.calculateNodePriority(nodeInfo)
    };

    this.nodes.set(nodeInfo.id, node);
    this.emit('nodeAdded', { nodeId: nodeInfo.id, node });
  }

  /**
   * Remove a node from the failover system
   * @param nodeId - Node ID to remove
   */
  public removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      this.nodes.delete(nodeId);
      
      if (node.isLeader) {
        this.currentLeader = null;
        this.triggerLeaderElection('LEADER_REMOVED');
      }
      
      this.emit('nodeRemoved', { nodeId, node });
    }
  }

  /**
   * Update node health status
   * @param nodeId - Node ID
   * @param health - Health information
   */
  public updateNodeHealth(nodeId: string, health: ValidatorHealth): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return;
    }

    const previousStatus = node.status;
    const now = Date.now();

    // Update node status based on health
    if (health.status === 'FAILED') {
      node.status = 'FAILED';
      node.consecutiveFailures++;
      node.lastSeen = now;
    } else if (health.status === 'SUSPECTED') {
      if (node.status === 'ACTIVE') {
        node.status = 'SUSPECTED';
      }
      node.lastSeen = now;
    } else if (health.status === 'ACTIVE') {
      if (node.status === 'FAILED' || node.status === 'SUSPECTED') {
        node.status = 'RECOVERING';
        setTimeout(() => {
          this.markNodeRecovered(nodeId);
        }, this.config.failoverTimeout);
      }
      node.lastSeen = now;
      node.consecutiveFailures = 0;
    }

    // Check if status changed
    if (previousStatus !== node.status) {
      this.handleNodeStatusChange(nodeId, previousStatus, node.status);
    }
  }

  /**
   * Handle node status change
   * @param nodeId - Node ID
   * @param previousStatus - Previous status
   * @param newStatus - New status
   */
  private handleNodeStatusChange(nodeId: string, previousStatus: string, newStatus: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const event: FailoverEvent = {
      type: newStatus === 'FAILED' ? 'NODE_FAILED' : 'NODE_RECOVERED',
      nodeId,
      timestamp: Date.now(),
      details: { previousStatus, newStatus }
    };

    this.emit('nodeStatusChanged', event);

    // Handle leader failure
    if (node.isLeader && newStatus === 'FAILED') {
      this.currentLeader = null;
      this.triggerLeaderElection('LEADER_FAILED');
    }

    // Check if we need failover
    this.checkFailoverConditions();
  }

  /**
   * Mark node as recovered
   * @param nodeId - Node ID
   */
  private markNodeRecovered(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node && node.status === 'RECOVERING') {
      node.status = 'ACTIVE';
      
      const event: FailoverEvent = {
        type: 'NODE_RECOVERED',
        nodeId,
        timestamp: Date.now()
      };

      this.emit('nodeStatusChanged', event);
      this.checkFailoverConditions();
    }
  }

  /**
   * Perform comprehensive health check on all nodes
   */
  private performHealthCheck(): void {
    const now = Date.now();
    const timeoutThreshold = this.config.healthCheckInterval * 3;

    for (const [nodeId, node] of this.nodes.entries()) {
      const timeSinceLastSeen = now - node.lastSeen;

      // Check for timeout
      if (timeSinceLastSeen > timeoutThreshold && node.status === 'ACTIVE') {
        node.status = 'SUSPECTED';
        node.consecutiveFailures++;
        
        this.emit('nodeTimeout', {
          nodeId,
          timeSinceLastSeen,
          consecutiveFailures: node.consecutiveFailures
        });

        // Mark as failed if too many consecutive timeouts
        if (node.consecutiveFailures >= 3) {
          node.status = 'FAILED';
          this.handleNodeStatusChange(nodeId, 'SUSPECTED', 'FAILED');
        }
      }
    }

    this.checkFailoverConditions();
  }

  /**
   * Check if failover conditions are met
   */
  private checkFailoverConditions(): void {
    const activeNodes = Array.from(this.nodes.values())
      .filter(n => n.status === 'ACTIVE');
    
    const failedNodes = Array.from(this.nodes.values())
      .filter(n => n.status === 'FAILED');

    // Check if we have too many failed nodes
    if (failedNodes.length >= this.config.maxFailedNodes) {
      this.triggerFailover('TOO_MANY_FAILURES', failedNodes);
      return;
    }

    // Check if we have enough active nodes
    if (activeNodes.length < this.config.minActiveValidators) {
      this.triggerFailover('INSUFFICIENT_ACTIVE_NODES', activeNodes);
      return;
    }

    // Check if leader is responsive
    if (this.currentLeader) {
      const leader = this.nodes.get(this.currentLeader);
      if (leader && leader.status !== 'ACTIVE') {
        this.triggerLeaderElection('LEADER_UNRESPONSIVE');
      }
    }
  }

  /**
   * Trigger failover process
   * @param reason - Reason for failover
   *param affectedNodes - Nodes affected by failover
   */
  private triggerFailover(reason: string, affectedNodes: FailoverNode[]): void {
    if (this.failoverMode) {
      return; // Already in failover mode
    }

    this.failoverMode = true;

    const event: FailoverEvent = {
      type: 'FAILOVER_TRIGGERED',
      nodeId: this.currentNode.id,
      timestamp: Date.now(),
      details: { reason, affectedNodes: affectedNodes.map(n => n.nodeInfo.id) }
    };

    this.emit('failoverTriggered', event);

    // Start recovery process
    this.startRecoveryProcess();
  }

  /**
   * Trigger leader election
   * @param reason - Reason for election
   */
  private triggerLeaderElection(reason: string): void {
    if (this.electionInProgress) {
      return; // Election already in progress
    }

    this.electionInProgress = true;

    this.emit('leaderElectionStarted', {
      reason,
      currentLeader: this.currentLeader,
      timestamp: Date.now()
    });

    // Start election process
    this.startLeaderElection();
  }

  /**
   * Start leader election process
   */
  private startLeaderElection(): void {
    const activeNodes = Array.from(this.nodes.values())
      .filter(n => n.status === 'ACTIVE')
      .sort((a, b) => b.priority - a.priority); // Sort by priority (highest first)

    if (activeNodes.length === 0) {
      this.electionInProgress = false;
      this.emit('leaderElectionFailed', { reason: 'NO_ACTIVE_NODES' });
      return;
    }

    // Simple priority-based election
    const newLeader = activeNodes[0];
    
    // Update leader status
    for (const node of this.nodes.values()) {
      node.isLeader = false;
    }
    
    const leaderNode = this.nodes.get(newLeader.nodeInfo.id);
    if (leaderNode) {
      leaderNode.isLeader = true;
      this.currentLeader = newLeader.nodeInfo.id;
    }

    const result: LeaderElectionResult = {
      newLeader: newLeader.nodeInfo.id,
      electionRound: 1,
      participants: activeNodes.map(n => n.nodeInfo.id),
      votes: new Map(),
      timestamp: Date.now()
    };

    this.electionInProgress = false;
    this.failoverMode = false;

    const event: FailoverEvent = {
      type: 'LEADER_CHANGED',
      nodeId: newLeader.nodeInfo.id,
      timestamp: Date.now(),
      details: { electionResult: result }
    };

    this.emit('leaderElectionCompleted', { result, event });
  }

  /**
   * Start recovery process
   */
  private startRecoveryProcess(): void {
    const failedNodes = Array.from(this.nodes.values())
      .filter(n => n.status === 'FAILED');

    this.emit('recoveryStarted', {
      failedNodes: failedNodes.map(n => n.nodeInfo.id),
      timestamp: Date.now()
    });

    // Attempt to recover failed nodes
    this.recoverFailedNodes(failedNodes);
  }

  /**
   * Attempt to recover failed nodes
   * @param failedNodes - Failed nodes to recover
   */
  private recoverFailedNodes(failedNodes: FailoverNode[]): void {
    let recoveredCount = 0;

    for (const node of failedNodes) {
      setTimeout(() => {
        this.attemptNodeRecovery(node.nodeInfo.id);
      }, recoveredCount * this.config.retryDelay);
      
      recoveredCount++;
    }
  }

  /**
   * Attempt to recover a specific node
   * @param nodeId - Node ID to recover
   */
  private attemptNodeRecovery(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.status !== 'FAILED') {
      return;
    }

    this.emit('nodeRecoveryAttempt', {
      nodeId,
      attempt: node.consecutiveFailures + 1,
      timestamp: Date.now()
    });

    // Simulate recovery attempt
    // In a real implementation, this would involve network calls, health checks, etc.
    setTimeout(() => {
      const recoverySuccess = Math.random() > 0.3; // 70% success rate
      
      if (recoverySuccess) {
        node.status = 'RECOVERING';
        node.lastSeen = Date.now();
        
        setTimeout(() => {
          this.markNodeRecovered(nodeId);
        }, this.config.failoverTimeout);
      } else {
        // Recovery failed, increment consecutive failures
        node.consecutiveFailures++;
        
        if (node.consecutiveFailures < this.config.retryAttempts) {
          // Retry recovery
          setTimeout(() => {
            this.attemptNodeRecovery(nodeId);
          }, this.config.retryDelay);
        } else {
          // Mark as permanently failed
          this.emit('nodeRecoveryFailed', {
            nodeId,
            attempts: node.consecutiveFailures,
            timestamp: Date.now()
          });
        }
      }
    }, 1000); // Simulate recovery attempt duration
  }

  /**
   * Calculate node priority for election
   * @param nodeInfo - Node information
   * @returns Priority score
   */
  private calculateNodePriority(nodeInfo: NodeInfo): number {
    let priority = 0;

    // Role-based priority
    switch (nodeInfo.role) {
      case NodeRole.AUTHORITY:
        priority += 100;
        break;
      case NodeRole.VALIDATOR:
        priority += 50;
        break;
      case NodeRole.PEER:
        priority += 10;
        break;
    }

    // Reputation-based priority (if available)
    if (nodeInfo.reputation) {
      priority += nodeInfo.reputation;
    }

    // Random factor to prevent ties
    priority += Math.random() * 10;

    return priority;
  }

  /**
   * Get current leader
   * @returns Current leader ID or null
   */
  public getCurrentLeader(): string | null {
    return this.currentLeader;
  }

  /**
   * Check if current node is leader
   * @returns True if current node is leader
   */
  public isCurrentNodeLeader(): boolean {
    return this.currentLeader === this.currentNode.id;
  }

  /**
   * Get all nodes with their status
   * @returns Array of failover nodes
   */
  public getAllNodes(): FailoverNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get active nodes
   * @returns Array of active nodes
   */
  public getActiveNodes(): FailoverNode[] {
    return Array.from(this.nodes.values())
      .filter(n => n.status === 'ACTIVE');
  }

  /**
   * Get failed nodes
   * @returns Array of failed nodes
   */
  public getFailedNodes(): FailoverNode[] {
    return Array.from(this.nodes.values())
      .filter(n => n.status === 'FAILED');
  }

  /**
   * Get failover statistics
   * @returns Statistics object
   */
  public getFailoverStats(): {
    totalNodes: number;
    activeNodes: number;
    suspectedNodes: number;
    failedNodes: number;
    recoveringNodes: number;
    currentLeader: string | null;
    isLeader: boolean;
    failoverMode: boolean;
    electionInProgress: boolean;
  } {
    const nodes = Array.from(this.nodes.values());

    return {
      totalNodes: nodes.length,
      activeNodes: nodes.filter(n => n.status === 'ACTIVE').length,
      suspectedNodes: nodes.filter(n => n.status === 'SUSPECTED').length,
      failedNodes: nodes.filter(n => n.status === 'FAILED').length,
      recoveringNodes: nodes.filter(n => n.status === 'RECOVERING').length,
      currentLeader: this.currentLeader,
      isLeader: this.isCurrentNodeLeader(),
      failoverMode: this.failoverMode,
      electionInProgress: this.electionInProgress
    };
  }

  /**
   * Update failover configuration
   * @param newConfig - New configuration values
   */
  public updateConfig(newConfig: Partial<FailoverConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   * @returns Current configuration
   */
  public getConfig(): FailoverConfig {
    return { ...this.config };
  }

  /**
   * Force trigger leader election
   */
  public forceLeaderElection(): void {
    this.triggerLeaderElection('MANUAL_TRIGGER');
  }

  /**
   * Force trigger failover
   */
  public forceFailover(): void {
    this.triggerFailover('MANUAL_TRIGGER', this.getFailedNodes());
  }
}
