/**
 * Public, unauthenticated endpoints used by the infrastructure and the public sites (spec 3.2).
 *
 * GET /api/public/domain-check?domain=  → 200 when the platform serves that host, 404 otherwise.
 *   Caddy asks this before issuing an on-demand TLS certificate, so nobody can make the server request
 *   certificates for domains that are not registered by an active brokerage.
 *
 * Brokerage sites (spec 8). Every endpoint below serves exactly one brokerage, chosen with ?site=<slug> or
 * ?host=<domain> (one of the two is required). A listing id or code from another brokerage answers 404, whatever
 * the parameters say. With the publicSite module off they answer 404 module_disabled.
 *
 * GET  /api/public/site                  brokerage profile, theme and pages (siteConfig) for the site's layout
 * GET  /api/public/listings/index        every public listing in a compact JSON (filtered in the browser), ETag
 * GET  /api/public/listings/:ref         one listing; ref = "<code>-<slug>", "<code>" or the id
 * POST /api/public/listings/:id/inquiry  inquiry form → interested person in the CRM (consent required)
 * POST /api/public/events                WhatsApp / phone clicks
 */
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { prisma } from '../server';
import { getOrgModules, sendModuleDisabled } from '../lib/modules';
import { publicCoords } from '../lib/listing';
import { readSiteConfig } from '../lib/siteConfig';
import { handleInquiry, PUBLIC_STATUSES } from '../lib/inquiry';

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


// ── Brokerage sites ──────────────────────────────────────────────────────────

const inquiryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
const eventLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });

const ORG_SITE_SELECT = {
    id: true, name: true, slug: true, customDomain: true, logoUrl: true, brandColor: true, phone: true, whatsapp: true,
    address: true, website: true, preferredLanguage: true, defaultCurrency: true, timezone: true, siteConfig: true,
    isDemo: true, demoExpiresAt: true,
} as const;
type SiteOrg = Prisma.OrganizationGetPayload<{ select: typeof ORG_SITE_SELECT }>;

/** The address a brokerage's site is published at, or null when the installation has no PLATFORM_DOMAIN. */
export function siteUrl(org: { slug: string | null; customDomain: string | null }): string | null {
    if (org.customDomain) return `https://${org.customDomain}`;
    const base = platformDomain();
    return base && org.slug ? `https://${org.slug}.${base}` : null;
}

/**
 * The brokerage a site request is for (?site=<slug> or ?host=<domain>), or a response already sent.
 * A renamed slug answers with the current one in `movedTo` (the site redirects).
 */
async function siteOrg(req: Request, res: Response): Promise<SiteOrg | null> {
    const slug = typeof req.query.site === 'string' ? req.query.site.trim().toLowerCase() : '';
    const host = typeof req.query.host === 'string' ? req.query.host : '';
    let org: SiteOrg | null = null;
    if (slug) {
        org = await prisma.organization.findUnique({ where: { slug }, select: ORG_SITE_SELECT });
        if (!org) {
            const old = await prisma.orgSlugHistory.findUnique({ where: { oldSlug: slug }, select: { organization: { select: { slug: true } } } });
            if (old?.organization?.slug) { res.status(404).json({ error: 'Site not found', movedTo: old.organization.slug }); return null; }
        }
    } else if (host) {
        const r = await resolveHost(host);
        if (r?.kind === 'org') org = await prisma.organization.findUnique({ where: { id: r.orgId }, select: ORG_SITE_SELECT });
    } else {
        res.status(400).json({ error: 'site or host is required' });
        return null;
    }
    if (!org || expiredDemo(org)) { res.status(404).json({ error: 'Site not found' }); return null; }
    if (!(await getOrgModules(org.id)).publicSite.enabled) { sendModuleDisabled(res, 'publicSite'); return null; }
    return org;
}

const OP_SLUG: Record<string, string> = { SALE: 'venta', RENT: 'alquiler', SEASONAL_RENT: 'alquiler-temporario' };
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Friendly URL part: the stored slug, else "casa-venta-centro-salto" from the listing's own data. */
export function listingSlug(p: { slug: string | null; title: string | null; propertyType: string | null; locality: string | null; city: string; prices: { operation: string }[] }): string {
    if (p.slug) return p.slug;
    const parts = [p.title || (p.propertyType || '').replace(/_/g, ' '), p.title ? '' : OP_SLUG[p.prices[0]?.operation] || '', p.locality || '', p.city];
    return slugify(parts.filter(Boolean).join(' ')).slice(0, 80) || 'propiedad';
}
const listingRef = (p: Parameters<typeof listingSlug>[0] & { id: string; code: string | null }) => `${p.code || p.id}-${listingSlug(p)}`;

type Variants = Record<string, { url?: string; width?: number; height?: number }>;
const variantsOf = (v: Prisma.JsonValue | null): Variants => (v && typeof v === 'object' && !Array.isArray(v) ? v as unknown as Variants : {});
const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

