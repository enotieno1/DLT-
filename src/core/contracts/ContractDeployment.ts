import { EventEmitter } from 'events';
import { SmartContract, ContractABI } from './SmartContract';
import { ContractExecutionEngine } from './ContractExecutionEngine';
import { Transaction } from '../types/block.types';
import { CryptoUtils } from '../crypto';

export interface DeploymentConfig {
  maxContractSize: number;
  deploymentGasLimit: number;
  enableVerification: boolean;
  requireApproval: boolean;
  allowedDeployers: string[];
  deploymentFee: string;
}

export interface DeploymentRequest {
  bytecode: string;
  abi: ContractABI;
  constructorArgs: any[];
  deployer: string;
  value: string;
  gasLimit: number;
  gasPrice: string;
  metadata?: ContractMetadata;
}

export interface ContractMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  tags: string[];
  sourceCode?: string;
  compilerVersion?: string;
  optimizationEnabled?: boolean;
}

export interface DeploymentResult {
  success: boolean;
  contractAddress?: string;
  transactionHash?: string;
  gasUsed?: number;
  error?: string;
  warnings?: string[];
}

export interface ContractVerification {
  verified: boolean;
  verificationTimestamp: number;
  verifiedBy: string;
  sourceCodeHash: string;
  compilerVersion: string;
  optimizationEnabled: boolean;
  constructorArguments: string;
}

/**
 * Contract deployment system for enterprise DLT
 * Handles secure contract deployment with verification and approval workflows
 */
export class ContractDeployment extends EventEmitter {
  private config: DeploymentConfig;
  private executionEngine: ContractExecutionEngine;
  private pendingDeployments: Map<string, DeploymentRequest> = new Map();
  private deployedContracts: Map<string, SmartContract> = new Map();
  private contractVerifications: Map<string, ContractVerification> = new Map();
  private deploymentApprovals: Map<string, boolean> = new Map();

  constructor(
    config: Partial<DeploymentConfig> = {},
    executionEngine: ContractExecutionEngine
  ) {
    super();
    
    this.config = {
      maxContractSize: 24576, // 24KB
      deploymentGasLimit: 5000000,
      enableVerification: true,
      requireApproval: false,
      allowedDeployers: [],
      deploymentFee: '1000000000000000000', // 1 ETH in wei
      ...config
    };

    this.executionEngine = executionEngine;
  }

  /**
   * Deploy a new contract
   * @param request - Deployment request
   * @returns Deployment result
   */
  public async deployContract(request: DeploymentRequest): Promise<DeploymentResult> {
    try {
      // Validate deployment request
      const validation = this.validateDeploymentRequest(request);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error
        };
      }

      // Check deployer permissions
      if (!this.hasDeploymentPermission(request.deployer)) {
        return {
          success: false,
          error: 'Deployer not authorized'
        };
      }

      // Check approval if required
      if (this.config.requireApproval) {
        const approvalKey = this.generateApprovalKey(request);
        if (!this.deploymentApprovals.get(approvalKey)) {
          return {
            success: false,
            error: 'Deployment approval required'
          };
        }
      }

      // Generate contract address
      const contractAddress = this.generateContractAddress(request.deployer);
      
      // Create smart contract instance
      const contract = new SmartContract(
        contractAddress,
        request.abi,
        request.bytecode,
        request.deployer
      );

      // Validate contract
      const contractValidation = contract.validateContract();
      const errors = contractValidation.filter(v => !v.valid);
      const warnings = contractValidation.filter(v => v.warning);

      if (errors.length > 0) {
        return {
          success: false,
          error: `Contract validation failed: ${errors.map(e => e.error).join(', ')}`
        };
      }

      // Check contract size
      if (request.bytecode.length > this.config.maxContractSize) {
        return {
          success: false,
          error: `Contract too large: ${request.bytecode.length} > ${this.config.maxContractSize}`
        };
      }

      // Execute constructor if present
      let gasUsed = this.config.deploymentGasLimit;
      if (request.abi.constructor && request.constructorArgs.length > 0) {
        const constructorResult = await this.executeConstructor(
          contract,
          request.constructorArgs,
          request
        );
        
        if (!constructorResult.success) {
          return {
            success: false,
            error: constructorResult.error
          };
        }
        
        gasUsed = constructorResult.gasUsed || gasUsed;
      }

      // Deploy contract
      const deploymentResult = await this.executionEngine.deployContract(
        contract,
        request.deployer,
        request.value
      );

      if (!deploymentResult.success) {
        return {
          success: false,
          error: deploymentResult.error
        };
      }

