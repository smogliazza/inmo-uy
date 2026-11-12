import { prisma } from '../server';
import { placeKey } from './uy';

// Sources written before the Uruguay localization match their Spanish names (and vice versa),
// so existing rules keep working: "Website" = "Sitio web", "Open House" = "Puertas abiertas".
const SOURCE_ALIASES: Record<string, string> = { 'website': 'sitio web', 'open house': 'puertas abiertas', 'referral': 'referido' };
const sourceKey = (s: string) => { const k = placeKey(s); return SOURCE_ALIASES[k] ?? k; };

export interface LeadRoutingContext {
    orgId: string;
    source?: string | null;
    city?: string | null;
    propertyType?: string | null;
    price?: number | null;
    listingAgentId?: string | null;
}

export interface LeadRoutingDecision {
    agentId: string;
    agentName: string;
    matchedRuleId: string | null;
    matchedRuleName: string | null;
    strategyUsed: string;
}

const ELIGIBLE_ROLES = ['AGENT', 'MANAGER', 'FIRMADMIN', 'SUPERADMIN'] as const;

interface CandidateAgent {
    id: string;
    name: string;
    role: string;
    acceptingLeads: boolean;
    maxActiveLeads: number | null;
    activeLeadCount: number;
}

async function getEligibleCandidates(orgId: string): Promise<CandidateAgent[]> {
    const users = await prisma.user.findMany({
        where: {
            orgId,
            isActive: true,
            acceptingLeads: true,
            role: { in: [...ELIGIBLE_ROLES] },
        },
        select: {
            id: true,
            name: true,
            role: true,
            acceptingLeads: true,
            maxActiveLeads: true,
            _count: {
                select: {
                    clients: {
                        where: { status: { in: ['LEAD', 'ACTIVE', 'IN_CONTRACT'] } },
                    },
                },
            },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return users
        .map(u => ({
            id: u.id,
            name: u.name,
            role: u.role,
            acceptingLeads: u.acceptingLeads,
            maxActiveLeads: u.maxActiveLeads,
            activeLeadCount: u._count.clients,
        }))
        .filter(u => u.maxActiveLeads === null || u.activeLeadCount < u.maxActiveLeads);
}

function ruleMatches(
    rule: {
        source: string | null;
        city: string | null;
        propertyType: string | null;
        minPrice: number | null;
        maxPrice: number | null;
    },
    ctx: LeadRoutingContext,
): boolean {
    if (rule.source && rule.source.trim()) {
        if (!ctx.source || sourceKey(rule.source) !== sourceKey(ctx.source)) {
            return false;
        }
    }
    if (rule.city && rule.city.trim()) {
        if (!ctx.city || placeKey(rule.city) !== placeKey(ctx.city)) {
            return false;
        }
    }
    if (rule.propertyType && rule.propertyType.trim()) {
        if (!ctx.propertyType || rule.propertyType.trim().toLowerCase() !== ctx.propertyType.trim().toLowerCase()) {
            return false;
        }
    }
    if (rule.minPrice !== null && rule.minPrice !== undefined) {
        if (ctx.price === null || ctx.price === undefined || ctx.price < rule.minPrice) {
            return false;
        }
    }
    if (rule.maxPrice !== null && rule.maxPrice !== undefined) {
        if (ctx.price === null || ctx.price === undefined || ctx.price > rule.maxPrice) {
            return false;
        }
    }
    return true;
}

/**
 * Resolves which agent in the organization should receive a new incoming lead.
 * When `dryRun` is true, round-robin counters are not mutated.
 */
export async function resolveLeadAssignee(
    ctx: LeadRoutingContext,
    options: { dryRun?: boolean } = {},
): Promise<LeadRoutingDecision> {
    const [rules, candidates] = await Promise.all([
        prisma.leadRoutingRule.findMany({
            where: { orgId: ctx.orgId, enabled: true },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        }),
        getEligibleCandidates(ctx.orgId),
    ]);

    const candidateById = new Map(candidates.map(c => [c.id, c]));

    for (const rule of rules) {
        if (!ruleMatches(rule, ctx)) continue;

        if (rule.strategy === 'LISTING_AGENT') {
            if (ctx.listingAgentId && candidateById.has(ctx.listingAgentId)) {
                const chosen = candidateById.get(ctx.listingAgentId)!;
                return {
                    agentId: chosen.id,
                    agentName: chosen.name,
                    matchedRuleId: rule.id,
                    matchedRuleName: rule.name,
                    strategyUsed: 'LISTING_AGENT',
                };
            }
            continue;
        }

        if (rule.strategy === 'SPECIFIC_AGENT') {
            if (rule.targetAgentId && candidateById.has(rule.targetAgentId)) {
                const chosen = candidateById.get(rule.targetAgentId)!;
                return {
                    agentId: chosen.id,
                    agentName: chosen.name,
                    matchedRuleId: rule.id,
                    matchedRuleName: rule.name,
                    strategyUsed: 'SPECIFIC_AGENT',
                };
            }
            continue;
        }

        if (rule.strategy === 'LEAST_LOADED' && candidates.length > 0) {
            const sorted = [...candidates].sort((a, b) => a.activeLeadCount - b.activeLeadCount);
            const chosen = sorted[0];
            return {
                agentId: chosen.id,
                agentName: chosen.name,
                matchedRuleId: rule.id,
                matchedRuleName: rule.name,
                strategyUsed: 'LEAST_LOADED',
            };
        }

        if (rule.strategy === 'ROUND_ROBIN' && candidates.length > 0) {
            const idx = Math.abs(rule.lastAssignedIndex) % candidates.length;
            const chosen = candidates[idx];
            if (!options.dryRun) {
                await prisma.leadRoutingRule.update({
                    where: { id: rule.id },
                    data: { lastAssignedIndex: idx + 1 },
                });
            }
            return {
                agentId: chosen.id,
                agentName: chosen.name,
                matchedRuleId: rule.id,
                matchedRuleName: rule.name,
                strategyUsed: 'ROUND_ROBIN',
            };
        }
    }

    // Default fallback 1: Listing agent if eligible
    if (ctx.listingAgentId && candidateById.has(ctx.listingAgentId)) {
        const chosen = candidateById.get(ctx.listingAgentId)!;
        return {
            agentId: chosen.id,
            agentName: chosen.name,
            matchedRuleId: null,
            matchedRuleName: null,
            strategyUsed: 'DEFAULT_LISTING_AGENT',
        };
    }

    // Default fallback 2: First eligible candidate (preferring FIRMADMIN / MANAGER)
    if (candidates.length > 0) {
        const adminCandidate = candidates.find(c => c.role === 'FIRMADMIN' || c.role === 'MANAGER' || c.role === 'SUPERADMIN') || candidates[0];
        return {
            agentId: adminCandidate.id,
            agentName: adminCandidate.name,
            matchedRuleId: null,
            matchedRuleName: null,
            strategyUsed: 'FALLBACK_ADMIN',
        };
    }

    // Ultimate fallback: Even if everyone paused lead intake, never drop a lead — assign to listing agent or org admin
    if (ctx.listingAgentId) {
        const listingAgent = await prisma.user.findUnique({ where: { id: ctx.listingAgentId }, select: { id: true, name: true } });
        if (listingAgent) {
            return {
                agentId: listingAgent.id,
                agentName: listingAgent.name,
                matchedRuleId: null,
                matchedRuleName: null,
                strategyUsed: 'FALLBACK_LISTING_AGENT',
            };
        }
    }

    const anyOrgAdmin = await prisma.user.findFirst({
        where: { orgId: ctx.orgId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
    });

    return {
        agentId: anyOrgAdmin!.id,
        agentName: anyOrgAdmin!.name,
        matchedRuleId: null,
        matchedRuleName: null,
        strategyUsed: 'FALLBACK_ORG_OWNER',
    };
}
