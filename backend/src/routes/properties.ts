import { Router } from 'express';
import { prisma } from '../server';
import rateLimit from 'express-rate-limit';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { optDate, optNumber, isManager } from '../lib/access';
import { OrgPolicies, missingListingField, descriptionTooLong } from '../lib/policies';
import { getOrgModules, sendModuleDisabled } from '../lib/modules';
import { matchPlaceName } from '../lib/uy';
import { parsePrices, parseAmount, parseUyFields, savePrices, validPropertyType, publicCoords, PriceInput } from '../lib/listing';
import { Prisma } from '@prisma/client';
import { geocode } from '../lib/geocode';

// City names already used by the brokerage, so new ones reuse the same spelling (accent/case-insensitive)
async function orgCityNames(orgId: string): Promise<string[]> {
    const rows = await prisma.property.findMany({ where: { orgId }, distinct: ['city'], select: { city: true } });
    return rows.map(r => r.city).filter((c): c is string => Boolean(c));
}
import { audit, diffFields } from '../lib/audit';
import { handleInquiry, PUBLIC_STATUSES } from '../lib/inquiry';

const router = Router();

const PROP_STATUSES = ['COMING_SOON', 'ACTIVE', 'IN_CONTRACT', 'SOLD', 'WITHDRAWN', 'EXPIRED', 'RESERVED', 'RENTED'];

// Listing policy (Settings > Properties): the first rule a listing breaks, or null.
function listingPolicyError(policy: OrgPolicies['properties'], fields: Record<string, unknown>, onlyPresent: boolean, propertyType?: string | null): string | null {
    return missingListingField(policy, fields, onlyPresent, propertyType)
        ?? (('description' in fields || !onlyPresent) ? descriptionTooLong(policy, fields.description) : null);
}

const photosNeededMessage = (n: number) =>
    `At least ${n} photo${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} required before a listing can go Active. Keep it as Coming Soon, add the photos, then activate it.`;

// Public lead forms are unauthenticated — keep bots from flooding agents' CRMs
const inquiryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

const PUBLIC_SELECT = {
    id: true, address: true, city: true, state: true, zip: true, price: true, beds: true, baths: true,
    sqft: true, status: true, description: true, propertyType: true, neighborhood: true, yearBuilt: true,
    virtualTourUrl: true, code: true, locality: true, builtAreaM2: true, landArea: true, landAreaUnit: true,
    garageSpaces: true, amenities: true, furnished: true, hoaFee: true, hoaFeeCurrency: true,
    lat: true, lng: true, geoPrecision: true,
    prices: { where: { isActive: true }, select: { operation: true, amount: true, currency: true, period: true, onRequest: true } },
    mediaAssets: { orderBy: { sortOrder: 'asc' as const }, select: { url: true, type: true, caption: true } },
    agent: { select: { name: true, phone: true, email: true, title: true } },
    organization: { select: { name: true, phone: true, slug: true, logoUrl: true, brandColor: true } },
};

// GET /api/properties/public?b=<brokerage-slug> — one brokerage's public listings page.
// Each brokerage only ever shows its own listings.
router.get('/public', async (req, res) => {
    const slug = typeof req.query.b === 'string' ? req.query.b.trim().toLowerCase() : '';
    if (!slug) return res.status(400).json({ error: 'Brokerage not specified' });

    let organization = await prisma.organization.findUnique({
        where: { slug },
        select: { id: true, name: true, slug: true, phone: true, website: true, logoUrl: true, brandColor: true },
    });
    let redirectedFrom: string | null = null;
    if (!organization) {
        const historical = await prisma.orgSlugHistory.findUnique({
            where: { oldSlug: slug },
            include: { organization: { select: { id: true, name: true, slug: true, phone: true, website: true, logoUrl: true, brandColor: true } } },
        });
        if (historical?.organization) {
            organization = historical.organization;
            redirectedFrom = slug;
        }
    }
    if (!organization) return res.status(404).json({ error: 'Brokerage not found' });
    if (!(await getOrgModules(organization.id)).publicSite.enabled) return sendModuleDisabled(res, 'publicSite');

    const properties = await prisma.property.findMany({
        where: { orgId: organization.id, isPublic: true, status: { in: ['ACTIVE', 'COMING_SOON', 'IN_CONTRACT', 'RESERVED'] } },
        take: 100,
        orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
        select: {
            id: true, address: true, city: true, state: true, zip: true, price: true,
            beds: true, baths: true, sqft: true, status: true, propertyType: true, locality: true, code: true,
            builtAreaM2: true, landArea: true, landAreaUnit: true, lat: true, lng: true, geoPrecision: true,
            prices: { where: { isActive: true }, select: { operation: true, amount: true, currency: true, period: true, onRequest: true } },
            mediaAssets: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
        },
    });

    const { id: _orgId, ...org } = organization;
    res.json({
        organization: org,
        ...(redirectedFrom ? { redirectedFrom, canonicalSlug: org.slug } : {}),
        listings: properties.map(({ mediaAssets, ...p }) => ({ ...publicCoords(p), imageUrl: mediaAssets[0]?.url ?? null })),
    });
});

