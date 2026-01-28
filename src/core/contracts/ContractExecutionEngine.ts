import { EventEmitter } from 'events';
import { SmartContract, ContractContext, ContractExecutionResult, ContractLog } from './SmartContract';
import { Transaction } from '../types/block.types';
import { CryptoUtils } from '../crypto';

export interface ExecutionConfig {
  maxGasLimit: number;
  maxContractSize: number;
  maxExecutionTime: number;
  enableDebugMode: boolean;
  securityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'STRICT';
}

export interface ExecutionRequest {
  contractAddress: string;
  functionName: string;
  args: any[];
  sender: string;
  value: string;
  gasLimit: number;
  gasPrice: string;
  transaction: Transaction;
}

export interface ExecutionEnvironment {
  contracts: Map<string, SmartContract>;
  blockNumber: number;
  timestamp: number;
  gasUsed: number;
  logs: ContractLog[];
  debug: boolean;
}

export interface SecurityPolicy {
  allowExternalCalls: boolean;
  allowSelfDestruct: boolean;
  allowDelegateCall: boolean;
  maxReentrancyDepth: number;
  allowedLibraries: string[];
}

/**
 * Contract execution engine for smart contracts
 * Provides secure, sandboxed execution environment with gas metering
 */
export class ContractExecutionEngine extends EventEmitter {
  private config: ExecutionConfig;
  private environment: ExecutionEnvironment;
  private securityPolicy: SecurityPolicy;
  private executionStats: Map<string, any> = new Map();

  constructor(config: Partial<ExecutionConfig> = {}) {
    super();
    
    this.config = {
      maxGasLimit: 10000000,
      maxContractSize: 24576, // 24KB
      maxExecutionTime: 5000, // 5 seconds
      enableDebugMode: false,
      securityLevel: 'HIGH',
      ...config
    };

    this.environment = {
      contracts: new Map(),
      blockNumber: 0,
      timestamp: Date.now(),
      gasUsed: 0,
      logs: [],
      debug: this.config.enableDebugMode
    };

    this.securityPolicy = {
      allowExternalCalls: false,
      allowSelfDestruct: false,
      allowDelegateCall: false,
      maxReentrancyDepth: 3,
      allowedLibraries: []
    };
  }

  /**
   * Deploy a new contract
   * @param contract - Smart contract instance
   * @param deployer - Deployer address
   * @param value - Deployment value
   * @returns Deployment result
   */
  public async deployContract(
    contract: SmartContract, 
    deployer: string, 
    value: string = '0'
  ): Promise<{ success: boolean; address?: string; error?: string }> {
    try {
      // Validate contract
      const validation = contract.validateContract();
      const errors = validation.filter(v => !v.valid);
      if (errors.length > 0) {
        return {
          success: false,
          error: `Contract validation failed: ${errors.map(e => e.error).join(', ')}`
        };
      }

      // Check contract size
      if (contract.bytecode.length > this.config.maxContractSize) {
        return {
          success: false,
          error: `Contract too large: ${contract.bytecode.length} > ${this.config.maxContractSize}`
        };
      }

      // Add to environment
      this.environment.contracts.set(contract.address, contract);

      // Initialize contract balance
      if (value !== '0') {
        contract.updateBalance(value);
      }

      // Update stats
      this.updateExecutionStats('deployments', 1);

      this.emit('contractDeployed', {
        address: contract.address,
        deployer,
        value,
        timestamp: Date.now()
      });

      return {
        success: true,
        address: contract.address
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Deployment failed'
      };
    }
  }

  /**
   * Execute a contract function
   * @param request - Execution request
   * @returns Execution result
   */
  public async executeContract(request: ExecutionRequest): Promise<ContractExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Get contract
      const contract = this.environment.contracts.get(request.contractAddress);
      if (!contract) {
        return {
          success: false,
          gasUsed: 0,
          events: [],
          error: `Contract not found: ${request.contractAddress}`
        };
      }

      // Validate gas limit
      if (request.gasLimit > this.config.maxGasLimit) {
        return {
          success: false,
          gasUsed: 0,
          events: [],
          error: `Gas limit too high: ${request.gasLimit} > ${this.config.maxGasLimit}`
        };
      }

      // Create execution context
      const context: ContractContext = {
        contract: contract.state,
        sender: request.sender,
        value: request.value,
        gasLimit: request.gasLimit,
        gasUsed: 0,
        blockNumber: this.environment.blockNumber,
        timestamp: this.environment.timestamp,
        transaction: request.transaction
      };

      // Security checks
      const securityCheck = this.performSecurityCheck(contract, request);
      if (!securityCheck.valid) {
        return {
          success: false,
          gasUsed: 0,
          events: [],
          error: securityCheck.error
        };
      }

