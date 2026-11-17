import { prisma } from './db';

// Seat limits per organization subscription level (see USER_GUIDE §16.1)
// null = unlimited
export const SEAT_LIMITS: Record<string, number | null> = {
    BASIC:      3,
    PRO:        15,
    ENTERPRISE: null,
};

export interface SeatUsage {
    limit: number | null;   // null = unlimited
    users: number;          // active member count
    pendingInvites: number; // unexpired, unaccepted invitations (reserved seats)
    subscription: string;
}

export async function getSeatUsage(orgId: string): Promise<SeatUsage> {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    const subscription = org?.subscription || 'BASIC';
    const limit = SEAT_LIMITS[subscription] ?? SEAT_LIMITS.BASIC;

    const [users, pendingInvites] = await Promise.all([
        prisma.user.count({ where: { orgId, isActive: true } }),
        prisma.invitation.count({
            where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
        }),
    ]);

    return { limit, users, pendingInvites, subscription };
}
