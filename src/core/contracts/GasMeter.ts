import { EventEmitter } from 'events';
import { SmartContract } from './SmartContract';
import { Transaction } from '../types/block.types';

export interface GasConfig {
  baseGasPrice: number;
  maxGasPrice: number;
  gasLimitPerBlock: number;
  minGasLimit: number;
  maxGasLimit: number;
  gasRefundEnabled: boolean;
  gasDiscounts: GasDiscount[];
}

export interface GasDiscount {
  condition: string;
  percentage: number;
  description: string;
}

export interface GasUsage {
  contractAddress: string;
  functionName: string;
  gasUsed: number;
  gasLimit: number;
  gasPrice: number;
  cost: string;
  timestamp: number;
  transactionHash: string;
}

export interface GasEstimate {
  gasUsed: number;
  gasPrice: number;
  totalCost: string;
  confidence: number;
  warnings: string[];
}

export interface GasPolicy {
  maxGasPerTransaction: number;
  maxGasPerContract: number;
  gasLimitIncreasePercentage: number;
  emergencyGasLimit: number;
  gasRefundPercentage: number;
}

/**
 * Gas metering and management system for smart contracts
 * Provides comprehensive gas tracking, estimation, and policy enforcement
 */
export class GasMeter extends EventEmitter {
  private config: GasConfig;
  private policy: GasPolicy;
  private gasUsageHistory: GasUsage[] = [];
  private currentGasPrice: number;
  private gasRefunds: Map<string, number> = new Map();
  private gasDiscounts: Map<string, GasDiscount[]> = new Map();

  constructor(config: Partial<GasConfig> = {}) {
    super();
    
    this.config = {
      baseGasPrice: 20, // 20 gwei
      maxGasPrice: 1000, // 1000 gwei
      gasLimitPerBlock: 15000000,
      minGasLimit: 21000,
      maxGasLimit: 10000000,
      gasRefundEnabled: true,
      gasDiscounts: [],
      ...config
    };

    this.policy = {
      maxGasPerTransaction: 10000000,
      maxGasPerContract: 5000000,
      gasLimitIncreasePercentage: 10,
      emergencyGasLimit: 20000000,
      gasRefundPercentage: 50
    };

    this.currentGasPrice = this.config.baseGasPrice;
    
    this.initializeDefaultDiscounts();
    this.startGasPriceMonitoring();
  }

  /**
   * Calculate gas cost for transaction
   * @param gasUsed - Amount of gas used
   * @param gasPrice - Gas price in gwei
   * @returns Cost in wei
   */
  public calculateGasCost(gasUsed: number, gasPrice: number): string {
    const costInGwei = gasUsed * gasPrice;
    const costInWei = costInGwei * 1000000000; // Convert gwei to wei
    return costInWei.toString();
  }

  /**
   * Estimate gas for contract execution
   * @param contract - Smart contract
   * @param functionName - Function name
   * @param args - Function arguments
   * @param sender - Sender address
   * @returns Gas estimate
   */
  public estimateGas(
    contract: SmartContract,
    functionName: string,
    args: any[],
    sender: string
  ): GasEstimate {
    try {
      // Get function from ABI
      const func = contract.abi.functions.find(f => f.name === functionName);
      if (!func) {
        return {
          gasUsed: 0,
          gasPrice: this.currentGasPrice,
          totalCost: '0',
          confidence: 0,
          warnings: [`Function ${functionName} not found`]
        };
      }

      // Calculate base gas
      let gasUsed = 21000; // Base transaction gas

      // Add gas for function execution
      gasUsed += this.calculateFunctionGas(func, args);

      // Add gas for storage operations
      gasUsed += this.estimateStorageGas(func, args);

      // Add gas for contract creation if applicable
      if (functionName === 'constructor') {
        gasUsed += 32000; // Contract creation gas
      }

      // Apply discounts
      const discount = this.getApplicableDiscount(sender, contract, functionName);
      const discountedGas = Math.round(gasUsed * (1 - discount.percentage / 100));

      // Calculate total cost
      const totalCost = this.calculateGasCost(discountedGas, this.currentGasPrice);

      // Calculate confidence based on historical data
      const confidence = this.calculateEstimateConfidence(contract.address, functionName, gasUsed);

      // Generate warnings
      const warnings = this.generateGasWarnings(gasUsed, func);

      return {
        gasUsed: discountedGas,
        gasPrice: this.currentGasPrice,
        totalCost,
        confidence,
        warnings
      };
    } catch (error) {
      return {
        gasUsed: 0,
        gasPrice: this.currentGasPrice,
        totalCost: '0',
        confidence: 0,
        warnings: [error instanceof Error ? error.message : 'Estimation failed']
      };
    }
  }

