/**
 * Prisma client factory (Prisma 7+: connects through the `pg` driver adapter).
 *
 * DATABASE_URL keeps the Prisma-style query parameters used before the upgrade:
 *   - `connection_limit=N` → pool size (default 10)
 *   - `schema=name`        → PostgreSQL schema (default `public`)
 * They are stripped before the URL is handed to `pg`, which does not know them.
 */
// Prisma 7 no longer loads .env by itself; dotenv never overrides variables already set.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DEFAULT_POOL_MAX = 10;

export interface ParsedDatabaseUrl {
    connectionString: string;
    poolMax: number;
    schema?: string;
}

export function parseDatabaseUrl(raw: string | undefined): ParsedDatabaseUrl {
    if (!raw) throw new Error('DATABASE_URL is not set');
    const url = new URL(raw);
    const limit = Number(url.searchParams.get('connection_limit'));
    const schema = url.searchParams.get('schema') || undefined;
    url.searchParams.delete('connection_limit');
    url.searchParams.delete('schema');
    // Prisma-only parameters that `pg` would otherwise forward as server options.
    for (const key of ['pool_timeout', 'pgbouncer', 'statement_cache_size']) url.searchParams.delete(key);
    return {
        connectionString: url.toString(),
        poolMax: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_POOL_MAX,
        schema: schema && schema !== 'public' ? schema : undefined,
    };
}

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
    const { connectionString, poolMax, schema } = parseDatabaseUrl(databaseUrl);
    const adapter = new PrismaPg({ connectionString, max: poolMax }, schema ? { schema } : undefined);
    return new PrismaClient({ adapter });
}
