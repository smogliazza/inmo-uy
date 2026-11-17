// The API's single Prisma client. Kept apart from server.ts so tools that reuse the backend's libraries
// (tools/migrator) can open the database without starting the HTTP server.
import { createPrismaClient } from './prisma';

export const prisma = createPrismaClient();

// Re-exported so tools that live outside backend/ (tools/migrator) use the same generated client
export { Prisma } from '@prisma/client';
