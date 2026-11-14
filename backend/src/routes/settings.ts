import { Router } from 'express';
import { prisma } from '../server';
import { AuthRequest, authorizeRole, authenticateToken, clearAccountCache } from '../middleware/authMiddleware';
import crypto from 'crypto';
import { sendEmail } from '../lib/email';
import { getSeatUsage } from '../lib/seats';
import { audit, diffFields } from '../lib/audit';
import { resolveLeadAssignee } from '../lib/routing';
import { normalizeNotificationPrefs } from './notifications';
import { normalizeOrgPolicies, applyOrgPoliciesPatch, normalizePreferences, applyPreferencesPatch } from '../lib/policies';
import { normalizePhoneUY } from '../lib/uy';
import { orgLocale, clearOrgLocaleCache } from '../lib/messages';
import { CURRENCIES, DEPARTMENTS_UY, ALL_PROPERTY_TYPES, PROPERTY_TYPES_UY, AMENITIES_UY } from '../lib/catalogs';
import { MODULE_KEYS, ModuleKey, ModuleMap, isModuleKey, readModuleOverrides, resolveModules, requireModule, clearModuleCache } from '../lib/modules';

const router = Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['SUPERADMIN', 'FIRMADMIN'];

// Trims a value and caps its length; empty strings become null so cleared fields are cleared
const clean = (v: unknown, max = 500): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const s = String(v).trim().slice(0, max);
    return s === '' ? null : s;
};

// ─── Own profile ─────────────────────────────────────────────────────────────

const PROFILE_SELECT = {
    id: true, name: true, email: true, role: true, tier: true,
    title: true, phone: true, licenseNumber: true, linkedIn: true,
    bio: true, timezone: true, avatarUrl: true,
    acceptingLeads: true, maxActiveLeads: true, notificationPrefs: true,
} as const;

// GET /api/settings/team — colleague directory (any member): names and roles only,
// used for referrals, co-agents and assignment pickers
router.get('/team', async (req: AuthRequest, res) => {
    const team = await prisma.user.findMany({
        where: { orgId: req.user!.orgId, isActive: true },
        select: { id: true, name: true, role: true, title: true },
        orderBy: { name: 'asc' },
    });
    res.json(team);
});

