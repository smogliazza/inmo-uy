import { messages, Lang, orgLocale } from '../lib/messages';
import { Router } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { sendEmail } from '../lib/email';

const router = Router();
router.use(authenticateToken);

export interface NotificationPrefs {
    emailNewClient: boolean;
    emailAppointmentReminder: boolean;
    emailTransactionUpdate: boolean;
    emailOfferReceived: boolean;
    emailCommissionPaid: boolean;
    emailTaskOverdue: boolean;
    emailWeeklyReport: boolean;
    inAppAll: boolean;
    inAppMentions: boolean;
    smsUrgent: boolean;
    digestFrequency: string;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
    emailNewClient: true,
    emailAppointmentReminder: true,
    emailTransactionUpdate: true,
    emailOfferReceived: true,
    emailCommissionPaid: true,
    emailTaskOverdue: true,
    emailWeeklyReport: true,
    inAppAll: true,
    inAppMentions: true,
    smsUrgent: false,
    digestFrequency: 'daily',
};

export function normalizeNotificationPrefs(raw: unknown): NotificationPrefs {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
        emailNewClient: typeof obj.emailNewClient === 'boolean' ? obj.emailNewClient : DEFAULT_NOTIFICATION_PREFS.emailNewClient,
        emailAppointmentReminder: typeof obj.emailAppointmentReminder === 'boolean' ? obj.emailAppointmentReminder : DEFAULT_NOTIFICATION_PREFS.emailAppointmentReminder,
        emailTransactionUpdate: typeof obj.emailTransactionUpdate === 'boolean' ? obj.emailTransactionUpdate : DEFAULT_NOTIFICATION_PREFS.emailTransactionUpdate,
        emailOfferReceived: typeof obj.emailOfferReceived === 'boolean' ? obj.emailOfferReceived : DEFAULT_NOTIFICATION_PREFS.emailOfferReceived,
        emailCommissionPaid: typeof obj.emailCommissionPaid === 'boolean' ? obj.emailCommissionPaid : DEFAULT_NOTIFICATION_PREFS.emailCommissionPaid,
        emailTaskOverdue: typeof obj.emailTaskOverdue === 'boolean' ? obj.emailTaskOverdue : DEFAULT_NOTIFICATION_PREFS.emailTaskOverdue,
        emailWeeklyReport: typeof obj.emailWeeklyReport === 'boolean' ? obj.emailWeeklyReport : DEFAULT_NOTIFICATION_PREFS.emailWeeklyReport,
        inAppAll: typeof obj.inAppAll === 'boolean' ? obj.inAppAll : DEFAULT_NOTIFICATION_PREFS.inAppAll,
        inAppMentions: typeof obj.inAppMentions === 'boolean' ? obj.inAppMentions : DEFAULT_NOTIFICATION_PREFS.inAppMentions,
        smsUrgent: typeof obj.smsUrgent === 'boolean' ? obj.smsUrgent : DEFAULT_NOTIFICATION_PREFS.smsUrgent,
        digestFrequency: typeof obj.digestFrequency === 'string' ? obj.digestFrequency : DEFAULT_NOTIFICATION_PREFS.digestFrequency,
    };
}

function shouldSendEmailForType(prefs: NotificationPrefs, type: string): boolean {
    if (prefs.digestFrequency === 'none') return false;
    switch (type) {
        case 'NEW_CLIENT':
            return prefs.emailNewClient;
        case 'APPOINTMENT_REMINDER':
            return prefs.emailAppointmentReminder;
        case 'TRANSACTION_UPDATE':
        case 'DOCUMENT_SIGNED':
            return prefs.emailTransactionUpdate;
        case 'OFFER_RECEIVED':
        case 'OFFER_ACCEPTED':
        case 'OFFER_REJECTED':
            return prefs.emailOfferReceived;
        case 'COMMISSION_PAID':
            return prefs.emailCommissionPaid;
        case 'TASK_DUE':
            return prefs.emailTaskOverdue;
        default:
            return false;
    }
}

function buildNotificationEmailHtml(userName: string, title: string, message: string, link: string | undefined, lang: Lang): string {
    const m = messages(lang);
    const appUrl = (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').split(',')[0].trim();
    const actionHref = link ? `${appUrl.replace(/\/$/, '')}${link.startsWith('/') ? link : `/${link}`}` : appUrl;
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f9fafb; margin:0; padding:32px 16px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; padding:32px;">
    <div style="font-size:18px; font-weight:700; color:#111827; margin-bottom:8px;">${title}</div>
    <p style="color:#4b5563; font-size:14px; line-height:1.6; margin:0 0 24px;">${m.notificationGreeting(userName)}<br>${message}</p>
    <a href="${actionHref}" style="display:inline-block; background:#B8977E; color:#ffffff; text-decoration:none; padding:10px 22px; border-radius:6px; font-size:13px; font-weight:600;">${m.notificationOpen}</a>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0">
    <p style="color:#9ca3af; font-size:11px; margin:0;">${lang === 'es' ? 'Podés elegir qué avisos recibir por email en Ajustes → Notificaciones.' : 'You can manage your email alert preferences in Settings → Notifications.'}</p>
  </div>
</body>
</html>`;
}

// GET /api/notifications
router.get('/', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const unreadOnly = req.query.unread === 'true';
        const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

        const where: any = { userId: req.user.userId };
        if (unreadOnly) where.readAt = null;

        const [notifications, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
            }),
            prisma.notification.count({
                where: { userId: req.user.userId, readAt: null },
            }),
        ]);

        res.json({ notifications, unreadCount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// PATCH /api/notifications/:id/read — mark single as read
router.patch('/:id/read', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        await prisma.notification.updateMany({
            where: { id: String(req.params.id), userId: req.user.userId },
            data:  { readAt: new Date() },
        });
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark notification read' });
    }
});

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', async (req: AuthRequest, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        await prisma.notification.updateMany({
            where: { userId: req.user.userId, readAt: null },
            data:  { readAt: new Date() },
        });
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark all read' });
    }
});

// ─── Helper exported for use in other routes ──────────────────────────────────
export async function createNotification(
    userId: string,
    orgId:  string,
    type:   string,
    title:  string,
    message: string,
    link?:  string,
    metadata?: object,
) {
    const VALID = ['NEW_CLIENT', 'OFFER_RECEIVED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'APPOINTMENT_REMINDER',
        'TRANSACTION_UPDATE', 'COMMISSION_PAID', 'TASK_DUE', 'DOCUMENT_SIGNED', 'SYSTEM'];
    const normalizedType = VALID.includes(type) ? type : 'SYSTEM';
    try {
        const recipient = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, name: true, isActive: true, notificationPrefs: true },
        });
        const prefs = normalizeNotificationPrefs(recipient?.notificationPrefs);

        if (prefs.inAppAll !== false) {
            await prisma.notification.create({
                data: {
                    userId,
                    orgId,
                    type:     normalizedType as any,
                    title,
                    message,
                    link,
                    metadata: metadata ? JSON.stringify(metadata) : null,
                },
            });
        }

        if (recipient && recipient.isActive && recipient.email && shouldSendEmailForType(prefs, normalizedType)) {
            const { lang } = await orgLocale(orgId);
            await sendEmail({
                to: recipient.email,
                subject: title,
                html: buildNotificationEmailHtml(recipient.name || '', title, message, link, lang),
                text: `${title}\n\n${message}`,
            }).catch(err => console.error('Failed to send notification email:', err));
        }
    } catch (e) {
        console.error('Failed to create notification:', e);
    }
}

export default router;
