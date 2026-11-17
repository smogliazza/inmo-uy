/**
 * Expired demo brokerages (spec 11.3). The migrator's demo mode creates an organization with isDemo=true and
 * demoExpiresAt 30 days ahead; once expired, this job deletes it with everything it holds, including its photos
 * in R2. It is the only thing the platform ever deletes, and only organizations with isDemo=true.
 */
import { prisma } from './db';
import { deleteUploadedFile } from './storage';

// Children first, so no foreign key is left dangling
const ORDER = [
    'siteEvent', 'notification', 'auditLog', 'commission', 'document', 'note', 'appointment', 'offer', 'giftOrder',
    'task', 'marketingTask', 'referral', 'transaction', 'mediaAsset', 'propertyPrice', 'property', 'client',
    'leadRoutingRule', 'invitation', 'orgSlugHistory', 'uploadedFile', 'user',
] as const;

type Deletable = { deleteMany(args: { where: { orgId: string } }): Promise<{ count: number }> };

export async function deleteDemoOrganization(orgId: string): Promise<Record<string, number>> {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { isDemo: true } });
    if (!org) return {};
    if (!org.isDemo) throw new Error(`Refusing to delete organization ${orgId}: it is not a demo`);

    // Stored files first (R2 objects are outside the database transaction)
    const files = await prisma.uploadedFile.findMany({ where: { orgId }, select: { id: true } });
    for (const f of files) await deleteUploadedFile(f.id, orgId);

    const counts: Record<string, number> = { files: files.length };
    await prisma.$transaction(async tx => {
        // Re-check inside the transaction: never delete a real brokerage
        const again = await tx.organization.findUnique({ where: { id: orgId }, select: { isDemo: true } });
        if (!again?.isDemo) throw new Error(`Refusing to delete organization ${orgId}: it is not a demo`);
        for (const model of ORDER) {
            const r = await (tx[model] as unknown as Deletable).deleteMany({ where: { orgId } });
            if (r.count) counts[model] = r.count;
        }
        await tx.organization.delete({ where: { id: orgId } });
    }, { timeout: 120_000 });
    return counts;
}

/** Deletes every demo whose demoExpiresAt has passed. Returns the ids deleted. */
export async function purgeExpiredDemos(now = new Date()): Promise<string[]> {
    const expired = await prisma.organization.findMany({
        where: { isDemo: true, demoExpiresAt: { lt: now } },
        select: { id: true, name: true },
    });
    const done: string[] = [];
    for (const o of expired) {
        try {
            const counts = await deleteDemoOrganization(o.id);
            console.log(`[demo-cleanup] deleted expired demo "${o.name}" (${o.id})`, counts);
            done.push(o.id);
        } catch (err) {
            console.error(`[demo-cleanup] could not delete demo ${o.id}:`, err);
        }
    }
    return done;
}

/** Runs the cleanup at start and then every 6 hours. */
export function startDemoCleanupLoop(): ReturnType<typeof setInterval> {
    const run = () => { purgeExpiredDemos().catch(err => console.error('[demo-cleanup]', err)); };
    setTimeout(run, 60_000).unref();
    const t = setInterval(run, 6 * 60 * 60 * 1000);
    t.unref();
    return t;
}