// GET /api/settings/profile — the caller's own profile
router.get('/profile', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const me = await prisma.user.findUnique({ where: { id: req.user.userId }, select: PROFILE_SELECT });
        if (!me) return res.status(404).json({ error: 'User not found' });
        res.json(me);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

// PATCH /api/settings/profile — update the caller's own profile.
// Only personal fields are writable here; role/tier/email/orgId are not.
router.patch('/profile', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const { name, title, phone, licenseNumber, linkedIn, bio, timezone, acceptingLeads, maxActiveLeads } = req.body;

        if (name !== undefined && !String(name).trim()) {
            return res.status(400).json({ error: 'Name cannot be empty' });
        }

        const updated = await prisma.user.update({
            where: { id: req.user.userId },
            data: {
                ...(name !== undefined ? { name: String(name).trim().slice(0, 120) } : {}),
                title:         clean(title, 120),
                ...(phone !== undefined ? { phone: normalizePhoneUY(clean(phone, 40)) } : {}), // absent = unchanged
                licenseNumber: clean(licenseNumber, 60),
                linkedIn:      clean(linkedIn, 300),
                bio:           clean(bio, 2000),
                ...(timezone ? { timezone: String(timezone).slice(0, 60) } : {}),
                ...(typeof acceptingLeads === 'boolean' ? { acceptingLeads } : {}),
                ...(maxActiveLeads !== undefined ? { maxActiveLeads: maxActiveLeads === null || maxActiveLeads === '' ? null : Math.max(0, Math.round(Number(maxActiveLeads))) } : {}),
            },
            select: PROFILE_SELECT,
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ─── Organization ────────────────────────────────────────────────────────────

// GET /api/settings/organization — org details, plan and seat usage (any member)
router.get('/organization', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const org = await prisma.organization.findUnique({
            where:  { id: req.user.orgId },
            select: { id: true, name: true, website: true, address: true, phone: true, licenseNumber: true, logoUrl: true, brandColor: true, subscription: true, defaultCommissionRate: true, defaultFirmSplit: true, slug: true, country: true, timezone: true, defaultCurrency: true, preferredLanguage: true, customDomain: true, whatsapp: true },
        });
        if (!org) return res.status(404).json({ error: 'Organization not found' });
        const seats = await getSeatUsage(req.user.orgId);
        res.json({ ...org, seats: { limit: seats.limit, used: seats.users, pendingInvites: seats.pendingInvites } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load organization' });
    }
});

// PATCH /api/settings/organization — update firm details (org admins only)
router.patch('/organization', authorizeRole(ADMIN_ROLES), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const { name, website, address, phone, licenseNumber, logoUrl, slug, brandColor } = req.body;

        // Commission defaults (percent). Applied when a deal closes without its own rate.
        const pct: Record<string, number> = {};
        for (const f of ['defaultCommissionRate', 'defaultFirmSplit']) {
            if (req.body[f] === undefined || req.body[f] === '') continue;
            const n = Number(req.body[f]);
            if (!Number.isFinite(n) || n < 0 || n > 100) {
                return res.status(400).json({ error: `${f} must be a percentage between 0 and 100` });
            }
            pct[f] = n;
        }

        if (name !== undefined && !String(name).trim()) {
            return res.status(400).json({ error: 'Company name cannot be empty' });
        }
        // Localization: time zone (IANA), default currency, language
        const loc: Record<string, string> = {};
        if (req.body.timezone !== undefined) {
            const tz = String(req.body.timezone).trim();
            try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { return res.status(400).json({ error: 'Unknown time zone' }); }
            loc.timezone = tz;
        }
        if (req.body.defaultCurrency !== undefined) {
            if (!(CURRENCIES as readonly string[]).includes(req.body.defaultCurrency)) return res.status(400).json({ error: `defaultCurrency must be one of: ${CURRENCIES.join(', ')}` });
            loc.defaultCurrency = req.body.defaultCurrency;
        }
        // The brokerage's own domain (spec 3.2): HTTPS is issued for it once its DNS points to the server
        if (req.body.customDomain !== undefined) {
            const raw = req.body.customDomain === null ? '' : String(req.body.customDomain).trim().toLowerCase()
                .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/\.$/, '');
            if (raw === '') {
                loc.customDomain = null as any;
            } else {
                if (!/^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(raw)) return res.status(400).json({ error: 'Invalid domain (e.g. castroymeirelles.com.uy)' });
                const base = (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase();
                if (base && (raw === base || raw.endsWith(`.${base}`))) return res.status(400).json({ error: 'That domain belongs to the platform; use your own domain' });
                const taken = await prisma.organization.findFirst({ where: { customDomain: raw, NOT: { id: req.user.orgId } }, select: { id: true } });
                if (taken) return res.status(409).json({ error: 'Another brokerage already uses this domain' });
                loc.customDomain = raw;
            }
        }
        if (req.body.preferredLanguage !== undefined) {
            if (!['es', 'en', 'zh-CN', 'zh-TW'].includes(req.body.preferredLanguage)) return res.status(400).json({ error: 'Unsupported language' });
            loc.preferredLanguage = req.body.preferredLanguage;
        }
        for (const [field, val] of [['website', website], ['logoUrl', logoUrl]] as const) {
            if (val && !/^https?:\/\//i.test(String(val).trim())) {
                return res.status(400).json({ error: `${field} must start with http:// or https://` });
            }
        }
        if (brandColor !== undefined && brandColor !== null && brandColor !== '') {
            if (!/^#[0-9a-fA-F]{6}$/.test(String(brandColor).trim())) {
                return res.status(400).json({ error: 'brandColor must be a 6-digit hex color (e.g. #B8977E)' });
            }
        }

        const before = await prisma.organization.findUnique({
            where:  { id: req.user.orgId },
            select: { name: true, website: true, address: true, phone: true, licenseNumber: true, logoUrl: true, slug: true, brandColor: true },
        });

        let nextSlug: string | undefined;
        if (slug !== undefined && slug !== null && String(slug).trim() !== '') {
            const candidate = String(slug).trim().toLowerCase();
            if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(candidate)) {
                return res.status(400).json({ error: 'Public page slug must be 3–48 lowercase letters, numbers, or hyphens' });
            }
            if (candidate !== before?.slug) {
                const takenOrg = await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
                if (takenOrg && takenOrg.id !== req.user.orgId) {
                    return res.status(409).json({ error: 'This public page address is already taken' });
                }
                const takenHistory = await prisma.orgSlugHistory.findUnique({ where: { oldSlug: candidate } });
                if (takenHistory && takenHistory.orgId !== req.user.orgId) {
                    return res.status(409).json({ error: 'This public page address is already reserved' });
                }
                // If the org is reverting to one of its own previous slugs, remove it from history
                if (takenHistory && takenHistory.orgId === req.user.orgId) {
                    await prisma.orgSlugHistory.delete({ where: { id: takenHistory.id } });
                }
                if (before?.slug) {
                    await prisma.orgSlugHistory.upsert({
                        where: { oldSlug: before.slug },
                        update: { orgId: req.user.orgId },
                        create: { oldSlug: before.slug, orgId: req.user.orgId },
                    });
                }
                nextSlug = candidate;
            }
        }

        const updated = await prisma.organization.update({
            where: { id: req.user.orgId },
            data: {
                ...(name !== undefined ? { name: String(name).trim().slice(0, 200) } : {}),
                website:       clean(website, 300),
                address:       clean(address, 300),
                ...(phone !== undefined ? { phone: normalizePhoneUY(clean(phone, 40)) } : {}), // absent = unchanged
                licenseNumber: clean(licenseNumber, 60),
                logoUrl:       clean(logoUrl, 500),
                ...(req.body.whatsapp !== undefined ? { whatsapp: normalizePhoneUY(clean(req.body.whatsapp, 40)) } : {}),
                ...(brandColor !== undefined ? { brandColor: clean(brandColor, 20) } : {}),
                ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
                ...pct,
                ...(loc as any),
            },
            select: {
                id: true, name: true, website: true, address: true, phone: true, licenseNumber: true, logoUrl: true,
                slug: true, brandColor: true, subscription: true, defaultCommissionRate: true, defaultFirmSplit: true,
                country: true, timezone: true, defaultCurrency: true, preferredLanguage: true, customDomain: true, whatsapp: true,
            },
        });
        if (Object.keys(loc).length) clearOrgLocaleCache(req.user.orgId);
        await audit(req, 'UPDATE_ORGANIZATION', 'Organization', updated.id, before, {
            name: updated.name, website: updated.website, address: updated.address,
            phone: updated.phone, licenseNumber: updated.licenseNumber, logoUrl: updated.logoUrl,
            defaultCommissionRate: updated.defaultCommissionRate, defaultFirmSplit: updated.defaultFirmSplit,
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update organization' });
    }
});

// GET /api/settings/organization/export — full data export of the caller's org (GDPR-style portability)
// Secrets (password hashes, reset/verify tokens, invite tokens) are never included.
router.get('/organization/export', authorizeRole(ADMIN_ROLES), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const orgId = req.user.orgId;
        const where = { orgId };

        const [organization, users, clients, properties, transactions, commissions, offers,
               appointments, tasks, notes, documents, mediaAssets, referrals, giftOrders, marketingTasks] = await Promise.all([
            prisma.organization.findUnique({ where: { id: orgId } }),
            prisma.user.findMany({ where, select: {
                id: true, name: true, email: true, role: true, tier: true, title: true, phone: true,
                licenseNumber: true, linkedIn: true, bio: true, timezone: true, isActive: true,
                emailVerified: true, lastLoginAt: true, createdAt: true,
            } }),
            prisma.client.findMany({ where }),
            prisma.property.findMany({ where }),
            prisma.transaction.findMany({ where }),
            prisma.commission.findMany({ where }),
            prisma.offer.findMany({ where }),
            prisma.appointment.findMany({ where }),
            prisma.task.findMany({ where }),
            prisma.note.findMany({ where }),
            prisma.document.findMany({ where }),
            prisma.mediaAsset.findMany({ where }),
            prisma.referral.findMany({ where }),
            prisma.giftOrder.findMany({ where }),
            prisma.marketingTask.findMany({ where }),
        ]);

        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Disposition', `attachment; filename="org-export-${stamp}.json"`);
        res.json({
            exportedAt: new Date().toISOString(),
            exportedBy: req.user.userId,
            organization, users, clients, properties, transactions, commissions, offers,
            appointments, tasks, notes, documents, mediaAssets, referrals, giftOrders, marketingTasks,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to export organization data' });
    }
});

// GET /api/settings/organization/audit-log — audit trail for the caller's org
router.get('/organization/audit-log', authorizeRole(ADMIN_ROLES), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const logs = await prisma.auditLog.findMany({
            where:   { orgId: req.user.orgId },
            include: { user: { select: { name: true, email: true } } },
            orderBy: { createdAt: 'desc' },
            take:    5000,
        });
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.json"`);
        res.json({ exportedAt: new Date().toISOString(), count: logs.length, logs });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to export audit log' });
    }
});

// GET /api/settings/users — list all org users
router.get('/users', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const users = await prisma.user.findMany({
            where: { orgId: req.user.orgId },
            select: {
                id: true, name: true, email: true, role: true, tier: true,
                phone: true, title: true, licenseNumber: true, avatarUrl: true,
                emailVerified: true, isActive: true, acceptingLeads: true, maxActiveLeads: true,
                lastLoginAt: true, createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

const VALID_ROLES = ['SUPERADMIN', 'FIRMADMIN', 'MANAGER', 'AGENT', 'ATTORNEY', 'LENDER', 'TITLECO', 'MARKETING', 'OFFICE_SUPPORT'];
const ROLE_RANK: Record<string, number> = { SUPERADMIN: 3, FIRMADMIN: 2, MANAGER: 1 };

// Shared role-change logic for the PATCH and legacy PUT endpoints.
// Tier is deliberately NOT accepted: it is derived from the org's paid subscription,
// so letting admins set it per-user would bypass billing.
async function changeRole(req: AuthRequest, res: any) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { role } = req.body;

    if (!role || !VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: 'A valid role is required' });
    }
    // SUPERADMIN is a platform-level role — only an existing SUPERADMIN may grant it
    if (role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Only a platform administrator can assign SUPERADMIN' });
    }
    // Managers cannot elevate anyone to FIRMADMIN
    if (req.user.role === 'MANAGER' && role === 'FIRMADMIN') {
        return res.status(403).json({ error: 'Insufficient permissions to assign this role' });
    }

    const target = await prisma.user.findFirst({
        where: { id: String(req.params.id), orgId: req.user.orgId },
    });
    if (!target) return res.status(404).json({ error: 'User not found in your organization' });

    // Nobody may change the role of someone ranked at or above themselves
    // (prevents a manager demoting their firm admin, or a firm admin touching a superadmin)
    if (target.id !== req.user.userId && (ROLE_RANK[target.role] || 0) >= (ROLE_RANK[req.user.role] || 0)) {
        return res.status(403).json({ error: 'You cannot change the role of a user at or above your own level' });
    }

    const updated = await prisma.user.update({
        where:  { id: target.id },
        data:   { role },
        select: { id: true, name: true, role: true, tier: true },
    });
    await audit(req, 'UPDATE_ROLE', 'User', target.id, { role: target.role }, { role: updated.role });
    res.json(updated);
}

// PATCH /api/settings/users/:id — change a member's role (settings page calls PATCH)
router.patch('/users/:id', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
    try {
        await changeRole(req, res);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// PUT /api/settings/users/:id/role — legacy endpoint kept for compatibility
router.put('/users/:id/role', authorizeRole(['SUPERADMIN', 'FIRMADMIN']), async (req: AuthRequest, res) => {
    try {
        await changeRole(req, res);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update user role' });
    }
});

// DELETE /api/settings/users/:id — deactivate (soft delete: set role to OFFICE_SUPPORT with no access)
router.delete('/users/:id', authorizeRole(['SUPERADMIN', 'FIRMADMIN']), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        // Prevent self-deletion
        if (String(req.params.id) === req.user.userId) {
            return res.status(400).json({ error: 'Cannot deactivate your own account' });
        }

        const target = await prisma.user.findFirst({
            where: { id: String(req.params.id), orgId: req.user.orgId },
        });
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.role === 'SUPERADMIN') return res.status(403).json({ error: 'Cannot deactivate superadmin' });

        // Real deactivation — login and token refresh are refused while inactive
        await prisma.user.update({
            where: { id: String(req.params.id) },
            data:  { isActive: false },
        });
        await audit(req, 'DEACTIVATE_USER', 'User', target.id, { isActive: true }, { isActive: false });

        res.json({ message: 'User deactivated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to deactivate user' });
    }
});

// PATCH /api/settings/users/:id/reactivate — restore a deactivated account
router.patch('/users/:id/reactivate', authorizeRole(['SUPERADMIN', 'FIRMADMIN']), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const target = await prisma.user.findFirst({
            where: { id: String(req.params.id), orgId: req.user.orgId },
        });
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.isActive) return res.status(400).json({ error: 'User is already active' });

        // Reactivation takes a seat back — respect the plan limit
        const seats = await getSeatUsage(req.user.orgId);
        if (seats.limit !== null && seats.users + seats.pendingInvites >= seats.limit) {
            return res.status(403).json({
                error: `Your ${seats.subscription} plan allows up to ${seats.limit} team members. Upgrade your plan to reactivate this account.`,
                code: 'SEAT_LIMIT_REACHED',
            });
        }

        const updated = await prisma.user.update({
            where:  { id: target.id },
            data:   { isActive: true },
            select: { id: true, name: true, isActive: true },
        });
        await audit(req, 'REACTIVATE_USER', 'User', target.id, { isActive: false }, { isActive: true });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reactivate user' });
    }
});

