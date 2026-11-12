/**
 * Texts the server writes for people to read: notifications, automatic tasks, timeline and dashboard
 * entries, and emails. They follow the brokerage's language (Organization.preferredLanguage, "es" by default);
 * Spanish (Uruguay) and English are provided, other languages fall back to English.
 *
 * Dates are shown in the brokerage's time zone (Organization.timezone, America/Montevideo by default).
 */

export type Lang = 'es' | 'en';

export function toLang(v: string | null | undefined): Lang {
    return v === 'en' || v === 'zh-CN' || v === 'zh-TW' ? 'en' : 'es';
}

const LOCALE: Record<Lang, string> = { es: 'es-UY', en: 'en-US' };

/** "12/11/2026 14:30" (es) / "11/12/2026, 2:30 PM" (en), in the brokerage's time zone. */
export function formatWhen(d: Date, lang: Lang, timeZone = 'America/Montevideo'): string {
    try {
        return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short', timeStyle: 'short', timeZone }).format(d);
    } catch {
        return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Montevideo' }).format(d);
    }
}

export function formatAmount(n: number, lang: Lang): string {
    return n.toLocaleString(LOCALE[lang], { maximumFractionDigits: 2 });
}

/** Platform name used in emails until the owner chooses one (spec, open question 1). */
export const PLATFORM_NAME = process.env.PLATFORM_NAME || 'Plataforma inmobiliaria';

const STATUS_ES: Record<string, string> = {
    OFFER_REVIEW: 'oferta en revisión', IN_CONTRACT: 'con boleto de reserva', BOARD_PACKAGE: 'documentación del edificio',
    CLEARED_TO_CLOSE: 'lista para escriturar', CLOSED: 'escriturada', FALLEN_THROUGH: 'caída',
    ACCEPTED: 'aceptada', REJECTED: 'rechazada', COUNTER: 'contraofertada', WITHDRAWN: 'retirada', EXPIRED: 'vencida', PENDING: 'pendiente',
};
const NOTE_TYPE_ES: Record<string, string> = { NOTE: 'Nota', CALL: 'Llamada', EMAIL: 'Email', TEXT: 'Mensaje', MEETING: 'Reunión', SHOWING: 'Visita' };
const APPT_TYPE_ES: Record<string, string> = {
    SHOWING: 'Visita', MEETING: 'Reunión', CALL: 'Llamada', OPEN_HOUSE: 'Puertas abiertas', INSPECTION: 'Tasación / inspección', CLOSING: 'Firma', FOLLOW_UP: 'Seguimiento',
};
const CLIENT_TYPE_ES: Record<string, string> = { BUYER: 'comprador', SELLER: 'vendedor', RENTER: 'inquilino', INVESTOR: 'inversor', REFERRAL: 'referido', OWNER: 'propietario', TENANT: 'inquilino' };
const words = (s: string) => s.replace(/_/g, ' ').toLowerCase();

