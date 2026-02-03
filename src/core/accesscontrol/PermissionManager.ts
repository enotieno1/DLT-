import { EventEmitter } from 'events';

export enum Role {
    ADMIN = 'admin',
    VALIDATOR = 'validator',
    USER = 'user',
    AUDITOR = 'auditor',
    VIEWER = 'viewer'
}

export enum Permission {
    READ_BLOCKCHAIN = 'read_blockchain',
    WRITE_BLOCKCHAIN = 'write_blockchain',
    VALIDATE_BLOCKS = 'validate_blocks',
    DEPLOY_CONTRACTS = 'deploy_contracts',
    EXECUTE_CONTRACTS = 'execute_contracts',
    MANAGE_PERMISSIONS = 'manage_permissions',
    AUDIT_SYSTEM = 'audit_system',
    MANAGE_NETWORK = 'manage_network',
    VIEW_TRANSACTIONS = 'view_transactions',
    CREATE_TRANSACTIONS = 'create_transactions'
}

export interface User {
    id: string;
    address: string;
    role: Role;
    permissions: Permission[];
    isActive: boolean;
    createdAt: number;
    lastActive: number;
    metadata?: any;
}

export interface AccessPolicy {
    id: string;
    name: string;
    description: string;
    permissions: Permission[];
    roles: Role[];
    conditions?: any;
}

export class PermissionManager extends EventEmitter {
    private users: Map<string, User>;
    private rolePermissions: Map<Role, Permission[]>;
    private customPolicies: Map<string, AccessPolicy>;
    private auditLog: any[];

    constructor() {
        super();
        this.users = new Map();
        this.rolePermissions = new Map();
        this.customPolicies = new Map();
        this.auditLog = [];
        
        this.initializeDefaultRoles();
    }

    private initializeDefaultRoles(): void {
        // Admin - Full access
        this.rolePermissions.set(Role.ADMIN, [
            Permission.READ_BLOCKCHAIN,
            Permission.WRITE_BLOCKCHAIN,
            Permission.VALIDATE_BLOCKS,
            Permission.DEPLOY_CONTRACTS,
            Permission.EXECUTE_CONTRACTS,
            Permission.MANAGE_PERMISSIONS,
            Permission.AUDIT_SYSTEM,
            Permission.MANAGE_NETWORK,
            Permission.VIEW_TRANSACTIONS,
            Permission.CREATE_TRANSACTIONS
        ]);

        // Validator - Block validation and basic operations
        this.rolePermissions.set(Role.VALIDATOR, [
            Permission.READ_BLOCKCHAIN,
            Permission.VALIDATE_BLOCKS,
            Permission.EXECUTE_CONTRACTS,
            Permission.VIEW_TRANSACTIONS,
            Permission.CREATE_TRANSACTIONS
        ]);

        // User - Basic transaction and contract execution
        this.rolePermissions.set(Role.USER, [
            Permission.READ_BLOCKCHAIN,
            Permission.EXECUTE_CONTRACTS,
            Permission.VIEW_TRANSACTIONS,
            Permission.CREATE_TRANSACTIONS
        ]);

        // Auditor - Read-only access for compliance
        this.rolePermissions.set(Role.AUDITOR, [
            Permission.READ_BLOCKCHAIN,
            Permission.AUDIT_SYSTEM,
            Permission.VIEW_TRANSACTIONS
        ]);

        // Viewer - Read-only access
        this.rolePermissions.set(Role.VIEWER, [
            Permission.READ_BLOCKCHAIN,
            Permission.VIEW_TRANSACTIONS
        ]);
    }

    async createUser(userData: {
        address: string;
        role: Role;
        permissions?: Permission[];
        metadata?: any;
    }): Promise<User> {
        const userId = this.generateUserId(userData.address);
        
        const user: User = {
            id: userId,
            address: userData.address,
            role: userData.role,
            permissions: userData.permissions || this.rolePermissions.get(userData.role) || [],
            isActive: true,
            createdAt: Date.now(),
            lastActive: Date.now(),
            metadata: userData.metadata
        };

        this.users.set(userId, user);
        
        this.logAccessEvent('USER_CREATED', userId, {
            role: userData.role,
            address: userData.address
        });

        this.emit('userCreated', user);
        return user;
    }

    async updateUserRole(userId: string, newRole: Role): Promise<boolean> {
        const user = this.users.get(userId);
        if (!user) {
            return false;
        }

        const oldRole = user.role;
        user.role = newRole;
        user.permissions = this.rolePermissions.get(newRole) || [];
        user.lastActive = Date.now();

        this.logAccessEvent('ROLE_UPDATED', userId, {
            oldRole,
            newRole
        });

        this.emit('userRoleUpdated', user);
        return true;
    }

    async grantPermission(userId: string, permission: Permission): Promise<boolean> {
        const user = this.users.get(userId);
        if (!user || !user.isActive) {
            return false;
        }

        if (!user.permissions.includes(permission)) {
            user.permissions.push(permission);
            user.lastActive = Date.now();

            this.logAccessEvent('PERMISSION_GRANTED', userId, { permission });
            this.emit('permissionGranted', userId, permission);
        }

        return true;
    }

    async revokePermission(userId: string, permission: Permission): Promise<boolean> {
        const user = this.users.get(userId);
        if (!user) {
            return false;
        }

        const index = user.permissions.indexOf(permission);
        if (index > -1) {
            user.permissions.splice(index, 1);
            user.lastActive = Date.now();

            this.logAccessEvent('PERMISSION_REVOKED', userId, { permission });
            this.emit('permissionRevoked', userId, permission);
        }

        return true;
    }

