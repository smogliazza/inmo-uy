import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createPrismaClient } from '../lib/prisma';
import rateLimit from 'express-rate-limit';
import { sendEmail, passwordResetEmail, welcomeEmail } from '../lib/email';
import { messages, toLang } from '../lib/messages';
import { authenticateToken, AuthRequest, setAuthCookie, clearAuthCookie, invalidateAccount } from '../middleware/authMiddleware';
import { passwordPolicyError, orgPasswordPolicy } from '../lib/passwordPolicy';
import { getSeatUsage } from '../lib/seats';
import { orgSlug } from '../lib/slug';

// Org subscription level → member tier (subscription is org-wide)
const ORG_SUB_TO_TIER: Record<string, 'CORE' | 'PRO' | 'ELITE'> = {
    BASIC:      'CORE',
    PRO:        'PRO',
    ENTERPRISE: 'ELITE',
};

// Email verification is only enforceable when a real email service can deliver
// the verification link — otherwise new users could never verify and would be locked out
const emailServiceConfigured = () => !!(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 failed requests per 15 minutes
    skipSuccessfulRequests: true, // a whole office on one IP shouldn't lock itself out by logging in
    message: { error: 'Too many authentication attempts from this IP, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});

const router = express.Router();
const prisma = createPrismaClient();

const JWT_SECRET = process.env.JWT_SECRET as string;

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined in environment variables.');
    process.exit(1);
}

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.password) {
            return res.status(401).json({ error: 'Please login using your linked social account' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.isActive) {
            return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
        }

        // Password expiry policy. Only enforced when email can be sent: without a working
        // reset flow an expired password would lock the account out for good.
        const policyOrg = await prisma.organization.findUnique({ where: { id: user.orgId }, select: { passwordExpiryDays: true } });
        if (policyOrg && policyOrg.passwordExpiryDays > 0 && emailServiceConfigured()) {
            const since = user.passwordChangedAt ?? user.createdAt;
            const ageDays = (Date.now() - since.getTime()) / 86400000;
            if (ageDays > policyOrg.passwordExpiryDays) {
                return res.status(403).json({
                    error: 'Your password has expired. Use "Forgot password" to choose a new one.',
                    code: 'PASSWORD_EXPIRED',
                });
            }
        }

        if (!user.emailVerified && emailServiceConfigured()) {
            return res.status(403).json({
                error: 'Please verify your email address before logging in. Check your inbox, or request a new link.',
                code: 'EMAIL_NOT_VERIFIED',
            });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, role: user.role, tier: user.tier, orgId: user.orgId },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        setAuthCookie(res, token);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                tier: user.tier,
                orgId: user.orgId
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { name, email, password, orgName } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        if (!orgName || !orgName.trim()) {
            return res.status(400).json({ error: 'Organization / firm name is required' });
        }
        if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already in use' });
        }

        // /register always CREATES a new organization — the registrant becomes its FIRMADMIN.
        // Joining an EXISTING org is done exclusively through the invite-token flow
        // (/accept-invite), which verifies a server-issued token rather than a
        // user-typed name. Organization names are not unique identifiers — two real
        // brokerages can legitimately share a name (e.g. "Sunrise Realty" in different
        // cities) — so name-matching was never a valid way to detect "does this org exist".
        const org = await prisma.organization.create({
            data: { name: orgName.trim(), slug: orgSlug(orgName.trim()) }
        });
        const newRole = 'FIRMADMIN'; // Creator of a new org becomes its admin

        const hashedPassword = await bcrypt.hash(password, 10);
        const verifyToken = crypto.randomBytes(32).toString('hex');

        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: newRole as any,
                tier: 'CORE',
                orgId: org.id,
                // No email service → nothing to click, auto-verify so login isn't blocked
                emailVerified: !emailServiceConfigured(),
            }
        });

        // Send verification email (non-blocking — fails gracefully if SMTP not configured)
        try {
            await (prisma as any).$executeRaw`UPDATE "User" SET "emailVerifyToken" = ${verifyToken} WHERE id = ${newUser.id}`;
            const appUrl = process.env.APP_URL || 'http://localhost:3000';
            const verifyUrl = `${appUrl}/verify-email?token=${verifyToken}`;
            const lang = toLang(newUser.preferredLanguage);
            sendEmail({ to: newUser.email, subject: messages(lang).verifySubject, html: welcomeEmail(verifyUrl, newUser.name, lang, org.name) }).catch(console.error);
        } catch (emailErr) {
            console.error('Verification email / token setup failed (non-blocking):', emailErr);
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: newUser.id, role: newUser.role, tier: newUser.tier, orgId: newUser.orgId },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        setAuthCookie(res, token);

        res.status(201).json({
            message: 'Registration successful',
            token,
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                tier: newUser.tier,
                orgId: newUser.orgId
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await prisma.user.findUnique({ where: { email } });

        // Always respond 200 to prevent email enumeration
        if (!user) return res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Only a hash is stored: a leaked database must not yield usable reset links
        await prisma.user.update({
            where: { email },
            data: { passwordResetToken: hashToken(token), passwordResetExpiry: expiresAt }
        });

        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const resetUrl = `${appUrl}/reset-password?token=${token}`;

        await sendEmail({
            to: email,
            subject: messages(toLang(user.preferredLanguage)).resetSubject,
            html: passwordResetEmail(resetUrl, user.name, toLang(user.preferredLanguage)),
            text: `${messages(toLang(user.preferredLanguage)).resetSubject}: ${resetUrl}`
        });

        res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
        if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const user = await prisma.user.findFirst({
            where: {
                passwordResetToken: hashToken(String(token)),
                passwordResetExpiry: { gt: new Date() }
            }
        });

        if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

        const policyError = passwordPolicyError(password, await orgPasswordPolicy(user.orgId));
        if (policyError) return res.status(400).json({ error: policyError });

        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword, passwordResetToken: null, passwordResetExpiry: null, passwordChangedAt: new Date() }
        });
        invalidateAccount(user.id);

        res.json({ message: 'Password reset successfully. You can now log in.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/accept-invite
// Allows an invited user to create their account and join an existing org.
// SECURITY: org membership and role come from the server-side Invitation record,
// looked up by the single-use token — never from the request body.
router.post('/accept-invite', authLimiter, async (req, res) => {
    try {
        const { name, email, password, inviteToken } = req.body;

        if (!name || !email || !password || !inviteToken) {
            return res.status(400).json({ error: 'Name, email, password, and invite token are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Look up the invitation by its token
        const invitation = await prisma.invitation.findUnique({ where: { token: inviteToken } });
        if (!invitation) {
            return res.status(403).json({ error: 'Invalid invite link. Please ask your admin to send a new invitation.' });
        }
        if (invitation.acceptedAt) {
            return res.status(403).json({ error: 'This invitation has already been used.' });
        }
        if (invitation.expiresAt < new Date()) {
            return res.status(403).json({ error: 'This invitation has expired. Please ask your admin to send a new one.' });
        }
        if (invitation.email !== email.trim().toLowerCase()) {
            return res.status(403).json({ error: 'This invitation was sent to a different email address.' });
        }
        const invitePolicyError = passwordPolicyError(password, await orgPasswordPolicy(invitation.orgId));
        if (invitePolicyError) return res.status(400).json({ error: invitePolicyError });

        // Check email not already taken
        const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
        if (existingUser) {
            return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
        }

        // Seat re-check at accept time (invite reserved the seat, so count active users only —
        // guards against the plan having been downgraded since the invite was sent)
        const seats = await getSeatUsage(invitation.orgId);
        if (seats.limit !== null && seats.users >= seats.limit) {
            return res.status(403).json({ error: 'This team has reached its plan seat limit. Ask your admin to upgrade the plan.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                name,
                email: invitation.email,
                password: hashedPassword,
                role: invitation.role as any,
                tier: ORG_SUB_TO_TIER[seats.subscription] || 'CORE', // members inherit the org-wide plan
                orgId: invitation.orgId,
                emailVerified: true, // arriving via emailed link proves mailbox ownership
            },
        });

        // Mark invitation as consumed (single-use)
        await prisma.invitation.update({
            where: { id: invitation.id },
            data:  { acceptedAt: new Date() },
        });

        // Generate JWT
        const token = jwt.sign(
            { userId: newUser.id, role: newUser.role, tier: newUser.tier, orgId: newUser.orgId },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        setAuthCookie(res, token);

        res.status(201).json({
            message: 'Account created successfully. Welcome to the team!',
            token,
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                tier: newUser.tier,
                orgId: newUser.orgId,
            },
        });
    } catch (error) {
        console.error('Accept invite error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', authLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        // Always respond 200 to prevent email enumeration
        const okMsg = { message: 'If that email exists and is unverified, a new link has been sent.' };
        const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
        if (!user || user.emailVerified) return res.status(200).json(okMsg);

        const verifyToken = crypto.randomBytes(32).toString('hex');
        await prisma.user.update({ where: { id: user.id }, data: { emailVerifyToken: verifyToken } });

        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        await sendEmail({
            to: user.email,
            subject: messages(toLang(user.preferredLanguage)).verifySubject,
            html: welcomeEmail(`${appUrl}/verify-email?token=${verifyToken}`, user.name, toLang(user.preferredLanguage)),
        });

        res.status(200).json(okMsg);
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/refresh
// Re-issues a JWT with the user's CURRENT role/tier from the database.
// Needed after a subscription upgrade — the old token still carries the stale tier.
router.post('/refresh', authenticateToken, async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.isActive) return res.status(403).json({ error: 'This account has been deactivated.' });

        const token = jwt.sign(
            { userId: user.id, role: user.role, tier: user.tier, orgId: user.orgId },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        setAuthCookie(res, token);

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                tier: user.tier,
                orgId: user.orgId,
            },
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Token is required' });

        const user = await prisma.user.findFirst({
            where: { emailVerifyToken: token }
        });

        if (!user) return res.status(400).json({ error: 'Invalid verification token' });

        await prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: true, emailVerifyToken: null }
        });

        res.json({ message: 'Email verified successfully. You can now log in.' });
    } catch (error) {
        console.error('Verify email error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ message: 'Logged out successfully' });
});

export default router;
