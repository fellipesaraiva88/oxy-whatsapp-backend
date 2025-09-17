import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

// Extend Express Request interface
export interface AuthenticatedRequest extends Request {
  userId?: string;
  user?: any;
  session?: any;
}

// Rate limiting store
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// CORS allowed origins cache
const allowedOriginsCache = new Set<string>();

export class AuthMiddleware {
  private supabase;
  private jwtSecret: string;
  private maxRequestsPerMinute = 60;
  private sessionCache = new Map<string, { user: any; expiresAt: number }>();

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    this.jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || '';

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase authentication credentials');
    }

    if (!this.jwtSecret) {
      logger.warn('JWT_SECRET not configured, using Supabase default');
    }

    // Initialize Supabase client with service key for admin operations
    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    });

    // Initialize allowed origins
    const origins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'];
    origins.forEach(origin => allowedOriginsCache.add(origin.trim()));

    // Clear expired sessions every 5 minutes
    setInterval(() => this.clearExpiredSessions(), 5 * 60 * 1000);

    logger.info('Authentication middleware initialized');
  }

  /**
   * Main authentication middleware
   */
  authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract token from various sources
      const token = this.extractToken(req);

      if (!token) {
        res.status(401).json({
          error: 'Authentication required',
          code: 'MISSING_TOKEN'
        });
        return;
      }

      // Check rate limiting
      if (!this.checkRateLimit(req)) {
        res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED'
        });
        return;
      }

      // Validate token and get user
      const authResult = await this.validateToken(token);

      if (!authResult.valid) {
        res.status(401).json({
          error: authResult.error || 'Invalid token',
          code: authResult.code || 'INVALID_TOKEN'
        });
        return;
      }

      // Attach user info to request
      req.userId = authResult.userId;
      req.user = authResult.user;
      req.session = authResult.session;

      // Log successful authentication
      logger.debug('Request authenticated', {
        userId: req.userId,
        path: req.path,
        method: req.method
      });

      next();
    } catch (error) {
      logger.error('Authentication error:', error);
      res.status(500).json({
        error: 'Internal authentication error',
        code: 'AUTH_ERROR'
      });
    }
  };

  /**
   * Optional authentication - doesn't block if no token
   */
  optionalAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = this.extractToken(req);

      if (token) {
        const authResult = await this.validateToken(token);

        if (authResult.valid) {
          req.userId = authResult.userId;
          req.user = authResult.user;
          req.session = authResult.session;
        }
      }

      next();
    } catch (error) {
      logger.error('Optional auth error:', error);
      next();
    }
  };

  /**
   * Admin-only authentication
   */
  requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    await this.authenticate(req, res, async () => {
      try {
        // Check if user has admin role
        const { data: profile, error } = await this.supabase
          .from('profiles')
          .select('role')
          .eq('user_id', req.userId)
          .single();

        if (error || !profile || profile.role !== 'admin') {
          res.status(403).json({
            error: 'Admin access required',
            code: 'INSUFFICIENT_PERMISSIONS'
          });
          return;
        }

        next();
      } catch (error) {
        logger.error('Admin check error:', error);
        res.status(500).json({
          error: 'Authorization check failed',
          code: 'AUTH_CHECK_ERROR'
        });
      }
    });
  };

  /**
   * CORS middleware with security headers
   */
  corsWithCredentials = (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // Check if origin is allowed
    if (origin && allowedOriginsCache.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }

    next();
  };

  /**
   * Extract token from request
   */
  private extractToken(req: Request): string | null {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        return parts[1];
      }
    }

    // Check cookie
    if (req.cookies && req.cookies['sb-access-token']) {
      return req.cookies['sb-access-token'];
    }

    // Check query parameter (less secure, use sparingly)
    if (req.query.token && typeof req.query.token === 'string') {
      return req.query.token;
    }

    return null;
  }

  /**
   * Validate token and get user info
   */
  private async validateToken(token: string): Promise<{
    valid: boolean;
    userId?: string;
    user?: any;
    session?: any;
    error?: string;
    code?: string;
  }> {
    try {
      // Check session cache first
      const cached = this.sessionCache.get(token);
      if (cached && cached.expiresAt > Date.now()) {
        return {
          valid: true,
          userId: cached.user.id,
          user: cached.user,
          session: { access_token: token }
        };
      }

      // Validate with Supabase
      const { data: { user }, error } = await this.supabase.auth.getUser(token);

      if (error || !user) {
        // Try to decode JWT for debugging
        try {
          const decoded = jwt.decode(token) as any;

          if (decoded && decoded.exp && decoded.exp * 1000 < Date.now()) {
            return {
              valid: false,
              error: 'Token expired',
              code: 'TOKEN_EXPIRED'
            };
          }
        } catch {
          // Ignore decode errors
        }

        return {
          valid: false,
          error: error?.message || 'Invalid token',
          code: 'INVALID_TOKEN'
        };
      }

      // Cache the session
      this.sessionCache.set(token, {
        user,
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
      });

      return {
        valid: true,
        userId: user.id,
        user,
        session: { access_token: token }
      };
    } catch (error) {
      logger.error('Token validation error:', error);
      return {
        valid: false,
        error: 'Token validation failed',
        code: 'VALIDATION_ERROR'
      };
    }
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(req: Request): boolean {
    const identifier = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
    const now = Date.now();

    const limit = rateLimitStore.get(identifier);

    if (!limit || limit.resetTime < now) {
      // Reset or initialize
      rateLimitStore.set(identifier, {
        count: 1,
        resetTime: now + 60 * 1000 // 1 minute window
      });
      return true;
    }

    if (limit.count >= this.maxRequestsPerMinute) {
      return false;
    }

    limit.count++;
    return true;
  }

  /**
   * Clear expired sessions from cache
   */
  private clearExpiredSessions(): void {
    const now = Date.now();
    let cleared = 0;

    for (const [token, session] of this.sessionCache.entries()) {
      if (session.expiresAt < now) {
        this.sessionCache.delete(token);
        cleared++;
      }
    }

    if (cleared > 0) {
      logger.debug(`Cleared ${cleared} expired sessions from cache`);
    }
  }

  /**
   * Refresh token endpoint handler
   */
  refreshToken = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const refreshToken = req.body.refresh_token;

      if (!refreshToken) {
        res.status(400).json({
          error: 'Refresh token required',
          code: 'MISSING_REFRESH_TOKEN'
        });
        return;
      }

      // Refresh the session
      const { data, error } = await this.supabase.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (error || !data.session) {
        res.status(401).json({
          error: 'Invalid refresh token',
          code: 'INVALID_REFRESH_TOKEN'
        });
        return;
      }

      // Cache the new session
      this.sessionCache.set(data.session.access_token, {
        user: data.user,
        expiresAt: Date.now() + 5 * 60 * 1000
      });

      res.json({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        user: data.user
      });
    } catch (error) {
      logger.error('Refresh token error:', error);
      res.status(500).json({
        error: 'Token refresh failed',
        code: 'REFRESH_ERROR'
      });
    }
  };

  /**
   * Logout endpoint handler
   */
  logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const token = this.extractToken(req);

      if (token) {
        // Remove from cache
        this.sessionCache.delete(token);

        // Sign out from Supabase
        await this.supabase.auth.signOut();
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Logout error:', error);
      res.status(500).json({
        error: 'Logout failed',
        code: 'LOGOUT_ERROR'
      });
    }
  };
}

// Export singleton instance
export const authMiddleware = new AuthMiddleware();