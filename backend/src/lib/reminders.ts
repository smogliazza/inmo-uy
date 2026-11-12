import { prisma } from '../server';
import { createNotification } from '../routes/notifications';
import { normalizePreferences } from './policies';
import { orgIdsWithModuleOff } from './modules';

const HOUR = 60 * 60 * 1000;

/**
 * Sends each agent an in-app + email reminder before their appointments (24h by default; each agent can choose
 * 1, 2, 4, 12 or 24 hours in Settings > Appointments > My preferences),
 * and alerts agents when a task becomes overdue (`overdueNotified` makes it idempotent).
 */
export async function sendAppointmentReminders() {
    const now = new Date();
    // Brokerages with the module off are skipped (their rows stay untouched for when it is turned back on).
    const [appointmentsOff, tasksOff] = await Promise.all([orgIdsWithModuleOff('appointments'), orgIdsWithModuleOff('tasks')]);
    const due = await prisma.appointment.findMany({
        where: {
            orgId: { notIn: appointmentsOff },
            reminderSent: false,
            status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] },
            date: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) },
        },
        include: {
            client:   { select: { firstName: true, lastName: true } },
            property: { select: { address: true } },
            agent:    { select: { preferences: true } },
        },
        orderBy: { date: 'asc' },
        take: 200,
    });
    let reminded = 0;
    for (const a of due) {
        // Not yet inside this agent's chosen reminder window
        const leadHours = normalizePreferences(a.agent.preferences).appointments.reminderLeadHours;
        if (a.date.getTime() - now.getTime() > leadHours * HOUR) continue;
        reminded++;
        const who = a.client ? ` with ${a.client.firstName} ${a.client.lastName}` : '';
        const where = a.property ? ` at ${a.property.address}` : a.location ? ` at ${a.location}` : '';
        await createNotification(a.agentId, a.orgId, 'APPOINTMENT_REMINDER', 'Upcoming appointment',
            `"${a.title}"${who}${where} — ${a.date.toISOString().replace('T', ' ').slice(0, 16)} UTC`, '/appointments');
        await prisma.appointment.update({ where: { id: a.id }, data: { reminderSent: true } });
    }

    const overdueTasks = await prisma.task.findMany({
        where: {
            orgId: { notIn: tasksOff },
            overdueNotified: false,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
            dueDate: { lt: now },
        },
        take: 200,
    });
    for (const t of overdueTasks) {
        await createNotification(
            t.agentId,
            t.orgId,
            'TASK_DUE',
            `Task overdue: ${t.title}`,
            `"${t.title}" is past its due time (${t.dueDate?.toISOString().replace('T', ' ').slice(0, 16)} UTC).`,
            t.linkedClientId ? `/crm/${t.linkedClientId}` : '/tasks',
        );
        await prisma.task.update({ where: { id: t.id }, data: { overdueNotified: true } });
    }

    return reminded + overdueTasks.length;
}

export function startReminderLoop(intervalMs = 10 * 60 * 1000) {
    const tick = () => sendAppointmentReminders().catch(err => console.error('Reminder job failed:', err));
    setTimeout(tick, 30 * 1000);
    return setInterval(tick, intervalMs);
}
