/**
 * Release step: brings the database schema up to date before the API starts.
 *
 * - Databases originally created with `prisma db push` have tables but no
 *   migration history; the first migration is marked as applied (baseline)
 *   so the rest can run. Every later migration is idempotent.
 * - Later migrations left half-applied by an earlier failed deploy are marked
 *   rolled back and re-run (they are idempotent).
 * - Then `prisma migrate deploy` applies anything pending.
 *
 * Runs automatically on production start (see server.ts), or by hand:
 *   npm run release
 */
import { execSync } from 'child_process';
import path from 'path';
import { createPrismaClient } from './lib/prisma';

const BASELINE = '20260303200258_init_multi_tenant';
const BACKEND_DIR = path.resolve(__dirname, '..');

function prisma(args: string) {
    console.log(`[release] prisma ${args}`);
    execSync(`npx prisma ${args}`, { cwd: BACKEND_DIR, stdio: 'inherit', env: process.env });
}

export async function runRelease() {
    const db = createPrismaClient();
    try {
        const [state] = await db.$queryRaw<{ has_history: boolean; has_users: boolean }[]>`
            SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS has_history,
                   to_regclass('public."User"') IS NOT NULL AS has_users`;

        let applied = 0;
        let failed: string[] = [];
        if (state.has_history) {
            const rows = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
                SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
            applied = rows.filter(r => r.finished_at && !r.rolled_back_at).length;
            failed = rows.filter(r => !r.finished_at && !r.rolled_back_at).map(r => r.migration_name);
        }

        if (state.has_users && applied === 0 && !failed.includes(BASELINE)) {
            console.log('[release] Existing database without migration history — baselining.');
            prisma(`migrate resolve --applied ${BASELINE}`);
        }
        for (const name of failed) {
            if (name === BASELINE) throw new Error('The initial migration is marked as failed; fix it by hand.');
            console.log(`[release] Re-running previously failed migration ${name}.`);
            prisma(`migrate resolve --rolled-back ${name}`);
        }
    } finally {
        await db.$disconnect();
    }
    prisma('migrate deploy');
    console.log('[release] Database is up to date.');
}

if (require.main === module) {
    runRelease().catch(err => {
        console.error('[release] failed:', err);
        process.exit(1);
    });
}
