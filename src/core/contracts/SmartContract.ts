import { EventEmitter } from 'events';
import { Transaction } from '../types/block.types';

export interface ContractABI {
  name: string;
  version: string;
  functions: ContractFunction[];
  events: ContractEvent[];
  constructor?: ContractConstructor;
}

export interface ContractFunction {
  name: string;
  inputs: ContractParameter[];
  outputs: ContractParameter[];
  visibility: 'public' | 'private' | 'internal' | 'external';
  mutability: 'pure' | 'view' | 'nonpayable' | 'payable';
  gasLimit?: number;
}

export interface ContractEvent {
  name: string;
  inputs: ContractParameter[];
  anonymous: boolean;
}

export interface ContractParameter {
  name: string;
  type: 'uint256' | 'int256' | 'address' | 'bool' | 'string' | 'bytes' | 'bytes32' | 'uint8' | 'uint16' | 'uint32' | 'uint64' | 'uint128';
  indexed?: boolean;
}

export interface ContractConstructor {
  inputs: ContractParameter[];
  payable: boolean;
}

export interface ContractState {
  address: string;
  balance: string;
  nonce: number;
  code: string;
  storage: Map<string, string>;
  deployedAt: number;
  deployedBy: string;
  version: string;
}

export interface ContractContext {
  contract: ContractState;
  sender: string;
  value: string;
  gasLimit: number;
  gasUsed: number;
  blockNumber: number;
  timestamp: number;
  transaction: Transaction;
}

export interface ContractExecutionResult {
  success: boolean;
  returnValue?: any;
  gasUsed: number;
  events: ContractLog[];
  error?: string;
  newState?: Map<string, string>;
}

export interface ContractLog {
  address: string;
  event: string;
  data: any[];
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

export interface ContractValidationRule {
  name: string;
  type: 'SYNTAX' | 'SECURITY' | 'GAS' | 'BUSINESS' | 'PERMISSION';
  description: string;
  validator: (contract: SmartContract) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Smart Contract framework for enterprise DLT
 * Provides secure, sandboxed execution environment for business logic
 */
export class SmartContract extends EventEmitter {
  public address: string;
  public abi: ContractABI;
  public bytecode: string;
  public state: ContractState;
  public validationRules: ContractValidationRule[];

  constructor(address: string, abi: ContractABI, bytecode: string, deployer: string) {
    super();
    this.address = address;
    this.abi = abi;
    this.bytecode = bytecode;
    this.validationRules = [];
    
    this.state = {
      address,
      balance: '0',
      nonce: 0,
      code: bytecode,
      storage: new Map(),
      deployedAt: Date.now(),
      deployedBy: deployer,
      version: abi.version || '1.0.0'
    };

    this.initializeDefaultValidationRules();
  }

