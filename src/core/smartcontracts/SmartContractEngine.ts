import { EventEmitter } from 'events';
import { Transaction } from '../types/block.types';

export interface SmartContract {
    address: string;
    bytecode: string;
    abi: any;
    storage: Map<string, any>;
    owner: string;
    isDeployed: boolean;
}

export interface ContractCall {
    contractAddress: string;
    functionName: string;
    args: any[];
    from: string;
    value?: number;
    gas?: number;
}

export interface ContractResult {
    success: boolean;
    returnValue?: any;
    error?: string;
    gasUsed: number;
    events?: any[];
}

export class SmartContractEngine extends EventEmitter {
    private contracts: Map<string, SmartContract>;
    private gasLimit: number;
    private executionContext: any;

    constructor(gasLimit: number = 1000000) {
        super();
        this.contracts = new Map();
        this.gasLimit = gasLimit;
        this.executionContext = this.createExecutionContext();
    }

    async deployContract(
        bytecode: string,
        abi: any,
        from: string,
        constructorArgs: any[] = []
    ): Promise<string> {
        const contractAddress = this.generateContractAddress(from, this.contracts.size);
        
        const contract: SmartContract = {
            address: contractAddress,
            bytecode,
            abi,
            storage: new Map(),
            owner: from,
            isDeployed: true
        };

        // Execute constructor if present
        if (constructorArgs.length > 0) {
            await this.executeConstructor(contract, constructorArgs, from);
        }

        this.contracts.set(contractAddress, contract);
        
        this.emit('contractDeployed', {
            address: contractAddress,
            from,
            bytecode: bytecode.substring(0, 50) + '...'
        });

        return contractAddress;
    }

    async callContract(call: ContractCall): Promise<ContractResult> {
        const contract = this.contracts.get(call.contractAddress);
        
        if (!contract) {
            return {
                success: false,
                error: 'Contract not found',
                gasUsed: 0
            };
        }

        const gasLimit = call.gas || this.gasLimit;
        let gasUsed = 0;

        try {
            // Validate function exists in ABI
            const functionDef = this.findFunctionInABI(contract.abi, call.functionName);
            if (!functionDef) {
                return {
                    success: false,
                    error: `Function ${call.functionName} not found`,
                    gasUsed: 0
                };
            }

            // Execute the function
            const result = await this.executeFunction(contract, functionDef, call.args, call.from);
            gasUsed = this.estimateGasUsage(functionDef, call.args);

            this.emit('contractCalled', {
                contractAddress: call.contractAddress,
                functionName: call.functionName,
                from: call.from,
                gasUsed,
                success: result.success
            });

            return {
                success: true,
                returnValue: result.returnValue,
                gasUsed,
                events: result.events
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                gasUsed
            };
        }
    }

    async queryContract(contractAddress: string, functionName: string, args: any[] = []): Promise<any> {
        const contract = this.contracts.get(contractAddress);
        
        if (!contract) {
            throw new Error('Contract not found');
        }

        const functionDef = this.findFunctionInABI(contract.abi, functionName);
        if (!functionDef) {
            throw new Error(`Function ${functionName} not found`);
        }

        // Execute read-only function (no gas consumption)
        return this.executeReadOnlyFunction(contract, functionDef, args);
    }

    getContract(address: string): SmartContract | null {
        return this.contracts.get(address) || null;
    }

    getAllContracts(): SmartContract[] {
        return Array.from(this.contracts.values());
    }

    private generateContractAddress(from: string, nonce: number): string {
        const data = from + nonce.toString();
        return require('crypto').createHash('sha256').update(data).digest('hex').substring(0, 40);
    }

    private async executeConstructor(contract: SmartContract, args: any[], from: string): Promise<void> {
        const constructorDef = contract.abi.find((item: any) => item.type === 'constructor');
        if (constructorDef) {
            await this.executeFunction(contract, constructorDef, args, from);
        }
    }

    private async executeFunction(
        contract: SmartContract,
        functionDef: any,
        args: any[],
        from: string
    ): Promise<any> {
        // Simplified execution - in production would use proper VM
        const functionName = functionDef.name;
        
        switch (functionName) {
            case 'balanceOf':
                return { returnValue: contract.storage.get(`balance_${args[0]}`) || 0 };
            
            case 'transfer':
                const to = args[0];
                const amount = args[1];
                const fromBalance = contract.storage.get(`balance_${from}`) || 0;
                
                if (fromBalance >= amount) {
                    contract.storage.set(`balance_${from}`, fromBalance - amount);
                    contract.storage.set(`balance_${to}`, (contract.storage.get(`balance_${to}`) || 0) + amount);
                    
                    return {
                        returnValue: true,
                        events: [{
                            name: 'Transfer',
                            args: { from, to, amount }
                        }]
                    };
                } else {
                    throw new Error('Insufficient balance');
                }
            
            case 'approve':
                contract.storage.set(`allowance_${from}_${args[0]}`, args[1]);
                return { returnValue: true };
            
            case 'transferFrom':
                const spender = args[0];
                const recipient = args[1];
                const transferAmount = args[2];
                const allowance = contract.storage.get(`allowance_${spender}_${from}`) || 0;
                const spenderBalance = contract.storage.get(`balance_${spender}`) || 0;
                
                if (allowance >= transferAmount && spenderBalance >= transferAmount) {
                    contract.storage.set(`balance_${spender}`, spenderBalance - transferAmount);
                    contract.storage.set(`balance_${recipient}`, (contract.storage.get(`balance_${recipient}`) || 0) + transferAmount);
                    contract.storage.set(`allowance_${spender}_${from}`, allowance - transferAmount);
                    
                    return {
                        returnValue: true,
                        events: [{
                            name: 'Transfer',
                            args: { from: spender, to: recipient, amount: transferAmount }
                        }]
                    };
                } else {
                    throw new Error('Insufficient allowance or balance');
                }
            
            default:
                throw new Error(`Function ${functionName} not implemented`);
        }
    }