// GET /api/properties/public/:id — public listing page
router.get('/public/:id', async (req, res) => {
    const property = await prisma.property.findFirst({
        where: { id: String(req.params.id), isPublic: true, status: { in: ['ACTIVE', 'COMING_SOON', 'IN_CONTRACT', 'RESERVED'] } },
        select: { ...PUBLIC_SELECT, orgId: true },
    });
    if (!property) return res.status(404).json({ error: 'Listing not found' });
    if (!(await getOrgModules(property.orgId)).publicSite.enabled) return sendModuleDisabled(res, 'publicSite');
    const { orgId: _orgId, ...listing } = property;
    res.json(publicCoords(listing));
});

// POST /api/properties/public/:id/inquiry — website / open-house lead capture.
// Creates (or updates) a HOT lead for the listing agent, logs the message,
// and drops a "call back now" task — speed-to-lead matters most.
router.post('/public/:id/inquiry', inquiryLimiter, async (req, res) => {
    const property = await prisma.property.findFirst({
        where: { id: String(req.params.id), isPublic: true, status: { in: [...PUBLIC_STATUSES] } },
    });
    if (!property) return res.status(404).json({ error: 'Listing not found' });
    if (!(await getOrgModules(property.orgId)).publicSite.enabled) return sendModuleDisabled(res, 'publicSite');
    const r = await handleInquiry(property, req.body || {}, false);
    if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
    res.status(201).json({ ok: true });
});

// All other property routes require auth
router.use(authenticateToken);

// GET /api/properties — paginated list with filters
router.get('/', async (req: AuthRequest, res) => {
    try {
        const orgId = req.user?.orgId;
        if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

        const page    = Math.max(1, parseInt(req.query.page  as string) || 1);
        const limit   = Math.min(100, parseInt(req.query.limit as string) || 12);
        const skip    = (page - 1) * limit;
        const search  = (req.query.search as string)?.trim() || '';
        const status  = req.query.status as string;
        const type    = req.query.type as string;
        const agentId = req.query.agentId as string;

        const where: any = { orgId };
        if (status) where.status = status;
        if (type)   where.propertyType = type;
        if (agentId) where.agentId = agentId;
        if (search) {
            where.OR = [
                { address:      { contains: search, mode: 'insensitive' } },
                { city:         { contains: search, mode: 'insensitive' } },
                { neighborhood: { contains: search, mode: 'insensitive' } },
                { mlsNumber:    { contains: search, mode: 'insensitive' } },
            ];
        }

        const [properties, total] = await Promise.all([
            prisma.property.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    agent:       { select: { id: true, name: true, avatarUrl: true } },
                    mediaAssets: { take: 1, orderBy: { sortOrder: 'asc' } },
                    prices:      { where: { isActive: true } },
                    _count:      { select: { offers: true, appointments: true } },
                },
            }),
            prisma.property.count({ where }),
        ]);

        res.json({ data: properties, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch properties' });
    }
});