/** "12/11/2026" in the brokerage's time zone. */
export function formatDay(d: Date, lang: Lang, timeZone = 'America/Montevideo'): string {
    try { return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short', timeZone }).format(d); }
    catch { return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short' }).format(d); }
}

/** Short month name ("nov." / "Nov"). */
export function monthShort(monthIndex: number, lang: Lang): string {
    return new Intl.DateTimeFormat(LOCALE[lang], { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, monthIndex, 15)));
}

const es = {
    // Notifications
    upcomingAppointment: 'Visita próxima',
    appointmentDetail: (title: string, who: string, where: string, when: string) => `«${title}»${who ? ` con ${who}` : ''}${where ? ` en ${where}` : ''}: ${when}`,
    appointmentScheduled: 'Visita agendada',
    appointmentScheduledDetail: (title: string, when: string) => `«${title}» quedó agendada para el ${when}.`,
    taskOverdue: (title: string) => `Tarea vencida: ${title}`,
    taskOverdueDetail: (title: string, when: string) => `«${title}» venció el ${when}.`,
    dealUpdated: 'Cambió el estado de una operación',
    dealUpdatedDetail: (status: string) => `La operación pasó a ${STATUS_ES[status] ?? words(status)}.`,
    offerReceived: 'Llegó una oferta',
    offerReceivedDetail: (amount: string, address: string) => `Hay una oferta de ${amount} por ${address}.`,
    offerResult: (status: string) => `Oferta ${STATUS_ES[status] ?? words(status)}`,
    offerResultDetail: (amount: string, address: string, status: string) => `Tu oferta de ${amount} por ${address} fue ${STATUS_ES[status] ?? words(status)}.`,
    payoutApproved: 'Pago aprobado',
    payoutApprovedDetail: (amount: string) => `Se aprobó el pago de tu comisión de ${amount}.`,
    payoutReturned: 'Pedido de pago devuelto',
    payoutReturnedDetail: 'Tu pedido de pago no se aprobó. Consultalo con tu gerente.',
    newLead: (source: string) => `Nueva consulta (${source})`,
    returningLead: (name: string) => `${name} volvió a consultar`,
    leadDetail: (name: string, address: string) => `${name} consultó por ${address}. Respondele en los próximos 5 minutos.`,
    clientAssigned: 'Te asignaron un cliente',
    clientAssignedDetail: (name: string) => `Te asignaron a ${name}.`,
    newReferral: 'Nuevo referido',
    newReferralDetail: 'Un colega te mandó un referido.',
    // Tasks created automatically
    callBackTask: (name: string, address: string) => `Llamar a ${name} por ${address}`,
    followUpTask: (name: string) => `Seguimiento a ${name}`,
    inquiryNote: (source: string, address: string, message: string) => `Consulta (${source}) por ${address}${message ? `:\n${message}` : ''}`,
    // Client timeline
    timelineNote: (type: string, author: string) => `${NOTE_TYPE_ES[type] ?? words(type)} registrada por ${author}`,
    timelineOffer: (address: string) => `Oferta por ${address}`,
    timelineAppointment: (type: string, title: string) => `${APPT_TYPE_ES[type] ?? words(type)}: ${title}`,
    timelineGift: (item: string) => `Regalo: ${item}`,
    timelineGiftStatus: (status: string) => `Estado: ${words(status)}`,
    timelineDeal: (status: string) => `Operación ${STATUS_ES[status] ?? words(status)}`,
    timelineTask: (title: string) => `Tarea: ${title}`,
    timelineCreated: 'Se creó la ficha del cliente',
    timelineAt: (address: string) => `En ${address}`,
    timelineDue: (date: string) => `Vence el ${date}`,
    timelineAddedAs: (type: string, source: string | null) => `Cargado como ${CLIENT_TYPE_ES[type] ?? words(type)}${source ? ` (origen: ${source})` : ''}`,
    timelineDealProperty: (address: string) => `Propiedad: ${address}`,
    offerLine: (amount: string, status: string) => `${amount}: ${STATUS_ES[status] ?? words(status)}`,
    // Dashboard action items
    actionOverdue: (title: string) => `Vencida: ${title}`,
    actionReviewOffer: (amount: string) => `Revisar oferta de ${amount}`,
    actionOfferSubtitle: (address: string, client: string) => `${address} (cliente: ${client})`,
    actionFollowUp: (name: string) => `Hacer seguimiento: ${name}`,
    actionSendGift: (item: string) => `Mandar regalo: ${item}`,
    actionGiftSubtitle: (client: string) => `Para: ${client}`,
    actionWasDue: (date: string) => `Venció el ${date}`,
    actionNoContact: (days: number) => `Sin contacto hace ${days} días`,
    actionNeverContacted: 'Nunca se lo contactó',
    actionOpenTasks: 'Ver tareas',
    actionReview: 'Revisar y responder',
    actionOpenClient: 'Abrir cliente',
    actionOrderGift: 'Pedir regalo',
    // Emails
    emailFooter: (org?: string | null) => (org ? `${org} · ${PLATFORM_NAME}` : PLATFORM_NAME),
    resetSubject: 'Cambiá tu contraseña',
    resetTitle: 'Cambiá tu contraseña',
    resetBody: (name: string) => `Hola ${name}, recibimos un pedido para cambiar tu contraseña. Usá el botón de abajo; el enlace vence en 1 hora.`,
    resetButton: 'Cambiar contraseña',
    resetIgnore: 'Si no lo pediste, ignorá este email: tu contraseña no cambia.',
    verifySubject: 'Verificá tu email',
    welcomeTitle: (name: string) => `¡Hola, ${name}!`,
    welcomeBody: 'Tu cuenta está creada. Verificá tu email para activarla.',
    verifyButton: 'Verificar email',
    verifyExpires: 'El enlace vence en 24 horas.',
    inviteSubject: (org: string) => `Te invitaron a sumarte a ${org}`,
    inviteTitle: '¡Te invitaron!',
    inviteBody: (inviter: string, org: string, role: string) => `<strong>${inviter}</strong> te invitó a sumarte a <strong>${org}</strong> como <strong>${role}</strong>.`,
    inviteCta: 'Hacé clic para aceptar la invitación y crear tu cuenta:',
    inviteButton: 'Aceptar invitación',
    inviteExpires: 'La invitación vence en 7 días.',
    someoneFromTeam: 'Alguien de tu equipo',
    yourTeam: 'tu equipo',
    notificationGreeting: (name: string) => `Hola ${name},`,
    notificationOpen: 'Abrir',
};

type Messages = typeof es;

const en: Messages = {
    upcomingAppointment: 'Upcoming appointment',
    appointmentDetail: (title, who, where, when) => `"${title}"${who ? ` with ${who}` : ''}${where ? ` at ${where}` : ''}: ${when}`,
    appointmentScheduled: 'Appointment scheduled',
    appointmentScheduledDetail: (title, when) => `"${title}" is scheduled for ${when}.`,
    taskOverdue: title => `Task overdue: ${title}`,
    taskOverdueDetail: (title, when) => `"${title}" was due ${when}.`,
    dealUpdated: 'Deal status updated',
    dealUpdatedDetail: status => `Deal moved to ${words(status)}.`,
    offerReceived: 'New offer received',
    offerReceivedDetail: (amount, address) => `An offer of ${amount} was submitted for ${address}.`,
    offerResult: status => `Offer ${words(status)}`,
    offerResultDetail: (amount, address, status) => `Your offer of ${amount} on ${address} was ${words(status)}.`,
    payoutApproved: 'Payout approved',
    payoutApprovedDetail: amount => `Your commission payout of ${amount} was approved.`,
    payoutReturned: 'Payout request returned',
    payoutReturnedDetail: 'Your payout request was not approved. Check with your manager.',
    newLead: source => `New lead (${source})`,
    returningLead: name => `Returning lead: ${name}`,
    leadDetail: (name, address) => `${name} asked about ${address}. Reach out within 5 minutes.`,
    clientAssigned: 'Client assigned to you',
    clientAssignedDetail: name => `${name} was assigned to you.`,
    newReferral: 'New referral',
    newReferralDetail: 'A colleague sent you a referral.',
    callBackTask: (name, address) => `Call back ${name} about ${address}`,
    followUpTask: name => `Follow up with ${name}`,
    inquiryNote: (source, address, message) => `${source} inquiry about ${address}${message ? `:\n${message}` : ''}`,
    timelineNote: (type, author) => `${type.charAt(0)}${type.slice(1).toLowerCase()} logged by ${author}`,
    timelineOffer: address => `Offer for ${address}`,
    timelineAppointment: (type, title) => `${type.replace('_', ' ')}: ${title}`,
    timelineGift: item => `Gift: ${item}`,
    timelineGiftStatus: status => `Status: ${status}`,
    timelineDeal: status => `Deal ${status.replace(/_/g, ' ')}`,
    timelineTask: title => `Task: ${title}`,
    timelineCreated: 'Client record created',
    timelineAt: address => `At ${address}`,
    timelineDue: date => `Due ${date}`,
    timelineAddedAs: (type, source) => `Added as ${type}${source ? ` via ${source}` : ''}`,
    timelineDealProperty: address => `Property: ${address}`,
    offerLine: (amount, status) => `${amount} — ${status}`,
    actionOverdue: title => `Overdue: ${title}`,
    actionReviewOffer: amount => `Review Offer: ${amount}`,
    actionOfferSubtitle: (address, client) => `${address} (Client: ${client})`,
    actionFollowUp: name => `Follow up: ${name}`,
    actionSendGift: item => `Send Gift: ${item}`,
    actionGiftSubtitle: client => `Recipient: ${client}`,
    actionWasDue: date => `Was due ${date}`,
    actionNoContact: days => `No contact for ${days} days`,
    actionNeverContacted: 'Never contacted',
    actionOpenTasks: 'Open Tasks',
    actionReview: 'Review & Respond',
    actionOpenClient: 'Open Client',
    actionOrderGift: 'Order Gift',
    emailFooter: org => (org ? `${org} · ${PLATFORM_NAME}` : PLATFORM_NAME),
    resetSubject: 'Reset your password',
    resetTitle: 'Reset your password',
    resetBody: name => `Hi ${name}, we received a request to reset your password. Click the button below. This link expires in 1 hour.`,
    resetButton: 'Reset Password',
    resetIgnore: "If you didn't request this, ignore this email. Your password won't change.",
    verifySubject: 'Verify your email',
    welcomeTitle: name => `Welcome, ${name}!`,
    welcomeBody: 'Your account has been created. Please verify your email address to activate it.',
    verifyButton: 'Verify Email',
    verifyExpires: 'This link expires in 24 hours.',
    inviteSubject: org => `You've been invited to join ${org}`,
    inviteTitle: "You're invited!",
    inviteBody: (inviter, org, role) => `<strong>${inviter}</strong> has invited you to join <strong>${org}</strong> as a <strong>${role}</strong>.`,
    inviteCta: 'Click below to accept the invitation and set up your account:',
    inviteButton: 'Accept Invitation',
    inviteExpires: 'This invitation expires in 7 days.',
    someoneFromTeam: 'A team member',
    yourTeam: 'our team',
    notificationGreeting: name => `Hi ${name},`,
    notificationOpen: 'Open',
};

const DICTS: Record<Lang, Messages> = { es, en };

export function messages(lang: Lang): Messages {
    return DICTS[lang];
}

// ─── The brokerage's language and time zone (short cache) ─────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = () => (require('../server') as typeof import('../server')).prisma;
const cache = new Map<string, { at: number; lang: Lang; timeZone: string }>();

export async function orgLocale(orgId: string): Promise<{ lang: Lang; timeZone: string; m: Messages }> {
    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < 60_000) return { lang: hit.lang, timeZone: hit.timeZone, m: DICTS[hit.lang] };
    const org = await db().organization.findUnique({ where: { id: orgId }, select: { preferredLanguage: true, timezone: true } });
    const lang = toLang(org?.preferredLanguage);
    const timeZone = org?.timezone || 'America/Montevideo';
    cache.set(orgId, { at: Date.now(), lang, timeZone });
    return { lang, timeZone, m: DICTS[lang] };
}

export function clearOrgLocaleCache(orgId?: string) {
    if (orgId) cache.delete(orgId); else cache.clear();
}
