import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createPrismaClient } from './lib/prisma';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

// Version from package.json (works from src/ and dist/), shown by /api/health
let APP_VERSION = 'unknown';
try {
    const pkg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8'));
    APP_VERSION = pkg.appVersion || pkg.version || 'unknown';
} catch { /* keep 'unknown' */ }

const app = express();
// Behind Render/Vercel the client IP arrives in X-Forwarded-For. Without this,
// every user shares the proxy's IP and one rate-limit bucket.
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : (process.env.NODE_ENV === 'production' ? 1 : false));
const prisma = createPrismaClient();
const PORT = process.env.PORT || 4000;

import clientRoutes from './routes/clients';
import propertyRoutes from './routes/properties';
import transactionRoutes from './routes/transactions';
import dashboardRoutes from './routes/dashboard';
import marketingRoutes from './routes/marketing';
import authRoutes from './routes/auth';
import financeRoutes from './routes/finance';
import settingsRoutes from './routes/settings';
import offersRoutes from './routes/offers';
import documentsRoutes from './routes/documents';
import appointmentsRoutes from './routes/appointments';
import mediaRoutes from './routes/media';
import marketingTasksRoutes from './routes/marketing-tasks';
import referralsRoutes from './routes/referrals';
import giftsRoutes from './routes/gifts';
import oauthRoutes from './routes/oauth';
import importExportRoutes from './routes/importExport';
import paymentRoutes from './routes/payments';
import integrationsRoutes from './routes/integrations';
import tasksRoutes from './routes/tasks';
import notificationsRoutes from './routes/notifications';
import searchRoutes from './routes/search';
import uploadsRoutes from './routes/uploads';

import { authenticateToken, AuthRequest } from './middleware/authMiddleware';
import { startReminderLoop } from './lib/reminders';
import { runRelease } from './release';
import { captureBackendException } from './lib/sentry';

// Middleware
// In production an explicit FRONTEND_URL allowlist is mandatory: falling back to
// '*' alongside credentials:true would be an origin-unrestricted credentialed API.
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
    console.error('FATAL: FRONTEND_URL must be set in production (CORS allowlist)');
    process.exit(1);
}
// Baseline security headers (the API only serves JSON)
app.disable('x-powered-by');
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});
const allowedOrigins = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*';
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
}));
// Stripe webhook needs raw body — must be before express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/oauth', oauthRoutes);

// Protected Routes
app.use('/api/clients', authenticateToken, clientRoutes);
app.use('/api/properties', propertyRoutes); // Public /public route + self-managed auth via router.use(authenticateToken)
app.use('/api/transactions', authenticateToken, transactionRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/marketing', authenticateToken, marketingRoutes);
app.use('/api/finance', authenticateToken, financeRoutes);
app.use('/api/settings', authenticateToken, settingsRoutes);
app.use('/api/settings/users', authenticateToken, importExportRoutes);
app.use('/api/offers', authenticateToken, offersRoutes);
app.use('/api/documents', authenticateToken, documentsRoutes);
app.use('/api/appointments', authenticateToken, appointmentsRoutes);
app.use('/api/media', authenticateToken, mediaRoutes);
app.use('/api/marketing-tasks', authenticateToken, marketingTasksRoutes);
app.use('/api/referrals', authenticateToken, referralsRoutes);
app.use('/api/gifts', authenticateToken, giftsRoutes);
app.use('/api/integrations', authenticateToken, integrationsRoutes);
app.use('/api/tasks',         tasksRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/search',        searchRoutes);
app.use('/api/payments',      paymentRoutes);
app.use('/api/uploads',       uploadsRoutes);

// Basic Health Check Route
app.get('/api/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ status: 'ok', version: APP_VERSION, db: 'connected', timestamp: new Date().toISOString() });
    } catch {
        res.status(503).json({ status: 'error', version: APP_VERSION, db: 'disconnected', timestamp: new Date().toISOString() });
    }
});

// 404 — this is a JSON API, so unknown routes must not fall through to
// Express's default HTML error page
app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path });
});

// Global error handler. Express 5 forwards async route rejections here.
// Internal error details are logged server-side but never returned to the client.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err);

    // Malformed JSON bodies surface as a SyntaxError from express.json()
    if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({ error: 'Malformed JSON in request body' });
    }
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request payload too large' });
    }
    // CORS rejections
    if (typeof err?.message === 'string' && err.message.includes('Not allowed by CORS')) {
        return res.status(403).json({ error: 'Origin not allowed' });
    }

    const status = err?.status || 500;
    if (status >= 500) {
        const authReq = req as AuthRequest;
        void captureBackendException(err, {
            path: req.path,
            method: req.method,
            userId: authReq.user?.userId,
            orgId: authReq.user?.orgId,
            release: APP_VERSION,
        });
    }

    res.status(status).json({ error: 'Internal server error' });
});

// Start Server
let server: ReturnType<typeof app.listen> | undefined;
let reminderTimer: ReturnType<typeof startReminderLoop> | null = null;

async function start() {
    // Production applies database migrations (and the one-time baseline) before
    // accepting traffic. If this fails the process exits and the host keeps the
    // previous version running.
    if (process.env.NODE_ENV === 'production' && process.env.RUN_MIGRATIONS_ON_START !== 'false') {
        await runRelease();
    }
    server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
    reminderTimer = process.env.DISABLE_JOBS === 'true' ? null : startReminderLoop();
}
start().catch(err => {
    console.error('FATAL: startup failed:', err);
    process.exit(1);
});

const shutdown = async (signal: string) => {
    console.log(`${signal} received — shutting down gracefully`);
    if (reminderTimer) clearInterval(reminderTimer);
    if (!server) { await prisma.$disconnect(); process.exit(0); }
    server.close(async () => {
        await prisma.$disconnect();
        console.log('Database disconnected. Bye.');
        process.exit(0);
    });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, prisma };
