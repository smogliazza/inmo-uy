/**
 * Demo data seed.
 *
 * Safe by default:
 *  - Never deletes anything. If the demo organization already exists it stops.
 *  - Refuses to run when NODE_ENV=production unless ALLOW_SEED=true is set.
 *  - Never ships a known password. Set SEED_PASSWORD, or a random one is
 *    generated and printed once.
 *
 * Usage:  SEED_PASSWORD='choose-a-strong-one' npx prisma db seed
 */
import { PrismaClient, ClientType, ClientStatus, PropStatus, TransStatus, Role, Tier, CommStatus } from '@prisma/client';
import { createPrismaClient } from '../src/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = createPrismaClient();

const DEMO_ORG_NAME = 'Demo Brokerage';
const DEMO_DOMAIN = 'demo.example.com';

async function main() {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
        console.error('Refusing to seed: NODE_ENV=production. Set ALLOW_SEED=true if you really mean it.');
        process.exit(1);
    }

    const existing = await prisma.user.findUnique({ where: { email: `admin@${DEMO_DOMAIN}` } });
    if (existing) {
        console.log('Demo data already present — nothing to do.');
        return;
    }

    const plainPassword = process.env.SEED_PASSWORD || crypto.randomBytes(9).toString('base64url');
    if (plainPassword.length < 8) {
        console.error('SEED_PASSWORD must be at least 8 characters.');
        process.exit(1);
    }
    const password = await bcrypt.hash(plainPassword, 10);

    const org = await prisma.organization.create({
        data: {
            name: DEMO_ORG_NAME,
            slug: 'demo-brokerage',
            subscription: 'ENTERPRISE',
            defaultCommissionRate: 3,
            defaultFirmSplit: 30,
        },
    });

    const mkUser = (name: string, local: string, role: Role, tier: Tier) =>
        prisma.user.create({
            data: { name, email: `${local}@${DEMO_DOMAIN}`, password, role, tier, orgId: org.id, emailVerified: true },
        });

    await mkUser('Demo Admin', 'admin', Role.FIRMADMIN, Tier.ELITE);
    await mkUser('Demo Manager', 'manager', Role.MANAGER, Tier.PRO);
    const agent = await mkUser('Sarah Agent', 'agent', Role.AGENT, Tier.ELITE);

    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const [john, jane, robert] = await Promise.all([
        prisma.client.create({
            data: {
                firstName: 'John', lastName: 'Doe', email: 'john.doe@example.com', phone: '+1 (212) 555-0198',
                type: ClientType.BUYER, status: ClientStatus.ACTIVE, funnelStage: 'SHOWING', budget: '$1.2M - $1.5M',
                source: 'Referral', temperature: 'HOT', lastContactedAt: new Date(now - 2 * day),
                agentId: agent.id, orgId: org.id,
            },
        }),
        prisma.client.create({
            data: {
                firstName: 'Jane', lastName: 'Smith', email: 'jane.smith@example.com', phone: '+1 (917) 555-0244',
                type: ClientType.SELLER, status: ClientStatus.ACTIVE, funnelStage: 'IN_CONTRACT',
                source: 'Website', temperature: 'WARM', lastContactedAt: new Date(now - 5 * day),
                agentId: agent.id, orgId: org.id,
            },
        }),
        prisma.client.create({
            data: {
                firstName: 'Robert', lastName: 'Johnson', phone: '+1 (347) 555-0300',
                type: ClientType.BUYER, status: ClientStatus.LEAD, funnelStage: 'LEAD', budget: '$800K - $1M',
                source: 'Zillow', temperature: 'COLD', lastContactedAt: new Date(now - 21 * day),
                agentId: agent.id, orgId: org.id,
            },
        }),
    ]);

    const mkProp = (address: string, zip: string, price: number, beds: number, baths: number, sqft: number, status: PropStatus, description: string) =>
        prisma.property.create({
            data: {
                address, city: 'New York', state: 'NY', zip, price, beds, baths, sqft, status, description,
                propertyType: 'CONDO', listingDate: new Date(now - 30 * day), agentId: agent.id, orgId: org.id,
            },
        });

    const p1 = await mkProp('123 Main Street, Apt 1A', '10001', 1450000, 2, 2, 1200, PropStatus.ACTIVE, 'Bright corner two-bedroom with open kitchen.');
    const p2 = await mkProp('88 Greenwich St, #1204', '10006', 950000, 1, 1, 850, PropStatus.IN_CONTRACT, 'Modern condo with harbor views.');
    await mkProp('45 Park Ave, PH 2', '10016', 2500000, 3, 2.5, 2200, PropStatus.ACTIVE, 'Penthouse with private terrace.');

    await prisma.transaction.create({
        data: {
            propertyId: p1.id, clientId: john.id, agentId: agent.id, orgId: org.id,
            price: 1400000, status: TransStatus.OFFER_REVIEW,
        },
    });
    const closed = await prisma.transaction.create({
        data: {
            propertyId: p2.id, clientId: jane.id, agentId: agent.id, orgId: org.id,
            price: 900000, acceptedPrice: 900000, status: TransStatus.CLOSED, closingDate: new Date(now - 10 * day),
            commissionRate: 2.5,
        },
    });

    const gross = 900000 * 0.025;
    await prisma.commission.create({
        data: {
            transactionId: closed.id, agentId: agent.id, orgId: org.id,
            grossAmount: gross, firmSplitPercent: 30, overridePercent: 0, netPayout: gross * 0.7,
            status: CommStatus.PAID, paidAt: new Date(now - 5 * day),
        },
    });

    await prisma.offer.create({
        data: { amount: 1380000, status: 'PENDING', propertyId: p1.id, clientId: john.id, agentId: agent.id, orgId: org.id },
    });

    await prisma.appointment.create({
        data: {
            title: 'Showing — 123 Main St', type: 'SHOWING', date: new Date(now + 2 * day),
            clientId: john.id, propertyId: p1.id, agentId: agent.id, orgId: org.id,
        },
    });

    await prisma.task.create({
        data: {
            title: 'Call Robert to re-qualify budget', priority: 'HIGH', dueDate: new Date(now + day),
            linkedClientId: robert.id, agentId: agent.id, orgId: org.id,
        },
    });

    await prisma.note.create({
        data: { content: 'Prefers doorman buildings below 20th St.', type: 'CALL', clientId: john.id, authorId: agent.id, orgId: org.id },
    });

    console.log('Demo data created.');
    console.log(`  Logins: admin@${DEMO_DOMAIN}, manager@${DEMO_DOMAIN}, agent@${DEMO_DOMAIN}`);
    if (!process.env.SEED_PASSWORD) console.log(`  Generated password: ${plainPassword}`);
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