// POST /api/settings/invite — invite a team member by email
router.post('/invite', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const { email, role } = req.body;
        if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });

        // Prevent managers from inviting FIRMADMIN/SUPERADMIN
        if (req.user.role === 'MANAGER' && (role === 'FIRMADMIN' || role === 'SUPERADMIN')) {
            return res.status(403).json({ error: 'Insufficient permissions to invite this role' });
        }

        // Check if already a member
        const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
        if (existing) {
            if (existing.orgId === req.user.orgId) {
                return res.status(409).json({ error: 'This email is already a member of your organization' });
            }
            return res.status(409).json({ error: 'This email is already registered' });
        }

        // Seat limit — pending invites reserve seats so admins can't over-invite
        const seats = await getSeatUsage(req.user.orgId);
        if (seats.limit !== null && seats.users + seats.pendingInvites >= seats.limit) {
            return res.status(403).json({
                error: `Your ${seats.subscription} plan allows up to ${seats.limit} team members (${seats.users} active, ${seats.pendingInvites} invited). Upgrade your plan to add more seats.`,
                code: 'SEAT_LIMIT_REACHED',
            });
        }

        // Generate invite token and persist it — accept-invite validates against this record
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const normalizedEmail = email.trim().toLowerCase();
        const safeRoles = ['AGENT', 'MANAGER', 'ATTORNEY', 'LENDER', 'TITLECO', 'MARKETING', 'OFFICE_SUPPORT'];
        const inviteRole = safeRoles.includes(role) ? role : 'AGENT';

        // Invalidate any previous pending invites for this email in this org, then create fresh one
        await prisma.invitation.deleteMany({
            where: { email: normalizedEmail, orgId: req.user.orgId, acceptedAt: null },
        });
        const invitation = await prisma.invitation.create({
            data: {
                email:       normalizedEmail,
                role:        inviteRole,
                token:       inviteToken,
                expiresAt:   new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                invitedById: req.user.userId,
                orgId:       req.user.orgId,
            },
        });
        // Token is a credential — never write it to the audit trail
        await audit(req, 'INVITE_MEMBER', 'Invitation', invitation.id, undefined, { email: normalizedEmail, role: inviteRole });

        const inviter = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { name: true, email: true } });
        const { m: im } = await orgLocale(req.user.orgId);
        const inviterName = inviter?.name || inviter?.email || im.someoneFromTeam;
        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId } });
        const appUrl = process.env.APP_URL || 'http://localhost:3000';

        // Send invite email
        try {
            await sendEmail({
                to:      email.trim().toLowerCase(),
                subject: im.inviteSubject(org?.name || im.yourTeam),
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2>${im.inviteTitle}</h2>
                        <p>${im.inviteBody(inviterName, org?.name || im.yourTeam, inviteRole)}</p>
                        <p>${im.inviteCta}</p>
                        <a href="${appUrl}/signup?invite=${inviteToken}&email=${encodeURIComponent(normalizedEmail)}&org=${req.user.orgId}&role=${inviteRole}"
                           style="display: inline-block; padding: 12px 24px; background: #B8977E; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                            ${im.inviteButton}
                        </a>
                        <p style="color: #666; font-size: 12px;">${im.inviteExpires}</p>
                    </div>
                `,
            });
        } catch (emailError) {
            console.error('Failed to send invite email:', emailError);
            // Don't fail the request — log and continue
        }

        res.json({ message: `Invitation sent to ${email}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

// ─── Security policy (enforced by the auth middleware, login and password flows) ───

const SESSION_TIMEOUT_OPTIONS = [15, 30, 60, 120, 480, 1440];
const SECURITY_SELECT = {
    sessionTimeoutMinutes: true, minPasswordLength: true, requirePasswordSpecialChar: true,
    passwordExpiryDays: true, logoutOnPasswordChange: true,
} as const;

// GET /api/settings/security — everyone can read the policy that applies to them
router.get('/security', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: SECURITY_SELECT });
        if (!org) return res.status(404).json({ error: 'Organization not found' });
        res.json(org);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load security settings' });
    }
});

