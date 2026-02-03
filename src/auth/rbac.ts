import { NodeRole } from '../core/types/node.types';

/**
 * Role-based access control (RBAC) system
 * Defines permissions for different roles in the DLT network
 */
export enum Permission {
  // Node management permissions
  NODE_JOIN = 'node:join',
  NODE_LEAVE = 'node:leave',
  NODE_VIEW = 'node:view',
  NODE_MANAGE = 'node:manage',
  
  // Transaction permissions
  TRANSACTION_SUBMIT = 'transaction:submit',
  TRANSACTION_VIEW = 'transaction:view',
  TRANSACTION_VALIDATE = 'transaction:validate',
  
  // Block permissions
  BLOCK_PROPOSE = 'block:propose',
  BLOCK_VALIDATE = 'block:validate',
  BLOCK_VIEW = 'block:view',
  
  // Consensus permissions
  CONSENSUS_PARTICIPATE = 'consensus:participate',
  CONSENSUS_VOTE = 'consensus:vote',
  CONSENSUS_VIEW = 'consensus:view',
  
  // Network permissions
  NETWORK_SYNC = 'network:sync',
  NETWORK_BROADCAST = 'network:broadcast',
  NETWORK_CONNECT = 'network:connect',
  
  // Administrative permissions
  ADMIN_CONFIGURE = 'admin:configure',
  ADMIN_MONITOR = 'admin:monitor',
  ADMIN_AUDIT = 'admin:audit',
  ADMIN_EMERGENCY = 'admin:emergency',
  
  // Read permissions (basic)
  READ_LEDGER = 'ledger:read',
  READ_ACCOUNTS = 'accounts:read',
  READ_STATS = 'stats:read'
}

/**
 * Role definition with associated permissions
 */
export interface Role {
  name: string;
  permissions: Permission[];
  description: string;
}

/**
 * User/Node identity with role assignments
 */
export interface Identity {
  id: string;
  address: string;
  publicKey: string;
  roles: NodeRole[];
  permissions: Permission[];
  isActive: boolean;
  createdAt: number;
  lastActive: number;
  metadata?: Record<string, any>;
}

/**
 * Access control decision
 */
export interface AccessDecision {
  allowed: boolean;
  reason?: string;
  requiredPermissions?: Permission[];
}

/**
 * Role-Based Access Control Manager
 */
export class RBACManager {
  private roles: Map<NodeRole, Role>;
  private identities: Map<string, Identity>;
  private permissionCache: Map<string, Permission[]>;

  constructor() {
    this.roles = new Map();
    this.identities = new Map();
    this.permissionCache = new Map();
    this.initializeDefaultRoles();
  }

  /**
   * Initialize default role definitions
   */
  private initializeDefaultRoles(): void {
    // Authority role - highest privileges
    this.roles.set(NodeRole.AUTHORITY, {
      name: 'Authority',
      permissions: [
        // All permissions
        Permission.NODE_JOIN,
        Permission.NODE_LEAVE,
        Permission.NODE_VIEW,
        Permission.NODE_MANAGE,
        Permission.TRANSACTION_SUBMIT,
        Permission.TRANSACTION_VIEW,
        Permission.TRANSACTION_VALIDATE,
        Permission.BLOCK_PROPOSE,
        Permission.BLOCK_VALIDATE,
        Permission.BLOCK_VIEW,
        Permission.CONSENSUS_PARTICIPATE,
        Permission.CONSENSUS_VOTE,
        Permission.CONSENSUS_VIEW,
        Permission.NETWORK_SYNC,
        Permission.NETWORK_BROADCAST,
        Permission.NETWORK_CONNECT,
        Permission.ADMIN_CONFIGURE,
        Permission.ADMIN_MONITOR,
        Permission.ADMIN_AUDIT,
        Permission.ADMIN_EMERGENCY,
        Permission.READ_LEDGER,
        Permission.READ_ACCOUNTS,
        Permission.READ_STATS
      ],
      description: 'Full authority over the network'
    });

    // Validator role - can validate and propose blocks
    this.roles.set(NodeRole.VALIDATOR, {
      name: 'Validator',
      permissions: [
        Permission.NODE_VIEW,
        Permission.TRANSACTION_SUBMIT,
        Permission.TRANSACTION_VIEW,
        Permission.TRANSACTION_VALIDATE,
        Permission.BLOCK_PROPOSE,
        Permission.BLOCK_VALIDATE,
        Permission.BLOCK_VIEW,
        Permission.CONSENSUS_PARTICIPATE,
        Permission.CONSENSUS_VOTE,
        Permission.CONSENSUS_VIEW,
        Permission.NETWORK_SYNC,
        Permission.NETWORK_BROADCAST,
        Permission.READ_LEDGER,
        Permission.READ_ACCOUNTS,
        Permission.READ_STATS
      ],
      description: 'Can validate transactions and propose blocks'
    });

    // Peer role - basic participation
    this.roles.set(NodeRole.PEER, {
      name: 'Peer',
      permissions: [
        Permission.NODE_VIEW,
        Permission.TRANSACTION_SUBMIT,
        Permission.TRANSACTION_VIEW,
        Permission.BLOCK_VIEW,
        Permission.CONSENSUS_VIEW,
        Permission.NETWORK_SYNC,
        Permission.READ_LEDGER,
        Permission.READ_ACCOUNTS,
        Permission.READ_STATS
      ],
      description: 'Basic network participant'
    });
  }

