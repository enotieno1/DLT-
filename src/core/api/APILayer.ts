import { EventEmitter } from 'events';
import { Blockchain } from '../blockchain/Blockchain';
import { SmartContractEngine } from '../smartcontracts/SmartContractEngine';
import { PermissionManager, Permission } from '../accesscontrol/PermissionManager';
import { AuditTrail } from '../audit/AuditTrail';
import { Transaction } from '../types/block.types';

export interface APIRequest {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: any;
    userId?: string;
    address?: string;
}

export interface APIResponse {
    status: number;
    headers: Record<string, string>;
    body?: any;
    error?: string;
}

export interface APIEndpoint {
    method: string;
    path: string;
    permissions: Permission[];
    handler: (req: APIRequest) => Promise<APIResponse>;
    rateLimit?: {
        requests: number;
        window: number; // in seconds
    };
}

export class APILayer extends EventEmitter {
    private blockchain: Blockchain;
    private smartContracts: SmartContractEngine;
    private permissionManager: PermissionManager;
    private auditTrail: AuditTrail;
    private endpoints: Map<string, APIEndpoint>;
    private rateLimitMap: Map<string, { count: number; resetTime: number }>;

    constructor(
        blockchain: Blockchain,
        smartContracts: SmartContractEngine,
        permissionManager: PermissionManager,
        auditTrail: AuditTrail
    ) {
        super();
        this.blockchain = blockchain;
        this.smartContracts = smartContracts;
        this.permissionManager = permissionManager;
        this.auditTrail = auditTrail;
        this.endpoints = new Map();
        this.rateLimitMap = new Map();
        
        this.initializeEndpoints();
    }

    private initializeEndpoints(): void {
        // Blockchain endpoints
        this.registerEndpoint({
            method: 'GET',
            path: '/api/blockchain/info',
            permissions: [Permission.READ_BLOCKCHAIN],
            handler: this.getBlockchainInfo.bind(this)
        });

        this.registerEndpoint({
            method: 'GET',
            path: '/api/blockchain/blocks/:index',
            permissions: [Permission.READ_BLOCKCHAIN],
            handler: this.getBlock.bind(this)
        });

        this.registerEndpoint({
            method: 'GET',
            path: '/api/blockchain/blocks',
            permissions: [Permission.READ_BLOCKCHAIN],
            handler: this.getAllBlocks.bind(this)
        });

        this.registerEndpoint({
            method: 'POST',
            path: '/api/blockchain/transactions',
            permissions: [Permission.CREATE_TRANSACTIONS],
            handler: this.createTransaction.bind(this)
        });

        this.registerEndpoint({
            method: 'GET',
            path: '/api/blockchain/balance/:address',
            permissions: [Permission.VIEW_TRANSACTIONS],
            handler: this.getBalance.bind(this)
        });

        // Smart contract endpoints
        this.registerEndpoint({
            method: 'POST',
            path: '/api/contracts/deploy',
            permissions: [Permission.DEPLOY_CONTRACTS],
            handler: this.deployContract.bind(this)
        });

        this.registerEndpoint({
            method: 'POST',
            path: '/api/contracts/call',
            permissions: [Permission.EXECUTE_CONTRACTS],
            handler: this.callContract.bind(this)
        });

        this.registerEndpoint({
            method: 'GET',
            path: '/api/contracts/:address',
            permissions: [Permission.READ_BLOCKCHAIN],
            handler: this.getContract.bind(this)
        });

        this.registerEndpoint({
            method: 'GET',
            path: '/api/contracts',
            permissions: [Permission.READ_BLOCKCHAIN],
            handler: this.getAllContracts.bind(this)
        });

        // Permission management endpoints
        this.registerEndpoint({
            method: 'POST',
            path: '/api/permissions/users',
            permissions: [Permission.MANAGE_PERMISSIONS],
            handler: this.createUser.bind(this)
        });

        this.registerEndpoint({
            method: 'PUT',
            path: '/api/permissions/users/:userId/role',
            permissions: [Permission.MANAGE_PERMISSIONS],
            handler: this.updateUserRole.bind(this)
        });

        this.registerEndpoint({
            method: 'POST',
            path: '/api/permissions/users/:userId/grant',
            permissions: [Permission.MANAGE_PERMISSIONS],
            handler: this.grantPermission.bind(this)
        });

        this.registerEndpoint({
            method: 'POST',
            path: '/api/permissions/users/:userId/revoke',
            permissions: [Permission.MANAGE_PERMISSIONS],
            handler: this.revokePermission.bind(this)
        });

        // Audit endpoints
        this.registerEndpoint({
            method: 'GET',
            path: '/api/audit/trail',
            permissions: [Permission.AUDIT_SYSTEM],
            handler: this.getAuditTrail.bind(this)
        });

        this.registerEndpoint({
            method: 'GET',
            path: '/api/audit/statistics',
            permissions: [Permission.AUDIT_SYSTEM],
            handler: this.getAuditStatistics.bind(this)
        });

        this.registerEndpoint({
            method: 'GET',
            path: '/api/audit/integrity',
            permissions: [Permission.AUDIT_SYSTEM],
            handler: this.verifyIntegrity.bind(this)
        });

        // Health check endpoint (no permissions required)
        this.registerEndpoint({
            method: 'GET',
            path: '/api/health',
            permissions: [],
            handler: this.healthCheck.bind(this)
        });
    }

