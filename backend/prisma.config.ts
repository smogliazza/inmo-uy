// Prisma CLI configuration (Prisma 7+). The connection URL for Migrate lives here, not in
// schema.prisma. The runtime client gets its connection from src/lib/prisma.ts (driver adapter).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
        seed: 'ts-node prisma/seed.ts',
    },
    // Optional so that `prisma generate` works at build time without a database.
    datasource: { url: process.env.DATABASE_URL },
});
