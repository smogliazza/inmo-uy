import { Router } from 'express';
import { prisma } from '../server';
import rateLimit from 'express-rate-limit';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { optDate, optNumber, isManager } from '../lib/access';
import { OrgPolicies, missingListingField, descriptionTooLong } from '../lib/policies';
import { createNotification } from './notifications';
import { resolveLeadAssignee } from '../lib/routing';
import { getOrgModules, sendModuleDisabled } from '../lib/modules';
import { normalizePhoneUY, matchPlaceName } from '../lib/uy';
import { orgLocale } from '../lib/messages';

// City names already used by the brokerage, so new ones reuse the same spelling (accent/case-insensitive)
async function orgCityNames(orgId: string): Promise<string[]> {
    const rows = await prisma.property.findMany({ where: { orgId }, distinct: ['city'], select: { city: true } });
    return rows.map(r => r.city).filter((c): c is string => Boolean(c));
}
import { audit, diffFields } from '../lib/audit';

const router = Router();

const PROP_STATUSES = ['COMING_SOON', 'ACTIVE', 'IN_CONTRACT', 'SOLD', 'WITHDRAWN', 'EXPIRED'];

// Listing policy (Settings > Properties): the first rule a listing breaks, or null.
function listingPolicyError(policy: OrgPolicies['properties'], fields: Record<string, unknown>, onlyPresent: boolean): string | null {
    return missingListingField(policy, fields, onlyPresent)
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
    virtualTourUrl: true,
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
        where: { orgId: organization.id, status: { in: ['ACTIVE', 'COMING_SOON', 'IN_CONTRACT'] } },
        take: 100,
        orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
        select: {
            id: true, address: true, city: true, state: true, zip: true, price: true,
            beds: true, baths: true, sqft: true, status: true,
            mediaAssets: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
        },
    });

    const { id: _orgId, ...org } = organization;
    res.json({
        organization: org,
        ...(redirectedFrom ? { redirectedFrom, canonicalSlug: org.slug } : {}),
        listings: properties.map(({ mediaAssets, ...p }) => ({ ...p, imageUrl: mediaAssets[0]?.url ?? null })),
    });
});

// GET /api/properties/public/:id — public listing page
router.get('/public/:id', async (req, res) => {
    const property = await prisma.property.findFirst({
        where: { id: String(req.params.id), status: { in: ['ACTIVE', 'COMING_SOON', 'IN_CONTRACT'] } },
        select: { ...PUBLIC_SELECT, orgId: true },
    });
    if (!property) return res.status(404).json({ error: 'Listing not found' });
    if (!(await getOrgModules(property.orgId)).publicSite.enabled) return sendModuleDisabled(res, 'publicSite');
    const { orgId: _orgId, ...listing } = property;
    res.json(listing);
});