    registerEndpoint(endpoint: APIEndpoint): void {
        const key = `${endpoint.method}:${endpoint.path}`;
        this.endpoints.set(key, endpoint);
    }

    async handleRequest(request: APIRequest): Promise<APIResponse> {
        try {
            // Find endpoint
            const endpoint = this.findEndpoint(request.method, request.path);
            if (!endpoint) {
                return {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                    error: 'Endpoint not found'
                };
            }

            // Check rate limiting
            const rateLimitResult = this.checkRateLimit(request, endpoint);
            if (!rateLimitResult.allowed) {
                return {
                    status: 429,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
                    },
                    error: 'Rate limit exceeded'
                };
            }

            // Check permissions
            if (endpoint.permissions.length > 0) {
                if (!request.userId) {
                    return {
                        status: 401,
                        headers: { 'Content-Type': 'application/json' },
                        error: 'Authentication required'
                    };
                }

                for (const permission of endpoint.permissions) {
                    const hasPermission = this.permissionManager.hasPermission(request.userId, permission);
                    if (!hasPermission) {
                        await this.auditTrail.logSecurityEvent(
                            'FAILED_LOGIN',
                            request.address || 'unknown',
                            { reason: 'Insufficient permissions', requiredPermission: permission },
                            request.userId
                        );

                        return {
                            status: 403,
                            headers: { 'Content-Type': 'application/json' },
                            error: 'Insufficient permissions'
                        };
                    }
                }
            }

            // Execute endpoint handler
            const response = await endpoint.handler(request);

            // Log successful API call
            await this.auditTrail.logSystemEvent(
                'API_CALL',
                {
                    method: request.method,
                    path: request.path,
                    userId: request.userId,
                    status: response.status
                },
                request.userId
            );

            return response;

        } catch (error) {
            await this.auditTrail.logSystemEvent(
                'API_ERROR',
                {
                    method: request.method,
                    path: request.path,
                    error: error.message,
                    userId: request.userId
                },
                request.userId
            );

            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                error: 'Internal server error'
            };
        }
    }

    private findEndpoint(method: string, path: string): APIEndpoint | null {
        // Simple path matching - in production would use proper routing
        const key = `${method}:${path}`;
        return this.endpoints.get(key) || null;
    }

    private checkRateLimit(request: APIRequest, endpoint: APIEndpoint): {
        allowed: boolean;
        retryAfter?: number;
    } {
        if (!endpoint.rateLimit) {
            return { allowed: true };
        }

        const key = `${request.address || 'unknown'}:${endpoint.method}:${endpoint.path}`;
        const now = Date.now();
        const current = this.rateLimitMap.get(key);

        if (!current || now > current.resetTime) {
            this.rateLimitMap.set(key, {
                count: 1,
                resetTime: now + (endpoint.rateLimit.window * 1000)
            });
            return { allowed: true };
        }

        if (current.count >= endpoint.rateLimit.requests) {
            return {
                allowed: false,
                retryAfter: Math.ceil((current.resetTime - now) / 1000)
            };
        }

        current.count++;
        return { allowed: true };
    }

    // Endpoint handlers
    private async getBlockchainInfo(req: APIRequest): Promise<APIResponse> {
        const info = this.blockchain.getChainInfo();
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: info
        };
    }

    private async getBlock(req: APIRequest): Promise<APIResponse> {
        const index = parseInt(req.path.split('/').pop() || '0');
        const block = await this.blockchain.getBlock(index);
        
        if (!block) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                error: 'Block not found'
            };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: block
        };
    }

    private async getAllBlocks(req: APIRequest): Promise<APIResponse> {
        const blocks = [];
        const chainInfo = this.blockchain.getChainInfo();
        
        for (let i = 0; i < chainInfo.length; i++) {
            const block = await this.blockchain.getBlock(i);
            if (block) blocks.push(block);
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { blocks }
        };
    }

    private async createTransaction(req: APIRequest): Promise<APIResponse> {
        const { from, to, amount, signature } = req.body;

        if (!from || !to || !amount || !signature) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                error: 'Missing required fields'
            };
        }

        const transaction: Transaction = {
            from,
            to,
            amount,
            timestamp: Date.now(),
            signature,
            hash: ''
        };

        await this.blockchain.addTransaction(transaction);
        await this.auditTrail.logTransaction(
            transaction.hash || 'pending',
            from,
            to,
            amount,
            req.userId
        );

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: { message: 'Transaction added to pending pool', transaction }
        };
    }

    private async getBalance(req: APIRequest): Promise<APIResponse> {
        const address = req.path.split('/').pop();
        const balance = this.blockchain.getBalance(address || '');

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { address, balance }
        };
    }

    private async deployContract(req: APIRequest): Promise<APIResponse> {
        const { bytecode, abi, constructorArgs } = req.body;

        if (!bytecode || !abi) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                error: 'Missing bytecode or ABI'
            };
        }

        const user = this.permissionManager.getUser(req.userId!);
        if (!user) {
            return {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
                error: 'User not found'
            };
        }

        const contractAddress = await this.smartContracts.deployContract(
            bytecode,
            abi,
            user.address,
            constructorArgs || []
        );

        await this.auditTrail.logContractInteraction(
            contractAddress,
            'constructor',
            constructorArgs || [],
            user.address,
            req.userId
        );

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: { contractAddress }
        };
    }

    private async callContract(req: APIRequest): Promise<APIResponse> {
        const { contractAddress, functionName, args, value } = req.body;

        if (!contractAddress || !functionName) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                error: 'Missing contract address or function name'
            };
        }

        const user = this.permissionManager.getUser(req.userId!);
        if (!user) {
            return {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
                error: 'User not found'
            };
        }

        const result = await this.smartContracts.callContract({
            contractAddress,
            functionName,
            args: args || [],
            from: user.address,
            value
        });

        await this.auditTrail.logContractInteraction(
            contractAddress,
            functionName,
            args || [],
            user.address,
            req.userId
        );

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: result
        };
    }

    private async getContract(req: APIRequest): Promise<APIResponse> {
        const address = req.path.split('/').pop();
        const contract = this.smartContracts.getContract(address || '');

        if (!contract) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                error: 'Contract not found'
            };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: contract
        };
    }

    private async getAllContracts(req: APIRequest): Promise<APIResponse> {
        const contracts = this.smartContracts.getAllContracts();

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { contracts }
        };
    }

    private async createUser(req: APIRequest): Promise<APIResponse> {
        const { address, role, permissions, metadata } = req.body;

        if (!address || !role) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                error: 'Missing address or role'
            };
        }

        const user = await this.permissionManager.createUser({
            address,
            role,
            permissions,
            metadata
        });

        await this.auditTrail.logPermissionChange(
            req.userId!,
            user.id,
            role,
            'GRANTED',
            req.address || 'unknown'
        );

        return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: user
        };
    }

    private async updateUserRole(req: APIRequest): Promise<APIResponse> {
        const userId = req.path.split('/').slice(-2)[0];
        const { role } = req.body;

        if (!role) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                error: 'Missing role'
            };
        }

        const success = await this.permissionManager.updateUserRole(userId, role);

        if (!success) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                error: 'User not found'
            };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { message: 'User role updated successfully' }
        };
    }

    private async grantPermission(req: APIRequest): Promise<APIResponse> {
        const userId = req.path.split('/').slice(-2)[0];
        const { permission } = req.body;

        if (!permission) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                error: 'Missing permission'
            };
        }

        const success = await this.permissionManager.grantPermission(userId, permission);

        if (!success) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                error: 'User not found'
            };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { message: 'Permission granted successfully' }
        };
    }

    private async revokePermission(req: APIRequest): Promise<APIResponse> {
        const userId = req.path.split('/').slice(-2)[0];
        const { permission } = req.body;

        if (!permission) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                error: 'Missing permission'
            };
        }

        const success = await this.permissionManager.revokePermission(userId, permission);

        if (!success) {
            return {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                error: 'User not found'
            };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { message: 'Permission revoked successfully' }
        };
    }

    private async getAuditTrail(req: APIRequest): Promise<APIResponse> {
        const entries = await this.auditTrail.getAuditTrail(req.body);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { entries }
        };
    }

    private async getAuditStatistics(req: APIRequest): Promise<APIResponse> {
        const stats = await this.auditTrail.getAuditStatistics();

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: stats
        };
    }

    private async verifyIntegrity(req: APIRequest): Promise<APIResponse> {
        const integrity = await this.auditTrail.verifyAuditTrailIntegrity();

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: integrity
        };
    }

    private async healthCheck(req: APIRequest): Promise<APIResponse> {
        const blockchainInfo = this.blockchain.getChainInfo();
        const auditIntegrity = await this.auditTrail.verifyAuditTrailIntegrity();

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: {
                status: 'healthy',
                timestamp: Date.now(),
                blockchain: {
                    length: blockchainInfo.length,
                    isValid: this.blockchain.isChainValid()
                },
                audit: {
                    integrity: auditIntegrity.isValid,
                    totalEntries: auditIntegrity.lastVerifiedBlock + 1
                },
                contracts: this.smartContracts.getAllContracts().length,
                users: this.permissionManager.getAllUsers().length
            }
        };
    }

    // Utility methods for external integration
    getEndpoints(): APIEndpoint[] {
        return Array.from(this.endpoints.values());
    }

    getEndpointDocumentation(): any {
        return this.endpoints.map(endpoint => ({
            method: endpoint.method,
            path: endpoint.path,
            permissions: endpoint.permissions,
            rateLimit: endpoint.rateLimit,
            description: this.getEndpointDescription(endpoint)
        }));
    }

    private getEndpointDescription(endpoint: APIEndpoint): string {
        const descriptions: Record<string, string> = {
            'GET:/api/blockchain/info': 'Get blockchain information',
            'GET:/api/blockchain/blocks/:index': 'Get specific block by index',
            'GET:/api/blockchain/blocks': 'Get all blocks',
            'POST:/api/blockchain/transactions': 'Create new transaction',
            'GET:/api/blockchain/balance/:address': 'Get balance for address',
            'POST:/api/contracts/deploy': 'Deploy smart contract',
            'POST:/api/contracts/call': 'Call smart contract function',
            'GET:/api/contracts/:address': 'Get contract information',
            'GET:/api/contracts': 'Get all contracts',
            'POST:/api/permissions/users': 'Create new user',
            'PUT:/api/permissions/users/:userId/role': 'Update user role',
            'POST:/api/permissions/users/:userId/grant': 'Grant permission to user',
            'POST:/api/permissions/users/:userId/revoke': 'Revoke permission from user',
            'GET:/api/audit/trail': 'Get audit trail',
            'GET:/api/audit/statistics': 'Get audit statistics',
            'GET:/api/audit/integrity': 'Verify audit trail integrity',
            'GET:/api/health': 'Health check endpoint'
        };

        const key = `${endpoint.method}:${endpoint.path}`;
        return descriptions[key] || 'No description available';
    }
}