// PATCH /api/settings/security — admins only
router.patch('/security', authorizeRole(ADMIN_ROLES), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const b = req.body ?? {};
        const data: Record<string, number | boolean> = {};

        if (b.sessionTimeoutMinutes !== undefined) {
            const n = Number(b.sessionTimeoutMinutes);
            if (!SESSION_TIMEOUT_OPTIONS.includes(n)) return res.status(400).json({ error: `Session timeout must be one of: ${SESSION_TIMEOUT_OPTIONS.join(', ')} minutes` });
            data.sessionTimeoutMinutes = n;
        }
        if (b.minPasswordLength !== undefined) {
            const n = Number(b.minPasswordLength);
            if (!Number.isInteger(n) || n < 8 || n > 32) return res.status(400).json({ error: 'Minimum password length must be between 8 and 32' });
            data.minPasswordLength = n;
        }
        if (b.passwordExpiryDays !== undefined) {
            const n = Number(b.passwordExpiryDays);
            if (!Number.isInteger(n) || (n !== 0 && (n < 30 || n > 365))) return res.status(400).json({ error: 'Password expiry must be 0 (never) or between 30 and 365 days' });
            data.passwordExpiryDays = n;
        }
        for (const key of ['requirePasswordSpecialChar', 'logoutOnPasswordChange'] as const) {
            if (b[key] !== undefined) {
                if (typeof b[key] !== 'boolean') return res.status(400).json({ error: `${key} must be true or false` });
                data[key] = b[key];
            }
        }
        if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nothing to update' });

        const before = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: SECURITY_SELECT });
        const updated = await prisma.organization.update({ where: { id: req.user.orgId }, data, select: SECURITY_SELECT });
        clearAccountCache();
        const changes = diffFields(before ?? {}, data);
        if (Object.keys(changes.after).length > 0) await audit(req, 'UPDATE_SECURITY_POLICY', 'Organization', req.user.orgId, changes.before, changes.after);
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update security settings' });
    }
});