// POST /api/properties/import — bulk CSV import for listings
router.post('/import', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (!['SUPERADMIN', 'FIRMADMIN', 'MANAGER', 'AGENT'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Your role cannot import listings' });
        }
        const policy = req.user.policies.properties;
        if (policy.whoCanCreate === 'MANAGERS' && !isManager(req.user)) {
            return res.status(403).json({ error: 'Your brokerage only lets managers create listings' });
        }

        const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
        const onDuplicate = req.body.onDuplicate === 'update' ? 'update' : 'skip';
        if (rows.length === 0) return res.status(400).json({ error: 'No rows provided' });
        if (rows.length > 500) return res.status(400).json({ error: 'Maximum 500 rows per import batch' });

        let created = 0;
        let updated = 0;
        let skipped = 0;
        const errors: { row: number; reason: string }[] = [];
        const warnings: { row: number; reason: string }[] = [];

        const knownCities = await orgCityNames(req.user.orgId);
        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { defaultCurrency: true } });
        const defaultCurrency = org?.defaultCurrency ?? 'USD';
        const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
        for (let i = 0; i < rows.length; i++) {
            const raw = rows[i] || {};
            const address = text(raw.address) ?? '';
            const locality = text(raw.locality);
            if (!address && !locality) {
                errors.push({ row: i + 1, reason: 'Address or locality is required' });
                continue;
            }
            if (!text(raw.city)) {
                errors.push({ row: i + 1, reason: 'City is required' });
                continue;
            }
            const city = matchPlaceName(raw.city, knownCities)!;
            if (!knownCities.includes(city)) knownCities.push(city);

            // Price: "US$ 290.000", "290000", "$ 25.000" or "Consultar"; optional operation / currency columns
            const priceText = text(String(raw.price ?? ''));
            const onRequest = !priceText || /consult/i.test(priceText);
            const amount = onRequest ? null : parseAmount(priceText);
            if (amount === 'invalid') {
                errors.push({ row: i + 1, reason: 'Valid price is required' });
                continue;
            }
            const opRaw = (text(raw.operation) ?? '').toLowerCase();
            const operation = /alquiler|rent|arriendo/.test(opRaw) ? (/temporada|seasonal/.test(opRaw) ? 'SEASONAL_RENT' : 'RENT') : 'SALE';
            const curRaw = (text(raw.currency) ?? (priceText?.includes('US$') || priceText?.includes('U$S') ? 'USD' : priceText?.trim().startsWith('$') ? 'UYU' : '')).toUpperCase();
            const currency = curRaw === 'US$' ? 'USD' : curRaw === '$' ? 'UYU' : (['USD', 'UYU', 'UI', 'UR'].includes(curRaw) ? curRaw : defaultCurrency);
            const priced = parsePrices([{ operation, amount, currency, onRequest: amount === null }], defaultCurrency);
            if (!priced.ok) {
                errors.push({ row: i + 1, reason: priced.error });
                continue;
            }

            const typeRaw = (text(raw.propertyType) ?? '').toUpperCase().replace(/\s+/g, '_');
            const propertyType = validPropertyType(typeRaw) ? typeRaw : 'OTRO';
            if (propertyType !== typeRaw) warnings.push({ row: i + 1, reason: `Unknown property type "${raw.propertyType ?? ''}": imported as OTRO` });

            const code = text(raw.code);
            const mlsNumber = text(raw.mlsNumber);
            const statusRaw = typeof raw.status === 'string' ? raw.status.trim().toUpperCase().replace(/\s+/g, '_') : 'ACTIVE';
            let status = PROP_STATUSES.includes(statusRaw) ? statusRaw : 'ACTIVE';
            // A new listing has no photos yet, so under a "photos before Active" policy it starts as Coming Soon
            const needPhotos = policy.photosRequiredToActivate;
            const downgraded = needPhotos > 0 && status === 'ACTIVE';
            if (downgraded) status = 'COMING_SOON';

            const orCond: any[] = [{ address: { equals: address, mode: 'insensitive' }, city: { equals: city, mode: 'insensitive' } }];
            if (mlsNumber) orCond.unshift({ mlsNumber: { equals: mlsNumber, mode: 'insensitive' } });
            if (code) orCond.unshift({ code });

            const existing = await prisma.property.findFirst({
                where: { orgId: req.user.orgId, OR: orCond },
                select: { id: true, agentId: true },
            });

            const num = (v: unknown) => { const n = parseAmount(v === undefined || v === null ? '' : String(v)); return n === 'invalid' ? null : n; };
            const sqft = num(raw.sqft);
            const propData: any = {
                address, locality, city,
                state: text(raw.state),
                zip: text(raw.zip),
                beds: num(raw.beds),
                baths: num(raw.baths),
                sqft: sqft !== null ? Math.round(sqft) : null,
                builtAreaM2: num(raw.builtAreaM2),
                status,
                propertyType,
                code,
                neighborhood: text(raw.neighborhood),
                mlsNumber,
                description: text(raw.description),
            };

            const policyErr = listingPolicyError(policy, {
                ...propData, yearBuilt: raw.yearBuilt ? Number(raw.yearBuilt) : null,
            }, false, propertyType);
            if (policyErr) {
                errors.push({ row: i + 1, reason: policyErr });
                continue;
            }
            // Tell the user about the change only for rows that were actually imported
            if (downgraded) warnings.push({ row: i + 1, reason: `Imported as Coming Soon: ${needPhotos} photo${needPhotos === 1 ? '' : 's'} needed before it can go Active` });

            if (existing) {
                const canEdit = existing.agentId === req.user.userId || ['FIRMADMIN', 'SUPERADMIN', 'MANAGER'].includes(req.user.role);
                if (onDuplicate === 'update' && canEdit) {
                    // Updating an existing listing never downgrades an Active one just because of the photo policy.
                    // Only this row's operation changes; the property's other prices stay.
                    const current = await prisma.propertyPrice.findMany({ where: { propertyId: existing.id, orgId: req.user.orgId } });
                    const merged = [...current.filter(c => c.operation !== operation).map(c => ({
                        operation: c.operation, amount: c.amount, currency: c.currency, period: c.period, onRequest: c.onRequest, isActive: c.isActive,
                    })), ...priced.prices];
                    await prisma.$transaction(async (tx) => {
                        await tx.property.update({ where: { id: existing.id }, data: propData });
                        await savePrices(tx, existing.id, req.user!.orgId, merged);
                    });
                    updated++;
                } else {
                    skipped++;
                }
                continue;
            }

            await prisma.$transaction(async (tx) => {
                const createdRow = await tx.property.create({
                    data: { ...propData, externalSource: 'csv', importedAt: new Date(), agentId: req.user!.userId, orgId: req.user!.orgId },
                });
                await savePrices(tx, createdRow.id, req.user!.orgId, priced.prices);
            });
            created++;
        }

        res.json({ created, updated, skipped, errors, warnings });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to import properties' });
    }
});

