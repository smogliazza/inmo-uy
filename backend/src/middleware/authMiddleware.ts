import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/db';
import { OrgPolicies, normalizeOrgPolicies } from '../lib/policies';

const JWT_SECRET = process.env.JWT_SECRET as string;

if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined in environment variables.');
    // In a real production app, we might throw or exit. For safety in development if they didn't set it yet, 
    // we should forcefully exit the process to ensure they set it.
    process.exit(1);
}

export const AUTH_COOKIE_NAME = 'crm_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Sets an httpOnly cookie containing the JWT.
 * In production (Render + Vercel cross-origin over HTTPS), SameSite=None; Secure is used
 * so credentialed fetch requests can send the cookie. In development over HTTP, SameSite=Lax is used.
 */
export function setAuthCookie(res: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: SESSION_MAX_AGE_MS,
        path: '/',
    });
}

export function clearAuthCookie(res: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
    });
}

function parseCookieHeader(cookieHeader?: string): Record<string, string> {
    if (!cookieHeader) return {};
    const out: Record<string, string> = {};
    for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) {
            try {
                out[key] = decodeURIComponent(val);
            } catch {
                out[key] = val;
            }
        }
    }
    return out;
}


// Extend Express Request interface to include user
export interface AuthRequest extends Request {
    user?: {
        userId: string;
        role: string;
        tier: string;
        orgId: string;
        // The brokerage's Settings policies (cached for 30 s with the rest of the account)
        policies: OrgPolicies;
    }
}

// Short cache so every request doesn't hit the database
const ACCOUNT_CACHE_MS = 30 * 1000;
interface CachedAccount {
    role: string; tier: string; orgId: string;
    passwordChangedAtSec: number | null;
    sessionTimeoutMinutes: number;
    logoutOnPasswordChange: boolean;
    policies: OrgPolicies;
}
const accountCache = new Map<string, { at: number; user: CachedAccount | null }>();

// Drop a cached account so a security-relevant change (e.g. a password reset) applies immediately.
export function invalidateAccount(userId: string) {
    accountCache.delete(userId);
}

// Policy changes apply to everyone at once, so drop every cached account.
export function clearAccountCache() {
    accountCache.clear();
}

async function currentAccount(userId: string) {
    const hit = accountCache.get(userId);
    if (hit && Date.now() - hit.at < ACCOUNT_CACHE_MS) return hit.user;
    const u = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            role: true, tier: true, orgId: true, isActive: true, passwordChangedAt: true,
            organization: { select: { sessionTimeoutMinutes: true, logoutOnPasswordChange: true, policies: true } },
        },
    });
    const user: CachedAccount | null = u && u.isActive ? {
        role: u.role, tier: u.tier, orgId: u.orgId,
        passwordChangedAtSec: u.passwordChangedAt ? Math.floor(u.passwordChangedAt.getTime() / 1000) : null,
        sessionTimeoutMinutes: u.organization.sessionTimeoutMinutes,
        logoutOnPasswordChange: u.organization.logoutOnPasswordChange,
        policies: normalizeOrgPolicies(u.organization.policies),
    } : null;
    accountCache.set(userId, { at: Date.now(), user });
    if (accountCache.size > 5000) accountCache.clear();
    return user;
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.split(' ')[1];
    const cookies = parseCookieHeader(req.headers.cookie);
    const cookieToken = cookies[AUTH_COOKIE_NAME];
    const token = bearerToken || cookieToken;
    const usingCookieOnly = !bearerToken && !!cookieToken;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // CSRF protection for cookie-authenticated state-changing requests:
    // Standard HTML forms cannot set custom headers like X-CSRF-Protection: 1,
    // and cross-origin scripts cannot set custom headers unless allowed by CORS.
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (usingCookieOnly && !safeMethods.includes(req.method.toUpperCase())) {
        const csrfHeader = req.headers['x-csrf-protection'] || req.headers['x-requested-with'];
        if (!csrfHeader) {
            return res.status(403).json({ error: 'CSRF validation failed: missing X-CSRF-Protection header' });
        }
    }

    let decoded: AuthRequest['user'];
    try {
        decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthRequest['user'];
    } catch (error) {
        // 401, not 403: the caller is not authenticated. 403 is reserved for
        // "authenticated but not permitted" (role / plan gating), so clients
        // can tell "log in again" apart from "you lack access".
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (!decoded?.userId) return res.status(401).json({ error: 'Invalid or expired token' });

    // A valid signature isn't enough: deleted or deactivated accounts lose access
    // immediately, and role/plan changes apply without waiting for a new token.
    try {
        const account = await currentAccount(decoded.userId);
        if (!account) return res.status(401).json({ error: 'This account is no longer active' });

        // Organization security policy: sessions end after the configured time, and a password
        // change signs out every session that started before it.
        const issuedAt = (decoded as any).iat as number | undefined;
        if (issuedAt) {
            const ageMinutes = (Date.now() / 1000 - issuedAt) / 60;
            if (ageMinutes > account.sessionTimeoutMinutes) {
                return res.status(401).json({ error: 'Your session has expired. Please sign in again.', code: 'SESSION_EXPIRED' });
            }
            if (account.logoutOnPasswordChange && account.passwordChangedAtSec !== null && issuedAt < account.passwordChangedAtSec) {
                return res.status(401).json({ error: 'Your password was changed. Please sign in again.', code: 'PASSWORD_CHANGED' });
            }
        }
        req.user = { userId: decoded.userId, role: account.role, tier: account.tier, orgId: account.orgId, policies: account.policies };
        next();
    } catch (err) {
        next(err);
    }
};

export const authorizeRole = (roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    }
};

const tierWeights: Record<string, number> = {
    'CORE': 1,
    'PRO': 2,
    'ELITE': 3
};

export const requireTier = (minTier: string) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Platform admins bypass subscription gating
        if (req.user.role === 'SUPERADMIN') {
            return next();
        }

        const userTierWeight = tierWeights[req.user.tier] || 0;
        const requiredTierWeight = tierWeights[minTier] || 0;

        if (userTierWeight < requiredTierWeight) {
            return res.status(403).json({ 
                error: `This feature requires a ${minTier} subscription.`,
                requiredTier: minTier
            });
        }

        next();
    }
};
