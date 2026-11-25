import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { id: string; role: string; name: string; email: string };
}

export function verifyAuthToken(token?: string): AuthRequest['user'] | null {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev_only_change_me') as AuthRequest['user'];
  } catch {
    return null;
  }
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const decoded = verifyAuthToken(token);
  if (decoded) req.user = decoded;
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  const decoded = verifyAuthToken(token);
  if (!decoded) return res.status(401).json({ message: 'Invalid or expired token' });
  req.user = decoded;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    next();
  };
}