// GET /api/properties/geocode?q= — address search for placing the pin (Nominatim, 1 req/s, cached)
router.get('/geocode', async (req: AuthRequest, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 3) return res.status(400).json({ error: 'Write at least 3 characters' });
    try {
        res.json({ results: await geocode(q) });
    } catch (err) {
        console.error('[geocode]', err);
        res.status(502).json({ error: 'The address search is not available right now. Place the pin on the map by hand.' });
    }
});

// GET /api/properties/:id — single property with full details
router.get('/:id', async (req: AuthRequest, res) => {
    try {
        const orgId = req.user?.orgId;
        if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

        const property = await prisma.property.findFirst({
            where: { id: String(req.params.id), orgId },
            include: {
                agent:        { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
                mediaAssets:  { orderBy: { sortOrder: 'asc' } },
                prices:       true,
                transactions: {
                    include: { client: { select: { firstName: true, lastName: true } } },
                    orderBy:  { createdAt: 'desc' },
                },
                offers: {
                    include: { client: { select: { firstName: true, lastName: true } } },
                    orderBy: { createdAt: 'desc' },
                },
                appointments: {
                    where:   { status: { not: 'CANCELLED' } },
                    orderBy: { date: 'asc' },
                },
                propertyNotes: {
                    include: { author: { select: { name: true, avatarUrl: true } } },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        if (!property) return res.status(404).json({ error: 'Property not found' });
        res.json(property);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch property' });
    }
});

// Prices from a request: `prices` (list, one per operation) or, for older clients, a single `price` = sale price.
function pricesFromBody(body: any, defaultCurrency: string): { ok: true; prices: PriceInput[] | undefined } | { ok: false; error: string } {
    if (body.prices !== undefined) return parsePrices(body.prices, defaultCurrency);
    if (body.price === undefined) return { ok: true, prices: undefined };
    const n = parseAmount(body.price);
    if (n === 'invalid') return { ok: false, error: 'A valid price is required' };
    return parsePrices([{ operation: 'SALE', amount: n, currency: defaultCurrency, onRequest: n === null }], defaultCurrency);
}

const LEGACY_NUMBERS = ['sqft', 'yearBuilt', 'parkingSpaces', 'hoaFee'] as const;

// POST /api/properties — create property
// Required (spec 6.1): address or locality, city, type, at least one operation with a price or "Consultar".
router.post('/', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const b = req.body || {};

        if (!['SUPERADMIN', 'FIRMADMIN', 'MANAGER', 'AGENT'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Your role cannot create listings' });
        }
        const policy = req.user.policies.properties;
        if (policy.whoCanCreate === 'MANAGERS' && !isManager(req.user)) {
            return res.status(403).json({ error: 'Your brokerage only lets managers create listings' });
        }

        const address = typeof b.address === 'string' ? b.address.trim() : '';
        const localityIn = typeof b.locality === 'string' ? b.locality.trim() : '';
        if (!address && !localityIn) return res.status(400).json({ error: 'Address or locality is required' });
        if (typeof b.city !== 'string' || !b.city.trim()) return res.status(400).json({ error: 'city is required' });
        if (!validPropertyType(b.propertyType)) return res.status(400).json({ error: 'A valid property type is required' });
        if (b.virtualTourUrl && !/^https?:\/\//i.test(String(b.virtualTourUrl).trim())) {
            return res.status(400).json({ error: 'Virtual tour link must start with http:// or https://' });
        }

        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { defaultCurrency: true } });
        const pr = pricesFromBody(b, org?.defaultCurrency ?? 'USD');
        if (!pr.ok) return res.status(400).json({ error: pr.error });
        const prices = pr.prices ?? [];
        if (!prices.some(p => p.isActive)) return res.status(400).json({ error: 'Add at least one operation (sale or rent) with a price or "Consultar"', code: 'PRICE_REQUIRED' });

        const uy = parseUyFields(b, policy);
        if (!uy.ok) return res.status(400).json({ error: uy.error });
        const legacy: Record<string, number | null> = {};
        for (const f of LEGACY_NUMBERS) {
            if (b[f] === undefined || b[f] === '' || b[f] === null) continue;
            const n = optNumber(b[f]);
            if (n === undefined || n < 0) return res.status(400).json({ error: `Invalid ${f}` });
            legacy[f] = f === 'hoaFee' ? n : Math.round(n);
        }
        // garageSpaces replaces parkingSpaces: keep both in step
        if (uy.data.garageSpaces === undefined && legacy.parkingSpaces != null) uy.data.garageSpaces = legacy.parkingSpaces;
        if (legacy.parkingSpaces === undefined && uy.data.garageSpaces != null) legacy.parkingSpaces = uy.data.garageSpaces as number;

        const policyErr = listingPolicyError(policy, {
            sqft: legacy.sqft ?? null, propertyType: b.propertyType, neighborhood: b.neighborhood, description: b.description,
            yearBuilt: legacy.yearBuilt ?? null, ...uy.data, state: b.state,
        }, false, b.propertyType);
        if (policyErr) return res.status(400).json({ error: policyErr, code: 'LISTING_POLICY' });

        // A new listing has no photos, so with "photos before Active" it can only start as Coming Soon
        const needPhotos = policy.photosRequiredToActivate;
        const requestedStatus = PROP_STATUSES.includes(b.status) ? b.status : null;
        const finalStatus = requestedStatus ?? (needPhotos > 0 ? 'COMING_SOON' : 'ACTIVE');
        if (finalStatus === 'ACTIVE' && needPhotos > 0) {
            return res.status(400).json({ error: photosNeededMessage(needPhotos), code: 'PHOTOS_REQUIRED' });
        }

        const cities = await orgCityNames(req.user.orgId);
        const property = await prisma.$transaction(async (tx) => {
            const created = await tx.property.create({
                data: {
                    address,
                    city:          matchPlaceName(b.city, cities)!,
                    state:         typeof b.state === 'string' && b.state.trim() ? b.state.trim() : null,
                    zip:           typeof b.zip === 'string' && b.zip.trim() ? b.zip.trim() : null,
                    ...legacy,
                    ...uy.data,
                    locality:      localityIn ? matchPlaceName(localityIn, [])! : (uy.data.locality as string | null | undefined) ?? null,
                    description:   typeof b.description === 'string' ? b.description : null,
                    status:        finalStatus,
                    propertyType:  b.propertyType,
                    neighborhood:  typeof b.neighborhood === 'string' && b.neighborhood.trim() ? b.neighborhood.trim() : null,
                    mlsNumber:     typeof b.mlsNumber === 'string' && b.mlsNumber.trim() ? b.mlsNumber.trim() : null,
                    virtualTourUrl: b.virtualTourUrl || null,
                    listingDate:   b.listingDate ? new Date(b.listingDate) : null,
                    agentId:       req.user!.userId,
                    orgId:         req.user!.orgId,
                } as Prisma.PropertyUncheckedCreateInput,
            });
            await savePrices(tx, created.id, req.user!.orgId, prices);
            return tx.property.findUniqueOrThrow({ where: { id: created.id }, include: { prices: true } });
        });

        await audit(req, 'CREATE_PROPERTY', 'Property', property.id, undefined, {
            address: property.address, price: property.price, status: property.status,
            prices: property.prices.map(p => `${p.operation} ${p.onRequest ? 'consultar' : `${p.currency} ${p.amount}`}`).join('; '),
        });
        res.status(201).json(property);
    } catch (error: any) {
        if (error?.code === 'P2002') return res.status(409).json({ error: 'Another property of your brokerage already uses this code' });
        console.error(error);
        res.status(500).json({ error: 'Failed to create property' });
    }
});

// PATCH /api/properties/:id — update property (send only what changes; `prices` replaces the operations)
router.patch('/:id', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const b = req.body || {};

        // Verify ownership (agents can only edit own; managers can edit org)
        const existing = await prisma.property.findFirst({
            where: { id: String(req.params.id), orgId: req.user.orgId },
        });
        if (!existing) return res.status(404).json({ error: 'Property not found' });

        const canEdit = existing.agentId === req.user.userId ||
            ['FIRMADMIN', 'SUPERADMIN', 'MANAGER'].includes(req.user.role);
        if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

        const allowed = [
            'address','city','state','zip','sqft','description',
            'status','propertyType','neighborhood','yearBuilt','mlsNumber','hoaFee',
            'parkingSpaces','virtualTourUrl','featuredImage','featured','listingDate','expirationDate',
        ];
        const data: any = {};
        for (const key of allowed) {
            if (b[key] !== undefined) data[key] = b[key];
        }
        for (const f of ['virtualTourUrl', 'featuredImage']) {
            if (data[f] && !/^https?:\/\//i.test(String(data[f]).trim())) {
                return res.status(400).json({ error: `${f} must start with http:// or https://` });
            }
        }
        if (data.status !== undefined && !PROP_STATUSES.includes(data.status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        if (data.propertyType !== undefined && !validPropertyType(data.propertyType)) {
            return res.status(400).json({ error: 'A valid property type is required' });
        }
        for (const f of ['address', 'city']) {
            if (data[f] !== undefined && (typeof data[f] !== 'string' || (f === 'city' && !data[f].trim()))) {
                return res.status(400).json({ error: `${f} is required` });
            }
        }
        for (const f of ['state', 'zip']) {
            if (data[f] !== undefined) data[f] = typeof data[f] === 'string' && data[f].trim() ? data[f].trim() : null;
        }
        for (const f of ['sqft', 'yearBuilt', 'parkingSpaces', 'hoaFee']) {
            if (data[f] === undefined) continue;
            const n = optNumber(data[f]);
            data[f] = n === undefined ? null : (f === 'hoaFee' ? n : Math.round(n));
        }
        for (const f of ['listingDate', 'expirationDate']) {
            if (data[f] === undefined) continue;
            data[f] = optDate(data[f]) ?? null;
        }
        if (data.featured !== undefined) data.featured = data.featured === true || data.featured === 'true';
        if (typeof data.city === 'string') {
            data.city = matchPlaceName(data.city, await orgCityNames(req.user.orgId));
        }

        const policy = req.user.policies.properties;
        const uy = parseUyFields(b, policy);
        if (!uy.ok) return res.status(400).json({ error: uy.error });
        Object.assign(data, uy.data);
        if (typeof data.locality === 'string') data.locality = matchPlaceName(data.locality, []);
        if (data.garageSpaces !== undefined && data.parkingSpaces === undefined) data.parkingSpaces = data.garageSpaces;
        if (data.parkingSpaces !== undefined && data.garageSpaces === undefined) data.garageSpaces = data.parkingSpaces;
        const nextAddress = data.address !== undefined ? String(data.address).trim() : existing.address;
        const nextLocality = data.locality !== undefined ? data.locality : existing.locality;
        if (data.address !== undefined) data.address = nextAddress;
        if (!nextAddress && !nextLocality) return res.status(400).json({ error: 'Address or locality is required' });

        const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { defaultCurrency: true } });
        const pr = pricesFromBody(b, org?.defaultCurrency ?? 'USD');
        if (!pr.ok) return res.status(400).json({ error: pr.error });
        // A legacy `price` only updates the sale price; the other operations stay as they are
        let prices = pr.prices;
        if (prices && b.prices === undefined) {
            const current = await prisma.propertyPrice.findMany({ where: { propertyId: existing.id, orgId: req.user.orgId } });
            prices = [...current.filter(c => c.operation !== 'SALE').map(c => ({
                operation: c.operation, amount: c.amount, currency: c.currency, period: c.period, onRequest: c.onRequest, isActive: c.isActive,
            })), ...prices];
        }
        if (prices && !prices.some(p => p.isActive)) {
            return res.status(400).json({ error: 'Add at least one operation (sale or rent) with a price or "Consultar"', code: 'PRICE_REQUIRED' });
        }

        // Listing policy (Settings > Properties)
        const policyErr = listingPolicyError(policy, data, true, data.propertyType ?? existing.propertyType);
        if (policyErr) return res.status(400).json({ error: policyErr, code: 'LISTING_POLICY' });
        if (data.status === 'ACTIVE' && existing.status !== 'ACTIVE' && policy.photosRequiredToActivate > 0) {
            const photos = await prisma.mediaAsset.count({ where: { propertyId: existing.id, type: 'image' } });
            if (photos < policy.photosRequiredToActivate) {
                return res.status(400).json({
                    error: `${photosNeededMessage(policy.photosRequiredToActivate)} This listing has ${photos}.`,
                    code: 'PHOTOS_REQUIRED',
                });
            }
        }

        const updated = await prisma.$transaction(async (tx) => {
            await tx.property.update({ where: { id: existing.id }, data });
            if (prices) await savePrices(tx, existing.id, req.user!.orgId, prices);
            return tx.property.findUniqueOrThrow({ where: { id: existing.id }, include: { prices: true } });
        });
        const changes = diffFields(existing, { ...data, ...(prices ? { price: updated.price } : {}) });
        if (Object.keys(changes.after).length > 0) await audit(req, 'UPDATE_PROPERTY', 'Property', existing.id, changes.before, changes.after);
        res.json(updated);
    } catch (error: any) {
        if (error?.code === 'P2002') return res.status(409).json({ error: 'Another property of your brokerage already uses this code' });
        console.error(error);
        res.status(500).json({ error: 'Failed to update property' });
    }
});

// DELETE /api/properties/:id — soft-delete (set status to WITHDRAWN)
router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const existing = await prisma.property.findFirst({
            where: { id: String(req.params.id), orgId: req.user.orgId },
        });
        if (!existing) return res.status(404).json({ error: 'Property not found' });

        const canDelete = existing.agentId === req.user.userId ||
            ['FIRMADMIN', 'SUPERADMIN', 'MANAGER'].includes(req.user.role);
        if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

        await prisma.property.update({
            where: { id: String(req.params.id) },
            data:  { status: 'WITHDRAWN' },
        });
        await audit(req, 'WITHDRAW_PROPERTY', 'Property', existing.id, { status: existing.status }, { status: 'WITHDRAWN' });
        res.json({ message: 'Property withdrawn' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete property' });
    }
});

export default router;
