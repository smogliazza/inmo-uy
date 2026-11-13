/**
 * Backfill for spec 6.2: every property that has the legacy `price` but no PropertyPrice row gets a SALE price
 * in USD with that amount. Idempotent (properties that already have any price row are skipped), so it runs on
 * every release and can be run by hand: npm run backfill:prices
 */
import type { PrismaClient } from '@prisma/client';

export async function backfillPrices(db: PrismaClient, batchSize = 500): Promise<number> {
    let created = 0;
    for (;;) {
        const rows = await db.property.findMany({
            where: { price: { not: null }, prices: { none: {} } },
            select: { id: true, orgId: true, price: true },
            take: batchSize,
        });
        if (rows.length === 0) break;
        const r = await db.propertyPrice.createMany({
            data: rows.map(p => ({ propertyId: p.id, orgId: p.orgId, operation: 'SALE' as const, amount: p.price!, currency: 'USD' as const })),
            skipDuplicates: true,
        });
        created += r.count;
        if (rows.length < batchSize) break;
    }
    return created;
}