// POST /api/properties/public/:id/inquiry — website / open-house lead capture.
// Creates (or updates) a HOT lead for the listing agent, logs the message,
// and drops a "call back now" task — speed-to-lead matters most.
router.post('/public/:id/inquiry', inquiryLimiter, async (req, res) => {
    const clean = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const name = clean(req.body.name, 120);
    const email = clean(req.body.email, 200).toLowerCase();
    const phone = normalizePhoneUY(clean(req.body.phone, 40)) || '';
    const message = clean(req.body.message, 2000);
    const source = req.body.source === 'OPEN_HOUSE' ? 'Puertas abiertas' : 'Sitio web';
    // Honeypot field: real users never fill it in
    if (clean(req.body.website)) return res.status(201).json({ ok: true });

    if (!name) return res.status(400).json({ error: 'Please enter your name' });
    if (!email && !phone) return res.status(400).json({ error: 'Please enter an email or phone number' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

    const property = await prisma.property.findFirst({
        where: { id: String(req.params.id), status: { in: ['ACTIVE', 'COMING_SOON', 'IN_CONTRACT'] } },
    });
    if (!property) return res.status(404).json({ error: 'Listing not found' });
    const modules = await getOrgModules(property.orgId);
    if (!modules.publicSite.enabled) return sendModuleDisabled(res, 'publicSite');

    // With lead routing off, the inquiry goes straight to the listing agent.
    const assignedAgentId = modules.leadRouting.enabled
        ? (await resolveLeadAssignee({
            orgId: property.orgId,
            source,
            city: property.city,
            propertyType: property.propertyType,
            price: property.price,
            listingAgentId: property.agentId,
        })).agentId
        : property.agentId;

    const [firstName, ...rest] = name.split(/\s+/);
    const or: any[] = [];
    if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
    if (phone) or.push({ phone });
    let client = await prisma.client.findFirst({ where: { orgId: property.orgId, OR: or } });
    const isNew = !client;
    if (!client) {
        client = await prisma.client.create({
            data: {
                firstName, lastName: rest.join(' '),
                email: email || null, phone: phone || null,
                type: 'BUYER', status: 'LEAD', funnelStage: 'LEAD', temperature: 'HOT',
                source, agentId: assignedAgentId, orgId: property.orgId,
            },
        });
    } else {
        await prisma.client.update({ where: { id: client.id }, data: { temperature: 'HOT' } });
    }

    const targetAgentId = isNew ? assignedAgentId : client.agentId;
    const { m } = await orgLocale(property.orgId);

    await prisma.note.create({
        data: {
            type: 'NOTE',
            content: m.inquiryNote(source, property.address, message),
            clientId: client.id, propertyId: property.id,
            authorId: targetAgentId, orgId: property.orgId,
        },
    });
    if (modules.tasks.enabled) await prisma.task.create({
        data: {
            title: m.callBackTask(name, property.address),
            priority: 'URGENT', dueDate: new Date(Date.now() + 15 * 60 * 1000),
            linkedClientId: client.id, linkedPropertyId: property.id,
            agentId: targetAgentId, orgId: property.orgId,
        },
    });
    await createNotification(
        targetAgentId, property.orgId, 'NEW_CLIENT',
        isNew ? m.newLead(source) : m.returningLead(name),
        m.leadDetail(name, property.address),
        `/crm/${client.id}`,
    );
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
        for (let i = 0; i < rows.length; i++) {
            const raw = rows[i] || {};
            const address = typeof raw.address === 'string' ? raw.address.trim() : '';
            const city    = matchPlaceName(typeof raw.city === 'string' && raw.city.trim() ? raw.city : 'New York', knownCities)!;
            if (!knownCities.includes(city)) knownCities.push(city);
            const state   = typeof raw.state === 'string' && raw.state.trim() ? raw.state.trim() : 'NY';
            const zip     = typeof raw.zip === 'string' && raw.zip.trim() ? raw.zip.trim() : '10001';
            if (!address) {
                errors.push({ row: i + 1, reason: 'Address is required' });
                continue;
            }

            const nPrice = optNumber(String(raw.price ?? '').replace(/[$,\s]/g, ''));
            const nBeds  = optNumber(raw.beds ?? 1);
            const nBaths = optNumber(raw.baths ?? 1);
            if (nPrice === undefined || nPrice < 0) {
                errors.push({ row: i + 1, reason: 'Valid price is required' });
                continue;
            }

            const mlsNumber = typeof raw.mlsNumber === 'string' && raw.mlsNumber.trim() ? raw.mlsNumber.trim() : null;
            const statusRaw = typeof raw.status === 'string' ? raw.status.trim().toUpperCase().replace(/\s+/g, '_') : 'ACTIVE';
            let status = PROP_STATUSES.includes(statusRaw) ? statusRaw : 'ACTIVE';
            // A new listing has no photos yet, so under a "photos before Active" policy it starts as Coming Soon
            const needPhotos = policy.photosRequiredToActivate;
            const downgraded = needPhotos > 0 && status === 'ACTIVE';
            if (downgraded) status = 'COMING_SOON';

            const orCond: any[] = [{ address: { equals: address, mode: 'insensitive' }, zip }];
            if (mlsNumber) orCond.unshift({ mlsNumber: { equals: mlsNumber, mode: 'insensitive' } });

            const existing = await prisma.property.findFirst({
                where: { orgId: req.user.orgId, OR: orCond },
                select: { id: true, agentId: true },
            });

            const propData: any = {
                address, city, state, zip,
                price: nPrice,
                beds: nBeds ?? 1,
                baths: nBaths ?? 1,
                sqft: optNumber(String(raw.sqft ?? '').replace(/,/g, '')) ? Math.round(optNumber(String(raw.sqft ?? '').replace(/,/g, ''))!) : null,
                status,
                propertyType: typeof raw.propertyType === 'string' && raw.propertyType.trim() ? raw.propertyType.trim().toUpperCase() : 'CONDO',
                neighborhood: typeof raw.neighborhood === 'string' && raw.neighborhood.trim() ? raw.neighborhood.trim() : null,
                mlsNumber,
                description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null,
            };

            const policyErr = listingPolicyError(policy, {
                sqft: propData.sqft, propertyType: propData.propertyType, neighborhood: propData.neighborhood,
                description: propData.description, yearBuilt: raw.yearBuilt ? Number(raw.yearBuilt) : null,
            }, false);
            if (policyErr) {
                errors.push({ row: i + 1, reason: policyErr });
                continue;
            }
            // Tell the user about the change only for rows that were actually imported
            if (downgraded) warnings.push({ row: i + 1, reason: `Imported as Coming Soon: ${needPhotos} photo${needPhotos === 1 ? '' : 's'} needed before it can go Active` });

            if (existing) {
                const canEdit = existing.agentId === req.user.userId || ['FIRMADMIN', 'SUPERADMIN', 'MANAGER'].includes(req.user.role);
                if (onDuplicate === 'update' && canEdit) {
                    // Updating an existing listing never downgrades an Active one just because of the photo policy
                    await prisma.property.update({ where: { id: existing.id }, data: propData });
                    updated++;
                } else {
                    skipped++;
                }
                continue;
            }

            await prisma.property.create({
                data: {
                    ...propData,
                    agentId: req.user.userId,
                    orgId: req.user.orgId,
                },
            });
            created++;
        }

        res.json({ created, updated, skipped, errors, warnings });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to import properties' });
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

// POST /api/properties — create property
router.post('/', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const { address, city, state, zip, price, beds, baths, sqft, status,
                description, propertyType, neighborhood, yearBuilt, mlsNumber,
                hoaFee, parkingSpaces, virtualTourUrl, listingDate } = req.body;

        if (!['SUPERADMIN', 'FIRMADMIN', 'MANAGER', 'AGENT'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Your role cannot create listings' });
        }
        const policy = req.user.policies.properties;
        if (policy.whoCanCreate === 'MANAGERS' && !isManager(req.user)) {
            return res.status(403).json({ error: 'Your brokerage only lets managers create listings' });
        }
        for (const [k, v] of Object.entries({ address, city, state, zip })) {
            if (typeof v !== 'string' || !v.trim()) return res.status(400).json({ error: `${k} is required` });
        }
        if (virtualTourUrl && !/^https?:\/\//i.test(String(virtualTourUrl).trim())) {
            return res.status(400).json({ error: 'Virtual tour link must start with http:// or https://' });
        }
        const nPrice = optNumber(price), nBeds = optNumber(beds), nBaths = optNumber(baths);
        if (nPrice === undefined || nPrice < 0) return res.status(400).json({ error: 'A valid price is required' });
        if (nBeds === undefined || nBaths === undefined) return res.status(400).json({ error: 'Beds and baths are required' });

        const policyErr = listingPolicyError(policy, {
            sqft: optNumber(sqft) ?? null, propertyType, neighborhood, description, yearBuilt: optNumber(yearBuilt) ?? null,
        }, false);
        if (policyErr) return res.status(400).json({ error: policyErr, code: 'LISTING_POLICY' });

        // A new listing has no photos, so with "photos before Active" it can only start as Coming Soon
        const needPhotos = policy.photosRequiredToActivate;
        const requestedStatus = PROP_STATUSES.includes(status) ? status : null;
        const finalStatus = requestedStatus ?? (needPhotos > 0 ? 'COMING_SOON' : 'ACTIVE');
        if (finalStatus === 'ACTIVE' && needPhotos > 0) {
            return res.status(400).json({ error: photosNeededMessage(needPhotos), code: 'PHOTOS_REQUIRED' });
        }

        const property = await prisma.property.create({
            data: {
                address: address.trim(), city: matchPlaceName(city, await orgCityNames(req.user.orgId))!, state: state.trim(), zip: zip.trim(),
                price:         nPrice,
                beds:          nBeds,
                baths:         nBaths,
                sqft:          sqft          ? parseInt(sqft)          : null,
                yearBuilt:     yearBuilt     ? parseInt(yearBuilt)     : null,
                parkingSpaces: parkingSpaces ? parseInt(parkingSpaces) : null,
                hoaFee:        hoaFee        ? parseFloat(hoaFee)      : null,
                description,
                status:        finalStatus,
                propertyType,
                neighborhood,
                mlsNumber,
                virtualTourUrl,
                listingDate:   listingDate ? new Date(listingDate) : null,
                agentId:       req.user.userId,
                orgId:         req.user.orgId,
            },
        });

        await audit(req, 'CREATE_PROPERTY', 'Property', property.id, undefined, { address: property.address, price: property.price, status: property.status });
        res.status(201).json(property);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create property' });
    }
});

// PATCH /api/properties/:id — update property
router.patch('/:id', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        // Verify ownership (agents can only edit own; managers can edit org)
        const existing = await prisma.property.findFirst({
            where: { id: String(req.params.id), orgId: req.user.orgId },
        });
        if (!existing) return res.status(404).json({ error: 'Property not found' });

        const canEdit = existing.agentId === req.user.userId ||
            ['FIRMADMIN', 'SUPERADMIN', 'MANAGER'].includes(req.user.role);
        if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

        const allowed = [
            'address','city','state','zip','price','beds','baths','sqft','description',
            'status','propertyType','neighborhood','yearBuilt','mlsNumber','hoaFee',
            'parkingSpaces','virtualTourUrl','featuredImage','featured','listingDate','expirationDate',
        ];
        const data: any = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) data[key] = req.body[key];
        }
        for (const f of ['virtualTourUrl', 'featuredImage']) {
            if (data[f] && !/^https?:\/\//i.test(String(data[f]).trim())) {
                return res.status(400).json({ error: `${f} must start with http:// or https://` });
            }
        }
        if (data.status !== undefined && !PROP_STATUSES.includes(data.status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        for (const f of ['price', 'beds', 'baths']) {
            if (data[f] === undefined) continue;
            const n = optNumber(data[f]);
            if (n === undefined || n < 0) return res.status(400).json({ error: `Invalid ${f}` });
            data[f] = n;
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
            const city = matchPlaceName(data.city, await orgCityNames(req.user.orgId));
            if (!city) return res.status(400).json({ error: 'city is required' });
            data.city = city;
        }

        // Listing policy (Settings > Properties)
        const policy = req.user.policies.properties;
        const policyErr = listingPolicyError(policy, data, true);
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

        const updated = await prisma.property.update({ where: { id: String(req.params.id) }, data });
        const changes = diffFields(existing, data);
        if (Object.keys(changes.after).length > 0) await audit(req, 'UPDATE_PROPERTY', 'Property', existing.id, changes.before, changes.after);
        res.json(updated);
    } catch (error) {
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
