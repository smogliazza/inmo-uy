import express from 'express';
import { prisma } from '../server';
import { orgLocale } from '../lib/messages';
import { AuthRequest } from '../middleware/authMiddleware';
import { checkRefs, isManager, optNumber } from '../lib/access';
import { createNotification } from './notifications';

const router = express.Router();
const STATUSES = ['PENDING', 'ACCEPTED', 'PAID', 'DECLINED'];

// GET /api/referrals — referrals I sent or received (managers: whole org)
router.get('/', async (req: AuthRequest, res) => {
    const user = req.user!;
    const where: any = { orgId: user.orgId };
    if (!isManager(user)) where.OR = [{ referrerId: user.userId }, { refereeId: user.userId }];
    const referrals = await prisma.referral.findMany({
        where,
        include: {
            referrer: { select: { id: true, name: true } },
            referee:  { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
    });
    res.json(referrals);
});

// POST /api/referrals — refer business to a colleague in the brokerage
router.post('/', async (req: AuthRequest, res) => {
    const user = req.user!;
    const refereeId = req.body.refereeId;
    if (!refereeId) return res.status(400).json({ error: 'Choose an agent to refer to' });
    if (refereeId === user.userId) return res.status(400).json({ error: 'You cannot refer to yourself' });
    const refErr = await checkRefs(user.orgId, { userId: refereeId });
    if (refErr) return res.status(400).json({ error: 'Agent not found' });
    const referral = await prisma.referral.create({
        data: {
            referrerId: user.userId, refereeId,
            feeAmount: optNumber(req.body.feeAmount) ?? null,
            notes: typeof req.body.notes === 'string' ? req.body.notes : null,
            status: 'PENDING', orgId: user.orgId,
        },
    });
    const { m } = await orgLocale(user.orgId);
    await createNotification(refereeId, user.orgId, 'SYSTEM', m.newReferral, m.newReferralDetail, '/services');
    res.status(201).json(referral);
});

// PATCH /api/referrals/:id — referee accepts/declines; management marks paid
router.patch('/:id', async (req: AuthRequest, res) => {
    const user = req.user!;
    const ref = await prisma.referral.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!ref) return res.status(404).json({ error: 'Referral not found' });
    const status = STATUSES.includes(req.body.status) ? req.body.status : undefined;
    if (!status) return res.status(400).json({ error: 'Invalid status' });
    if (status === 'PAID' && !isManager(user)) return res.status(403).json({ error: 'Only management can mark referrals paid' });
    if (status !== 'PAID' && ref.refereeId !== user.userId && !isManager(user)) return res.status(403).json({ error: 'Forbidden' });
    res.json(await prisma.referral.update({ where: { id: ref.id }, data: { status } }));
});

export default router;
