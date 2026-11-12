import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { createPrismaClient } from '../lib/prisma';
import { orgSlug } from '../lib/slug';
import { OAuth2Client } from 'google-auth-library';
import { setAuthCookie } from '../middleware/authMiddleware';
import { installationModuleEnabled, isModuleEnabled, sendModuleDisabled } from '../lib/modules';

const router = express.Router();
const prisma = createPrismaClient();

// OAuth endpoints are authentication endpoints and must be throttled like the
// password routes in auth.ts — without this they are an unmetered path for
// token-guessing and account-probing.
const oauthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'Too many sign-in attempts from this IP, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
router.use(oauthLimiter);

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined in environment variables.');
    process.exit(1);
}

// Helper to generate token
const generateToken = (user: any) => {
    return jwt.sign(
        { userId: user.id, role: user.role, tier: user.tier, orgId: user.orgId },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// POST /api/oauth/google
router.post('/google', async (req, res) => {
    try {
        // No brokerage is known yet: the installation-level setting decides first.
        if (!installationModuleEnabled('googleOAuth')) return sendModuleDisabled(res, 'googleOAuth');
        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ error: 'Google ID token is required' });
        }

        // Verify the ID token with Google
        let email: string;
        let name: string;
        let googleId: string;
        if (process.env.GOOGLE_CLIENT_ID) {
            const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
            const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
            const payload = ticket.getPayload();
            if (!payload || !payload.email) return res.status(401).json({ error: 'Invalid Google token' });
            email = payload.email;
            name = payload.name || payload.email.split('@')[0];
            googleId = payload.sub;
        } else if (process.env.NODE_ENV === 'production') {
            // Never accept unverified identities in production
            return res.status(503).json({ error: 'Google sign-in is not available yet.' });
        } else {
            // Dev mode: accept mock token structure (not for production)
            console.warn('[OAuth] GOOGLE_CLIENT_ID not set — skipping token verification (dev mode)');
            const mock = req.body;
            if (!mock.email || !mock.googleId) return res.status(400).json({ error: 'Dev mode: email and googleId required' });
            email = mock.email;
            name = mock.name || mock.email.split('@')[0];
            googleId = mock.googleId;
        }

        let user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            // First sign-in creates the person's own brokerage (like email signup).
            // Joining an existing brokerage only happens through an invitation.
            const org = await prisma.organization.create({
                data: { name: `${name || email.split('@')[0]}'s Brokerage`, slug: orgSlug(name || email.split('@')[0]) },
            });

            user = await prisma.user.create({
                data: {
                    name: name || email.split('@')[0],
                    email,
                    googleId,
                    role: 'FIRMADMIN',
                    tier: 'CORE',
                    emailVerified: true,
                    orgId: org.id
                }
            });
        } else if (user.googleId && user.googleId === googleId) {
            // Existing account with matching googleId — allow login, unless its brokerage turned Google sign-in off
            if (!(await isModuleEnabled(user.orgId, 'googleOAuth'))) return sendModuleDisabled(res, 'googleOAuth');
        } else {
            // Account exists but googleId doesn't match or isn't linked.
            // Reject to prevent account takeover. Linking must be done
            // through authenticated account settings after password login.
            return res.status(409).json({ error: 'An account with this email already exists. Please log in with your password and link Google from account settings.' });
        }

        if (!user.isActive) {
            return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
        }

        const token = generateToken(user);
        setAuthCookie(res, token);
        res.json({ message: 'Google login successful', token, user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId } });
    } catch (error) {
        console.error('Google OAuth error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/oauth/apple
// TODO (roadmap): verify req.body.identityToken with Apple's public keys before re-enabling.
router.post('/apple', async (_req, res) => {
    // Disabled until Apple identity tokens are verified server-side
    // (the previous version trusted the email in the request body).
    res.status(503).json({ error: 'Apple sign-in is not available yet.' });
});

export default router;
