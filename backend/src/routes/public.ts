/**
 * Public, unauthenticated endpoints used by the infrastructure and the public sites (spec 3.2).
 *
 * GET /api/public/domain-check?domain=  → 200 when the platform serves that host, 404 otherwise.
 *   Caddy asks this before issuing an on-demand TLS certificate, so nobody can make the server request
 *   certificates for domains that are not registered by an active brokerage.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../server';

const router = Router();

// Caddy calls this once per new host; anything much busier is someone probing
const checkLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });

const HOST_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function platformDomain(): string | null {
    const d = (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    return d || null;
}

/** The organization a host belongs to, or the reserved platform hosts. */
export async function resolveHost(rawHost: string): Promise<{ kind: 'platform' } | { kind: 'org'; orgId: string; slug: string | null } | null> {
    const host = rawHost.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    if (!HOST_RE.test(host)) return null;
    const base = platformDomain();
    if (base) {
        if (host === base || host === `www.${base}` || host === `app.${base}`) return { kind: 'platform' };
        if (host.endsWith(`.${base}`)) {
            const sub = host.slice(0, -(base.length + 1));
            if (sub.includes('.')) return null; // only one level: {slug}.platform.uy
            const org = await prisma.organization.findUnique({ where: { slug: sub }, select: { id: true, slug: true, isDemo: true, demoExpiresAt: true } });
            if (!org || expiredDemo(org)) return null;
            return { kind: 'org', orgId: org.id, slug: org.slug };
        }
    }
    // A brokerage's own domain, with or without "www."
    const bare = host.startsWith('www.') ? host.slice(4) : host;
    const org = await prisma.organization.findFirst({
        where: { customDomain: { in: [host, bare] } },
        select: { id: true, slug: true, isDemo: true, demoExpiresAt: true },
    });
    if (!org || expiredDemo(org)) return null;
    return { kind: 'org', orgId: org.id, slug: org.slug };
}

const expiredDemo = (o: { isDemo: boolean; demoExpiresAt: Date | null }) => o.isDemo && !!o.demoExpiresAt && o.demoExpiresAt < new Date();

router.get('/domain-check', checkLimiter, async (req, res) => {
    const domain = typeof req.query.domain === 'string' ? req.query.domain : '';
    try {
        const r = domain ? await resolveHost(domain) : null;
        if (!r) return res.status(404).json({ ok: false });
        res.json({ ok: true });
    } catch (err) {
        console.error('[domain-check]', err);
        res.status(500).json({ ok: false });
    }
});

export default router;
