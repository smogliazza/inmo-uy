import { prisma } from './db';
import { AuthRequest } from '../middleware/authMiddleware';

// Records a sensitive action in the org's audit trail.
// Never throws — an audit-write failure must not fail the business operation itself.
export async function audit(
    req: AuthRequest,
    action: string,
    entity: string,
    entityId: string | null,
    before?: unknown,
    after?: unknown,
): Promise<void> {
    if (!req.user) return;
    try {
        await prisma.auditLog.create({
            data: {
                action,
                entity,
                entityId,
                before:    before === undefined ? null : JSON.stringify(before),
                after:     after  === undefined ? null : JSON.stringify(after),
                ipAddress: req.ip ?? null,
                userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
                userId:    req.user.userId,
                orgId:     req.user.orgId,
            },
        });
    } catch (err) {
        console.error(`Audit write failed for ${action}:`, err);
    }
}

// Before/after snapshots limited to the fields an update actually changed.
export function diffFields(existing: Record<string, any>, data: Record<string, any>): { before: Record<string, unknown>; after: Record<string, unknown> } {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
        const a = existing[key] instanceof Date ? existing[key].toISOString() : existing[key];
        const b = data[key] instanceof Date ? data[key].toISOString() : data[key];
        if (JSON.stringify(a) !== JSON.stringify(b)) {
            before[key] = a ?? null;
            after[key] = b ?? null;
        }
    }
    return { before, after };
}
