// Manual run of the price backfill (it also runs automatically on every release): npm run backfill:prices
import { createPrismaClient } from '../src/lib/prisma';
import { backfillPrices } from '../src/lib/backfillPrices';

const db = createPrismaClient();
backfillPrices(db)
    .then(n => console.log(`[backfill-prices] Created ${n} sale price(s) from legacy Property.price.`))
    .catch(err => { console.error('[backfill-prices] failed:', err); process.exitCode = 1; })
    .finally(() => db.$disconnect());