// ─── Brokerage policies (CRM, Properties, Finance, Appointments, Documents) ───
// Enforced by the routes that own each rule; see src/lib/policies.ts for every option and its limits.

const flattenSettings = (obj: Record<string, any>) => {
    const out: Record<string, unknown> = {};
    for (const [section, values] of Object.entries(obj)) {
        for (const [key, value] of Object.entries(values as Record<string, unknown>)) out[`${section}.${key}`] = value;
    }
    return out;
};

// GET /api/settings/policies — every member can read the rules that apply to them
router.get('/policies', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { policies: true } });
        if (!org) return res.status(404).json({ error: 'Organization not found' });
        res.json({ policies: normalizeOrgPolicies(org.policies) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load brokerage policies' });
    }
});

// PATCH /api/settings/policies — admins only; send just the sections / options that change
router.patch('/policies', authorizeRole(ADMIN_ROLES), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { policies: true } });
        if (!org) return res.status(404).json({ error: 'Organization not found' });

        const current = normalizeOrgPolicies(org.policies);
        const result = applyOrgPoliciesPatch(current, req.body);
        if (!result.ok) return res.status(400).json({ error: result.error });
        if (!result.changed) return res.json({ policies: current });

        // Keep the other keys stored in the same JSON (e.g. `modules`), which this endpoint does not manage.
        const stored = org.policies && typeof org.policies === 'object' && !Array.isArray(org.policies) ? org.policies as Record<string, unknown> : {};
        await prisma.organization.update({ where: { id: req.user.orgId }, data: { policies: { ...stored, ...result.value } as any } });
        clearAccountCache();
        const changes = diffFields(flattenSettings(current as any), flattenSettings(result.value as any));
        await audit(req, 'UPDATE_ORG_POLICIES', 'Organization', req.user.orgId, changes.before, changes.after);
        res.json({ policies: result.value });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update brokerage policies' });
    }
});