    hasPermission(userId: string, permission: Permission): boolean {
        const user = this.users.get(userId);
        if (!user || !user.isActive) {
            return false;
        }

        return user.permissions.includes(permission);
    }

    hasPermissionByAddress(address: string, permission: Permission): boolean {
        const user = this.findUserByAddress(address);
        if (!user) {
            return false;
        }

        return this.hasPermission(user.id, permission);
    }

    async checkAccess(userId: string, permission: Permission, context?: any): Promise<{
        granted: boolean;
        reason?: string;
        conditions?: any;
    }> {
        const user = this.users.get(userId);
        
        if (!user) {
            return { granted: false, reason: 'User not found' };
        }

        if (!user.isActive) {
            return { granted: false, reason: 'User is inactive' };
        }

        const hasDirectPermission = user.permissions.includes(permission);
        
        if (!hasDirectPermission) {
            return { granted: false, reason: 'Insufficient permissions' };
        }

        // Check custom policies
        const applicablePolicies = this.getApplicablePolicies(user.role, permission);
        for (const policy of applicablePolicies) {
            const policyResult = this.evaluatePolicy(policy, user, context);
            if (!policyResult.granted) {
                return policyResult;
            }
        }

        this.logAccessEvent('ACCESS_CHECKED', userId, {
            permission,
            granted: true
        });

        return { granted: true };
    }

    getUser(userId: string): User | null {
        return this.users.get(userId) || null;
    }

    getUserByAddress(address: string): User | null {
        return this.findUserByAddress(address);
    }

    getAllUsers(): User[] {
        return Array.from(this.users.values());
    }

    getUsersByRole(role: Role): User[] {
        return Array.from(this.users.values()).filter(user => user.role === role);
    }

    async deactivateUser(userId: string): Promise<boolean> {
        const user = this.users.get(userId);
        if (!user) {
            return false;
        }

        user.isActive = false;
        user.lastActive = Date.now();

        this.logAccessEvent('USER_DEACTIVATED', userId);
        this.emit('userDeactivated', userId);
        return true;
    }

    async activateUser(userId: string): Promise<boolean> {
        const user = this.users.get(userId);
        if (!user) {
            return false;
        }

        user.isActive = true;
        user.lastActive = Date.now();

        this.logAccessEvent('USER_ACTIVATED', userId);
        this.emit('userActivated', userId);
        return true;
    }

    createCustomPolicy(policy: Omit<AccessPolicy, 'id'>): string {
        const policyId = this.generatePolicyId();
        const fullPolicy: AccessPolicy = {
            id: policyId,
            ...policy
        };

        this.customPolicies.set(policyId, fullPolicy);
        this.emit('policyCreated', fullPolicy);
        return policyId;
    }

    getPolicy(policyId: string): AccessPolicy | null {
        return this.customPolicies.get(policyId) || null;
    }

    getAllPolicies(): AccessPolicy[] {
        return Array.from(this.customPolicies.values());
    }

    getAuditLog(filters?: {
        userId?: string;
        action?: string;
        startDate?: number;
        endDate?: number;
    }): any[] {
        let filteredLog = [...this.auditLog];

        if (filters) {
            if (filters.userId) {
                filteredLog = filteredLog.filter(entry => entry.userId === filters.userId);
            }
            if (filters.action) {
                filteredLog = filteredLog.filter(entry => entry.action === filters.action);
            }
            if (filters.startDate) {
                filteredLog = filteredLog.filter(entry => entry.timestamp >= filters.startDate);
            }
            if (filters.endDate) {
                filteredLog = filteredLog.filter(entry => entry.timestamp <= filters.endDate);
            }
        }

        return filteredLog.sort((a, b) => b.timestamp - a.timestamp);
    }

    private findUserByAddress(address: string): User | null {
        for (const user of this.users.values()) {
            if (user.address === address) {
                return user;
            }
        }
        return null;
    }

    private generateUserId(address: string): string {
        return require('crypto').createHash('sha256').update(address + Date.now()).digest('hex').substring(0, 16);
    }

    private generatePolicyId(): string {
        return 'policy_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    private getApplicablePolicies(role: Role, permission: Permission): AccessPolicy[] {
        return Array.from(this.customPolicies.values()).filter(policy =>
            policy.roles.includes(role) && policy.permissions.includes(permission)
        );
    }

    private evaluatePolicy(policy: AccessPolicy, user: User, context?: any): {
        granted: boolean;
        reason?: string;
        conditions?: any;
    } {
        // Simplified policy evaluation
        if (!policy.conditions) {
            return { granted: true };
        }

        // Add complex policy evaluation logic here
        return { granted: true };
    }

    private logAccessEvent(action: string, userId: string, data?: any): void {
        const logEntry = {
            timestamp: Date.now(),
            action,
            userId,
            data: data || {}
        };

        this.auditLog.push(logEntry);

        // Keep audit log size manageable
        if (this.auditLog.length > 10000) {
            this.auditLog = this.auditLog.slice(-5000);
        }
    }

    // Utility methods for common permission patterns
    async createValidator(address: string): Promise<User> {
        return this.createUser({
            address,
            role: Role.VALIDATOR,
            metadata: { type: 'validator' }
        });
    }

    async createAuditor(address: string): Promise<User> {
        return this.createUser({
            address,
            role: Role.AUDITOR,
            metadata: { type: 'auditor' }
        });
    }

    async createRegularUser(address: string): Promise<User> {
        return this.createUser({
            address,
            role: Role.USER,
            metadata: { type: 'user' }
        });
    }
}