    private executeReadOnlyFunction(contract: SmartContract, functionDef: any, args: any[]): any {
        // For read-only functions, just return the value without modifying state
        const functionName = functionDef.name;
        
        switch (functionName) {
            case 'balanceOf':
                return contract.storage.get(`balance_${args[0]}`) || 0;
            
            case 'allowance':
                return contract.storage.get(`allowance_${args[0]}_${args[1]}`) || 0;
            
            case 'totalSupply':
                return contract.storage.get('totalSupply') || 0;
            
            case 'name':
                return contract.storage.get('name') || 'Token';
            
            case 'symbol':
                return contract.storage.get('symbol') || 'TKN';
            
            default:
                throw new Error(`Read-only function ${functionName} not implemented`);
        }
    }

    private findFunctionInABI(abi: any, functionName: string): any {
        return abi.find((item: any) => 
            item.type === 'function' && item.name === functionName
        );
    }

    private estimateGasUsage(functionDef: any, args: any[]): number {
        // Simplified gas estimation
        const baseGas = 21000;
        const argGas = args.length * 1000;
        const functionGas = functionDef.name === 'transfer' ? 5000 : 2000;
        
        return baseGas + argGas + functionGas;
    }

    private createExecutionContext(): any {
        return {
            block: {
                timestamp: Date.now(),
                number: 0,
                difficulty: 1
            },
            tx: {
                origin: '',
                gasPrice: 0
            }
        };
    }

    // Utility functions for common contract patterns
    async deployERC20Token(
        name: string,
        symbol: string,
        totalSupply: number,
        from: string
    ): Promise<string> {
        const erc20ABI = [
            {
                "type": "constructor",
                "inputs": [
                    {"name": "name", "type": "string"},
                    {"name": "symbol", "type": "string"},
                    {"name": "totalSupply", "type": "uint256"}
                ]
            },
            {
                "type": "function",
                "name": "balanceOf",
                "inputs": [{"name": "account", "type": "address"}],
                "outputs": [{"name": "", "type": "uint256"}]
            },
            {
                "type": "function", 
                "name": "transfer",
                "inputs": [
                    {"name": "to", "type": "address"},
                    {"name": "amount", "type": "uint256"}
                ],
                "outputs": [{"name": "", "type": "bool"}]
            },
            {
                "type": "function",
                "name": "approve",
                "inputs": [
                    {"name": "spender", "type": "address"},
                    {"name": "amount", "type": "uint256"}
                ],
                "outputs": [{"name": "", "type": "bool"}]
            },
            {
                "type": "function",
                "name": "transferFrom",
                "inputs": [
                    {"name": "from", "type": "address"},
                    {"name": "to", "type": "address"},
                    {"name": "amount", "type": "uint256"}
                ],
                "outputs": [{"name": "", "type": "bool"}]
            },
            {
                "type": "function",
                "name": "allowance",
                "inputs": [
                    {"name": "owner", "type": "address"},
                    {"name": "spender", "type": "address"}
                ],
                "outputs": [{"name": "", "type": "uint256"}]
            },
            {
                "type": "function",
                "name": "totalSupply",
                "inputs": [],
                "outputs": [{"name": "", "type": "uint256"}]
            },
            {
                "type": "function",
                "name": "name",
                "inputs": [],
                "outputs": [{"name": "", "type": "string"}]
            },
            {
                "type": "function",
                "name": "symbol",
                "inputs": [],
                "outputs": [{"name": "", "type": "string"}]
            }
        ];

        const bytecode = '0x608060405234801561001057600080fd5b50'; // Simplified bytecode

        const contractAddress = await this.deployContract(bytecode, erc20ABI, from, [name, symbol, totalSupply]);
        
        // Initialize storage
        const contract = this.contracts.get(contractAddress);
        if (contract) {
            contract.storage.set('name', name);
            contract.storage.set('symbol', symbol);
            contract.storage.set('totalSupply', totalSupply);
            contract.storage.set(`balance_${from}`, totalSupply);
        }

        return contractAddress;
    }
}