      // Execute with timeout
      const result = await this.executeWithTimeout(
        contract.executeFunction(request.functionName, request.args, context),
        this.config.maxExecutionTime
      );

      // Update environment
      this.environment.gasUsed += result.gasUsed;
      this.environment.logs.push(...result.events);

      // Update stats
      const executionTime = Date.now() - startTime;
      this.updateExecutionStats('executions', {
        count: 1,
        totalGas: result.gasUsed,
        totalTime: executionTime,
        success: result.success
      });

      // Emit events
      if (result.success) {
        this.emit('functionExecuted', {
          contractAddress: request.contractAddress,
          functionName: request.functionName,
          sender: request.sender,
          gasUsed: result.gasUsed,
          executionTime,
          events: result.events.length
        });
      } else {
        this.emit('executionFailed', {
          contractAddress: request.contractAddress,
          functionName: request.functionName,
          sender: request.sender,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      this.updateExecutionStats('executions', {
        count: 1,
        totalTime: executionTime,
        success: false
      });

      this.emit('executionFailed', {
        contractAddress: request.contractAddress,
        functionName: request.functionName,
        sender: request.sender,
        error: error instanceof Error ? error.message : 'Execution failed'
      });

      return {
        success: false,
        gasUsed: request.gasLimit,
        events: [],
        error: error instanceof Error ? error.message : 'Execution failed'
      };
    }
  }

  /**
   * Perform security checks before execution
   */
  private performSecurityCheck(
    contract: SmartContract, 
    request: ExecutionRequest
  ): { valid: boolean; error?: string } {
    // Check sender permissions
    if (!this.isValidSender(request.sender)) {
      return {
        valid: false,
        error: 'Invalid sender address'
      };
    }

    // Check value transfer
    if (request.value !== '0' && !this.canReceiveValue(contract, request.functionName)) {
      return {
        valid: false,
        error: 'Function cannot receive value'
      };
    }

    // Check reentrancy
    if (this.isReentrancyAttempt(request)) {
      return {
        valid: false,
        error: 'Reentrancy detected'
      };
    }

    // Check function permissions
    if (!this.hasPermission(request.sender, contract, request.functionName)) {
      return {
        valid: false,
        error: 'Insufficient permissions'
      };
    }

    return { valid: true };
  }

  /**
   * Execute with timeout protection
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Validate sender address
   */
  private isValidSender(sender: string): boolean {
    // Basic address validation
    return typeof sender === 'string' && 
           sender.length === 42 && 
           sender.startsWith('0x');
  }

  /**
   * Check if function can receive value
   */
  private canReceiveValue(contract: SmartContract, functionName: string): boolean {
    const func = contract.abi.functions.find(f => f.name === functionName);
    return func ? func.mutability === 'payable' : false;
  }

  /**
   * Check for reentrancy attempt
   */
  private isReentrancyAttempt(request: ExecutionRequest): boolean {
    // Simple reentrancy detection - in production, this would be more sophisticated
    const key = `${request.contractAddress}_${request.sender}`;
    const attempts = this.executionStats.get(key) || 0;
    return attempts >= this.securityPolicy.maxReentrancyDepth;
  }

  /**
   * Check if sender has permission to execute function
   */
  private hasPermission(
    sender: string, 
    contract: SmartContract, 
    functionName: string
  ): boolean {
    // For demo purposes, allow all executions
    // In production, this would check role-based permissions
    return true;
  }

  /**
   * Update execution statistics
   */
  private updateExecutionStats(key: string, value: any): void {
    const current = this.executionStats.get(key) || 0;
    
    if (typeof value === 'number') {
      this.executionStats.set(key, current + value);
    } else if (typeof value === 'object') {
      const existing = this.executionStats.get(key) || { count: 0, totalGas: 0, totalTime: 0, success: 0 };
      this.executionStats.set(key, {
        count: existing.count + value.count,
        totalGas: existing.totalGas + (value.totalGas || 0),
        totalTime: existing.totalTime + (value.totalTime || 0),
        success: existing.success + (value.success ? 1 : 0)
      });
    }
  }

  /**
   * Get execution statistics
   */
  public getExecutionStats(): {
    totalContracts: number;
    totalExecutions: number;
    totalGasUsed: number;
    averageExecutionTime: number;
    successRate: number;
    currentBlock: number;
    environmentGasUsed: number;
  } {
    const executions = this.executionStats.get('executions') || { count: 0, totalGas: 0, totalTime: 0, success: 0 };
    const deployments = this.executionStats.get('deployments') || 0;

    return {
      totalContracts: this.environment.contracts.size,
      totalExecutions: executions.count,
      totalGasUsed: executions.totalGas,
      averageExecutionTime: executions.count > 0 ? executions.totalTime / executions.count : 0,
      successRate: executions.count > 0 ? executions.success / executions.count : 0,
      currentBlock: this.environment.blockNumber,
      environmentGasUsed: this.environment.gasUsed
    };
  }

  /**
   * Get all deployed contracts
   */
  public getContracts(): SmartContract[] {
    return Array.from(this.environment.contracts.values());
  }

  /**
   * Get contract by address
   */
  public getContract(address: string): SmartContract | undefined {
    return this.environment.contracts.get(address);
  }

  /**
   * Update block number
   */
  public updateBlockNumber(blockNumber: number): void {
    this.environment.blockNumber = blockNumber;
    this.emit('blockUpdated', { blockNumber });
  }

  /**
   * Update timestamp
   */
  public updateTimestamp(timestamp: number): void {
    this.environment.timestamp = timestamp;
  }

  /**
   * Get execution logs
   */
  public getLogs(): ContractLog[] {
    return [...this.environment.logs];
  }

  /**
   * Clear execution logs
   */
  public clearLogs(): void {
    this.environment.logs = [];
    this.emit('logsCleared');
  }

  /**
   * Update security policy
   */
  public updateSecurityPolicy(policy: Partial<SecurityPolicy>): void {
    this.securityPolicy = { ...this.securityPolicy, ...policy };
    this.emit('securityPolicyUpdated', this.securityPolicy);
  }

  /**
   * Get security policy
   */
  public getSecurityPolicy(): SecurityPolicy {
    return { ...this.securityPolicy };
  }

  /**
   * Update execution configuration
   */
  public updateConfig(config: Partial<ExecutionConfig>): void {
    this.config = { ...this.config, ...config };
    this.environment.debug = this.config.enableDebugMode;
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): ExecutionConfig {
    return { ...this.config };
  }

  /**
   * Reset execution engine state
   */
  public reset(): void {
    this.environment.contracts.clear();
    this.environment.gasUsed = 0;
    this.environment.logs = [];
    this.executionStats.clear();
    
    this.emit('engineReset');
  }

  /**
   * Create execution snapshot
   */
  public createSnapshot(): {
    contracts: Record<string, any>;
    blockNumber: number;
    timestamp: number;
    gasUsed: number;
    stats: Record<string, any>;
  } {
    const contracts: Record<string, any> = {};
    
    for (const [address, contract] of this.environment.contracts.entries()) {
      contracts[address] = contract.serializeState();
    }

    const stats: Record<string, any> = {};
    for (const [key, value] of this.executionStats.entries()) {
      stats[key] = value;
    }

    return {
      contracts,
      blockNumber: this.environment.blockNumber,
      timestamp: this.environment.timestamp,
      gasUsed: this.environment.gasUsed,
      stats
    };
  }

  /**
   * Restore execution snapshot
   */
  public restoreSnapshot(snapshot: any): void {
    this.reset();
    
    // Restore contracts
    for (const [address, state] of Object.entries(snapshot.contracts)) {
      // Note: This would need the contract class to be available
      // For now, we'll just store the state
      console.log(`Restoring contract ${address}`);
    }

    // Restore environment
    this.environment.blockNumber = snapshot.blockNumber;
    this.environment.timestamp = snapshot.timestamp;
    this.environment.gasUsed = snapshot.gasUsed;

    // Restore stats
    for (const [key, value] of Object.entries(snapshot.stats)) {
      this.executionStats.set(key, value);
    }

    this.emit('snapshotRestored');
  }

  /**
   * Estimate gas for function execution
   */
  public estimateGas(
    contractAddress: string,
    functionName: string,
    args: any[]
  ): { success: boolean; gasUsed?: number; error?: string } {
    try {
      const contract = this.environment.contracts.get(contractAddress);
      if (!contract) {
        return {
          success: false,
          error: `Contract not found: ${contractAddress}`
        };
      }

      const func = contract.abi.functions.find(f => f.name === functionName);
      if (!func) {
        return {
          success: false,
          error: `Function not found: ${functionName}`
        };
      }

      // Simple gas estimation
      let gas = 21000; // Base gas
      
      // Add gas for arguments
      for (const param of func.inputs) {
        switch (param.type) {
          case 'string':
            gas += 100 + (args.length * 10);
            break;
          case 'bytes':
          case 'bytes32':
            gas += 100;
            break;
          default:
            gas += 50;
        }
      }

      // Add function-specific gas
      gas += func.gasLimit || 50000;

      return {
        success: true,
        gasUsed: gas
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Gas estimation failed'
      };
    }
  }
}
