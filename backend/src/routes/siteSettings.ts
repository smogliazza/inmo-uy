/**
 * Settings > Website (spec 8.4): theme, home page, content pages, social links and privacy policy of the
 * brokerage's public site (Organization.siteConfig). Mounted behind authenticateToken + requireModule('publicSite').
 *
 * GET /api/site-settings  → { config, url, slug, customDomain }   (any member can read it)
 * PUT /api/site-settings  { config } → the saved config           (FIRMADMIN / SUPERADMIN)
 */
import { Router } from 'express';
import { prisma } from '../server';
import { AuthRequest, authorizeRole } from '../middleware/authMiddleware';
import { parseSiteConfig, readSiteConfig } from '../lib/siteConfig';
import { siteUrl } from './public';
import { audit } from '../lib/audit';

const router = Router();

router.get('/', async (req: AuthRequest, res) => {
    const org = await prisma.organization.findUnique({
        where: { id: req.user!.orgId },
        select: { siteConfig: true, slug: true, customDomain: true },
    });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json({ config: readSiteConfig(org.siteConfig), url: siteUrl(org), slug: org.slug, customDomain: org.customDomain });
});

router.put('/', authorizeRole(['SUPERADMIN', 'FIRMADMIN']), async (req: AuthRequest, res) => {
    const parsed = parseSiteConfig(req.body?.config);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const before = await prisma.organization.findUnique({ where: { id: req.user!.orgId }, select: { siteConfig: true } });
    await prisma.organization.update({ where: { id: req.user!.orgId }, data: { siteConfig: parsed.config as object } });
    await audit(req, 'UPDATE_SITE_CONFIG', 'Organization', req.user!.orgId, { siteConfig: before?.siteConfig ?? null }, { siteConfig: parsed.config });
    res.json({ config: parsed.config });
});

export default router;
