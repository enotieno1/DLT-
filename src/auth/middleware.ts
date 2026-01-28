import { Request, Response, NextFunction } from 'express';
import { RBACManager, Permission, AccessDecision } from './rbac';
import { SignatureUtils } from '../core/crypto';

/**
 * Authentication and authorization middleware
 */
export class AuthMiddleware {
  private rbac: RBACManager;

  constructor(rbac: RBACManager) {
    this.rbac = rbac;
  }

  /**
   * Extract identity from request
   * @param req - Express request
   * @returns Identity ID or null if not found
   */
  private extractIdentity(req: Request): string | null {
    // Try to get identity from various sources
    
    // 1. Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // 2. X-Identity-ID header
    const identityHeader = req.headers['x-identity-id'] as string;
    if (identityHeader) {
      return identityHeader;
    }

    // 3. From request body (for internal API calls)
    if (req.body && req.body.identityId) {
      return req.body.identityId;
    }

    // 4. From query parameters
    if (req.query.identityId) {
      return req.query.identityId as string;
    }

    return null;
  }

  /**
   * Verify request signature
   * @param req - Express request
   * @param identityId - Identity ID
   * @returns True if signature is valid
   */
  private verifySignature(req: Request, identityId: string): boolean {
    try {
      const signature = req.headers['x-signature'] as string;
      const timestamp = req.headers['x-timestamp'] as string;
      
      if (!signature || !timestamp) {
        return false;
      }

      // Check timestamp to prevent replay attacks (5 minute window)
      const now = Date.now();
      const requestTime = parseInt(timestamp);
      const timeWindow = 5 * 60 * 1000; // 5 minutes
      
      if (Math.abs(now - requestTime) > timeWindow) {
        return false;
      }

      // Get identity public key
      const identity = this.rbac.getIdentity(identityId);
      if (!identity) {
        return false;
      }

      // Create message to verify
      const method = req.method;
      const path = req.path;
      const body = JSON.stringify(req.body || {});
      const message = `${method}:${path}:${body}:${timestamp}`;

      // Verify signature
      return SignatureUtils.verify(message, signature, identity.publicKey);
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }

  /**
   * Middleware to require authentication
   */
  public authenticate = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const identityId = this.extractIdentity(req);
      
      if (!identityId) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'No identity provided'
        });
        return;
      }

      const identity = this.rbac.getIdentity(identityId);
      if (!identity) {
        res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid identity'
        });
        return;
      }

      if (!identity.isActive) {
        res.status(401).json({
          error: 'Authentication failed',
          message: 'Identity is inactive'
        });
        return;
      }

      // Verify signature for sensitive operations
      if (this.requiresSignature(req)) {
        if (!this.verifySignature(req, identityId)) {
          res.status(401).json({
            error: 'Authentication failed',
            message: 'Invalid signature'
          });
          return;
        }
      }

      // Attach identity to request
      (req as any).identity = identity;
      (req as any).identityId = identityId;
      
      next();
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(500).json({
        error: 'Authentication error',
        message: 'Internal server error'
      });
    }
  };

  /**
   * Middleware to require specific permission
   * @param permission - Required permission
   * @param context - Optional context for permission check
   */
  public requirePermission = (
    permission: Permission, 
    context?: Record<string, any>
  ) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const identityId = (req as any).identityId;
        
        if (!identityId) {
          res.status(401).json({
            error: 'Authentication required',
            message: 'No identity found in request'
          });
          return;
        }

        const decision = this.rbac.hasPermission(identityId, permission, context);
        
        if (!decision.allowed) {
          res.status(403).json({
            error: 'Access denied',
            message: decision.reason || 'Permission denied',
            requiredPermissions: decision.requiredPermissions
          });
          return;
        }

        next();
      } catch (error) {
        console.error('Permission check error:', error);
        res.status(500).json({
          error: 'Authorization error',
          message: 'Internal server error'
        });
      }
    };
  };

  /**
   * Middleware to require any of multiple permissions
   * @param permissions - Array of permissions (any one is sufficient)
   * @param context - Optional context
   */
  public requireAnyPermission = (
    permissions: Permission[], 
    context?: Record<string, any>
  ) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const identityId = (req as any).identityId;
        
        if (!identityId) {
          res.status(401).json({
            error: 'Authentication required',
            message: 'No identity found in request'
          });
          return;
        }

        const decision = this.rbac.hasAnyPermission(identityId, permissions, context);
        
        if (!decision.allowed) {
          res.status(403).json({
            error: 'Access denied',
            message: decision.reason || 'Permission denied',
            requiredPermissions: decision.requiredPermissions
          });
          return;
        }

        next();
      } catch (error) {
        console.error('Permission check error:', error);
        res.status(500).json({
          error: 'Authorization error',
          message: 'Internal server error'
        });
      }
    };
  };

  /**
   * Middleware to require all specified permissions
   * @param permissions - Array of permissions (all are required)
   * @param context - Optional context
   */
  public requirePermissions = (
    permissions: Permission[], 
    context?: Record<string, any>
  ) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const identityId = (req as any).identityId;
        
        if (!identityId) {
          res.status(401).json({
            error: 'Authentication required',
            message: 'No identity found in request'
          });
          return;
        }

        const decision = this.rbac.hasPermissions(identityId, permissions, context);
        
        if (!decision.allowed) {
          res.status(403).json({
            error: 'Access denied',
            message: decision.reason || 'Permission denied',
            requiredPermissions: decision.requiredPermissions
          });
          return;
        }

        next();
      } catch (error) {
        console.error('Permission check error:', error);
        res.status(500).json({
          error: 'Authorization error',
          message: 'Internal server error'
        });
      }
    };
  };

  /**
   * Middleware to require specific role
   * @param role - Required role
   */
  public requireRole = (role: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const identity = (req as any).identity;
        
        if (!identity) {
          res.status(401).json({
            error: 'Authentication required',
            message: 'No identity found in request'
          });
          return;
        }

        if (!identity.roles.includes(role)) {
          res.status(403).json({
            error: 'Access denied',
            message: `Required role: ${role}`
          });
          return;
        }

        next();
      } catch (error) {
        console.error('Role check error:', error);
        res.status(500).json({
          error: 'Authorization error',
          message: 'Internal server error'
        });
      }
    };
  };

  /**
   * Middleware to check if request requires signature verification
   * @param req - Express request
   * @returns True if signature is required
   */
  private requiresSignature(req: Request): boolean {
    // Define which endpoints require signature verification
    const sensitiveEndpoints = [
      'POST',
      'PUT',
      'DELETE'
    ];

    // Skip for GET requests and health checks
    if (req.method === 'GET' || req.path === '/health') {
      return false;
    }

    // Check if it's a sensitive operation
    return sensitiveEndpoints.includes(req.method);
  }

  /**
   * Middleware to add rate limiting based on role
   * @param limits - Rate limits per role
   */
  public rateLimitByRole = (limits: Record<string, number>) => {
    const requestCounts = new Map<string, { count: number; resetTime: number }>();

    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const identity = (req as any).identity;
        
        if (!identity) {
          next();
          return;
        }

        // Get the highest privilege role for rate limiting
        const role = identity.roles.includes('authority') ? 'authority' :
                    identity.roles.includes('validator') ? 'validator' : 'peer';

        const limit = limits[role] || limits.default || 100;
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 minute window

        const key = `${identity.id}:${role}`;
        const current = requestCounts.get(key);

        if (!current || now > current.resetTime) {
          requestCounts.set(key, { count: 1, resetTime: now + windowMs });
          next();
          return;
        }

        if (current.count >= limit) {
          res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Too many requests. Limit: ${limit} per minute`
          });
          return;
        }

        current.count++;
        next();
      } catch (error) {
        console.error('Rate limiting error:', error);
        next(); // Allow request on error
      }
    };
  };

  /**
   * Middleware to log access attempts
   */
  public accessLogger = (req: Request, res: Response, next: NextFunction): void => {
    const identityId = (req as any).identityId || 'anonymous';
    const method = req.method;
    const path = req.path;
    const ip = req.ip || req.connection.remoteAddress;

    console.log(`[ACCESS] ${identityId} ${method} ${path} from ${ip}`);
    
    // Log response after it's sent
    const originalSend = res.send;
    res.send = function(data) {
      console.log(`[ACCESS] ${identityId} ${method} ${path} - ${res.statusCode}`);
      return originalSend.call(this, data);
    };

    next();
  };
}