// GET /api/settings/catalogs — fixed lists (departments, currencies, every valid property type) and the
// Uruguay defaults; the brokerage's own editable lists are in GET /api/settings/policies.
router.get('/catalogs', (_req, res) => {
    res.json({
        departments: DEPARTMENTS_UY, currencies: CURRENCIES, propertyTypes: ALL_PROPERTY_TYPES,
        defaults: { propertyTypes: PROPERTY_TYPES_UY, amenities: AMENITIES_UY },
    });
});

// ─── Modules (Settings > Módulos) ────────────────────────────────────────────

const canEditModule = (role: string, key: ModuleKey, map: ModuleMap) =>
    ADMIN_ROLES.includes(role) && (!map[key].superadminOnly || role === 'SUPERADMIN') && map[key].source !== 'forced_off';

const modulesPayload = (role: string, map: ModuleMap) => ({
    modules: MODULE_KEYS.map(k => ({ ...map[k], canEdit: canEditModule(role, k, map) })),
});

// GET /api/settings/modules — every member can read which modules are on (the panel hides the rest)
router.get('/modules', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { policies: true } });
        if (!org) return res.status(404).json({ error: 'Organization not found' });
        res.json(modulesPayload(req.user.role, resolveModules(readModuleOverrides(org.policies))));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load modules' });
    }
});