  /**
   * Execute a contract function
   * @param functionName - Function name to execute
   * @param args - Function arguments
   * @param context - Execution context
   * @returns Execution result
   */
  public async executeFunction(
    functionName: string, 
    args: any[], 
    context: ContractContext
  ): Promise<ContractExecutionResult> {
    try {
      // Validate function exists
      const func = this.abi.functions.find(f => f.name === functionName);
      if (!func) {
        return {
          success: false,
          gasUsed: 0,
          events: [],
          error: `Function ${functionName} not found`
        };
      }

      // Validate function visibility
      if (func.visibility === 'private' || func.visibility === 'internal') {
        return {
          success: false,
          gasUsed: 0,
          events: [],
          error: `Function ${functionName} is not externally callable`
        };
      }

      // Validate gas limit
      const gasLimit = func.gasLimit || context.gasLimit;
      if (context.gasUsed >= gasLimit) {
        return {
          success: false,
          gasUsed: context.gasUsed,
          events: [],
          error: 'Gas limit exceeded'
        };
      }

      // Validate arguments
      const argValidation = this.validateArguments(func, args);
      if (!argValidation.valid) {
        return {
          success: false,
          gasUsed: context.gasUsed,
          events: [],
          error: argValidation.error
        };
      }

      // Execute function based on mutability
      let result: ContractExecutionResult;
      
      switch (func.mutability) {
        case 'view':
        case 'pure':
          result = await this.executeViewFunction(func, args, context);
          break;
        case 'nonpayable':
        case 'payable':
          result = await this.executeStateChangingFunction(func, args, context);
          break;
        default:
          result = {
            success: false,
            gasUsed: context.gasUsed,
            events: [],
            error: `Unknown mutability: ${func.mutability}`
          };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        gasUsed: context.gasUsed,
        events: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Execute view/pure function (read-only)
   */
  private async executeViewFunction(
    func: ContractFunction,
    args: any[],
    context: ContractContext
  ): Promise<ContractExecutionResult> {
    // Simulate function execution
    const gasUsed = this.calculateGasUsage(func, args);
    
    // For demo purposes, return a mock result
    const returnValue = this.mockFunctionResult(func, args);
    
    return {
      success: true,
      returnValue,
      gasUsed,
      events: []
    };
  }

  /**
   * Execute state-changing function
   */
  private async executeStateChangingFunction(
    func: ContractFunction,
    args: any[],
    context: ContractContext
  ): Promise<ContractExecutionResult> {
    const gasUsed = this.calculateGasUsage(func, args);
    const events: ContractLog[] = [];
    
    // Update state
    const newState = new Map(this.state.storage);
    
    // Simulate state change
    const stateKey = `${func.name}_${Date.now()}`;
    newState.set(stateKey, JSON.stringify(args));
    
    // Emit event if applicable
    if (this.abi.events.length > 0) {
      const event = this.abi.events[0]; // Use first event for demo
      events.push({
        address: this.address,
        event: event.name,
        data: args,
        blockNumber: context.blockNumber,
        transactionHash: context.transaction.hash,
        logIndex: 0
      });
    }
    
    // Update contract state
    this.state.storage = newState;
    this.state.nonce++;
    
    return {
      success: true,
      gasUsed,
      events,
      newState
    };
  }

  /**
   * Validate function arguments
   */
  private validateArguments(func: ContractFunction, args: any[]): ValidationResult {
    if (func.inputs.length !== args.length) {
      return {
        valid: false,
        error: `Expected ${func.inputs.length} arguments, got ${args.length}`
      };
    }

    for (let i = 0; i < func.inputs.length; i++) {
      const param = func.inputs[i];
      const arg = args[i];
      
      if (!this.validateParameterType(param.type, arg)) {
        return {
          valid: false,
          error: `Invalid type for parameter ${param.name}: expected ${param.type}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate parameter type
   */
  private validateParameterType(type: string, value: any): boolean {
    switch (type) {
      case 'uint256':
      case 'uint8':
      case 'uint16':
      case 'uint32':
      case 'uint64':
      case 'uint128':
        return typeof value === 'number' && value >= 0;
      case 'int256':
        return typeof value === 'number';
      case 'address':
        return typeof value === 'string' && value.startsWith('0x') && value.length === 42;
      case 'bool':
        return typeof value === 'boolean';
      case 'string':
        return typeof value === 'string';
      case 'bytes':
      case 'bytes32':
        return typeof value === 'string' && value.startsWith('0x');
      default:
        return true; // Allow unknown types for flexibility
    }
  }

  /**
   * Calculate gas usage for function execution
   */
  private calculateGasUsage(func: ContractFunction, args: any[]): number {
    let gas = 21000; // Base transaction gas
    
    // Add gas for each argument
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
    
    return gas;
  }

  /**
   * Mock function result for demonstration
   */
  private mockFunctionResult(func: ContractFunction, args: any[]): any {
    // Return different results based on function name
    switch (func.name) {
      case 'balanceOf':
        return '1000000';
      case 'totalSupply':
        return '1000000000';
      case 'allowance':
        return '500000';
      case 'name':
        return 'Enterprise Token';
      case 'symbol':
        return 'ENT';
      case 'decimals':
        return 18;
      default:
        return args.length > 0 ? args[0] : null;
    }
  }

  /**
   * Add validation rule
   */
  public addValidationRule(rule: ContractValidationRule): void {
    this.validationRules.push(rule);
  }

  /**
   * Validate contract against all rules
   */
  public validateContract(): ValidationResult[] {
    const results: ValidationResult[] = [];
    
    for (const rule of this.validationRules) {
      const result = rule.validator(this);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Initialize default validation rules
   */
  private initializeDefaultValidationRules(): void {
    // Syntax validation
    this.addValidationRule({
      name: 'valid_abi',
      type: 'SYNTAX',
      description: 'Contract ABI must be valid',
      validator: (contract) => {
        if (!contract.abi || !contract.abi.functions || contract.abi.functions.length === 0) {
          return { valid: false, error: 'Contract must have at least one function' };
        }
        return { valid: true };
      }
    });

    // Security validation
    this.addValidationRule({
      name: 'no_empty_functions',
      type: 'SECURITY',
      description: 'Functions should not be empty',
      validator: (contract) => {
        const emptyFunctions = contract.abi.functions.filter(f => f.inputs.length === 0 && f.outputs.length === 0);
        if (emptyFunctions.length > 0) {
          return { 
            valid: false, 
            error: 'Contract has empty functions which may indicate incomplete implementation' 
          };
        }
        return { valid: true };
      }
    });

    // Gas validation
    this.addValidationRule({
      name: 'reasonable_gas_limits',
      type: 'GAS',
      description: 'Gas limits should be reasonable',
      validator: (contract) => {
        const highGasFunctions = contract.abi.functions.filter(f => 
          f.gasLimit && f.gasLimit > 1000000
        );
        if (highGasFunctions.length > 0) {
          return { 
            valid: false, 
            warning: 'Some functions have very high gas limits that may cause transaction failures' 
          };
        }
        return { valid: true };
      }
    });

    // Business logic validation
    this.addValidationRule({
      name: 'has_constructor',
      type: 'BUSINESS',
      description: 'Contract should have a constructor',
      validator: (contract) => {
        if (!contract.abi.constructor) {
          return { 
            valid: false, 
            warning: 'Contract has no constructor - initialization may be incomplete' 
          };
        }
        return { valid: true };
      }
    });

    // Permission validation
    this.addValidationRule({
      name: 'proper_visibility',
      type: 'PERMISSION',
      description: 'Functions should have proper visibility',
      validator: (contract) => {
        const publicFunctions = contract.abi.functions.filter(f => 
          f.visibility === 'public' || f.visibility === 'external'
        );
        if (publicFunctions.length === 0) {
          return { 
            valid: false, 
            error: 'Contract must have at least one public or external function' 
          };
        }
        return { valid: true };
      }
    });
  }

  /**
   * Get contract information
   */
  public getContractInfo(): {
    address: string;
    name: string;
    version: string;
    functions: number;
    events: number;
    deployedAt: number;
    deployedBy: string;
    balance: string;
    nonce: number;
  } {
    return {
      address: this.address,
      name: this.abi.name,
      version: this.abi.version,
      functions: this.abi.functions.length,
      events: this.abi.events.length,
      deployedAt: this.state.deployedAt,
      deployedBy: this.state.deployedBy,
      balance: this.state.balance,
      nonce: this.state.nonce
    };
  }

  /**
   * Get contract storage
   */
  public getStorage(): Record<string, string> {
    const storage: Record<string, string> = {};
    for (const [key, value] of this.state.storage.entries()) {
      storage[key] = value;
    }
    return storage;
  }

  /**
   * Update contract storage
   */
  public updateStorage(key: string, value: string): void {
    this.state.storage.set(key, value);
    this.emit('storageUpdated', { address: this.address, key, value });
  }

  /**
   * Get contract balance
   */
  public getBalance(): string {
    return this.state.balance;
  }

  /**
   * Update contract balance
   */
  public updateBalance(amount: string): void {
    this.state.balance = amount;
    this.emit('balanceUpdated', { address: this.address, balance: amount });
  }

  /**
   * Serialize contract state
   */
  public serializeState(): string {
    return JSON.stringify({
      address: this.state.address,
      balance: this.state.balance,
      nonce: this.state.nonce,
      code: this.state.code,
      storage: Object.fromEntries(this.state.storage),
      deployedAt: this.state.deployedAt,
      deployedBy: this.state.deployedBy,
      version: this.state.version
    });
  }

  /**
   * Deserialize contract state
   */
  public deserializeState(serialized: string): void {
    try {
      const data = JSON.parse(serialized);
      this.state = {
        address: data.address,
        balance: data.balance,
        nonce: data.nonce,
        code: data.code,
        storage: new Map(Object.entries(data.storage)),
        deployedAt: data.deployedAt,
        deployedBy: data.deployedBy,
        version: data.version
      };
    } catch (error) {
      throw new Error('Failed to deserialize contract state');
    }
  }
}
