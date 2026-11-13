import express from 'express';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/authMiddleware';
import { isManager } from '../lib/access';
import { deleteUploadedFile } from '../lib/storage';
import { createWebpVariants, variantKeys } from '../lib/images';

const router = express.Router();
const TYPES = ['image', 'video', 'floorplan', '3d_tour'];

function normalizeMediaType(raw: unknown): string {
    if (typeof raw !== 'string') return 'image';
    const lower = raw.trim().toLowerCase();
    return TYPES.includes(lower) ? lower : 'image';
}

// GET /api/media?propertyId=
router.get('/', async (req: AuthRequest, res) => {
    const where: any = { orgId: req.user!.orgId };
    if (typeof req.query.propertyId === 'string') where.propertyId = req.query.propertyId;
    const media = await prisma.mediaAsset.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    res.json(media);
});

// POST /api/media — attach an uploaded photo/floorplan or external video/photo link to a listing
router.post('/', async (req: AuthRequest, res) => {
    const user = req.user!;
    const { url, propertyId, caption, storageKey, sizeBytes, mimeType } = req.body;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
        return res.status(400).json({ error: 'A valid http(s) link is required' });
    }
    if (!propertyId) return res.status(400).json({ error: 'Property is required' });
    const property = await prisma.property.findFirst({ where: { id: propertyId, orgId: user.orgId } });
    if (!property) return res.status(400).json({ error: 'Property not found' });
    if (property.agentId !== user.userId && !isManager(user)) return res.status(403).json({ error: 'Forbidden' });
    const count = await prisma.mediaAsset.count({ where: { propertyId } });
    // Listing policy: a cap on photos per listing (videos, floor plans and tours are not photos)
    const maxPhotos = user.policies.properties.maxPhotosPerListing;
    if (maxPhotos > 0 && normalizeMediaType(req.body.type) === 'image') {
        const photos = await prisma.mediaAsset.count({ where: { propertyId, type: 'image' } });
        if (photos >= maxPhotos) {
            return res.status(400).json({ error: `This listing already has ${photos} photos; your brokerage allows at most ${maxPhotos} per listing`, code: 'PHOTO_LIMIT' });
        }
    }
    const media = await prisma.mediaAsset.create({
        data: {
            url: url.trim(),
            type: normalizeMediaType(req.body.type),
            caption: typeof caption === 'string' ? caption : null,
            sortOrder: count,
            sizeBytes: typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) ? Math.round(sizeBytes) : null,
            mimeType: typeof mimeType === 'string' ? mimeType : null,
            storageKey: typeof storageKey === 'string' && storageKey.trim() ? storageKey.trim() : null,
            propertyId,
            orgId: user.orgId,
        },
    });
    // Uploaded photos (not external links) get WebP copies in 3 sizes; the original stays as it was
    if (media.type === 'image' && media.storageKey) {
        const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() || req.protocol;
        const base = `${proto}://${req.get('host') || 'localhost:4000'}`;
        const made = await createWebpVariants(media.storageKey, user.orgId, id => `${base}/api/uploads/public/${id}`);
        if (made) {
            const withVariants = await prisma.mediaAsset.update({
                where: { id: media.id },
                data: { variants: made.variants as any, width: made.width || null, height: made.height || null },
            });
            return res.status(201).json(withVariants);
        }
    }
    res.status(201).json(media);
});

// PATCH /api/media/reorder — update sortOrder of photos for a listing (first photo = cover photo)
router.patch('/reorder', async (req: AuthRequest, res) => {
    const user = req.user!;
    const { propertyId, orderedIds } = req.body;
    if (typeof propertyId !== 'string' || !Array.isArray(orderedIds) || orderedIds.length === 0) {
        return res.status(400).json({ error: 'propertyId and orderedIds array are required' });
    }
    const property = await prisma.property.findFirst({ where: { id: propertyId, orgId: user.orgId } });
    if (!property) return res.status(404).json({ error: 'Property not found' });
    if (property.agentId !== user.userId && !isManager(user)) return res.status(403).json({ error: 'Forbidden' });

    const assets = await prisma.mediaAsset.findMany({ where: { propertyId, orgId: user.orgId } });
    const validIds = new Set(assets.map(a => a.id));
    const updates = orderedIds
        .filter((id): id is string => typeof id === 'string' && validIds.has(id))
        .map((id, idx) => prisma.mediaAsset.update({ where: { id }, data: { sortOrder: idx } }));

    await prisma.$transaction(updates);
    const updated = await prisma.mediaAsset.findMany({
        where: { propertyId, orgId: user.orgId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(updated);
});

// DELETE /api/media/:id
router.delete('/:id', async (req: AuthRequest, res) => {
    const user = req.user!;
    const media = await prisma.mediaAsset.findFirst({
        where: { id: String(req.params.id), orgId: user.orgId },
        include: { property: true },
    });
    if (!media) return res.status(404).json({ error: 'Media not found' });
    if (media.property.agentId !== user.userId && !isManager(user)) return res.status(403).json({ error: 'Forbidden' });
    await prisma.mediaAsset.delete({ where: { id: media.id } });
    if (media.storageKey) {
        await deleteUploadedFile(media.storageKey, user.orgId);
    }
    for (const key of variantKeys(media.variants)) await deleteUploadedFile(key, user.orgId);
    res.json({ message: 'Media deleted' });
});

export default router;