// PUT /api/settings/modules — { modules: { [key]: true | false | null } }; null removes the override.
// SUPERADMIN / FIRMADMIN only; superadminOnly modules need SUPERADMIN; forced-off modules cannot change.
router.put('/modules', authorizeRole(ADMIN_ROLES), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const body = req.body?.modules;
        if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Send { modules: { key: true | false | null } }' });

        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { policies: true } });
        if (!org) return res.status(404).json({ error: 'Organization not found' });
        const before = readModuleOverrides(org.policies);
        const current = resolveModules(before);
        const next = { ...before };

        for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
            if (!isModuleKey(key)) return res.status(400).json({ error: `Unknown module: ${key}` });
            if (value !== null && typeof value !== 'boolean') return res.status(400).json({ error: `Module ${key} must be true, false or null` });
            if (current[key].source === 'forced_off') return res.status(400).json({ error: `Module ${key} is turned off for the whole installation` });
            if (current[key].superadminOnly && req.user.role !== 'SUPERADMIN') return res.status(403).json({ error: `Only a SUPERADMIN can change module ${key}` });
            if (value === null) delete next[key]; else next[key] = value;
        }

        const changedKeys = MODULE_KEYS.filter(k => before[k] !== next[k]);
        if (changedKeys.length) {
            const stored = org.policies && typeof org.policies === 'object' && !Array.isArray(org.policies) ? org.policies as Record<string, unknown> : {};
            await prisma.organization.update({ where: { id: req.user.orgId }, data: { policies: { ...stored, modules: next } as any } });
            clearModuleCache(req.user.orgId);
            clearAccountCache();
            const pick = (o: Partial<Record<ModuleKey, boolean>>) => Object.fromEntries(changedKeys.map(k => [k, o[k] ?? null]));
            await audit(req, 'UPDATE_ORG_MODULES', 'Organization', req.user.orgId, pick(before), pick(next));
        }
        res.json(modulesPayload(req.user.role, resolveModules(next)));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update modules' });
    }
});

// ─── Personal preferences (Settings > "My preferences" tabs) ──────────────────

// GET /api/settings/preferences
router.get('/preferences', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const me = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { preferences: true } });
        if (!me) return res.status(404).json({ error: 'User not found' });
        res.json({ preferences: normalizePreferences(me.preferences) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load preferences' });
    }
});

// PATCH /api/settings/preferences — own preferences only
router.patch('/preferences', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const me = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { preferences: true } });
        if (!me) return res.status(404).json({ error: 'User not found' });

        const current = normalizePreferences(me.preferences);
        const result = applyPreferencesPatch(current, req.body);
        if (!result.ok) return res.status(400).json({ error: result.error });
        if (result.changed) await prisma.user.update({ where: { id: req.user.userId }, data: { preferences: result.value as any } });
        res.json({ preferences: result.value });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// ─── Lead Routing Rules & Agent Availability (1.2) ───────────────────────────

const VALID_STRATEGIES = ['LISTING_AGENT', 'SPECIFIC_AGENT', 'ROUND_ROBIN', 'LEAST_LOADED'];

// PATCH /api/settings/users/:id/lead-availability — update acceptingLeads / maxActiveLeads
router.patch('/users/:id/lead-availability', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), requireModule('leadRouting'), async (req: AuthRequest, res) => {
    const user = req.user!;
    const target = await prisma.user.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const data: any = {};
    if (typeof req.body.acceptingLeads === 'boolean') data.acceptingLeads = req.body.acceptingLeads;
    if (req.body.maxActiveLeads !== undefined) {
        const v = req.body.maxActiveLeads;
        data.maxActiveLeads = v === null || v === '' ? null : Math.max(0, Math.round(Number(v)));
    }

    const updated = await prisma.user.update({
        where: { id: target.id },
        data,
        select: { id: true, name: true, acceptingLeads: true, maxActiveLeads: true },
    });
    res.json(updated);
});