function siteProfile(org: SiteOrg, modules: Awaited<ReturnType<typeof getOrgModules>>) {
    return {
        slug: org.slug, name: org.name, logoUrl: org.logoUrl, brandColor: org.brandColor,
        phone: org.phone, whatsapp: org.whatsapp, address: org.address, website: org.website,
        language: org.preferredLanguage, currency: org.defaultCurrency, timezone: org.timezone,
        url: siteUrl(org), customDomain: org.customDomain,
        noindex: org.isDemo, isDemo: org.isDemo,
        modules: { publicMap: modules.publicMap.enabled },
        config: readSiteConfig(org.siteConfig),
    };
}

// GET /api/public/site?site=|host= [&listing=<id>] — the site's layout data. With listing=<id> (the legacy
// /public-listings/<id> address) it also answers that listing's path on the site, for the 301 redirect.
router.get('/site', async (req, res) => {
    try {
        const org = await siteOrg(req, res);
        if (!org) return;
        const modules = await getOrgModules(org.id);
        let listingPath: string | null | undefined;
        if (typeof req.query.listing === 'string') {
            const p = await prisma.property.findFirst({
                where: { id: req.query.listing, orgId: org.id, isPublic: true, status: { in: [...PUBLIC_STATUSES] } },
                select: { id: true, code: true, slug: true, title: true, propertyType: true, locality: true, city: true, prices: { where: { isActive: true }, select: { operation: true } } },
            });
            listingPath = p ? `/propiedades/${listingRef(p)}` : null;
        }
        res.set('Cache-Control', 'public, max-age=60');
        res.json({ ...siteProfile(org, modules), ...(listingPath !== undefined ? { listingPath } : {}) });
    } catch (err) {
        console.error('[public/site]', err);
        res.status(500).json({ error: 'Failed to load site' });
    }
});

