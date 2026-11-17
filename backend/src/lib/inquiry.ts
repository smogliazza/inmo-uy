/**
 * Public lead capture (spec 8.4): an inquiry from a listing page creates the interested person in the CRM
 * (or updates the existing one), routes it like any other lead, logs the message and asks the agent to call
 * back. Used by the legacy /api/properties/public/:id/inquiry and by the brokerage sites (/api/public/...).
 */
import { prisma } from '../server';
import { createNotification } from '../routes/notifications';
import { resolveLeadAssignee } from './routing';
import { getOrgModules } from './modules';
import { normalizePhoneUY } from './uy';
import { orgLocale } from './messages';

export const PUBLIC_STATUSES = ['ACTIVE', 'COMING_SOON', 'IN_CONTRACT', 'RESERVED'] as const;

export type InquiryResult =
    | { ok: true; status: 201 }
    | { ok: false; status: 400 | 404; error: string; code?: string };

const clean = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * @param property  a public listing already checked to belong to the brokerage being served
 * @param requireConsent  the brokerage sites always ask for consent (Ley 18.331); the legacy form records it when sent
 */
export async function handleInquiry(
    property: { id: string; orgId: string; agentId: string; address: string; city: string; propertyType: string | null; price: number | null },
    body: Record<string, unknown>,
    requireConsent: boolean,
): Promise<InquiryResult> {
    const name = clean(body.name, 120);
    const email = clean(body.email, 200).toLowerCase();
    const phone = normalizePhoneUY(clean(body.phone, 40)) || '';
    const message = clean(body.message, 2000);
    const source = body.source === 'OPEN_HOUSE' ? 'Puertas abiertas' : 'Sitio web';
    const consent = body.consent === true || body.consent === 'true';
    // Honeypot field: real users never fill it in. Answer as if it worked so bots learn nothing.
    if (clean(body.website)) return { ok: true, status: 201 };

    if (!name) return { ok: false, status: 400, error: 'Please enter your name', code: 'NAME_REQUIRED' };
    if (!email && !phone) return { ok: false, status: 400, error: 'Please enter an email or phone number', code: 'CONTACT_REQUIRED' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, error: 'Invalid email address', code: 'EMAIL_INVALID' };
    if (requireConsent && !consent) return { ok: false, status: 400, error: 'Consent is required', code: 'CONSENT_REQUIRED' };

    const modules = await getOrgModules(property.orgId);
    // With lead routing off, the inquiry goes straight to the listing agent.
    const assignedAgentId = modules.leadRouting.enabled
        ? (await resolveLeadAssignee({
            orgId: property.orgId,
            source,
            city: property.city,
            propertyType: property.propertyType,
            price: property.price,
            listingAgentId: property.agentId,
        })).agentId
        : property.agentId;

    const [firstName, ...rest] = name.split(/\s+/);
    const or: Record<string, unknown>[] = [];
    if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
    if (phone) or.push({ phone });
    let client = await prisma.client.findFirst({ where: { orgId: property.orgId, OR: or } });
    const isNew = !client;
    const consentAt = consent ? new Date() : undefined;
    if (!client) {
        client = await prisma.client.create({
            data: {
                firstName, lastName: rest.join(' '),
                email: email || null, phone: phone || null,
                type: 'BUYER', status: 'LEAD', funnelStage: 'LEAD', temperature: 'HOT',
                source, agentId: assignedAgentId, orgId: property.orgId,
                ...(consentAt ? { consentAt } : {}),
            },
        });
    } else {
        await prisma.client.update({ where: { id: client.id }, data: { temperature: 'HOT', ...(consentAt ? { consentAt } : {}) } });
    }

    const targetAgentId = isNew ? assignedAgentId : client.agentId;
    const { m } = await orgLocale(property.orgId);

    await prisma.note.create({
        data: {
            type: 'NOTE',
            content: m.inquiryNote(source, property.address, message),
            clientId: client.id, propertyId: property.id,
            authorId: targetAgentId, orgId: property.orgId,
        },
    });
    if (modules.tasks.enabled) await prisma.task.create({
        data: {
            title: m.callBackTask(name, property.address),
            priority: 'URGENT', dueDate: new Date(Date.now() + 15 * 60 * 1000),
            linkedClientId: client.id, linkedPropertyId: property.id,
            agentId: targetAgentId, orgId: property.orgId,
        },
    });
    await createNotification(
        targetAgentId, property.orgId, 'NEW_CLIENT',
        isNew ? m.newLead(source) : m.returningLead(name),
        m.leadDetail(name, property.address),
        `/crm/${client.id}`,
    );
    return { ok: true, status: 201 };
}