// GET /api/settings/lead-routing — list all lead routing rules for the organization
router.get('/lead-routing', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), requireModule('leadRouting'), async (req: AuthRequest, res) => {
    const rules = await prisma.leadRoutingRule.findMany({
        where: { orgId: req.user!.orgId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(rules);
});

// POST /api/settings/lead-routing — create a new lead routing rule
router.post('/lead-routing', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), requireModule('leadRouting'), async (req: AuthRequest, res) => {
    const user = req.user!;
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
    if (!name) return res.status(400).json({ error: 'Rule name is required' });

    const strategy = VALID_STRATEGIES.includes(req.body.strategy) ? req.body.strategy : 'ROUND_ROBIN';
    const targetAgentId = typeof req.body.targetAgentId === 'string' && req.body.targetAgentId.trim() ? req.body.targetAgentId.trim() : null;
    if (strategy === 'SPECIFIC_AGENT') {
        if (!targetAgentId) return res.status(400).json({ error: 'targetAgentId is required for SPECIFIC_AGENT strategy' });
        const agent = await prisma.user.findFirst({ where: { id: targetAgentId, orgId: user.orgId, isActive: true } });
        if (!agent) return res.status(400).json({ error: 'Target agent not found in your organization' });
    }

    const count = await prisma.leadRoutingRule.count({ where: { orgId: user.orgId } });
    const minPrice = req.body.minPrice !== undefined && req.body.minPrice !== null && req.body.minPrice !== '' ? Number(req.body.minPrice) : null;
    const maxPrice = req.body.maxPrice !== undefined && req.body.maxPrice !== null && req.body.maxPrice !== '' ? Number(req.body.maxPrice) : null;

    const rule = await prisma.leadRoutingRule.create({
        data: {
            orgId: user.orgId,
            name,
            priority: typeof req.body.priority === 'number' && Number.isFinite(req.body.priority) ? Math.round(req.body.priority) : count,
            enabled: req.body.enabled !== false,
            source: clean(req.body.source, 80) ?? null,
            city: clean(req.body.city, 80) ?? null,
            propertyType: clean(req.body.propertyType, 60) ?? null,
            minPrice: Number.isFinite(minPrice) ? minPrice : null,
            maxPrice: Number.isFinite(maxPrice) ? maxPrice : null,
            strategy,
            targetAgentId: strategy === 'SPECIFIC_AGENT' ? targetAgentId : null,
        },
    });
    res.status(201).json(rule);
});

// PATCH /api/settings/lead-routing/:id — update a routing rule (enable/disable, priority, conditions)
router.patch('/lead-routing/:id', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), requireModule('leadRouting'), async (req: AuthRequest, res) => {
    const user = req.user!;
    const existing = await prisma.leadRoutingRule.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!existing) return res.status(404).json({ error: 'Routing rule not found' });

    const data: any = {};
    if (typeof req.body.name === 'string' && req.body.name.trim()) data.name = req.body.name.trim().slice(0, 120);
    if (typeof req.body.enabled === 'boolean') data.enabled = req.body.enabled;
    if (typeof req.body.priority === 'number' && Number.isFinite(req.body.priority)) data.priority = Math.round(req.body.priority);
    if (req.body.source !== undefined) data.source = clean(req.body.source, 80) ?? null;
    if (req.body.city !== undefined) data.city = clean(req.body.city, 80) ?? null;
    if (req.body.propertyType !== undefined) data.propertyType = clean(req.body.propertyType, 60) ?? null;
    if (req.body.minPrice !== undefined) data.minPrice = req.body.minPrice === null || req.body.minPrice === '' ? null : Number(req.body.minPrice);
    if (req.body.maxPrice !== undefined) data.maxPrice = req.body.maxPrice === null || req.body.maxPrice === '' ? null : Number(req.body.maxPrice);
    if (req.body.strategy !== undefined && VALID_STRATEGIES.includes(req.body.strategy)) data.strategy = req.body.strategy;
    if (req.body.targetAgentId !== undefined) data.targetAgentId = req.body.targetAgentId || null;

    const updated = await prisma.leadRoutingRule.update({ where: { id: existing.id }, data });
    res.json(updated);
});

// DELETE /api/settings/lead-routing/:id
router.delete('/lead-routing/:id', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), requireModule('leadRouting'), async (req: AuthRequest, res) => {
    const user = req.user!;
    const existing = await prisma.leadRoutingRule.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!existing) return res.status(404).json({ error: 'Routing rule not found' });
    await prisma.leadRoutingRule.delete({ where: { id: existing.id } });
    res.json({ message: 'Routing rule deleted' });
});

// POST /api/settings/lead-routing/test — dry-run simulator to preview which agent receives a lead
router.post('/lead-routing/test', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), requireModule('leadRouting'), async (req: AuthRequest, res) => {
    const user = req.user!;
    const decision = await resolveLeadAssignee(
        {
            orgId: user.orgId,
            source: req.body.source || null,
            city: req.body.city || null,
            propertyType: req.body.propertyType || null,
            price: req.body.price !== undefined && req.body.price !== '' ? Number(req.body.price) : null,
            listingAgentId: req.body.listingAgentId || null,
        },
        { dryRun: true },
    );
    res.json(decision);
});

// GET /api/settings/notifications — caller's email & in-app notification preferences
router.get('/notifications', async (req: AuthRequest, res) => {
    const me = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { notificationPrefs: true },
    });
    if (!me) return res.status(404).json({ error: 'User not found' });
    res.json(normalizeNotificationPrefs(me.notificationPrefs));
});

// PATCH /api/settings/notifications — update caller's email & in-app notification preferences
router.patch('/notifications', async (req: AuthRequest, res) => {
    const me = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { notificationPrefs: true },
    });
    if (!me) return res.status(404).json({ error: 'User not found' });
    const current = normalizeNotificationPrefs(me.notificationPrefs);
    const nextPrefs = normalizeNotificationPrefs({ ...current, ...req.body });
    await prisma.user.update({
        where: { id: req.user!.userId },
        data: { notificationPrefs: nextPrefs as any },
    });
    res.json(nextPrefs);
});

export default router;