  /**
   * Register a new identity with roles
   * @param identity - Identity to register
   * @returns Success status
   */
  public registerIdentity(identity: Identity): boolean {
    try {
      // Validate identity
      if (!this.validateIdentity(identity)) {
        return false;
      }

      // Calculate permissions from roles
      identity.permissions = this.calculatePermissions(identity.roles);
      
      // Cache permissions for quick lookup
      this.permissionCache.set(identity.id, identity.permissions);
      
      // Store identity
      this.identities.set(identity.id, identity);
      
      return true;
    } catch (error) {
      console.error('Failed to register identity:', error);
      return false;
    }
  }

  /**
   * Check if an identity has permission to perform an action
   * @param identityId - Identity ID
   * @param permission - Permission to check
   * @param context - Optional context for additional checks
   * @returns Access decision
   */
  public hasPermission(
    identityId: string, 
    permission: Permission, 
    context?: Record<string, any>
  ): AccessDecision {
    try {
      const identity = this.identities.get(identityId);
      
      if (!identity) {
        return { 
          allowed: false, 
          reason: 'Identity not found' 
        };
      }

      if (!identity.isActive) {
        return { 
          allowed: false, 
          reason: 'Identity is inactive' 
        };
      }

      // Check cached permissions
      const permissions = this.permissionCache.get(identityId) || identity.permissions;
      
      if (permissions.includes(permission)) {
        // Additional context-based checks can be added here
        if (this.performContextCheck(identity, permission, context)) {
          return { allowed: true };
        } else {
          return { 
            allowed: false, 
            reason: 'Context check failed' 
          };
        }
      }

      return { 
        allowed: false, 
        reason: 'Permission denied',
        requiredPermissions: [permission]
      };
    } catch (error) {
      return { 
        allowed: false, 
        reason: `Error checking permission: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Check multiple permissions at once
   * @param identityId - Identity ID
   * @param permissions - Permissions to check (all must be granted)
   * @param context - Optional context
   * @returns Access decision
   */
  public hasPermissions(
    identityId: string, 
    permissions: Permission[], 
    context?: Record<string, any>
  ): AccessDecision {
    for (const permission of permissions) {
      const decision = this.hasPermission(identityId, permission, context);
      if (!decision.allowed) {
        return decision;
      }
    }
    
    return { allowed: true };
  }

  /**
   * Check if identity has any of the specified permissions
   * @param identityId - Identity ID
   * @param permissions - Permissions to check (any one is sufficient)
   * @param context - Optional context
   * @returns Access decision
   */
  public hasAnyPermission(
    identityId: string, 
    permissions: Permission[], 
    context?: Record<string, any>
  ): AccessDecision {
    for (const permission of permissions) {
      const decision = this.hasPermission(identityId, permission, context);
      if (decision.allowed) {
        return decision;
      }
    }
    
    return { 
      allowed: false, 
      reason: 'None of the required permissions are granted',
      requiredPermissions: permissions
    };
  }

  /**
   * Update identity roles
   * @param identityId - Identity ID
   * @param newRoles - New roles to assign
   * @returns Success status
   */
  public updateIdentityRoles(identityId: string, newRoles: NodeRole[]): boolean {
    try {
      const identity = this.identities.get(identityId);
      if (!identity) {
        return false;
      }

      // Validate new roles
      for (const role of newRoles) {
        if (!this.roles.has(role)) {
          return false;
        }
      }

      // Update roles and recalculate permissions
      identity.roles = newRoles;
      identity.permissions = this.calculatePermissions(newRoles);
      identity.lastActive = Date.now();
      
      // Update cache
      this.permissionCache.set(identityId, identity.permissions);
      
      return true;
    } catch (error) {
      console.error('Failed to update identity roles:', error);
      return false;
    }
  }

  /**
   * Deactivate an identity
   * @param identityId - Identity ID
   * @returns Success status
   */
  public deactivateIdentity(identityId: string): boolean {
    const identity = this.identities.get(identityId);
    if (!identity) {
      return false;
    }

    identity.isActive = false;
    identity.lastActive = Date.now();
    
    return true;
  }

  /**
   * Get identity by ID
   * @param identityId - Identity ID
   * @returns Identity or null if not found
   */
  public getIdentity(identityId: string): Identity | null {
    return this.identities.get(identityId) || null;
  }

  /**
   * Get all identities
   * @returns Array of all identities
   */
  public getAllIdentities(): Identity[] {
    return Array.from(this.identities.values());
  }

  /**
   * Get role definition
   * @param role - Role to get
   * @returns Role definition or null if not found
   */
  public getRole(role: NodeRole): Role | null {
    return this.roles.get(role) || null;
  }

  /**
   * Get all available roles
   * @returns Map of all roles
   */
  public getAllRoles(): Map<NodeRole, Role> {
    return new Map(this.roles);
  }

  /**
   * Calculate permissions from roles
   * @param roles - Array of roles
   * @returns Array of permissions
   */
  private calculatePermissions(roles: NodeRole[]): Permission[] {
    const permissions = new Set<Permission>();
    
    for (const role of roles) {
      const roleDef = this.roles.get(role);
      if (roleDef) {
        roleDef.permissions.forEach(permission => {
          permissions.add(permission);
        });
      }
    }
    
    return Array.from(permissions);
  }

  /**
   * Validate identity structure
   * @param identity - Identity to validate
   * @returns True if valid
   */
  private validateIdentity(identity: Identity): boolean {
    if (!identity.id || !identity.address || !identity.publicKey) {
      return false;
    }

    if (!Array.isArray(identity.roles) || identity.roles.length === 0) {
      return false;
    }

    // Validate roles
    for (const role of identity.roles) {
      if (!this.roles.has(role)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Perform context-based permission checks
   * @param identity - Identity
   * @param permission - Permission being checked
   * @param context - Additional context
   * @returns True if context check passes
   */
  private performContextCheck(
    identity: Identity, 
    permission: Permission, 
    context?: Record<string, any>
  ): boolean {
    if (!context) {
      return true; // No context means no additional checks
    }

    // Example context checks:
    
    // Time-based restrictions
    if (context.timeRestricted && identity.lastActive) {
      const maxInactiveTime = context.maxInactiveTime || 86400000; // 24 hours default
      if (Date.now() - identity.lastActive > maxInactiveTime) {
        return false;
      }
    }

    // Network-specific restrictions
    if (context.networkId && identity.metadata?.networkId) {
      if (identity.metadata.networkId !== context.networkId) {
        return false;
      }
    }

    // Emergency mode restrictions
    if (context.emergencyMode) {
      // Only authorities can act in emergency mode
      return identity.roles.includes(NodeRole.AUTHORITY);
    }

    return true;
  }

  /**
   * Get RBAC statistics
   * @returns Statistics about the RBAC system
   */
  public getStats(): {
    totalIdentities: number;
    activeIdentities: number;
    roleDistribution: Record<NodeRole, number>;
    totalRoles: number;
  } {
    const roleDistribution: Record<NodeRole, number> = {
      [NodeRole.AUTHORITY]: 0,
      [NodeRole.VALIDATOR]: 0,
      [NodeRole.PEER]: 0
    };

    let activeCount = 0;
    
    for (const identity of this.identities.values()) {
      if (identity.isActive) {
        activeCount++;
      }
      
      for (const role of identity.roles) {
        roleDistribution[role]++;
      }
    }

    return {
      totalIdentities: this.identities.size,
      activeIdentities: activeCount,
      roleDistribution,
      totalRoles: this.roles.size
    };
  }
}
