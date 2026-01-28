import { EventEmitter } from 'events';

export interface AccessControlConfig {
  enableRoleBasedAccess: boolean;
  enableAttributeBasedAccess: boolean;
  enableMultiFactorAuth: boolean;
  enableSessionManagement: boolean;
  enableAuditLogging: boolean;
  sessionTimeout: number;
  maxLoginAttempts: number;
  passwordPolicy: PasswordPolicy;
  defaultRoles: Role[];
  permissions: Permission[];
}

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  preventReuse: number;
  maxAge: number;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  inheritsFrom?: string[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  conditions?: AccessCondition[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AccessCondition {
  type: 'TIME' | 'IP' | 'LOCATION' | 'DEVICE' | 'AMOUNT' | 'FREQUENCY';
  operator: 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN' | 'BETWEEN' | 'IN' | 'NOT_IN';
  value: any;
  description: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  roles: string[];
  permissions: string[];
  isActive: boolean;
  isLocked: boolean;
  lastLogin?: number;
  loginAttempts: number;
  mfaEnabled: boolean;
  mfaSecret?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  refreshToken: string;
  ipAddress: string;
  userAgent: string;
  createdAt: number;
  expiresAt: number;
  isActive: boolean;
  lastAccessed: number;
}

export interface AccessRequest {
  id: string;
  userId: string;
  resource: string;
  action: string;
  context: any;
  timestamp: number;
  granted: boolean;
  reason?: string;
  sessionId: string;
}

export interface AccessPolicy {
  id: string;
  name: string;
  description: string;
  rules: AccessRule[];
  priority: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AccessRule {
  resource: string;
  action: string;
  conditions: AccessCondition[];
  effect: 'ALLOW' | 'DENY';
  priority: number;
}

/**
 * Comprehensive access control and permissions system
 * Implements RBAC, ABAC, MFA, session management, and audit logging
 */
export class AccessControl extends EventEmitter {
  private config: AccessControlConfig;
  private users: Map<string, User> = new Map();
  private roles: Map<string, Role> = new Map();
  private permissions: Map<string, Permission> = new Map();
  private sessions: Map<string, Session> = new Map();
  private accessRequests: AccessRequest[] = [];
  private policies: Map<string, AccessPolicy> = new Map();
  private sessionCleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<AccessControlConfig> = {}) {
    super();
    
    this.config = {
      enableRoleBasedAccess: true,
      enableAttributeBasedAccess: true,
      enableMultiFactorAuth: false,
      enableSessionManagement: true,
      enableAuditLogging: true,
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
      maxLoginAttempts: 5,
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        preventReuse: 5,
        maxAge: 90 * 24 * 60 * 60 * 1000 // 90 days
      },
      defaultRoles: [],
      permissions: [],
      ...config
    };

    this.initializeDefaultRoles();
    this.initializeDefaultPermissions();
    
    if (this.config.enableSessionManagement) {
      this.startSessionCleanup();
    }
  }

  /**
   * Create new user
   * @param userData - User data
   * @returns User ID
   */
  public createUser(userData: {
    username: string;
    email: string;
    password: string;
    roles?: string[];
  }): string {
    const userId = this.generateUserId();
    
    // Validate password
    if (!this.validatePassword(userData.password)) {
      throw new Error('Password does not meet security requirements');
    }

    // Check if username already exists
    for (const user of this.users.values()) {
      if (user.username === userData.username || user.email === userData.email) {
        throw new Error('Username or email already exists');
      }
    }

    const user: User = {
      id: userId,
      username: userData.username,
      email: userData.email,
      password: this.hashPassword(userData.password),
      roles: userData.roles || [],
      permissions: [],
      isActive: true,
      isLocked: false,
      loginAttempts: 0,
      mfaEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.users.set(userId, user);
    
    // Calculate user permissions from roles
    this.updateUserPermissions(userId);

    this.emit('userCreated', {
      userId,
      username: user.username,
      email: user.email,
      roles: user.roles
    });

    return userId;
  }

  /**
   * Authenticate user
   * @param username - Username
   * @param password - Password
   * @param mfaCode - MFA code (if enabled)
   * @returns Session token
   */
  public authenticate(
    username: string,
    password: string,
    mfaCode?: string
  ): { success: boolean; token?: string; error?: string } {
    const user = this.getUserByUsername(username);
    
    if (!user) {
      return { success: false, error: 'Invalid credentials' };
    }

    if (!user.isActive) {
      return { success: false, error: 'Account is inactive' };
    }

    if (user.isLocked) {
      return { success: false, error: 'Account is locked' };
    }

    if (!this.verifyPassword(password, user.password)) {
      user.loginAttempts++;
      
      if (user.loginAttempts >= this.config.maxLoginAttempts) {
        user.isLocked = true;
        this.emit('accountLocked', { userId: user.id, username: user.username });
      }
      
      return { success: false, error: 'Invalid credentials' };
    }

    // Check MFA if enabled
    if (user.mfaEnabled && this.config.enableMultiFactorAuth) {
      if (!mfaCode || !this.verifyMFA(user, mfaCode)) {
        return { success: false, error: 'Invalid MFA code' };
      }
    }

    // Reset login attempts
    user.loginAttempts = 0;
    user.lastLogin = Date.now();

    // Create session
    const session = this.createSession(user.id);

    this.emit('userAuthenticated', {
      userId: user.id,
      username: user.username,
      sessionId: session.id
    });

    return { success: true, token: session.token };
  }

  /**
   * Check access permission
   * @param userId - User ID
   * @param resource - Resource
   * @param action - Action
   * @param context - Additional context
   * @returns Access result
   */
  public checkAccess(
    userId: string,
    resource: string,
    action: string,
    context: any = {}
  ): { granted: boolean; reason?: string } {
    const user = this.users.get(userId);
    
    if (!user) {
      return { granted: false, reason: 'User not found' };
    }

    if (!user.isActive) {
      return { granted: false, reason: 'User is inactive' };
    }

    if (user.isLocked) {
      return { granted: false, reason: 'User is locked' };
    }

    // Check RBAC permissions
    if (this.config.enableRoleBasedAccess) {
      const rbacResult = this.checkRBACAccess(user, resource, action);
      if (!rbacResult.granted) {
        return rbacResult;
      }
    }

    // Check ABAC policies
    if (this.config.enableAttributeBasedAccess) {
      const abacResult = this.checkABACAccess(user, resource, action, context);
      if (!abacResult.granted) {
        return abacResult;
      }
    }

    // Log access request
    if (this.config.enableAuditLogging) {
      this.logAccessRequest(userId, resource, action, context, true);
    }

    return { granted: true };
  }

  /**
   * Check RBAC access
   */
  private checkRBACAccess(
    user: User,
    resource: string,
    action: string
  ): { granted: boolean; reason?: string } {
    // Check direct permissions
    const hasDirectPermission = user.permissions.some(permissionId => {
      const permission = this.permissions.get(permissionId);
      return permission && 
             permission.resource === resource && 
             permission.action === action &&
             permission.isActive;
    });

    if (hasDirectPermission) {
      return { granted: true };
    }

    // Check role-based permissions
    for (const roleId of user.roles) {
      const role = this.roles.get(roleId);
      if (!role || !role.isActive) {
        continue;
      }

      const hasRolePermission = role.permissions.some(permissionId => {
        const permission = this.permissions.get(permissionId);
        return permission && 
               permission.resource === resource && 
               permission.action === action &&
               permission.isActive;
      });

      if (hasRolePermission) {
        return { granted: true };
      }
    }

    return { granted: false, reason: 'Insufficient permissions' };
  }

  /**
   * Check ABAC access
   */
  private checkABACAccess(
    user: User,
    resource: string,
    action: string,
    context: any
  ): { granted: boolean; reason?: string } {
    // Get applicable policies
    const applicablePolicies = Array.from(this.policies.values())
      .filter(policy => 
        policy.isActive && 
        this.isPolicyApplicable(policy, user, resource, action, context)
      )
      .sort((a, b) => b.priority - a.priority);

    // Evaluate policies
    for (const policy of applicablePolicies) {
      const result = this.evaluatePolicy(policy, user, resource, action, context);
      
      if (result.effect === 'DENY') {
        return { granted: false, reason: `Policy denied: ${policy.name}` };
      }
      
      if (result.effect === 'ALLOW') {
        return { granted: true };
      }
    }

    return { granted: true }; // Default allow if no policies deny
  }

  /**
   * Check if policy is applicable
   */
  private isPolicyApplicable(
    policy: AccessPolicy,
    user: User,
    resource: string,
    action: string,
    context: any
  ): boolean {
    return policy.rules.some(rule => 
      rule.resource === resource && rule.action === action
    );
  }

  /**
   * Evaluate policy rule
   */
  private evaluatePolicyRule(
    rule: AccessRule,
    user: User,
    context: any
  ): { effect: 'ALLOW' | 'DENY'; matched: boolean } {
    let matched = true;

    for (const condition of rule.conditions) {
      if (!this.evaluateCondition(condition, user, context)) {
        matched = false;
        break;
      }
    }

    return { effect: rule.effect, matched };
  }

  /**
   * Evaluate condition
   */
  private evaluateCondition(
    condition: AccessCondition,
    user: User,
    context: any
  ): boolean {
    let actualValue: any;

    switch (condition.type) {
      case 'TIME':
        actualValue = Date.now();
        break;
      case 'IP':
        actualValue = context.ipAddress;
        break;
      case 'LOCATION':
        actualValue = context.location;
        break;
      case 'DEVICE':
        actualValue = context.device;
        break;
      case 'AMOUNT':
        actualValue = context.amount;
        break;
      case 'FREQUENCY':
        actualValue = context.frequency;
        break;
      default:
        return true;
    }

    return this.compareValues(actualValue, condition.operator, condition.value);
  }

  /**
   * Compare values
   */
  private compareValues(
    actual: any,
    operator: string,
    expected: any
  ): boolean {
    switch (operator) {
      case 'EQUALS':
        return actual === expected;
      case 'NOT_EQUALS':
        return actual !== expected;
      case 'GREATER_THAN':
        return actual > expected;
      case 'LESS_THAN':
        return actual < expected;
      case 'BETWEEN':
        return actual >= expected[0] && actual <= expected[1];
      case 'IN':
        return expected.includes(actual);
      case 'NOT_IN':
        return !expected.includes(actual);
      default:
        return false;
    }
  }

  /**
   * Create session
   */
  private createSession(userId: string): Session {
    const sessionId = this.generateSessionId();
    const token = this.generateToken();
    const refreshToken = this.generateToken();
    const now = Date.now();

    const session: Session = {
      id: sessionId,
      userId,
      token,
      refreshToken,
      ipAddress: '',
      userAgent: '',
      createdAt: now,
      expiresAt: now + this.config.sessionTimeout,
      isActive: true,
      lastAccessed: now
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Validate session
   */
  public validateSession(token: string): { valid: boolean; userId?: string; error?: string } {
    for (const session of this.sessions.values()) {
      if (session.token === token && session.isActive) {
        if (Date.now() > session.expiresAt) {
          session.isActive = false;
          return { valid: false, error: 'Session expired' };
        }

        // Update last accessed
        session.lastAccessed = Date.now();
        
        return { valid: true, userId: session.userId };
      }
    }

    return { valid: false, error: 'Invalid session' };
  }

  /**
   * Logout user
   */
  public logout(token: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.token === token) {
        session.isActive = false;
        
        this.emit('userLoggedOut', {
          userId: session.userId,
          sessionId: session.id
        });
        
        return true;
      }
    }

    return false;
  }

  /**
   * Assign role to user
   */
  public assignRole(userId: string, roleId: string): boolean {
    const user = this.users.get(userId);
    const role = this.roles.get(roleId);
    
    if (!user || !role) {
      return false;
    }

    if (!user.roles.includes(roleId)) {
      user.roles.push(roleId);
      user.updatedAt = Date.now();
      
      // Update user permissions
      this.updateUserPermissions(userId);

      this.emit('roleAssigned', {
        userId,
        roleId,
        roleName: role.name
      });
    }

    return true;
  }

  /**
   * Remove role from user
   */
  public removeRole(userId: string, roleId: string): boolean {
    const user = this.users.get(userId);
    
    if (!user) {
      return false;
    }

    const index = user.roles.indexOf(roleId);
    if (index > -1) {
      user.roles.splice(index, 1);
      user.updatedAt = Date.now();
      
      // Update user permissions
      this.updateUserPermissions(userId);

      this.emit('roleRemoved', {
        userId,
        roleId
      });
    }

    return true;
  }

  /**
   * Create role
   */
  public createRole(roleData: {
    name: string;
    description: string;
    permissions: string[];
    inheritsFrom?: string[];
  }): string {
    const roleId = this.generateRoleId();
    
    const role: Role = {
      id: roleId,
      name: roleData.name,
      description: roleData.description,
      permissions: roleData.permissions,
      inheritsFrom: roleData.inheritsFrom,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.roles.set(roleId, role);

    this.emit('roleCreated', {
      roleId,
      name: role.name,
      description: role.description
    });

    return roleId;
  }

  /**
   * Create permission
   */
  public createPermission(permissionData: {
    name: string;
    resource: string;
    action: string;
    conditions?: AccessCondition[];
  }): string {
    const permissionId = this.generatePermissionId();
    
    const permission: Permission = {
      id: permissionId,
      name: permissionData.name,
      resource: permissionData.resource,
      action: permissionData.action,
      conditions: permissionData.conditions,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.permissions.set(permissionId, permission);

    this.emit('permissionCreated', {
      permissionId,
      name: permission.name,
      resource: permission.resource,
      action: permission.action
    });

    return permissionId;
  }

  /**
   * Get user by ID
   */
  public getUser(userId: string): User | null {
    return this.users.get(userId) || null;
  }

  /**
   * Get user by username
   */
  public getUserByUsername(username: string): User | null {
    for (const user of this.users.values()) {
      if (user.username === username) {
        return user;
      }
    }
    return null;
  }

  /**
   * Get all users
   */
  public getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  /**
   * Get role by ID
   */
  public getRole(roleId: string): Role | null {
    return this.roles.get(roleId) || null;
  }

  /**
   * Get all roles
   */
  public getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Get permission by ID
   */
  public getPermission(permissionId: string): Permission | null {
    return this.permissions.get(permissionId) || null;
  }

  /**
   * Get all permissions
   */
  public getAllPermissions(): Permission[] {
    return Array.from(this.permissions.values());
  }

  /**
   * Get access statistics
   */
  public getAccessStats(): {
    totalUsers: number;
    activeUsers: number;
    lockedUsers: number;
    totalRoles: number;
    activeRoles: number;
    totalPermissions: number;
    activePermissions: number;
    activeSessions: number;
    averageRolesPerUser: number;
    averagePermissionsPerUser: number;
  } {
    const users = Array.from(this.users.values());
    const roles = Array.from(this.roles.values());
    const permissions = Array.from(this.permissions.values());
    const sessions = Array.from(this.sessions.values());

    const totalRolesPerUser = users.reduce((sum, user) => sum + user.roles.length, 0);
    const totalPermissionsPerUser = users.reduce((sum, user) => sum + user.permissions.length, 0);

    return {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.isActive).length,
      lockedUsers: users.filter(u => u.isLocked).length,
      totalRoles: roles.length,
      activeRoles: roles.filter(r => r.isActive).length,
      totalPermissions: permissions.length,
      activePermissions: permissions.filter(p => p.isActive).length,
      activeSessions: sessions.filter(s => s.isActive).length,
      averageRolesPerUser: users.length > 0 ? totalRolesPerUser / users.length : 0,
      averagePermissionsPerUser: users.length > 0 ? totalPermissionsPerUser / users.length : 0
    };
  }

  // Helper methods

  private generateUserId(): string {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateRoleId(): string {
    return `role_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generatePermissionId(): string {
    return `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateToken(): string {
    return Buffer.from(`${Date.now()}_${Math.random().toString(36).substr(2, 9)}`).toString('base64');
  }

  private hashPassword(password: string): string {
    // In a real implementation, use proper password hashing
    return `hashed_${password}`;
  }

  private verifyPassword(password: string, hashedPassword: string): boolean {
    // In a real implementation, use proper password verification
    return hashedPassword === `hashed_${password}`;
  }

  private validatePassword(password: string): boolean {
    const policy = this.config.passwordPolicy;
    
    if (password.length < policy.minLength) {
      return false;
    }
    
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      return false;
    }
    
    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      return false;
    }
    
    if (policy.requireNumbers && !/\d/.test(password)) {
      return false;
    }
    
    if (policy.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return false;
    }
    
    return true;
  }

  private verifyMFA(user: User, mfaCode: string): boolean {
    // In a real implementation, verify MFA code
    return mfaCode === '123456'; // Mock verification
  }

  private updateUserPermissions(userId: string): void {
    const user = this.users.get(userId);
    if (!user) {
      return;
    }

    const permissions = new Set<string>();

    // Add permissions from roles
    for (const roleId of user.roles) {
      const role = this.roles.get(roleId);
      if (role && role.isActive) {
        role.permissions.forEach(permissionId => permissions.add(permissionId));
      }
    }

    user.permissions = Array.from(permissions);
    user.updatedAt = Date.now();
  }

  private logAccessRequest(
    userId: string,
    resource: string,
    action: string,
    context: any,
    granted: boolean
  ): void {
    const request: AccessRequest = {
      id: this.generateAccessRequestId(),
      userId,
      resource,
      action,
      context,
      timestamp: Date.now(),
      granted,
      sessionId: context.sessionId || ''
    };

    this.accessRequests.push(request);

    // Keep only last 10000 requests
    if (this.accessRequests.length > 10000) {
      this.accessRequests = this.accessRequests.slice(-10000);
    }

    this.emit('accessRequested', {
      userId,
      resource,
      action,
      granted,
      timestamp: request.timestamp
    });
  }

  private generateAccessRequestId(): string {
    return `access_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private initializeDefaultRoles(): void {
    const defaultRoles = [
      {
        name: 'ADMIN',
        description: 'System administrator with full access',
        permissions: []
      },
      {
        name: 'USER',
        description: 'Regular user with basic access',
        permissions: []
      },
      {
        name: 'AUDITOR',
        description: 'Auditor with read-only access',
        permissions: []
      }
    ];

    for (const roleData of defaultRoles) {
      this.createRole(roleData);
    }
  }

  private initializeDefaultPermissions(): void {
    const defaultPermissions = [
      {
        name: 'READ_USERS',
        resource: 'users',
        action: 'read'
      },
      {
        name: 'WRITE_USERS',
        resource: 'users',
        action: 'write'
      },
      {
        name: 'DELETE_USERS',
        resource: 'users',
        action: 'delete'
      },
      {
        name: 'READ_TRANSACTIONS',
        resource: 'transactions',
        action: 'read'
      },
      {
        name: 'WRITE_TRANSACTIONS',
        resource: 'transactions',
        action: 'write'
      },
      {
        name: 'READ_BLOCKS',
        resource: 'blocks',
        action: 'read'
      },
      {
        name: 'MANAGE_ROLES',
        resource: 'roles',
        action: 'manage'
      },
      {
        name: 'MANAGE_PERMISSIONS',
        resource: 'permissions',
        action: 'manage'
      }
    ];

    for (const permissionData of defaultPermissions) {
      this.createPermission(permissionData);
    }
  }

  private startSessionCleanup(): void {
    this.sessionCleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const session of this.sessions.values()) {
      if (session.isActive && now > session.expiresAt) {
        session.isActive = false;
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.emit('sessionsCleaned', { count: cleanedCount });
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<AccessControlConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): AccessControlConfig {
    return { ...this.config };
  }

  /**
   * Stop access control system
   */
  public stop(): void {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
    }

    this.emit('accessControlStopped');
  }
}
