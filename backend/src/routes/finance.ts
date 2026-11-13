import express from 'express';
import { prisma } from '../server';
import { orgLocale, formatAmount } from '../lib/messages';
import { AuthRequest, requireTier, authorizeRole } from '../middleware/authMiddleware';
import { audit } from '../lib/audit';
import { createNotification } from './notifications';
import { fiscalYearStart } from '../lib/policies';
import { isManager } from '../lib/access';

// Separation of duties: nobody approves their own payout — unless they are the
// only manager in the brokerage (solo broker), otherwise it could never be paid.
async function isSoleApprover(orgId: string, userId: string) {
    const others = await prisma.user.count({
        where: { orgId, isActive: true, id: { not: userId }, role: { in: ['SUPERADMIN', 'FIRMADMIN', 'MANAGER'] } },
    });
    return others === 0;
}

const router = express.Router();

// GET /api/finance/metrics
// Gets the high-level YTD metrics and firm leaderboard for the current user
router.get('/metrics', async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.userId;
        const orgId = req.user?.orgId;
        if (!userId || !orgId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 1. Calculate YTD Gross Written and Net Payout for the current user
        // "Year to date" starts at the brokerage's fiscal year (Settings > Finance); January by default
        const financePolicy = req.user!.policies.finance;
        const startOfYear = fiscalYearStart(new Date(), financePolicy.fiscalYearStartMonth);

        const userCommissions = await prisma.commission.findMany({
            where: {
                agentId: userId,
                orgId: orgId,
                status: 'PAID', // Only count paid commissions
                paidAt: {
                    gte: startOfYear
                }
            }
        });

        const ytdGross = userCommissions.reduce((sum: number, comm: any) => sum + comm.grossAmount, 0);
        const ytdNet = userCommissions.reduce((sum: number, comm: any) => sum + comm.netPayout, 0);

        // 2. Fetch Firm Leaderboard (Mocking ranks based on DB gross amounts)
        // Group commissions by agentId
        const allCommissions = await prisma.commission.findMany({
            where: {
                orgId: orgId,
                status: 'PAID',
                paidAt: { gte: startOfYear }
            },
            include: { agent: true }
        });

        const agentTotals: Record<string, { name: string, gross: number, userId: string }> = {};
        allCommissions.forEach((comm: any) => {
            if (!agentTotals[comm.agentId]) {
                agentTotals[comm.agentId] = { name: comm.agent.name, gross: 0, userId: comm.agentId };
            }
            agentTotals[comm.agentId].gross += comm.grossAmount;
        });

        // Finance policy: the brokerage can hide other agents' production. Management always sees it.
        const grossHidden = !financePolicy.showAgentGross && !isManager(req.user!);
        const leaderboard = Object.values(agentTotals)
            .sort((a, b) => b.gross - a.gross)
            .map((agent, index) => ({
                rank: index + 1,
                name: agent.name,
                gross: grossHidden && agent.userId !== userId ? null : agent.gross,
                userId: agent.userId
            }));

        // Determine user's rank
        const userRankIndex = leaderboard.findIndex(l => l.userId === req.user?.userId);
        let topPercent = 'N/A';
        if (userRankIndex !== -1 && leaderboard.length > 0) {
            const percent = ((userRankIndex + 1) / leaderboard.length) * 100;
            topPercent = `Top ${Math.ceil(percent)}%`;
        }

        res.json({
            ytdGross,
            ytdNet,
            topPercent,
            grossHidden,
            leaderboard: leaderboard.slice(0, 5), // Top 5
            userRank: userRankIndex !== -1 ? leaderboard[userRankIndex] : null
        });

    } catch (error) {
        console.error('Error fetching finance metrics:', error);
        res.status(500).json({ error: 'Failed to fetch finance metrics' });
    }
});

