import express from 'express';
import { prisma } from '../server';
import { orgLocale, formatAmount } from '../lib/messages';
import { AuthRequest } from '../middleware/authMiddleware';
import { createNotification } from './notifications';
import { checkRefs, isManager, optDate, optNumber, pickEnum } from '../lib/access';
import { createClosingChecklist, onTransactionStatusChange } from '../lib/deals';
import { audit, diffFields } from '../lib/audit';

const router = express.Router();
const STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'COUNTER', 'WITHDRAWN', 'EXPIRED'] as const;
const WRITE_ROLES = ['SUPERADMIN', 'FIRMADMIN', 'MANAGER', 'AGENT'];

// GET /api/offers?propertyId=&status=
router.get('/', async (req: AuthRequest, res) => {
    const user = req.user!;
    const where: any = { orgId: user.orgId };
    // Agents see offers they submitted and offers made on their own listings
    if (!isManager(user)) where.OR = [{ agentId: user.userId }, { property: { agentId: user.userId } }];
    if (typeof req.query.propertyId === 'string') where.propertyId = req.query.propertyId;
    const status = pickEnum(req.query.status, STATUSES);
    if (status) where.status = status;

    const offers = await prisma.offer.findMany({
        where,
        include: {
            property: { select: { id: true, address: true, city: true, price: true } },
            client:   { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
    });
    res.json(offers);
});

// POST /api/offers
router.post('/', async (req: AuthRequest, res) => {
    const user = req.user!;
    if (!WRITE_ROLES.includes(user.role)) return res.status(403).json({ error: 'Your role cannot submit offers' });

    const { propertyId, clientId, notes } = req.body;
    const amount = optNumber(req.body.amount);
    if (!propertyId || !clientId) return res.status(400).json({ error: 'Property and client are required' });
    if (amount === undefined || amount <= 0) return res.status(400).json({ error: 'A valid offer amount is required' });
    const refErr = await checkRefs(user.orgId, { propertyId, clientId });
    if (refErr) return res.status(400).json({ error: refErr });

    const offer = await prisma.offer.create({
        data: {
            amount, propertyId, clientId,
            notes: typeof notes === 'string' ? notes : null,
            expiresAt: optDate(req.body.expiresAt) ?? null,
            agentId: user.userId, orgId: user.orgId, status: 'PENDING',
        },
        include: { property: { select: { address: true, agentId: true } } },
    });

    // Tell the listing agent (if it's someone else) that an offer came in
    const listingAgent = offer.property.agentId;
    const { m, lang } = await orgLocale(user.orgId);
    await createNotification(
        listingAgent, user.orgId, 'OFFER_RECEIVED', m.offerReceived,
        m.offerReceivedDetail(`$ ${formatAmount(amount, lang)}`, offer.property.address), '/transactions',
    );
    await prisma.client.updateMany({
        where: { id: clientId, funnelStage: { in: ['LEAD', 'QUALIFIED', 'SHOWING'] } },
        data: { funnelStage: 'OFFERING' },
    });
    await audit(req, 'CREATE_OFFER', 'Offer', offer.id, undefined, { amount, propertyId, clientId });
    res.status(201).json(offer);
});

// PATCH /api/offers/:id — respond: accept / reject / counter / withdraw
router.patch('/:id', async (req: AuthRequest, res) => {
    const user = req.user!;
    const offer = await prisma.offer.findFirst({
        where: { id: String(req.params.id), orgId: user.orgId },
        include: { property: true },
    });
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    const allowed = isManager(user) || offer.agentId === user.userId || offer.property.agentId === user.userId;
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const status = pickEnum(req.body.status, STATUSES);
    if (req.body.status !== undefined && !status) return res.status(400).json({ error: 'Invalid status' });
    const counterAmount = optNumber(req.body.counterAmount);
    if (status === 'COUNTER' && counterAmount === undefined) {
        return res.status(400).json({ error: 'Counter amount is required' });
    }

    const data: any = {};
    if (status) data.status = status;
    if (counterAmount !== undefined) data.counterAmount = counterAmount;
    if (typeof req.body.notes === 'string') data.notes = req.body.notes;
    const expiresAt = optDate(req.body.expiresAt);
    if (expiresAt !== undefined) data.expiresAt = expiresAt;

    const updated = await prisma.offer.update({ where: { id: offer.id }, data });
    const changes = diffFields(offer, data);
    if (Object.keys(changes.after).length > 0) await audit(req, 'UPDATE_OFFER', 'Offer', offer.id, changes.before, changes.after);

    let transaction = null;
    if (status && status !== offer.status) {
        const type = status === 'ACCEPTED' ? 'OFFER_ACCEPTED' : status === 'REJECTED' ? 'OFFER_REJECTED' : 'SYSTEM';
        const { m, lang } = await orgLocale(offer.orgId);
        await createNotification(
            offer.agentId, offer.orgId, type, m.offerResult(status),
            m.offerResultDetail(`$ ${formatAmount(offer.amount, lang)}`, offer.property.address, status),
            '/transactions',
        );

        // Accepting an offer opens the deal (unless one already exists for this buyer + property)
        if (status === 'ACCEPTED') {
            const open = await prisma.transaction.findFirst({
                where: { propertyId: offer.propertyId, clientId: offer.clientId, orgId: offer.orgId, status: { not: 'FALLEN_THROUGH' } },
            });
            if (!open) {
                const acceptedPrice = updated.counterAmount ?? offer.amount;
                transaction = await prisma.transaction.create({
                    data: {
                        propertyId: offer.propertyId, clientId: offer.clientId,
                        agentId: offer.agentId, orgId: offer.orgId,
                        price: acceptedPrice, acceptedPrice, status: 'IN_CONTRACT', contractDate: new Date(),
                    },
                });
                await createClosingChecklist(transaction);
                await onTransactionStatusChange(transaction, null);
            }
        }
    }
    res.json({ ...updated, transaction });
});

export default router;
