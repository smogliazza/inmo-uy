import { Transaction } from '@prisma/client';
import { prisma } from '../server';
import { orgLocale } from './messages';
import { createNotification } from '../routes/notifications';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Standard contract-to-close checklist created as tasks when a deal is opened.
 * Due dates are relative to the contract date (or today) and the closing date.
 */
export async function createClosingChecklist(tx: Transaction) {
    const start = (tx.contractDate ?? new Date()).getTime();
    const closing = tx.closingDate?.getTime();
    const contingencies = (tx.contingencies || '').toUpperCase();

    const items: { title: string; due: number | null; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' }[] = [
        { title: 'Collect fully signed contract and earnest-money deposit', due: start + 2 * DAY, priority: 'URGENT' },
        { title: 'Send contract to attorney / title company', due: start + 2 * DAY, priority: 'HIGH' },
        { title: 'Schedule home inspection', due: start + 5 * DAY, priority: 'HIGH' },
    ];
    if (contingencies.includes('FINANCING') || !contingencies) {
        items.push({ title: 'Confirm mortgage application and commitment letter', due: start + 21 * DAY, priority: 'HIGH' });
    }
    if (contingencies.includes('APPRAISAL')) {
        items.push({ title: 'Confirm appraisal ordered and completed', due: start + 14 * DAY, priority: 'MEDIUM' });
    }
    if (contingencies.includes('SALE_OF_HOME')) {
        items.push({ title: "Track progress on buyer's home sale", due: start + 30 * DAY, priority: 'MEDIUM' });
    }
    items.push(
        { title: 'Prepare and submit board / HOA package (if co-op or condo)', due: start + 14 * DAY, priority: 'MEDIUM' },
        { title: 'Order title search and resolve any exceptions', due: start + 10 * DAY, priority: 'MEDIUM' },
        { title: 'Confirm closing date, location and funds with all parties', due: closing ? closing - 3 * DAY : null, priority: 'HIGH' },
        { title: 'Schedule final walk-through', due: closing ? closing - 1 * DAY : null, priority: 'MEDIUM' },
        { title: 'Send closing gift and ask for a review / referral', due: closing ? closing + 3 * DAY : null, priority: 'LOW' },
    );

    await prisma.task.createMany({
        data: items.map(i => ({
            title: i.title,
            priority: i.priority,
            dueDate: i.due ? new Date(i.due) : null,
            linkedTransactionId: tx.id,
            linkedClientId: tx.clientId,
            linkedPropertyId: tx.propertyId,
            agentId: tx.agentId,
            orgId: tx.orgId,
        })),
    });
    return items.length;
}

/**
 * Keeps the listing and client in step with the deal stage, and creates the
 * agent's commission record when the deal closes (once per deal + agent).
 */
export async function onTransactionStatusChange(tx: Transaction, previous: string | null) {
    if (tx.status === previous) return;

    if (['IN_CONTRACT', 'BOARD_PACKAGE', 'CLEARED_TO_CLOSE'].includes(tx.status)) {
        await prisma.property.updateMany({ where: { id: tx.propertyId, status: { in: ['ACTIVE', 'COMING_SOON'] } }, data: { status: 'IN_CONTRACT' } });
        await prisma.client.updateMany({ where: { id: tx.clientId, status: { notIn: ['CLOSED', 'ARCHIVED'] } }, data: { status: 'IN_CONTRACT', funnelStage: 'IN_CONTRACT' } });
    } else if (tx.status === 'CLOSED') {
        await prisma.property.update({ where: { id: tx.propertyId }, data: { status: 'SOLD' } });
        await prisma.client.update({ where: { id: tx.clientId }, data: { status: 'CLOSED', funnelStage: 'CLOSED' } });
        if (!tx.closingDate) await prisma.transaction.update({ where: { id: tx.id }, data: { closingDate: new Date() } });
        await ensureCommission(tx);
    } else if (tx.status === 'FALLEN_THROUGH') {
        await prisma.property.updateMany({ where: { id: tx.propertyId, status: 'IN_CONTRACT' }, data: { status: 'ACTIVE' } });
        await prisma.client.updateMany({ where: { id: tx.clientId, status: 'IN_CONTRACT' }, data: { status: 'ACTIVE', funnelStage: 'SHOWING' } });
    }

    const { m } = await orgLocale(tx.orgId);
    await createNotification(tx.agentId, tx.orgId, 'TRANSACTION_UPDATE', m.dealUpdated, m.dealUpdatedDetail(tx.status), '/transactions');
}

export async function ensureCommission(tx: Transaction) {
    const existing = await prisma.commission.findFirst({ where: { transactionId: tx.id, agentId: tx.agentId } });
    if (existing) return existing;

    const org = await prisma.organization.findUnique({ where: { id: tx.orgId } });
    const rate = tx.commissionRate ?? org?.defaultCommissionRate ?? 3;
    const firmSplit = org?.defaultFirmSplit ?? 30;
    const salePrice = tx.acceptedPrice ?? tx.price;
    const gross = Math.round(salePrice * rate) / 100;
    const net = Math.round(gross * (100 - firmSplit)) / 100;

    return prisma.commission.create({
        data: {
            transactionId: tx.id,
            agentId: tx.agentId,
            orgId: tx.orgId,
            grossAmount: gross,
            firmSplitPercent: firmSplit,
            overridePercent: 0,
            netPayout: net,
            status: 'PENDING',
            notes: `Auto-created at closing: ${rate}% of $${salePrice.toLocaleString()}, firm split ${firmSplit}%`,
        },
    });
}