// GET /api/finance/commissions
// Gets the paginated waterfall details for the current user
// Every agent can see their own commissions (needed to request a payout); projections stay ELITE
router.get('/commissions', async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.userId;
        const orgId = req.user?.orgId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        if (!userId || !orgId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const [commissions, total] = await Promise.all([
            prisma.commission.findMany({
                where: { agentId: userId, orgId: orgId },
                include: {
                    transaction: {
                        include: {
                            property: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.commission.count({ where: { agentId: userId, orgId: orgId } })
        ]);

        res.json({
            data: commissions,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });

    } catch (error) {
        console.error('Error fetching commissions:', error);
        res.status(500).json({ error: 'Failed to fetch commissions' });
    }
});

// POST /api/finance/commissions/:id/payout
// Agent submits a payout REQUEST — an org admin must approve it before it becomes PAID
router.post('/commissions/:id/payout', async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.userId;
        const orgId = req.user?.orgId;
        const commId = String(req.params.id);

        if (!userId || !orgId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const commission = await prisma.commission.findUnique({
            where: { id: commId }
        });

        if (!commission || commission.agentId !== userId || commission.orgId !== orgId) {
            return res.status(404).json({ error: 'Commission not found or unauthorized' });
        }

        if (commission.status === 'PAID') {
            return res.status(400).json({ error: 'Commission is already paid' });
        }
        if (commission.status === 'REQUESTED') {
            return res.status(400).json({ error: 'Payout already requested — awaiting admin approval' });
        }

        const updated = await prisma.commission.update({
            where: { id: commId },
            data:  { status: 'REQUESTED' }
        });

        res.json(updated);
    } catch (error) {
        console.error('Error requesting payout:', error);
        res.status(500).json({ error: 'Failed to request payout' });
    }
});

// GET /api/finance/payout-requests — pending approvals queue for admins
router.get('/payout-requests', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const requests = await prisma.commission.findMany({
            where:   { orgId: req.user.orgId, status: 'REQUESTED' },
            include: {
                agent:       { select: { id: true, name: true, email: true } },
                transaction: { include: { property: { select: { address: true } } } },
            },
            orderBy: { updatedAt: 'desc' },
        });

        // Tell the UI which requests this reviewer may act on, using the same rule the
        // approve/reject endpoints enforce: not your own — unless you are the only approver.
        const sole = await isSoleApprover(req.user.orgId, req.user.userId);
        res.json(requests.map((r) => ({ ...r, canReview: r.agentId !== req.user!.userId || sole })));
    } catch (error) {
        console.error('Error fetching payout requests:', error);
        res.status(500).json({ error: 'Failed to fetch payout requests' });
    }
});

// POST /api/finance/commissions/:id/approve — admin approves a payout request → PAID
router.post('/commissions/:id/approve', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const commId = String(req.params.id);

        const commission = await prisma.commission.findFirst({
            where: { id: commId, orgId: req.user.orgId },
        });
        if (!commission) return res.status(404).json({ error: 'Commission not found' });
        if (commission.agentId === req.user.userId && !(await isSoleApprover(req.user.orgId, req.user.userId))) {
            return res.status(403).json({ error: 'You cannot approve your own payout request' });
        }
        if (commission.status !== 'REQUESTED') {
            return res.status(400).json({ error: `Cannot approve a commission in ${commission.status} status` });
        }

        // Conditional update so two concurrent approvals cannot both succeed
        const result = await prisma.commission.updateMany({
            where: { id: commId, status: 'REQUESTED' },
            data:  { status: 'PAID', paidAt: new Date() },
        });
        if (result.count === 0) return res.status(409).json({ error: 'This request was already processed' });

        const updated = await prisma.commission.findUnique({ where: { id: commId } });
        await audit(req, 'APPROVE_PAYOUT', 'Commission', commId, { status: 'REQUESTED' }, { status: 'PAID', netPayout: commission.netPayout, agentId: commission.agentId });
        const { m, lang } = await orgLocale(commission.orgId);
        await createNotification(commission.agentId, commission.orgId, 'COMMISSION_PAID', m.payoutApproved,
            m.payoutApprovedDetail(`$ ${formatAmount(commission.netPayout, lang)}`), '/finance');
        res.json(updated);
    } catch (error) {
        console.error('Error approving payout:', error);
        res.status(500).json({ error: 'Failed to approve payout' });
    }
});