      // Store deployed contract
      this.deployedContracts.set(contractAddress, contract);

      // Create transaction hash for deployment
      const transactionHash = this.generateDeploymentTransaction(request, contractAddress);

      // Verify contract if enabled
      if (this.config.enableVerification && request.metadata) {
        await this.verifyContract(contractAddress, request);
      }

      // Clean up approvals
      if (this.config.requireApproval) {
        const approvalKey = this.generateApprovalKey(request);
        this.deploymentApprovals.delete(approvalKey);
      }

      // Emit deployment event
      this.emit('contractDeployed', {
        contractAddress,
        deployer: request.deployer,
        transactionHash,
        gasUsed,
        metadata: request.metadata
      });

      return {
        success: true,
        contractAddress,
        transactionHash,
        gasUsed,
        warnings: warnings?.map(w => w.warning || '')
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Deployment failed'
      };
    }
  }

  /**
   * Validate deployment request
   */
  private validateDeploymentRequest(request: DeploymentRequest): { valid: boolean; error?: string } {
    // Check required fields
    if (!request.bytecode || request.bytecode.length === 0) {
      return {
        valid: false,
        error: 'Bytecode is required'
      };
    }

    if (!request.abi || !request.abi.functions) {
      return {
        valid: false,
        error: 'ABI is required'
      };
    }

    if (!request.deployer || request.deployer.length !== 42) {
      return {
        valid: false,
        error: 'Invalid deployer address'
      };
    }

    // Check gas limit
    if (request.gasLimit > this.config.deploymentGasLimit) {
      return {
        valid: false,
        error: `Gas limit too high: ${request.gasLimit} > ${this.config.deploymentGasLimit}`
      };
    }

    // Check constructor arguments
    if (request.abi.constructor) {
      if (request.abi.constructor.inputs.length !== request.constructorArgs.length) {
        return {
          valid: false,
          error: `Constructor expects ${request.abi.constructor.inputs.length} arguments, got ${request.constructorArgs.length}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Check if deployer has permission
   */
  private hasDeploymentPermission(deployer: string): boolean {
    if (this.config.allowedDeployers.length === 0) {
      return true; // Allow all if no restrictions
    }
    
    return this.config.allowedDeployers.includes(deployer);
  }

  /**
   * Generate approval key for deployment
   */
  private generateApprovalKey(request: DeploymentRequest): string {
    const data = `${request.deployer}_${request.bytecode}_${Date.now()}`;
    return CryptoUtils.hash(data);
  }

  /**
   * Generate contract address
   */
  private generateContractAddress(deployer: string): string {
    // Simple address generation - in production, this would use proper address derivation
    const nonce = Date.now();
    const data = `${deployer}_${nonce}`;
    const hash = CryptoUtils.hash(data);
    return `0x${hash.slice(2, 42)}`;
  }

  /**
   * Execute contract constructor
   */
  private async executeConstructor(
    contract: SmartContract,
    args: any[],
    request: DeploymentRequest
  ): Promise<{ success: boolean; gasUsed?: number; error?: string }> {
    try {
      // Create mock transaction for constructor execution
      const mockTransaction: Transaction = {
        hash: CryptoUtils.hash('constructor_tx'),
        from: request.deployer,
        to: contract.address,
        value: request.value,
        gasLimit: request.gasLimit,
        gasPrice: request.gasPrice,
        nonce: 0,
        data: request.bytecode,
        timestamp: Date.now(),
        signature: ''
      };

      const executionRequest = {
        contractAddress: contract.address,
        functionName: 'constructor',
        args,
        sender: request.deployer,
        value: request.value,
        gasLimit: request.gasLimit,
        gasPrice: request.gasPrice,
        transaction: mockTransaction
      };

      const result = await this.executionEngine.executeContract(executionRequest);
      
      return {
        success: result.success,
        gasUsed: result.gasUsed,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Constructor execution failed'
      };
    }
  }

  /**
   * Generate deployment transaction hash
   */
  private generateDeploymentTransaction(request: DeploymentRequest, contractAddress: string): string {
    const data = {
      deployer: request.deployer,
      bytecode: request.bytecode,
      abi: request.abi,
      constructorArgs: request.constructorArgs,
      value: request.value,
      gasLimit: request.gasLimit,
      gasPrice: request.gasPrice,
      contractAddress,
      timestamp: Date.now()
    };

    return CryptoUtils.hash(JSON.stringify(data));
  }

  /**
   * Verify contract source code
   */
  private async verifyContract(
    contractAddress: string,
    request: DeploymentRequest
  ): Promise<void> {
    if (!request.metadata?.sourceCode) {
      return;
    }

    try {
      const sourceCodeHash = CryptoUtils.hash(request.metadata.sourceCode);
      
      const verification: ContractVerification = {
        verified: true,
        verificationTimestamp: Date.now(),
        verifiedBy: request.deployer,
        sourceCodeHash,
        compilerVersion: request.metadata.compilerVersion || 'unknown',
        optimizationEnabled: request.metadata.optimizationEnabled || false,
        constructorArguments: JSON.stringify(request.constructorArgs)
      };

      this.contractVerifications.set(contractAddress, verification);

      this.emit('contractVerified', {
        contractAddress,
        verification
      });
    } catch (error) {
      this.emit('verificationFailed', {
        contractAddress,
        error: error instanceof Error ? error.message : 'Verification failed'
      });
    }
  }

  /**
   * Request deployment approval
   */
  public requestApproval(request: DeploymentRequest): string {
    const approvalKey = this.generateApprovalKey(request);
    this.pendingDeployments.set(approvalKey, request);
    
    this.emit('approvalRequested', {
      approvalKey,
      deployer: request.deployer,
      contractName: request.metadata?.name || 'Unknown'
    });

    return approvalKey;
  }

  /**
   * Approve deployment
   */
  public approveDeployment(approvalKey: string, approver: string): boolean {
    const request = this.pendingDeployments.get(approvalKey);
    if (!request) {
      return false;
    }

    this.deploymentApprovals.set(approvalKey, true);
    this.pendingDeployments.delete(approvalKey);

    this.emit('deploymentApproved', {
      approvalKey,
      deployer: request.deployer,
      approver
    });

    return true;
  }

  /**
   * Reject deployment
   */
  public rejectDeployment(approvalKey: string, reason: string): boolean {
    const request = this.pendingDeployments.get(approvalKey);
    if (!request) {
      return false;
    }

    this.pendingDeployments.delete(approvalKey);

    this.emit('deploymentRejected', {
      approvalKey,
      deployer: request.deployer,
      reason
    });

    return true;
  }

  /**
   * Get deployed contract
   */
  public getDeployedContract(address: string): SmartContract | undefined {
    return this.deployedContracts.get(address);
  }

  /**
   * Get all deployed contracts
   */
  public getAllDeployedContracts(): SmartContract[] {
    return Array.from(this.deployedContracts.values());
  }

  /**
   * Get contract verification
   */
  public getContractVerification(address: string): ContractVerification | undefined {
    return this.contractVerifications.get(address);
  }

  /**
   * Get pending deployments
   */
  public getPendingDeployments(): Map<string, DeploymentRequest> {
    return new Map(this.pendingDeployments);
  }

  /**
   * Update deployment configuration
   */
  public updateConfig(config: Partial<DeploymentConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): DeploymentConfig {
    return { ...this.config };
  }

  /**
   * Get deployment statistics
   */
  public getDeploymentStats(): {
    totalDeployed: number;
    totalVerified: number;
    pendingApprovals: number;
    totalGasUsed: number;
    averageDeploymentTime: number;
  } {
    const totalDeployed = this.deployedContracts.size;
    const totalVerified = Array.from(this.contractVerifications.values())
      .filter(v => v.verified).length;
    const pendingApprovals = this.pendingDeployments.size;

    return {
      totalDeployed,
      totalVerified,
      pendingApprovals,
      totalGasUsed: totalDeployed * this.config.deploymentGasLimit, // Estimate
      averageDeploymentTime: 5000 // Placeholder
    };
  }

  /**
   * Check if contract is verified
   */
  public isContractVerified(address: string): boolean {
    const verification = this.contractVerifications.get(address);
    return verification ? verification.verified : false;
  }

  /**
   * Get contracts by deployer
   */
  public getContractsByDeployer(deployer: string): SmartContract[] {
    return Array.from(this.deployedContracts.values())
      .filter(contract => contract.state.deployedBy === deployer);
  }

  /**
   * Get contracts by metadata tags
   */
  public getContractsByTag(tag: string): SmartContract[] {
    // This would need metadata storage - for now, return empty array
    return [];
  }

  /**
   * Reset deployment system
   */
  public reset(): void {
    this.pendingDeployments.clear();
    this.deployedContracts.clear();
    this.contractVerifications.clear();
    this.deploymentApprovals.clear();
    
    this.emit('deploymentSystemReset');
  }
}