// GET /api/public/listings/index?site=|host= — compact index (spec 8.2). Short keys; empty values are left out.
//   i id · c code · s url slug · t type · st status · f featured · p prices [[operation, amount|null, currency, period|null]]
//   ti title · dp department · ci city · lo locality · nb neighbourhood · bd beds · ba baths · m2 built area
//   la land area · lu land unit · g garage · am amenities · fu furnished · ll [lat, lng] · ap approximate location
//   ph photo (thumb) · u updated (ISO date)
// Weak ETag over the body; If-None-Match with it answers 304.
router.get('/listings/index', async (req, res) => {
    try {
        const org = await siteOrg(req, res);
        if (!org) return;
        const rows = await prisma.property.findMany({
            where: { orgId: org.id, isPublic: true, status: { in: [...PUBLIC_STATUSES] } },
            orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
            select: {
                id: true, code: true, slug: true, title: true, propertyType: true, status: true, featured: true,
                state: true, city: true, locality: true, neighborhood: true, beds: true, baths: true, builtAreaM2: true,
                landArea: true, landAreaUnit: true, garageSpaces: true, amenities: true, furnished: true,
                lat: true, lng: true, geoPrecision: true, updatedAt: true,
                prices: { where: { isActive: true }, select: { operation: true, amount: true, currency: true, period: true, onRequest: true } },
                mediaAssets: { where: { type: { in: ['image', 'IMAGE'] } }, take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true, variants: true } },
            },
        });
        const order = ['SALE', 'RENT', 'SEASONAL_RENT'];
        const items = rows.map(r => {
            const p = publicCoords(r);
            const prices = [...r.prices].sort((a, b) => order.indexOf(a.operation) - order.indexOf(b.operation));
            const photo = r.mediaAssets[0];
            const o: Record<string, unknown> = {
                i: r.id, s: listingSlug({ ...r, prices }), t: r.propertyType, st: r.status,
                p: prices.map(x => [x.operation, x.onRequest ? null : num(x.amount), x.currency, x.period ?? null]),
                ci: r.city, u: r.updatedAt.toISOString().slice(0, 10),
            };
            const opt: [string, unknown][] = [
                ['c', r.code], ['ti', r.title], ['dp', r.state], ['lo', r.locality], ['nb', r.neighborhood],
                ['bd', r.beds], ['ba', r.baths], ['m2', r.builtAreaM2], ['la', r.landArea], ['lu', r.landArea != null ? r.landAreaUnit : null],
                ['g', r.garageSpaces], ['am', r.amenities.length ? r.amenities : null], ['fu', r.furnished ? 1 : null], ['f', r.featured ? 1 : null],
                ['ll', p.lat != null && p.lng != null ? [p.lat, p.lng] : null], ['ap', p.lat != null && r.geoPrecision === 'APPROX' ? 1 : null],
                ['ph', photo ? (variantsOf(photo.variants).thumb?.url || photo.url) : null],
            ];
            for (const [k, v] of opt) if (v != null && v !== '') o[k] = v;
            return o;
        });
        const body = JSON.stringify({ v: 1, site: org.slug, count: items.length, items });
        const etag = `W/"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
        res.set({ 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600', ETag: etag, Vary: 'Accept-Encoding' });
        const inm = req.get('If-None-Match');
        if (inm && inm.split(/\s*,\s*/).includes(etag)) return res.status(304).end();
        res.type('application/json').send(body);
    } catch (err) {
        console.error('[public/listings/index]', err);
        res.status(500).json({ error: 'Failed to load listings' });
    }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// GET /api/public/listings/:ref?site=|host= — one listing of this brokerage
router.get('/listings/:ref', async (req, res) => {
    try {
        const org = await siteOrg(req, res);
        if (!org) return;
        const ref = String(req.params.ref).slice(0, 200);
        const base = { orgId: org.id, isPublic: true, status: { in: [...PUBLIC_STATUSES] } };
        const select = {
            id: true, code: true, slug: true, title: true, propertyType: true, status: true, description: true,
            address: true, state: true, city: true, locality: true, neighborhood: true, beds: true, baths: true,
            builtAreaM2: true, landArea: true, landAreaUnit: true, garageSpaces: true, amenities: true, furnished: true,
            hoaFee: true, hoaFeeCurrency: true, yearBuilt: true, virtualTourUrl: true, lat: true, lng: true, geoPrecision: true,
            updatedAt: true,
            prices: { where: { isActive: true }, select: { operation: true, amount: true, currency: true, period: true, onRequest: true } },
            mediaAssets: { orderBy: { sortOrder: 'asc' as const }, select: { url: true, type: true, caption: true, width: true, height: true, variants: true } },
            agent: { select: { name: true, phone: true, email: true, title: true } },
        };
        let p = UUID_RE.test(ref) ? await prisma.property.findFirst({ where: { ...base, id: ref.slice(0, 36) }, select }) : null;
        if (!p) {
            // "<code>-<slug>": codes may contain dashes, so try every prefix, longest first
            const parts = ref.split('-');
            const candidates = parts.map((_, i) => parts.slice(0, i + 1).join('-')).reverse();
            const found = await prisma.property.findMany({ where: { ...base, code: { in: candidates } }, select });
            p = found.sort((a, b) => (b.code?.length ?? 0) - (a.code?.length ?? 0))[0] ?? null;
        }
        if (!p) return res.status(404).json({ error: 'Listing not found' });
        const order = ['SALE', 'RENT', 'SEASONAL_RENT'];
        const prices = [...p.prices].sort((a, b) => order.indexOf(a.operation) - order.indexOf(b.operation));
        const coords = publicCoords(p);
        const { mediaAssets, agent, prices: _prices, address, ...rest } = p;
        res.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
        res.json({
            ...rest,
            // The street address only when the brokerage shows the exact location
            address: p.geoPrecision === 'EXACT' ? address : null,
            lat: coords.lat, lng: coords.lng, approximate: coords.lat != null && p.geoPrecision === 'APPROX',
            ref: listingRef({ ...p, prices }),
            prices: prices.map(x => ({ operation: x.operation, amount: x.onRequest ? null : num(x.amount), currency: x.currency, period: x.period, onRequest: x.onRequest || x.amount == null })),
            photos: mediaAssets.filter(m => /image/i.test(m.type)).map(m => {
                const v = variantsOf(m.variants);
                return { url: m.url, caption: m.caption, width: m.width, height: m.height, thumb: v.thumb?.url ?? null, md: v.md?.url ?? null, lg: v.lg?.url ?? null };
            }),
            agent: agent ? { name: agent.name, phone: agent.phone, email: agent.email, title: agent.title } : null,
        });
    } catch (err) {
        console.error('[public/listings/:ref]', err);
        res.status(500).json({ error: 'Failed to load listing' });
    }
});

// POST /api/public/listings/:id/inquiry?site=|host= — the site's inquiry form
router.post('/listings/:id/inquiry', inquiryLimiter, async (req, res) => {
    try {
        const org = await siteOrg(req, res);
        if (!org) return;
        const property = await prisma.property.findFirst({
            where: { id: String(req.params.id), orgId: org.id, isPublic: true, status: { in: [...PUBLIC_STATUSES] } },
        });
        if (!property) return res.status(404).json({ error: 'Listing not found' });
        const r = await handleInquiry(property, req.body || {}, true);
        if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
        res.status(201).json({ ok: true });
    } catch (err) {
        console.error('[public/inquiry]', err);
        res.status(500).json({ error: 'Failed to send inquiry' });
    }
});

const EVENT_TYPES = new Set(['whatsapp_click', 'phone_click', 'email_click', 'share']);

// POST /api/public/events?site=|host= { type, propertyId? } — contact clicks (spec 8.4)
router.post('/events', eventLimiter, async (req, res) => {
    try {
        const org = await siteOrg(req, res);
        if (!org) return;
        const type = typeof req.body?.type === 'string' ? req.body.type : '';
        if (!EVENT_TYPES.has(type)) return res.status(400).json({ error: 'Unknown event type' });
        let propertyId: string | null = null;
        if (req.body?.propertyId) {
            const p = await prisma.property.findFirst({ where: { id: String(req.body.propertyId), orgId: org.id, isPublic: true }, select: { id: true } });
            if (!p) return res.status(404).json({ error: 'Listing not found' });
            propertyId = p.id;
        }
        await prisma.siteEvent.create({ data: { orgId: org.id, propertyId, type } });
        res.status(204).end();
    } catch (err) {
        console.error('[public/events]', err);
        res.status(500).json({ error: 'Failed to record event' });
    }
});

export default router;