// POST /api/finance/commissions/:id/reject — admin rejects a payout request → back to PENDING
router.post('/commissions/:id/reject', authorizeRole(['SUPERADMIN', 'FIRMADMIN', 'MANAGER']), async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const commId = String(req.params.id);

        const commission = await prisma.commission.findFirst({
            where: { id: commId, orgId: req.user.orgId },
        });
        if (!commission) return res.status(404).json({ error: 'Commission not found' });
        if (commission.agentId === req.user.userId && !(await isSoleApprover(req.user.orgId, req.user.userId))) {
            return res.status(403).json({ error: 'You cannot review your own payout request' });
        }
        if (commission.status !== 'REQUESTED') {
            return res.status(400).json({ error: `Cannot reject a commission in ${commission.status} status` });
        }

        const result = await prisma.commission.updateMany({
            where: { id: commId, status: 'REQUESTED' },
            data:  { status: 'PENDING' },
        });
        if (result.count === 0) return res.status(409).json({ error: 'This request was already processed' });

        const updated = await prisma.commission.findUnique({ where: { id: commId } });
        await audit(req, 'REJECT_PAYOUT', 'Commission', commId, { status: 'REQUESTED' }, { status: 'PENDING', agentId: commission.agentId });
        const { m } = await orgLocale(commission.orgId);
        await createNotification(commission.agentId, commission.orgId, 'SYSTEM', m.payoutReturned, m.payoutReturnedDetail, '/finance');
        res.json(updated);
    } catch (error) {
        console.error('Error rejecting payout:', error);
        res.status(500).json({ error: 'Failed to reject payout' });
    }
});

// GET /api/finance/projections
// Calculates estimated future revenue based on active listings and pending offers
router.get('/projections', requireTier('ELITE'), async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.userId;
        const orgId = req.user?.orgId;

        if (!userId || !orgId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Fetch pending offers and active listings
        const [pendingOffers, activeListings] = await Promise.all([
            prisma.offer.findMany({
                where: {
                    agentId: userId,
                    orgId: orgId,
                    status: { in: ['PENDING', 'COUNTER'] }
                }
            }),
            prisma.property.findMany({
                where: {
                    agentId: userId,
                    orgId: orgId,
                    status: 'ACTIVE'
                }
            })
        ]);

        // Constants for estimation
        const AVG_COMMISSION_RATE = 0.025; // 2.5%
        const AGENT_NET_RATIO = 0.7; // 70% net payout after firm split
        const OFFER_CLOSE_PROBABILITY = 0.8;
        const LISTING_CLOSE_PROBABILITY = 0.4;

        const now = new Date();
        const projections = [];

        // Generate next 6 months
        for (let i = 0; i < 6; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const monthLabel = date.toLocaleString('default', { month: 'short' });
            
            let projectedAmount = 0;

            // Simple distribution:
            // Offers close in month 1-2
            if (i >= 1 && i <= 2) {
                const monthlyOfferPool = pendingOffers.length / 2;
                const totalOfferValue = pendingOffers.reduce((sum, o) => sum + o.amount, 0);
                projectedAmount += (totalOfferValue / 2) * AVG_COMMISSION_RATE * AGENT_NET_RATIO * OFFER_CLOSE_PROBABILITY;
            }

            // Listings close in month 3-6
            if (i >= 3 && i <= 5) {
                const totalListingValue = activeListings.reduce((sum, p) => sum + (p.price ?? 0), 0);
                projectedAmount += (totalListingValue / 3) * AVG_COMMISSION_RATE * AGENT_NET_RATIO * LISTING_CLOSE_PROBABILITY;
            }

            projections.push({
                month: monthLabel,
                amount: Math.round(projectedAmount),
            });
        }

        res.json(projections);
    } catch (error) {
        console.error('Error fetching projections:', error);
        res.status(500).json({ error: 'Failed to fetch projections' });
    }
});

export default router;
