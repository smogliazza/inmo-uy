import express from 'express';
import { prisma } from '../server';
import { orgLocale, formatWhen } from '../lib/messages';
import { AuthRequest } from '../middleware/authMiddleware';
import { createNotification } from './notifications';
import { checkRefs, isManager, optDate, optNumber, pickEnum } from '../lib/access';
import { audit, diffFields } from '../lib/audit';
import { normalizePreferences } from '../lib/policies';

const router = express.Router();
const STATUSES = ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const;
const TYPES = ['SHOWING', 'MEETING', 'CALL', 'OPEN_HOUSE', 'INSPECTION', 'CLOSING', 'FOLLOW_UP'] as const;

// GET /api/appointments?from=&to=&agentId=
router.get('/', async (req: AuthRequest, res) => {
    const user = req.user!;
    const where: any = { orgId: user.orgId };
    // Managers can look at a teammate's calendar; everyone else sees their own
    if (isManager(user) && typeof req.query.agentId === 'string') where.agentId = req.query.agentId;
    else if (!(isManager(user) && req.query.scope === 'org')) where.agentId = user.userId;

    const from = optDate(req.query.from);
    const to = optDate(req.query.to);
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const appointments = await prisma.appointment.findMany({
        where,
        include: {
            client:   { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
            property: { select: { id: true, address: true, city: true } },
        },
        orderBy: { date: 'asc' },
        take: 500,
    });
    res.json(appointments);
});

function parseFields(body: any) {
    const data: any = {};
    if (typeof body.title === 'string') data.title = body.title.trim();
    const date = optDate(body.date);
    if (date) data.date = date;
    const endDate = optDate(body.endDate);
    if (endDate !== undefined) data.endDate = endDate;
    const status = pickEnum(body.status, STATUSES);
    if (status) data.status = status;
    const type = pickEnum(body.type, TYPES);
    if (type) data.type = type;
    const durationMin = optNumber(body.durationMin);
    if (durationMin !== undefined) data.durationMin = Math.round(durationMin);
    for (const f of ['notes', 'location', 'virtualLink', 'colorCode']) {
        if (body[f] !== undefined) data[f] = body[f] === null || body[f] === '' ? null : String(body[f]);
    }
    for (const f of ['clientId', 'propertyId']) {
        if (body[f] !== undefined) data[f] = body[f] || null;
    }
    return data;
}

const MINUTE = 60 * 1000;
const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'];

/**
 * Appointments policy (Settings > Appointments): finds an existing appointment of the same agent that
 * overlaps the proposed time, keeping the configured buffer on both sides. Returns null when the policy is off.
 */
async function findConflict(
    req: AuthRequest,
    agentId: string,
    start: Date,
    durationMin: number,
    endDate: Date | null | undefined,
    ignoreId?: string,
) {
    const policy = req.user!.policies.appointments;
    if (!policy.preventDoubleBooking) return null;
    const end = endDate ?? new Date(start.getTime() + durationMin * MINUTE);
    const buffer = policy.bufferMinutes * MINUTE;
    // Candidates start within a day on either side; exact overlap is computed below
    const candidates = await prisma.appointment.findMany({
        where: {
            agentId, orgId: req.user!.orgId, status: { in: ACTIVE_STATUSES as any },
            ...(ignoreId ? { id: { not: ignoreId } } : {}),
            date: { gte: new Date(start.getTime() - 24 * 60 * MINUTE), lte: new Date(end.getTime() + 24 * 60 * MINUTE) },
        },
        select: { id: true, title: true, date: true, endDate: true, durationMin: true },
    });
    return candidates.find(c => {
        const cEnd = c.endDate ?? new Date(c.date.getTime() + (c.durationMin ?? 60) * MINUTE);
        return start.getTime() < cEnd.getTime() + buffer && end.getTime() + buffer > c.date.getTime();
    }) ?? null;
}

const conflictResponse = (c: { id: string; title: string; date: Date }, bufferMinutes: number) => ({
    error: `This overlaps "${c.title}" at ${c.date.toISOString().replace('T', ' ').slice(0, 16)} UTC${bufferMinutes > 0 ? ` (a ${bufferMinutes}-minute gap is required between appointments)` : ''}`,
    code: 'APPOINTMENT_CONFLICT',
    conflict: { id: c.id, title: c.title, date: c.date },
});

// POST /api/appointments
router.post('/', async (req: AuthRequest, res) => {
    const user = req.user!;
    const data = parseFields(req.body);
    if (!data.title) return res.status(400).json({ error: 'Title is required' });
    if (!data.date) return res.status(400).json({ error: 'A valid date is required' });
    const refErr = await checkRefs(user.orgId, { clientId: data.clientId, propertyId: data.propertyId });
    if (refErr) return res.status(400).json({ error: refErr });

    // Personal preferences (Settings > Appointments > My preferences): default length and auto-confirm
    const me = await prisma.user.findUnique({ where: { id: user.userId }, select: { preferences: true } });
    const prefs = normalizePreferences(me?.preferences).appointments;
    if (data.durationMin === undefined && data.endDate === undefined) data.durationMin = prefs.defaultDurationMin;
    const status = data.status ?? (prefs.autoConfirm ? 'CONFIRMED' : 'SCHEDULED');

    // Brokerage policy: no double booking (the caller can confirm with force: true)
    if (req.body.force !== true && ACTIVE_STATUSES.includes(status)) {
        const clash = await findConflict(req, user.userId, data.date, data.durationMin ?? 60, data.endDate);
        if (clash) return res.status(409).json(conflictResponse(clash, user.policies.appointments.bufferMinutes));
    }

    const appointment = await prisma.appointment.create({
        data: { ...data, status, agentId: user.userId, orgId: user.orgId },
    });

    const { m, lang, timeZone } = await orgLocale(user.orgId);
    await createNotification(user.userId, user.orgId, 'APPOINTMENT_REMINDER', m.appointmentScheduled,
        m.appointmentScheduledDetail(appointment.title, formatWhen(appointment.date, lang, timeZone)), '/appointments');
    if (appointment.clientId && appointment.type === 'SHOWING') {
        await prisma.client.updateMany({
            where: { id: appointment.clientId, funnelStage: { in: ['LEAD', 'QUALIFIED'] } },
            data: { funnelStage: 'SHOWING' },
        });
    }
    await audit(req, 'CREATE_APPOINTMENT', 'Appointment', appointment.id, undefined, { title: appointment.title, type: appointment.type, date: appointment.date.toISOString() });
    res.status(201).json(appointment);
});

async function findEditable(req: AuthRequest) {
    const user = req.user!;
    const appt = await prisma.appointment.findFirst({ where: { id: String(req.params.id), orgId: user.orgId } });
    if (!appt) return { error: 404 as const };
    if (appt.agentId !== user.userId && !isManager(user)) return { error: 403 as const };
    return { appt };
}

// PATCH /api/appointments/:id — reschedule, confirm, complete, cancel…
router.patch('/:id', async (req: AuthRequest, res) => {
    const found = await findEditable(req);
    if (found.error === 404) return res.status(404).json({ error: 'Appointment not found' });
    if (found.error === 403) return res.status(403).json({ error: 'Forbidden' });

    const data = parseFields(req.body);
    if ('title' in data && !data.title) return res.status(400).json({ error: 'Title cannot be empty' });
    const refErr = await checkRefs(req.user!.orgId, { clientId: data.clientId, propertyId: data.propertyId });
    if (refErr) return res.status(400).json({ error: refErr });

    // Brokerage policy: rescheduling (or reopening) must not overlap another appointment of the same agent
    const appt = found.appt!;
    const nextStatus = data.status ?? appt.status;
    const timeChanged = data.date !== undefined || data.durationMin !== undefined || data.endDate !== undefined || (data.status !== undefined && !ACTIVE_STATUSES.includes(appt.status));
    if (req.body.force !== true && timeChanged && ACTIVE_STATUSES.includes(nextStatus)) {
        const clash = await findConflict(
            req, appt.agentId, data.date ?? appt.date, data.durationMin ?? appt.durationMin ?? 60,
            data.endDate !== undefined ? data.endDate : appt.endDate, appt.id,
        );
        if (clash) return res.status(409).json(conflictResponse(clash, req.user!.policies.appointments.bufferMinutes));
    }

    const updated = await prisma.appointment.update({ where: { id: found.appt!.id }, data });
    const changes = diffFields(found.appt!, data);
    if (Object.keys(changes.after).length > 0) await audit(req, 'UPDATE_APPOINTMENT', 'Appointment', found.appt!.id, changes.before, changes.after);
    // A completed meeting counts as contact with the client
    if (data.status === 'COMPLETED' && updated.clientId) {
        await prisma.client.update({ where: { id: updated.clientId }, data: { lastContactedAt: new Date() } });
    }
    res.json(updated);
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req: AuthRequest, res) => {
    const found = await findEditable(req);
    if (found.error === 404) return res.status(404).json({ error: 'Appointment not found' });
    if (found.error === 403) return res.status(403).json({ error: 'Forbidden' });
    await prisma.appointment.delete({ where: { id: found.appt!.id } });
    await audit(req, 'DELETE_APPOINTMENT', 'Appointment', found.appt!.id, { title: found.appt!.title, date: found.appt!.date.toISOString() });
    res.json({ message: 'Appointment deleted' });
});

export default router;
