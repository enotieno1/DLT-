export { 
  RBACManager, 
  Permission, 
  Role, 
  Identity, 
  AccessDecision 
} from './rbac';

export { 
  AuthMiddleware 
} from './middleware';

// Re-export commonly used types
export type { 
  Role as IRole,
  Identity as IIdentity,
  AccessDecision as IAccessDecision
} from './rbac';