  /**
   * Calculate gas for function execution
   */
  private calculateFunctionGas(func: any, args: any[]): number {
    let gas = 0;

    // Base function call gas
    gas += 700;

    // Add gas for each argument
    for (let i = 0; i < func.inputs.length; i++) {
      const param = func.inputs[i];
      const arg = args[i];

      switch (param.type) {
        case 'uint256':
        case 'int256':
          gas += 32;
          break;
        case 'address':
          gas += 40;
          break;
        case 'bool':
          gas += 8;
          break;
        case 'string':
          gas += 100 + (typeof arg === 'string' ? arg.length * 10 : 0);
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
    if (func.gasLimit) {
      gas = Math.max(gas, func.gasLimit);
    }

    return gas;
  }

  /**
   * Estimate gas for storage operations
   */
  private estimateStorageGas(func: any, args: any[]): number {
    let gas = 0;

    // Estimate storage reads/writes based on function mutability
    switch (func.mutability) {
      case 'view':
      case 'pure':
        // Only storage reads
        gas += 200 * func.inputs.length;
        break;
      case 'nonpayable':
      case 'payable':
        // Storage writes
        gas += 20000 * func.inputs.length;
        break;
    }

    return gas;
  }

  /**
   * Get applicable discount for sender
   */
  private getApplicableDiscount(
    sender: string,
    contract: SmartContract,
    functionName: string
  ): GasDiscount {
    const key = `${sender}_${contract.address}`;
    const discounts = this.gasDiscounts.get(key) || [];

    // Return the best discount (highest percentage)
    return discounts.reduce((best, current) => 
      current.percentage > best.percentage ? current : best,
      { condition: 'none', percentage: 0, description: 'No discount' }
    );
  }

  /**
   * Calculate estimation confidence
   */
  private calculateEstimateConfidence(
    contractAddress: string,
    functionName: string,
    estimatedGas: number
  ): number {
    // Get historical gas usage for this function
    const historical = this.gasUsageHistory.filter(
      usage => usage.contractAddress === contractAddress && usage.functionName === functionName
    );

    if (historical.length === 0) {
      return 0.5; // Default confidence for new functions
    }

    // Calculate variance from historical data
    const averageGas = historical.reduce((sum, usage) => sum + usage.gasUsed, 0) / historical.length;
    const variance = Math.abs(estimatedGas - averageGas) / averageGas;

    // Higher confidence for lower variance
    return Math.max(0, Math.min(1, 1 - variance));
  }

  /**
   * Generate gas warnings
   */
  private generateGasWarnings(gasUsed: number, func: any): string[] {
    const warnings: string[] = [];

    // Check against policy limits
    if (gasUsed > this.policy.maxGasPerTransaction) {
      warnings.push(`Gas usage exceeds maximum per transaction: ${gasUsed} > ${this.policy.maxGasPerTransaction}`);
    }

    // Check against function gas limit
    if (func.gasLimit && gasUsed > func.gasLimit) {
      warnings.push(`Gas usage exceeds function limit: ${gasUsed} > ${func.gasLimit}`);
    }

    // Check for high gas usage
    if (gasUsed > 1000000) {
      warnings.push('High gas usage detected - consider optimizing the function');
    }

    // Check for low gas usage
    if (gasUsed < 50000 && func.mutability !== 'view' && func.mutability !== 'pure') {
      warnings.push('Very low gas usage - function may not be doing meaningful work');
    }

    return warnings;
  }

  /**
   * Record gas usage
   */
  public recordGasUsage(
    contractAddress: string,
    functionName: string,
    gasUsed: number,
    gasLimit: number,
    gasPrice: number,
    transactionHash: string
  ): void {
    const cost = this.calculateGasCost(gasUsed, gasPrice);

    const usage: GasUsage = {
      contractAddress,
      functionName,
      gasUsed,
      gasLimit,
      gasPrice,
      cost,
      timestamp: Date.now(),
      transactionHash
    };

    this.gasUsageHistory.push(usage);

    // Keep only last 10000 records
    if (this.gasUsageHistory.length > 10000) {
      this.gasUsageHistory = this.gasUsageHistory.slice(-10000);
    }

    // Process gas refund if enabled
    if (this.config.gasRefundEnabled && gasUsed < gasLimit) {
      this.processGasRefund(usage);
    }

    this.emit('gasUsed', usage);
  }

  /**
   * Process gas refund for unused gas
   */
  private processGasRefund(usage: GasUsage): void {
    const unusedGas = usage.gasLimit - usage.gasUsed;
    if (unusedGas > 0) {
      const refundAmount = Math.round(unusedGas * this.policy.gasRefundPercentage / 100);
      const key = usage.transactionHash;
      this.gasRefunds.set(key, refundAmount);

      this.emit('gasRefund', {
        transactionHash: usage.transactionHash,
        refundAmount,
        unusedGas
      });
    }
  }

  /**
   * Get gas refund for transaction
   */
  public getGasRefund(transactionHash: string): number {
    return this.gasRefunds.get(transactionHash) || 0;
  }

  /**
   * Add gas discount for user
   */
  public addGasDiscount(
    sender: string,
    contractAddress: string,
    discount: GasDiscount
  ): void {
    const key = `${sender}_${contractAddress}`;
    
    if (!this.gasDiscounts.has(key)) {
      this.gasDiscounts.set(key, []);
    }

    const discounts = this.gasDiscounts.get(key)!;
    discounts.push(discount);

    this.emit('discountAdded', {
      sender,
      contractAddress,
      discount
    });
  }

  /**
   * Remove gas discount
   */
  public removeGasDiscount(
    sender: string,
    contractAddress: string,
    condition: string
  ): void {
    const key = `${sender}_${contractAddress}`;
    const discounts = this.gasDiscounts.get(key);
    
    if (discounts) {
      const filtered = discounts.filter(d => d.condition !== condition);
      this.gasDiscounts.set(key, filtered);
    }
  }

  /**
   * Update gas price based on network conditions
   */
  private updateGasPrice(): void {
    // Simple gas price adjustment based on recent usage
    const recentUsage = this.gasUsageHistory.slice(-100);
    
    if (recentUsage.length > 0) {
      const averageGasPrice = recentUsage.reduce((sum, usage) => sum + usage.gasPrice, 0) / recentUsage.length;
      
      // Adjust gas price based on demand
      if (averageGasPrice > this.currentGasPrice * 1.1) {
        this.currentGasPrice = Math.min(
          this.currentGasPrice * 1.05,
          this.config.maxGasPrice
        );
      } else if (averageGasPrice < this.currentGasPrice * 0.9) {
        this.currentGasPrice = Math.max(
          this.currentGasPrice * 0.95,
          this.config.baseGasPrice
        );
      }
    }

    this.emit('gasPriceUpdated', {
      oldPrice: this.currentGasPrice,
      newPrice: this.currentGasPrice,
      timestamp: Date.now()
    });
  }

  /**
   * Start gas price monitoring
   */
  private startGasPriceMonitoring(): void {
    setInterval(() => {
      this.updateGasPrice();
    }, 30000); // Update every 30 seconds
  }

  /**
   * Initialize default gas discounts
   */
  private initializeDefaultDiscounts(): void {
    this.config.gasDiscounts = [
      {
        condition: 'high_volume_user',
        percentage: 10,
        description: '10% discount for high volume users'
      },
      {
        condition: 'early_adopter',
        percentage: 15,
        description: '15% discount for early adopters'
      },
      {
        condition: 'enterprise_partner',
        percentage: 20,
        description: '20% discount for enterprise partners'
      }
    ];
  }

  /**
   * Get current gas price
   */
  public getCurrentGasPrice(): number {
    return this.currentGasPrice;
  }

  /**
   * Set gas price
   */
  public setGasPrice(gasPrice: number): void {
    if (gasPrice < this.config.baseGasPrice) {
      throw new Error(`Gas price cannot be below minimum: ${this.config.baseGasPrice}`);
    }
    
    if (gasPrice > this.config.maxGasPrice) {
      throw new Error(`Gas price cannot exceed maximum: ${this.config.maxGasPrice}`);
    }

    const oldPrice = this.currentGasPrice;
    this.currentGasPrice = gasPrice;

    this.emit('gasPriceSet', {
      oldPrice,
      newPrice: gasPrice,
      timestamp: Date.now()
    });
  }

  /**
   * Get gas usage statistics
   */
  public getGasStats(): {
    totalTransactions: number;
    totalGasUsed: number;
    averageGasPerTransaction: number;
    totalGasCost: string;
    averageGasPrice: number;
    refundsProcessed: number;
    discountsApplied: number;
  } {
    const totalTransactions = this.gasUsageHistory.length;
    const totalGasUsed = this.gasUsageHistory.reduce((sum, usage) => sum + usage.gasUsed, 0);
    const averageGasPerTransaction = totalTransactions > 0 ? totalGasUsed / totalTransactions : 0;
    const totalGasCost = this.gasUsageHistory.reduce((sum, usage) => sum + parseInt(usage.cost), 0).toString();
    const averageGasPrice = totalTransactions > 0 ? 
      this.gasUsageHistory.reduce((sum, usage) => sum + usage.gasPrice, 0) / totalTransactions : 0;

    return {
      totalTransactions,
      totalGasUsed,
      averageGasPerTransaction,
      totalGasCost,
      averageGasPrice,
      refundsProcessed: this.gasRefunds.size,
      discountsApplied: Array.from(this.gasDiscounts.values())
        .reduce((sum, discounts) => sum + discounts.length, 0)
    };
  }

  /**
   * Get gas usage history
   */
  public getGasUsageHistory(limit?: number): GasUsage[] {
    if (limit) {
      return this.gasUsageHistory.slice(-limit);
    }
    return [...this.gasUsageHistory];
  }

  /**
   * Get gas usage by contract
   */
  public getGasUsageByContract(contractAddress: string): GasUsage[] {
    return this.gasUsageHistory.filter(usage => usage.contractAddress === contractAddress);
  }

  /**
   * Get gas usage by function
   */
  public getGasUsageByFunction(contractAddress: string, functionName: string): GasUsage[] {
    return this.gasUsageHistory.filter(usage => 
      usage.contractAddress === contractAddress && usage.functionName === functionName
    );
  }

  /**
   * Update gas configuration
   */
  public updateConfig(config: Partial<GasConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * Update gas policy
   */
  public updatePolicy(policy: Partial<GasPolicy>): void {
    this.policy = { ...this.policy, ...policy };
    this.emit('policyUpdated', this.policy);
  }

  /**
   * Get current configuration
   */
  public getConfig(): GasConfig {
    return { ...this.config };
  }

  /**
   * Get current policy
   */
  public getPolicy(): GasPolicy {
    return { ...this.policy };
  }

  /**
   * Clear gas usage history
   */
  public clearHistory(): void {
    this.gasUsageHistory = [];
    this.gasRefunds.clear();
    this.gasDiscounts.clear();
    
    this.emit('historyCleared');
  }
}
