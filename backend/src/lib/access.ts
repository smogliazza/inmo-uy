import { prisma } from './db';
import { AuthRequest } from '../middleware/authMiddleware';

export type AuthUser = NonNullable<AuthRequest['user']>;

export const MANAGEMENT_ROLES = ['SUPERADMIN', 'FIRMADMIN', 'MANAGER'];

export function isManager(user: AuthUser): boolean {
    return MANAGEMENT_ROLES.includes(user.role);
}

// Clients a user may READ. An AGENT sees their own / co-represented clients, unless the
// brokerage's CRM policy opens the whole book to everyone. Management sees the org.
export function clientScope(user: AuthUser) {
    if (user.role === 'AGENT' && user.policies?.crm.clientVisibility !== 'all') {
        return { orgId: user.orgId, OR: [{ agentId: user.userId }, { coAgentId: user.userId }] };
    }
    return { orgId: user.orgId };
}

// Whether a user may EDIT a client they can read: agents only edit their own or co-represented clients,
// even when the policy lets them read everyone's.
export function canEditClient(user: AuthUser, client: { agentId: string; coAgentId: string | null }): boolean {
    return user.role !== 'AGENT' || client.agentId === user.userId || client.coAgentId === user.userId;
}

/**
 * Verifies that every referenced record belongs to the caller's organization.
 * Request bodies carry raw IDs, so without this a user could attach their
 * records to another brokerage's client/property/transaction.
 * Returns an error message, or null when everything checks out.
 */
export async function checkRefs(
    orgId: string,
    refs: { clientId?: string | null; propertyId?: string | null; transactionId?: string | null; userId?: string | null },
): Promise<string | null> {
    const checks: Promise<string | null>[] = [];
    if (refs.clientId) {
        checks.push(prisma.client.count({ where: { id: refs.clientId, orgId } }).then(n => (n ? null : 'Client not found')));
    }
    if (refs.propertyId) {
        checks.push(prisma.property.count({ where: { id: refs.propertyId, orgId } }).then(n => (n ? null : 'Property not found')));
    }
    if (refs.transactionId) {
        checks.push(prisma.transaction.count({ where: { id: refs.transactionId, orgId } }).then(n => (n ? null : 'Transaction not found')));
    }
    if (refs.userId) {
        checks.push(prisma.user.count({ where: { id: refs.userId, orgId } }).then(n => (n ? null : 'User not found')));
    }
    const results = await Promise.all(checks);
    return results.find(r => r !== null) ?? null;
}

// Parses an optional number from user input; returns undefined when absent/blank, NaN-safe.
export function optNumber(v: unknown): number | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
}

// Parses an optional date; returns null for blank (explicit clear), undefined when absent.
export function optDate(v: unknown): Date | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? undefined : d;
}

export function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
    return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
