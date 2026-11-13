import { messages, Lang, PLATFORM_NAME } from './messages';
/**
 * Email service abstraction — supports Resend and SendGrid.
 * Set EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM in environment.
 * Falls back to console.log when no API key is set (dev mode).
 */

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

async function sendViaResend(options: EmailOptions): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.EMAIL_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: `${process.env.EMAIL_FROM_NAME || PLATFORM_NAME} <${process.env.EMAIL_FROM}>`,
            to: [options.to],
            subject: options.subject,
            html: options.html,
            text: options.text,
        }),
    });
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Resend API error: ${err}`);
    }
}

async function sendViaSendGrid(options: EmailOptions): Promise<void> {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.EMAIL_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            personalizations: [{ to: [{ email: options.to }] }],
            from: { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME || PLATFORM_NAME },
            subject: options.subject,
            content: [
                { type: 'text/html', value: options.html },
                ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
            ],
        }),
    });
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`SendGrid API error: ${err}`);
    }
}

export async function sendEmail(options: EmailOptions): Promise<void> {
    if (!process.env.EMAIL_API_KEY || !process.env.EMAIL_FROM) {
        console.log(`[EMAIL - dev mode] To: ${options.to} | Subject: ${options.subject}`);
        console.log(`[EMAIL - dev mode] Body preview: ${options.html.replace(/<[^>]+>/g, '').substring(0, 200)}`);
        return;
    }

    const provider = process.env.EMAIL_PROVIDER || 'resend';
    if (provider === 'sendgrid') {
        await sendViaSendGrid(options);
    } else {
        await sendViaResend(options);
    }
}

// ── Pre-built email templates ─────────────────────────────────────────────────

export function passwordResetEmail(resetUrl: string, userName: string, lang: Lang = 'es', orgName?: string | null): EmailOptions['html'] {
    const m = messages(lang);
    return `
<!DOCTYPE html>
<html lang="${lang === 'es' ? 'es-UY' : 'en'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f9fafb; margin:0; padding:40px 20px;">
  <div style="max-width:560px; margin:0 auto; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:40px;">
    <div style="font-size:24px; font-weight:700; color:#111; margin-bottom:8px;">${m.resetTitle}</div>
    <p style="color:#6b7280; margin:0 0 24px;">${m.resetBody(userName)}</p>
    <a href="${resetUrl}" style="display:inline-block; background:#111; color:#fff; text-decoration:none; padding:12px 28px; border-radius:6px; font-size:14px; font-weight:600; letter-spacing:0.05em;">${m.resetButton}</a>
    <p style="color:#9ca3af; font-size:12px; margin-top:24px;">${m.resetIgnore}</p>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0">
    <p style="color:#9ca3af; font-size:11px; margin:0;">${m.emailFooter(orgName)}</p>
  </div>
</body>
</html>`;
}

export function welcomeEmail(verifyUrl: string, userName: string, lang: Lang = 'es', orgName?: string | null): EmailOptions['html'] {
    const m = messages(lang);
    return `
<!DOCTYPE html>
<html lang="${lang === 'es' ? 'es-UY' : 'en'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f9fafb; margin:0; padding:40px 20px;">
  <div style="max-width:560px; margin:0 auto; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:40px;">
    <div style="font-size:24px; font-weight:700; color:#111; margin-bottom:8px;">${m.welcomeTitle(userName)}</div>
    <p style="color:#6b7280; margin:0 0 24px;">${m.welcomeBody}</p>
    <a href="${verifyUrl}" style="display:inline-block; background:#111; color:#fff; text-decoration:none; padding:12px 28px; border-radius:6px; font-size:14px; font-weight:600; letter-spacing:0.05em;">${m.verifyButton}</a>
    <p style="color:#9ca3af; font-size:12px; margin-top:24px;">${m.verifyExpires}</p>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0">
    <p style="color:#9ca3af; font-size:11px; margin:0;">${m.emailFooter(orgName)}</p>
  </div>
</body>
</html>`;
}

export function appointmentReminderEmail(details: { clientName: string; date: string; address: string; agentName: string }): EmailOptions['html'] {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f9fafb; margin:0; padding:40px 20px;">
  <div style="max-width:560px; margin:0 auto; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:40px;">
    <div style="font-size:20px; font-weight:700; color:#111; margin-bottom:16px;">Appointment Reminder</div>
    <p style="color:#374151; margin:0 0 8px;">Hi ${details.clientName},</p>
    <p style="color:#6b7280; margin:0 0 24px;">You have an upcoming property showing with ${details.agentName}.</p>
    <div style="background:#f3f4f6; border-radius:6px; padding:16px 20px; margin-bottom:24px;">
      <div style="font-weight:600; color:#111; margin-bottom:4px;">📅 ${details.date}</div>
      <div style="color:#6b7280;">📍 ${details.address}</div>
    </div>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0">
    <p style="color:#9ca3af; font-size:11px; margin:0;">${PLATFORM_NAME}</p>
  </div>
</body>
</html>`;
}
